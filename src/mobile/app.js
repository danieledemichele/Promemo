/* Promemo sul telefono */
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };
// la chiave arriva nel link dell'abbinamento (#k=…) e resta solo su questo telefono
const hk = new URLSearchParams(location.hash.slice(1)).get('k');
if (hk) { store.set('promemo.key', hk); history.replaceState(null, '', location.pathname); }
const KEY = store.get('promemo.key');
let st = null, tab = 'oggi';
try { st = JSON.parse(store.get('promemo.state') || 'null'); } catch { st = null; }
const hm = (s) => s ? s.slice(11, 16) : '';
const dayName = (k) => { const d = new Date(k + 'T00:00'), t = new Date(); t.setHours(0, 0, 0, 0); const diff = Math.round((d - t) / 864e5); return diff === 0 ? 'Oggi' : diff === 1 ? 'Domani' : d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }); };
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2400); }
async function call(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'X-Promemo-Key': KEY || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Errore ' + r.status);
  return j;
}
async function load() {
  $('#refresh').classList.add('spin');
  try { st = await call('/api/state'); store.set('promemo.state', JSON.stringify(st)); $('#sub').textContent = 'Aggiornato ora'; }
  catch (e) { $('#sub').textContent = st ? `Non raggiungibile · dati delle ${new Date(st.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : e.message; }
  finally { $('#refresh').classList.remove('spin'); draw(); }
}
const item = (x) => `<div class="it ${x.type === 'st' && x.done ? 'done' : ''}" style="--c:${esc(x.color)}">
  ${x.type === 'st' ? `<button class="ck ${x.done ? 'on' : ''}" data-pid="${x.pid}" data-id="${x.id}" aria-label="Fatto">✓</button>` : `<span class="tm">${x.allDay ? 'Giorno' : hm(x.start)}</span>`}
  <div class="grow"><b>${x.type === 'st' && x.auto ? '✦ ' : ''}${esc(x.title)}</b><small>${x.type === 'st' ? `${hm(x.start)} · ${esc(x.project)}` : [x.allDay ? '' : `${hm(x.start)}–${hm(x.end)}`, x.location, x.group].filter(Boolean).map(esc).join(' · ')}</small>${x.leave ? `<em>esci alle ${x.leave}</em>` : ''}</div></div>`;
function draw() {
  if (!KEY) { $('#main').innerHTML = '<div class="empty"><b>Telefono non abbinato</b>Su Promemo apri Impostazioni → Telefono e inquadra il codice QR.</div>'; return; }
  if (!st) { $('#main').innerHTML = '<div class="empty">Carico…</div>'; return; }
  if (st.accent) document.documentElement.style.setProperty('--accent', st.accent);
  $('#hello').textContent = st.name ? `Ciao, ${st.name}` : 'Promemo';
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  let h = '';
  if (tab === 'oggi') {
    const d = st.days[0]; const now = new Date().toTimeString().slice(0, 5);
    const next = d.items.find(x => x.type === 'ev' && !x.allDay && hm(x.end) > now);
    if (next) h += `<div class="next" style="--c:${esc(next.color)}"><small>${hm(next.start) <= now ? 'In corso' : 'Prossimo'}</small><b>${esc(next.title)}</b><span>${hm(next.start)}–${hm(next.end)}${next.location ? ' · ' + esc(next.location) : ''}</span>${next.leave ? `<em>esci alle ${next.leave}</em>` : ''}</div>`;
    h += `<h3>${dayName(d.date)}</h3>${d.items.map(item).join('') || '<div class="empty">Giornata libera</div>'}`;
    if (st.late.length) h += `<h3 class="warn">In ritardo</h3>${st.late.map(x => item({ ...x, type: 'st', color: '#e0352b' })).join('')}`;
    h += `<h3>Domani</h3>${st.days[1].items.map(item).join('') || '<div class="empty">Niente in agenda</div>'}`;
  } else if (tab === 'settimana') {
    h += st.days.slice(0, 10).map(d => `<h3>${dayName(d.date)}</h3>${d.items.map(item).join('') || '<div class="empty sm">—</div>'}`).join('');
  } else {
    h += st.trips.length ? `<h3>Viaggi in arrivo</h3>${st.trips.map(t => `<div class="it"><span class="tm big">${esc(t.icon || '✈️')}</span><div class="grow"><b>${esc(t.name)}</b><small>${new Date(t.start).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}${t.end ? ' – ' + new Date(t.end).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : ''} · ${t.stops} tappe</small></div></div>`).join('')}` : '';
    h += `<h3>Progetti</h3>${st.projects.map(p => `<div class="it"><span class="tm">${p.open}</span><div class="grow"><b>${esc(p.title)}</b><small>${esc(p.next || 'Nessun passo aperto')}</small></div></div>`).join('')}`;
  }
  $('#main').innerHTML = h;
}
document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; draw(); window.scrollTo(0, 0); } });
$('#refresh').addEventListener('click', load);
$('#main').addEventListener('click', async (e) => {
  const b = e.target.closest('.ck'); if (!b) return;
  const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.closest('.it').classList.toggle('done', on);
  try { await call('/api/step', { pid: b.dataset.pid, id: b.dataset.id, done: on }); toast(on ? 'Fatto ✓' : 'Riaperto'); load(); } catch (err) { toast(err.message); b.classList.toggle('on', !on); }
});
$('#add').addEventListener('submit', async (e) => {
  e.preventDefault(); const i = $('#add-in'); const t = i.value.trim(); if (!t) return;
  i.disabled = true;
  try { const r = await call('/api/add', { text: t }); i.value = ''; toast(`Aggiunto: ${r.title}`); load(); } catch (err) { toast(err.message); }
  finally { i.disabled = false; }
});
$('#add-in').addEventListener('input', (e) => { const t = e.target.value.trim(); if (!t || !window.PromemoNLP) { $('#add-in').title = ''; return; } const r = PromemoNLP.parse(t, { projects: (st && st.projectsAll) || [] }); $('#add').dataset.hint = PromemoNLP.describe(r).map(x => x[1]).join(' · '); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
draw(); if (KEY) load();
setInterval(() => { if (!document.hidden && KEY) load(); }, 60000);
