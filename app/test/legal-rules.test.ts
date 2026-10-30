import { describe, expect, it } from 'vitest';
import { activeAbsences, makeCtx } from '../src/coverage.js';
import { leaveReasons } from '../src/leaves.js';
import { rankCandidates, weeklyRestViolation } from '../src/replacement.js';
import { consecutiveVacation } from '../src/balance.js';
import { makeCalendar } from '../src/calendar.js';
import { addRulesVersion } from '../src/actions.js';
import { renderReason } from '../src/i18n.js';
import { codes, emp, fresh, req, triage } from './helpers.js';
import type { Employee } from '../src/types.js';

const rulesOf = (s: ReturnType<typeof fresh>) => s.rulesVersions[0];
const fullWeek = { 1: ['AM', 'PM'], 2: ['AM', 'PM'], 3: ['AM', 'PM'], 4: ['AM', 'PM'], 5: ['AM', 'PM'] } as Employee['schedule'];

/** Semaine du lundi 2026-06-08 (aucun jour férié) ; employé·e fictif·ve Lun-Ven plein temps (08:00-12:30, 13:30-18:30). */
function setup(blocks: Employee['extraBlocks'] = []) {
  const s = fresh();
  const e = emp(s, 'emp-hugo');
  e.schedule = fullWeek; e.extraBlocks = blocks; e.availableWeekdays = undefined;
  const ctx = makeCtx(s, rulesOf(s));
  return { s, e, ctx, abs: activeAbsences(ctx) };
}
const slot = { date: '2026-06-12', half: 'PM' as const };

describe('Repos hebdomadaire (paramètre legal.weeklyRestHours, à valider par un juriste)', () => {
  it('T37 cas passant : week-end libre (61,5 h entre ven. 18:30 et lun. 08:00)', () => {
    const { e, ctx, abs } = setup();
    expect(weeklyRestViolation(e, [slot], ctx, abs)).toBeNull();
  });

  it('T38 cas bloqué : garde de nuit samedi 20:00-dimanche 02:00 => meilleur repos 30 h < 35 h', () => {
    const { e, ctx, abs } = setup([{ start: '2026-06-13T20:00', end: '2026-06-14T02:00' }]);
    expect(weeklyRestViolation(e, [slot], ctx, abs)).toBe(30 * 60);
  });

  it('T39 cas limite : exactement 35 h acceptées, 34,5 h refusées', () => {
    const ok = setup([{ start: '2026-06-13T08:00', end: '2026-06-13T21:00' }]);
    expect(weeklyRestViolation(ok.e, [slot], ok.ctx, ok.abs)).toBeNull();
    const ko = setup([{ start: '2026-06-13T08:00', end: '2026-06-13T21:30' }]);
    expect(weeklyRestViolation(ko.e, [slot], ko.ctx, ko.abs)).toBe(34.5 * 60);
  });

  it('T40 le seuil est un paramètre : 35 h -> 30 h rend le cas bloqué passant', () => {
    const { s, e, abs } = setup([{ start: '2026-06-13T20:00', end: '2026-06-14T02:00' }]);
    rulesOf(s).legal.weeklyRestHours = 30;
    expect(weeklyRestViolation(e, [slot], makeCtx(s, rulesOf(s)), abs)).toBeNull();
  });

  it('T41 classement des remplaçants : raison « weekly_rest » explicite, candidat écarté puis admis sans le bloc', () => {
    const night = (d: number) => ({ start: `2026-06-${String(d).padStart(2, '0')}T23:00`, end: `2026-06-${String(d + 1).padStart(2, '0')}T05:00` });
    const blocks = [8, 9, 10, 11, 12, 13, 14].map(night);
    const s = fresh();
    emp(s, 'emp-hugo').extraBlocks = blocks;
    let ctx = makeCtx(s, rulesOf(s));
    let r = rankCandidates({ date: '2026-06-10', half: 'PM' }, 'pharmacist', ctx, activeAbsences(ctx));
    expect(r.ranked.some((c) => c.employeeId === 'emp-hugo')).toBe(false);
    const why = r.rejected.find((x) => x.employeeId === 'emp-hugo')!.reasons.find((x) => x.code === 'weekly_rest')!;
    expect(why.severity).toBe('block');
    expect(why.params).toMatchObject({ min: 35 });
    emp(s, 'emp-hugo').extraBlocks = [];
    ctx = makeCtx(s, rulesOf(s));
    r = rankCandidates({ date: '2026-06-10', half: 'PM' }, 'pharmacist', ctx, activeAbsences(ctx));
    expect(r.ranked.some((c) => c.employeeId === 'emp-hugo')).toBe(true);
  });

  it('T42 plusieurs créneaux d\'une même demande sont vérifiés ensemble (couverture)', () => {
    // sans bloc, remplacer toute la semaine (lun-ven + sam. matin) laisse un repos 61,5 h ; avec un bloc samedi 14:00-22:00 puis lundi 08:00 : 34 h, bloqué
    const s = fresh();
    emp(s, 'emp-hugo').availableWeekdays = undefined;
    emp(s, 'emp-hugo').extraBlocks = [{ start: '2026-06-13T14:00', end: '2026-06-13T22:00' }, { start: '2026-06-15T08:00', end: '2026-06-15T09:00' }];
    const ctx = makeCtx(s, rulesOf(s));
    const week = ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'].flatMap((date) => [{ date, half: 'AM' as const }, { date, half: 'PM' as const }]);
    const alone = rankCandidates(week[0], 'pharmacist', ctx, [], [], [week[0]]);
    expect(alone.ranked.some((c) => c.employeeId === 'emp-hugo')).toBe(true);
    const together = rankCandidates(week[0], 'pharmacist', ctx, [], [], week);
    expect(together.rejected.find((x) => x.employeeId === 'emp-hugo')!.reasons.map((x) => x.code)).toContain('weekly_rest');
  });
});

describe('Durées par défaut des congés spéciaux, maternité, paternité, proche aidant (à valider par un juriste)', () => {
  const cal = (s: ReturnType<typeof fresh>) => makeCalendar(rulesOf(s));
  const abs = (type: string, start: string, end: string, certificate?: boolean) =>
    ({ id: 'X', employeeId: 'emp-lea', type, start, end, startHalf: 'AM', endHalf: 'PM', status: 'submitted', submittedAt: '2026-04-20T09:00', certificate }) as any;

  it('T43 paramètres présents pour les 4 types, marqués avec une base indicative et jamais « garantis »', () => {
    const l = rulesOf(fresh()).legal.leaves;
    expect(Object.keys(l).sort()).toEqual(['carer', 'maternity', 'paternity', 'special']);
    expect(l.maternity).toMatchObject({ days: 98, unit: 'calendar' });
    expect(l.paternity).toMatchObject({ days: 14, unit: 'calendar' });
    expect(l.carer).toMatchObject({ days: 3, unit: 'working', yearlyMaxDays: 10 });
    expect(JSON.stringify(l)).not.toMatch(/guarantee|garanti/i);
  });

  it('T44 le moteur affiche la durée et « à valider », sans bloquer ; dépassement et justificatif absents = avertissements', () => {
    const s = fresh();
    const r = leaveReasons(abs('paternity', '2026-09-01', '2026-09-20'), rulesOf(s), cal(s), []);
    expect(r.map((x) => x.code)).toEqual(['leave_default', 'leave_to_validate', 'leave_exceeds_default', 'leave_proof_required']);
    expect(r.every((x) => x.severity !== 'block')).toBe(true);
    expect(leaveReasons(abs('paternity', '2026-09-01', '2026-09-14', true), rulesOf(s), cal(s), []).map((x) => x.code)).toEqual(['leave_default', 'leave_to_validate']);
    expect(leaveReasons(abs('vacation', '2026-09-01', '2026-09-14'), rulesOf(s), cal(s), [])).toEqual([]);
  });

  it('T45 durée en jours ouvrés : 3 jours ouvrés lun-mer acceptés, jeudi-lundi = 3 j (week-end exclu)', () => {
    const s = fresh();
    const codesOf = (a: any) => leaveReasons(a, rulesOf(s), cal(s), []).map((x) => x.code);
    expect(codesOf(abs('special', '2026-09-07', '2026-09-09', true))).not.toContain('leave_exceeds_default');
    expect(codesOf(abs('special', '2026-09-10', '2026-09-14', true))).not.toContain('leave_exceeds_default');
    expect(codesOf(abs('special', '2026-09-07', '2026-09-10', true))).toContain('leave_exceeds_default');
  });

  it('T46 proche aidant : plafond annuel indicatif (10 j) signalé, non bloquant', () => {
    const s = fresh();
    const used = [abs('carer', '2026-05-04', '2026-05-06'), abs('carer', '2026-06-08', '2026-06-10'), abs('carer', '2026-07-06', '2026-07-08')];
    const r = leaveReasons(abs('carer', '2026-09-07', '2026-09-09', true), rulesOf(s), cal(s), used);
    expect(r.find((x) => x.code === 'leave_yearly_cap')).toMatchObject({ severity: 'warn', params: { total: 12, max: 10 } });
  });

  it('T47 de bout en bout : décision proposée avec raisons en français, jamais « garanti », modifiable par une nouvelle version', () => {
    const s = fresh();
    const a = req(s, 'emp-lea', '2026-09-07', '2026-09-08', '2026-04-20T09:00', { type: 'special' });
    const d = triage(s).get(a.id)!;
    expect(codes(d)).toEqual(expect.arrayContaining(['leave_default', 'leave_to_validate']));
    const txt = d.reasons.map((r) => renderReason('fr', r)).join(' | ');
    expect(txt).toMatch(/à valider par un juriste/);
    expect(txt).toMatch(/ni avis juridique, ni droit garanti/);
    expect(txt).not.toMatch(/\{\w+\}/);
    addRulesVersion(s, { effectiveFrom: '2026-04-21', legal: { ...rulesOf(s).legal, leaves: { ...rulesOf(s).legal.leaves, special: { ...rulesOf(s).legal.leaves.special, days: 1 } } } }, 'emp-paul', '2026-04-21T09:00');
    const b = req(s, 'emp-sofia', '2026-09-14', '2026-09-15', '2026-04-22T09:00', { type: 'special' });
    expect(codes(triage(s, '2026-04-22T09:00').get(b.id)!)).toContain('leave_exceeds_default');
  });
});

describe('Rappel « au moins 2 semaines consécutives » (non bloquant)', () => {
  const E = (s: ReturnType<typeof fresh>) => emp(s, 'emp-lea');
  const vac = (start: string, end: string, status = 'approved') =>
    ({ id: start, employeeId: 'emp-lea', type: 'vacation', start, end, startHalf: 'AM', endHalf: 'PM', status, submittedAt: '2026-01-10T09:00' }) as any;

  it('T48 deux semaines (lun-ven x2) = 10 jours ouvrés : rappel satisfait ; 9 jours : non', () => {
    const s = fresh(); const cal = makeCalendar(rulesOf(s));
    expect(consecutiveVacation(E(s), 2026, [vac('2026-09-07', '2026-09-18')], cal, rulesOf(s))).toEqual({ longest: 10, min: 10, met: true });
    expect(consecutiveVacation(E(s), 2026, [vac('2026-09-07', '2026-09-17')], cal, rulesOf(s))).toMatchObject({ longest: 9, met: false });
  });

  it('T49 périodes enchaînées par un week-end comptent ensemble ; un jour ouvré entre deux les sépare ; refusées ignorées', () => {
    const s = fresh(); const cal = makeCalendar(rulesOf(s));
    const chained = [vac('2026-09-07', '2026-09-11'), vac('2026-09-14', '2026-09-18')];
    expect(consecutiveVacation(E(s), 2026, chained, cal, rulesOf(s)).longest).toBe(10);
    const gap = [vac('2026-09-07', '2026-09-10'), vac('2026-09-14', '2026-09-18')];
    expect(consecutiveVacation(E(s), 2026, gap, cal, rulesOf(s)).longest).toBe(5);
    expect(consecutiveVacation(E(s), 2026, [vac('2026-09-07', '2026-09-18', 'refused')], cal, rulesOf(s)).longest).toBe(0);
  });

  it('T50 le rappel est affiché au manager (raison de la décision) et jamais bloquant ; le seuil est un paramètre', () => {
    const s = fresh();
    const a = req(s, 'emp-lea', '2026-09-07', '2026-09-08', '2026-04-20T09:00');
    const d = triage(s).get(a.id)!;
    const rem = d.reasons.find((r) => r.code === 'min_consecutive_reminder')!;
    expect(rem).toMatchObject({ severity: 'info', params: { longest: 2, min: 10 } });
    expect(d.outcome).toBe('approve');
    expect(renderReason('fr', rem)).toMatch(/au moins 10 sont recommandés/);
    const s2 = fresh(); rulesOf(s2).legal.minConsecutiveDays = 2;
    const b = req(s2, 'emp-lea', '2026-09-07', '2026-09-08', '2026-04-20T09:00');
    expect(codes(triage(s2).get(b.id)!)).not.toContain('min_consecutive_reminder');
  });
});
