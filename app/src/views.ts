import { balanceOf, consecutiveVacation } from './balance.js';
import { makeCtx } from './coverage.js';
import { isHr, currentRules } from './actions.js';
import { renderAlt, renderReason, Lang } from './i18n.js';
import type { Decision, Employee, State } from './types.js';

/** Sensitive family criterion is shown only to HR/admin; for others the score is recomputed without it. */
export function viewDecision(d: Decision, viewer: Employee, lng: Lang) {
  const privileged = isHr(viewer);
  let score = d.score;
  if (score && !privileged) {
    const bonus = score.familyActive ? (score.weights.family * score.family) / 100 : 0;
    score = { ...score, family: 0, familyActive: false, total: Math.round((score.total - bonus) * 100) / 100 };
  }
  return {
    ...d, score,
    reasonsText: d.reasons.map((r) => ({ severity: r.severity, code: r.code, text: renderReason(lng, r) })),
    alternativesText: d.alternatives.map((a) => ({ kind: a.kind, text: renderAlt(lng, a), start: a.start, end: a.end, startHalf: a.startHalf, endHalf: a.endHalf })),
  };
}

export function canSeeEmployee(viewer: Employee, target: Employee) {
  return isHr(viewer) || viewer.id === target.id || (viewer.role === 'manager' && target.managerIds.includes(viewer.id));
}

export function balancesFor(s: State, now: string, viewer: Employee) {
  const rules = currentRules(s, now);
  const cal = makeCtx(s, rules).cal;
  const year = Number(now.slice(0, 4));
  return s.employees.filter((e) => canSeeEmployee(viewer, e) && e.status !== 'external_temp')
    .map((e) => ({ employeeId: e.id, name: e.name, ...balanceOf(e, year, now.slice(0, 10), s.absences, cal, rules), consecutive: consecutiveVacation(e, year, s.absences, cal, rules) }));
}
