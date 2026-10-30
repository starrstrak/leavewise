import type { Qualification, Rules } from './types.js';

/** Defaults legal values: TO BE VALIDATED BY A LEGAL PROFESSIONAL (not legal advice). */
export const defaultRules: Rules = {
  version: 'v1',
  effectiveFrom: '2026-01-01',
  legal: {
    vacationWeeks: 4, vacationWeeksUnder20: 5, ageProtection: 20,
    minConsecutiveDays: 10, sicknessCreditsVacation: true,
    dailyRestHours: 11, weeklyRestHours: 35, maxWeeklyHours: 45,
  },
  internal: {
    minNoticeDays: 14, urgentWaivesNotice: true,
    maxConsecutiveDays: 15, allowNegativeBalance: false,
    carryOverMaxDays: 5, carryOverExpiryMD: '03-31',
    blackouts: [{ id: 'inventory', start: '2026-12-14', end: '2026-12-24', label: 'inventory_and_christmas' }],
    closures: [{ id: 'xmas', start: '2026-12-28', end: '2026-12-31', label: 'collective_closure' }],
    closuresDeductBalance: true,
    deadlines: [{ id: 'summer', start: '2026-07-01', end: '2026-08-31', deadline: '2026-04-30' }],
    offerTimeoutMinutes: 30, maxReminders: 1,
  },
  coverage: { minQualified: 1, minHeadcount: 2, maxSimultaneousAbsent: 2 },
  opening: { weekdays: [1, 2, 3, 4, 5], saturdayHalves: ['AM'] },
  slotTimes: { AM: { start: '08:00', end: '12:30' }, PM: { start: '13:30', end: '18:30' } },
  holidayScope: 'catholic',
  holidays: [
    { id: 'new_year', fixed: '01-01' },
    { id: 'good_friday', easter: -2 },
    { id: 'easter_monday', easter: 1 },
    { id: 'ascension', easter: 39 },
    { id: 'whit_monday', easter: 50 },
    { id: 'corpus_christi', easter: 60, scopes: ['catholic'] },
    { id: 'national_day', fixed: '08-01' },
    { id: 'assumption', fixed: '08-15', scopes: ['catholic'] },
    { id: 'all_saints', fixed: '11-01', scopes: ['catholic'] },
    { id: 'immaculate', fixed: '12-08', scopes: ['catholic'] },
    { id: 'christmas', fixed: '12-25' },
  ],
  peakPeriods: [
    { id: 'summer', startMD: '07-01', endMD: '08-31' },
    { id: 'christmas', startMD: '12-20', endMD: '01-05' },
  ],
  historyWindowDays: 365,
  priority: {
    weights: { equity: 30, rotation: 30, urgency: 15, order: 25, family: 10 },
    sensitiveEnabled: false,
  },
  automation: { autoApproveZeroRisk: false },
  absenceTypes: {
    vacation: { needsApproval: true, deductsBalance: true, notice: true, blackout: true, maxConsecutive: true },
    sickness: { needsApproval: false, deductsBalance: false, notice: false, blackout: false, maxConsecutive: false },
    accident: { needsApproval: false, deductsBalance: false, notice: false, blackout: false, maxConsecutive: false },
    special: { needsApproval: true, deductsBalance: false, notice: false, blackout: false, maxConsecutive: false },
    training: { needsApproval: true, deductsBalance: false, notice: true, blackout: false, maxConsecutive: false },
    military: { needsApproval: false, deductsBalance: false, notice: false, blackout: false, maxConsecutive: false },
    civil: { needsApproval: false, deductsBalance: false, notice: false, blackout: false, maxConsecutive: false },
    maternity: { needsApproval: false, deductsBalance: false, notice: false, blackout: false, maxConsecutive: false },
    paternity: { needsApproval: true, deductsBalance: false, notice: false, blackout: false, maxConsecutive: false },
    carer: { needsApproval: true, deductsBalance: false, notice: false, blackout: false, maxConsecutive: false },
    unpaid: { needsApproval: true, deductsBalance: false, notice: true, blackout: true, maxConsecutive: true },
  },
};

export const defaultQualifications: Qualification[] = [
  { code: 'pharmacist', canOpen: true, countsAsQualified: true, mustBeSupervised: false, canReplace: ['pharmacist', 'assistant', 'admin'] },
  { code: 'assistant', canOpen: false, countsAsQualified: false, mustBeSupervised: false, canReplace: ['assistant'] },
  { code: 'apprentice', canOpen: false, countsAsQualified: false, mustBeSupervised: true, canReplace: [] },
  { code: 'intern', canOpen: false, countsAsQualified: false, mustBeSupervised: true, canReplace: [] },
  { code: 'admin', canOpen: false, countsAsQualified: false, mustBeSupervised: false, canReplace: ['admin'] },
];

/** Rules version in force at a given date (rules are not retroactive). */
export function rulesAt(versions: Rules[], date: string): Rules {
  const sorted = [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let cur = sorted[0];
  for (const r of sorted) if (r.effectiveFrom <= date) cur = r;
  return cur;
}
