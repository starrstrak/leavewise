import type { Half, HolidayDef, Rules, Slot } from './types.js';

const MS = 86400000;
export const parse = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00Z');
export const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => fmt(new Date(parse(s).getTime() + n * MS));
export const diffDays = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / MS);
/** ISO weekday 1=Mon..7=Sun */
export const weekday = (s: string) => ((parse(s).getUTCDay() + 6) % 7) + 1;
export const mondayOf = (s: string) => addDays(s, 1 - weekday(s));

/** Anonymous Gregorian algorithm */
export function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function holidaysOf(year: number, defs: HolidayDef[], scope: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of defs) {
    if (h.scopes && !h.scopes.includes(scope)) continue;
    const date = h.fixed ? `${year}-${h.fixed}` : addDays(easter(year), h.easter ?? 0);
    out.set(date, h.id);
  }
  return out;
}

export interface Calendar {
  isHoliday(date: string): boolean;
  isClosure(date: string): boolean;
  /** pharmacy open for this half-day (ignores plan-B closures) */
  isOpen(date: string, half: Half): boolean;
}

export function makeCalendar(rules: Rules): Calendar {
  const cache = new Map<number, Map<string, string>>();
  const hol = (date: string) => {
    const y = Number(date.slice(0, 4));
    if (!cache.has(y)) cache.set(y, holidaysOf(y, rules.holidays, rules.holidayScope));
    return cache.get(y)!;
  };
  const isHoliday = (d: string) => hol(d).has(d);
  const isClosure = (d: string) => rules.internal.closures.some((c) => d >= c.start && d <= c.end);
  return {
    isHoliday, isClosure,
    isOpen(date, half) {
      if (isHoliday(date) || isClosure(date)) return false;
      const wd = weekday(date);
      if (wd === 6) return rules.opening.saturdayHalves.includes(half);
      return rules.opening.weekdays.includes(wd);
    },
  };
}

/** Expand [start startHalf .. end endHalf] into half-day slots. */
export function slotsOf(start: string, startHalf: Half, end: string, endHalf: Half): Slot[] {
  const out: Slot[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    for (const h of ['AM', 'PM'] as Half[]) {
      if (d === start && startHalf === 'PM' && h === 'AM') continue;
      if (d === end && endHalf === 'AM' && h === 'PM') continue;
      out.push({ date: d, half: h });
    }
  }
  return out;
}

export const slotKey = (s: Slot) => `${s.date}|${s.half}`;
export const toMin = (iso: string) => Math.round(new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso + ':00Z').getTime() / 60000);
export const slotMinutes = (date: string, half: Half, rules: Rules) => {
  const t = rules.slotTimes[half];
  return { start: toMin(`${date}T${t.start}`), end: toMin(`${date}T${t.end}`) };
};
export const slotHours = (half: Half, rules: Rules) => {
  const t = rules.slotTimes[half];
  return (toMin(`2000-01-01T${t.end}`) - toMin(`2000-01-01T${t.start}`)) / 60;
};
