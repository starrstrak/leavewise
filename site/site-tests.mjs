// Site tests: [BROWSER=chromium|firefox|webkit] node site/site-tests.mjs [baseUrl]   (e.g. http://localhost:3000/site/ ; server running)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const pw = createRequire(import.meta.url)('playwright');
const engine = process.env.BROWSER ?? 'chromium'; // chromium | firefox | webkit
const chromium = pw[engine];
// Safari/WebKit on macOS only tabs through form controls by default; Option+Tab walks every focusable element
const TAB = engine === 'webkit' ? 'Alt+Tab' : 'Tab';
const base = (process.argv[2] ?? 'http://localhost:3000/site/').replace(/\/?$/, '/');
let failed = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'} ${msg}`); if (!c) { failed++; process.exitCode = 1; } };
const locales = Object.fromEntries(['fr', 'de', 'en'].map((l) => [l, JSON.parse(readFileSync(new URL(`locales/${l}.json`, import.meta.url), 'utf8'))]));

/* ---- contrast from tokens.css (WCAG AA 4.5:1 text, 3:1 large/UI) ---- */
const css = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');
const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--c-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const light = block(/:root\s*\{([\s\S]*?)\n\}/);
const dark = { ...light, ...block(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/) };
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [['ink', 'bg'], ['ink', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'], ['accent', 'bg'], ['accent', 'surface'], ['accent', 'surface-2'], ['accent-ink', 'accent'], ['deep-ink', 'deep'], ['badge-ink', 'badge'], ['ok', 'ok-soft'], ['ink', 'accent-soft'], ['bad', 'bad-soft']];
for (const [name, pal] of [['clair', light], ['sombre', dark]]) {
  const bad = pairs.map(([f, b]) => [f, b, ratio(pal[f], pal[b])]).filter(([, , r]) => r < 4.5);
  ok(bad.length === 0, `contrastes AA (${name}) : min ${Math.min(...pairs.map(([f, b]) => ratio(pal[f], pal[b]))).toFixed(2)}${bad.length ? ' KO: ' + bad.map((x) => `${x[0]}/${x[1]}=${x[2].toFixed(2)}`).join(',') : ''}`);
}

/* ---- site générique : pas de vocabulaire d'un seul secteur hors des exemples ---- */
{
  const allowed = /^(adapt\.|sec\d\.|params\.|hero\.note$|q7\.|legal\.)/;
  const sector = /pharmac|apothek/i;
  const leaks = [];
  for (const l of ['fr', 'de', 'en']) for (const [k, v] of Object.entries(locales[l])) if (k !== '_meta' && !allowed.test(k) && sector.test(v)) leaks.push(`${l}:${k}`);
  ok(leaks.length === 0, `site générique : aucun terme propre à un secteur hors des exemples (${leaks.length ? leaks : 'aucune fuite'})`);
  ok(['sec1', 'sec2', 'sec3', 'sec4', 'sec5'].every((k) => ['fr', 'de', 'en'].every((l) => locales[l][k + '.t'] && locales[l][k + '.d'])) && Object.keys(locales.fr).filter((k) => /^params\.\d/.test(k)).length === 8, 'section secteurs : 5 exemples et 8 paramètres présents dans les 3 langues');
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [], failedReqs = [];
const newPage = async (w, h) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('requestfailed', (r) => failedReqs.push(r.url()));
  p.on('response', (r) => { if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url()}`); });
  return p;
};

/* ---- responsive ---- */
for (const [name, w, h] of [['mobile', 375, 800], ['tablette', 768, 1024], ['petit bureau', 960, 700], ['bureau', 1280, 800]]) {
  const p = await newPage(w, h);
  await p.goto(base, { waitUntil: 'networkidle' });
  const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h1: !!document.querySelector('h1')?.offsetHeight, menu: getComputedStyle(document.getElementById('menuBtn')).display, navVisible: document.querySelector('#nav > a').offsetHeight > 0, cards: [...document.querySelectorAll('.card')].every((c) => c.getBoundingClientRect().right <= innerWidth + 1) }));
  ok(m.sw <= m.cw, `${name} ${w}px : pas de défilement horizontal (${m.sw}/${m.cw})`);
  ok(m.h1 && m.cards, `${name} : titre et cartes visibles`);
  ok(w >= 960 ? m.navVisible && m.menu === 'none' : m.menu !== 'none' && !m.navVisible, `${name} : navigation ${w >= 960 ? 'étendue' : 'repliée avec bouton menu'}`);
  if (w === 1280) await p.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/site-desktop.png` : '/tmp/site-desktop.png', fullPage: true });
  if (w === 375) await p.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/site-mobile.png` : '/tmp/site-mobile.png', fullPage: true });
  await p.context().close();
}

/* ---- links, anchors ---- */
{
  const p = await newPage(1280, 800);
  await p.goto(base, { waitUntil: 'networkidle' });
  const hrefs = await p.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
  const anchors = [...new Set(hrefs.filter((h) => h.startsWith('#') && h.length > 1))];
  const missing = [];
  for (const a of anchors) if (!(await p.$(a))) missing.push(a);
  ok(anchors.length >= 5 && missing.length === 0, `ancres internes (${anchors.join(' ')}) : ${missing.length ? 'manquantes ' + missing : 'toutes présentes'}`);
  const ext = [...new Set(hrefs.filter((h) => !h.startsWith('#')))];
  const bad = [];
  for (const h of ext) { const u = new URL(h, base); const r = await fetch(u); if (!r.ok) bad.push(`${h}:${r.status}`); if (u.hash) { const lp = await newPage(800, 600); await lp.goto(u.href); if (!(await lp.$(u.hash))) bad.push(`${h}:ancre`); await lp.context().close(); } }
  ok(bad.length === 0, `liens (${ext.join(' ')}) : ${bad.length ? bad : 'tous valides'}`);
  await p.click('a[href="#pricing"]'); await p.waitForTimeout(700);
  ok(await p.evaluate(() => { const r = document.getElementById('pricing').getBoundingClientRect(); return r.top >= 0 && r.top < 200; }), 'ancre #pricing : défilement vers la section sous la barre fixe');
  ok(await p.evaluate(() => [...document.querySelectorAll('img')].every((i) => i.alt !== null && i.hasAttribute('alt')) && document.querySelector('figure.preview').getAttribute('aria-labelledby') === 'previewCap' && document.getElementById('previewCap').textContent.length > 40), 'alternatives textuelles : maquette décrite, images avec alt');
  ok(await p.evaluate(() => !!document.querySelector('header') && !!document.querySelector('main') && !!document.querySelector('footer') && document.querySelectorAll('h1').length === 1 && !!document.querySelector('nav[aria-label]')), 'balises sémantiques : header/main/footer, un seul h1, nav étiquetée');
  await p.context().close();
}

/* ---- langues ---- */
{
  const keys = Object.keys(locales.fr).filter((k) => k !== '_meta');
  ok(['de', 'en'].every((l) => keys.every((k) => k in locales[l] && locales[l][k].trim() !== '')), `fichiers de traduction : ${keys.length} clés présentes en FR, DE et EN`);
  for (const page of ['', 'legal.html']) {
    const p = await newPage(1280, 800);
    await p.goto(base + page, { waitUntil: 'networkidle' });
    for (const lng of ['fr', 'de', 'en']) {
      await p.selectOption('#lang', lng); await p.waitForTimeout(250);
      const r = await p.evaluate(([d]) => {
        const miss = [];
        document.querySelectorAll('[data-i18n]').forEach((el) => { if (el.textContent.trim() !== d[el.dataset.i18n]) miss.push(el.dataset.i18n); });
        document.querySelectorAll('[data-i18n-attr]').forEach((el) => { const [a, k] = el.dataset.i18nAttr.split(':'); if (el.getAttribute(a) !== d[k]) miss.push(k); });
        return { miss, lang: document.documentElement.lang, n: document.querySelectorAll('[data-i18n]').length };
      }, [locales[lng]]);
      ok(r.miss.length === 0 && r.lang === lng, `bascule ${lng.toUpperCase()} sur ${page || 'index'} : ${r.n} textes, manquants/incohérents : ${r.miss.length ? r.miss : 0}`);
    }
    await p.context().close();
  }
  const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  const np = await nojs.newPage(); await np.goto(base);
  ok((await np.evaluate((d) => [...document.querySelectorAll('[data-i18n]')].every((e) => e.textContent.trim() === d[e.dataset.i18n]), locales.fr)), 'sans JavaScript : contenu français complet, identique à fr.json');
  await nojs.close();
}

/* ---- clavier ---- */
{
  const p = await newPage(1280, 800);
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.keyboard.press(TAB);
  ok(await p.evaluate(() => document.activeElement.classList.contains('skip')), 'clavier : premier Tab = lien d\'évitement');
  const seen = []; let noRing = []; let firstTxt = '';
  for (let i = 0; i < 60; i++) {
    const r = await p.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { tag: e.tagName, txt: (e.textContent || e.id || '').trim().slice(0, 20), ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2, vis: e.getBoundingClientRect().width > 0 }; });
    if (r.tag === 'BODY' || (i > 0 && r.txt === firstTxt)) break; // cycle complete
    if (i === 0) firstTxt = r.txt;
    seen.push(r.tag); if (!r.ring) noRing.push(r.txt); await p.keyboard.press(TAB);
  }
  ok(noRing.length === 0 && seen.includes('SUMMARY') && seen.includes('SELECT'), `clavier : ${seen.length} éléments (${seen.filter((x, i) => seen.indexOf(x) === i).join('/')}) atteignables, anneau de focus visible partout${noRing.length ? ' KO ' + noRing : ''}`);
  const s1 = p.locator('details').first().locator('summary');
  await s1.focus(); await p.keyboard.press('Enter');
  const o1 = await p.evaluate(() => document.querySelector('details').open);
  await p.keyboard.press('Space');
  const o2 = await p.evaluate(() => document.querySelector('details').open);
  ok(o1 === true && o2 === false, 'FAQ : ouverture (Entrée) et fermeture (Espace) au clavier');
  await p.locator('details').nth(1).locator('summary').click();
  ok(await p.evaluate(() => document.querySelectorAll('details[open]').length) === 1 && await p.locator('details').nth(1).locator('p').isVisible(), 'FAQ : accordéon ouvre le contenu à la souris');
  await p.context().close();
  const m = await newPage(375, 800);
  await m.goto(base, { waitUntil: 'networkidle' });
  await m.focus('#menuBtn'); await m.keyboard.press('Enter');
  const open = await m.evaluate(() => [document.getElementById('menuBtn').getAttribute('aria-expanded'), document.querySelector('#nav > a').offsetHeight > 0]);
  await m.keyboard.press('Escape');
  const closed = await m.evaluate(() => document.getElementById('menuBtn').getAttribute('aria-expanded'));
  ok(open[0] === 'true' && open[1] && closed === 'false', 'menu mobile : Entrée ouvre, Échap ferme (aria-expanded)');
  await m.context().close();
}

/* ---- chargement ---- */
{
  const p = await newPage(375, 800);
  let bytes = 0; p.on('response', async (r) => { try { bytes += (await r.body()).length; } catch {} });
  await p.goto(base, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  const t = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; });
  ok(t.dcl < 1500 && t.load < 2500, `chargement local : DOMContentLoaded ${t.dcl} ms, load ${t.load} ms`);
  ok(bytes < 400_000, `poids total transféré : ${(bytes / 1024).toFixed(0)} Ko (< 400 Ko, polices incluses)`);
  await p.context().close();
}

await browser.close();
ok(errors.length === 0 && failedReqs.length === 0, `console et réseau : ${errors.length} erreur(s) console, ${failedReqs.length} requête(s) en échec ${[...errors, ...failedReqs].join(' | ')}`);
console.log(failed ? `\n${failed} ÉCHEC(S)` : '\nTOUS LES TESTS DU SITE PASSENT');
