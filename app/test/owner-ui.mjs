// Owner space UI test: OWNER_PASSWORD=... server running; node app/test/owner-ui.mjs <url> <password>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default ?? require('@axe-core/playwright').AxeBuilder;
const url = process.argv[2] ?? 'http://localhost:3000', password = process.argv[3];
if (!password) { console.error('usage: owner-ui.mjs <url> <password>'); process.exit(2); }
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) { failed++; process.exitCode = 1; } };
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const page = async (ctx) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' && !/40[1-3]|429/.test(m.text())) errors.push(m.text()); }); return p; };

const pub = await browser.newContext(); const p0 = await page(pub);
await p0.goto(url); await p0.waitForSelector('#tabs button');
ok(!(await p0.locator('#tabs').innerText()).includes('Mon espace'), "public : l'onglet « Mon espace » n'est pas affiché");
ok(await p0.locator('#ownerBanner').isHidden(), 'public : bannière propriétaire masquée');

const ctx = await browser.newContext(); const p = await page(ctx);
await p.goto(url + '#owner'); await p.waitForSelector('#tabs button');
await p.locator('#tabs button', { hasText: 'Mon espace' }).click(); await p.waitForTimeout(300);
ok(await p.locator('input[type=password]').isVisible(), 'lien #owner : formulaire de mot de passe affiché');
let axe = await new AxeBuilder({ page: p }).analyze();
ok(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).length === 0, `axe (connexion) : ${axe.violations.length} violation(s)`);
await p.fill('input[type=password]', 'mauvais mot de passe'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
ok((await p.locator('.error').innerText()).includes('Mot de passe incorrect'), 'mauvais mot de passe : message traduit');
await p.fill('input[type=password]', password); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
ok(await p.locator('#ownerBanner').isVisible(), 'bon mot de passe : bannière « Espace propriétaire privé » visible');
ok((await p.locator('main').innerText()).includes('sans limite de plan'), 'espace complet et gratuit annoncé');
axe = await new AxeBuilder({ page: p }).analyze();
ok(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).length === 0, `axe (espace) : ${axe.violations.length} violation(s)`);

// complet : l'admin de l'espace peut tout faire, y compris modifier le règlement et exporter
await p.selectOption('#user', 'emp-paul'); await p.waitForTimeout(500);
const tabs = await p.locator('#tabs').innerText();
ok(['Journal', 'Exports', 'Règlement', 'Mon espace'].every((x) => tabs.includes(x)), 'admin de l\'espace : tous les onglets disponibles');
await p.locator('#tabs button', { hasText: 'Mon espace' }).click(); await p.waitForTimeout(300);
const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Exporter mon espace/ }).click()]);
const fs = await import('node:fs'); const dump = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
ok(dump.state?.employees?.length === 8, 'export JSON : 8 personnes');

// séparation : un autre navigateur (sans cookie propriétaire) ne voit rien de l'espace
const other = await browser.newContext(); const p2 = await page(other);
await p2.goto(url); await p2.waitForSelector('#tabs button');
ok(await p2.locator('#ownerBanner').isHidden(), 'autre navigateur : aucun accès à l\'espace propriétaire');
const r = await other.request.get(url + '/api/owner/export');
ok(r.status() === 401, `autre navigateur : export refusé (${r.status()})`);

await p.locator('#tabs button', { hasText: 'Mon espace' }).click();
await p.getByRole('button', { name: /Quitter/ }).click(); await p.waitForTimeout(600);
ok(await p.locator('#ownerBanner').isHidden(), 'déconnexion : bannière masquée');
await browser.close();
ok(errors.length === 0, `console : ${errors.length} erreur(s) ${errors.join(' | ')}`);
console.log(failed ? `\n${failed} ÉCHEC(S)` : '\nESPACE PROPRIÉTAIRE : TOUS LES TESTS PASSENT');
