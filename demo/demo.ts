// Scripted walkthrough on fictional data: npm run demo
import { buildDemoState, DEMO_NOW } from './seed.js';
import { declareUnplanned, overrideDecision, respondOffer, runTriage, validateDecisions } from '../app/src/actions.js';
import { renderAlt, renderReason, t } from '../app/src/i18n.js';

const s = buildDemoState();
const name = (id: string) => s.employees.find((e) => e.id === id)!.name;
const title = (x: string) => console.log(`\n=== ${x} ===`);

title('1. Tri automatique des demandes en attente (' + DEMO_NOW + ')');
const ds = runTriage(s, DEMO_NOW);
for (const d of ds) {
  const r = s.absences.find((a) => a.id === d.requestId)!;
  console.log(`\n${name(r.employeeId)} — ${r.start} → ${r.end} : ${t('fr', 'outcome.' + d.outcome)} (score ${d.score?.total}, risque ${t('fr', 'risk.' + d.risk)})`);
  for (const x of d.reasons) console.log(`  - ${renderReason('fr', x)}`);
  for (const a of d.alternatives) console.log(`  > ${renderAlt('fr', a)}`);
}

title('2. Validation par lot des décisions sans blocage, sauf celle de Sofia Rey (le manager Claire Morel ne décide pas de sa propre demande)');
const sofia = s.absences.find((a) => a.employeeId === 'emp-sofia' && a.status === 'submitted')!;
const ok = ds.filter((d) => d.outcome !== 'impossible' && d.requestId !== sofia.id).map((d) => d.id);
console.log(validateDecisions(s, ok, 'emp-claire', DEMO_NOW));
console.log('Notifications envoyées aux employés après validation :', s.notifications.filter((n) => n.kind === 'request_approved' && n.channel === 'inapp').map((n) => name(n.to)).join(', '));

title('3. Ajustement humain : refuser Sofia Rey (motif obligatoire), aperçu puis application des impacts en cascade');
const input = { requestId: sofia.id, action: 'refuse' as const, reason: 'Inventaire du 13 au 17 juillet : équipe complète requise', actor: 'emp-claire' };
const prev = overrideDecision(s, input, DEMO_NOW, true) as any;
for (const c of prev.changes) console.log(`  Aperçu : demande ${c.requestId} (${name(s.absences.find((a) => a.id === c.requestId)!.employeeId)}) ${t('fr', 'outcome.' + c.from)} → ${t('fr', 'outcome.' + c.to)} ; blocages restants : ${c.codes.join(', ') || 'aucun'}`);
overrideDecision(s, input, DEMO_NOW);
console.log('Refus appliqué, motif tracé :', s.audit.filter((a) => a.action === 'decision.refuse').at(-1)?.justification);

title('4. Maladie imprévue de la pharmacienne responsable, lundi 8 juin 2026 à 07h30');
const res = declareUnplanned(s, { employeeId: 'emp-claire', date: '2026-06-08', certificate: true }, 'emp-claire', '2026-06-08T07:30');
console.log('Besoin de remplacement :', res.needs.map((n) => `${n.id} ${n.slots.length} demi-journées, qualification ${n.qualification}`).join('; '));
console.log('Offre envoyée à :', JSON.stringify(res.offers.map((o) => (o.result as any).offered && name((o.result as any).offered))));
const rr = res.needs[0];
console.log('Réponse :', JSON.stringify(respondOffer(s, rr.id, rr.offers[0].candidateId, true, '2026-06-08T07:40')));
console.log('Statut du besoin :', t('fr', 'rstatus.' + rr.status));

title('5. Journal d\'audit (extrait)');
for (const a of s.audit.slice(-8)) console.log(`${a.ts} ${a.actor.padEnd(12)} ${t('fr', 'audit.' + a.action)} ${a.entityId}${a.justification ? ' — ' + a.justification : ''}`);
