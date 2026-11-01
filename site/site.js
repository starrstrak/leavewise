// Language switch (FR/DE/EN), theme toggle, mobile menu. Text comes only from locales/*.json.
const SUPPORTED = ['fr', 'de', 'en'];
const cache = {};
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

async function dict(lng) {
  if (!cache[lng]) cache[lng] = await (await fetch(`locales/${lng}.json`)).json();
  return cache[lng];
}

export async function applyLang(lng) {
  const d = await dict(lng);
  document.documentElement.lang = lng;
  document.querySelectorAll('[data-i18n]').forEach((el) => { if (el.dataset.i18n in d) el.textContent = d[el.dataset.i18n]; });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    const [attr, key] = el.dataset.i18nAttr.split(':');
    if (key in d) el.setAttribute(attr, d[key]);
  });
  document.querySelectorAll('[data-days]').forEach((el) => {
    el.querySelectorAll('.dow').forEach((b, i) => { b.textContent = d[el.dataset.days].split(',')[i]; });
  });
  const sel = document.getElementById('lang'); if (sel) sel.value = lng;
  store.set('lng', lng);
}

const params = new URLSearchParams(location.search);
const initial = [params.get('lng'), store.get('lng'), navigator.language?.slice(0, 2)].find((l) => SUPPORTED.includes(l)) ?? 'fr';
if (initial !== 'fr') applyLang(initial); else { const s = document.getElementById('lang'); if (s) s.value = 'fr'; }
document.getElementById('lang')?.addEventListener('change', (e) => applyLang(e.target.value));

const root = document.documentElement;
const savedTheme = store.get('theme');
if (savedTheme) root.dataset.theme = savedTheme;
document.getElementById('themeBtn')?.addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  store.set('theme', root.dataset.theme);
});

const btn = document.getElementById('menuBtn'), nav = document.getElementById('nav');
btn?.addEventListener('click', () => { const open = nav.classList.toggle('open'); btn.setAttribute('aria-expanded', String(open)); });
nav?.addEventListener('click', (e) => { if (e.target.closest('a[href^="#"]')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav?.classList.contains('open')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
