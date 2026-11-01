// Owner space UI test (new-user journey from a blank workspace):
// OWNER_PASSWORD=... server running; node app/test/owner-ui.mjs <url> <password>
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
const serious = async (p) => (await new AxeBuilder({ page: p }).analyze()).violations.filter((v) => ['serious', 'critical'].includes(v.impact));

const pub = await browser.newContext(); const p0 = await page(pub);
await p0.goto(url); await p0.waitForSelector('#tabs button');
ok(!(await p0.locator('#tabs').innerText()).includes('Mon espace'), "public : l'onglet « Mon espace » n'est pas affiché");
ok(!(await p0.locator('#tabs').innerText()).includes('Configuration'), "public : pas d'onglet Configuration");
ok(await p0.locator('#ownerBanner').isHidden(), 'public : bannière propriétaire masquée');
const publicPeople = await p0.locator('#user option').count();

const ctx = await browser.newContext(); const p = await page(ctx);
await p.goto(url + '#owner'); await p.waitForSelector('#tabs button');
await p.locator('#tabs button', { hasText: 'Mon espace' }).click(); await p.waitForTimeout(300);
ok(await p.locator('input[type=password]').isVisible(), 'lien #owner : formulaire de mot de passe affiché');
ok((await serious(p)).length === 0, 'axe (connexion) : aucune violation sérieuse');
await p.fill('input[type=password]', 'mauvais mot de passe'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
ok((await p.locator('.error').innerText()).includes('Mot de passe incorrect'), 'mauvais mot de passe : message traduit');
await p.fill('input[type=password]', password); await p.keyboard.press('Enter'); await p.waitForTimeout(1000);

/* ---- nouvel utilisateur : espace vierge ---- */
ok(await p.locator('#ownerBanner').isVisible(), 'bon mot de passe : bannière « Espace propriétaire privé » visible');
ok((await p.locator('main h2').first().innerText()).includes('Configurer mon organisation'), "arrivée directe sur la configuration d'un espace vierge");
ok((await p.locator('#user option').count()) === 1, 'espace vierge : une seule personne (le propriétaire)');
ok(!(await p.locator('main').innerText()).match(/pharmac/i), 'espace vierge : aucun vocabulaire de pharmacie');
ok((await serious(p)).length === 0, 'axe (configuration) : aucune violation sérieuse');

await p.fill('input[name=name]', 'Atelier Exemple'); await p.fill('input[name=sector]', 'artisanat');
await p.locator('form').first().getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(700);
ok((await p.locator('#brand').innerText()).includes('Atelier Exemple'), "nom de l'organisation enregistré et affiché");

const addPerson = async (name, status, role, qualLabel, days, managers = []) => {
  const f = p.locator('form', { has: p.locator('input[name=occ]') });
  await f.locator('input[name=name]').fill(name);
  await f.locator('select[name=status]').selectOption(status); await f.locator('select[name=role]').selectOption(role);
  await f.locator('label', { hasText: qualLabel }).locator('input[type=checkbox]').first().check();
  for (const d of days) for (const h of ['AM', 'PM']) await f.locator(`input[name=s${d}${h}]`).check();
  for (const m of managers) await f.locator('fieldset', { hasText: 'Manager' }).locator('label', { hasText: m }).locator('input').check();
  await f.getByRole('button', { name: 'Ajouter la personne' }).click(); await p.waitForTimeout(700);
};
await addPerson('Camille Roux', 'manager', 'manager', 'Personne qualifiée', [1, 2, 3, 4, 5], ['Vous']);
await addPerson('Dominique Faure', 'part_time', 'employee', 'Personne qualifiée', [2, 4], ['Camille']);
await addPerson('Alex Pittet', 'employee', 'employee', 'Collaborateur', [1, 2, 3, 4, 5], ['Camille']);
ok((await p.locator('#user option').count()) === 4, 'équipe : 4 personnes dans le sélecteur Utilisateur');
ok((await p.locator('main').innerText()).includes('fait'), 'étape « ajouter l\'équipe » marquée faite');

/* ---- test d'usage : la seule qualifiée du lundi demande un congé ---- */
const monday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 35); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
await p.selectOption('#user', { label: 'Camille Roux' }); await p.waitForTimeout(600);
await p.locator('#tabs button').first().click(); await p.waitForTimeout(300);
await p.fill('input[name=start]', monday); await p.fill('input[name=end]', monday);
await p.getByRole('button', { name: 'Déposer' }).click(); await p.waitForTimeout(600);
await p.selectOption('#user', { label: 'Vous (administrateur)' }); await p.waitForTimeout(600);
await p.locator('#tabs button', { hasText: 'Tri des demandes' }).click(); await p.waitForTimeout(300);
await p.getByRole('button', { name: /Lancer le tri/ }).click(); await p.waitForTimeout(600);
const txt = await p.locator('main').innerText();
ok(txt.includes('Impossible en l\'état') && txt.includes('Aucune personne qualifiée présente'), 'tri : demande impossible, justification générique (personne qualifiée)');
ok(!/pharmac/i.test(txt), 'tri : aucun vocabulaire de pharmacie');

/* ---- espace complet : export, séparation, démo, déconnexion ---- */
await p.locator('#tabs button', { hasText: 'Mon espace' }).click(); await p.waitForTimeout(300);
ok((await serious(p)).length === 0, 'axe (mon espace) : aucune violation sérieuse');
const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Exporter mon espace/ }).click()]);
const fs = await import('node:fs'); const dump = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
ok(dump.state?.employees?.length === 4 && dump.state.org.name === 'Atelier Exemple', 'export JSON : 4 personnes et le nom de l\'organisation');

const other = await browser.newContext(); const p2 = await page(other);
await p2.goto(url); await p2.waitForSelector('#tabs button');
ok(await p2.locator('#ownerBanner').isHidden() && (await p2.locator('#user option').count()) === publicPeople, 'autre navigateur : ni espace propriétaire ni données de l\'atelier');
ok((await other.request.get(url + '/api/owner/export')).status() === 401, 'autre navigateur : export refusé (401)');

p.once('dialog', (d) => d.accept());
await p.getByRole('button', { name: /Charger les données de démonstration/ }).click(); await p.waitForTimeout(900);
ok((await p.locator('#user option').count()) === 8, 'chargement de la démo dans l\'espace : 8 personnes');
await p.locator('#tabs button', { hasText: 'Mon espace' }).click(); await p.waitForTimeout(300);
p.once('dialog', (d) => d.accept());
await p.getByRole('button', { name: /Repartir de zéro/ }).click(); await p.waitForTimeout(900);
ok((await p.locator('#user option').count()) === 1 && (await p.locator('main h2').first().innerText()).includes('Configurer'), 'repartir de zéro : espace vierge à nouveau');
await p.locator('#tabs button', { hasText: 'Mon espace' }).click(); await p.waitForTimeout(300);
await p.getByRole('button', { name: /Quitter/ }).click(); await p.waitForTimeout(800);
ok(await p.locator('#ownerBanner').isHidden() && (await p.locator('#user option').count()) === publicPeople, 'déconnexion : retour à la démo publique');
await browser.close();
ok(errors.length === 0, `console : ${errors.length} erreur(s) ${errors.join(' | ')}`);
console.log(failed ? `\n${failed} ÉCHEC(S)` : '\nESPACE PROPRIÉTAIRE : TOUS LES TESTS PASSENT');
