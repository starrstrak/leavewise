/** Input validation without dependency. Every failure is a 400 with a stable, readable code (+ field). */
export class ValidationError extends Error {
  constructor(public code: string, public field?: string) { super(field ? `${code}:${field}` : code); }
}

export const ABSENCE_TYPES = ['vacation', 'sickness', 'accident', 'special', 'training', 'military', 'civil', 'maternity', 'paternity', 'carer', 'unpaid'] as const;
export const LANGS = ['fr', 'de', 'en'] as const;
export const MAX_BODY_BYTES = 64 * 1024;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

type Obj = Record<string, unknown>;
const bad = (code: string, field?: string): never => { throw new ValidationError(code, field); };

export function isObject(v: unknown): v is Obj { return typeof v === 'object' && v !== null && !Array.isArray(v); }
export function body(v: unknown): Obj { return isObject(v) ? v : bad('body_must_be_object'); }

export function isoDate(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return bad('invalid_date', field);
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return bad('invalid_date', field);
  const y = Number(v.slice(0, 4));
  if (y < 2000 || y > 2100) return bad('date_out_of_range', field);
  return v;
}
export function isoDateTime(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return bad('invalid_datetime', field);
  isoDate(v.slice(0, 10), field);
  const h = Number(v.slice(11, 13)), m = Number(v.slice(14, 16));
  return h > 23 || m > 59 ? bad('invalid_datetime', field) : v;
}
export function oneOf<T extends string>(v: unknown, list: readonly T[], field: string): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : bad('invalid_value', field);
}
export function id(v: unknown, field: string): string {
  return typeof v === 'string' && ID_RE.test(v) ? v : bad('invalid_id', field);
}
export function text(v: unknown, field: string, max = 500): string {
  if (typeof v !== 'string') return bad('invalid_text', field);
  return v.length > max ? bad('text_too_long', field) : v;
}
export function bool(v: unknown, field: string): boolean { return typeof v === 'boolean' ? v : bad('invalid_boolean', field); }
export function int(v: unknown, field: string, min: number, max: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : bad('invalid_number', field);
}
export function num(v: unknown, field: string, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : bad('invalid_number', field);
}
const opt = <T>(o: Obj, k: string, f: (v: unknown, field: string) => T): T | undefined => (o[k] === undefined || o[k] === null ? undefined : f(o[k], k));
export { opt };

export const halves = (v: unknown, field: string) => oneOf(v, ['AM', 'PM'] as const, field);

export function lang(v: string | null): 'fr' | 'de' | 'en' {
  return v === null ? 'fr' : oneOf(v, LANGS, 'lng');
}

/** Absence request (employee form). */
export function submitInput(b: Obj) {
  const start = isoDate(b.start, 'start'), end = isoDate(b.end, 'end');
  return {
    type: oneOf(b.type, ABSENCE_TYPES, 'type'), start, end,
    startHalf: opt(b, 'startHalf', halves), endHalf: opt(b, 'endHalf', halves),
    urgent: opt(b, 'urgent', bool), justification: opt(b, 'justification', (v, f) => text(v, f, 500)),
    certificate: opt(b, 'certificate', bool), employeeId: opt(b, 'employeeId', id),
  };
}

export function unplannedInput(b: Obj) {
  const h = b.halves;
  if (h !== undefined && (!Array.isArray(h) || h.length < 1 || h.length > 2 || new Set(h).size !== h.length)) bad('invalid_value', 'halves');
  return {
    employeeId: id(b.employeeId, 'employeeId'), date: isoDate(b.date, 'date'),
    halves: h === undefined ? undefined : (h as unknown[]).map((x) => halves(x, 'halves')),
    type: opt(b, 'type', (v, f) => oneOf(v, ['sickness', 'accident'] as const, f)),
    certificate: opt(b, 'certificate', bool),
  };
}

export function overrideInput(b: Obj) {
  return {
    requestId: id(b.requestId, 'requestId'), action: oneOf(b.action, ['approve', 'refuse', 'modify'] as const, 'action'),
    reason: text(b.reason, 'reason', 500), preview: opt(b, 'preview', bool),
    start: opt(b, 'start', isoDate), end: opt(b, 'end', isoDate), startHalf: opt(b, 'startHalf', halves), endHalf: opt(b, 'endHalf', halves),
  };
}

export function idList(v: unknown, field: string, max = 200): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) return bad('invalid_list', field);
  return v.map((x) => id(x, field));
}

export function consentInput(b: Obj) {
  return { consent: bool(b.consent, 'consent'), childrenUnder12: opt(b, 'childrenUnder12', (v, f) => int(v, f, 0, 20)), carer: opt(b, 'carer', bool) };
}

const RULE_KEYS = ['effectiveFrom', 'legal', 'internal', 'coverage', 'opening', 'slotTimes', 'holidayScope', 'holidays', 'peakPeriods', 'historyWindowDays', 'priority', 'automation', 'absenceTypes'];
/** Admin rules patch: known keys only, bounded numbers (deep check of numeric leaves), valid effective date. */
export function rulesPatch(b: Obj) {
  for (const k of Object.keys(b)) if (!RULE_KEYS.includes(k)) bad('unknown_field', k);
  const out: Obj = { ...b, effectiveFrom: isoDate(b.effectiveFrom, 'effectiveFrom') };
  const walk = (v: unknown, path: string, depth: number): void => {
    if (depth > 6) bad('too_deep', path);
    if (typeof v === 'number') { if (!Number.isFinite(v) || (v < 0 && !/\.easter$/.test(path)) || v < -1000 || v > 100000) bad('invalid_number', path); }
    else if (typeof v === 'string') { if (v.length > 200) bad('text_too_long', path); }
    else if (Array.isArray(v)) { if (v.length > 200) bad('invalid_list', path); v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1)); }
    else if (isObject(v)) for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, depth + 1);
  };
  for (const [k, v] of Object.entries(out)) if (k !== 'effectiveFrom') walk(v, k, 0);
  const w = (out.priority as Obj | undefined)?.weights;
  if (isObject(w) && Object.values(w).every((x) => x === 0) && Object.keys(w).length) bad('invalid_value', 'priority.weights');
  return out;
}
