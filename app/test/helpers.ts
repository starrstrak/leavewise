import { submitRequest, runTriage } from '../src/actions.js';
import { buildDemoState } from '../../demo/seed.js';
import type { Absence, Decision, State } from '../src/types.js';

export const NOW = '2026-04-20T09:00';

/** Demo staff with no absence history and no peak history, for isolated scenarios. */
export function fresh(): State {
  const s = buildDemoState();
  s.absences = [];
  s.peakHistory = [];
  return s;
}

export const emp = (s: State, id: string) => s.employees.find((e) => e.id === id)!;

export function req(s: State, employeeId: string, start: string, end: string, at = NOW, extra: Partial<Parameters<typeof submitRequest>[1]> = {}): Absence {
  return submitRequest(s, { employeeId, type: 'vacation', start, end, ...extra }, at);
}

export function triage(s: State, now = NOW): Map<string, Decision> {
  return new Map(runTriage(s, now).map((d) => [d.requestId, d]));
}

export const codes = (d: Decision, sev?: 'block' | 'info' | 'warn') =>
  d.reasons.filter((r) => !sev || r.severity === sev).map((r) => r.code);
