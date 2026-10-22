/* Promemo — finestra di aggiunta rapida (scorciatoia globale) */
'use strict';
const api = window.promemo;
let data = null;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inp = $('#qk-in'), prev = $('#qk-prev');
const HINT = prev.innerHTML;
function theme() { if (!data) return; const t = data.settings.theme || 'auto'; document.documentElement.dataset.theme = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t; if (data.settings.accent) document.documentElement.style.setProperty('--accent', data.settings.accent); }
function fit() { requestAnimationFrame(() => api.quickResize($('#qk').getBoundingClientRect().height + 24)); }
function preview() {
  const t = inp.value.trim();
  if (!t || !data) { prev.innerHTML = HINT; fit(); return; }
  const r = PromemoNLP.parse(t, { projects: data.projects.filter(p => p.status !== 'archiviato') });
  const pj = r.projectId && data.projects.find(p => p.id === r.projectId);
  prev.innerHTML = `<div class="qk-title">${esc(r.title || '…')}</div><div class="qk-chips">${PromemoNLP.describe(r).map(([k, v]) => `<span><i>${esc(k)}</i>${esc(v)}</span>`).join('')}${pj ? `<span><i>progetto</i>${esc(pj.title)}</span>` : r.kind === 'passo' ? '<span><i>progetto</i>Da fare</span>' : ''}</div>`;
  fit();
}
inp.addEventListener('input', preview);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { inp.value = ''; preview(); api.quickHide(); } });
$('#qk-form').addEventListener('submit', async (e) => {
  e.preventDefault(); if (!inp.value.trim()) return;
  inp.disabled = true;
  const r = await api.quickAdd({ text: inp.value });
  inp.disabled = false;
  if (!r.ok) { prev.innerHTML = `<div class="qk-err">${esc(r.error)}</div>`; fit(); return; }
  prev.innerHTML = `<div class="qk-ok">✓ Aggiunto: <b>${esc(r.value.title)}</b><span>${esc(r.value.text)}</span></div>`; fit();
  inp.value = '';
  setTimeout(() => { prev.innerHTML = HINT; api.quickHide(); }, 1100);
});
api.getData().then(d => { data = d; theme(); fit(); inp.focus(); });
api.onDataChanged(d => { data = d; theme(); });
api.onQuickOpen(() => { inp.value = ''; preview(); inp.focus(); });
window.addEventListener('focus', () => inp.focus());
