import { readFileSync } from 'node:fs';
import type { Alternative, Reason } from './types.js';

export type Lang = 'fr' | 'de' | 'en';
const cache = new Map<Lang, any>();
export function locale(lng: Lang) {
  if (!cache.has(lng)) cache.set(lng, JSON.parse(readFileSync(new URL(`../locales/${lng}.json`, import.meta.url), 'utf8')));
  return cache.get(lng);
}
const lookup = (obj: any, path: string): string | undefined => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
const fill = (tpl: string, p: Record<string, string | number> = {}) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? `{${k}}`));

export function t(lng: Lang, key: string, params?: Record<string, string | number>) {
  return fill(lookup(locale(lng), key) ?? lookup(locale('fr'), key) ?? key, params);
}
export function halfLabel(lng: Lang, h: unknown) { return t(lng, h === 'AM' ? 'ui.am' : 'ui.pm'); }
export function renderReason(lng: Lang, r: Reason) {
  const p = { ...(r.params ?? {}) } as Record<string, string | number>;
  if (p.half) p.half = halfLabel(lng, p.half);
  if (p.label) p.label = String(p.label);
  return t(lng, `reason.${r.code}`, p);
}
export const renderAlt = (lng: Lang, a: Alternative) => t(lng, `alt.${a.kind}`, a.params);
