import { balanceOf, countAbsenceDays } from './balance.js';
import { addDays, slotsOf, toMin } from './calendar.js';
import {
  Ctx, activeAbsences, holdsAbsence, isAbsent, isOpenSlot, makeCtx, slotsOfAbsence, violations,
} from './coverage.js';
import { propose } from './engine.js';
import { rankCandidates } from './replacement.js';
import { rulesAt } from './rules.js';
import type {
  Absence, AbsenceType, Decision, Half, ReplacementRequest, Rules, Slot, State,
} from './types.js';

export class DomainError extends Error {
  constructor(public code: string, message?: string) { super(message ?? code); }
}

export const nextId = (s: State, p: string) => `${p}${String(++s.seq).padStart(4, '0')}`;
export const isHr = (e: { role: string }) => e.role === 'hr' || e.role === 'admin';
const day = (now: string) => now.slice(0, 10);
export const currentRules = (s: State, now: string): Rules => rulesAt(s.rulesVersions, day(now));
const ctxOf = (s: State, now: string): Ctx => makeCtx(s, currentRules(s, now));

export function audit(s: State, actor: string, action: string, entityId: string, now: string, justification?: string, before?: unknown, after?: unknown) {
  s.audit.push({ id: nextId(s, 'A'), ts: now, actor, action, entityId, justification, before, after });
}

export function notify(s: State, to: string, kind: string, params: Record<string, string | number>, now: string) {
  s.notifications.push({ id: nextId(s, 'N'), to, kind, params, ts: now, channel: 'inapp' });
  s.notifications.push({ id: nextId(s, 'N'), to, kind, params, ts: now, channel: 'email' });
}

const setStatus = (a: Absence, status: Absence['status'], by: string, now: string) => {
  (a.history ??= []).push({ ts: now, status, by });
  a.status = status;
};

/** Who may decide: the employee's managers; a manager who is absent today is replaced by their delegate, else HR. */
export function approversFor(s: State, empId: string, now: string): { ids: string[]; escalatedToHr: boolean } {
  const emp = s.employees.find((e) => e.id === empId)!;
  const ctx = ctxOf(s, now);
  const today = day(now);
  const ids: string[] = [];
  let escalatedToHr = false;
  for (const mid of emp.managerIds) {
    const m = s.employees.find((e) => e.id === mid)!;
    const away = (['AM', 'PM'] as Half[]).every((h) => isAbsent(m.id, { date: today, half: h }, activeAbsences(ctx)));
    if (!away) { ids.push(m.id); continue; }
    const d = m.delegateTo && s.employees.find((e) => e.id === m.delegateTo);
    if (d && !(['AM', 'PM'] as Half[]).every((h) => isAbsent(d.id, { date: today, half: h }, activeAbsences(ctx)))) ids.push(d.id);
    else escalatedToHr = true;
  }
  if (escalatedToHr || ids.length === 0) {
    ids.push(...s.employees.filter(isHr).map((e) => e.id));
    escalatedToHr = true;
  }
  return { ids: [...new Set(ids)], escalatedToHr };
}

export interface SubmitInput {
  employeeId: string; type: AbsenceType; start: string; end: string;
  startHalf?: Half; endHalf?: Half; urgent?: boolean; justification?: string; certificate?: boolean;
}

export function submitRequest(s: State, inp: SubmitInput, now: string, actor = inp.employeeId): Absence {
  const emp = s.employees.find((e) => e.id === inp.employeeId);
  if (!emp) throw new DomainError('unknown_employee');
  const a: Absence = {
    id: nextId(s, 'R'), employeeId: inp.employeeId, type: inp.type, start: inp.start, end: inp.end,
    startHalf: inp.startHalf ?? 'AM', endHalf: inp.endHalf ?? 'PM', status: 'submitted', submittedAt: now,
    urgent: inp.urgent, justification: inp.justification, certificate: inp.certificate, history: [{ ts: now, status: 'submitted', by: actor }],
  };
  if (a.end < a.start) throw new DomainError('invalid_dates');
  if (a.start === a.end && a.startHalf === 'PM' && a.endHalf === 'AM') throw new DomainError('invalid_dates');
  const mine = slotsOfAbsence(a);
  const clash = s.absences.some((o) => o.employeeId === emp.id && (holdsAbsence(o) || o.status === 'submitted')
    && slotsOfAbsence(o).some((x) => mine.some((y) => x.date === y.date && x.half === y.half)));
  if (clash) throw new DomainError('overlaps_own_request');
  if (inp.urgent && !inp.justification) throw new DomainError('urgent_needs_justification');
  s.absences.push(a);
  audit(s, actor, 'request.submitted', a.id, now, a.justification, undefined, { ...a });
  const ap = approversFor(s, emp.id, now);
  for (const id of ap.ids) notify(s, id, 'request_pending', { requestId: a.id, employee: emp.name }, now);
  return a;
}

export function withdrawRequest(s: State, id: string, actor: string, now: string) {
  const a = s.absences.find((x) => x.id === id);
  if (!a) throw new DomainError('unknown_request');
  if (a.status !== 'submitted' && a.status !== 'draft') throw new DomainError('bad_transition');
  setStatus(a, 'cancelled', actor, now);
  s.decisions = s.decisions.filter((d) => !(d.requestId === id && d.status === 'proposed'));
  audit(s, actor, 'request.withdrawn', id, now);
}

/** Step 1-4: compute proposals. Nothing is notified to the employee here. */
export function runTriage(s: State, now: string, actor = 'system'): Decision[] {
  const ds = propose(s, { now });
  s.decisions = s.decisions.filter((d) => d.status !== 'proposed');
  for (const d of ds) {
    d.id = nextId(s, 'D');
    s.decisions.push(d);
    audit(s, actor, 'decision.proposed', d.id, now, undefined, undefined, { requestId: d.requestId, outcome: d.outcome, score: d.score?.total });
  }
  return ds;
}

export function createNeeds(s: State, a: Absence, kind: 'planned' | 'unplanned', now: string): ReplacementRequest[] {
  const ctx = ctxOf(s, now);
  const viol = violations(slotsOfAbsence(a), ctx, activeAbsences(ctx));
  const out: ReplacementRequest[] = [];
  const mk = (qual: 'pharmacist' | 'assistant', slots: Slot[]) => {
    if (!slots.length) return;
    const rr: ReplacementRequest = {
      id: nextId(s, 'P'), kind, sourceAbsenceId: a.id, slots, qualification: qual, status: 'open', offers: [],
      escalationLevel: 0, createdAt: now,
    };
    s.replacements.push(rr); out.push(rr);
    audit(s, 'system', 'replacement.created', rr.id, now, undefined, undefined, { slots: slots.length, qualification: qual });
  };
  mk('pharmacist', viol.filter((v) => v.code === 'coverage_pharmacist').map((v) => v.slot));
  mk('assistant', viol.filter((v) => v.code !== 'coverage_pharmacist').map((v) => v.slot));
  if (out.length) for (const id of approversFor(s, a.employeeId, now).ids) notify(s, id, 'replacement_needed', { absenceId: a.id }, now);
  return out;
}

export function validateDecisions(s: State, ids: string[], actor: string, now: string) {
  const done: string[] = [], skipped: { id: string; code: string }[] = [];
  for (const id of ids) {
    const d = s.decisions.find((x) => x.id === id);
    const a = d && s.absences.find((x) => x.id === d.requestId);
    if (!d || !a || d.status !== 'proposed' || (a.status as string) !== 'submitted') { skipped.push({ id, code: 'not_pending' }); continue; }
    if (a.employeeId === actor) { skipped.push({ id, code: 'self_decision_forbidden' }); continue; }
    if (d.outcome === 'impossible') { skipped.push({ id, code: 'impossible_needs_override' }); continue; }
    setStatus(a, 'approved', actor, now);
    d.status = 'validated'; d.author = actor; d.ts = now;
    audit(s, actor, 'decision.validated', d.id, now, undefined, { status: 'submitted' }, { status: 'approved', requestId: a.id });
    notify(s, a.employeeId, 'request_approved', { requestId: a.id }, now);
    createNeeds(s, a, 'planned', now);
    done.push(id);
  }
  return { done, skipped };
}

export interface OverrideInput {
  requestId: string; action: 'approve' | 'refuse' | 'modify'; reason: string; actor: string;
  start?: string; end?: string; startHalf?: Half; endHalf?: Half;
}
export interface Change { requestId: string; from: string; to: string; codes: string[] }

export function diffDecisions(before: Decision[], after: Decision[]): Change[] {
  const out: Change[] = [];
  for (const a of after) {
    const b = before.find((x) => x.requestId === a.requestId);
    if (!b) continue;
    const ca = a.reasons.map((r) => r.code).sort().join(','), cb = b.reasons.map((r) => r.code).sort().join(',');
    if (b.outcome !== a.outcome || ca !== cb) out.push({ requestId: a.requestId, from: b.outcome, to: a.outcome, codes: a.reasons.filter((r) => r.severity !== 'info').map((r) => r.code) });
  }
  return out;
}

export function overrideDecision(s: State, inp: OverrideInput, now: string, preview = false) {
  if (!inp.reason?.trim()) throw new DomainError('reason_required');
  const target = preview ? (structuredClone(s) as State) : s;
  const a = target.absences.find((x) => x.id === inp.requestId);
  if (!a) throw new DomainError('unknown_request');
  if (a.status !== 'submitted') throw new DomainError('bad_transition');
  if (a.employeeId === inp.actor) throw new DomainError('self_decision_forbidden');
  const others = (st: State) => st.absences.filter((x) => x.status === 'submitted' && x.id !== inp.requestId);
  const before = propose(s, { now });
  const d = target.decisions.find((x) => x.requestId === a.id && x.status === 'proposed');
  const snapshot = { ...a };
  if (inp.action === 'refuse') setStatus(a, 'refused', inp.actor, now);
  else {
    if (inp.action === 'modify') {
      a.start = inp.start ?? a.start; a.end = inp.end ?? a.end;
      a.startHalf = inp.startHalf ?? a.startHalf; a.endHalf = inp.endHalf ?? a.endHalf;
    }
    setStatus(a, 'approved', inp.actor, now);
  }
  const after = propose(target, { now, requests: others(target) });
  const changes = diffDecisions(before, after);
  if (preview) return { changes, newStatus: a.status };
  if (d) {
    d.status = inp.action === 'refuse' ? 'refused' : 'modified';
    d.author = inp.actor; d.ts = now; d.note = inp.reason;
  } else {
    target.decisions.push({ id: nextId(target, 'D'), requestId: a.id, outcome: 'impossible', status: inp.action === 'refuse' ? 'refused' : 'modified',
      reasons: [], score: null, alternatives: [], risk: 'high', tie: false, author: inp.actor, ts: now, note: inp.reason });
  }
  audit(target, inp.actor, `decision.${inp.action}`, a.id, now, inp.reason, snapshot, { ...a });
  notify(target, a.employeeId, inp.action === 'refuse' ? 'request_refused' : 'request_approved', { requestId: a.id }, now);
  if (inp.action !== 'refuse') createNeeds(target, a, 'planned', now);
  // pending proposals now outdated: refresh so the manager sees the cascade
  for (const c of changes) audit(target, 'system', 'cascade.changed', c.requestId, now, inp.reason, { outcome: c.from }, { outcome: c.to });
  runTriage(target, now);
  return { changes, newStatus: a.status };
}

/** Auto-validate zero-risk proposals when the administrator enabled it. */
export function autoValidate(s: State, now: string) {
  if (!currentRules(s, now).automation.autoApproveZeroRisk) return { done: [], skipped: [] };
  const ids = s.decisions.filter((d) => d.status === 'proposed' && d.outcome === 'approve' && d.risk === 'zero').map((d) => d.id);
  return validateDecisions(s, ids, 'system:auto', now);
}

export function requestCancellation(s: State, id: string, actor: string, now: string, reason?: string) {
  const a = s.absences.find((x) => x.id === id);
  if (!a || a.status !== 'approved') throw new DomainError('bad_transition');
  setStatus(a, 'cancel_requested', actor, now);
  audit(s, actor, 'request.cancel_requested', id, now, reason);
  for (const m of approversFor(s, a.employeeId, now).ids) notify(s, m, 'cancel_requested', { requestId: id }, now);
}

export function decideCancellation(s: State, id: string, accept: boolean, actor: string, now: string, reason?: string) {
  const a = s.absences.find((x) => x.id === id);
  if (!a || a.status !== 'cancel_requested') throw new DomainError('bad_transition');
  if (accept) {
    setStatus(a, 'cancelled', actor, now);
    for (const rr of s.replacements.filter((r) => r.sourceAbsenceId === id)) {
      rr.status = 'void';
      s.assignments = s.assignments.filter((x) => x.replacementId !== rr.id);
      s.closedSlots = s.closedSlots.filter((x) => x.replacementId !== rr.id);
    }
    notify(s, a.employeeId, 'cancellation_accepted', { requestId: id }, now);
  } else {
    setStatus(a, 'approved', actor, now);
    notify(s, a.employeeId, 'cancellation_refused', { requestId: id }, now);
  }
  audit(s, actor, accept ? 'request.cancelled' : 'request.cancel_refused', id, now, reason);
}

/* ---------- replacements ---------- */

export function rankForRequest(s: State, rr: ReplacementRequest, now: string) {
  const ctx = ctxOf(s, now);
  const abs = activeAbsences(ctx);
  const tried = rr.offers.map((o) => o.candidateId);
  let common: Map<string, number> | null = null as Map<string, number> | null;
  const rejected = new Map<string, string[]>();
  for (const slot of rr.slots) {
    const { ranked, rejected: rej } = rankCandidates(slot, rr.qualification, ctx, abs, tried);
    for (const r of rej) rejected.set(r.employeeId, [...(rejected.get(r.employeeId) ?? []), ...r.reasons.map((x) => x.code)]);
    const m = new Map(ranked.map((c) => [c.employeeId, c.score]));
    common = common ? new Map<string, number>([...common].filter(([k]) => m.has(k)).map(([k, v]): [string, number] => [k, v + m.get(k)!])) : m;
  }
  const ranked = [...(common ?? new Map())].map(([employeeId, sum]) => ({ employeeId, score: Math.round((sum / rr.slots.length) * 10) / 10 }))
    .sort((a, b) => b.score - a.score || a.employeeId.localeCompare(b.employeeId));
  return { ranked, rejected: [...rejected].map(([employeeId, codes]) => ({ employeeId, codes: [...new Set(codes)] })) };
}

export function offerNext(s: State, rrId: string, now: string, actor = 'system') {
  const rr = s.replacements.find((r) => r.id === rrId);
  if (!rr || rr.status === 'filled' || rr.status === 'void') throw new DomainError('bad_transition');
  const { ranked } = rankForRequest(s, rr, now);
  const top = ranked[0];
  if (!top) return escalate(s, rr, actor, now);
  rr.offers.push({ candidateId: top.employeeId, sentAt: now, reminders: 0, status: 'pending' });
  rr.status = 'offered';
  notify(s, top.employeeId, 'replacement_offer', { replacementId: rr.id, slots: rr.slots.length }, now);
  audit(s, actor, 'replacement.offered', rr.id, now, undefined, undefined, { candidate: top.employeeId, score: top.score });
  return { offered: top.employeeId };
}

function escalate(s: State, rr: ReplacementRequest, actor: string, now: string) {
  const src = s.absences.find((a) => a.id === rr.sourceAbsenceId)!;
  if (rr.escalationLevel === 0) {
    rr.escalationLevel = 1;
    for (const id of approversFor(s, src.employeeId, now).ids) notify(s, id, 'replacement_escalated', { replacementId: rr.id, level: 1 }, now);
  } else if (rr.escalationLevel === 1) {
    rr.escalationLevel = 2;
    for (const e of s.employees.filter(isHr)) notify(s, e.id, 'replacement_escalated', { replacementId: rr.id, level: 2 }, now);
  }
  rr.status = 'unfilled';
  audit(s, actor, 'replacement.escalated', rr.id, now, undefined, undefined, { level: rr.escalationLevel });
  return { escalated: rr.escalationLevel, planB: planBImpact(s, rr, 'reduced_hours', now) };
}

export function respondOffer(s: State, rrId: string, candidateId: string, accept: boolean, now: string) {
  const rr = s.replacements.find((r) => r.id === rrId);
  const offer = rr?.offers.find((o) => o.candidateId === candidateId && o.status === 'pending');
  if (!rr || !offer) throw new DomainError('no_pending_offer');
  offer.respondedAt = now;
  if (accept) {
    const { ranked } = rankForRequest(s, { ...rr, offers: rr.offers.filter((o) => o !== offer) }, now);
    if (!ranked.some((c) => c.employeeId === candidateId)) {
      offer.status = 'declined';
      audit(s, 'system', 'replacement.offer_invalid', rr.id, now, 'candidate no longer eligible');
      return { ...offerNext(s, rr.id, now), invalid: true };
    }
    offer.status = 'accepted';
    for (const sl of rr.slots) s.assignments.push({ id: nextId(s, 'S'), employeeId: candidateId, date: sl.date, half: sl.half, replacementId: rr.id });
    rr.status = 'filled';
    const src = s.absences.find((a) => a.id === rr.sourceAbsenceId)!;
    for (const id of approversFor(s, src.employeeId, now).ids) notify(s, id, 'replacement_filled', { replacementId: rr.id, candidate: candidateId }, now);
    audit(s, candidateId, 'replacement.accepted', rr.id, now);
    return { filled: true };
  }
  offer.status = 'declined';
  audit(s, candidateId, 'replacement.declined', rr.id, now);
  return offerNext(s, rr.id, now);
}

/** Time-driven follow-up: reminder once, then expire and offer the next candidate. */
export function tick(s: State, now: string) {
  const rules = currentRules(s, now);
  const log: string[] = [];
  for (const rr of s.replacements) {
    for (const o of rr.offers.filter((x) => x.status === 'pending')) {
      if (toMin(now) - toMin(o.sentAt) < rules.internal.offerTimeoutMinutes) continue;
      if (o.reminders < rules.internal.maxReminders) {
        o.reminders++; o.sentAt = now;
        notify(s, o.candidateId, 'replacement_reminder', { replacementId: rr.id }, now);
        log.push(`reminder:${rr.id}:${o.candidateId}`);
      } else {
        o.status = 'expired';
        audit(s, 'system', 'replacement.expired', rr.id, now);
        offerNext(s, rr.id, now);
        log.push(`expired:${rr.id}:${o.candidateId}`);
      }
    }
  }
  return log;
}

export function planBImpact(s: State, rr: ReplacementRequest, option: 'reduced_hours' | 'closure', now: string) {
  const ctx = ctxOf(s, now);
  const slots: Slot[] = [];
  const add = (x: Slot) => { if (isOpenSlot(x, ctx) && !slots.some((y) => y.date === x.date && y.half === x.half)) slots.push(x); };
  for (const sl of rr.slots) {
    add(sl);
    if (option === 'closure') for (const h of ['AM', 'PM'] as Half[]) add({ date: sl.date, half: h });
  }
  return { option, closedHalfDays: slots.length, dates: [...new Set(slots.map((x) => x.date))], slots };
}

export function applyPlanB(s: State, rrId: string, option: 'reduced_hours' | 'closure', actor: string, now: string, reason: string) {
  if (!reason?.trim()) throw new DomainError('reason_required');
  const rr = s.replacements.find((r) => r.id === rrId);
  if (!rr || rr.status === 'filled' || rr.status === 'void') throw new DomainError('bad_transition');
  const impact = planBImpact(s, rr, option, now);
  for (const sl of impact.slots) s.closedSlots.push({ date: sl.date, half: sl.half, reason: option, replacementId: rr.id });
  rr.status = 'plan_b';
  audit(s, actor, 'replacement.plan_b', rr.id, now, reason, undefined, { option, closed: impact.closedHalfDays });
  for (const e of s.employees.filter((x) => isHr(x) || x.role === 'manager')) notify(s, e.id, 'plan_b_applied', { replacementId: rr.id, option }, now);
  return impact;
}

export interface UnplannedInput { employeeId: string; date: string; halves?: Half[]; type?: AbsenceType; certificate?: boolean }

export function declareUnplanned(s: State, inp: UnplannedInput, actor: string, now: string) {
  const emp = s.employees.find((e) => e.id === inp.employeeId);
  if (!emp) throw new DomainError('unknown_employee');
  const halves = inp.halves ?? ['AM', 'PM'];
  const before = new Map(s.absences.filter((a) => a.employeeId === emp.id && a.type === 'vacation' && holdsAbsence(a))
    .map((a) => [a.id, countAbsenceDays(emp, a, ctxOf(s, now).cal, currentRules(s, now), s.absences)]));
  const a: Absence = {
    id: nextId(s, 'R'), employeeId: emp.id, type: inp.type ?? 'sickness', start: inp.date, end: inp.date,
    startHalf: halves.includes('AM') ? 'AM' : 'PM', endHalf: halves.includes('PM') ? 'PM' : 'AM',
    status: 'approved', submittedAt: now, certificate: inp.certificate, history: [{ ts: now, status: 'approved', by: actor }],
  };
  s.absences.push(a);
  audit(s, actor, 'absence.declared', a.id, now, undefined, undefined, { ...a });
  for (const id of [...approversFor(s, emp.id, now).ids, ...s.employees.filter(isHr).map((e) => e.id)])
    notify(s, id, 'unplanned_absence', { absenceId: a.id, employee: emp.name }, now);
  const needs = createNeeds(s, a, 'unplanned', now);
  for (const rr of needs) {
    // late if the first slot has already started
    const first = rr.slots[0];
    rr.late = toMin(now) >= toMin(`${first.date}T${currentRules(s, now).slotTimes[first.half].start}`);
  }
  const offers = needs.map((rr) => ({ replacementId: rr.id, result: offerNext(s, rr.id, now) }));
  const credited: { requestId: string; days: number }[] = [];
  for (const [rid, days] of before) {
    const va = s.absences.find((x) => x.id === rid)!;
    const nowDays = countAbsenceDays(emp, va, ctxOf(s, now).cal, currentRules(s, now), s.absences);
    if (nowDays < days) credited.push({ requestId: rid, days: days - nowDays });
  }
  return { absence: a, needs, offers, creditedVacation: credited };
}

/* ---------- admin / privacy ---------- */

export function addRulesVersion(s: State, patch: Partial<Rules> & { effectiveFrom: string }, actor: string, now: string) {
  const base = rulesAt(s.rulesVersions, patch.effectiveFrom);
  const v: Rules = { ...structuredClone(base), ...patch, version: `v${s.rulesVersions.length + 1}` };
  s.rulesVersions.push(v);
  audit(s, actor, 'rules.changed', v.version, now, undefined, { version: base.version }, { version: v.version, effectiveFrom: v.effectiveFrom });
  return v;
}

export function setConsent(s: State, empId: string, p: { consent: boolean; childrenUnder12?: number; carer?: boolean }, actor: string, now: string) {
  let sp = s.sensitive.find((x) => x.employeeId === empId);
  if (!sp) { sp = { employeeId: empId, consent: false }; s.sensitive.push(sp); }
  sp.consent = p.consent;
  if (p.consent) {
    sp.consentDate = day(now); sp.retentionUntil = addDays(day(now), 365);
    sp.childrenUnder12 = p.childrenUnder12; sp.carer = p.carer;
  } else { sp.childrenUnder12 = undefined; sp.carer = undefined; sp.retentionUntil = undefined; }
  audit(s, actor, p.consent ? 'sensitive.consent_given' : 'sensitive.consent_withdrawn', empId, now);
}

export function purgeExpiredSensitive(s: State, now: string) {
  let n = 0;
  for (const sp of s.sensitive) if (sp.retentionUntil && sp.retentionUntil < day(now)) {
    sp.consent = false; sp.childrenUnder12 = undefined; sp.carer = undefined; sp.retentionUntil = undefined; n++;
    audit(s, 'system', 'sensitive.purged', sp.employeeId, now);
  }
  return n;
}

export { slotsOf, balanceOf };
