import { readFileSync } from 'node:fs';
import type { Alternative, Reason } from './types.js';

export type Lang = 'fr' | 'de' | 'en';
const cache = new Map<Lang, any>();
export function locale(lng: Lang) {
  if (!cache.has(lng)) cache.set(lng, JSON.parse(readFileSync(new URL(`../locales/${lng}.json`, import.meta.url), 'utf8')));
  return cache.get(lng);
}
/** Resolve "a.b.c"; also supports flat dotted keys such as audit["request.submitted"]. */
const lookup = (obj: any, path: string): string | undefined => {
  if (obj == null) return undefined;
  if (typeof obj !== 'object') return path ? undefined : obj;
  if (path in obj) return obj[path];
  const parts = path.split('.');
  for (let i = 1; i < parts.length; i++) {
    const head = parts.slice(0, i).join('.');
    if (head in obj) { const r = lookup(obj[head], parts.slice(i).join('.')); if (r !== undefined) return r; }
  }
  return undefined;
};
const fill = (tpl: string, p: Record<string, string | number> = {}) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? `{${k}}`));

export function t(lng: Lang, key: string, params?: Record<string, string | number>) {
  return fill(lookup(locale(lng), key) ?? lookup(locale('fr'), key) ?? key, params);
}
export function halfLabel(lng: Lang, h: unknown) { return t(lng, h === 'AM' ? 'ui.am' : 'ui.pm'); }
export function renderReason(lng: Lang, r: Reason) {
  const p = { ...(r.params ?? {}) } as Record<string, string | number>;
  if (p.half) p.half = halfLabel(lng, p.half);
  if (p.label) p.label = String(p.label);
  if (p.unit) p.unit = t(lng, `unit.${p.unit}`);
  if (p.proof) p.proof = t(lng, `proof.${p.proof}`);
  if (p.type) p.type = t(lng, `type.${p.type}`);
  return t(lng, `reason.${r.code}`, p);
}
export const renderAlt = (lng: Lang, a: Alternative) => t(lng, `alt.${a.kind}`, a.params);
