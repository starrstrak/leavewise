import { Calendar, addDays, diffDays, slotsOf } from './calendar.js';
import { covers, holdsAbsence } from './coverage.js';
import type { Absence, Employee, Rules } from './types.js';

export const round05 = (n: number) => Math.round(n * 2) / 2;

/** Working days per week derived from the schedule (half-day = 0.5). */
export const workDaysPerWeek = (e: Employee) =>
  Object.values(e.schedule).reduce((n, h) => n + h.length, 0) / 2;

const ageOn = (birth: string, date: string) => {
  const y = Number(date.slice(0, 4)) - Number(birth.slice(0, 4));
  return date.slice(5) < birth.slice(5) ? y - 1 : y;
};

/** Yearly entitlement in days, prorated by employment period and by the <20 protection. */
export function entitlementDays(e: Employee, year: number, rules: Rules): number {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const s = e.startDate > from ? e.startDate : from;
  const t = e.endDate && e.endDate < to ? e.endDate : to;
  if (s > t) return 0;
  const yearLen = diffDays(from, to) + 1;
  const perDay = workDaysPerWeek(e);
  const twentieth = `${Number(e.birthDate.slice(0, 4)) + rules.legal.ageProtection}${e.birthDate.slice(4)}`;
  // days of the employment period spent before the 20th birthday
  const underEnd = twentieth <= t ? addDays(twentieth, -1) : t;
  const underDays = underEnd >= s ? diffDays(s, underEnd) + 1 : 0;
  const totalDays = diffDays(s, t) + 1;
  const weeks = (underDays * rules.legal.vacationWeeksUnder20 + (totalDays - underDays) * rules.legal.vacationWeeks) / yearLen;
  return round05(weeks * perDay);
}

/** Days deducted for one absence: scheduled, open, non-closure half-days not already covered by a certified illness. */
export function countAbsenceDays(e: Employee, a: Absence, cal: Calendar, rules: Rules, all: Absence[]): number {
  let halves = 0;
  for (const s of slotsOf(a.start, a.startHalf, a.end, a.endHalf)) {
    const wd = ((new Date(s.date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
    if (!(e.schedule[wd] ?? []).includes(s.half)) continue;
    if (cal.isHoliday(s.date) || cal.isClosure(s.date)) continue;
    if (rules.legal.sicknessCreditsVacation &&
      all.some((o) => o.id !== a.id && o.employeeId === e.id && holdsAbsence(o) && o.certificate &&
        (o.type === 'sickness' || o.type === 'accident') && covers(o, s))) continue;
    halves++;
  }
  return halves / 2;
}

/** Days deducted by collective closures during the year (scheduled half-days). */
export function closureDays(e: Employee, year: number, rules: Rules): number {
  if (!rules.internal.closuresDeductBalance) return 0;
  let halves = 0;
  for (const c of rules.internal.closures) {
    for (let d = c.start; d <= c.end; d = addDays(d, 1)) {
      if (Number(d.slice(0, 4)) !== year || d < e.startDate || (e.endDate && d > e.endDate)) continue;
      const wd = ((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
      halves += (e.schedule[wd] ?? []).length;
    }
  }
  return halves / 2;
}

export interface Balance {
  entitlement: number; carryOverUsable: number; carryOverForfeited: number;
  taken: number; closures: number; remaining: number;
}

/**
 * Balance on `asOf` for `year`. Carry-over is consumed first and forfeited after the expiry date.
 * `extra` lets the engine include accepted-but-not-yet-validated requests.
 */
export function balanceOf(
  e: Employee, year: number, asOf: string, absences: Absence[], cal: Calendar, rules: Rules, extra: Absence[] = [],
): Balance {
  const entitlement = entitlementDays(e, year, rules);
  const carry = Math.min(e.carryOverDays, rules.internal.carryOverMaxDays);
  const expiry = `${year}-${rules.internal.carryOverExpiryMD}`;
  const all = [...absences, ...extra];
  const mine = all.filter((a) => a.employeeId === e.id && a.type === 'vacation' &&
    (holdsAbsence(a) || extra.includes(a)) && Number(a.start.slice(0, 4)) === year);
  let taken = 0, takenBeforeExpiry = 0;
  for (const a of mine) {
    const n = countAbsenceDays(e, a, cal, rules, all);
    taken += n;
    if (a.end <= expiry) takenBeforeExpiry += n;
    else if (a.start <= expiry) takenBeforeExpiry += Math.min(n, countAbsenceDays(e, { ...a, end: expiry, endHalf: 'PM' }, cal, rules, all));
  }
  const closures = closureDays(e, year, rules);
  const carryUsed = Math.min(carry, takenBeforeExpiry);
  const expired = asOf > expiry;
  const usable = expired ? 0 : carry - carryUsed;
  const forfeited = expired ? carry - carryUsed : 0;
  const remaining = entitlement + (expired ? carryUsed : carry) - taken - closures;
  return { entitlement, carryOverUsable: usable, carryOverForfeited: forfeited, taken, closures, remaining };
}

export interface Consecutive { longest: number; min: number; met: boolean }

/**
 * Reminder (non-blocking): at least `legal.minConsecutiveDays` consecutive working days of vacation in the year
 * (indicative CO art. 329c, to be validated). Counts approved, pending and `extra` vacation; consecutive runs are
 * chained across weekends, public holidays and collective closures. Half-days count as whole days.
 */
export function consecutiveVacation(e: Employee, year: number, absences: Absence[], cal: Calendar, rules: Rules, extra: Absence[] = []): Consecutive {
  const mine = [...absences, ...extra].filter((a) => a.employeeId === e.id && a.type === 'vacation' &&
    (a.status === 'approved' || a.status === 'cancel_requested' || a.status === 'submitted' || extra.includes(a)) && Number(a.start.slice(0, 4)) === year);
  const working = (d: string) => {
    const wd = ((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
    return wd <= 5 && !cal.isHoliday(d) && !cal.isClosure(d);
  };
  const days = new Set<string>();
  for (const a of mine) for (let d = a.start; d <= a.end; d = addDays(d, 1)) if (working(d)) days.add(d);
  let longest = 0, run = 0, prev: string | null = null;
  for (const d of [...days].sort()) {
    let chained = false;
    if (prev) {
      chained = true;
      for (let x = addDays(prev, 1); x < d; x = addDays(x, 1)) if (working(x)) { chained = false; break; }
    }
    run = chained ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const min = rules.legal.minConsecutiveDays;
  return { longest, min, met: longest >= min };
}
