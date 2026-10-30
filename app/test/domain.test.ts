import { describe, expect, it } from 'vitest';
import {
  addRulesVersion, approversFor, decideCancellation, declareUnplanned, offerNext, planBImpact, requestCancellation,
  runTriage, validateDecisions, applyPlanB, overrideDecision,
} from '../src/actions.js';
import { balanceOf, countAbsenceDays, entitlementDays } from '../src/balance.js';
import { makeCalendar, easter, slotsOf } from '../src/calendar.js';
import { coverOfSlot, makeCtx, violations, activeAbsences } from '../src/coverage.js';
import { rankCandidates } from '../src/replacement.js';
import { rulesAt } from '../src/rules.js';
import { codes, emp, fresh, NOW, req, triage } from './helpers.js';
import type { Absence } from '../src/types.js';

const rulesOf = (s: ReturnType<typeof fresh>) => s.rulesVersions[0];

describe('Triage: couverture et conflits', () => {
  it('T01 demandes simultanées sur la même période : une seule accordée, l\'autre « impossible » avec concurrent cité', () => {
    const s = fresh();
    rulesOf(s).coverage.maxSimultaneousAbsent = 1;
    const a = req(s, 'emp-sofia', '2026-07-13', '2026-07-17', '2026-04-14T08:00');
    const b = req(s, 'emp-lea', '2026-07-13', '2026-07-17', '2026-04-15T08:00');
    const d = triage(s);
    const outcomes = [d.get(a.id)!.outcome, d.get(b.id)!.outcome].sort();
    expect(outcomes).toEqual(['approve', 'impossible']);
    const loser = [...d.values()].find((x) => x.outcome === 'impossible')!;
    const winner = [...d.values()].find((x) => x.outcome === 'approve')!;
    expect(codes(loser, 'block')).toContain('coverage_max_absent');
    expect(codes(loser)).toContain('competing_request');
    expect(winner.score!.total).toBeGreaterThanOrEqual(loser.score!.total);
  });

  it('T02 seul pharmacien du jour absent : impossible, raison de couverture et alternative « remplaçant »', () => {
    const s = fresh();
    const r = req(s, 'emp-claire', '2026-07-06', '2026-07-06'); // lundi : Luc ne travaille pas
    const d = triage(s).get(r.id)!;
    expect(d.outcome).toBe('impossible');
    expect(codes(d, 'block')).toContain('coverage_pharmacist');
    const alt = d.alternatives.find((a) => a.kind === 'replacement');
    expect(alt?.params.candidate).toBe('Hugo Baeriswyl');
  });

  it('T03 deux pharmaciens, même jour : la rotation (refus passés en été) départage', () => {
    const s = fresh();
    for (const y of [2024, 2025]) {
      s.peakHistory.push({ employeeId: 'emp-claire', year: y, peakId: 'summer', requested: true, granted: true });
      s.peakHistory.push({ employeeId: 'emp-luc', year: y, peakId: 'summer', requested: true, granted: false });
    }
    const luc = req(s, 'emp-luc', '2026-07-08', '2026-07-08', '2026-04-14T08:00');
    const claire = req(s, 'emp-claire', '2026-07-08', '2026-07-08', '2026-04-15T08:00', { endHalf: 'AM' }); // matin seulement
    const d = triage(s);
    expect(d.get(luc.id)!.outcome).toBe('approve');
    expect(d.get(claire.id)!.outcome).toBe('impossible');
    expect(d.get(luc.id)!.score!.rotation).toBeGreaterThan(d.get(claire.id)!.score!.rotation);
    expect(codes(d.get(claire.id)!)).toContain('competing_request');
  });

  it('T04 demi-journées : 0,5 jour déduit, et seules les demi-journées travaillées comptent', () => {
    const s = fresh();
    const cal = makeCalendar(rulesOf(s));
    const luc = emp(s, 'emp-luc');
    const mk = (start: string, end: string, sh: 'AM' | 'PM', eh: 'AM' | 'PM'): Absence => ({ id: 'x', employeeId: 'emp-luc', type: 'vacation', start, end, startHalf: sh, endHalf: eh, status: 'approved', submittedAt: NOW });
    expect(countAbsenceDays(luc, mk('2026-07-07', '2026-07-07', 'PM', 'PM'), cal, rulesOf(s), [])).toBe(0.5); // mardi PM
    expect(countAbsenceDays(luc, mk('2026-07-08', '2026-07-08', 'AM', 'PM'), cal, rulesOf(s), [])).toBe(0.5); // mercredi : seulement le matin travaillé
    expect(countAbsenceDays(luc, mk('2026-07-07', '2026-07-08', 'PM', 'AM'), cal, rulesOf(s), [])).toBe(1);   // mardi PM + mercredi AM
    expect(slotsOf('2026-07-07', 'PM', '2026-07-08', 'AM').length).toBe(2);
  });

  it('T05 jours fériés fribourgeois : non décomptés, selon la confession paramétrée', () => {
    const s = fresh();
    expect(easter(2026)).toBe('2026-04-05');
    const cal = makeCalendar(rulesOf(s));
    for (const d of ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-14', '2026-05-25', '2026-06-04', '2026-08-01', '2026-08-15', '2026-11-01', '2026-12-08', '2026-12-25'])
      expect(cal.isHoliday(d), d).toBe(true);
    const a: Absence = { id: 'x', employeeId: 'emp-claire', type: 'vacation', start: '2026-06-01', end: '2026-06-05', startHalf: 'AM', endHalf: 'PM', status: 'approved', submittedAt: NOW };
    expect(countAbsenceDays(emp(s, 'emp-claire'), a, cal, rulesOf(s), [])).toBe(4); // Fête-Dieu jeudi 4 juin
    const prot = { ...rulesOf(s), holidayScope: 'protestant' };
    expect(makeCalendar(prot).isHoliday('2026-06-04')).toBe(false);
    expect(countAbsenceDays(emp(s, 'emp-claire'), a, makeCalendar(prot), prot, [])).toBe(5);
  });

  it('T06 temps partiel : droit annuel au prorata du taux et protection des moins de 20 ans', () => {
    const s = fresh();
    const r = rulesOf(s);
    expect(entitlementDays(emp(s, 'emp-claire'), 2026, r)).toBe(20);  // 4 sem × 5 j
    expect(entitlementDays(emp(s, 'emp-luc'), 2026, r)).toBe(12);     // 4 sem × 3 j
    expect(entitlementDays(emp(s, 'emp-sofia'), 2026, r)).toBe(16);   // 4 sem × 4 j
    expect(entitlementDays(emp(s, 'emp-emma'), 2026, r)).toBe(15);    // 5 sem × 3 j (moins de 20 ans)
  });

  it('T07 entrée / sortie en cours d\'année, et passage du cap des 20 ans', () => {
    const s = fresh();
    const r = rulesOf(s);
    const base = { ...emp(s, 'emp-claire') };
    expect(entitlementDays({ ...base, startDate: '2026-07-01' }, 2026, r)).toBe(10);   // 184/365 × 20
    expect(entitlementDays({ ...base, endDate: '2026-03-31' }, 2026, r)).toBe(5);      // 90/365 × 20
    expect(entitlementDays({ ...base, startDate: '2027-01-01' }, 2026, r)).toBe(0);
    const turning20 = { ...emp(s, 'emp-emma'), birthDate: '2006-09-01' };
    expect(entitlementDays(turning20, 2026, r)).toBe(14);                               // 5 sem jusqu'au 31.8, 4 sem ensuite
  });

  it('T08 solde négatif : bloqué par défaut, toléré avec avertissement si le règlement l\'autorise', () => {
    const s = fresh();
    s.absences.push({ id: 'PRE', employeeId: 'emp-sofia', type: 'vacation', start: '2026-06-08', end: '2026-07-03', startHalf: 'AM', endHalf: 'PM', status: 'approved', submittedAt: '2026-01-10T09:00' });
    const r = req(s, 'emp-sofia', '2026-09-07', '2026-09-11'); // lun–jeu : 4 jours, solde 16 − 16 = 0
    let d = triage(s).get(r.id)!;
    expect(codes(d, 'block')).toContain('balance_negative');
    expect(d.outcome).toBe('impossible');
    rulesOf(s).internal.allowNegativeBalance = true;
    d = triage(s).get(r.id)!;
    expect(codes(d, 'warn')).toContain('balance_negative_allowed');
    expect(d.outcome).toBe('approve');
  });

  it('T09 report de solde : plafonné, consommé en premier, perdu après l\'échéance', () => {
    const s = fresh();
    const lea = emp(s, 'emp-lea');
    lea.carryOverDays = 8; // plafond du règlement : 5
    const cal = makeCalendar(rulesOf(s));
    const r = rulesOf(s);
    const taken: Absence = { id: 'T', employeeId: 'emp-lea', type: 'vacation', start: '2026-03-09', end: '2026-03-11', startHalf: 'AM', endHalf: 'PM', status: 'approved', submittedAt: '2026-01-05T09:00' };
    const ent = entitlementDays(lea, 2026, r); // 22
    const before = balanceOf(lea, 2026, '2026-03-01', [taken], cal, r);
    expect(before.closures).toBe(1 * 4);                 // fermeture collective de décembre, réservée sur le solde
    expect(before.remaining).toBe(ent + 5 - 3 - 4);
    const after = balanceOf(lea, 2026, '2026-04-15', [taken], cal, r);
    expect(after.carryOverForfeited).toBe(2);
    expect(after.remaining).toBe(ent - 4);  // 3 jours pris sur le report, 2 jours de report perdus, 4 jours de fermeture
  });

  it('T10 annulation après approbation : demande, validation, solde recrédité, remplacement annulé, tracé', () => {
    const s = fresh();
    const r = req(s, 'emp-claire', '2026-07-06', '2026-07-06');
    runTriage(s, NOW);
    // forcer l'approbation malgré le trou pour créer un besoin
    s.decisions[0].outcome = 'needs_replacement';
    validateDecisions(s, [s.decisions[0].id], 'emp-paul', NOW);
    expect(s.replacements.length).toBe(1);
    const cal = makeCalendar(rulesOf(s));
    const b1 = balanceOf(emp(s, 'emp-claire'), 2026, '2026-07-01', s.absences, cal, rulesOf(s)).taken;
    requestCancellation(s, r.id, 'emp-claire', '2026-04-22T10:00', 'imprévu');
    expect(s.absences[0].status).toBe('cancel_requested');
    // toujours compté dans la couverture tant que l'annulation n'est pas validée
    expect(balanceOf(emp(s, 'emp-claire'), 2026, '2026-07-01', s.absences, cal, rulesOf(s)).taken).toBe(b1);
    decideCancellation(s, r.id, true, 'emp-paul', '2026-04-22T11:00', 'ok');
    expect(s.absences[0].status).toBe('cancelled');
    expect(balanceOf(emp(s, 'emp-claire'), 2026, '2026-07-01', s.absences, cal, rulesOf(s)).taken).toBe(0);
    expect(s.replacements[0].status).toBe('void');
    expect(s.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['request.cancel_requested', 'request.cancelled']));
  });

  it('T11 maladie pendant des vacances approuvées : jours crédités si certificat', () => {
    const s = fresh();
    const v = req(s, 'emp-claire', '2026-06-15', '2026-06-19');
    s.absences[0].status = 'approved';
    const res = declareUnplanned(s, { employeeId: 'emp-claire', date: '2026-06-17', certificate: true }, 'emp-claire', '2026-06-17T07:30');
    expect(res.creditedVacation).toEqual([{ requestId: v.id, days: 1 }]);
    const cal = makeCalendar(rulesOf(s));
    expect(balanceOf(emp(s, 'emp-claire'), 2026, '2026-06-20', s.absences, cal, rulesOf(s)).taken).toBe(4);
    // sans certificat : pas de crédit
    const s2 = fresh();
    req(s2, 'emp-claire', '2026-06-15', '2026-06-19'); s2.absences[0].status = 'approved';
    expect(declareUnplanned(s2, { employeeId: 'emp-claire', date: '2026-06-17' }, 'emp-claire', '2026-06-17T07:30').creditedVacation).toEqual([]);
  });

  it('T12 maladie imprévue le matin même : alerte, besoin créé, offre immédiate au meilleur candidat', () => {
    const s = fresh();
    const res = declareUnplanned(s, { employeeId: 'emp-claire', date: '2026-06-01' }, 'emp-claire', '2026-06-01T07:30');
    expect(res.absence.status).toBe('approved');
    expect(res.needs.length).toBe(1);
    expect(res.needs[0].late).toBe(false);
    expect(res.needs[0].slots.length).toBe(2);
    expect(res.offers[0].result).toEqual({ offered: 'emp-hugo' });
    const to = s.notifications.filter((n) => n.kind === 'unplanned_absence' && n.channel === 'inapp').map((n) => n.to);
    expect(to).toContain('emp-paul');
    // déclaration après l'ouverture : marquée tardive
    const s2 = fresh();
    expect(declareUnplanned(s2, { employeeId: 'emp-claire', date: '2026-06-01' }, 'emp-claire', '2026-06-01T09:10').needs[0].late).toBe(true);
  });

  it('T13 remplaçant qualifié indisponible : escalade manager puis RH, plan B avec impact visible', () => {
    const s = fresh();
    emp(s, 'emp-hugo').unavailableDates = ['2026-06-01'];
    emp(s, 'emp-luc').unavailableDates = ['2026-06-01'];
    const res = declareUnplanned(s, { employeeId: 'emp-claire', date: '2026-06-01' }, 'emp-claire', '2026-06-01T07:30');
    const rr = res.needs[0];
    expect(res.offers[0].result).toMatchObject({ escalated: 1 });
    expect(rr.escalationLevel).toBe(1);
    const second = offerNext(s, rr.id, '2026-06-01T07:45') as any;
    expect(second.escalated).toBe(2);
    expect(s.notifications.some((n) => n.kind === 'replacement_escalated' && n.to === 'emp-paul')).toBe(true);
    const impact = planBImpact(s, rr, 'reduced_hours', '2026-06-01T07:45');
    expect(impact.closedHalfDays).toBe(2);
    const full = planBImpact(s, rr, 'closure', '2026-06-01T07:45');
    expect(full.closedHalfDays).toBe(2);
    applyPlanB(s, rr.id, 'closure', 'emp-paul', '2026-06-01T07:50', 'aucun pharmacien disponible');
    expect(rr.status).toBe('plan_b');
    // la fermeture retire les créneaux de l'obligation de couverture
    const ctx = makeCtx(s, rulesOf(s));
    expect(violations(slotsOf('2026-06-01', 'AM', '2026-06-01', 'PM'), ctx, activeAbsences(ctx))).toEqual([]);
  });

  it('T14 remplaçant lui-même absent : écarté avec motif', () => {
    const s = fresh();
    s.absences.push({ id: 'HX', employeeId: 'emp-hugo', type: 'special', start: '2026-06-01', end: '2026-06-01', startHalf: 'AM', endHalf: 'PM', status: 'approved', submittedAt: NOW });
    emp(s, 'emp-claire');
    const ctx = makeCtx(s, rulesOf(s));
    const abs = [...activeAbsences(ctx), { id: 'C', employeeId: 'emp-claire', type: 'sickness', start: '2026-06-01', end: '2026-06-01', startHalf: 'AM', endHalf: 'PM', status: 'approved', submittedAt: NOW } as Absence];
    const { ranked, rejected } = rankCandidates({ date: '2026-06-01', half: 'AM' }, 'pharmacist', ctx, abs);
    expect(rejected.find((r) => r.employeeId === 'emp-hugo')!.reasons.map((r) => r.code)).toContain('candidate_absent');
    expect(ranked.map((c) => c.employeeId)).toEqual(['emp-luc']);
  });

  it('T15 stagiaire / apprentie jamais proposés comme personne qualifiée ; comptent dans l\'effectif seulement', () => {
    const s = fresh();
    const ctx = makeCtx(s, rulesOf(s));
    const { ranked, rejected } = rankCandidates({ date: '2026-06-03', half: 'AM' }, 'pharmacist', ctx, []);
    expect(ranked.every((c) => ['emp-hugo', 'emp-luc', 'emp-claire'].includes(c.employeeId))).toBe(true);
    for (const id of ['emp-emma', 'emp-noah']) {
      const rj = rejected.find((r) => r.employeeId === id)!;
      expect(rj.reasons.map((r) => r.code)).toContain('not_qualified');
    }
    const { ranked: ra } = rankCandidates({ date: '2026-06-02', half: 'AM' }, 'assistant', ctx, []);
    expect(ra.some((c) => ['emp-emma', 'emp-noah'].includes(c.employeeId))).toBe(false);
    // couverture : Emma + Noah présents, aucun pharmacien => toujours un trou
    s.employees = s.employees.filter((e) => ['emp-emma', 'emp-noah'].includes(e.id));
    s.employees.forEach((e) => (e.schedule = { 2: ['AM', 'PM'] }));
    const c = coverOfSlot({ date: '2026-06-02', half: 'AM' }, makeCtx(s, rulesOf(s)), []);
    expect(c.headcount).toBe(2);
    expect(c.qualified).toBe(0);
  });

  it('T16 repos quotidien non respecté : candidat écarté (garde de nuit la veille)', () => {
    const s = fresh();
    emp(s, 'emp-hugo').extraBlocks = [{ start: '2026-06-04T20:00', end: '2026-06-05T02:00' }];
    const res = declareUnplanned(s, { employeeId: 'emp-claire', date: '2026-06-05' }, 'emp-claire', '2026-06-05T07:00');
    const ctx = makeCtx(s, rulesOf(s));
    const { rejected } = rankCandidates({ date: '2026-06-05', half: 'AM' }, 'pharmacist', ctx, activeAbsences(ctx));
    const hugo = rejected.find((r) => r.employeeId === 'emp-hugo')!;
    expect(hugo.reasons.map((r) => r.code)).toContain('rest_daily');
    expect(hugo.reasons.find((r) => r.code === 'rest_daily')!.params).toMatchObject({ gapHours: 6, min: 11 });
    expect(res.offers[0].result).toEqual({ offered: 'emp-luc' });
  });

  it('T17 égalité de score : signalée et départagée par l\'ordre de dépôt', () => {
    const s = fresh();
    rulesOf(s).priority.weights.order = 0;
    rulesOf(s).coverage.maxSimultaneousAbsent = 1;
    const a = req(s, 'emp-lea', '2026-09-07', '2026-09-11', '2026-04-15T08:00');
    const b = req(s, 'emp-sofia', '2026-09-07', '2026-09-11', '2026-04-14T08:00');
    const d = triage(s);
    expect(d.get(a.id)!.score!.total).toBe(d.get(b.id)!.score!.total);
    expect(d.get(a.id)!.tie && d.get(b.id)!.tie).toBe(true);
    expect(d.get(b.id)!.outcome).toBe('approve'); // déposée avant
    expect(d.get(a.id)!.outcome).toBe('impossible');
    expect(codes(d.get(b.id)!)).toContain('tie_broken');
  });

  it('T18 demande urgente contre règlement : bloquée par la période de blocage, décision humaine tracée', () => {
    const s = fresh();
    const r = req(s, 'emp-lea', '2026-12-15', '2026-12-15', '2026-12-10T09:00', { urgent: true, justification: 'décès dans la famille' });
    const d = triage(s, '2026-12-10T09:00').get(r.id)!;
    expect(d.outcome).toBe('impossible');
    expect(codes(d)).toEqual(expect.arrayContaining(['blackout', 'urgent_requires_human', 'urgent_notice_waived']));
    overrideDecision(s, { requestId: r.id, action: 'approve', reason: 'situation familiale grave, accord du gérant', actor: 'emp-paul' }, '2026-12-10T10:00');
    expect(s.absences.find((a) => a.id === r.id)!.status).toBe('approved');
    const entry = s.audit.find((a) => a.action === 'decision.approve')!;
    expect(entry.actor).toBe('emp-paul');
    expect(entry.justification).toMatch(/gérant/);
  });

  it('T19 changement de règlement en cours d\'année : version appliquée selon la date de dépôt, non rétroactive', () => {
    const s = fresh();
    const early = req(s, 'emp-lea', '2026-06-10', '2026-06-10', '2026-05-20T09:00');          // 21 j de préavis
    const late = req(s, 'emp-sofia', '2026-06-30', '2026-06-30', '2026-06-10T09:00');          // 20 j de préavis
    addRulesVersion(s, { effectiveFrom: '2026-06-01', internal: { ...rulesOf(s).internal, minNoticeDays: 30 } }, 'emp-paul', '2026-05-25T09:00');
    expect(rulesAt(s.rulesVersions, '2026-05-31').internal.minNoticeDays).toBe(14);
    expect(rulesAt(s.rulesVersions, '2026-06-01').internal.minNoticeDays).toBe(30);
    const d = triage(s, '2026-06-11T09:00');
    expect(d.get(early.id)!.outcome).toBe('approve');
    expect(codes(d.get(late.id)!, 'block')).toContain('notice_too_short');
    expect(s.audit.some((a) => a.action === 'rules.changed')).toBe(true);
  });

  it('T20 manager absent : délégation, puis escalade RH si le délégué est absent aussi', () => {
    const s = fresh();
    const gone = (id: string): Absence => ({ id: 'G' + id, employeeId: id, type: 'special', start: '2026-06-01', end: '2026-06-01', startHalf: 'AM', endHalf: 'PM', status: 'approved', submittedAt: NOW });
    s.absences.push(gone('emp-claire'));
    expect(approversFor(s, 'emp-sofia', '2026-06-01T09:00')).toEqual({ ids: ['emp-luc'], escalatedToHr: false });
    s.absences.push(gone('emp-luc'));
    expect(approversFor(s, 'emp-sofia', '2026-06-01T09:00')).toEqual({ ids: ['emp-paul'], escalatedToHr: true });
    expect(approversFor(s, 'emp-sofia', '2026-06-02T09:00').ids).toEqual(['emp-claire']);
  });

  it('T21 employé avec plusieurs managers : tous notifiés, n\'importe lequel peut valider, auteur tracé', () => {
    const s = fresh();
    emp(s, 'emp-lea').managerIds = ['emp-claire', 'emp-luc'];
    const r = req(s, 'emp-lea', '2026-09-07', '2026-09-08');
    const to = s.notifications.filter((n) => n.kind === 'request_pending' && n.channel === 'inapp').map((n) => n.to).sort();
    expect(to).toEqual(['emp-claire', 'emp-luc']);
    runTriage(s, NOW);
    const out = validateDecisions(s, [s.decisions[0].id], 'emp-luc', NOW);
    expect(out.done.length).toBe(1);
    expect(s.decisions[0].author).toBe('emp-luc');
    expect(s.absences.find((a) => a.id === r.id)!.status).toBe('approved');
  });

  it('T22 demande déposée après la date limite (été)', () => {
    const s = fresh();
    const r = req(s, 'emp-lea', '2026-07-27', '2026-07-28', '2026-05-02T09:00');
    const d = triage(s, '2026-05-02T09:00').get(r.id)!;
    expect(d.outcome).toBe('impossible');
    expect(codes(d, 'block')).toContain('late_deadline');
  });

  it('T23 période de blocage : refus automatique avec raison et décalage proposé', () => {
    const s = fresh();
    const r = req(s, 'emp-lea', '2026-12-14', '2026-12-16', '2026-10-01T09:00');
    const d = triage(s, '2026-10-01T09:00').get(r.id)!;
    expect(d.outcome).toBe('impossible');
    expect(codes(d, 'block')).toContain('blackout');
    expect(d.alternatives.some((a) => a.kind === 'shift')).toBe(true);
  });

  it('T24 fermeture collective : hors couverture, déduite du solde sans double décompte', () => {
    const s = fresh();
    const r = rulesOf(s);
    const cal = makeCalendar(r);
    const ctx = makeCtx(s, r);
    expect(cal.isOpen('2026-12-29', 'AM')).toBe(false);
    expect(violations(slotsOf('2026-12-28', 'AM', '2026-12-31', 'PM'), ctx, [])).toEqual([]);
    const claire = emp(s, 'emp-claire');
    const none = balanceOf(claire, 2026, '2026-12-01', [], cal, r);
    expect(none.closures).toBe(4);
    expect(none.remaining).toBe(20 - 4 + 0);
    const over: Absence = { id: 'z', employeeId: 'emp-claire', type: 'vacation', start: '2026-12-28', end: '2026-12-31', startHalf: 'AM', endHalf: 'PM', status: 'approved', submittedAt: NOW };
    expect(balanceOf(claire, 2026, '2026-12-01', [over], cal, r).taken).toBe(0);
  });

  it('T25 critères sensibles : désactivés par défaut, bonus uniquement, jamais pénalisant, masqués aux managers', async () => {
    const { setConsent } = await import('../src/actions.js');
    const { viewDecision } = await import('../src/views.js');
    const mkScenario = (enable: boolean, consent: boolean) => {
      const s = fresh();
      rulesOf(s).priority.sensitiveEnabled = enable;
      const a = req(s, 'emp-sofia', '2026-07-13', '2026-07-14', '2026-04-14T08:00');
      const b = req(s, 'emp-lea', '2026-07-13', '2026-07-14', '2026-04-14T08:00');
      if (consent) setConsent(s, 'emp-sofia', { consent: true, childrenUnder12: 2 }, 'emp-sofia', NOW);
      return { s, a, b, d: triage(s) };
    };
    const off = mkScenario(false, true);
    expect(off.d.get(off.a.id)!.score!.familyActive).toBe(false);
    const on = mkScenario(true, true);
    expect(on.d.get(on.a.id)!.score!.familyActive).toBe(true);
    expect(on.d.get(on.a.id)!.score!.total).toBeGreaterThan(off.d.get(off.a.id)!.score!.total);
    expect(on.d.get(on.b.id)!.score!.total).toBe(off.d.get(off.b.id)!.score!.total); // le collègue n'est pas pénalisé
    const noConsent = mkScenario(true, false);
    expect(noConsent.d.get(noConsent.a.id)!.score!.familyActive).toBe(false);
    // vue manager : critère retiré, total recalculé sans le bonus
    const mgrView = viewDecision(on.d.get(on.a.id)!, emp(on.s, 'emp-claire'), 'fr');
    expect(mgrView.score!.family).toBe(0);
    expect(mgrView.score!.total).toBe(off.d.get(off.a.id)!.score!.total);
    const hrView = viewDecision(on.d.get(on.a.id)!, emp(on.s, 'emp-paul'), 'fr');
    expect(hrView.score!.family).toBeGreaterThan(0);
    // retrait du consentement et purge à l'échéance
    setConsent(on.s, 'emp-sofia', { consent: false }, 'emp-sofia', NOW);
    expect(on.s.sensitive.find((x) => x.employeeId === 'emp-sofia')!.childrenUnder12).toBeUndefined();
    const { purgeExpiredSensitive } = await import('../src/actions.js');
    setConsent(on.s, 'emp-sofia', { consent: true, childrenUnder12: 1 }, 'emp-sofia', NOW);
    expect(purgeExpiredSensitive(on.s, '2027-05-01T09:00')).toBe(1);
    expect(on.s.sensitive.find((x) => x.employeeId === 'emp-sofia')!.consent).toBe(false);
  });
});

