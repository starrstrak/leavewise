import { addDays, mondayOf, slotHours, slotMinutes, toMin, weekday } from './calendar.js';
import { Ctx, isAbsent, isActive, isScheduled } from './coverage.js';
import type { Absence, Employee, Half, QualCode, Reason, Slot } from './types.js';

export interface Candidate { employeeId: string; score: number; reasons: Reason[] }
export interface Rejected { employeeId: string; reasons: Reason[] }

const info = (code: string, params?: Reason['params']): Reason => ({ code, params, severity: 'info' });
const block = (code: string, params?: Reason['params']): Reason => ({ code, params, severity: 'block' });

/** Can this employee stand in for `qual`? Apprentices/interns never count as qualified. */
export function canStandIn(e: Employee, qual: QualCode, ctx: Ctx): boolean {
  return e.qualifications.some((c) => {
    const q = ctx.qualifications.find((x) => x.code === c);
    if (!q) return false;
    if (qual === 'pharmacist') return q.countsAsQualified && q.canOpen && !q.mustBeSupervised;
    return q.canReplace.includes(qual);
  });
}

interface Ev { date: string; start: number; end: number }

function eventsOf(e: Employee, ctx: Ctx, absences: Absence[], around: string, span = 2): Ev[] {
  const evs: Ev[] = [];
  for (let d = addDays(around, -span); d <= addDays(around, span); d = addDays(d, 1)) {
    for (const half of ['AM', 'PM'] as Half[]) {
      const s: Slot = { date: d, half };
      const worked = (isScheduled(e, s, weekday(d)) && ctx.cal.isOpen(d, half)) ||
        ctx.assignments.some((a) => a.employeeId === e.id && a.date === d && a.half === half);
      if (worked && !isAbsent(e.id, s, absences)) evs.push({ date: d, ...slotMinutes(d, half, ctx.rules) });
    }
  }
  for (const b of e.extraBlocks ?? []) evs.push({ date: b.start.slice(0, 10), start: toMin(b.start), end: toMin(b.end) });
  return evs;
}

/** Daily rest check: gap between working days must be >= dailyRestHours. */
export function restViolation(e: Employee, slot: Slot, ctx: Ctx, absences: Absence[]): number | null {
  const me = slotMinutes(slot.date, slot.half, ctx.rules);
  const evs = eventsOf(e, ctx, absences, slot.date);
  const sameDay = evs.filter((x) => x.date === slot.date);
  const dayStart = Math.min(me.start, ...sameDay.map((x) => x.start));
  const dayEnd = Math.max(me.end, ...sameDay.map((x) => x.end));
  const need = ctx.rules.legal.dailyRestHours * 60;
  let worst: number | null = null;
  for (const x of evs) {
    if (x.date === slot.date) continue;
    const gap = x.date < slot.date ? dayStart - x.end : x.start - dayEnd;
    if (gap < need) worst = worst === null ? gap : Math.min(worst, gap);
  }
  return worst;
}

/**
 * Weekly rest (LTr art. 21, value to be validated by a legal professional): in each ISO week touched by
 * `slots`, at least one uninterrupted gap >= legal.weeklyRestHours between work events (extra blocks included).
 * A gap counts for the week in which it starts. Returns the best gap in minutes of the first non-compliant week, else null.
 */
export function weeklyRestViolation(e: Employee, slots: Slot[], ctx: Ctx, absences: Absence[]): number | null {
  const need = ctx.rules.legal.weeklyRestHours * 60;
  for (const mon of [...new Set(slots.map((s) => mondayOf(s.date)))].sort()) {
    const evs = eventsOf(e, ctx, absences, addDays(mon, 3), 10)
      .concat(slots.filter((s) => mondayOf(s.date) === mon).map((s) => ({ date: s.date, ...slotMinutes(s.date, s.half, ctx.rules) })))
      .sort((a, b) => a.start - b.start);
    const wStart = toMin(mon), wEnd = wStart + 7 * 1440;
    let best = 0, prevEnd = -Infinity;
    for (const x of [...evs, { date: '', start: Infinity, end: Infinity }]) {
      if (prevEnd >= wStart && prevEnd < wEnd) best = Math.max(best, x.start - prevEnd);
      prevEnd = Math.max(prevEnd, x.end);
    }
    if (best < need) return best;
  }
  return null;
}

export function weekHours(e: Employee, date: string, ctx: Ctx, absences: Absence[]): number {
  let h = 0;
  const mon = mondayOf(date);
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    for (const half of ['AM', 'PM'] as Half[]) {
      const s: Slot = { date: d, half };
      const worked = (isScheduled(e, s, weekday(d)) && ctx.cal.isOpen(d, half)) ||
        ctx.assignments.some((a) => a.employeeId === e.id && a.date === d && a.half === half);
      if (worked && !isAbsent(e.id, s, absences)) h += slotHours(half, ctx.rules);
    }
  }
  return h;
}

export function rankCandidates(
  slot: Slot, qual: QualCode, ctx: Ctx, absences: Absence[], excludeIds: string[] = [], together: Slot[] = [slot],
): { ranked: Candidate[]; rejected: Rejected[] } {
  const ranked: Candidate[] = [], rejected: Rejected[] = [];
  const wd = weekday(slot.date);
  for (const e of ctx.employees) {
    const why: Reason[] = [];
    if (excludeIds.includes(e.id)) why.push(block('already_declined'));
    if (!isActive(e, slot.date)) why.push(block('employment_inactive'));
    if (!canStandIn(e, qual, ctx)) why.push(block('not_qualified', { qualification: qual }));
    if (isAbsent(e.id, slot, absences)) why.push(block('candidate_absent'));
    if (isScheduled(e, slot, wd) || ctx.assignments.some((a) => a.employeeId === e.id && a.date === slot.date && a.half === slot.half))
      why.push(block('already_working'));
    if (e.unavailableDates?.includes(slot.date) || (e.availableWeekdays && !e.availableWeekdays.includes(wd)))
      why.push(block('candidate_unavailable'));
    if (why.length === 0) {
      const maxH = e.maxWeeklyHours ?? ctx.rules.legal.maxWeeklyHours;
      const hours = weekHours(e, slot.date, ctx, absences);
      const add = slotHours(slot.half, ctx.rules);
      if (hours + add > maxH) why.push(block('weekly_hours', { hours: hours + add, max: maxH }));
      const gap = restViolation(e, slot, ctx, absences);
      if (gap !== null) why.push(block('rest_daily', { gapHours: Math.round(gap / 6) / 10, min: ctx.rules.legal.dailyRestHours }));
      const wk = weeklyRestViolation(e, together, ctx, absences);
      if (wk !== null) why.push(block('weekly_rest', { gapHours: Math.round(wk / 6) / 10, min: ctx.rules.legal.weeklyRestHours }));
      if (why.length === 0) {
        const reasons: Reason[] = [info('qualified')];
        let score = 40;
        const headroom = Math.max(0, (maxH - hours) / maxH) * 30;
        score += headroom; reasons.push(info('hours_headroom', { hours }));
        if (e.preferredWeekdays?.includes(wd)) { score += 10; reasons.push(info('preferred_day')); }
        if (e.status === 'part_time' || e.occupancy < 1) { score += (1 - e.occupancy) * 10; reasons.push(info('part_time_headroom')); }
        if (e.status === 'external_temp') { score += 10; reasons.push(info('external_no_overtime')); }
        ranked.push({ employeeId: e.id, score: Math.round(score * 10) / 10, reasons });
        continue;
      }
    }
    rejected.push({ employeeId: e.id, reasons: why });
  }
  ranked.sort((a, b) => b.score - a.score || a.employeeId.localeCompare(b.employeeId));
  return { ranked, rejected };
}
