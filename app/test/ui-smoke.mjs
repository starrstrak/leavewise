// Smoke test UI: node app/test/ui-smoke.mjs [url]  (server must be running)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] ?? 'http://localhost:3000';
const errors = [];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(String(e)));
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'} ${msg}`); if (!c) process.exitCode = 1; };
await p.goto(url);
await p.waitForSelector('#tabs button');
const pick = async (id) => { await p.selectOption('#user', id); await p.waitForTimeout(300); };
const tab = async (n) => { await p.locator('#tabs button').nth(n).click(); await p.waitForTimeout(300); };

await pick('emp-claire'); await tab(1);
await p.getByRole('button', { name: /Lancer le tri/ }).click(); await p.waitForTimeout(400);
ok((await p.locator('article.card').count()) >= 5, 'manager: triage cards displayed');
ok((await p.locator('main').innerText()).includes('Aucun pharmacien présent'), 'manager: justification en français');
ok(!/\b(ui|reason|alt|outcome)\.[a-z_]+/.test(await p.locator('main').innerText()), 'manager: aucune clé de traduction brute');
await p.locator('article.card input[type=checkbox]').first().check();
await p.getByRole('button', { name: /Valider la sélection/ }).click(); await p.waitForTimeout(400);
await p.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/queue.png` : '/tmp/queue.png', fullPage: true });

await tab(2);
ok((await p.locator('.cal td').count()) > 20, 'coverage grid rendered');
ok((await p.locator('main').innerText()).includes('Pharmacien présent ✓'), 'coverage shows pharmacist present');

await pick('emp-lea'); await tab(0);
ok((await p.locator('main').innerText()).includes('Solde de vacances'), 'employee: balance visible');
ok(!(await p.locator('#tabs').innerText()).includes('Journal'), 'employee: no audit tab');
ok(/Vacances consécutives prévues : 10 jours ouvrés/.test(await p.locator('#consecutive-reminder').innerText()), 'employee: 2 semaines consécutives prévues (Léa) : pas de rappel');
await p.selectOption('select[name=type]', 'paternity');
ok(/À valider par un juriste/.test(await p.locator('#leave-hint').innerText()), 'employee: durée par défaut paternité marquée « à valider par un juriste »');

await pick('emp-luc'); await tab(0);
ok(/Rappel : au moins 10 jours ouvrés/.test(await p.locator('#consecutive-reminder').innerText()), 'employee: rappel des 2 semaines consécutives affiché (Luc)');

await pick('emp-paul'); 
await p.locator('#tabs button', { hasText: 'Journal' }).click(); await p.waitForTimeout(300);
ok((await p.locator('tbody tr').count()) > 3, 'admin: audit rows');

await p.selectOption('#lng', 'de'); await p.waitForTimeout(500);
ok((await p.locator('#tabs').innerText()).includes('Audit-Protokoll'), 'language switch DE');
await p.selectOption('#lng', 'en'); await p.waitForTimeout(500);
ok((await p.locator('#tabs').innerText()).includes('Audit log'), 'language switch EN');
await p.selectOption('#lng', 'fr');
await b.close();
ok(errors.length === 0, `console errors: ${errors.length} ${errors.join(' | ')}`);
