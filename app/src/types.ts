export type Half = 'AM' | 'PM';
export type Role = 'employee' | 'manager' | 'hr' | 'admin';
export type QualCode = 'pharmacist' | 'assistant' | 'apprentice' | 'intern' | 'admin';
export type EmpStatus = 'employee' | 'part_time' | 'apprentice' | 'intern' | 'external_temp' | 'manager';
export type AbsenceType =
  | 'vacation' | 'sickness' | 'accident' | 'special' | 'training'
  | 'military' | 'civil' | 'maternity' | 'paternity' | 'carer' | 'unpaid';
export type RequestStatus =
  | 'draft' | 'submitted' | 'approved' | 'refused' | 'cancelled' | 'cancel_requested';

export type LeaveKind = 'special' | 'maternity' | 'paternity' | 'carer';
/** Default duration of a leave type: a parameter to be validated by a legal professional, never a guaranteed right. */
export interface LeaveDefault {
  days: number;
  unit: 'calendar' | 'working';
  /** supporting document expected (key of the `proof` locale list), null if none */
  proof: string | null;
  /** yearly cap in days (information, non-blocking) */
  yearlyMaxDays?: number;
  /** indicative legal basis, free text, to be validated */
  basis: string;
}

export interface Slot { date: string; half: Half }

export interface Qualification {
  code: QualCode;
  canOpen: boolean;
  countsAsQualified: boolean;
  mustBeSupervised: boolean;
  canReplace: QualCode[];
}

export interface Employee {
  id: string;
  name: string;
  status: EmpStatus;
  role: Role;
  qualifications: QualCode[];
  occupancy: number;
  /** ISO weekday (1=Mon..7=Sun) -> halves worked */
  schedule: Record<number, Half[]>;
  startDate: string;
  endDate?: string;
  managerIds: string[];
  delegateTo?: string;
  birthDate: string;
  carryOverDays: number;
  /** extra availability limits (externals / part-timers) */
  unavailableDates?: string[];
  availableWeekdays?: number[];
  preferredWeekdays?: number[];
  /** blocks outside the schedule, ISO local datetimes, e.g. night duty */
  extraBlocks?: { start: string; end: string }[];
  maxWeeklyHours?: number;
}

export interface Absence {
  id: string;
  employeeId: string;
  type: AbsenceType;
  start: string;
  end: string;
  startHalf: Half;
  endHalf: Half;
  status: RequestStatus;
  submittedAt: string;
  urgent?: boolean;
  justification?: string;
  certificate?: boolean;
  history?: { ts: string; status: RequestStatus; by: string }[];
}

export interface Reason { code: string; params?: Record<string, string | number>; severity: 'block' | 'info' | 'warn' }

export interface ScoreBreakdown {
  equity: number; rotation: number; urgency: number; order: number;
  family: number; familyActive: boolean;
  weights: Record<string, number>;
  total: number;
}

export interface Alternative {
  kind: 'shift' | 'split' | 'partial' | 'replacement';
  params: Record<string, string | number>;
  start?: string; end?: string; startHalf?: Half; endHalf?: Half;
}

export type Outcome = 'approve' | 'impossible' | 'needs_replacement';
export type DecisionStatus = 'proposed' | 'validated' | 'modified' | 'refused';

export interface Decision {
  id: string;
  requestId: string;
  outcome: Outcome;
  status: DecisionStatus;
  reasons: Reason[];
  score: ScoreBreakdown | null;
  alternatives: Alternative[];
  risk: 'zero' | 'low' | 'high';
  tie: boolean;
  author: string;
  ts: string;
  note?: string;
}

export interface Assignment { id: string; employeeId: string; date: string; half: Half; replacementId: string }
export interface ClosedSlot { date: string; half: Half; reason: string; replacementId?: string }

export interface ReplacementOffer {
  candidateId: string; sentAt: string; reminders: number;
  status: 'pending' | 'accepted' | 'declined' | 'expired'; respondedAt?: string;
}
export interface ReplacementRequest {
  id: string;
  kind: 'planned' | 'unplanned';
  sourceAbsenceId: string;
  slots: Slot[];
  qualification: QualCode;
  status: 'open' | 'offered' | 'filled' | 'unfilled' | 'plan_b' | 'void';
  offers: ReplacementOffer[];
  escalationLevel: 0 | 1 | 2; // 0 none, 1 manager, 2 HR
  createdAt: string;
  late?: boolean;
}

export interface CoverageRule {
  minQualified: number;       // pharmacists present
  minHeadcount: number;
  maxSimultaneousAbsent: number;
}

export interface HolidayDef { id: string; fixed?: string; easter?: number; scopes?: string[] }
export interface Period { id: string; start: string; end: string; label?: string }
export interface PeakPeriod { id: string; startMD: string; endMD: string }

export interface AbsenceTypeCfg {
  needsApproval: boolean; deductsBalance: boolean;
  notice: boolean; blackout: boolean; maxConsecutive: boolean;
}

export interface Rules {
  version: string;
  effectiveFrom: string;
  legal: {
    vacationWeeks: number; vacationWeeksUnder20: number; ageProtection: number;
    minConsecutiveDays: number; sicknessCreditsVacation: boolean;
    dailyRestHours: number; weeklyRestHours: number; maxWeeklyHours: number;
    leaves: Record<LeaveKind, LeaveDefault>;
  };
  internal: {
    minNoticeDays: number; urgentWaivesNotice: boolean;
    maxConsecutiveDays: number; allowNegativeBalance: boolean;
    carryOverMaxDays: number; carryOverExpiryMD: string;
    blackouts: Period[]; closures: Period[]; closuresDeductBalance: boolean;
    deadlines: { id: string; start: string; end: string; deadline: string }[];
    offerTimeoutMinutes: number; maxReminders: number;
  };
  coverage: CoverageRule;
  opening: { weekdays: number[]; saturdayHalves: Half[] };
  slotTimes: Record<Half, { start: string; end: string }>;
  holidayScope: string;
  holidays: HolidayDef[];
  peakPeriods: PeakPeriod[];
  historyWindowDays: number;
  priority: {
    weights: { equity: number; rotation: number; urgency: number; order: number; family: number };
    sensitiveEnabled: boolean;
  };
  automation: { autoApproveZeroRisk: boolean };
  absenceTypes: Record<AbsenceType, AbsenceTypeCfg>;
}

export interface SensitiveProfile {
  employeeId: string;
  consent: boolean;
  consentDate?: string;
  retentionUntil?: string;
  childrenUnder12?: number;
  carer?: boolean;
}

export interface PeakHistory { employeeId: string; year: number; peakId: string; requested: boolean; granted: boolean }

export interface Notification {
  id: string; to: string; kind: string; params: Record<string, string | number>;
  ts: string; channel: 'inapp' | 'email'; readAt?: string;
}
export interface AuditEntry {
  id: string; ts: string; actor: string; action: string; entityId: string;
  justification?: string; before?: unknown; after?: unknown;
}

export interface State {
  employees: Employee[];
  absences: Absence[];
  decisions: Decision[];
  replacements: ReplacementRequest[];
  assignments: Assignment[];
  closedSlots: ClosedSlot[];
  notifications: Notification[];
  audit: AuditEntry[];
  rulesVersions: Rules[];
  qualifications: Qualification[];
  sensitive: SensitiveProfile[];
  peakHistory: PeakHistory[];
  seq: number;
}
