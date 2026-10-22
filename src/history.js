/* Promemo — annulla/ripeti (Ctrl+Z, Ctrl+Shift+Z), cestino di 30 giorni, cronologia delle copie locali e diagnostica */
'use strict';

const HIST = { base: null, undo: [], redo: [], lastPush: 0, applying: false };
const TRASH_DAYS = 30;
const histTake = () => JSON.stringify({ events: data.events.filter(e => !e.tripRef), projects: data.projects, categories: data.categories });
function historyReset() { if (data) HIST.base = histTake(); }
const trashList = () => (data.trash = data.trash || []);

function beforeSave() {
  if (!data || HIST.applying) return;
  if (HIST.base == null) { HIST.base = histTake(); return; }
  const cur = histTake();
  if (cur === HIST.base) return;
  const now = Date.now();
  // le modifiche ravvicinate (es. mentre scrivi una nota) diventano un solo passo
  if (now - HIST.lastPush > 1500 || !HIST.undo.length) { HIST.undo.push(HIST.base); if (HIST.undo.length > 60) HIST.undo.shift(); }
  HIST.lastPush = now; HIST.redo = [];
  trashDiff(JSON.parse(HIST.base), JSON.parse(cur));
  HIST.base = cur;
}
function afterSave() { if (!dirty && data) HIST.base = histTake(); }

// ciò che sparisce tra due stati finisce nel cestino
function trashDiff(a, b) {
  const t = trashList(), at = iso(new Date());
  const bEv = new Set(b.events.map(e => e.id)), bPj = new Map(b.projects.map(p => [p.id, p])), bCat = new Set(b.categories.map(c => c.id));
  let n = 0, last = '';
  for (const e of a.events) if (!bEv.has(e.id) && !e.tripRef) { t.push({ id: uid(), type: 'ev', at, item: e }); n++; last = e.title; }
  for (const p of a.projects) {
    const q = bPj.get(p.id);
    if (!q) { t.push({ id: uid(), type: 'pj', at, item: p }); n++; last = p.title; continue; }
    const ids = new Set(q.steps.map(s => s.id));
    for (const s of p.steps) if (!ids.has(s.id)) { t.push({ id: uid(), type: 'st', at, pid: p.id, ptitle: p.title, item: s }); n++; last = s.text; }
  }
  for (const c of a.categories) if (!bCat.has(c.id)) { t.push({ id: uid(), type: 'cat', at, item: c }); n++; last = c.name; }
  const lim = iso(addDays(new Date(), -TRASH_DAYS));
  data.trash = t.filter(x => x.at >= lim).slice(-500);
  if (n) setTimeout(() => toastUndo(n === 1 ? `“${last}” nel cestino` : `${n} elementi nel cestino`), 60);
}

function toastUndo(msg) {
  const t = $('#toast');
  t.innerHTML = `${esc(msg)} <button class="toast-act" data-hist="undo">Annulla</button>`;
  t.classList.add('show', 'act');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show', 'act'), 5000);
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-hist]'); if (!b) return; if (b.dataset.hist === 'undo') histUndo(); $('#toast').classList.remove('show', 'act'); });

// un evento di un calendario collegato già cancellato là va ricreato come nuovo
function reviveEvent(e, current) {
  if (e.source && e.source.rid && !current.some(x => x.id === e.id)) {
    const n = { ...e, id: uid() }; const acc = (data.accounts || []).find(a => a.id === e.source.acc); const cal = acc && acc.calendars.find(c => c.id === e.source.cal);
    if (cal && cal.writable && acc.enabled) n.pushTo = { acc: e.source.acc, cal: e.source.cal };
    delete n.source; return n;
  }
  return e;
}
function histApply(snap) {
  const s = JSON.parse(snap);
  HIST.applying = true;
  try {
    const cur = data.events;
    data.events = s.events.map(e => reviveEvent(e, cur)).concat(data.events.filter(e => e.tripRef));
    data.projects = s.projects; data.categories = s.categories;
    save();
  } finally { HIST.applying = false; }
  HIST.base = histTake();
  render();
}
function histUndo() {
  if (!HIST.undo.length) { toast('Niente da annullare'); return; }
  beforeSaveFlush();
  HIST.redo.push(histTake());
  histApply(HIST.undo.pop());
  toast('Annullato · Ctrl+Shift+Z per ripetere');
}
function histRedo() {
  if (!HIST.redo.length) { toast('Niente da ripetere'); return; }
  HIST.undo.push(histTake());
  histApply(HIST.redo.pop());
  toast('Ripetuto');
}
// se c'è una modifica non ancora registrata, la registro prima di annullare
function beforeSaveFlush() { const cur = histTake(); if (HIST.base && cur !== HIST.base) { HIST.undo.push(HIST.base); HIST.base = cur; } }

document.addEventListener('keydown', (e) => {
  if (!data || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  const t = e.target;
  if (t && (t.closest('input, textarea, [contenteditable]'))) return; // dentro un campo vale l'annulla del testo
  if (!$('#lock').hidden) return;
  e.preventDefault();
  e.shiftKey ? histRedo() : histUndo();
});
const _histWait = setInterval(() => { if (data) { clearInterval(_histWait); historyReset(); } }, 300);

// ---------- cestino ----------
function trashRestore(id) {
  const t = trashList(); const x = t.find(y => y.id === id); if (!x) return;
  if (x.type === 'ev') { if (!data.events.some(e => e.id === x.item.id)) data.events.push(reviveEvent(x.item, data.events)); }
  if (x.type === 'pj') { if (!data.projects.some(p => p.id === x.item.id)) data.projects.push(x.item); }
  if (x.type === 'cat') { if (!data.categories.some(c => c.id === x.item.id)) data.categories.push(x.item); }
  if (x.type === 'st') {
    let p = proj(x.pid);
    if (!p) { const tp = t.find(y => y.type === 'pj' && y.item.id === x.pid); if (tp) { p = tp.item; data.projects.push(p); data.trash = t.filter(y => y !== tp); } }
    if (!p) { p = data.projects.find(q => q.inbox) || null; }
    if (!p) { p = { id: uid(), title: 'Da fare', category: '', description: 'Compiti ripristinati', starred: false, status: 'attivo', createdAt: iso(new Date()), updatedAt: iso(new Date()), steps: [], traces: [], inbox: true }; data.projects.push(p); }
    if (!p.steps.some(s => s.id === x.item.id)) p.steps.push(x.item);
  }
  data.trash = trashList().filter(y => y.id !== id);
  HIST.applying = true; try { save(); } finally { HIST.applying = false; }
  HIST.base = histTake(); render();
}

// ---------- impostazioni: Cestino e copie, Diagnostica ----------
let snapCache = null, logCache = null;
const TT = { ev: ['i-calendar', 'Evento'], pj: ['i-folder', 'Progetto'], st: ['i-step', 'Compito'], cat: ['i-folder', 'Raccolta'] };
SET_PANES.push(['cestino', 'i-trash', 'Cestino e copie'], ['diagnostica', 'i-note', 'Diagnostica']);
const _paneHTML_hist = paneHTML;
paneHTML = function (id, ls) {
  if (id === 'cestino') {
    const t = trashList().slice().reverse();
    const snaps = snapCache || [];
    return `<h3>Cestino</h3>
      <p class="set-note" style="margin:-4px 0 10px">Ciò che elimini resta qui ${TRASH_DAYS} giorni. Per tornare indietro subito: <b>Ctrl+Z</b> (e Ctrl+Shift+Z per ripetere).</p>
      <div class="set-group trash">${t.length ? t.slice(0, 80).map(x => `<div class="set-row"><div class="set-txt"><div>${icon(TT[x.type][0])} ${esc(x.type === 'ev' ? x.item.title : x.type === 'st' ? x.item.text : x.type === 'pj' ? x.item.title : x.item.name)}</div><small>${TT[x.type][1]}${x.type === 'st' ? ' · ' + esc(x.ptitle || '') : x.type === 'ev' && x.item.start ? ' · ' + esc(relDay(parse(x.item.start))) : ''} · eliminato ${esc(stamp(x.at).toLowerCase())}</small></div><div class="set-ctl"><button class="btn small" data-tr-res="${x.id}">Ripristina</button></div></div>`).join('') : '<div class="set-row"><div class="set-txt"><small>Il cestino è vuoto.</small></div></div>'}</div>
      ${t.length ? '<div class="row" style="justify-content:flex-end;margin-top:-4px"><button class="btn small danger" data-tr-empty>Svuota il cestino</button></div>' : ''}
      <h3 style="margin-top:22px">Copie locali</h3>
      <p class="set-note" style="margin:-4px 0 10px">Ogni giorno Promemo salva una copia dei tuoi dati su questo computer${lockInfo.configured ? ', cifrata' : ''} (ultime 14) e una prima di ogni ripristino. Gli account collegati non cambiano.</p>
      <div class="set-group">${snaps.length ? snaps.slice(0, 20).map(s => `<div class="set-row"><div class="set-txt"><div>${esc(new Date(s.at).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</div><small>${esc({ giornaliera: 'Copia del giorno', manuale: 'Copia manuale', 'prima-del-ripristino': 'Prima di un ripristino', 'prima-della-sincronizzazione': 'Prima della sincronizzazione' }[s.reason] || s.reason)} · ${Math.round(s.size / 1024)} KB</small></div><div class="set-ctl"><button class="btn small" data-sn-res="${esc(s.name)}">Ripristina</button></div></div>`).join('') : '<div class="set-row"><div class="set-txt"><small>Ancora nessuna copia: la prima arriva pochi secondi dopo l’avvio.</small></div></div>'}</div>
      <div class="row" style="justify-content:flex-end;margin-top:-4px"><button class="btn small" data-sn-now>Crea una copia adesso</button></div>`;
  }
  if (id === 'diagnostica') {
    const s = logCache || { error: 0, warn: 0, recent: [] };
    return `<h3>Diagnostica</h3>
      <p class="set-note" style="margin:-4px 0 10px">Promemo annota in un registro gli errori e i malfunzionamenti (sincronizzazioni non riuscite, servizi irraggiungibili, errori dell'interfaccia). Token e password non vengono mai scritti.</p>
      <div class="diag-kpis"><div class="${s.error ? 'bad' : ''}"><b>${s.error}</b><span>errori in questa sessione</span></div><div class="${s.warn ? 'warn' : ''}"><b>${s.warn}</b><span>avvisi</span></div></div>
      <div class="set-group diag-list">${s.recent.length ? s.recent.slice(0, 40).map(r => `<div class="diag-row ${r.level}"><span class="diag-t">${esc(new Date(r.at).toLocaleTimeString('it-IT'))}</span><span class="diag-s">${esc(r.src)}</span><span class="diag-m">${esc(r.msg)}</span></div>`).join('') : '<div class="set-row"><div class="set-txt"><small>Nessun problema registrato in questa sessione. 👍</small></div></div>'}</div>
      <div class="row" style="gap:6px;justify-content:flex-end"><button class="btn small" data-dg="open">Apri la cartella del registro</button><button class="btn small" data-dg="view">Mostra il registro</button><button class="btn small" data-dg="clear">Svuota</button><button class="btn-primary small" data-dg="export">Esporta diagnostica…</button></div>
      <pre class="diag-log" id="diag-log" hidden></pre>
      <p class="set-note">“Esporta diagnostica” crea un file di testo con versioni, stato degli account (senza credenziali) e la parte recente del registro, utile per capire un problema.</p>`;
  }
  return _paneHTML_hist(id, ls);
};
const _drawPane_hist = drawPane;
drawPane = function (m) {
  _drawPane_hist(m);
  const box = m.querySelector('#set-pane');
  if (setPane === 'cestino') {
    if (!snapCache) api.snapList().then(l => { snapCache = l; if (setPane === 'cestino') drawPane(m); });
    box.querySelectorAll('[data-tr-res]').forEach(b => b.addEventListener('click', () => { trashRestore(b.dataset.trRes); toast('Ripristinato'); drawPane(m); }));
    box.querySelector('[data-tr-empty]')?.addEventListener('click', (e) => { const b = e.currentTarget; if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = 'Premi di nuovo per svuotare'; return; } data.trash = []; save(); drawPane(m); toast('Cestino svuotato'); });
    box.querySelector('[data-sn-now]')?.addEventListener('click', async () => { await flushSave(); const r = await api.snapNow(); toast(r.ok ? 'Copia salvata' : r.error); snapCache = await api.snapList(); drawPane(m); });
    box.querySelectorAll('[data-sn-res]').forEach(b => b.addEventListener('click', async () => {
      if (!b.classList.contains('confirm')) { const p = await api.snapPeek(b.dataset.snRes); b.classList.add('confirm'); b.textContent = p.ok ? `Ripristina (${p.value.events} eventi, ${p.value.steps} compiti)?` : 'Conferma'; return; }
      await flushSave(); const r = await api.snapRestore(b.dataset.snRes);
      if (!r.ok) return toast(r.error);
      const d = await api.getData(); if (d) { data = d; historyReset(); }
      snapCache = null; closeModal(); render(); toast('Dati ripristinati (la versione precedente è salvata tra le copie)');
    }));
  }
  if (setPane === 'diagnostica') {
    if (!logCache) api.logStats().then(s => { logCache = s; if (setPane === 'diagnostica') drawPane(m); });
    box.querySelectorAll('[data-dg]').forEach(b => b.addEventListener('click', async () => {
      const k = b.dataset.dg;
      if (k === 'open') api.logOpen();
      if (k === 'export') { const r = await api.logExport(); if (r) toast('Diagnostica salvata in ' + r.split('/').pop()); }
      if (k === 'clear') { await api.logClear(); logCache = await api.logStats(); drawPane(m); }
      if (k === 'view') { const pre = box.querySelector('#diag-log'); pre.hidden = !pre.hidden; if (!pre.hidden) { pre.textContent = (await api.logRead()).split('\n').slice(-300).join('\n') || '(vuoto)'; pre.scrollTop = pre.scrollHeight; } }
    }));
  }
};
const _modalSettings_hist = modalSettings;
modalSettings = async function (pane) { snapCache = null; logCache = null; return _modalSettings_hist(pane); };
PALETTE_EXTRA.push(
  { t: 'Annulla l’ultima modifica', i: 'i-refresh', k: 'undo ctrl z', run: () => histUndo() },
  { t: 'Cestino', i: 'i-trash', k: 'eliminati ripristina', run: () => modalSettings('cestino') },
  { t: 'Diagnostica e registro errori', i: 'i-note', k: 'log errori problemi', run: () => modalSettings('diagnostica') },
);
