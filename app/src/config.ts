// Workspace setup: blank state, organisation, qualifications and team management (owner space).
import { audit, DomainError, nextId } from './actions.js';
import { defaultRules } from './rules.js';
import * as V from './validate.js';
import type { Employee, Half, Qualification, State } from './types.js';

const STATUSES = ['employee', 'part_time', 'apprentice', 'intern', 'external_temp', 'manager'] as const;
const ROLES = ['employee', 'manager', 'hr', 'admin'] as const;
export const OWNER_ID = 'emp-owner';

/** Neutral starter qualifications; the owner renames, adds or removes them. */
export const starterQualifications = (): Qualification[] => [
  { code: 'qualified', label: 'Personne qualifiée', canOpen: true, countsAsQualified: true, mustBeSupervised: false, canReplace: ['qualified', 'staff', 'admin'] },
  { code: 'staff', label: 'Collaborateur·trice', canOpen: false, countsAsQualified: false, mustBeSupervised: false, canReplace: ['staff'] },
  { code: 'trainee', label: 'Apprenti·e / stagiaire', canOpen: false, countsAsQualified: false, mustBeSupervised: true, canReplace: [] },
  { code: 'admin', label: 'Administration', canOpen: false, countsAsQualified: false, mustBeSupervised: false, canReplace: ['admin'] },
];

/** Empty workspace: one admin (the owner), neutral rules, no absence, no sector-specific periods. */
export function blankState(): State {
  const rules = structuredClone(defaultRules);
  rules.effectiveFrom = '2000-01-01';
  rules.internal.blackouts = []; rules.internal.closures = []; rules.internal.deadlines = [];
  rules.peakPeriods = [];
  return {
    employees: [{ id: OWNER_ID, name: 'Vous (administrateur)', status: 'employee', role: 'admin', qualifications: ['admin'], occupancy: 1, schedule: {},
      startDate: '2000-01-01', managerIds: [], birthDate: '1980-01-01', carryOverDays: 0 }],
    absences: [], decisions: [], replacements: [], assignments: [], closedSlots: [], notifications: [], audit: [],
    rulesVersions: [rules], qualifications: starterQualifications(), sensitive: [], peakHistory: [], seq: 100,
    org: { name: '', sector: '' },
  };
}

export function setOrg(s: State, input: unknown, actor: string, now: string) {
  const b = V.body(input);
  s.org = { name: V.text(b.name ?? '', 'name', 80), sector: V.text(b.sector ?? '', 'sector', 80) };
  audit(s, actor, 'config.org', 'org', now);
  return s.org;
}

export function setQualifications(s: State, input: unknown, actor: string, now: string) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) throw new V.ValidationError('invalid_list', 'qualifications');
  const out: Qualification[] = [];
  for (const [i, raw] of input.entries()) {
    const q = V.body(raw);
    const code = V.id(q.code, `qualifications[${i}].code`);
    if (out.some((x) => x.code === code)) throw new V.ValidationError('duplicate_code', `qualifications[${i}].code`);
    out.push({
      code, label: V.text(q.label ?? code, `qualifications[${i}].label`, 60) || code,
      canOpen: V.bool(q.canOpen, 'canOpen'), countsAsQualified: V.bool(q.countsAsQualified, 'countsAsQualified'),
      mustBeSupervised: V.bool(q.mustBeSupervised, 'mustBeSupervised'),
      canReplace: Array.isArray(q.canReplace) ? q.canReplace.map((c) => V.id(c, 'canReplace')) : [],
    });
  }
  const codes = new Set(out.map((q) => q.code));
  for (const q of out) q.canReplace = q.canReplace.filter((c) => codes.has(c));
  for (const e of s.employees) {
    const missing = e.qualifications.find((c) => !codes.has(c));
    if (missing) throw new DomainError('qualification_in_use', `${missing} (${e.name})`);
  }
  s.qualifications = out;
  audit(s, actor, 'config.qualifications', 'qualifications', now, undefined, undefined, { codes: [...codes] });
  return out;
}

function employeeFields(s: State, b: Record<string, unknown>, id: string): Employee {
  const codes = new Set(s.qualifications.map((q) => q.code));
  const quals = Array.isArray(b.qualifications) ? b.qualifications.map((c) => V.id(c, 'qualifications')) : [];
  if (quals.some((c) => !codes.has(c))) throw new V.ValidationError('unknown_qualification', 'qualifications');
  const schedule: Record<number, Half[]> = {};
  if (b.schedule !== undefined) {
    const sc = V.body(b.schedule);
    for (const [k, v] of Object.entries(sc)) {
      const wd = Number(k);
      if (!Number.isInteger(wd) || wd < 1 || wd > 6) throw new V.ValidationError('invalid_weekday', 'schedule');
      if (!Array.isArray(v)) throw new V.ValidationError('invalid_list', 'schedule');
      const hs = [...new Set(v.map((h) => V.halves(h, 'schedule')))];
      if (hs.length) schedule[wd] = hs;
    }
  }
  const managerIds = Array.isArray(b.managerIds) ? b.managerIds.map((m) => V.id(m, 'managerIds')) : [];
  if (managerIds.some((m) => m === id || !s.employees.some((e) => e.id === m))) throw new V.ValidationError('unknown_manager', 'managerIds');
  const emp: Employee = {
    id, name: V.text(b.name, 'name', 80).trim(), status: V.oneOf(b.status ?? 'employee', STATUSES, 'status'), role: V.oneOf(b.role ?? 'employee', ROLES, 'role'),
    qualifications: quals, occupancy: V.num(b.occupancy ?? 1, 'occupancy', 0, 1), schedule,
    startDate: V.isoDate(b.startDate, 'startDate'), birthDate: V.isoDate(b.birthDate ?? '1990-01-01', 'birthDate', 1900, 2100),
    managerIds, carryOverDays: V.num(b.carryOverDays ?? 0, 'carryOverDays', 0, 60),
  };
  if (!emp.name) throw new V.ValidationError('invalid_text', 'name');
  if (b.endDate) { emp.endDate = V.isoDate(b.endDate, 'endDate'); if (emp.endDate < emp.startDate) throw new V.ValidationError('invalid_range', 'endDate'); }
  if (b.delegateTo) { emp.delegateTo = V.id(b.delegateTo, 'delegateTo'); if (!s.employees.some((e) => e.id === emp.delegateTo) || emp.delegateTo === id) throw new V.ValidationError('unknown_manager', 'delegateTo'); }
  return emp;
}

export function addEmployee(s: State, input: unknown, actor: string, now: string): Employee {
  if (s.employees.length >= 200) throw new V.ValidationError('too_many_employees', 'employees');
  const emp = employeeFields(s, V.body(input), nextId(s, 'emp-'));
  s.employees.push(emp);
  audit(s, actor, 'config.employee_added', emp.id, now, undefined, undefined, { name: emp.name, role: emp.role });
  return emp;
}

export function updateEmployee(s: State, id: string, input: unknown, actor: string, now: string): Employee {
  const i = s.employees.findIndex((e) => e.id === id);
  if (i < 0) throw new DomainError('unknown_employee');
  const before = s.employees[i];
  const next = employeeFields(s, V.body(input), id);
  if (id === OWNER_ID) { next.role = 'admin'; } // the owner can never lock themselves out
  s.employees[i] = { ...before, ...next };
  audit(s, actor, 'config.employee_updated', id, now, undefined, { name: before.name }, { name: next.name });
  return s.employees[i];
}

export function removeEmployee(s: State, id: string, actor: string, now: string) {
  if (id === OWNER_ID) throw new DomainError('owner_cannot_be_removed');
  const e = s.employees.find((x) => x.id === id);
  if (!e) throw new DomainError('unknown_employee');
  const used = s.absences.some((a) => a.employeeId === id) || s.assignments.some((a) => a.employeeId === id)
    || s.employees.some((o) => o.managerIds.includes(id) || o.delegateTo === id);
  if (used) throw new DomainError('employee_in_use');
  s.employees = s.employees.filter((x) => x.id !== id);
  s.sensitive = s.sensitive.filter((x) => x.employeeId !== id);
  audit(s, actor, 'config.employee_removed', id, now, undefined, { name: e.name });
}
