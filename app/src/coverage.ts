import { Calendar, makeCalendar, slotsOf } from './calendar.js';
import type { Absence, Employee, Half, Qualification, Rules, Slot, State } from './types.js';

export interface Ctx {
  employees: Employee[];
  absences: Absence[];
  assignments: State['assignments'];
  closedSlots: State['closedSlots'];
  qualifications: Qualification[];
  rules: Rules;
  cal: Calendar;
}

export function makeCtx(state: State, rules: Rules): Ctx {
  return {
    employees: state.employees, absences: state.absences, assignments: state.assignments,
    closedSlots: state.closedSlots, qualifications: state.qualifications, rules, cal: makeCalendar(rules),
  };
}

export const isActive = (e: Employee, date: string) => date >= e.startDate && (!e.endDate || date <= e.endDate);
export const holdsAbsence = (a: Absence) => a.status === 'approved' || a.status === 'cancel_requested';
export const covers = (a: Absence, s: Slot) => {
  if (s.date < a.start || s.date > a.end) return false;
  if (s.date === a.start && a.startHalf === 'PM' && s.half === 'AM') return false;
  if (s.date === a.end && a.endHalf === 'AM' && s.half === 'PM') return false;
  return true;
};
export const isAbsent = (empId: string, s: Slot, absences: Absence[]) =>
  absences.some((a) => a.employeeId === empId && covers(a, s));

export const isScheduled = (e: Employee, s: Slot, wd: number) => (e.schedule[wd] ?? []).includes(s.half);

export const qualifiedFor = (e: Employee, ctx: Ctx) =>
  e.qualifications.some((q) => ctx.qualifications.find((x) => x.code === q)?.countsAsQualified &&
    ctx.qualifications.find((x) => x.code === q)?.canOpen);

export interface SlotCover { slot: Slot; qualified: number; headcount: number; absent: number; scheduled: number }
export interface Violation { slot: Slot; code: 'coverage_pharmacist' | 'coverage_headcount' | 'coverage_max_absent' }

function weekdayOf(date: string) { return ((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1; }

export function coverOfSlot(s: Slot, ctx: Ctx, absences: Absence[]): SlotCover {
  const wd = weekdayOf(s.date);
  let qualified = 0, headcount = 0, absent = 0, scheduled = 0;
  const seen = new Set<string>();
  for (const e of ctx.employees) {
    if (!isActive(e, s.date)) continue;
    const sched = isScheduled(e, s, wd);
    const assigned = ctx.assignments.some((a) => a.employeeId === e.id && a.date === s.date && a.half === s.half);
    if (!sched && !assigned) continue;
    if (sched) scheduled++;
    if (isAbsent(e.id, s, absences)) { if (sched) absent++; continue; }
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    headcount++;
    if (qualifiedFor(e, ctx)) qualified++;
  }
  return { slot: s, qualified, headcount, absent, scheduled };
}

export const isOpenSlot = (s: Slot, ctx: Ctx) =>
  ctx.cal.isOpen(s.date, s.half) && !ctx.closedSlots.some((c) => c.date === s.date && c.half === s.half);

export function violations(slots: Slot[], ctx: Ctx, absences: Absence[]): Violation[] {
  const out: Violation[] = [];
  const c = ctx.rules.coverage;
  for (const s of slots) {
    if (!isOpenSlot(s, ctx)) continue;
    const cv = coverOfSlot(s, ctx, absences);
    if (cv.qualified < c.minQualified) out.push({ slot: s, code: 'coverage_pharmacist' });
    else if (cv.headcount < c.minHeadcount) out.push({ slot: s, code: 'coverage_headcount' });
    else if (cv.absent > c.maxSimultaneousAbsent) out.push({ slot: s, code: 'coverage_max_absent' });
  }
  return out;
}

/** Absences currently holding (approved) plus optional extras, minus ignored ids. */
export function activeAbsences(ctx: Ctx, extra: Absence[] = [], ignore: Set<string> = new Set()) {
  return [...ctx.absences.filter((a) => holdsAbsence(a) && !ignore.has(a.id)), ...extra];
}

/** Violations created by `req` itself (pre-existing gaps are not charged to it). */
export function newViolations(req: Absence, ctx: Ctx, base: Absence[]): Violation[] {
  const slots = slotsOfAbsence(req);
  const had = new Set(violations(slots, ctx, base).map((v) => `${v.slot.date}|${v.slot.half}|${v.code}`));
  return violations(slots, ctx, [...base, req]).filter((v) => !had.has(`${v.slot.date}|${v.slot.half}|${v.code}`));
}

export function slotsOfAbsence(a: Pick<Absence, 'start' | 'end' | 'startHalf' | 'endHalf'>): Slot[] {
  return slotsOf(a.start, a.startHalf, a.end, a.endHalf);
}

/** Minimum margin (qualified present beyond requirement) over open slots. */
export function minMargin(slots: Slot[], ctx: Ctx, absences: Absence[], qualifiedMatters = true) {
  let m = Infinity;
  for (const s of slots) {
    if (!isOpenSlot(s, ctx)) continue;
    const cv = coverOfSlot(s, ctx, absences);
    m = Math.min(m, qualifiedMatters ? cv.qualified - ctx.rules.coverage.minQualified : Infinity, cv.headcount - ctx.rules.coverage.minHeadcount);
  }
  return m;
}

export type { Half };
