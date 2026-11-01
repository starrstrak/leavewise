// Automated accessibility audit (axe-core via Playwright): node app/test/a11y.mjs [baseUrl]  (server running)
// Fails on serious/critical violations; moderate/minor are listed but do not fail. WCAG 2.0/2.1/2.2 A+AA + best practices.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
let failed = 0, minor = 0, audited = 0;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function audit(page, label) {
  const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  audited++;
  const hard = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  const soft = res.violations.filter((v) => !['serious', 'critical'].includes(v.impact));
  minor += soft.length;
  console.log(`${hard.length ? 'FAIL' : 'PASS'} ${label} : ${res.passes.length} règles OK, ${hard.length} grave(s)/critique(s), ${soft.length} mineure(s)/modérée(s)`);
  for (const v of [...hard, ...soft]) {
    console.log(`  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nœud(s)) ex: ${v.nodes[0].target.join(' ')} | ${(v.nodes[0].failureSummary ?? '').split('\n').slice(1, 3).join(' ').slice(0, 220)}`);
  }
  if (hard.length) { failed++; process.exitCode = 1; }
}
const ctxFor = (scheme, w = 1280, h = 900) => browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });

/* ---- site vitrine : pages x langues x thèmes x tailles ---- */
for (const scheme of ['light', 'dark']) {
  for (const page of ['', 'legal.html']) {
    const ctx = await ctxFor(scheme); const p = await ctx.newPage();
    await p.goto(`${base}/site/${page}`, { waitUntil: 'networkidle' });
    await audit(p, `site ${page || 'index.html'} FR ${scheme}`);
    await ctx.close();
  }
}
for (const lng of ['de', 'en']) {
  const ctx = await ctxFor('light'); const p = await ctx.newPage();
  await p.goto(`${base}/site/`, { waitUntil: 'networkidle' });
  await p.selectOption('#lang', lng); await p.waitForTimeout(300);
  await audit(p, `site index.html ${lng.toUpperCase()} light`);
  await ctx.close();
}
{
  const ctx = await ctxFor('light', 375, 800); const p = await ctx.newPage();
  await p.goto(`${base}/site/`, { waitUntil: 'networkidle' });
  await audit(p, 'site index.html FR mobile 375');
  await p.click('#menuBtn'); await p.waitForTimeout(200);
  await audit(p, 'site index.html FR mobile 375, menu ouvert');
  await ctx.close();
}
{ // FAQ ouverte
  const ctx = await ctxFor('light'); const p = await ctx.newPage();
  await p.goto(`${base}/site/`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await audit(p, 'site index.html FR light, FAQ ouverte');
  await ctx.close();
}

/* ---- application : chaque rôle, chaque onglet, clair et sombre ---- */
const ROLES = [['emp-lea', 'employée'], ['emp-claire', 'manager'], ['emp-paul', 'admin']];
for (const scheme of ['light', 'dark']) {
  for (const [uid, role] of ROLES) {
    const ctx = await ctxFor(scheme); const p = await ctx.newPage();
    await p.goto(base, { waitUntil: 'networkidle' });
    await p.waitForSelector('#tabs button');
    await p.selectOption('#user', uid); await p.waitForTimeout(400);
    const n = await p.locator('#tabs button').count();
    for (let i = 0; i < n; i++) {
      await p.locator('#tabs button').nth(i).click(); await p.waitForTimeout(400);
      if (role === 'manager' && i === 1) { await p.getByRole('button', { name: /tri automatique/i }).first().click().catch(() => {}); await p.waitForTimeout(400); }
      await audit(p, `app ${role} onglet « ${(await p.locator('#tabs button').nth(i).innerText()).trim()} » FR ${scheme}`);
    }
    await ctx.close();
  }
}
for (const lng of ['de', 'en']) {
  const ctx = await ctxFor('light'); const p = await ctx.newPage();
  await p.goto(base, { waitUntil: 'networkidle' }); await p.waitForSelector('#tabs button');
  await p.selectOption('#user', 'emp-claire'); await p.selectOption('#lng', lng); await p.waitForTimeout(500);
  await p.locator('#tabs button').nth(1).click(); await p.waitForTimeout(400);
  await audit(p, `app manager file de tri ${lng.toUpperCase()} light`);
  await ctx.close();
}
await browser.close();
console.log(`\n${audited} pages/états audités ; ${failed} avec violation grave/critique ; ${minor} violation(s) modérée(s)/mineure(s) listée(s)`);
console.log(failed ? `${failed} ÉCHEC(S)` : 'AUCUNE VIOLATION GRAVE OU CRITIQUE');
