/* Promemo — aggiungere scrivendo una frase: "dentista martedì alle 9 e mezza, avvisami un'ora prima" */
'use strict';

const QUICK_EX = ['ripetizione con Giulia giovedì alle 16 per un’ora, ricordamelo 30 minuti prima', 'studiare cap. 4 entro venerdì 2h', 'cena con amici stasera @Poetto', 'riunione domani dalle 10 alle 12 presso Aula Magna'];
const quickParse = (t) => PromemoNLP.parse(t, { projects: data.projects.filter(p => p.status !== 'archiviato') });
function quickPreview(t) {
  if (!t.trim()) return '';
  const r = quickParse(t);
  if (!r.title) return '';
  const pj = r.projectId && proj(r.projectId);
  return `<div class="qa-prev"><b>${esc(r.title)}</b>${PromemoNLP.describe(r).map(([k, v]) => `<span class="qa-chip"><i>${esc(k)}</i>${esc(v)}</span>`).join('')}${pj ? `<span class="qa-chip"><i>progetto</i>${esc(pj.title)}</span>` : r.kind === 'passo' ? '<span class="qa-chip"><i>progetto</i>Da fare</span>' : ''}</div>`;
}
async function quickCreate(text) {
  if (typeof flushSave === 'function') await flushSave();
  const r = await api.quickAdd({ text });
  if (!r.ok) { toast(r.error); return null; }
  const d = await api.getData(); if (d) data = d;
  render();
  toast(`${r.value.kind === 'passo' ? 'Compito' : 'Aggiunto'}: ${r.value.title}${r.value.text ? ' · ' + r.value.text.split(' · ').slice(1, 2).join('') : ''}`);
  return r.value;
}
function quickFieldHTML() {
  return `<form class="qa-field" id="qa-form"><span class="qa-ic">${icon('i-spark')}</span><input id="qa-in" placeholder="Scrivi in una frase… es. ${esc(QUICK_EX[Math.floor(Math.random() * QUICK_EX.length)])}" autocomplete="off" spellcheck="false"><button class="btn-primary small" disabled>Aggiungi</button></form><div id="qa-prev"></div><div class="qa-or">oppure scegli</div>`;
}
function quickFieldBind(m) {
  const f = m.querySelector('#qa-form'); if (!f) return;
  const inp = f.querySelector('input'), btn = f.querySelector('button'), prev = m.querySelector('#qa-prev');
  inp.addEventListener('input', () => { prev.innerHTML = quickPreview(inp.value); btn.disabled = !inp.value.trim(); });
  f.addEventListener('submit', async (e) => { e.preventDefault(); e.stopPropagation(); if (!inp.value.trim()) return; btn.disabled = true; const r = await quickCreate(inp.value); if (r) closeModal(); else btn.disabled = false; }, true);
  setTimeout(() => inp.focus(), 40);
}
// nella palette (Ctrl+K): se la frase contiene una data, un'ora o "entro", la prima voce la crea
PALETTE_TOP.push((t) => {
  if (!t || t.trim().split(/\s+/).length < 2) return [];
  const r = quickParse(t);
  if (!r.title || !(r.start || r.due || r.deadline || /^\s*(compito|da fare)/i.test(t))) return [];
  return [{ t: `Crea “${r.title}”`, i: 'i-plus', sub: PromemoNLP.describe(r).map(x => x[1]).slice(1, 3).join(' · '), run: () => quickCreate(t) }];
});
