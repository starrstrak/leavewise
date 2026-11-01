import { diffDays, parse, addDays } from './calendar.js';
import type { Calendar } from './calendar.js';
import type { Absence, LeaveKind, Reason, Rules } from './types.js';

const LEAVE_KINDS: string[] = ['special', 'maternity', 'paternity', 'carer'];
export const isLeaveKind = (t: string): t is LeaveKind => LEAVE_KINDS.includes(t);

function lengthOf(a: Pick<Absence, 'start' | 'end'>, unit: 'calendar' | 'working', cal: Calendar): number {
  if (unit === 'calendar') return diffDays(a.start, a.end) + 1;
  let n = 0;
  for (let d = a.start; d <= a.end; d = addDays(d, 1)) {
    const wd = ((parse(d).getUTCDay() + 6) % 7) + 1;
    if (wd <= 5 && !cal.isHoliday(d) && !cal.isClosure(d)) n++;
  }
  return n;
}

/**
 * Non-blocking information for special leave, maternity, paternity and carer leave.
 * The defaults are parameters "à valider par un juriste": the engine shows them, it never presents them as a guaranteed right.
 */
export function leaveReasons(req: Absence, rules: Rules, cal: Calendar, sameYear: Absence[]): Reason[] {
  if (!isLeaveKind(req.type)) return [];
  const def = rules.legal.leaves?.[req.type];
  if (!def) return [];
  const out: Reason[] = [];
  const len = lengthOf(req, def.unit, cal);
  out.push({ code: 'leave_default', severity: 'info', params: { type: req.type, days: def.days, unit: def.unit, length: len } });
  out.push({ code: 'leave_to_validate', severity: 'info', params: { basis: def.basis } });
  if (len > def.days) out.push({ code: 'leave_exceeds_default', severity: 'warn', params: { length: len, days: def.days } });
  if (def.proof && !req.certificate) out.push({ code: 'leave_proof_required', severity: 'warn', params: { proof: def.proof } });
  if (def.yearlyMaxDays !== undefined) {
    const used = sameYear.reduce((n, o) => n + lengthOf(o, def.unit, cal), 0);
    if (used + len > def.yearlyMaxDays) out.push({ code: 'leave_yearly_cap', severity: 'warn', params: { total: used + len, max: def.yearlyMaxDays } });
  }
  return out;
}
