import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';
import { makeOwnerToken, makeToken, OWNER_COOKIE, SESSION_COOKIE } from '../src/session.js';
import { buildDemoState, DEMO_NOW } from '../../demo/seed.js';

const SECRET = 'b'.repeat(64);
const PASSWORD = 'correct horse battery staple 42';
let nowMs = Date.parse('2026-04-20T09:00:00Z');

function boot(opts: { password?: string; maxFailures?: number } = {}) {
  const publicStore = { state: buildDemoState(), now: DEMO_NOW };
  const ownerStore = { state: buildDemoState(), now: DEMO_NOW };
  const server = createApp(publicStore, null, {
    secret: SECRET, clock: () => nowMs, ownerPassword: opts.password, ownerStore, ownerFile: null, ownerFailDelayMs: 0, ownerMaxFailures: opts.maxFailures ?? 5,
  });
  server.listen(0);
  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const raw = (path: string, headers: Record<string, string> = {}, method = 'GET', body?: unknown) =>
    fetch(base() + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { server, raw, publicStore, ownerStore };
}
const cookieOf = (r: Response, name: string) => (r.headers.get('set-cookie') ?? '').split(';')[0].replace(`${name}=`, '');
const err = async (r: Response) => (await r.json()).error;
const asAdmin = async (raw: ReturnType<typeof boot>['raw'], owner?: string) => {
  const h: Record<string, string> = owner ? { cookie: `${OWNER_COOKIE}=${owner}` } : {};
  const s = await raw('/api/session', h, 'POST', { userId: 'emp-paul' });
  return { cookie: `${SESSION_COOKIE}=${cookieOf(s, SESSION_COOKIE)}${owner ? `; ${OWNER_COOKIE}=${owner}` : ''}` };
};

describe('Espace propriétaire : privé, complet, séparé de la démo publique', () => {
  const off = boot();
  const on = boot({ password: PASSWORD });
  afterAll(() => { off.server.close(); on.server.close(); });

  it('T69 sans mot de passe configuré (ou trop court) : espace désactivé, aucune route ouverte', async () => {
    const st = await (await off.raw('/api/bootstrap')).json();
    expect(st.owner).toEqual({ enabled: false, authenticated: false });
    const login = await off.raw('/api/owner/login', {}, 'POST', { password: PASSWORD });
    expect(login.status).toBe(404);
    expect(await err(login)).toBe('owner_disabled');
    expect((await off.raw('/api/owner/export')).status).toBe(404);
    const short = boot({ password: 'trop-court' });
    expect((await (await short.raw('/api/bootstrap')).json()).owner.enabled).toBe(false);
    short.server.close();
  });

  it('T70 mauvais mot de passe : 401 ; cookie jamais émis ; routes propriétaire fermées', async () => {
    const r = await on.raw('/api/owner/login', {}, 'POST', { password: 'faux' });
    expect(r.status).toBe(401);
    expect(await err(r)).toBe('invalid_password');
    expect(r.headers.get('set-cookie')).toBeNull();
    for (const [p, m] of [['/api/owner/export', 'GET'], ['/api/owner/reset', 'POST'], ['/api/owner/import', 'POST']] as const) {
      const x = await on.raw(p, {}, m, m === 'POST' ? {} : undefined);
      expect(x.status, p).toBe(401);
      expect(await err(x)).toBe('owner_required');
    }
    expect((await on.raw('/api/owner/login', {}, 'POST', {})).status).toBe(401);
  });

  it('T71 bon mot de passe : cookie HttpOnly, SameSite=Strict, Secure derrière HTTPS ; accès au statut', async () => {
    const r = await on.raw('/api/owner/login', {}, 'POST', { password: PASSWORD });
    expect(r.status).toBe(200);
    const sc = r.headers.get('set-cookie')!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Strict/);
    expect(sc).not.toMatch(/Secure/);
    const tls = await on.raw('/api/owner/login', { 'x-forwarded-proto': 'https' }, 'POST', { password: PASSWORD });
    expect(tls.headers.get('set-cookie')).toMatch(/; Secure/);
    const ck = `${OWNER_COOKIE}=${cookieOf(r, OWNER_COOKIE)}`;
    expect((await (await on.raw('/api/bootstrap', { cookie: ck })).json()).owner).toEqual({ enabled: true, authenticated: true });
    expect((await (await on.raw('/api/bootstrap')).json()).owner).toEqual({ enabled: true, authenticated: false });
  });

  it('T72 données séparées : ce que fait le propriétaire n\'apparaît jamais côté public, et inversement', async () => {
    const owner = cookieOf(await on.raw('/api/owner/login', {}, 'POST', { password: PASSWORD }), OWNER_COOKIE);
    const ownerAdmin = await asAdmin(on.raw, owner);
    const publicAdmin = await asAdmin(on.raw);
    const post = await on.raw('/api/requests', ownerAdmin, 'POST', { employeeId: 'emp-lea', type: 'vacation', start: '2026-09-07', end: '2026-09-08' });
    expect(post.status).toBe(201);
    const ownerReqs = (await (await on.raw('/api/requests', ownerAdmin)).json()).requests;
    const publicReqs = (await (await on.raw('/api/requests', publicAdmin)).json()).requests;
    expect(ownerReqs.length).toBe(publicReqs.length + 1);
    expect(on.ownerStore.state.absences.length).toBe(on.publicStore.state.absences.length + 1);
    // réinitialisation publique (admin de la démo) : n'efface pas l'espace du propriétaire
    expect((await on.raw('/api/reset', publicAdmin, 'POST', {})).status).toBe(200);
    expect(on.ownerStore.state.absences.length).toBe(on.publicStore.state.absences.length + 1);
    // horloge de l'espace propriétaire : ne touche pas la démo publique
    await on.raw('/api/clock', ownerAdmin, 'POST', { now: '2026-05-04T09:00' });
    expect(on.ownerStore.now).toBe('2026-05-04T09:00');
    expect(on.publicStore.now).toBe(DEMO_NOW);
  });

  it('T73 accès complet : tous les rôles utilisables dans l\'espace (admin, RH, manager, employé) sans limite de plan', async () => {
    const owner = cookieOf(await on.raw('/api/owner/login', {}, 'POST', { password: PASSWORD }), OWNER_COOKIE);
    for (const [uid, path, status] of [['emp-paul', '/api/audit', 200], ['emp-paul', '/api/rules', 200], ['emp-claire', '/api/decisions', 200], ['emp-lea', '/api/me', 200], ['emp-lea', '/api/audit', 403]] as const) {
      const s = await on.raw('/api/session', { cookie: `${OWNER_COOKIE}=${owner}` }, 'POST', { userId: uid });
      const ck = `${SESSION_COOKIE}=${cookieOf(s, SESSION_COOKIE)}; ${OWNER_COOKIE}=${owner}`;
      expect((await on.raw(path, { cookie: ck })).status, `${uid} ${path}`).toBe(status);
    }
    const ownerAdmin = await asAdmin(on.raw, owner);
    expect((await on.raw('/api/triage', ownerAdmin, 'POST', {})).status).toBe(200);
    expect((await on.raw('/api/export/audit.csv', ownerAdmin)).status).toBe(200);
  });

  it('T74 cookie propriétaire falsifié, expiré, ou cookie de session de démo seul : jamais d\'accès', async () => {
    const good = makeOwnerToken(SECRET, Math.floor(nowMs / 1000));
    const [body, mac] = good.split('.');
    const forged = [`${body}.${'A'.repeat(mac.length)}`, `${Buffer.from(JSON.stringify({ u: 'owner', exp: 9999999999 })).toString('base64url')}.${mac}`, makeOwnerToken('c'.repeat(64), Math.floor(nowMs / 1000)), 'garbage'];
    for (const f of forged) expect((await on.raw('/api/owner/export', { cookie: `${OWNER_COOKIE}=${f}` })).status, f.slice(0, 12)).toBe(401);
    // un jeton de session de démo n'est pas un jeton propriétaire, même signé avec le même secret
    const demoTok = makeToken(SECRET, 'owner', Math.floor(nowMs / 1000));
    expect((await on.raw('/api/owner/export', { cookie: `${OWNER_COOKIE}=${demoTok}` })).status).toBe(401);
    expect((await on.raw('/api/owner/export', { cookie: (await asAdmin(on.raw)).cookie })).status).toBe(401);
    const expired = makeOwnerToken(SECRET, Math.floor(nowMs / 1000) - 13 * 3600);
    expect((await on.raw('/api/owner/export', { cookie: `${OWNER_COOKIE}=${expired}` })).status).toBe(401);
  });

  it('T75 anti force brute : verrouillage après 5 échecs par client, y compris avec le bon mot de passe', async () => {
    const b = boot({ password: PASSWORD, maxFailures: 3 });
    const hdr = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 3; i++) expect((await b.raw('/api/owner/login', hdr, 'POST', { password: `faux${i}` })).status).toBe(401);
    const locked = await b.raw('/api/owner/login', hdr, 'POST', { password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(await err(locked)).toBe('too_many_attempts');
    expect(locked.headers.get('set-cookie')).toBeNull();
    // un autre client n'est pas verrouillé ; un en-tête X-Forwarded-For usurpé en tête de liste ne contourne pas la clé (dernier élément)
    expect((await b.raw('/api/owner/login', { 'x-forwarded-for': '198.51.100.1' }, 'POST', { password: PASSWORD })).status).toBe(200);
    expect((await b.raw('/api/owner/login', { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }, 'POST', { password: PASSWORD })).status).toBe(429);
    // la fenêtre expire
    nowMs += 16 * 60_000;
    expect((await b.raw('/api/owner/login', hdr, 'POST', { password: PASSWORD })).status).toBe(200);
    b.server.close();
  });

  it('T76 déconnexion, export complet, import validé, réinitialisation de l\'espace', async () => {
    const owner = cookieOf(await on.raw('/api/owner/login', {}, 'POST', { password: PASSWORD }), OWNER_COOKIE);
    const h = { cookie: `${OWNER_COOKIE}=${owner}` };
    const ex = await on.raw('/api/owner/export', h);
    expect(ex.status).toBe(200);
    expect(ex.headers.get('content-disposition')).toMatch(/attachment/);
    const dump = await ex.json();
    expect(dump.state.employees.length).toBe(8);
    // import invalide : rejeté sans modifier l'espace
    const before = on.ownerStore.state.employees.length;
    const bad = await on.raw('/api/owner/import', h, 'POST', { now: '2026-04-20T09:00', state: { employees: 'x' } });
    expect(bad.status).toBe(400);
    expect(on.ownerStore.state.employees.length).toBe(before);
    // aller-retour : on retire un employé, on réimporte l'export, on le retrouve
    dump.state.employees = dump.state.employees.filter((e: any) => e.id !== 'emp-noah');
    expect((await on.raw('/api/owner/import', h, 'POST', dump)).status).toBe(200);
    expect(on.ownerStore.state.employees.length).toBe(7);
    expect((await on.raw('/api/owner/reset', h, 'POST', {})).status).toBe(200);
    expect(on.ownerStore.state.employees.length).toBe(8);
    // déconnexion : le cookie est effacé côté navigateur ; un cookie conservé reste valide jusqu'à son expiration (jeton sans état)
    const out = await on.raw('/api/owner/logout', h, 'POST', {});
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('T77 import : limite de taille dédiée (5 Mo) et origine croisée refusée', async () => {
    const owner = cookieOf(await on.raw('/api/owner/login', {}, 'POST', { password: PASSWORD }), OWNER_COOKIE);
    const h = { cookie: `${OWNER_COOKIE}=${owner}` };
    const big = await on.raw('/api/owner/import', h, 'POST', { pad: 'x'.repeat(6 * 1024 * 1024) });
    expect(big.status).toBe(413);
    const cross = await on.raw('/api/owner/reset', { ...h, origin: 'https://evil.example' }, 'POST', {});
    expect(cross.status).toBe(403);
    expect(await err(cross)).toBe('bad_origin');
  });
});
