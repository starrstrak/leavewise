import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from './actions.js';
import { balanceOf } from './balance.js';
import { addDays, slotsOf } from './calendar.js';
import { coverOfSlot, isOpenSlot, makeCtx, activeAbsences } from './coverage.js';
import { locale, Lang } from './i18n.js';
import { rankForRequest } from './actions.js';
import { balancesFor, canSeeEmployee, viewDecision } from './views.js';
import { buildDemoState, DEMO_NOW } from '../../demo/seed.js';
import * as V from './validate.js';
import * as C from './config.js';
import { checkOwnerToken, checkToken, cookieHeader, DEFAULT_TTL_SECONDS, loadSecret, makeOwnerToken, makeToken, OWNER_COOKIE, OWNER_TTL_SECONDS, ownerCookieHeader, readCookie } from './session.js';
import type { Half, State } from './types.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(root, 'data');
const dataFile = join(dataDir, 'state.json');
const secretFile = join(dataDir, 'session.secret');
const ownerFile = join(dataDir, 'owner-state.json');
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const OWNER_MIN_PASSWORD = 12;

/** `live`: the clock follows real time (new workspaces); otherwise `now` is a simulated, fixed date. */
export interface Store { state: State; now: string; live?: boolean }
const realNow = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 16);
export const blankStore = (): Store => ({ state: C.blankState(), now: realNow(), live: true });

export function loadStore(file = dataFile, fallback: () => Store = () => ({ state: buildDemoState(), now: DEMO_NOW })): Store {
  if (file && existsSync(file)) {
    try {
      const st = JSON.parse(readFileSync(file, 'utf8'));
      if (st && typeof st.now === 'string' && Array.isArray(st.state?.employees)) return st;
      throw new Error('invalid_state_shape');
    } catch (e) {
      // an unreadable state file is kept aside (never silently overwritten) and the demo restarts from fictional data
      const aside = `${file}.corrupt-${Date.now()}`;
      renameSync(file, aside);
      console.error(`state file unreadable (${(e as Error).message}); kept as ${aside}`);
    }
  }
  return fallback();
}

/** Atomic write: temp file in the same directory, fsync, then rename (a crash never leaves a half-written state). */
export function writeFileAtomic(file: string, data: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try { writeSync(fd, data); fsyncSync(fd); } catch (e) { closeSync(fd); rmSync(tmp, { force: true }); throw e; }
  closeSync(fd);
  renameSync(tmp, file);
}

class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }

const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])).join(','))].join('\n');
};

export interface AppOptions {
  /** HMAC secret of the session cookie; random and in-memory when omitted (tests) */
  secret?: string;
  ttlSeconds?: number;
  /** clock in milliseconds, injectable for expiry tests */
  clock?: () => number;
  /** private owner workspace: enabled only when a password of >= 12 characters is configured (never stored in the repo) */
  ownerPassword?: string;
  ownerStore?: Store;
  /** where the owner workspace is persisted; null = memory only */
  ownerFile?: string | null;
  /** failed owner logins allowed per client per window, and the window (ms) */
  ownerMaxFailures?: number;
  ownerWindowMs?: number;
  ownerFailDelayMs?: number;
}

const sha = (v: string) => createHash('sha256').update(v).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

export function createApp(store: Store, persistFile: string | null = dataFile, opts: AppOptions = {}) {
  const secret = opts.secret ?? randomBytes(32).toString('hex');
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const nowSec = () => Math.floor((opts.clock ?? Date.now)() / 1000);
  const ownerEnabled = !!opts.ownerPassword && opts.ownerPassword.length >= OWNER_MIN_PASSWORD;
  const ownerStore: Store = opts.ownerStore ?? blankStore();
  const ownerPersist = opts.ownerFile === undefined ? ownerFile : opts.ownerFile;
  const maxFailures = opts.ownerMaxFailures ?? 5, windowMs = opts.ownerWindowMs ?? 15 * 60_000, failDelay = opts.ownerFailDelayMs ?? 400;
  const failures = new Map<string, { n: number; first: number }>();
  const persist = (st: Store) => { const f = st === ownerStore ? ownerPersist : persistFile; if (f) writeFileAtomic(f, JSON.stringify(st)); };
  /** client key: last X-Forwarded-For entry (appended by the hosting proxy, not forgeable by the client), else the socket address */
  const clientKey = (req: IncomingMessage) => String(req.headers['x-forwarded-for'] ?? '').split(',').pop()!.trim() || req.socket.remoteAddress || 'unknown';
  const isSecure = (req: IncomingMessage) => String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';

  async function api(req: IncomingMessage, url: URL, body: any): Promise<{ status?: number; json?: unknown; text?: string; type?: string; headers?: Record<string, string> }> {
    const nowMs = (opts.clock ?? Date.now)();
    const isOwner = ownerEnabled && checkOwnerToken(secret, readCookie(req.headers.cookie, OWNER_COOKIE), nowSec());
    const st = isOwner ? ownerStore : store;
    const save = () => persist(st);
    const s = st.state, now = st.live ? realNow(nowMs) : st.now;
    const lng: Lang = V.lang(url.searchParams.get('lng'));
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /healthz') return { json: { ok: true } };
    if (route === 'GET /api/locale') return { json: locale(lng) };
    const sess = checkToken(secret, readCookie(req.headers.cookie), nowSec());
    if (route === 'GET /api/bootstrap') {
      return { json: { now, session: sess.ok ? { userId: sess.userId } : null, owner: { enabled: ownerEnabled, authenticated: isOwner, blank: isOwner && !!s.org && s.employees.length <= 1 }, org: s.org ?? null, live: !!st.live,
        qualifications: s.qualifications.map((q) => ({ code: q.code, label: q.label ?? null, critical: q.canOpen && q.countsAsQualified && !q.mustBeSupervised })),
        employees: s.employees.map((e) => ({ id: e.id, name: e.name, role: e.role, status: e.status, qualifications: e.qualifications })) } };
    }
    // ---- owner space (private, complete, free): password-gated, separate state from the public demo ----
    if (route === 'POST /api/owner/login') {
      if (!ownerEnabled) throw new HttpError(404, 'owner_disabled');
      const key = clientKey(req); const f = failures.get(key);
      if (f && nowMs - f.first > windowMs) failures.delete(key);
      const cur = failures.get(key);
      if (cur && cur.n >= maxFailures) throw new HttpError(429, 'too_many_attempts');
      const pw = typeof body?.password === 'string' ? body.password : '';
      if (!sameSecret(pw, opts.ownerPassword!)) {
        failures.set(key, { n: (cur?.n ?? 0) + 1, first: cur?.first ?? nowMs });
        if (failDelay) await new Promise((r) => setTimeout(r, failDelay));
        throw new HttpError(401, 'invalid_password');
      }
      failures.delete(key);
      return { json: { ok: true, expiresIn: OWNER_TTL_SECONDS }, headers: { 'set-cookie': ownerCookieHeader(makeOwnerToken(secret, nowSec()), OWNER_TTL_SECONDS, isSecure(req)) } };
    }
    if (route === 'POST /api/owner/logout') return { json: { ok: true }, headers: { 'set-cookie': ownerCookieHeader('', 0, isSecure(req)) } };
    if (url.pathname.startsWith('/api/owner/')) {
      if (!ownerEnabled) throw new HttpError(404, 'owner_disabled');
      if (!isOwner) throw new HttpError(401, 'owner_required');
      if (route === 'GET /api/owner/export') return { json: { exportedFrom: 'owner-space', ...st }, headers: { 'content-disposition': 'attachment; filename="leavewise-owner-state.json"' } };
      if (route === 'POST /api/owner/import') {
        const imp = body as any;
        if (!imp || typeof imp.now !== 'string' || !imp.state || !Array.isArray(imp.state.employees) || !Array.isArray(imp.state.absences)
          || !Array.isArray(imp.state.rulesVersions) || !imp.state.rulesVersions.length || !Array.isArray(imp.state.qualifications)) throw new V.ValidationError('invalid_state_shape', 'state');
        ownerStore.state = imp.state; ownerStore.now = V.isoDateTime(imp.now, 'now'); save();
        return { json: { ok: true, employees: imp.state.employees.length, requests: imp.state.absences.length } };
      }
      if (route === 'POST /api/owner/reset') {
        const mode = V.oneOf(body.mode ?? 'blank', ['blank', 'demo'] as const, 'mode');
        const fresh = mode === 'demo' ? { state: buildDemoState(), now: DEMO_NOW, live: false } : blankStore();
        ownerStore.state = fresh.state; ownerStore.now = fresh.now; ownerStore.live = fresh.live; save();
        return { json: { ok: true, mode } };
      }
      throw new HttpError(404, 'not_found');
    }
    // Demo sign-in: choosing a demo role is the whole login (no password, no personal data).
    if (route === 'POST /api/session') {
      const who = s.employees.find((e) => e.id === body?.userId);
      if (!who) throw new HttpError(401, 'unknown_user');
      return { json: { userId: who.id, expiresIn: ttl }, headers: { 'set-cookie': cookieHeader(makeToken(secret, who.id, nowSec(), ttl), ttl) } };
    }
    if (route === 'DELETE /api/session') return { json: { ok: true }, headers: { 'set-cookie': cookieHeader('', 0) } };
    if (!sess.ok) throw new HttpError(401, sess.code);
    const me = s.employees.find((e) => e.id === sess.userId);
    if (!me) throw new HttpError(401, 'invalid_session');
    const hr = A.isHr(me), mgr = me.role === 'manager' || hr;
    const need = (ok: boolean) => { if (!ok) throw new HttpError(403, 'forbidden'); };
    const seg = url.pathname.split('/').filter(Boolean); // api, x, id?, action?

    switch (route) {
      // ---- workspace setup: owner space only (the public demo stays read-mostly), admin role required ----
      case 'GET /api/config': {
        need(isOwner && me.role === 'admin');
        return { json: { org: s.org ?? { name: '', sector: '' }, qualifications: s.qualifications, rules: A.currentRules(s, now), employees: s.employees, now, live: !!st.live } };
      }
      case 'PUT /api/org': { need(isOwner && me.role === 'admin'); const r = C.setOrg(s, body, me.id, now); save(); return { json: r }; }
      case 'PUT /api/qualifications': {
        need(isOwner && me.role === 'admin');
        const r = C.setQualifications(s, body.qualifications, me.id, now); save(); return { json: r };
      }
      case 'POST /api/employees': { need(isOwner && me.role === 'admin'); const r = C.addEmployee(s, body, me.id, now); save(); return { status: 201, json: r }; }
      case 'GET /api/me': {
        const bal = balancesFor(s, now, me).find((b) => b.employeeId === me.id);
        const sp = s.sensitive.find((x) => x.employeeId === me.id);
        return { json: { me: { id: me.id, name: me.name, role: me.role }, balance: bal, leaves: A.currentRules(s, now).legal.leaves, consent: sp ?? { employeeId: me.id, consent: false },
          notifications: s.notifications.filter((n) => n.to === me.id && n.channel === 'inapp').slice(-30).reverse() } };
      }
      case 'GET /api/requests': {
        const vis = s.absences.filter((a) => canSeeEmployee(me, s.employees.find((e) => e.id === a.employeeId)!));
        return { json: { requests: vis, balances: balancesFor(s, now, me) } };
      }
      case 'POST /api/requests': {
        const inp = V.submitInput(body);
        const empId = hr && inp.employeeId ? inp.employeeId : me.id;
        const a = A.submitRequest(s, { ...inp, employeeId: empId }, now, me.id);
        save(); return { status: 201, json: a };
      }
      case 'GET /api/decisions': {
        need(mgr);
        const ds = s.decisions.filter((d) => {
          const a = s.absences.find((x) => x.id === d.requestId)!;
          return canSeeEmployee(me, s.employees.find((e) => e.id === a.employeeId)!);
        });
        return { json: ds.map((d) => viewDecision(d, me, lng)) };
      }
      case 'POST /api/triage': {
        need(mgr);
        const auto = V.opt(body, 'auto', V.bool);
        A.runTriage(s, now, me.id);
        if (auto) A.autoValidate(s, now);
        save();
        return { json: s.decisions.filter((d) => d.status === 'proposed').map((d) => viewDecision(d, me, lng)) };
      }
      case 'POST /api/decisions/validate': {
        need(mgr);
        const r = A.validateDecisions(s, V.idList(body.ids, 'ids'), me.id, now); save(); return { json: r };
      }
      case 'POST /api/decisions/override': {
        need(mgr);
        const o = V.overrideInput(body);
        const r = A.overrideDecision(s, { ...o, actor: me.id }, now, !!o.preview); if (!o.preview) save(); return { json: r };
      }
      case 'GET /api/coverage': {
        const from = V.isoDate(url.searchParams.get('from') ?? now.slice(0, 10), 'from');
        const to = V.isoDate(url.searchParams.get('to') ?? addDays(from, 30), 'to');
        if (to < from) throw new V.ValidationError('invalid_range', 'to');
        if (to > addDays(from, 92)) throw new V.ValidationError('range_too_long', 'to');
        const ctx = makeCtx(s, A.currentRules(s, now));
        const abs = activeAbsences(ctx);
        const out: any[] = [];
        for (const sl of slotsOf(from, 'AM', to, 'PM')) {
          if (!isOpenSlot(sl, ctx)) { out.push({ ...sl, open: ctx.cal.isOpen(sl.date, sl.half) ? false : false, status: 'closed' }); continue; }
          const c = coverOfSlot(sl, ctx, abs);
          out.push({ ...sl, open: true, qualified: c.qualified, headcount: c.headcount, status: c.qualified >= ctx.rules.coverage.minQualified ? 'ok' : 'gap' });
        }
        return { json: out };
      }
      case 'POST /api/unplanned': {
        const u = V.unplannedInput(body);
        need(mgr || u.employeeId === me.id);
        const r = A.declareUnplanned(s, u, me.id, now); save(); return { status: 201, json: r };
      }
      case 'GET /api/replacements': {
        const mine = hr || mgr;
        const list = s.replacements.filter((r) => mine || r.offers.some((o) => o.candidateId === me.id));
        return { json: list.map((rr) => ({ ...rr, ranking: rr.status === 'filled' || rr.status === 'void' ? [] : rankForRequest(s, rr, now).ranked,
          impact: rr.status === 'filled' || rr.status === 'void' ? null : { reduced_hours: A.planBImpact(s, rr, 'reduced_hours', now), closure: A.planBImpact(s, rr, 'closure', now) } })) };
      }
      case 'POST /api/tick': { need(mgr); const r = A.tick(s, now); save(); return { json: r }; }
      case 'GET /api/audit': { need(hr); return { json: s.audit.slice().reverse() }; }
      case 'GET /api/notifications': return { json: s.notifications.filter((n) => n.to === me.id) };
      case 'PUT /api/rules': {
        need(me.role === 'admin');
        const v = A.addRulesVersion(s, V.rulesPatch(body) as any, me.id, now); save(); return { json: v };
      }
      case 'GET /api/rules': { need(hr); return { json: s.rulesVersions } };
      case 'POST /api/consent': {
        A.setConsent(s, me.id, V.consentInput(body), me.id, now); save(); return { json: s.sensitive.find((x) => x.employeeId === me.id) };
      }
      case 'POST /api/clock': {
        need(me.role === 'admin');
        if (body.live === true) { st.live = true; st.now = realNow(nowMs); } else { st.live = false; st.now = V.isoDateTime(body.now, 'now'); }
        save(); return { json: { now: st.live ? realNow(nowMs) : st.now, live: !!st.live } };
      }
      case 'POST /api/reset': { need(me.role === 'admin'); st.state = buildDemoState(); st.now = DEMO_NOW; save(); return { json: { ok: true } }; }
    }
    // parametric routes
    if (seg[1] === 'employees' && seg[2] && (req.method === 'PUT' || req.method === 'DELETE')) {
      need(isOwner && me.role === 'admin');
      const id = V.id(seg[2], 'id');
      if (req.method === 'DELETE') { C.removeEmployee(s, id, me.id, now); save(); return { json: { ok: true } }; }
      const r = C.updateEmployee(s, id, body, me.id, now); save(); return { json: r };
    }
    if (seg[1] === 'requests' && seg[2] && req.method === 'POST') {
      V.id(seg[2], 'id');
      const a = s.absences.find((x) => x.id === seg[2]);
      if (!a) throw new HttpError(404, 'unknown_request');
      const own = a.employeeId === me.id;
      if (seg[3] === 'withdraw') { need(own || hr); A.withdrawRequest(s, a.id, me.id, now); }
      else if (seg[3] === 'cancel-request') { need(own || hr); A.requestCancellation(s, a.id, me.id, now, V.opt(body, 'reason', (v, f) => V.text(v, f))); }
      else if (seg[3] === 'cancel-decide') { need(mgr); A.decideCancellation(s, a.id, V.bool(body.accept, 'accept'), me.id, now, V.text(body.reason, 'reason')); }
      else throw new HttpError(404, 'not_found');
      save(); return { json: a };
    }
    if (seg[1] === 'replacements' && seg[2] && req.method === 'POST') {
      const id = V.id(seg[2], 'id');
      if (seg[3] === 'offer') { need(mgr); const r = A.offerNext(s, id, now, me.id); save(); return { json: r }; }
      if (seg[3] === 'respond') { const r = A.respondOffer(s, id, me.id, V.bool(body.accept, 'accept'), now); save(); return { json: r }; }
      if (seg[3] === 'plan-b') { need(mgr); const r = A.applyPlanB(s, id, V.oneOf(body.option, ['reduced_hours', 'closure'] as const, 'option'), me.id, now, V.text(body.reason, 'reason')); save(); return { json: r }; }
    }
    if (seg[1] === 'export' && req.method === 'GET') {
      need(hr);
      const name = seg[2]?.replace(/\.csv$/, '');
      const rules = A.currentRules(s, now); const cal = makeCtx(s, rules).cal;
      const rows = name === 'audit' ? s.audit.map((a) => ({ ...a }))
        : name === 'requests' ? s.absences.map((a) => ({ id: a.id, employee: a.employeeId, type: a.type, start: a.start, end: a.end, status: a.status, submittedAt: a.submittedAt }))
        : name === 'balances' ? s.employees.filter((e) => e.status !== 'external_temp').map((e) => ({ employee: e.name, ...balanceOf(e, Number(now.slice(0, 4)), now.slice(0, 10), s.absences, cal, rules) }))
        : null;
      if (!rows) throw new HttpError(404, 'not_found');
      return { text: csv(rows as any), type: 'text/csv; charset=utf-8' };
    }
    throw new HttpError(404, 'not_found');
  }

  const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

  return createServer(async (req, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
      if (url.pathname.startsWith('/api/')) {
        // CSRF: a browser cross-site request carries an Origin that differs from Host
        const origin = req.headers.origin;
        if (origin && req.method !== 'GET') {
          let host = ''; try { host = new URL(origin).host; } catch { /* "null" origin */ }
          if (host !== req.headers.host) throw new HttpError(403, 'bad_origin');
        }
        const limit = url.pathname === '/api/owner/import' ? MAX_IMPORT_BYTES : V.MAX_BODY_BYTES;
        const declared = Number(req.headers['content-length'] ?? 0);
        if (declared > limit) throw new HttpError(413, 'payload_too_large');
        let size = 0; const chunks: Buffer[] = [];
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > limit) throw new HttpError(413, 'payload_too_large');
          chunks.push(c as Buffer);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: any = {};
        if (raw.trim()) {
          if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'unsupported_media_type');
          try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'invalid_json'); }
          V.body(body);
        }
        const r = await api(req, url, body);
        res.writeHead(r.status ?? 200, { 'content-type': r.type ?? 'application/json; charset=utf-8', ...r.headers });
        res.end(r.text ?? JSON.stringify(r.json));
        return;
      }
      if (url.pathname === '/site') { res.writeHead(301, { location: '/site/' }); res.end(); return; }
      const isSite = url.pathname === '/site' || url.pathname.startsWith('/site/');
      const base = isSite ? join(root, '..', 'site') : join(root, 'public');
      const path = isSite ? url.pathname.slice(5) || '/' : url.pathname;
      const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
      const file = normalize(join(base, rel));
      if (!file.startsWith(normalize(base)) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : e instanceof V.ValidationError ? 400 : e instanceof A.DomainError ? 422 : 500;
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(status === 500 ? { error: 'internal_error' } : { error: e.code ?? e.message, ...(e.field ? { field: e.field } : {}) }));
      if (status === 500) console.error(e);
    }
  });
}

if (process.argv[1]?.endsWith('server.ts')) {
  const port = Number(process.env.PORT ?? 3000);
  const envSecret = process.env.SESSION_SECRET;
  const ownerPassword = process.env.OWNER_PASSWORD;
  if (ownerPassword && ownerPassword.length < OWNER_MIN_PASSWORD) console.error(`OWNER_PASSWORD ignoré : ${OWNER_MIN_PASSWORD} caractères minimum, espace propriétaire désactivé`);
  createApp(loadStore(), dataFile, {
    secret: envSecret && envSecret.length >= 32 ? envSecret : loadSecret(secretFile),
    ownerPassword, ownerStore: loadStore(ownerFile, blankStore), ownerFile,
  }).listen(port, () => console.log(`Leavewise proto: http://localhost:${port}  (donnees fictives)${ownerPassword && ownerPassword.length >= OWNER_MIN_PASSWORD ? '  [espace propriétaire actif]' : ''}`));
}

export type { Half };
