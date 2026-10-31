// Contrast measured on the RENDERED page (not on tokens): node app/test/contrast-render.mjs [baseUrl]  (server running)
// For every visible text run: text colour (computed, opacity applied) vs the worst background pixel actually painted behind it.
// The background comes from a screenshot taken with all text made transparent, so gradients, shadows and overlays are included.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
let failed = 0, pages = 0;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const decoder = await (await browser.newContext()).newPage();

async function measure(page, label, only = null) {
  const items = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const txt = n.textContent.trim();
      const el = n.parentElement;
      if (!txt || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      if (op === 0) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((r) => r.width >= 2 && r.height >= 2);
      if (!rects.length) continue;
      const m = cs.color.match(/rgba?\(([^)]+)\)/)[1].split(/[ ,/]+/).map(Number);
      // text parked off-screen (skip link at rest, sr-only) is not painted: it is measured in its visible state instead
      if (rects.every((r) => r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight + scrollY + 5000)) continue;
      if (el.closest('.sr-only')) continue;
      // content of a closed <details> is not painted; its boxes are measured in the "FAQ ouverte" scenario
      const det = el.closest('details'); if (det && !det.open && !el.closest('summary')) continue;
      out.push({ txt: txt.slice(0, 40), rgb: m.slice(0, 3), a: (m[3] ?? 1) * op, size: parseFloat(cs.fontSize), bold: parseInt(cs.fontWeight, 10) >= 700,
        rects: rects.map((r) => [r.left + scrollX, r.top + scrollY, r.width, r.height]), tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') });
    }
    return out;
  });
  await page.addStyleTag({ content: '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}' });
  const png = (await page.screenshot({ fullPage: true })).toString('base64');
  if (only) items.splice(0, items.length, ...items.filter((i) => only.test(i.tag + ' ' + i.txt)));
  const res = await decoder.evaluate(async ({ png, items }) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    return items.map((it) => {
      let worst = Infinity, wbg = null, wfg = null;
      for (const [x, y, w, h] of it.rects) {
        const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y)), ww = Math.min(bmp.width - x0, Math.ceil(w)), hh = Math.min(bmp.height - y0, Math.ceil(h));
        if (ww < 1 || hh < 1) continue;
        const d = g.getImageData(x0, y0, ww, hh).data;
        const step = Math.max(1, Math.floor((ww * hh) / 400));
        for (let i = 0; i < ww * hh; i += step) {
          const bg = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
          const fg = it.rgb.map((v, k) => v * it.a + bg[k] * (1 - it.a));
          const l1 = L(...fg), l2 = L(...bg);
          const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (r < worst) { worst = r; wbg = bg; wfg = fg.map(Math.round); }
        }
      }
      return { ...it, ratio: worst, bg: wbg, fg: wfg, rects: undefined };
    });
  }, { png, items });
  pages++;
  const need = (it) => (it.size >= 24 || (it.size >= 18.66 && it.bold) ? 3 : 4.5);
  const measured = res.filter((r) => Number.isFinite(r.ratio));
  const bad = measured.filter((r) => r.ratio < need(r));
  const min = measured.length ? Math.min(...measured.map((r) => r.ratio)) : NaN;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${label} : ${measured.length} textes mesurés, contraste minimum ${min.toFixed(2)}:1, ${bad.length} sous le seuil (4,5:1 ; 3:1 grand texte)`);
  for (const b of bad.slice(0, 8)) console.log(`  - « ${b.txt} » <${b.tag}> ${b.ratio.toFixed(2)}:1 (seuil ${need(b)}) texte rgb(${b.fg}) sur fond rgb(${b.bg}) ${b.size}px`);
  if (bad.length) { failed++; process.exitCode = 1; }
}

const ctx = (scheme, w = 1280, h = 900) => browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });

/* site : index et legal, clair/sombre (préférence système) + thème forcé par le bouton, mobile */
for (const scheme of ['light', 'dark']) {
  for (const page of ['', 'legal.html']) {
    const c = await ctx(scheme); const p = await c.newPage();
    await p.goto(`${base}/site/${page}`, { waitUntil: 'networkidle' });
    await measure(p, `site ${page || 'index.html'} ${scheme} (préférence système)`);
    await c.close();
  }
}
for (const scheme of ['light', 'dark']) { // lien d'évitement visible (focalisé)
  const c = await ctx(scheme); const p = await c.newPage();
  await p.goto(`${base}/site/`, { waitUntil: 'networkidle' });
  await p.keyboard.press('Tab'); await p.waitForTimeout(200);
  await p.evaluate(() => { const e = document.activeElement; const r = e.getBoundingClientRect(); if (r.bottom <= 0) throw new Error('lien d\'évitement toujours hors écran après focus'); });
  await measure(p, `site lien d'évitement focalisé ${scheme}`, /skip/);
  await c.close();
}
for (const scheme of ['light', 'dark']) {
  const c = await ctx(scheme); const p = await c.newPage();
  await p.goto(base, { waitUntil: 'networkidle' }); await p.waitForSelector('#tabs button');
  await p.keyboard.press('Tab'); await p.waitForTimeout(200);
  await measure(p, `app lien d'évitement focalisé ${scheme}`, /skip/);
  await c.close();
}
for (const forced of ['dark', 'light']) { // bouton de thème : l'inverse de la préférence système
  const c = await ctx(forced === 'dark' ? 'light' : 'dark'); const p = await c.newPage();
  await p.goto(`${base}/site/`, { waitUntil: 'networkidle' });
  await p.click('#themeBtn'); await p.waitForTimeout(300);
  await measure(p, `site index.html thème ${forced} forcé par le bouton`);
  await c.close();
}
for (const lng of ['de', 'en']) {
  const c = await ctx('light'); const p = await c.newPage();
  await p.goto(`${base}/site/`, { waitUntil: 'networkidle' }); await p.selectOption('#lang', lng); await p.waitForTimeout(300);
  await measure(p, `site index.html ${lng.toUpperCase()} clair`);
  await c.close();
}
{
  const c = await ctx('light', 375, 800); const p = await c.newPage();
  await p.goto(`${base}/site/`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await measure(p, 'site index.html mobile 375 clair, FAQ ouverte');
  await c.close();
}
/* application : rôles x onglets x thèmes */
for (const scheme of ['light', 'dark']) {
  for (const [uid, role] of [['emp-lea', 'employée'], ['emp-claire', 'manager'], ['emp-paul', 'admin']]) {
    const c = await ctx(scheme); const p = await c.newPage();
    await p.goto(base, { waitUntil: 'networkidle' }); await p.waitForSelector('#tabs button');
    await p.selectOption('#user', uid); await p.waitForTimeout(400);
    const n = await p.locator('#tabs button').count();
    for (let i = 0; i < n; i++) {
      await p.locator('#tabs button').nth(i).click(); await p.waitForTimeout(400);
      if (role === 'manager' && i === 1) { await p.getByRole('button', { name: /tri automatique/i }).first().click().catch(() => {}); await p.waitForTimeout(400); }
      await measure(p, `app ${role} « ${(await p.locator('#tabs button').nth(i).innerText()).trim()} » ${scheme}`);
      await p.reload({ waitUntil: 'networkidle' }); await p.waitForSelector('#tabs button');
      await p.locator('#tabs button').nth(i).click(); await p.waitForTimeout(200); // l'ajout de style est réinitialisé par le rechargement
    }
    await c.close();
  }
}
await browser.close();
console.log(`\n${pages} rendus mesurés ; ${failed} sous le seuil`);
console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUS LES CONTRASTES RÉELS SONT CONFORMES AA');
