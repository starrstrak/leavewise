import { request } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, loadStore, writeFileAtomic } from '../src/server.js';
import { buildDemoState, DEMO_NOW } from '../../demo/seed.js';

const dir = mkdtempSync(join(tmpdir(), 'lw-api-'));
const stateFile = join(dir, 'state.json');
const store = { state: buildDemoState(), now: DEMO_NOW };
const server = createApp(store, stateFile, { secret: 'c'.repeat(64) });
server.listen(0);
const port = () => (server.address() as AddressInfo).port;
const base = () => `http://127.0.0.1:${port()}`;
afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const cookies = new Map<string, string>();
async function login(user: string) {
  if (!cookies.has(user)) {
    const r = await fetch(base() + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: user }) });
    cookies.set(user, r.headers.get('set-cookie')!.split(';')[0]);
  }
  return cookies.get(user)!;
}
async function call(path: string, user: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base() + path, { method, headers: { cookie: await login(user), 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const valid = { type: 'vacation', start: '2026-09-07', end: '2026-09-08' };

describe('API : entrées invalides => erreurs 4xx claires', () => {
  it('T59 JSON invalide, corps non objet, type de contenu : 400 / 415 avec code stable, sans fuite d\'exception', async () => {
    const bad = await call('/api/requests', 'emp-lea', 'POST', '{"type": ');
    expect(bad).toMatchObject({ status: 400, body: { error: 'invalid_json' } });
    expect(JSON.stringify(bad.body)).not.toMatch(/Unexpected|position/);
    expect(await call('/api/requests', 'emp-lea', 'POST', '[1,2]')).toMatchObject({ status: 400, body: { error: 'body_must_be_object' } });
    expect(await call('/api/requests', 'emp-lea', 'POST', 'null')).toMatchObject({ status: 400, body: { error: 'body_must_be_object' } });
    expect(await call('/api/requests', 'emp-lea', 'POST', JSON.stringify(valid), { 'content-type': 'text/plain' })).toMatchObject({ status: 415, body: { error: 'unsupported_media_type' } });
  });

  it('T60 limite de taille : 413 si Content-Length dépasse, et aussi en transfert fragmenté sans Content-Length', async () => {
    const big = JSON.stringify({ ...valid, justification: 'x'.repeat(70 * 1024) });
    expect(await call('/api/requests', 'emp-lea', 'POST', big)).toMatchObject({ status: 413, body: { error: 'payload_too_large' } });
    const status = await new Promise<number>((resolve) => {
      const r = request({ host: '127.0.0.1', port: port(), path: '/api/requests', method: 'POST', headers: { cookie: cookies.get('emp-lea')!, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      r.on('error', () => resolve(-1));
      r.write('{"justification":"'); r.write('y'.repeat(40 * 1024)); r.write('y'.repeat(40 * 1024)); r.end('"}');
    });
    expect(status).toBe(413);
    expect((await call('/api/me', 'emp-lea')).status).toBe(200); // le serveur reste utilisable
  });

  it('T61 dates : format, calendrier réel, bornes, ordre', async () => {
    for (const start of ['2026-02-30', '2026-13-01', '26-01-01', '', 20260907, null, '2026-09-07T10:00', '1999-12-31', '2101-01-01']) {
      const r = await call('/api/requests', 'emp-lea', 'POST', { ...valid, start });
      expect(r.status).toBe(400);
      expect(r.body.field).toBe('start');
      expect(['invalid_date', 'date_out_of_range']).toContain(r.body.error);
    }
    expect(await call('/api/requests', 'emp-lea', 'POST', { ...valid, end: '2026-09-01' })).toMatchObject({ status: 422, body: { error: 'invalid_dates' } });
    expect((await call('/api/clock', 'emp-paul', 'POST', { now: '2026-05-01 09:00' })).body).toMatchObject({ error: 'invalid_datetime', field: 'now' });
    expect((await call('/api/clock', 'emp-paul', 'POST', { now: '2026-05-01T25:00' })).status).toBe(400);
    expect((await call('/api/clock', 'emp-paul', 'POST', { now: '2026-05-01T09:00' })).status).toBe(200);
    expect((await call('/api/clock', 'emp-paul', 'POST', { now: DEMO_NOW })).status).toBe(200);
  });

  it('T62 énumérations et types : type d\'absence, demi-journée, action, booléens, déclaration imprévue limitée à maladie/accident', async () => {
    expect((await call('/api/requests', 'emp-lea', 'POST', { ...valid, type: 'bogus' })).body).toMatchObject({ error: 'invalid_value', field: 'type' });
    expect((await call('/api/requests', 'emp-lea', 'POST', { ...valid, startHalf: 'XX' })).body).toMatchObject({ error: 'invalid_value', field: 'startHalf' });
    expect((await call('/api/requests', 'emp-lea', 'POST', { ...valid, urgent: 'oui' })).body).toMatchObject({ error: 'invalid_boolean', field: 'urgent' });
    expect((await call('/api/requests', 'emp-lea', 'POST', { ...valid, employeeId: '../x' })).body).toMatchObject({ error: 'invalid_id', field: 'employeeId' });
    // trou d'autorisation fermé : une « déclaration imprévue » ne peut pas créer des vacances approuvées d'office
    const sneaky = await call('/api/unplanned', 'emp-lea', 'POST', { employeeId: 'emp-lea', date: '2026-06-02', type: 'vacation' });
    expect(sneaky).toMatchObject({ status: 400, body: { error: 'invalid_value', field: 'type' } });
    expect((await call('/api/unplanned', 'emp-lea', 'POST', { employeeId: 'emp-lea', date: '2026-06-02', halves: ['AM', 'AM'] })).status).toBe(400);
    expect((await call('/api/decisions/override', 'emp-claire', 'POST', { requestId: 'R0001', action: 'delete', reason: 'x' })).body).toMatchObject({ error: 'invalid_value', field: 'action' });
    expect((await call('/api/consent', 'emp-lea', 'POST', { consent: true, childrenUnder12: -1 })).body).toMatchObject({ error: 'invalid_number', field: 'childrenUnder12' });
  });

  it('T63 tailles : texte, listes, identifiants ; requête valide acceptée (201)', async () => {
    expect((await call('/api/requests', 'emp-lea', 'POST', { ...valid, justification: 'x'.repeat(501) })).body).toMatchObject({ error: 'text_too_long', field: 'justification' });
    expect((await call('/api/decisions/validate', 'emp-claire', 'POST', { ids: Array.from({ length: 201 }, (_, i) => `D${i}`) })).body).toMatchObject({ error: 'invalid_list' });
    expect((await call('/api/decisions/validate', 'emp-claire', 'POST', { ids: [1] })).body).toMatchObject({ error: 'invalid_id' });
    expect((await call('/api/requests/' + 'R'.repeat(80) + '/withdraw', 'emp-lea', 'POST', {})).body).toMatchObject({ error: 'invalid_id' });
    expect((await call('/api/requests', 'emp-lea', 'POST', { ...valid, justification: 'x'.repeat(500) })).status).toBe(201);
  });

  it('T64 paramètres d\'URL : langue en liste blanche (aucune lecture de fichier arbitraire), plage de couverture bornée', async () => {
    const leak = await fetch(base() + '/api/locale?lng=../../package');
    expect(leak.status).toBe(400);
    expect(await leak.text()).not.toMatch(/leavewise-proto/);
    expect((await fetch(base() + '/api/locale?lng=de')).status).toBe(200);
    expect((await fetch(base() + '/api/locale')).status).toBe(200);
    expect((await call('/api/coverage?from=2026-06-10&to=2026-06-01', 'emp-lea')).body).toMatchObject({ error: 'invalid_range' });
    expect((await call('/api/coverage?from=2026-01-01&to=2026-12-31', 'emp-lea')).body).toMatchObject({ error: 'range_too_long' });
    expect((await call('/api/coverage?from=nope', 'emp-lea')).body).toMatchObject({ error: 'invalid_date', field: 'from' });
    expect((await call('/api/coverage?from=2026-06-01&to=2026-06-14', 'emp-lea')).status).toBe(200);
  });

  it('T65 règlement : champs inconnus, nombres négatifs ou démesurés, date invalide refusés ; valeur correcte versionnée', async () => {
    const n = store.state.rulesVersions.length;
    expect((await call('/api/rules', 'emp-paul', 'PUT', { effectiveFrom: 'demain' })).body).toMatchObject({ error: 'invalid_date', field: 'effectiveFrom' });
    expect((await call('/api/rules', 'emp-paul', 'PUT', { effectiveFrom: '2026-07-01', version: 'v999' })).body).toMatchObject({ error: 'unknown_field', field: 'version' });
    expect((await call('/api/rules', 'emp-paul', 'PUT', { effectiveFrom: '2026-07-01', legal: { weeklyRestHours: -5 } })).body.error).toBe('invalid_number');
    expect((await call('/api/rules', 'emp-paul', 'PUT', { effectiveFrom: '2026-07-01', coverage: { minQualified: 1e9 } })).body.error).toBe('invalid_number');
    expect((await call('/api/rules', 'emp-paul', 'PUT', { effectiveFrom: '2026-07-01', priority: { weights: { equity: 0, rotation: 0, urgency: 0, order: 0, family: 0 } } })).body.error).toBe('invalid_value');
    expect(store.state.rulesVersions.length).toBe(n);
    const ok = await call('/api/rules', 'emp-paul', 'PUT', { effectiveFrom: '2026-07-01', holidays: [{ id: 'good_friday', easter: -2 }] });
    expect(ok.status).toBe(200);
    expect(store.state.rulesVersions.length).toBe(n + 1);
  });
});

describe('Persistance : écriture atomique et état illisible', () => {
  it('T66 après une requête, le fichier d\'état est complet et aucun fichier temporaire ne reste', async () => {
    await call('/api/requests', 'emp-sofia', 'POST', { type: 'vacation', start: '2026-10-05', end: '2026-10-06' });
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
    expect(saved.state.absences.some((a: any) => a.employeeId === 'emp-sofia' && a.start === '2026-10-05')).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('T67 une écriture qui échoue laisse l\'ancien contenu intact et ne laisse pas de fichier temporaire', () => {
    const f = join(dir, 'atomic.json');
    writeFileAtomic(f, '{"v":1}');
    expect(() => writeFileAtomic(f, 123 as unknown as string)).toThrow();
    expect(readFileSync(f, 'utf8')).toBe('{"v":1}');
    expect(readdirSync(dir).filter((x) => x.endsWith('.tmp'))).toEqual([]);
    writeFileAtomic(f, '{"v":2}');
    expect(readFileSync(f, 'utf8')).toBe('{"v":2}');
  });

  it('T68 fichier d\'état illisible ou de forme invalide : conservé à côté (.corrupt-*), la démo repart des données fictives', () => {
    for (const [name, content] of [['garbage.json', '{{{ pas du json'], ['shape.json', '{"state":{"employees":"non"},"now":1}']]) {
      const f = join(dir, name);
      writeFileSync(f, content);
      const st = loadStore(f);
      expect(st.state.employees.length).toBeGreaterThan(5);
      expect(existsSync(f)).toBe(false);
      const kept = readdirSync(dir).filter((x) => x.startsWith(name + '.corrupt-'));
      expect(kept.length).toBe(1);
      expect(readFileSync(join(dir, kept[0]), 'utf8')).toBe(content);
    }
    const good = join(dir, 'good.json');
    writeFileAtomic(good, JSON.stringify({ state: buildDemoState(), now: '2026-01-01T08:00' }));
    expect(loadStore(good).now).toBe('2026-01-01T08:00');
  });
});
