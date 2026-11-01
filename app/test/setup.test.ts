import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { blankStore, createApp } from '../src/server.js';
import { OWNER_COOKIE, SESSION_COOKIE } from '../src/session.js';
import { buildDemoState, DEMO_NOW } from '../../demo/seed.js';

const SECRET = 'd'.repeat(64);
const PASSWORD = 'un mot de passe propriétaire assez long';
const nowMs = Date.parse('2026-06-01T08:00:00Z');
const publicStore = { state: buildDemoState(), now: DEMO_NOW };
const ownerStore = blankStore();
const server = createApp(publicStore, null, { secret: SECRET, clock: () => nowMs, ownerPassword: PASSWORD, ownerStore, ownerFile: null, ownerFailDelayMs: 0 });
server.listen(0);
afterAll(() => { server.close(); });
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const raw = (path: string, cookie = '', method = 'GET', body?: unknown) =>
  fetch(base() + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const ck = (r: Response, n: string) => (r.headers.get('set-cookie') ?? '').split(';')[0].replace(`${n}=`, '');

let ownerCookie = '';
async function as(userId: string) {
  const s = await raw('/api/session', ownerCookie, 'POST', { userId });
  return `${SESSION_COOKIE}=${ck(s, SESSION_COOKIE)}; ${ownerCookie}`;
}
const j = async (r: Response) => r.json();
const week = (days: number[], halves = ['AM', 'PM']) => Object.fromEntries(days.map((d) => [d, halves]));

describe('Espace propriétaire : démarrer de zéro comme un nouvel utilisateur (secteur quelconque)', () => {
  it('T78 espace vierge : une seule personne (le propriétaire admin), qualifications neutres, aucune période propre à un secteur', async () => {
    const login = await raw('/api/owner/login', '', 'POST', { password: PASSWORD });
    ownerCookie = `${OWNER_COOKIE}=${ck(login, OWNER_COOKIE)}`;
    const boot = await j(await raw('/api/bootstrap', ownerCookie));
    expect(boot.employees.map((e: any) => e.id)).toEqual(['emp-owner']);
    expect(boot.owner).toMatchObject({ authenticated: true, blank: true });
    expect(boot.live).toBe(true);
    const admin = await as('emp-owner');
    const cfg = await j(await raw('/api/config', admin));
    expect(cfg.qualifications.map((q: any) => q.code)).toEqual(['qualified', 'staff', 'trainee', 'admin']);
    expect(cfg.rules.internal.blackouts).toEqual([]);
    expect(cfg.rules.internal.closures).toEqual([]);
    expect(cfg.rules.internal.deadlines).toEqual([]);
    expect((await j(await raw('/api/decisions', admin))).length).toBe(0);
    expect(boot.employees.length).toBeLessThan(publicStore.state.employees.length); // la démo publique n'est pas touchée
  });

  it('T79 configuration réservée à l\'espace propriétaire et à l\'admin : la démo publique et les autres rôles sont refusés', async () => {
    const pubS = await raw('/api/session', '', 'POST', { userId: 'emp-paul' });
    const pubAdmin = `${SESSION_COOKIE}=${ck(pubS, SESSION_COOKIE)}`;
    for (const [p, m] of [['/api/config', 'GET'], ['/api/org', 'PUT'], ['/api/qualifications', 'PUT'], ['/api/employees', 'POST']] as const) {
      const r = await raw(p, pubAdmin, m, m === 'GET' ? undefined : {});
      expect(r.status, `public ${m} ${p} ${JSON.stringify(await r.clone().json())}`).toBe(403);
    }
    // dans l'espace propriétaire, un employé ordinaire ne configure rien
    await raw('/api/employees', await as('emp-owner'), 'POST', { name: 'Test Employé', startDate: '2026-01-01', qualifications: ['staff'] });
    const id = ownerStore.state.employees.at(-1)!.id;
    expect((await raw('/api/config', await as(id))).status).toBe(403);
    await raw(`/api/employees/${id}`, await as('emp-owner'), 'DELETE');
  });

  it('T80 qualifications : validées, renommables, et jamais supprimées si une personne les porte', async () => {
    const admin = await as('emp-owner');
    const q = (over: object[]) => raw('/api/qualifications', admin, 'PUT', { qualifications: over });
    const base = [
      { code: 'chef_equipe', label: 'Chef·fe d\'équipe', canOpen: true, countsAsQualified: true, mustBeSupervised: false, canReplace: ['chef_equipe', 'operateur', 'admin'] },
      { code: 'operateur', label: 'Opérateur·trice', canOpen: false, countsAsQualified: false, mustBeSupervised: false, canReplace: ['operateur'] },
      { code: 'apprenti', label: 'Apprenti·e', canOpen: false, countsAsQualified: false, mustBeSupervised: true, canReplace: [] },
      { code: 'admin', label: 'Administration', canOpen: false, countsAsQualified: false, mustBeSupervised: false, canReplace: ['admin'] },
    ];
    expect((await q([base[0], { ...base[0] }])).status).toBe(400);               // code en double
    expect((await q([{ ...base[0], code: 'a b' }])).status).toBe(400);            // identifiant invalide
    expect((await q([{ ...base[0], canOpen: 'oui' }])).status).toBe(400);         // booléen invalide
    expect((await q([])).status).toBe(400);
    expect((await q([base[0], base[1], base[2]])).status).toBe(422);              // « admin » porté par le propriétaire
    const ok = await q(base);
    expect(ok.status).toBe(200);
    expect(ownerStore.state.qualifications.map((x) => x.code)).toEqual(['chef_equipe', 'operateur', 'apprenti', 'admin']);
    expect(ownerStore.state.audit.some((a) => a.action === 'config.qualifications')).toBe(true);
  });

  it('T81 équipe : ajout, validation stricte, modification, suppression protégée', async () => {
    const admin = await as('emp-owner');
    const add = (o: object) => raw('/api/employees', admin, 'POST', o);
    const good = { name: 'Camille Roux', status: 'manager', role: 'manager', qualifications: ['chef_equipe'], occupancy: 1, schedule: week([1, 2, 3, 4, 5]), startDate: '2026-01-01', managerIds: ['emp-owner'] };
    expect((await add({ ...good, name: '' })).status).toBe(400);
    expect((await add({ ...good, qualifications: ['pharmacien'] })).status).toBe(400);       // qualification inconnue
    expect((await add({ ...good, schedule: { 7: ['AM'] } })).status).toBe(400);              // dimanche non géré
    expect((await add({ ...good, schedule: { 1: ['MATIN'] } })).status).toBe(400);
    expect((await add({ ...good, occupancy: 2 })).status).toBe(400);
    expect((await add({ ...good, startDate: '2026-13-01' })).status).toBe(400);
    expect((await add({ ...good, managerIds: ['emp-fantome'] })).status).toBe(400);
    expect((await add({ ...good, role: 'superuser' })).status).toBe(400);
    const created = await add(good);
    expect(created.status).toBe(201);
    const camille = (await j(created)).id;
    const list = (await j(await raw('/api/bootstrap', ownerCookie))).employees.map((e: any) => e.name);
    expect(list).toContain('Camille Roux');
    const upd = await raw(`/api/employees/${camille}`, admin, 'PUT', { ...good, name: 'Camille Roux-Martin', occupancy: 0.8 });
    expect(upd.status).toBe(200);
    expect(ownerStore.state.employees.find((e) => e.id === camille)!.occupancy).toBe(0.8);
    // le propriétaire ne peut ni se retirer ni perdre son rôle admin
    expect((await raw('/api/employees/emp-owner', admin, 'DELETE')).status).toBe(422);
    await raw('/api/employees/emp-owner', admin, 'PUT', { name: 'Moi', role: 'employee', startDate: '2000-01-01', qualifications: ['admin'] });
    expect(ownerStore.state.employees.find((e) => e.id === 'emp-owner')!.role).toBe('admin');
    expect(ownerStore.state.audit.filter((a) => a.action.startsWith('config.employee')).length).toBeGreaterThanOrEqual(2);
  });

  it('T82 parcours complet d\'un nouveau secteur (atelier) : équipe, couverture, demande, tri, absence imprévue, remplaçant', async () => {
    const admin = await as('emp-owner');
    await raw('/api/org', admin, 'PUT', { name: 'Atelier Exemple', sector: 'artisanat' });
    expect((await j(await raw('/api/bootstrap', ownerCookie))).org).toEqual({ name: 'Atelier Exemple', sector: 'artisanat' });
    const camille = ownerStore.state.employees.find((e) => e.name.startsWith('Camille'))!.id;
    const mk = async (o: object) => (await j(await raw('/api/employees', admin, 'POST', { startDate: '2025-01-01', managerIds: [camille], ...o }))).id as string;
    const chef2 = await mk({ name: 'Dominique Faure', qualifications: ['chef_equipe'], schedule: week([2, 4]), occupancy: 0.4 });
    const op1 = await mk({ name: 'Alex Pittet', qualifications: ['operateur'], schedule: week([1, 2, 3, 4, 5]) });
    await mk({ name: 'Sam Girard', qualifications: ['operateur'], schedule: week([1, 2, 3, 4, 5]) });
    await mk({ name: 'Robin Aebi', qualifications: ['apprenti'], status: 'apprentice', schedule: week([1, 3]), birthDate: '2008-05-05' });
    // règle de couverture propre à l'atelier : un·e chef·fe d'équipe + 3 personnes minimum, 1 absent à la fois
    const put = await raw('/api/rules', admin, 'PUT', { effectiveFrom: '2026-01-01', coverage: { minQualified: 1, minHeadcount: 2, maxSimultaneousAbsent: 1 }, opening: { weekdays: [1, 2, 3, 4, 5], saturdayHalves: [] } });
    expect(put.status).toBe(200);
    // le·la seul·e chef·fe présent·e un lundi demande un congé : impossible, avec motif générique (pas de « pharmacien »)
    const camilleCk = await as(camille);
    const r = await raw('/api/requests', camilleCk, 'POST', { type: 'vacation', start: '2026-07-06', end: '2026-07-06' });
    expect(r.status).toBe(201);
    const ds = await j(await raw('/api/triage', admin, 'POST', {}));
    const d = ds.find((x: any) => x.requestId === (ownerStore.state.absences.at(-1)!.id));
    expect(d.outcome).toBe('impossible');
    const text = d.reasonsText.map((x: any) => x.text).join(' ');
    expect(text).toMatch(/personne qualifiée/);
    expect(text).not.toMatch(/pharmacien/i);
    // un mardi, Dominique (chef·fe à 40 %) couvre : la même demande est acceptable
    const r2 = await raw('/api/requests', camilleCk, 'POST', { type: 'vacation', start: '2026-07-07', end: '2026-07-07' });
    expect(r2.status).toBe(201);
    const ds2 = await j(await raw('/api/triage', admin, 'POST', {}));
    expect(ds2.find((x: any) => x.requestId === ownerStore.state.absences.at(-1)!.id).outcome).toBe('approve');
    // absence imprévue de Camille un lundi : le besoin « qualification requise » classe Dominique (chef·fe disponible), jamais l'apprenti
    const sick = await raw('/api/unplanned', admin, 'POST', { employeeId: camille, date: '2026-06-08', halves: ['AM', 'PM'], type: 'sickness' });
    expect(sick.status).toBe(201);
    const body = await j(sick);
    expect(body.needs[0].qualification).toBe('critical');
    expect(body.offers[0].result.offered).toBe(chef2);
    expect(op1).toBeTruthy();
  });

  it('T83 horloge : réelle par défaut dans l\'espace vierge, simulée à la demande, retour à l\'heure réelle ; réinitialisation vierge ou démo', async () => {
    const admin = await as('emp-owner');
    expect((await j(await raw('/api/clock', admin, 'POST', { now: '2026-09-01T09:00' })))).toMatchObject({ now: '2026-09-01T09:00', live: false });
    expect(ownerStore.live).toBe(false);
    expect((await j(await raw('/api/clock', admin, 'POST', { live: true })))).toMatchObject({ live: true, now: '2026-06-01T08:00' });
    expect((await raw('/api/owner/reset', ownerCookie, 'POST', { mode: 'inconnu' })).status).toBe(400);
    expect((await raw('/api/owner/reset', ownerCookie, 'POST', { mode: 'demo' })).status).toBe(200);
    expect(ownerStore.state.employees.length).toBe(8);
    expect(ownerStore.live).toBe(false);
    expect((await raw('/api/owner/reset', ownerCookie, 'POST', {})).status).toBe(200);
    expect(ownerStore.state.employees.map((e) => e.id)).toEqual(['emp-owner']);
    expect(ownerStore.live).toBe(true);
  });
});
