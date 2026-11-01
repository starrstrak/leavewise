// Minimal role-based UI. All visible text comes from /api/locale (no hard-coded strings).
let owner = { enabled: false, authenticated: false }, L = {}, lng = localStorage.getItem('lng') || 'fr', user = localStorage.getItem('user') || '', me = null, now = '', people = [], tab = 'me';
const $ = (s) => document.querySelector(s);
const get = (o, p) => {
  if (o == null || typeof o !== 'object') return p ? undefined : o;
  if (p in o) return o[p];
  const parts = p.split('.');
  for (let i = 1; i < parts.length; i++) {
    const head = parts.slice(0, i).join('.');
    if (head in o) { const r = get(o[head], parts.slice(i).join('.')); if (r !== undefined) return r; }
  }
  return undefined;
};
const t = (k, p = {}) => String(get(L, k) ?? k).replace(/\{(\w+)\}/g, (_, x) => p[x] ?? '');
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
async function api(path, method = 'GET', body, retried = false) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`/api${path}${sep}lng=${lng}`, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && !retried && ['no_session', 'invalid_session', 'session_expired'].includes(data.error)) {
    await signIn(user); // demo: the chosen role signs in again silently
    return api(path, method, body, true);
  }
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}
/** Demo sign-in: the chosen role is the whole login; the server answers with a signed, HttpOnly cookie. */
async function signIn(id) {
  const r = await fetch('/api/session', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: id }) });
  if (!r.ok) throw new Error((await r.json()).error || r.status);
}
const fail = (e) => { const box = h('div', { class: 'error', role: 'alert' }, `${t('ui.error')} : ${get(L, 'err.' + e.message) ?? e.message}`); $('#main').prepend(box); };
const isMgr = () => ['manager', 'hr', 'admin'].includes(me.role);
const isHr = () => ['hr', 'admin'].includes(me.role);
const name = (id) => people.find((p) => p.id === id)?.name ?? id;
const period = (a) => `${a.start} ${t('ui.' + a.startHalf.toLowerCase())} → ${a.end} ${t('ui.' + a.endHalf.toLowerCase())}`;
const badge = (txt, cls = '') => h('span', { class: `badge ${cls}` }, txt);
const stCls = { approved: 'ok', refused: 'bad', cancelled: 'bad', submitted: 'warn', cancel_requested: 'warn' };
const tf = (label, input) => h('label', {}, label, input);

function applyI18n() {
  document.documentElement.lang = lng;
  document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  $('#brand').textContent = t('app.name');
  document.title = `${t('app.name')} — ${t('app.tagline')}`;
}

async function init() {
  const boot = await (await fetch('/api/bootstrap')).json();
  people = boot.employees; now = boot.now;
  if (boot.session && people.some((p) => p.id === boot.session.userId)) user = boot.session.userId;
  if (!people.some((p) => p.id === user)) user = people[0].id;
  await signIn(user);
  const sel = $('#user'); sel.replaceChildren(...people.map((p) => h('option', { value: p.id, selected: p.id === user }, p.name)));
  sel.onchange = async () => { user = sel.value; localStorage.setItem('user', user); tab = 'me'; try { await signIn(user); await load(); } catch (e) { fail(e); } };
  $('#lng').value = lng;
  $('#lng').onchange = (e) => { lng = e.target.value; localStorage.setItem('lng', lng); load(); };
  await load();
}

async function load() {
  L = await (await fetch(`/api/locale?lng=${lng}`)).json();
  const boot = await (await fetch('/api/bootstrap')).json(); now = boot.now; owner = boot.owner ?? owner;
  me = people.find((p) => p.id === user);
  applyI18n();
  $('#clock').textContent = now.replace('T', ' ');
  $('#roleLabel').textContent = t('role.' + me.role);
  const tabs = [['me', 'ui.tab_me']];
  if (isMgr()) tabs.push(['queue', 'ui.tab_queue']);
  tabs.push(['coverage', 'ui.tab_coverage'], ['repl', 'ui.tab_repl']);
  if (isHr()) tabs.push(['audit', 'ui.tab_audit'], ['export', 'ui.tab_export']);
  if (me.role === 'admin') tabs.push(['admin', 'ui.tab_admin']);
  // the owner tab is not advertised: it shows once signed in, or when the page is opened with #owner
  if (owner.enabled && (owner.authenticated || location.hash === '#owner')) tabs.push(['owner', 'ui.tab_owner']);
  $('#ownerBanner').hidden = !owner.authenticated;
  if (!tabs.some(([k]) => k === tab)) tab = 'me';
  $('#tabs').replaceChildren(...tabs.map(([k, label]) => h('button', { 'aria-current': k === tab ? 'page' : null, onclick: () => { tab = k; load(); } }, t(label))));
  const view = { me: viewMe, queue: viewQueue, coverage: viewCoverage, repl: viewRepl, audit: viewAudit, export: viewExport, admin: viewAdmin, owner: viewOwner }[tab];
  $('#main').replaceChildren();
  try { await view(); } catch (e) { fail(e); }
}

const act = (fn) => async (e) => { try { await fn(e); await load(); } catch (err) { fail(err); } };

/* ---------- employee ---------- */
async function viewMe() {
  const [info, reqs] = await Promise.all([api('/me'), api('/requests')]);
  const b = info.balance, main = $('#main');
  const types = ['vacation', 'special', 'training', 'unpaid', 'carer', 'paternity', 'maternity'];
  const leaveHint = h('p', { class: 'muted', id: 'leave-hint', role: 'note' });
  const showHint = (type) => {
    const d = info.leaves?.[type];
    leaveHint.textContent = d ? t('leave.hint', { days: d.days, unit: t('unit.' + d.unit), proof: d.proof ? t('proof.' + d.proof) : '—' }) : '';
  };
  const form = h('form', { class: 'form', onsubmit: act(async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    await api('/requests', 'POST', { type: f.get('type'), start: f.get('start'), end: f.get('end'), startHalf: f.get('sh'), endHalf: f.get('eh'), urgent: f.get('urgent') === 'on', justification: f.get('just') || undefined });
  }) },
    tf(t('ui.type'), h('select', { name: 'type', onchange: (e) => showHint(e.target.value) }, types.map((x) => h('option', { value: x }, t('type.' + x))))),
    leaveHint,
    tf(t('ui.from'), h('input', { type: 'date', name: 'start', required: true })),
    tf(t('ui.half_start'), h('select', { name: 'sh' }, ['AM', 'PM'].map((x) => h('option', { value: x }, t('ui.' + x.toLowerCase()))))),
    tf(t('ui.to'), h('input', { type: 'date', name: 'end', required: true })),
    tf(t('ui.half_end'), h('select', { name: 'eh' }, ['PM', 'AM'].map((x) => h('option', { value: x }, t('ui.' + x.toLowerCase()))))),
    h('label', {}, t('ui.urgent'), h('input', { type: 'checkbox', name: 'urgent' })),
    tf(t('ui.justification'), h('input', { name: 'just' })),
    h('button', { class: 'primary' }, t('ui.submit')));
  main.append(
    h('div', { class: 'grid' },
      h('section', { class: 'card' }, h('h2', {}, t('ui.balance')),
        b ? h('p', {}, `${t('ui.entitlement')} : ${b.entitlement} · ${t('ui.taken')} : ${b.taken + b.closures} · `, h('strong', {}, `${t('ui.remaining')} : ${b.remaining} ${t('ui.days')}`)) : t('ui.none'),
        b?.consecutive ? h('p', { class: b.consecutive.met ? 'muted' : 'reminder', id: 'consecutive-reminder', role: 'note' },
          t(b.consecutive.met ? 'leave.consec_ok' : 'leave.consec_remind', b.consecutive)) : null),
      h('section', { class: 'card' }, h('h2', {}, t('ui.notifications')),
        h('ul', {}, info.notifications.slice(0, 6).map((n) => h('li', {}, `${n.ts.replace('T', ' ')} — ${t('notif.' + n.kind, n.params)}`))))),
    h('section', { class: 'card' }, h('h2', {}, t('ui.new_request')), form),
    h('section', { class: 'card' }, h('h2', {}, t('ui.tab_me')),
      h('table', {}, h('thead', {}, h('tr', {}, [t('ui.employee'), t('ui.type'), t('ui.period'), t('ui.status'), t('ui.actions')].map((x, i) => h('th', {}, i === 4 ? h('span', { class: 'sr-only' }, x) : x)))),
        h('tbody', {}, reqs.requests.filter((r) => isHr() || r.employeeId === user).sort((a, c) => c.submittedAt.localeCompare(a.submittedAt)).map((r) => h('tr', {},
          h('td', {}, name(r.employeeId)), h('td', {}, t('type.' + r.type)), h('td', {}, period(r)), h('td', {}, badge(t('status.' + r.status), stCls[r.status])),
          h('td', {},
            r.status === 'submitted' && r.employeeId === user ? h('button', { onclick: act(() => api(`/requests/${r.id}/withdraw`, 'POST')) }, t('ui.withdraw')) : null,
            r.status === 'approved' && r.employeeId === user ? h('button', { onclick: act(() => api(`/requests/${r.id}/cancel-request`, 'POST', {})) }, t('ui.request_cancel')) : null)))))),
    consentCard(info.consent));
}

function consentCard(c) {
  return h('section', { class: 'card' }, h('h2', {}, t('ui.consent')), h('p', { class: 'muted' }, t('ui.sensitive_notice')),
    h('form', { class: 'form', onsubmit: act(async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      await api('/consent', 'POST', { consent: f.get('consent') === 'on', childrenUnder12: Number(f.get('kids') || 0), carer: f.get('carer') === 'on' });
    }) },
      h('label', {}, t('ui.consent'), h('input', { type: 'checkbox', name: 'consent', checked: !!c.consent })),
      tf(t('ui.children_under_12'), h('input', { type: 'number', min: 0, name: 'kids', value: c.childrenUnder12 ?? 0 })),
      h('label', {}, t('ui.carer'), h('input', { type: 'checkbox', name: 'carer', checked: !!c.carer })),
      h('button', {}, t('ui.save'))));
}

/* ---------- triage ---------- */
async function viewQueue() {
  const main = $('#main');
  const [decisions, reqs] = await Promise.all([api('/decisions'), api('/requests')]);
  const byReq = new Map(reqs.requests.map((r) => [r.id, r]));
  const proposed = decisions.filter((d) => d.status === 'proposed');
  const picks = new Set();
  const box = h('div');
  main.append(h('h2', {}, t('ui.tab_queue')),
    h('div', { class: 'row card' },
      h('button', { class: 'primary', onclick: act(() => api('/triage', 'POST', {})) }, t('ui.run_triage')),
      h('button', { onclick: act(async () => { await api('/decisions/validate', 'POST', { ids: [...picks] }); }) }, t('ui.validate_selected'))),
    box);
  if (!proposed.length) box.append(h('p', { class: 'muted' }, t('ui.no_items')));
  for (const d of proposed) {
    const r = byReq.get(d.requestId);
    const cls = d.outcome === 'impossible' ? 'bad' : d.risk === 'zero' ? 'ok' : 'warn';
    const reason = h('input', { placeholder: t('ui.reason_required'), 'aria-label': t('ui.reason_required') });
    const changes = h('div', { class: 'muted' });
    const doOverride = (action, preview, extra = {}) => async () => {
      try {
        const res = await api('/decisions/override', 'POST', { requestId: d.requestId, action, reason: reason.value, preview, ...extra });
        if (preview) changes.replaceChildren(h('strong', {}, t('ui.changes') + ' : '), res.changes.length ? res.changes.map((c) => h('div', {}, `${c.requestId} : ${t('outcome.' + c.from)} → ${t('outcome.' + c.to)}`)) : t('ui.none'));
        else await load();
      } catch (e) { fail(e); }
    };
    box.append(h('article', { class: 'card' },
      h('div', { class: 'row' },
        d.outcome !== 'impossible' ? h('input', { type: 'checkbox', 'aria-label': t('ui.select'), onchange: (e) => (e.target.checked ? picks.add(d.id) : picks.delete(d.id)) }) : null,
        h('strong', {}, name(r.employeeId)), `${t('type.' + r.type)} · ${period(r)}`,
        badge(t('outcome.' + d.outcome), cls), badge(`${t('ui.risk')} : ${t('risk.' + d.risk)}`),
        d.score ? badge(`${t('ui.score')} ${d.score.total}`) : null, d.tie ? badge(t('ui.tie'), 'warn') : null),
      d.score ? h('p', { class: 'muted' }, `eq ${d.score.equity} · rot ${d.score.rotation} · urg ${d.score.urgency} · ord ${d.score.order}${d.score.familyActive ? ` · fam ${d.score.family}` : ''}`) : null,
      h('ul', { class: 'reasons' }, d.reasonsText.map((x) => h('li', { class: x.severity }, x.text))),
      d.alternativesText.length ? h('div', {}, h('strong', {}, t('ui.alternatives')), h('ul', {}, d.alternativesText.map((a) => h('li', {}, a.text, ' ',
        a.start ? h('button', { onclick: doOverride('modify', false, { start: a.start, end: a.end, startHalf: a.startHalf, endHalf: a.endHalf }) }, t('ui.apply')) : null)))) : null,
      h('div', { class: 'row' }, reason,
        h('button', { onclick: doOverride('approve', true) }, `${t('ui.approve')} (${t('ui.preview')})`), h('button', { onclick: doOverride('approve', false) }, t('ui.approve')),
        h('button', { onclick: doOverride('refuse', true) }, `${t('ui.refuse')} (${t('ui.preview')})`), h('button', { onclick: doOverride('refuse', false) }, t('ui.refuse'))),
      changes));
  }
  const cancels = reqs.requests.filter((r) => r.status === 'cancel_requested');
  if (cancels.length) main.append(h('section', { class: 'card' }, h('h3', {}, t('status.cancel_requested')),
    cancels.map((r) => h('div', { class: 'row' }, name(r.employeeId), period(r),
      h('button', { onclick: act(() => api(`/requests/${r.id}/cancel-decide`, 'POST', { accept: true, reason: '—' })) }, t('ui.approve')),
      h('button', { onclick: act(() => api(`/requests/${r.id}/cancel-decide`, 'POST', { accept: false, reason: '—' })) }, t('ui.refuse'))))));
}

/* ---------- coverage ---------- */
async function viewCoverage() {
  const from = now.slice(0, 10);
  const slots = await api(`/coverage?from=${from}&to=${new Date(Date.parse(from) + 27 * 86400000).toISOString().slice(0, 10)}`);
  const days = [...new Set(slots.map((s) => s.date))];
  const body = h('tbody', {});
  for (const d of days) {
    const row = h('tr', {}, h('th', { scope: 'row' }, d));
    for (const half of ['AM', 'PM']) {
      const s = slots.find((x) => x.date === d && x.half === half);
      const txt = s.status === 'closed' ? t('ui.coverage_closed') : s.status === 'ok' ? `${t('ui.coverage_ok')} (${s.qualified})` : t('ui.coverage_ko');
      row.append(h('td', { class: s.status }, txt));
    }
    body.append(row);
  }
  const grid = h('table', { class: 'cal' }, h('caption', { class: 'sr-only' }, t('ui.tab_coverage')),
    h('thead', {}, h('tr', {}, [t('ui.date'), t('ui.am'), t('ui.pm')].map((x) => h('th', { scope: 'col' }, x)))), body);
  $('#main').append(h('h2', {}, t('ui.tab_coverage')), h('div', { class: 'card' }, grid));
}

/* ---------- replacements ---------- */
async function viewRepl() {
  const rrs = await api('/replacements');
  const main = $('#main');
  const slotsTxt = (rr) => rr.slots.map((s) => `${s.date} ${t('ui.' + s.half.toLowerCase())}`).join(', ');
  const sick = h('form', { class: 'form', onsubmit: act(async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const halves = f.get('halves') === 'both' ? ['AM', 'PM'] : [f.get('halves')];
    await api('/unplanned', 'POST', { employeeId: f.get('emp'), date: f.get('date'), halves, type: f.get('type'), certificate: f.get('cert') === 'on' });
  }) },
    tf(t('ui.employee'), h('select', { name: 'emp' }, people.filter((p) => isMgr() || p.id === user).map((p) => h('option', { value: p.id, selected: p.id === user }, p.name)))),
    tf(t('ui.date'), h('input', { type: 'date', name: 'date', value: now.slice(0, 10), required: true })),
    tf(t('ui.halves'), h('select', { name: 'halves' }, h('option', { value: 'both' }, t('ui.both')), h('option', { value: 'AM' }, t('ui.am')), h('option', { value: 'PM' }, t('ui.pm')))),
    tf(t('ui.type'), h('select', { name: 'type' }, ['sickness', 'accident'].map((x) => h('option', { value: x }, t('type.' + x))))),
    h('label', {}, t('ui.justification') + ' (certificat)', h('input', { type: 'checkbox', name: 'cert' })),
    h('button', { class: 'primary' }, t('ui.declare')));
  main.append(h('h2', {}, t('ui.tab_repl')), h('section', { class: 'card' }, h('h3', {}, t('ui.sick_title')), sick));
  if (isMgr()) main.append(h('div', { class: 'row' }, h('button', { onclick: act(async () => {
    await api('/clock', 'POST', { now: new Date(Date.parse(now + ':00Z') + 30 * 60000).toISOString().slice(0, 16) });
    await api('/tick', 'POST', {});
  }) }, t('ui.tick'))));
  main.append(h('h3', {}, t('ui.needs')));
  if (!rrs.length) main.append(h('p', { class: 'muted' }, t('ui.no_items')));
  for (const rr of rrs) {
    const reason = h('input', { placeholder: t('ui.reason_required'), 'aria-label': t('ui.reason_required') });
    const mine = rr.offers.find((o) => o.candidateId === user && o.status === 'pending');
    main.append(h('article', { class: 'card' },
      h('div', { class: 'row' }, h('strong', {}, rr.id), badge(t('rstatus.' + rr.status), rr.status === 'filled' ? 'ok' : 'warn'), badge(t('qual.' + rr.qualification)), `${rr.kind} · ${slotsTxt(rr)}`, rr.late ? badge('!', 'bad') : null),
      h('ul', {}, rr.offers.map((o) => h('li', {}, `${name(o.candidateId)} — ${o.status}${o.reminders ? ' (rappel)' : ''}`))),
      rr.ranking.length ? h('p', { class: 'muted' }, rr.ranking.slice(0, 4).map((c) => `${name(c.employeeId)} (${c.score})`).join(' · ')) : null,
      mine ? h('div', { class: 'row' }, h('button', { class: 'primary', onclick: act(() => api(`/replacements/${rr.id}/respond`, 'POST', { accept: true })) }, t('ui.accept')),
        h('button', { onclick: act(() => api(`/replacements/${rr.id}/respond`, 'POST', { accept: false })) }, t('ui.decline'))) : null,
      isMgr() && rr.impact ? h('div', { class: 'row' },
        h('button', { onclick: act(() => api(`/replacements/${rr.id}/offer`, 'POST', {})) }, t('ui.offer_next')),
        reason,
        ['reduced_hours', 'closure'].map((o) => h('button', { onclick: act(() => api(`/replacements/${rr.id}/plan-b`, 'POST', { option: o, reason: reason.value })) },
          `${t('ui.plan_b')} : ${t('ui.' + o)} — ${t('ui.impact')} ${rr.impact[o].closedHalfDays} ${t('ui.closed_half_days')}`))) : null));
  }
}

/* ---------- audit / export / admin ---------- */
async function viewAudit() {
  const rows = await api('/audit');
  $('#main').append(h('h2', {}, t('ui.tab_audit')), h('table', {},
    h('thead', {}, h('tr', {}, [t('ui.when'), t('ui.author'), t('ui.action'), t('ui.entity'), t('ui.justification')].map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.slice(0, 300).map((a) => h('tr', {}, h('td', {}, a.ts.replace('T', ' ')), h('td', {}, name(a.actor)), h('td', {}, t('audit.' + a.action)), h('td', {}, a.entityId), h('td', {}, a.justification ?? ''))))));
}

async function viewExport() {
  const dl = (kind, label) => h('button', { onclick: async () => {
    const txt = await api(`/export/${kind}.csv`);
    const a = h('a', { href: URL.createObjectURL(new Blob([txt], { type: 'text/csv' })), download: `${kind}.csv` }); a.click();
  } }, label);
  $('#main').append(h('h2', {}, t('ui.tab_export')), h('div', { class: 'row card' }, dl('audit', t('ui.export_audit')), dl('balances', t('ui.export_balances')), dl('requests', t('ui.export_requests'))));
}

async function viewAdmin() {
  const versions = await api('/rules');
  const cur = versions.at(-1);
  const w = cur.priority.weights;
  const form = h('form', { class: 'form', onsubmit: act(async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    await api('/rules', 'PUT', {
      effectiveFrom: f.get('eff'),
      priority: { sensitiveEnabled: f.get('sens') === 'on', weights: Object.fromEntries(Object.keys(w).map((k) => [k, Number(f.get('w_' + k))])) },
      automation: { autoApproveZeroRisk: f.get('auto') === 'on' },
      internal: { ...cur.internal, minNoticeDays: Number(f.get('notice')), maxConsecutiveDays: Number(f.get('maxc')) },
      legal: { ...cur.legal, leaves: Object.fromEntries(Object.entries(cur.legal.leaves ?? {}).map(([k, d]) => [k, { ...d, days: Number(f.get('leave_' + k)) }])) },
    });
  }) },
    tf(t('ui.rules_effective'), h('input', { type: 'date', name: 'eff', value: now.slice(0, 10), required: true })),
    Object.keys(w).map((k) => tf(`${t('ui.weights')} : ${k}`, h('input', { type: 'number', min: 0, max: 100, name: 'w_' + k, value: w[k] }))),
    tf('min notice (d)', h('input', { type: 'number', name: 'notice', value: cur.internal.minNoticeDays })),
    tf('max consecutive (d)', h('input', { type: 'number', name: 'maxc', value: cur.internal.maxConsecutiveDays })),
    h('fieldset', {}, h('legend', {}, t('leave.title')),
      Object.entries(cur.legal.leaves ?? {}).map(([k, d]) => tf(`${t('type.' + k)} (${t('unit.' + d.unit)}${d.yearlyMaxDays ? `, ${t('leave.yearly')} ${d.yearlyMaxDays}` : ''})`,
        h('input', { type: 'number', min: 0, max: 365, name: 'leave_' + k, value: d.days })))),
    h('label', {}, t('ui.sensitive_enabled'), h('input', { type: 'checkbox', name: 'sens', checked: cur.priority.sensitiveEnabled })),
    h('label', {}, t('ui.auto_zero'), h('input', { type: 'checkbox', name: 'auto', checked: cur.automation.autoApproveZeroRisk })),
    h('button', { class: 'primary' }, t('ui.new_version')));
  $('#main').append(h('h2', {}, t('ui.tab_admin')), h('p', { class: 'muted' }, t('ui.legal_notice')), h('section', { class: 'card' }, form),
    h('button', { onclick: act(() => api('/reset', 'POST', {})) }, t('ui.reset')));
}

init().catch((e) => { document.body.append(h('pre', {}, String(e))); });

/* ---------- private owner space ---------- */
async function viewOwner() {
  const main = $('#main');
  if (!owner.authenticated) {
    const pw = h('input', { type: 'password', name: 'pw', autocomplete: 'current-password', required: true });
    main.append(h('h2', {}, t('ui.owner_login_title')), h('form', { class: 'form card', onsubmit: act(async (e) => {
      e.preventDefault();
      await api('/owner/login', 'POST', { password: pw.value });
      pw.value = '';
    }) }, tf(t('ui.owner_password'), pw), h('button', { class: 'primary' }, t('ui.owner_login'))));
    return;
  }
  const file = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': t('ui.owner_import') });
  main.append(h('h2', {}, t('ui.owner_title')), h('p', { class: 'muted' }, t('ui.owner_notice')),
    h('div', { class: 'row card' },
      h('button', { onclick: async () => {
        try {
          const data = await api('/owner/export');
          const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'leavewise-owner-state.json' }); a.click();
        } catch (e) { fail(e); }
      } }, t('ui.owner_export')),
      h('label', {}, t('ui.owner_import'), file),
      h('button', { onclick: act(async () => {
        if (!file.files[0]) return;
        const r = await api('/owner/import', 'POST', JSON.parse(await file.files[0].text()));
        $('#main').dataset.imported = String(r.employees);
      }) }, t('ui.apply')),
      h('button', { onclick: act(async () => { if (confirm(t('ui.owner_reset_confirm'))) await api('/owner/reset', 'POST', {}); }) }, t('ui.owner_reset')),
      h('button', { onclick: act(async () => { await api('/owner/logout', 'POST', {}); tab = 'me'; }) }, t('ui.owner_logout'))));
}
