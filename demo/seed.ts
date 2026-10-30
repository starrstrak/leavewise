// Fictional demo data: a pharmacy of 8 people. No real persons.
import { writeFileSync } from 'node:fs';
import { defaultQualifications, defaultRules } from '../app/src/rules.js';
import type { Absence, Employee, Half, PeakHistory, State } from '../app/src/types.js';

export const DEMO_NOW = '2026-04-20T09:00';

const full = (...days: number[]): Record<number, Half[]> => Object.fromEntries(days.map((d) => [d, ['AM', 'PM'] as Half[]]));

export function buildDemoState(): State {
  const employees: Employee[] = [
    { id: 'emp-claire', name: 'Claire Morel', status: 'manager', role: 'manager', qualifications: ['pharmacist'], occupancy: 1,
      schedule: full(1, 2, 3, 4, 5), startDate: '2015-03-01', managerIds: ['emp-paul'], delegateTo: 'emp-luc', birthDate: '1980-05-14', carryOverDays: 2 },
    { id: 'emp-luc', name: 'Luc Perrin', status: 'part_time', role: 'employee', qualifications: ['pharmacist'], occupancy: 0.6,
      schedule: { 2: ['AM', 'PM'], 3: ['AM'], 4: ['AM', 'PM'], 6: ['AM'] }, startDate: '2019-09-01', managerIds: ['emp-claire'], birthDate: '1988-11-02', carryOverDays: 0,
      preferredWeekdays: [1, 5] },
    { id: 'emp-hugo', name: 'Hugo Baeriswyl', status: 'external_temp', role: 'employee', qualifications: ['pharmacist'], occupancy: 0,
      schedule: {}, startDate: '2024-01-01', managerIds: ['emp-claire'], birthDate: '1985-02-20', carryOverDays: 0, availableWeekdays: [1, 3, 5, 6] },
    { id: 'emp-sofia', name: 'Sofia Rey', status: 'part_time', role: 'employee', qualifications: ['assistant'], occupancy: 0.8,
      schedule: full(1, 2, 3, 4), startDate: '2021-02-01', managerIds: ['emp-claire'], birthDate: '1992-07-30', carryOverDays: 1 },
    { id: 'emp-lea', name: 'Léa Brunner', status: 'employee', role: 'employee', qualifications: ['assistant'], occupancy: 1,
      schedule: { ...full(1, 2, 3, 4, 5), 6: ['AM'] }, startDate: '2017-08-15', managerIds: ['emp-claire'], birthDate: '1990-01-09', carryOverDays: 3 },
    { id: 'emp-emma', name: 'Emma Python', status: 'apprentice', role: 'employee', qualifications: ['apprentice'], occupancy: 0.8,
      schedule: full(1, 2, 5), startDate: '2024-08-01', managerIds: ['emp-claire'], birthDate: '2008-03-12', carryOverDays: 0 },
    { id: 'emp-noah', name: 'Noah Chassot', status: 'intern', role: 'employee', qualifications: ['intern'], occupancy: 0.6,
      schedule: full(2, 3, 4), startDate: '2026-02-01', endDate: '2026-08-31', managerIds: ['emp-claire'], birthDate: '2004-09-25', carryOverDays: 0 },
    { id: 'emp-paul', name: 'Paul Berset', status: 'employee', role: 'admin', qualifications: ['admin'], occupancy: 1,
      schedule: full(1, 2, 3, 4, 5), startDate: '2012-01-01', managerIds: [], birthDate: '1975-12-01', carryOverDays: 0 },
  ];

  const mk = (id: string, employeeId: string, type: Absence['type'], start: string, end: string, submitted: string, extra: Partial<Absence> = {}): Absence => ({
    id, employeeId, type, start, end, startHalf: 'AM', endHalf: 'PM', status: 'approved', submittedAt: submitted,
    history: [{ ts: submitted, status: 'approved', by: 'emp-claire' }], ...extra,
  });

  // 3 months of history (2026-01-20 .. 2026-04-20)
  const absences: Absence[] = [
    mk('H001', 'emp-claire', 'vacation', '2026-02-16', '2026-02-20', '2025-12-10T10:00'),
    mk('H002', 'emp-luc', 'vacation', '2026-03-03', '2026-03-05', '2026-01-25T10:00'),
    mk('H003', 'emp-sofia', 'sickness', '2026-02-09', '2026-02-11', '2026-02-09T07:30', { certificate: true }),
    mk('H004', 'emp-lea', 'vacation', '2026-03-23', '2026-03-27', '2026-02-02T09:00'),
    mk('H005', 'emp-emma', 'training', '2026-03-10', '2026-03-10', '2026-02-10T09:00'),
    mk('H006', 'emp-luc', 'special', '2026-04-07', '2026-04-07', '2026-03-30T09:00', { justification: 'demenagement' }),
    mk('H007', 'emp-paul', 'vacation', '2026-04-13', '2026-04-17', '2026-02-20T09:00'),
  ];

  // Pending requests: summer 2026 + a few others, filed in the last days
  const sub = (id: string, e: string, s: string, en: string, at: string, extra: Partial<Absence> = {}): Absence =>
    mk(id, e, 'vacation', s, en, at, { status: 'submitted', history: [{ ts: at, status: 'submitted', by: e }], ...extra });
  absences.push(
    sub('R0001', 'emp-claire', '2026-07-06', '2026-07-17', '2026-04-14T08:10'),
    sub('R0002', 'emp-luc', '2026-07-06', '2026-07-10', '2026-04-15T17:45'),
    sub('R0003', 'emp-sofia', '2026-07-13', '2026-07-24', '2026-04-15T09:05'),
    sub('R0004', 'emp-lea', '2026-07-13', '2026-07-24', '2026-04-16T11:20'),
    sub('R0005', 'emp-emma', '2026-07-20', '2026-07-24', '2026-04-17T14:00'),
    sub('R0006', 'emp-hugo', '2026-08-03', '2026-08-07', '2026-04-17T15:00', { type: 'unpaid' }),
  );

  const peakHistory: PeakHistory[] = [];
  const hist: [string, number, boolean, boolean][] = [
    ['emp-claire', 2024, true, true], ['emp-claire', 2025, true, true],
    ['emp-luc', 2024, true, false], ['emp-luc', 2025, true, false],
    ['emp-sofia', 2024, true, true], ['emp-sofia', 2025, true, false],
    ['emp-lea', 2024, true, true], ['emp-lea', 2025, true, true],
  ];
  for (const [employeeId, year, requested, granted] of hist) peakHistory.push({ employeeId, year, peakId: 'summer', requested, granted });

  return {
    employees, absences, decisions: [], replacements: [], assignments: [], closedSlots: [], notifications: [], audit: [],
    rulesVersions: [structuredClone(defaultRules)], qualifications: structuredClone(defaultQualifications),
    sensitive: [{ employeeId: 'emp-sofia', consent: false }], peakHistory, seq: 100,
  };
}

if (process.argv[1]?.endsWith('seed.ts')) {
  writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify({ now: DEMO_NOW, state: buildDemoState() }, null, 2));
  console.log('demo/data.json written');
}
