import { addDays, diffDays } from './calendar.js';
import { balanceOf, consecutiveVacation } from './balance.js';
import {
  Ctx, activeAbsences, makeCtx, minMargin, newViolations, qualifiedFor, slotsOfAbsence,
} from './coverage.js';
import { leaveReasons } from './leaves.js';
import { rankCandidates } from './replacement.js';
import { rulesAt } from './rules.js';
import type {
  Absence, Alternative, Decision, Employee, Reason, Rules, ScoreBreakdown, Slot, State,
} from './types.js';

const block = (code: string, params?: Reason['params']): Reason => ({ code, params, severity: 'block' });
const info = (code: string, params?: Reason['params']): Reason => ({ code, params, severity: 'info' });
const warn = (code: string, params?: Reason['params']): Reason => ({ code, params, severity: 'warn' });
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const overlaps = (a: Pick<Absence, 'start' | 'end'>, b: Pick<Absence, 'start' | 'end'>) => a.start <= b.end && b.start <= a.end;

/** Step 1a: hard filters that do not depend on competing requests (legal, internal rules). */
export function ruleBlocks(req: Absence, emp: Employee, ctx: Ctx, accepted: Absence[], state: State): Reason[] {
  const r = ctx.rules, cfg = r.absenceTypes[req.type], out: Reason[] = [];
  if (req.start < emp.startDate || (emp.endDate && req.end > emp.endDate)) out.push(block('not_employed'));
  if (cfg.notice) {
    const days = diffDays(req.submittedAt.slice(0, 10), req.start);
    if (days < r.internal.minNoticeDays) {
      if (req.urgent && r.internal.urgentWaivesNotice) out.push(info('urgent_notice_waived', { days, min: r.internal.minNoticeDays }));
      else out.push(block('notice_too_short', { days, min: r.internal.minNoticeDays }));
    }
  }
  if (cfg.blackout) {
    for (const b of r.internal.blackouts) if (overlaps(req, b)) {
      out.push(block('blackout', { label: b.label ?? b.id, start: b.start, end: b.end }));
      if (req.urgent) out.push(warn('urgent_requires_human'));
    }
    const sub = req.submittedAt.slice(0, 10);
    for (const d of r.internal.deadlines) if (overlaps(req, d) && sub > d.deadline) out.push(block('late_deadline', { deadline: d.deadline }));
  }
  if (cfg.maxConsecutive) {
    const days = diffDays(req.start, req.end) + 1;
    if (days > r.internal.maxConsecutiveDays) out.push(block('max_consecutive', { days, max: r.internal.maxConsecutiveDays }));
  }
  if (cfg.deductsBalance) {
    const year = Number(req.start.slice(0, 4));
    const mine = accepted.filter((a) => a.employeeId === emp.id);
    const b = balanceOf(emp, year, req.start, state.absences.filter((a) => a.id !== req.id), ctx.cal, r, [...mine, req]);
    if (b.remaining < 0 && !r.internal.allowNegativeBalance) out.push(block('balance_negative', { remaining: b.remaining }));
    else if (b.remaining < 0) out.push(warn('balance_negative_allowed', { remaining: b.remaining }));
  }
  const sameYear = state.absences.filter((a) => a.id !== req.id && a.employeeId === emp.id && a.type === req.type &&
    a.status === 'approved' && a.start.slice(0, 4) === req.start.slice(0, 4));
  out.push(...leaveReasons(req, r, ctx.cal, sameYear));
  if (req.type === 'vacation') {
    const year = Number(req.start.slice(0, 4));
    const c = consecutiveVacation(emp, year, state.absences.filter((a) => a.id !== req.id), ctx.cal, r, [...accepted.filter((a) => a.employeeId === emp.id), req]);
    if (!c.met) out.push(info('min_consecutive_reminder', { longest: c.longest, min: c.min, year }));
  }
  return out;
}

function peakOverlap(req: Absence, rules: Rules) {
  const y = Number(req.start.slice(0, 4));
  for (const p of rules.peakPeriods) {
    const wraps = p.startMD > p.endMD;
    const spans = wraps
      ? [{ start: `${y - 1}-${p.startMD}`, end: `${y}-${p.endMD}` }, { start: `${y}-${p.startMD}`, end: `${y + 1}-${p.endMD}` }]
      : [{ start: `${y}-${p.startMD}`, end: `${y}-${p.endMD}` }];
    if (spans.some((s) => overlaps(req, s))) return p.id;
  }
  return null;
}

function daysIn(emp: Employee, state: State, from: string, ctx: Ctx) {
  let n = 0;
  for (const a of state.absences) {
    if (a.employeeId !== emp.id || a.type !== 'vacation' || a.status !== 'approved' || a.start < from) continue;
    n += (diffDays(a.start, a.end) + 1);
  }
  return n;
}

/** Step 2: priority score. Family criterion is an optional bonus, never a penalty. */
export function scoreOf(req: Absence, emp: Employee, state: State, ctx: Ctx, orderRank: number, batch: number): ScoreBreakdown {
  const r = ctx.rules, w = r.priority.weights;
  const from = addDays(req.start, -r.historyWindowDays);
  const staff = state.employees.filter((e) => e.status !== 'external_temp');
  const mine = daysIn(emp, state, from, ctx);
  const avg = staff.reduce((s, e) => s + daysIn(e, state, from, ctx), 0) / Math.max(1, staff.length);
  const equity = clamp(50 + (50 * (avg - mine)) / Math.max(avg, 1));
  const peak = peakOverlap(req, r);
  let rotation = 50;
  if (peak) {
    const h = state.peakHistory.filter((p) => p.employeeId === emp.id && p.peakId === peak);
    const granted = h.filter((p) => p.granted).length, refused = h.filter((p) => p.requested && !p.granted).length;
    rotation = clamp(50 - 20 * granted + 20 * refused);
  }
  const urgency = req.urgent ? 100 : 0;
  const order = batch <= 1 ? 100 : (100 * (batch - 1 - orderRank)) / (batch - 1);
  const sp = state.sensitive.find((s) => s.employeeId === emp.id);
  const familyActive = !!(r.priority.sensitiveEnabled && sp?.consent);
  let family = 0;
  if (familyActive && sp) {
    if ((sp.childrenUnder12 ?? 0) > 0) family = peak ? 100 : 50;
    if (sp.carer) family = Math.max(family, 80);
  }
  const base = w.equity + w.rotation + w.urgency + w.order;
  const baseScore = (w.equity * equity + w.rotation * rotation + w.urgency * urgency + w.order * order) / base;
  const total = Math.round((baseScore + (familyActive ? (w.family * family) / 100 : 0)) * 100) / 100;
  return { equity: Math.round(equity), rotation: Math.round(rotation), urgency, order: Math.round(order), family, familyActive, weights: { ...w }, total };
}

function segments(oks: boolean[], slots: Slot[]) {
  const out: Slot[][] = [];
  let cur: Slot[] = [];
  oks.forEach((ok, i) => {
    if (ok) cur.push(slots[i]); else if (cur.length) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out;
}

/** Step 3: alternative scenarios for a request blocked by coverage. */
export function alternatives(req: Absence, emp: Employee, ctx: Ctx, accepted: Absence[], state: State): Alternative[] {
  const alts: Alternative[] = [];
  const slots = slotsOfAbsence(req);
  const base = activeAbsences(ctx, accepted);
  const bad = new Set(newViolations(req, ctx, base).map((v) => `${v.slot.date}|${v.slot.half}`));
  const oks = slots.map((s) => !bad.has(`${s.date}|${s.half}`));
  const segs = segments(oks, slots);
  const usable = (a: Absence) => ruleBlocks(a, emp, ctx, accepted, state).every((x) => x.severity !== 'block');
  // partial: longest segment
  const longest = [...segs].sort((a, b) => b.length - a.length)[0];
  if (longest && longest.length < slots.length) {
    const cand = { ...req, start: longest[0].date, startHalf: longest[0].half, end: longest.at(-1)!.date, endHalf: longest.at(-1)!.half };
    if (usable(cand)) alts.push({ kind: 'partial', params: { start: cand.start, end: cand.end, halfDays: longest.length }, start: cand.start, end: cand.end, startHalf: cand.startHalf, endHalf: cand.endHalf });
  }
  if (segs.length >= 2) alts.push({ kind: 'split', params: { parts: segs.length, ranges: segs.map((s) => `${s[0].date}→${s.at(-1)!.date}`).join(' ; ') } });
  // shift
  let found = 0;
  for (let d = 1; d <= 28 && found < 2; d++) {
    for (const off of [d, -d]) {
      if (found >= 2) break;
      const cand: Absence = { ...req, start: addDays(req.start, off), end: addDays(req.end, off) };
      if (usable(cand) && newViolations(cand, ctx, base).length === 0) {
        alts.push({ kind: 'shift', params: { offsetDays: off, start: cand.start, end: cand.end }, start: cand.start, end: cand.end, startHalf: cand.startHalf, endHalf: cand.endHalf });
        found++;
      }
    }
  }
  // replacement
  const viol = newViolations(req, ctx, base);
  if (viol.length) {
    const tops: string[] = [];
    let all = true;
    for (const v of viol) {
      const { ranked } = rankCandidates(v.slot, 'pharmacist', ctx, [...base, req], [], viol.map((x) => x.slot));
      if (!ranked.length) { all = false; break; }
      tops.push(ranked[0].employeeId);
    }
    if (all) {
      const first = state.employees.find((e) => e.id === tops[0])!;
      alts.push({ kind: 'replacement', params: { halfDays: viol.length, candidate: first.name } });
    }
  }
  return alts;
}

export interface ProposeOptions { now: string; requests?: Absence[] }

/** Full pipeline. Pure: does not mutate `state`. */
export function propose(state: State, opts: ProposeOptions): Decision[] {
  const pending = (opts.requests ?? state.absences.filter((a) => a.status === 'submitted'))
    .slice().sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id));
  const orderRank = new Map(pending.map((p, i) => [p.id, i]));
  const decisions: Decision[] = [];
  type Item = { req: Absence; emp: Employee; ctx: Ctx; score: ScoreBreakdown | null };
  const items: Item[] = [];
  const accepted: Absence[] = [];

  for (const req of pending) {
    const emp = state.employees.find((e) => e.id === req.employeeId)!;
    const rules = rulesAt(state.rulesVersions, req.submittedAt.slice(0, 10));
    const ctx = makeCtx(state, rules);
    const score = scoreOf(req, emp, state, ctx, orderRank.get(req.id)!, pending.length);
    items.push({ req, emp, ctx, score });
  }

  const order = [...items].sort((a, b) => b.score!.total - a.score!.total
    || a.req.submittedAt.localeCompare(b.req.submittedAt) || a.emp.id.localeCompare(b.emp.id));
  const tieIds = new Set<string>();
  for (const a of items) for (const b of items) {
    if (a !== b && overlaps(a.req, b.req) && Math.abs(a.score!.total - b.score!.total) < 0.005) tieIds.add(a.req.id);
  }

  for (const it of order) {
    const { req, emp, ctx } = it;
    const cfg = ctx.rules.absenceTypes[req.type];
    const finalReasons: Reason[] = ruleBlocks(req, emp, ctx, accepted, state);

    const slots = slotsOfAbsence(req);
    const viol = newViolations(req, ctx, activeAbsences(ctx, accepted));
    const hardBlocked = finalReasons.some((r) => r.severity === 'block');
    let outcome: Decision['outcome'] = 'approve';
    let alts: Alternative[] = [];

    if (viol.length) {
      const codes = [...new Set(viol.map((v) => v.code))];
      for (const c of codes) {
        const first = viol.find((v) => v.code === c)!;
        const rival = accepted.find((a) => a.employeeId !== req.employeeId && slotsOfAbsence(a).some((s) => s.date === first.slot.date && s.half === first.slot.half));
        finalReasons.push(cfg.needsApproval ? block(c, { date: first.slot.date, half: first.slot.half, count: viol.filter((v) => v.code === c).length })
          : warn(c, { date: first.slot.date, half: first.slot.half, count: viol.length }));
        if (rival && cfg.needsApproval) finalReasons.push(info('competing_request', { requestId: rival.id }));
      }
    }
    const blocked = finalReasons.some((r) => r.severity === 'block');
    if (!cfg.needsApproval) outcome = viol.length ? 'needs_replacement' : 'approve';
    else if (blocked) outcome = 'impossible';
    if (outcome === 'impossible' && viol.length) alts = alternatives(req, emp, ctx, accepted, state);
    if (outcome === 'impossible' && !viol.length && hardBlocked) {
      // rule block (not coverage): try shifting
      alts = alternatives(req, emp, ctx, accepted, state).filter((a) => a.kind === 'shift');
    }
    let risk: Decision['risk'] = 'high';
    if (outcome !== 'impossible') {
      if (!viol.length) {
        accepted.push(req);
        const margin = minMargin(slots, ctx, [...activeAbsences(ctx, accepted.filter((a) => a.id !== req.id)), req], qualifiedFor(emp, ctx));
        const rival = pending.some((p) => p.id !== req.id && p.employeeId !== req.employeeId && overlaps(p, req));
        risk = margin >= 1 && !rival ? 'zero' : 'low';
        finalReasons.push(info('approve_filters_ok', { margin: Number.isFinite(margin) ? margin : 0 }));
      } else accepted.push(req);
    }
    if (tieIds.has(req.id)) finalReasons.push(info('tie_broken', { rule: 'filing_order' }));
    const seen = new Set<string>();
    const uniq = finalReasons.filter((r) => { const k = r.code + JSON.stringify(r.params); return seen.has(k) ? false : (seen.add(k), true); });
    decisions.push({
      id: '', requestId: req.id, outcome, status: 'proposed', reasons: uniq,
      score: it.score, alternatives: alts, risk, tie: tieIds.has(req.id), author: 'system', ts: opts.now,
    });
  }
  const byReq = new Map(decisions.map((d) => [d.requestId, d]));
  return pending.map((p) => byReq.get(p.id)!);
}
