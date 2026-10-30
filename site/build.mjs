// Renders the French default into index.html / legal.html from templates + locales/fr.json (no-JS fallback, no drift).
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('./', import.meta.url);
const fr = JSON.parse(readFileSync(new URL('locales/fr.json', dir), 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export function render(tpl) {
  let out = tpl.replace(/<(\w+)([^>]*?)data-i18n="([^"]+)"([^>]*)><\/\1>/g, (_, tag, a, key, b) => {
    if (!(key in fr)) throw new Error(`missing fr key ${key}`);
    return `<${tag}${a}data-i18n="${key}"${b}>${esc(fr[key]).replace(/&quot;/g, '"')}</${tag}>`;
  });
  out = out.replace(/<(\w+)([^>]*?)data-i18n-attr="([^":]+):([^"]+)"([^>]*)>/g, (m, tag, a, attr, key, b) => {
    if (!(key in fr)) throw new Error(`missing fr key ${key}`);
    const full = `${a}data-i18n-attr="${attr}:${key}"${b}`.replace(new RegExp(`\\s${attr}="[^"]*"`), '');
    return `<${tag}${full} ${attr}="${esc(fr[key])}">`;
  });
  out = out.replace(/<div class="mini-cal" data-days="([^"]+)"><\/div>/, (_, key) => {
    const days = fr[key].split(',').map((d) => `<b class="dow">${d}</b>`).join('');
    let cells = '';
    for (let i = 0; i < 30; i++) cells += `<i class="${[4, 5, 6, 7, 8].includes(i) ? 'away' : 'ok'}"></i>`;
    return `<div class="mini-cal" data-days="${key}">${days}${cells}</div>`;
  });
  return out;
}
for (const [src, dst] of [['index.template.html', 'index.html'], ['legal.template.html', 'legal.html']])
  writeFileSync(new URL(dst, dir), render(readFileSync(new URL(src, dir), 'utf8')));
console.log('site built');
