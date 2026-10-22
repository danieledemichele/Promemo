/* Promemo — widget sul desktop: prossimo impegno con conto alla rovescia, oggi e aggiunta veloce */
'use strict';
const api = window.promemo;
let data = null;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const parse = (s) => s ? new Date(s.length === 10 ? s + 'T00:00' : s) : null;
const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function theme() {
  const t = data.settings.theme || 'auto';
  document.documentElement.dataset.theme = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  if (data.settings.accent) document.documentElement.style.setProperty('--accent', data.settings.accent);
}
function colorOf(e) {
  if (e.source) { const a = (data.accounts || []).find(x => x.id === e.source.acc); const g = a && (a.groups || []).find(x => x.id === e.source.group); if (g) return g.color; }
  if (e.tripRef) return (data.settings.trips || {}).color || '#0a84ff';
  return data.settings.localColor || '#e5562a';
}
function today() {
  const now = new Date(), k = dk(now);
  const ev = PromemoRecur.expand(data.events, new Date(now.getTime() - 864e5), new Date(now.getTime() + 864e5)).filter(e => e.start && e.start.slice(0, 10) <= k && (e.end || e.start).slice(0, 10) >= k && !e.allDay).map(e => ({ t: parse(e.start), end: parse(e.end || e.start), title: e.title, color: colorOf(e), loc: e.location, id: e._occ ? `${e.id}@${e._occ}` : e.id }));
  const st = data.projects.filter(p => p.status !== 'archiviato').flatMap(p => p.steps.filter(s => !s.done && s.due && s.due.slice(0, 10) === k).map(s => ({ t: parse(s.due), end: new Date(parse(s.due).getTime() + (+s.duration || 30) * 60000), title: (s.auto ? '✦ ' : '◯ ') + s.text, color: '#8e8e93', step: true })));
  return ev.concat(st).sort((a, b) => a.t - b.t);
}
function countdown(ms) { const m = Math.round(ms / 60000); if (m < 1) return 'adesso'; if (m < 60) return `tra ${m} min`; const h = Math.floor(m / 60); return `tra ${h} h${m % 60 ? ' ' + (m % 60) : ''}`; }
function draw() {
  if (!data) { $('#wg-body').innerHTML = '<div class="wg-empty">Promemo è bloccata</div>'; return; }
  theme();
  const now = new Date();
  $('#wg-date').textContent = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const items = today();
  const next = items.find(x => x.end > now && !x.step) || items.find(x => x.end > now);
  const tr = next && next.id && data.travel && data.travel[next.id];
  const run = data.focusRun;
  let html = '';
  if (run) { const left = Math.max(0, (new Date(run.endsAt) - (run.paused ? new Date(run.paused) : now)) / 1000); html += `<div class="wg-focus">${run.phase === 'break' ? '☕ Pausa' : '🎯 Concentrazione'} <b>${Math.floor(left / 60)}:${pad(Math.floor(left % 60))}</b></div>`; }
  html += next ? `<div class="wg-next" style="--c:${esc(next.color)}"><div class="wg-lbl">${next.t <= now ? 'In corso' : 'Prossimo'}</div><div class="wg-cd">${next.t <= now ? 'fino alle ' + hm(next.end) : countdown(next.t - now)}</div><div class="wg-tt">${esc(next.title)}</div><div class="wg-sub">${hm(next.t)}–${hm(next.end)}${next.loc ? ' · ' + esc(next.loc) : ''}</div>${tr && tr.leaveAt && !tr.same && (data.settings.travel || {}).enabled ? `<div class="wg-leave">esci alle ${tr.leaveAt.slice(11, 16)} · ${tr.min} min</div>` : ''}</div>`
    : '<div class="wg-next free"><div class="wg-lbl">Oggi</div><div class="wg-cd">Nessun altro impegno</div></div>';
  html += `<div class="wg-list">${items.map(x => `<div class="wg-row ${x.end < now ? 'past' : ''}"><span>${hm(x.t)}</span><i style="background:${esc(x.color)}"></i><b>${esc(x.title)}</b></div>`).join('') || '<div class="wg-empty">Giornata libera</div>'}</div>`;
  $('#wg-body').innerHTML = html;
}
api.getData().then(d => { data = d; draw(); });
api.onDataChanged(d => { data = d; draw(); });
setInterval(draw, 15000);
setInterval(() => { if (data && data.focusRun) draw(); }, 1000);
$('#wg-close').addEventListener('click', () => api.widgetToggle(false));
$('#wg-open').addEventListener('click', () => api.showMain());
$('#wg-add').addEventListener('submit', async (e) => {
  e.preventDefault(); const i = $('#wg-in'); if (!i.value.trim()) return;
  i.disabled = true; const r = await api.quickAdd({ text: i.value }); i.disabled = false;
  if (r.ok) { i.value = ''; i.placeholder = `✓ ${r.value.title}`; setTimeout(() => { i.placeholder = 'Aggiungi: dentista martedì alle 9…'; }, 3000); } else { i.classList.add('err'); i.title = r.error; setTimeout(() => i.classList.remove('err'), 1500); }
});
