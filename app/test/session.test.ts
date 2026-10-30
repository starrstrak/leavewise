import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';
import { checkToken, loadSecret, makeToken, SESSION_COOKIE } from '../src/session.js';
import { buildDemoState, DEMO_NOW } from '../../demo/seed.js';

const SECRET = 'a'.repeat(64);
let nowMs = Date.parse('2026-04-20T09:00:00Z');
const server = createApp({ state: buildDemoState(), now: DEMO_NOW }, null, { secret: SECRET, ttlSeconds: 600, clock: () => nowMs });
server.listen(0);
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => { server.close(); });

const raw = (path: string, headers: Record<string, string> = {}, method = 'GET', body?: unknown) =>
  fetch(base() + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
async function login(user: string) {
  const r = await raw('/api/session', {}, 'POST', { userId: user });
  return { status: r.status, setCookie: r.headers.get('set-cookie') ?? '', cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] };
}
const err = async (r: Response) => (await r.json()).error;

describe('Session de démo à cookie signé', () => {
  it('T51 cookie absent : 401 « no_session » partout, l\'ancien en-tête x-user n\'ouvre plus rien', async () => {
    for (const path of ['/api/me', '/api/decisions', '/api/audit', '/api/rules']) {
      const r = await raw(path);
      expect(r.status).toBe(401);
      expect(await err(r)).toBe('no_session');
    }
    const legacy = await raw('/api/audit', { 'x-user': 'emp-paul' });
    expect(legacy.status).toBe(401);
    expect(await err(legacy)).toBe('no_session');
  });

  it('T52 cookie falsifié : signature invalide, charge modifiée, autre secret, forme incorrecte => 401 « invalid_session »', async () => {
    const lea = (await login('emp-lea')).cookie.split('=')[1];
    const [body, mac] = lea.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ u: 'emp-paul', exp: Math.floor(nowMs / 1000) + 600 })).toString('base64url');
    const foreign = makeToken('b'.repeat(64), 'emp-paul', Math.floor(nowMs / 1000));
    const tokens = ['garbage', '', 'a.b', `${forgedBody}.${mac}`, `${body}.${mac.slice(0, -2)}xx`, foreign, `${lea}.extra`, `${body}.`];
    for (const tok of tokens) {
      const r = await raw('/api/audit', { cookie: `${SESSION_COOKIE}=${tok}` });
      expect(r.status).toBe(401);
      expect(await err(r)).toBe(tok === '' ? 'no_session' : 'invalid_session');
    }
    // jeton valide d'un·e employé·e : accès « me » mais jamais l'audit (droits par rôle conservés)
    expect((await raw('/api/me', { cookie: `${SESSION_COOKIE}=${lea}` })).status).toBe(200);
    expect((await raw('/api/audit', { cookie: `${SESSION_COOKIE}=${lea}` })).status).toBe(403);
  });

  it('T53 cookie expiré : 401 « session_expired » après la durée, nouvelle connexion possible', async () => {
    const { cookie } = await login('emp-claire');
    expect((await raw('/api/me', { cookie })).status).toBe(200);
    nowMs += 599_000;
    expect((await raw('/api/me', { cookie })).status).toBe(200); // 1 s avant l'expiration
    nowMs += 1_000;
    const r = await raw('/api/me', { cookie });
    expect(r.status).toBe(401);
    expect(await err(r)).toBe('session_expired');
    const again = await login('emp-claire');
    expect((await raw('/api/me', { cookie: again.cookie })).status).toBe(200);
  });

  it('T54 attributs du cookie (HttpOnly, SameSite=Strict, durée) ; déconnexion ; rôle inconnu refusé', async () => {
    const l = await login('emp-lea');
    expect(l.setCookie).toMatch(/HttpOnly/);
    expect(l.setCookie).toMatch(/SameSite=Strict/);
    expect(l.setCookie).toMatch(/Max-Age=600/);
    expect(l.setCookie).toMatch(/Path=\//);
    const boot = await (await raw('/api/bootstrap', { cookie: l.cookie })).json();
    expect(boot.session).toEqual({ userId: 'emp-lea' });
    expect(JSON.stringify(boot)).not.toMatch(/birthDate|childrenUnder12/);
    const out = await raw('/api/session', {}, 'DELETE');
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect((await login('personne')).status).toBe(401);
    expect((await (await raw('/api/bootstrap')).json()).session).toBeNull();
  });

  it('T55 requête inter-sites refusée (Origin différent de Host) ; même origine acceptée', async () => {
    const { cookie } = await login('emp-lea');
    const evil = await raw('/api/requests', { cookie, origin: 'https://evil.example' }, 'POST', { type: 'vacation', start: '2026-09-07', end: '2026-09-08' });
    expect(evil.status).toBe(403);
    expect(await err(evil)).toBe('bad_origin');
    const ok = await raw('/api/me', { cookie, origin: base() });
    expect(ok.status).toBe(200);
  });

  it('T56 jeton : durée vérifiée à la seconde, charge limitée à l\'identifiant et à l\'expiration (aucune donnée personnelle)', () => {
    const t0 = 1_800_000_000;
    const tok = makeToken(SECRET, 'emp-lea', t0, 60);
    expect(checkToken(SECRET, tok, t0 + 59)).toMatchObject({ ok: true, userId: 'emp-lea' });
    expect(checkToken(SECRET, tok, t0 + 60)).toEqual({ ok: false, code: 'session_expired' });
    const payload = JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString('utf8'));
    expect(Object.keys(payload).sort()).toEqual(['exp', 'u']);
  });
});

describe('Secret de signature local', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lw-secret-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('T57 généré au premier lancement (0600), stable ensuite, régénéré s\'il est trop court', () => {
    const file = join(dir, 'data', 'session.secret');
    const a = loadSecret(file);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadSecret(file)).toBe(a);
    writeFileSync(file, 'trop-court');
    const b = loadSecret(file);
    expect(b).not.toBe(a);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
  });

  it('T58 le fichier de secret par défaut est ignoré par git et absent de l\'index', () => {
    const root = join(__dirname, '..', '..');
    const ignored = execFileSync('git', ['check-ignore', 'app/data/session.secret'], { cwd: root }).toString().trim();
    expect(ignored).toBe('app/data/session.secret');
    expect(execFileSync('git', ['ls-files', '--', 'app/data'], { cwd: root }).toString().trim()).toBe('');
  });
});
