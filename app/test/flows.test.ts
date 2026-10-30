import { afterAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import {
  autoValidate, declareUnplanned, offerNext, overrideDecision, respondOffer, runTriage, tick, validateDecisions, DomainError,
} from '../src/actions.js';
import { activeAbsences, makeCtx, violations } from '../src/coverage.js';
import { slotsOf } from '../src/calendar.js';
import { createApp } from '../src/server.js';
import { buildDemoState, DEMO_NOW } from '../../demo/seed.js';
import { codes, fresh, NOW, req, triage } from './helpers.js';

describe('Tri par lot, ajustement humain, cascade', () => {
  it('T26 une décision « impossible » ne se valide pas en lot ; le forçage exige un motif', () => {
    const s = fresh();
    req(s, 'emp-claire', '2026-07-06', '2026-07-06');
    runTriage(s, NOW);
    const out = validateDecisions(s, [s.decisions[0].id], 'emp-paul', NOW);
    expect(out.skipped).toEqual([{ id: s.decisions[0].id, code: 'impossible_needs_override' }]);
    expect(() => overrideDecision(s, { requestId: s.absences[0].id, action: 'approve', reason: '  ', actor: 'emp-paul' }, NOW)).toThrow(DomainError);
    expect(s.absences[0].status).toBe('submitted');
  });

  it('T27 lot : validation de plusieurs décisions ; l\'employé n\'est notifié qu\'après validation', () => {
    const s = fresh();
    const a = req(s, 'emp-lea', '2026-09-07', '2026-09-08');
    const b = req(s, 'emp-sofia', '2026-09-14', '2026-09-15');
    const ds = runTriage(s, NOW);
    expect(s.notifications.filter((n) => n.kind === 'request_approved').length).toBe(0);
    const out = validateDecisions(s, ds.map((d) => d.id), 'emp-claire', NOW);
    expect(out.done.length).toBe(2);
    expect(s.notifications.filter((n) => n.kind === 'request_approved' && n.channel === 'inapp').map((n) => n.to).sort()).toEqual(['emp-lea', 'emp-sofia']);
    expect([a, b].every((r) => s.absences.find((x) => x.id === r.id)!.status === 'approved')).toBe(true);
    expect(s.audit.filter((x) => x.action === 'decision.validated').every((x) => x.actor === 'emp-claire')).toBe(true);
  });

  it('T28 ajustement humain : aperçu puis application, cascade recalculée et affichée', () => {
    const s = fresh();
    for (const y of [2024, 2025]) {
      s.peakHistory.push({ employeeId: 'emp-claire', year: y, peakId: 'summer', requested: true, granted: true });
      s.peakHistory.push({ employeeId: 'emp-luc', year: y, peakId: 'summer', requested: true, granted: false });
    }
    const luc = req(s, 'emp-luc', '2026-07-08', '2026-07-08', '2026-04-14T08:00');
    const claire = req(s, 'emp-claire', '2026-07-08', '2026-07-08', '2026-04-15T08:00', { endHalf: 'AM' }); // matin seulement
    const before = triage(s);
    expect(before.get(claire.id)!.outcome).toBe('impossible');
    const input = { requestId: luc.id, action: 'refuse' as const, reason: 'Luc doit rester : formation interne', actor: 'emp-claire' };
    const preview = overrideDecision(s, input, NOW, true) as any;
    expect(preview.changes).toEqual([{ requestId: claire.id, from: 'impossible', to: 'approve', codes: [] }]);
    expect(s.absences.find((a) => a.id === luc.id)!.status).toBe('submitted'); // aperçu : rien n'est modifié
    overrideDecision(s, input, NOW);
    expect(s.absences.find((a) => a.id === luc.id)!.status).toBe('refused');
    expect(s.decisions.find((d) => d.requestId === claire.id && d.status === 'proposed')!.outcome).toBe('approve');
    expect(s.audit.some((a) => a.action === 'cascade.changed' && a.entityId === claire.id)).toBe(true);
    expect(s.audit.find((a) => a.action === 'decision.refuse')!.justification).toMatch(/formation/);
  });

  it('T29 mode automatique : seules les demandes à risque nul sont validées, et seulement si l\'admin l\'active', () => {
    const s = fresh();
    req(s, 'emp-lea', '2026-09-07', '2026-09-08'); // risque nul (couverture large)
    req(s, 'emp-claire', '2026-09-09', '2026-09-09'); // mercredi : Luc matin seulement -> trou du PM
    runTriage(s, NOW);
    expect(autoValidate(s, NOW).done).toEqual([]);
    s.rulesVersions[0].automation.autoApproveZeroRisk = true;
    const out = autoValidate(s, NOW);
    expect(out.done.length).toBe(1);
    const d = s.decisions.find((x) => x.id === out.done[0])!;
    expect(d.risk).toBe('zero');
    expect(d.author).toBe('system:auto');
    expect(s.absences.find((a) => a.id === d.requestId)!.employeeId).toBe('emp-lea');
  });

  it('T30 remplacement : accepter comble le trou ; refuser passe au suivant ; relance puis expiration', () => {
    const s = fresh();
    const res = declareUnplanned(s, { employeeId: 'emp-claire', date: '2026-06-01' }, 'emp-claire', '2026-06-01T07:00');
    const rr = res.needs[0];
    expect(rr.offers[0]).toMatchObject({ candidateId: 'emp-hugo', status: 'pending' });
    // 30 min sans réponse : relance, puis 30 min : expiration et offre suivante
    expect(tick(s, '2026-06-01T07:30')).toEqual([`reminder:${rr.id}:emp-hugo`]);
    expect(tick(s, '2026-06-01T08:00')).toEqual([`expired:${rr.id}:emp-hugo`]);
    expect(rr.offers.map((o) => [o.candidateId, o.status])).toEqual([['emp-hugo', 'expired'], ['emp-luc', 'pending']]);
    respondOffer(s, rr.id, 'emp-luc', true, '2026-06-01T08:05');
    expect(rr.status).toBe('filled');
    const ctx = makeCtx(s, s.rulesVersions[0]);
    expect(violations(slotsOf('2026-06-01', 'AM', '2026-06-01', 'PM'), ctx, activeAbsences(ctx))).toEqual([]);
    // refus : on passe au candidat suivant puis escalade quand il n'y en a plus
    const s2 = fresh();
    const r2 = declareUnplanned(s2, { employeeId: 'emp-claire', date: '2026-06-01' }, 'emp-claire', '2026-06-01T07:00').needs[0];
    const next = respondOffer(s2, r2.id, 'emp-hugo', false, '2026-06-01T07:05') as any;
    expect(next.offered).toBe('emp-luc');
    const last = respondOffer(s2, r2.id, 'emp-luc', false, '2026-06-01T07:10') as any;
    expect(last.escalated).toBe(1);
    expect(() => offerNext(s2, 'P9999', NOW)).toThrow();
  });

  it('T31 données de démo : tri complet, chaque décision est justifiée', () => {
    const s = buildDemoState();
    const ds = runTriage(s, DEMO_NOW);
    expect(ds.length).toBe(6);
    expect(ds.every((d) => d.reasons.length > 0 && d.score)).toBe(true);
    expect(ds.some((d) => d.outcome === 'impossible')).toBe(true);
    expect(ds.some((d) => d.outcome === 'approve')).toBe(true);
    expect(s.audit.filter((a) => a.action === 'decision.proposed').length).toBe(6);
  });
});

describe('Séparation des rôles', () => {
  it('T36 nul ne décide de sa propre demande (validation ou forçage)', () => {
    const s = fresh();
    const r = req(s, 'emp-claire', '2026-09-10', '2026-09-10'); // jeudi : Luc couvre
    runTriage(s, NOW);
    expect(validateDecisions(s, [s.decisions[0].id], 'emp-claire', NOW).skipped[0].code).toBe('self_decision_forbidden');
    expect(() => overrideDecision(s, { requestId: r.id, action: 'approve', reason: 'x', actor: 'emp-claire' }, NOW)).toThrow(/self_decision_forbidden/);
    expect(validateDecisions(s, [s.decisions[0].id], 'emp-paul', NOW).done.length).toBe(1); // son manager (gérant) peut
  });
});

describe('API : droits par rôle et confidentialité', () => {
  const store = { state: buildDemoState(), now: DEMO_NOW };
  const server = createApp(store, null);
  server.listen(0);
  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, user: string, method = 'GET', body?: unknown) => {
    const r = await fetch(base() + path, { method, headers: { 'x-user': user, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
  };
  afterAll(() => { server.close(); });

  it('T32 un·e employé·e ne voit ni la file de tri ni les données des collègues', async () => {
    expect((await call('/api/decisions', 'emp-lea')).status).toBe(403);
    expect((await call('/api/audit', 'emp-lea')).status).toBe(403);
    expect((await call('/api/triage', 'emp-lea', 'POST')).status).toBe(403);
    const mine = await call('/api/requests', 'emp-lea');
    expect(mine.status).toBe(200);
    expect(new Set(mine.body.requests.map((r: any) => r.employeeId))).toEqual(new Set(['emp-lea']));
    expect(mine.body.balances.length).toBe(1);
    expect((await call('/api/me', 'unknown')).status).toBe(401);
  });

  it('T33 manager : tri, justifications en français, score sans critère sensible ; RH voit le critère', async () => {
    store.state.rulesVersions[0].priority.sensitiveEnabled = true;
    store.state.sensitive = [{ employeeId: 'emp-sofia', consent: true, childrenUnder12: 2, consentDate: '2026-04-01', retentionUntil: '2027-04-01' }];
    const m = await call('/api/triage', 'emp-claire', 'POST', {});
    expect(m.status).toBe(200);
    const sofia = m.body.find((d: any) => d.requestId === 'R0003');
    expect(sofia.score.family).toBe(0);
    expect(sofia.score.familyActive).toBe(false);
    expect(sofia.reasonsText.length).toBeGreaterThan(0);
    const hr = await call('/api/decisions', 'emp-paul');
    expect(hr.body.find((d: any) => d.requestId === 'R0003').score.family).toBeGreaterThan(0);
    const mgrCons = JSON.stringify(m.body);
    expect(mgrCons).not.toMatch(/childrenUnder12/);
  });

  it('T34 exports réservés RH/admin ; audit horodaté et signé', async () => {
    expect((await call('/api/export/audit.csv', 'emp-claire')).status).toBe(403);
    const ok = await call('/api/export/audit.csv', 'emp-paul');
    expect(ok.status).toBe(200);
    expect(ok.body.split('\n')[0]).toBe('id,ts,actor,action,entityId,justification,before,after');
    expect((await call('/api/export/balances.csv', 'emp-paul')).body).toMatch(/Claire Morel/);
    expect((await call('/api/clock', 'emp-claire', 'POST', { now: '2026-05-01T09:00' })).status).toBe(403);
  });

  it('T35 règlement modifiable par l\'admin seulement, nouvelle version tracée', async () => {
    expect((await call('/api/rules', 'emp-claire', 'PUT', { effectiveFrom: '2026-06-01' })).status).toBe(403);
    const ok = await call('/api/rules', 'emp-paul', 'PUT', { effectiveFrom: '2026-06-01', internal: { ...store.state.rulesVersions[0].internal, minNoticeDays: 21 } });
    expect(ok.status).toBe(200);
    expect(store.state.rulesVersions.length).toBe(2);
    expect(store.state.audit.some((a) => a.action === 'rules.changed')).toBe(true);
  });
});

void codes;
