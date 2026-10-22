/* Promemo — interfaccia */
'use strict';

const api = window.promemo;
let data = null;
// sezioni aggiunte da altri file (viaggi, database Notion)
const EXTRA_NAV = [];   // [view, icona, etichetta, extra()]
const EXTRA_VIEWS = {}; // view → { title, render(), full?, after?() }
const PALETTE_EXTRA = []; // comandi aggiunti da altri file
const PALETTE_TOP = [];   // (testo) → voci in cima (es. crea da frase)
const ui = {
  view: 'home',
  projectId: null,
  projFilter: 'attivi',
  catFilter: null,
  month: null,          // Date del primo giorno del mese mostrato
  sel: null,            // 'YYYY-MM-DD' selezionato in agenda
  chips: { appuntamento: true, evento: true, passo: true },
  search: '',
};

// ---------- Utilità ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => s ? new Date(s.length === 10 ? s + 'T00:00' : s) : null;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => dayKey(a) === dayKey(b);
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const fmtHM = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDM = (d) => `${d.getDate()} ${MESI[d.getMonth()]}`.toUpperCase();
const fmtLong = (d) => d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtMonth = (d) => d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
const icon = (id, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24"><use href="#${id}"/></svg>`;

function relDay(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (diff === 0) return 'Oggi';
  if (diff === 1) return 'Domani';
  if (diff === -1) return 'Ieri';
  if (diff > 1 && diff < 7) return d.toLocaleDateString('it-IT', { weekday: 'long' }).replace(/^./, c => c.toUpperCase());
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
const stamp = (s) => { const d = parse(s); return `${relDay(d).toUpperCase()} · ${fmtHM(d)}`; };

const REMINDERS = [
  [null, 'Nessuno'], [0, "All'orario"], [5, '5 minuti prima'], [15, '15 minuti prima'],
  [30, '30 minuti prima'], [60, '1 ora prima'], [120, '2 ore prima'], [1440, '1 giorno prima'],
];
const COLORS = ['orange', 'green', 'blue', 'purple', 'pink', 'teal', 'yellow', 'gray'];
const CAT_ICONS = ['plane', 'home', 'book', 'briefcase', 'heart', 'dumbbell', 'money', 'cap', 'folder'];

const cat = (id) => data.categories.find(c => c.id === id);
const PROV = { google: 'Google Calendar', notion: 'Notion', ics: 'Calendario web', calendly: 'Calendly' };
const provLetter = (p) => ({ google: 'G', notion: 'N', calendly: 'C' })[p] || icon('i-calendar');
const accOf = (e) => { const t = e.source || e.pushTo; return t ? (data.accounts || []).find(a => a.id === t.acc) : null; };
const calOf = (e) => { const t = e.source || e.pushTo; const a = accOf(e); return a ? a.calendars.find(c => c.id === t.cal) : null; };
const isReadOnly = (e) => { if (e.tripRef) return true; const c = calOf(e); return !!(e.source && c && !c.writable); };
function srcPill(e) {
  const a = accOf(e); if (!a) return '';
  const c = calOf(e);
  const label = a.provider === 'ics' ? esc(a.name) : PROV[a.provider].replace(' Calendar', '');
  const pending = e.pushTo || (e.source && !e.source.rid);
  const g = groupInfo(e);
  return `<span class="pill src" title="${esc(a.name)}${c ? ' · ' + esc(c.name) : ''}"><i style="background:${esc(g.color)}"></i>${pending ? 'Invio a ' + label : esc(g.name || label)}</span>`;
}
const proj = (id) => data.projects.find(p => p.id === id);
const NAMED = { orange: '#e5562a', green: '#2f9e5b', blue: '#2f7ae5', purple: '#8e5bd9', pink: '#d9467a', teal: '#1f9aa5', yellow: '#c9930a', gray: '#8e8e93' };
const hex = (c) => NAMED[c] || c || '#8e8e93';
const catTag = (c) => c ? `<span class="cat-tag" style="color:${hex(c.color)}">${icon('c-' + c.icon)}${esc(c.name)}</span>` : '';
// tavolozza a sfumature: una famiglia di colori per ogni ambito
const SHADES = [
  ['Rossi', ['#ff8787', '#e5484d', '#c92a2a', '#8f1d22']],
  ['Arancio', ['#ffb366', '#f08a24', '#d9480f', '#a3410d']],
  ['Gialli', ['#ffd43b', '#e8b10b', '#b88a00', '#8a6700']],
  ['Verdi', ['#8ce99a', '#40c057', '#2b8a3e', '#1b5e2a']],
  ['Turchesi', ['#66d9e8', '#22b8cf', '#1098ad', '#0b7285']],
  ['Azzurri', ['#a5d8ff', '#5ac8fa', '#0a84ff', '#1c5fd4', '#173f8a']],
  ['Viola', ['#d0bfff', '#9775fa', '#7048e8', '#4c2b9e']],
  ['Rosa', ['#faa2c1', '#f06595', '#d6336c', '#a61e4d']],
  ['Neutri', ['#ced4da', '#8e8e93', '#5c636a', '#343a40']],
];
const hiddenLocal = () => data.settings.hiddenLocal || [];
function localGroup(p) {
  const c = p && cat(p.category);
  if (c) return { key: 'local::' + c.id, color: hex(c.color), name: c.name, visible: !hiddenLocal().includes(c.id) };
  return { key: 'local::', color: data.settings.localColor || '#e5562a', name: 'Personale', visible: !hiddenLocal().includes('') };
}
function groupInfo(e) {
  if (e.source && DAYIDX) { const ck = `${e.source.acc}|${e.source.group}|${e.source.cal}`; let v = DAYIDX.g.get(ck); if (!v) { v = groupInfoRaw(e); DAYIDX.g.set(ck, v); } return v; }
  return groupInfoRaw(e);
}
function groupInfoRaw(e) {
  if (e.source) {
    const a = (data.accounts || []).find(x => x.id === e.source.acc);
    const g = a && (a.groups || []).find(x => x.id === e.source.group);
    if (g) return { key: `${a.id}::${g.id}`, color: g.color, name: g.name, visible: g.visible !== false && a.enabled, acc: a };
    const c = a && a.calendars.find(x => x.id === e.source.cal);
    return { key: `${e.source.acc}::?`, color: c?.color || '#8e8e93', name: c?.name || '', visible: !a || a.enabled, acc: a };
  }
  if (e.planDay && !e.projectId && typeof TIPI !== 'undefined' && TIPI[e.planType]) {
    const lg = localGroup(null);
    return { key: lg.key, color: TIPI[e.planType][1], name: 'Piano · ' + TIPI[e.planType][0], visible: lg.visible };
  }
  return localGroup(proj(e.projectId));
}

function nextStep(p) {
  const open = p.steps.filter(s => !s.done);
  open.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  return open[0] || null;
}

// ---------- Persistenza ----------
let saveTimer = null, dirty = false;
function save() {
  if (typeof beforeSave === 'function') beforeSave();
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    dirty = false;
    const r = await api.setData(data);
    if (!dirty && r && r.rev) Object.assign(data, r); // rev, account ed eventi riconciliati dal processo principale
    if (typeof afterSave === 'function') afterSave();
  }, 150);
}
function touch(p) { p.updatedAt = iso(new Date()); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('act'); t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Elementi del calendario ----------
// Restituisce gli elementi (appuntamenti, eventi, passi con scadenza) che cadono nel giorno d
// indice per giorno, costruito una volta per ogni ridisegno: con migliaia di eventi le viste restano veloci
let DAYIDX = null;
function buildDayIdx() {
  const m = new Map(), rec = [], st = new Map();
  const push = (map, k, v) => { let a = map.get(k); if (!a) map.set(k, a = []); a.push(v); };
  for (const e of data.events) {
    if (e.rrule) { rec.push(e); continue; }
    const s = parse(e.start); if (!s) continue;
    const en = parse(e.end || e.start);
    let d = startOfDay(s); const last = startOfDay(en);
    for (let n = 0; d <= last && n < 400; n++, d = addDays(d, 1)) push(m, dayKey(d), e);
  }
  for (const p of data.projects) { if (p.status === 'archiviato') continue; for (const x of p.steps) if (x.due) push(st, x.due.slice(0, 10), [p, x]); }
  return { m, rec, st, g: new Map() };
}
function itemsOn(d, filter = { appuntamento: true, evento: true, passo: true }) {
  const k = dayKey(d);
  const out = [];
  const src = DAYIDX ? (DAYIDX.m.get(k) || []).concat(DAYIDX.rec) : data.events;
  for (const e of src) {
    if (!filter[e.kind]) continue;
    if (!groupInfo(e).visible) continue;
    if (e.rrule) { if (!PromemoRecur.occursOn(e.rrule, e.start, d)) continue; const inst = PromemoRecur.instance(e, d); out.push({ type: e.kind, ev: inst, sort: e.allDay ? '0' : inst.start }); continue; }
    const s = dayKey(parse(e.start));
    const en = dayKey(parse(e.end || e.start));
    if (s <= k && k <= en) out.push({ type: e.kind, ev: e, sort: e.allDay ? '0' : e.start });
  }
  if (filter.passo) {
    if (DAYIDX) { for (const [p, st] of DAYIDX.st.get(k) || []) if (localGroup(p).visible) out.push({ type: 'passo', step: st, project: p, sort: st.due }); }
    else for (const p of data.projects) {
      if (p.status === 'archiviato' || !localGroup(p).visible) continue;
      for (const st of p.steps) {
        if (st.due && dayKey(parse(st.due)) === k) out.push({ type: 'passo', step: st, project: p, sort: st.due });
      }
    }
  }
  out.sort((a, b) => a.sort.localeCompare(b.sort));
  return out;
}

function spanDays(e) {
  const a = startOfDay(parse(e.start)), b = startOfDay(parse(e.end || e.start));
  return Math.round((b - a) / 86400000) + 1;
}

function eventCard(e, opts = {}) {
  const s = parse(e.start), en = parse(e.end || e.start);
  const now = new Date();
  const live = s <= now && now <= en;
  const days = spanDays(e);
  const p = proj(e.projectId);
  const c = p && cat(p.category);
  const kindLabel = e.kind === 'evento' ? 'Evento' : 'Appuntamento';
  const timeCol = e.allDay
    ? `<div>${fmtDM(s)}</div><div>Tutto il giorno</div>${days > 1 ? `<div class="end">${fmtDM(en)}</div>` : ''}`
    : `<div>${fmtDM(s)}</div><div>${fmtHM(s)}</div><div class="end">${days > 1 ? fmtDM(en) + '<br>' : ''}${fmtHM(en)}</div>`;
  return `
  <div class="card clickable accent-left ev kind-${e.kind} tinted ${opts.sheet && ui.sheet && ui.sheet.id === e.id ? 'sheet-on' : ''}" style="--gc:${esc(groupInfo(e).color)}" ${opts.sheet ? `data-action="sheet" data-kind="ev" data-id="${e.id}"` : `data-action="edit-event" data-id="${e.id}"`}>
    <div class="ev-time">${timeCol}</div>
    <div style="min-width:0">
      <div class="ev-kind">
        ${live ? `<span class="pill live">In corso</span>` : `<span class="ev-kind-label">${kindLabel}</span>`}
        ${days > 1 ? `<span class="pill">${icon('i-calendar')} ${days} giorni</span>` : ''}
        ${e.reminder !== null && e.reminder !== undefined ? `<span class="pill">${icon('i-bell')} ${remShort(e.reminder)}</span>` : ''}
        ${srcPill(e)}
      </div>
      <div class="card-title">${esc(e.title)}</div>
      <div class="ev-lines">
        ${p ? `<div class="card-sub">${icon('i-folder')} ${esc(p.title)}</div>` : ''}
        ${c && opts.showCat ? `<div class="card-sub">${catTag(c)}</div>` : ''}
        ${e.location ? `<div class="card-sub">${icon('i-pin')} ${esc(e.location)}</div>` : ''}
      </div>
    </div>
    ${icon('i-chev-r', 'chev')}
  </div>`;
}
const remShort = (m) => m === 0 ? "all'ora" : m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : `${m / 1440} g`;

function stepCard(st, p, sheet) {
  const d = parse(st.due);
  const late = !st.done && d < new Date();
  return `
  <div class="card clickable accent-left ev kind-passo tinted ${sheet && ui.sheet && ui.sheet.id === st.id ? 'sheet-on' : ''}" style="--gc:${esc(localGroup(p).color)}" ${sheet ? `data-action="sheet" data-kind="st" data-pid="${p.id}" data-id="${st.id}"` : `data-action="open-project" data-id="${p.id}"`}>
    <div class="ev-time"><div>${fmtDM(d)}</div><div>${fmtHM(d)}</div></div>
    <div style="min-width:0">
      <div class="ev-kind"><span class="ev-kind-label">Passo</span>${st.done ? '<span class="pill ok">Fatto</span>' : late ? '<span class="pill live">In ritardo</span>' : ''}</div>
      <div class="card-title">${esc(st.text)}</div>
      <div class="card-sub">${icon('i-folder')} ${esc(p.title)}</div>
    </div>
    ${icon('i-chev-r', 'chev')}
  </div>`;
}

function projectCard(p, opts = {}) {
  const c = cat(p.category);
  const ns = nextStep(p);
  const hasEv = data.events.some(e => e.projectId === p.id && parse(e.end || e.start) >= new Date());
  const hasRem = p.steps.some(s => !s.done && s.reminder !== null && s.reminder !== undefined && s.due);
  return `
  <div class="card clickable accent-left proj-item ${opts.selected ? 'selected' : ''}" data-action="open-project" data-id="${p.id}">
    <div class="row">
      <div class="tiny grow">${stamp(p.updatedAt)}</div>
      <div class="flags">
        ${hasEv ? icon('i-calendar') : ''}${hasRem ? icon('i-bell') : ''}${p.starred ? icon('i-star', 'star') : ''}
      </div>
    </div>
    <div class="card-title">${esc(p.title)}</div>
    ${c ? `<div style="margin:1px 0 3px">${catTag(c)}</div>` : ''}
    <div class="row">
      <div class="card-sub grow">${ns ? `${icon('i-step')} ${esc(ns.text)}` : `<span style="color:var(--text-3)">Nessun passo aperto</span>`}</div>
      ${icon('i-chev-r', 'chev')}
    </div>
  </div>`;
}

// ---------- Sidebar ----------
function remindersList() {
  const out = [];
  const now = new Date();
  for (const e0 of data.events) {
    if (e0.reminder === null || e0.reminder === undefined) continue;
    const e = e0.rrule ? PromemoRecur.between(e0, now, addDays(now, 60))[0] : e0;
    if (!e) continue;
    if (parse(e.end || e.start) < startOfDay(now) || !groupInfo(e).visible) continue;
    out.push({ kind: 'ev', when: parse(e.start), title: e.title, sub: proj(e.projectId)?.title, ev: e });
  }
  for (const p of data.projects) {
    if (p.status === 'archiviato') continue;
    for (const s of p.steps) {
      if (s.done || !s.due) continue;
      if (s.reminder === null || s.reminder === undefined) { if (parse(s.due) >= now) continue; }
      out.push({ kind: 'st', when: parse(s.due), title: s.text, sub: p.title, step: s, project: p });
    }
  }
  out.sort((a, b) => a.when - b.when);
  return out;
}

let collapsed = {};
try { collapsed = JSON.parse(localStorage.getItem('promemo.collapsed') || '{}'); } catch { collapsed = {}; }
function calRow({ type, acc, gid, color, name, visible, count }) {
  return `<div class="cal-row ${visible ? '' : 'off'}">
    <button class="cal-check" style="--c:${esc(color)}" data-action="grp-toggle" data-type="${type}" data-acc="${esc(acc || '')}" data-gid="${esc(gid)}" title="${visible ? 'Nascondi' : 'Mostra'}">${icon('i-check')}</button>
    <span class="cal-name">${esc(name)}</span>
    ${count ? `<span class="count">${count}</span>` : ''}
    <button class="cal-color" data-action="grp-color" data-type="${type}" data-acc="${esc(acc || '')}" data-gid="${esc(gid)}" title="Cambia colore">${icon('i-palette')}</button>
  </div>`;
}
function renderSideCals() {
  const now = new Date();
  const upcoming = (pred) => data.events.filter(e => pred(e) && parse(e.end || e.start) >= startOfDay(now)).length;
  const block = (key, head, rows, extra = '') => `
    <div class="cal-acc ${collapsed[key] ? 'collapsed' : ''}">
      <button class="cal-acc-head" data-action="acc-collapse" data-key="${esc(key)}">${icon('i-chev-r', 'cal-chev')}${head}</button>
      <div class="cal-groups">${rows}${extra}</div>
    </div>`;
  let html = '';
  // Promemo, su questo computer
  const lg = localGroup(null);
  let rows = calRow({ type: 'local', gid: '', color: lg.color, name: 'Personale', visible: lg.visible, count: upcoming(e => !e.source && !proj(e.projectId)?.category) });
  for (const c of data.categories) {
    const g = localGroup({ category: c.id });
    rows += calRow({ type: 'local', gid: c.id, color: g.color, name: c.name, visible: g.visible, count: upcoming(e => !e.source && proj(e.projectId)?.category === c.id) });
  }
  html += block('local', `<img src="../build/icon.png" class="cal-acc-icon" alt=""><span class="cal-acc-name">Su questo computer</span>`, rows);
  for (const a of data.accounts || []) {
    const groups = (a.groups || []).filter(g => a.provider === 'google' ? a.calendars.some(c => c.id === g.id && c.enabled) : (a.provider !== 'notion' || g.id !== '' || data.events.some(e => e.source && e.source.acc === a.id && e.source.group === '')));
    const r = groups.map(g => calRow({ type: 'acc', acc: a.id, gid: g.id, color: g.color, name: g.name || a.name, visible: g.visible !== false, count: upcoming(e => e.source && e.source.acc === a.id && e.source.group === g.id) })).join('');
    const hint = a.provider === 'notion' && !(a.config && a.config.colorProp)
      ? `<button class="cal-hint" data-action="notion-color" data-id="${a.id}">${icon('i-palette')} Colora per colonna (es. Area)…</button>` : '';
    html += block(a.id, `<span class="prov mini prov-${a.provider}">${provLetter(a.provider)}</span><span class="cal-acc-name">${esc(a.name)}</span>${a.error ? '<span class="cal-err" title="' + esc(a.error) + '"></span>' : ''}${a.enabled ? '' : '<span class="tiny">pausa</span>'}`, r || '<div class="cal-empty">Nessun evento</div>', hint);
  }
  $('#side-cals').innerHTML = html;
}

function showColorPicker(anchor, current, onPick) {
  const layer = $('#popover-layer');
  const r = anchor.getBoundingClientRect();
  layer.innerHTML = `<div class="menu color-pop">
    ${SHADES.map(([name, cs]) => `<div class="shade-row"><span class="tiny">${name}</span><div class="shade-sw">${cs.map(c => `<button style="background:${c}" class="${c.toLowerCase() === String(current).toLowerCase() ? 'on' : ''}" data-c="${c}" title="${c}"></button>`).join('')}</div></div>`).join('')}
    <label class="shade-row custom"><span class="tiny">Personalizzato</span><input type="color" value="${esc(current && current.startsWith('#') && current.length === 7 ? current : '#0a84ff')}"></label>
  </div>`;
  const m = layer.firstChild;
  m.style.top = Math.min(r.top - 10, window.innerHeight - m.offsetHeight - 12) + 'px';
  m.style.left = (r.right + 10) + 'px';
  const close = () => { layer.innerHTML = ''; document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!m.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; close(); onPick(b.dataset.c); });
  m.querySelector('input[type=color]').addEventListener('change', (e) => { close(); onPick(e.target.value); });
}

function currentGroupColor(el) {
  const { type, acc, gid } = el.dataset;
  if (type === 'local') return gid ? hex(cat(gid)?.color) : (data.settings.localColor || '#e5562a');
  const a = data.accounts.find(x => x.id === acc);
  return (a.groups || []).find(g => g.id === gid)?.color;
}
async function setGroup(el, patch) {
  const { type, acc, gid } = el.dataset;
  if (type === 'local') {
    if ('color' in patch) { if (gid) cat(gid).color = patch.color; else data.settings.localColor = patch.color; }
    if ('visible' in patch) {
      const h = new Set(hiddenLocal());
      patch.visible ? h.delete(gid) : h.add(gid);
      data.settings.hiddenLocal = [...h];
    }
    save(); render(); return;
  }
  const a = data.accounts.find(x => x.id === acc);
  const g = (a.groups || []).find(x => x.id === gid);
  Object.assign(g, patch); render(); // aggiornamento immediato, poi conferma dal processo principale
  await api.updateAccount({ id: acc, patch: { groups: [{ id: gid, ...patch }] } });
}

function modalNotionColor(accId) {
  const a = data.accounts.find(x => x.id === accId);
  openModal(`<h2>${provIcon(a)} Colori per “${esc(a.name)}”</h2>
    <p class="muted" style="margin-top:-6px">Scegli una colonna <b>Seleziona</b>, <b>Selezione multipla</b> o <b>Stato</b> del database: ogni valore diventa un gruppo con il suo colore (es. Personale in rosso, Lavoro in azzurro, Università in blu scuro). I colori di partenza sono quelli di Notion: li puoi cambiare dalla barra laterale.</p>
    <div class="form"><div class="field"><span>Colonna</span><select id="ncol" disabled><option>Carico le colonne…</option></select></div><div id="nprev" class="nprev"></div>
    <div class="form-err" hidden></div></div>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Annulla</button><button class="btn-primary" id="nsave" disabled>Applica</button></div>`, async (m) => {
      const r = await api.notionProps(accId);
      const sel = m.querySelector('#ncol');
      if (!r.ok) { const e = m.querySelector('.form-err'); e.textContent = r.error; e.hidden = false; return; }
      const props = r.value.props.filter(p => ['select', 'multi_select', 'status'].includes(p.type));
      const NC = { default: '#8e8e93', gray: '#8e8e93', brown: '#a0785a', orange: '#f08a24', yellow: '#d9a50b', green: '#34a853', blue: '#0a84ff', purple: '#8e5bd9', pink: '#e0569b', red: '#e5484d' };
      sel.innerHTML = `<option value="">Nessuna (un solo colore)</option>` + props.map(p => `<option value="${esc(p.name)}" ${a.config.colorProp === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
      sel.disabled = false; m.querySelector('#nsave').disabled = false;
      const prev = () => { const p = props.find(x => x.name === sel.value); m.querySelector('#nprev').innerHTML = p ? p.options.map(o => `<span class="pill"><i style="width:8px;height:8px;border-radius:4px;background:${NC[o.color] || '#8e8e93'}"></i>${esc(o.name)}</span>`).join('') : ''; };
      sel.addEventListener('change', prev); prev();
      m.querySelector('#nsave').addEventListener('click', async () => {
        const b = m.querySelector('#nsave'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Applico…';
        const res = await api.notionColor({ id: accId, prop: sel.value });
        if (!res.ok) { const e = m.querySelector('.form-err'); e.textContent = res.error; e.hidden = false; b.disabled = false; b.textContent = 'Applica'; return; }
        closeModal(); toast('Colori aggiornati');
      });
    });
}

function renderSidebar() {
  renderSideCals();
  renderMiniMonth();
  const active = data.projects.filter(p => p.status !== 'archiviato').length;
  const todayCount = itemsOn(new Date()).length;
  const late = remindersList().filter(r => r.when < new Date() && r.kind === 'st').length;
  const items = [
    ['home', 'i-home', 'Home', todayCount ? `<span class="count">${todayCount}</span>` : ''],
    ['progetti', 'i-folder', 'Progetti', `<span class="count">${active}</span>`],
    ['agenda', 'i-calendar', 'Agenda', ''],
    ['promemoria', 'i-bell', 'Promemoria', late ? `<span class="badge">${late}</span>` : ''],
    ...EXTRA_NAV.map(([v, ic, l, ex]) => [v, ic, l, ex ? ex() : '']),
    ['account', 'i-sync', 'Account collegati', (data.accounts || []).some(a => a.error) ? `<span class="badge warn">!</span>` : (data.accounts || []).length ? `<span class="count">${data.accounts.length}</span>` : ''],
  ];
  $('#nav').innerHTML = items.map(([v, ic, label, extra]) =>
    `<button class="nav-item ${ui.view === v && !ui.search ? 'active' : ''}" data-action="nav" data-view="${v}" title="${label}">${icon(ic)}<span class="nav-lbl">${label}</span>${extra}</button>`).join('');

  $('#side-cats').innerHTML = data.categories.map(c => {
    const n = data.projects.filter(p => p.category === c.id && p.status !== 'archiviato').length;
    return `<button class="cat-item" data-action="cat" data-id="${c.id}" style="${ui.view === 'progetti' && ui.catFilter === c.id ? 'background:var(--fill)' : ''}">
      <span class="cat-dot" style="background:${hex(c.color)}">${icon('c-' + c.icon)}</span>${esc(c.name)}<span class="count">${n || ''}</span></button>`;
  }).join('') + `<button class="cat-item" data-action="new-cat" style="color:var(--text-2)"><span class="cat-dot" style="background:var(--fill-2);color:var(--text-2)">${icon('i-plus')}</span>Nuova raccolta</button>`;
}

// ---------- Viste ----------
function countdown(d) {
  const ms = d - new Date();
  if (ms < 0) return 'adesso';
  const min = Math.round(ms / 60000);
  if (min < 60) return `tra ${min} min`;
  if (min < 60 * 6) return `tra ${Math.floor(min / 60)} h ${min % 60 ? (min % 60) + ' min' : ''}`.trim();
  return `${relDay(d).toLowerCase()} alle ${fmtHM(d)}`;
}
const itemStart = (it) => parse(it.ev ? it.ev.start : it.step.due);
const itemEnd = (it) => it.ev ? parse(it.ev.end || it.ev.start) : parse(it.step.due);
const itemColor = (it) => it.ev ? groupInfo(it.ev).color : localGroup(it.project).color;
const itemTitle = (it) => it.ev ? it.ev.title : it.step.text;
const itemAction = (it) => it.ev ? `data-action="edit-event" data-id="${it.ev.id}"` : `data-action="open-project" data-id="${it.project.id}"`;

function timelineRow(it, now) {
  const s = itemStart(it), e = itemEnd(it);
  const past = e < now && !(it.step && !it.step.done);
  const live = it.ev && s <= now && now <= e;
  const sub = it.ev
    ? [it.ev.location ? `${icon('i-pin')} ${esc(it.ev.location)}` : '', proj(it.ev.projectId) ? `${icon('i-folder')} ${esc(proj(it.ev.projectId).title)}` : ''].filter(Boolean).join('<span class="sep"></span>')
    : `${icon('i-folder')} ${esc(it.project.title)}`;
  const g = it.ev ? groupInfo(it.ev) : localGroup(it.project);
  return `<div class="tl-row ${past ? 'past' : ''} ${live ? 'live' : ''}" style="--gc:${esc(g.color)}" ${itemAction(it)}>
    <div class="tl-time"><b>${fmtHM(s)}</b>${it.ev && !it.ev.allDay ? `<span>${fmtHM(e)}</span>` : ''}</div>
    <div class="tl-dot">${it.step ? `<button class="check mini ${it.step.done ? 'on' : ''}" data-action="complete-step" data-pid="${it.project.id}" data-id="${it.step.id}" title="Segna come fatto">${icon('i-check')}</button>` : '<i></i>'}</div>
    <div class="tl-body">
      <div class="tl-title">${esc(itemTitle(it))}${live ? '<span class="pill live">In corso</span>' : ''}${it.step && !it.step.done && s < now ? '<span class="pill live">In ritardo</span>' : ''}</div>
      <div class="tl-sub"><span class="tl-grp"><i></i>${esc(g.name)}</span>${sub ? '<span class="sep"></span>' + sub : ''}${it.ev && typeof travelBadge === 'function' ? travelBadge(it.ev) : ''}</div>
    </div>
  </div>`;
}

function viewHome() {
  const now = new Date();
  const h = now.getHours();
  const greet = h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const name = (data.settings.userName || '').trim();
  const today = itemsOn(now);
  const allDay = today.filter(it => it.ev && (it.ev.allDay || spanDays(it.ev) > 1));
  const timed = today.filter(it => !allDay.includes(it)).sort((a, b) => itemStart(a) - itemStart(b));
  // linea "adesso"
  let rows = '', placed = false;
  for (const it of timed) {
    if (!placed && itemStart(it) > now) { rows += `<div class="now-line"><span>Adesso · ${fmtHM(now)}</span></div>`; placed = true; }
    rows += timelineRow(it, now);
  }
  if (!placed && timed.length) rows += `<div class="now-line"><span>Adesso · ${fmtHM(now)}</span></div>`;

  // prossimo impegno e settimana
  const next = [];
  for (let i = 0; i < 8 && !next.length; i++) for (const it of itemsOn(addDays(now, i))) {
    const st = itemStart(it);
    if (st > now && !(it.ev && it.ev.allDay) && !(it.step && it.step.done)) { next.push(it); break; }
  }
  const nx = next[0];
  const overdue = remindersList().filter(r => r.kind === 'st' && r.when < now);
  const wkStart = addDays(startOfDay(now), -((now.getDay() + 6) % 7));
  const week = [...Array(7)].map((_, i) => { const d = addDays(wkStart, i); return { d, its: itemsOn(d) }; });
  const weekTotal = week.reduce((n, w) => n + w.its.length, 0);
  const maxDay = Math.max(1, ...week.map(w => w.its.length));
  const resume = data.projects.filter(p => p.status === 'attivo').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const upcoming = [];
  for (let i = 1; i <= 7 && upcoming.length < 5; i++) {
    for (const it of itemsOn(addDays(now, i))) {
      if (it.ev && spanDays(it.ev) > 1 && dayKey(parse(it.ev.start)) !== dayKey(addDays(now, i))) continue;
      if (!upcoming.find(u => u.ev && it.ev && u.ev.id === it.ev.id)) upcoming.push(it);
      if (upcoming.length >= 5) break;
    }
  }

  return `
  <section class="hero">
    ${typeof wxHeroHTML === 'function' ? wxHeroHTML() : ''}
    <div>
      <div class="eyebrow">${fmtLong(now)}</div>
      <h1 class="display">${greet}${name ? ', ' + esc(name) : ''}.</h1>
      <div class="subtitle">${today.length ? `Oggi hai <b>${today.length}</b> ${today.length === 1 ? 'impegno' : 'impegni'}${overdue.length ? `, e ${overdue.length} ${overdue.length === 1 ? 'passo' : 'passi'} in ritardo` : ''}.` : 'Nessun impegno oggi: giornata libera.'}</div>
    </div>
  </section>

  <section class="bento">
    <div class="tile tile-next ${nx ? 'clickable' : ''}" ${nx ? itemAction(nx) : ''} style="--gc:${nx ? esc(itemColor(nx)) : 'var(--accent)'}">
      <div class="tile-label">${icon('i-clock')} Prossimo</div>
      ${nx ? `<div class="tile-big">${countdown(itemStart(nx))}</div><div class="tile-title">${esc(itemTitle(nx))}</div><div class="tile-sub">${fmtHM(itemStart(nx))}${nx.ev && nx.ev.location ? ' · ' + esc(nx.ev.location) : ''}</div>`
           : `<div class="tile-big">—</div><div class="tile-sub">Niente in arrivo nei prossimi giorni</div>`}
    </div>
    <div class="tile clickable" data-action="goto-agenda" data-date="${dayKey(now)}">
      <div class="tile-label">${icon('i-calendar')} Oggi</div>
      <div class="tile-big">${today.length}</div><div class="tile-sub">${allDay.length ? allDay.length + ' tutto il giorno · ' : ''}${timed.filter(t => itemEnd(t) >= now).length} ancora da fare</div>
    </div>
    <div class="tile clickable ${overdue.length ? 'warn' : ''}" data-action="nav" data-view="promemoria">
      <div class="tile-label">${icon('i-bell')} In ritardo</div>
      <div class="tile-big">${overdue.length}</div><div class="tile-sub">${overdue.length ? esc(overdue[0].title) : 'Tutto in pari'}</div>
    </div>
    <div class="tile tile-week">
      <div class="tile-label">${icon('i-calendar')} Questa settimana · ${weekTotal}</div>
      <div class="week">
        ${week.map(w => `<button class="wk ${sameDay(w.d, now) ? 'today' : ''} ${w.d < startOfDay(now) ? 'past' : ''}" data-action="goto-agenda" data-date="${dayKey(w.d)}" title="${w.its.length} elementi">
          <span class="wk-bar"><i style="height:${Math.round(w.its.length / maxDay * 100)}%"></i></span>
          <span class="wk-d">${'LMMGVSD'[(w.d.getDay() + 6) % 7]}</span><span class="wk-n">${w.d.getDate()}</span>
          <span class="wk-dots">${[...new Set(w.its.map(itemColor))].slice(0, 3).map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span>
        </button>`).join('')}
      </div>
    </div>
  </section>

  ${typeof aiHomeCard === 'function' ? aiHomeCard() : ''}
  <div class="home-grid">
    <section class="panel">
      <div class="panel-head"><h2>Oggi</h2><button class="link" data-action="goto-agenda" data-date="${dayKey(now)}">Apri agenda</button></div>
      ${allDay.length ? `<div class="allday">${allDay.map(it => `<button class="allday-chip" style="--gc:${esc(itemColor(it))}" ${itemAction(it)}><i></i>${esc(itemTitle(it))}${spanDays(it.ev) > 1 ? ` <span class="muted">· ${spanDays(it.ev)} giorni</span>` : ''}</button>`).join('')}</div>` : ''}
      ${timed.length ? `<div class="timeline-today">${rows}</div>` : (allDay.length ? '' : `<div class="empty"><b>Giornata libera</b>Clicca “Nuovo” o un giorno in agenda per aggiungere qualcosa.</div>`)}
    </section>
    <div class="home-side">
      <section class="panel">
        <div class="panel-head"><h2>In arrivo</h2></div>
        ${upcoming.length ? `<div class="mini-list">${upcoming.map(it => `<button class="mini-row" style="--gc:${esc(itemColor(it))}" ${itemAction(it)}>
          <span class="mini-date"><b>${itemStart(it).getDate()}</b>${MESI[itemStart(it).getMonth()]}</span>
          <span class="mini-body"><span class="mini-title">${esc(itemTitle(it))}</span><span class="mini-sub">${relDay(itemStart(it))}${it.ev && it.ev.allDay ? '' : ' · ' + fmtHM(itemStart(it))}</span></span>
        </button>`).join('')}</div>` : '<div class="empty">Settimana tranquilla.</div>'}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Da riprendere</h2><button class="link" data-action="nav" data-view="progetti">Tutti (${resume.length})</button></div>
        <div class="mini-list">${resume.slice(0, 4).map(p => { const ns = nextStep(p); const c = cat(p.category); return `<button class="mini-row" style="--gc:${esc(c ? hex(c.color) : 'var(--accent)')}" data-action="open-project" data-id="${p.id}">
          <span class="proj-ic">${c ? icon('c-' + c.icon) : icon('i-folder')}</span>
          <span class="mini-body"><span class="mini-title">${esc(p.title)}${p.starred ? ' <span class="star-s">★</span>' : ''}</span><span class="mini-sub">${ns ? esc(ns.text) : 'Nessun passo aperto'}</span></span>
        </button>`; }).join('') || '<div class="empty">Nessun progetto attivo.</div>'}</div>
      </section>
    </div>
  </div>`;
}

function viewProjects() {
  let list = data.projects.slice();
  if (ui.projFilter === 'attivi') list = list.filter(p => p.status !== 'archiviato');
  if (ui.projFilter === 'preferiti') list = list.filter(p => p.starred && p.status !== 'archiviato');
  if (ui.projFilter === 'archivio') list = list.filter(p => p.status === 'archiviato');
  if (ui.catFilter) list = list.filter(p => p.category === ui.catFilter);
  list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!ui.projectId || !list.find(p => p.id === ui.projectId)) ui.projectId = list[0]?.id || null;
  const c = ui.catFilter && cat(ui.catFilter);

  return `
  <div class="split">
    <div class="list-pane">
      <div class="row" style="margin-bottom:6px">
        <div class="grow">
          <div class="eyebrow">${c ? 'Raccolta' : 'Archivio sul dispositivo'}</div>
          <h1 class="large-title" style="font-size:26px">${c ? esc(c.name) : 'Progetti'}</h1>
        </div>
        ${c ? `<button class="icon-btn" data-action="edit-cat" data-id="${c.id}" title="Modifica raccolta">${icon('i-edit')}</button><button class="icon-btn" data-action="clear-cat" title="Tutte le raccolte">${icon('i-close')}</button>` : ''}
      </div>
      <div class="segmented" style="margin:8px 0 12px; align-self:flex-start">
        ${[['attivi', 'Attivi'], ['preferiti', 'Preferiti'], ['archivio', 'Archivio']].map(([k, l]) =>
          `<button class="${ui.projFilter === k ? 'on' : ''}" data-action="proj-filter" data-f="${k}">${l}</button>`).join('')}
      </div>
      <div class="list-scroll">
        ${list.length ? list.map(p => projectCard(p, { selected: p.id === ui.projectId })).join('') : `<div class="empty"><b>Nessun progetto</b>${ui.projFilter === 'archivio' ? 'L’archivio è vuoto.' : 'Premi “Nuovo” per iniziare.'}</div>`}
      </div>
    </div>
    <div class="detail-pane">${ui.projectId ? projectDetail(proj(ui.projectId)) : ''}</div>
  </div>`;
}

function projectDetail(p) {
  const ns = nextStep(p);
  const evs = data.events.filter(e => e.projectId === p.id).sort((a, b) => a.start.localeCompare(b.start));
  const steps = p.steps.slice().sort((a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999'));
  const traces = p.traces.slice().sort((a, b) => b.at.localeCompare(a.at));
  let lastDay = null;
  const statusPill = p.status === 'attivo' ? '<span class="pill ok">Attivo</span>' : p.status === 'in pausa' ? '<span class="pill">In pausa</span>' : '<span class="pill">Archiviato</span>';

  return `
  <div class="detail-head">
    <div class="grow" style="flex:1;min-width:0">
      <div class="meta-row">
        <button class="icon-btn" style="width:24px;height:24px;margin-left:-4px;color:${p.starred ? 'var(--accent)' : 'var(--text-3)'}" data-action="toggle-star" data-id="${p.id}" title="Preferito">${p.starred ? icon('i-star', 'star').replace('class="star"', 'class="star" style="fill:var(--accent)"') : icon('i-star')}</button>
        <select class="select-chip" data-change="proj-cat" data-id="${p.id}">
          <option value="">Senza raccolta</option>
          ${data.categories.map(c => `<option value="${c.id}" ${c.id === p.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        ${statusPill}
        <span class="tiny">Aggiornato ${stamp(p.updatedAt).toLowerCase()}</span>
      </div>
      <h1 class="detail-title" contenteditable="plaintext-only" spellcheck="false" data-edit="proj-title" data-id="${p.id}">${esc(p.title)}</h1>
      <div class="desc" contenteditable="plaintext-only" data-edit="proj-desc" data-id="${p.id}">${esc(p.description)}</div>
    </div>
    <button class="icon-btn round" data-action="proj-menu" data-id="${p.id}" title="Altre azioni">${icon('i-more')}</button>
  </div>

  <div class="detail-grid">
    <div>
      <div class="next-step">
        <div class="label">Prossimo passo</div>
        ${ns ? `
          <div class="text">${esc(ns.text)}</div>
          ${ns.due ? `<div><mark>${relDay(parse(ns.due))} · ${fmtHM(parse(ns.due))}</mark></div>` : '<div class="muted">Senza scadenza</div>'}
          <div class="row" style="margin-top:14px">
            <div class="grow tiny">${ns.reminder !== null && ns.reminder !== undefined ? `${icon('i-bell').replace('<svg', '<svg style="width:12px;height:12px;vertical-align:-2px"')} ${remShort(ns.reminder)}` : 'Nessun promemoria'}</div>
            <button class="btn small" data-action="edit-step" data-pid="${p.id}" data-id="${ns.id}">Modifica</button>
            <button class="btn-primary" style="height:26px;font-size:12.5px" data-action="complete-step" data-pid="${p.id}" data-id="${ns.id}">${icon('i-check')} Completa</button>
          </div>` : `<div class="text muted" style="font-weight:500">Tutto fatto. Aggiungi il prossimo passo qui sotto.</div>`}
      </div>

      <div class="section-head"><h2>Passi (${p.steps.filter(s => !s.done).length})</h2></div>
      <div class="card" style="padding:4px 14px 12px">
        <div class="steps">
          ${steps.map(s => {
            const late = !s.done && s.due && parse(s.due) < new Date();
            return `<div class="step ${s.done ? 'done' : ''}">
              <button class="check ${s.done ? 'on' : ''}" data-action="toggle-step" data-pid="${p.id}" data-id="${s.id}">${icon('i-check')}</button>
              <div class="step-text">${esc(s.text)}
                ${s.due ? `<div class="step-meta ${late ? 'late' : ''}">${icon('i-clock')} ${relDay(parse(s.due))} · ${fmtHM(parse(s.due))}${s.reminder !== null && s.reminder !== undefined ? ` · ${icon('i-bell')} ${remShort(s.reminder)}` : ''}</div>` : ''}
              </div>
              <button class="icon-btn" data-action="edit-step" data-pid="${p.id}" data-id="${s.id}" title="Modifica">${icon('i-edit')}</button>
              <button class="icon-btn" data-action="del-step" data-pid="${p.id}" data-id="${s.id}" title="Elimina">${icon('i-trash')}</button>
            </div>`;
          }).join('') || '<div class="muted" style="padding:10px 0 2px">Nessun passo.</div>'}
        </div>
        <form class="inline-add" data-submit="add-step" data-pid="${p.id}">
          <input name="text" placeholder="Nuovo passo…  (Invio per aggiungere)" autocomplete="off">
          <button class="btn small" type="button" data-action="new-step" data-pid="${p.id}" title="Con scadenza e promemoria">${icon('i-clock')}</button>
        </form>
      </div>

      <div class="section-head"><h2>Appuntamenti ed eventi (${evs.length})</h2><button class="link" data-action="new-event" data-pid="${p.id}">Aggiungi</button></div>
      <div class="stack">
        ${evs.length ? evs.map(e => eventCard(e)).join('') : '<div class="empty">Nessun appuntamento collegato.</div>'}
      </div>
    </div>

    <div>
      <div class="section-head" style="margin-top:0"><h2>Timeline</h2><button class="link" data-action="new-trace" data-pid="${p.id}">Aggiungi traccia</button></div>
      <div class="card" style="padding:16px 16px 4px">
        ${traces.length ? `<div class="timeline">
          ${traces.map(t => {
            const d = parse(t.at);
            const dk = dayKey(d);
            const sep = dk !== lastDay ? `<div class="day-sep">${icon('i-calendar')}<span class="tiny">${relDay(d)}</span></div>` : '';
            lastDay = dk;
            return `${sep}<div class="trace">
              <div class="tiny">Traccia · ${fmtHM(d)}</div>
              <div class="trace-title">${esc(t.title)}</div>
              ${t.body ? `<div class="trace-body">${esc(t.body)}</div>` : ''}
              <button class="icon-btn" data-action="edit-trace" data-pid="${p.id}" data-id="${t.id}">${icon('i-edit')}</button>
            </div>`;
          }).join('')}
        </div>` : '<div class="muted" style="padding:0 0 14px">Le tracce sono note datate: prenotazioni, decisioni, idee. Aggiungine una.</div>'}
      </div>
    </div>
  </div>`;
}

const isoWeek = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 86400000 + 1) / 7); };
const calMode = () => ui.calMode || data.settings.calMode || 'settimana';
const weekStartOf = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const HOUR_H = 48;

function agendaToolbar(title, sub) {
  const mode = calMode();
  return `<div class="agenda-top">
    <div class="agenda-title"><h1 class="display cap1">${title}</h1>${sub ? `<span class="agenda-sub">${sub}</span>` : ''}</div>
    <div class="agenda-tools">
      <div class="segmented filt" title="Mostra">
        ${[['appuntamento', 'Appuntamenti'], ['evento', 'Eventi'], ['passo', 'Passi']].map(([k, l]) => `<button class="${ui.chips[k] ? 'on' : ''}" data-action="chip" data-k="${k}">${l}</button>`).join('')}
      </div>
      <div class="segmented modes">
        ${[['giorno', 'Giorno'], ['settimana', 'Settimana'], ['mese', 'Mese']].map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-action="cal-mode" data-m="${k}">${l}</button>`).join('')}
      </div>
      <div class="nav-pill">
        <button class="icon-btn" data-action="cal-prev" title="Indietro">${icon('i-chev-l')}</button>
        <button class="btn small" data-action="cal-today">Oggi</button>
        <button class="icon-btn" data-action="cal-next" title="Avanti">${icon('i-chev-r')}</button>
      </div>
    </div>
  </div>`;
}

// disposizione degli impegni sovrapposti in colonne affiancate
function layoutDay(list) {
  list.sort((a, b) => a.s - b.s || b.e - a.e);
  const clusters = []; let cur = [], end = -1;
  for (const it of list) { if (cur.length && it.s >= end) { clusters.push(cur); cur = []; end = -1; } cur.push(it); end = Math.max(end, it.e); }
  if (cur.length) clusters.push(cur);
  for (const c of clusters) {
    const cols = [];
    for (const it of c) { let i = cols.findIndex(e => e <= it.s); if (i < 0) { i = cols.length; cols.push(it.e); } else cols[i] = it.e; it.col = i; }
    for (const it of c) it.n = cols.length;
  }
  return list;
}

function canEdit(it) {
  if (it.step) return true;
  if (it.ev.rrule) return false; // le ripetizioni si modificano dalla scheda
  if (!it.ev.source) return true;
  return !isReadOnly(it.ev);
}

function viewTimeGrid(days) {
  const now = new Date();
  const mins = (d) => d.getHours() * 60 + d.getMinutes();
  const head = days.map(d => `<button class="tg-hd ${sameDay(d, now) ? 'today' : ''} ${d < startOfDay(now) ? 'past' : ''}" data-action="cal-day" data-date="${dayKey(d)}"><span class="tg-dn">${d.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '')}</span><span class="tg-num">${d.getDate()}</span>${typeof wxDay === 'function' && wxCfg().headers !== false ? (() => { const w = wxDay(dayKey(d)); return w ? `<span class="tg-wx" title="${esc(wxInfo(w.code)[0])} · min ${Math.round(w.min)}°">${wxIcon(w.code, true, 16)}${Math.round(w.max)}°</span>` : ''; })() : ''}</button>`).join('');
  let hasAll = false;
  const allRow = days.map(d => {
    const its = itemsOn(d, ui.chips).filter(it => it.ev && (it.ev.allDay || spanDays(it.ev) > 1));
    if (its.length) hasAll = true;
    return `<div class="tg-all-cell" data-date="${dayKey(d)}">${its.map(it => {
      const st = dayKey(parse(it.ev.start)) === dayKey(d) || (d.getDay() === 1) || days[0] === d;
      return `<button class="tg-allchip ${parse(it.ev.end || it.ev.start) < now ? 'past' : ''}" style="--gc:${esc(itemColor(it))}" data-action="edit-event" data-id="${it.ev.id}" title="${esc(it.ev.title)}">${st ? esc(it.ev.title) : '&nbsp;'}</button>`;
    }).join('')}</div>`;
  }).join('');
  const cols = days.map(d => {
    const its = itemsOn(d, ui.chips).filter(it => !(it.ev && (it.ev.allDay || spanDays(it.ev) > 1)));
    const ds = startOfDay(d);
    const list = layoutDay(its.map(it => {
      const s0 = itemStart(it), e0 = it.ev ? itemEnd(it) : new Date(s0.getTime() + (+it.step.duration || 30) * 60000);
      const s = s0 < ds ? 0 : mins(s0);
      const e = e0 > addDays(ds, 1) ? 1440 : Math.max(s + 15, mins(e0) || 1440);
      return { it, s, e };
    }));
    const blocks = list.map(({ it, s, e, col, n }) => {
      const past = itemEnd(it) < now && !(it.step && !it.step.done);
      const top = s / 60 * HOUR_H, h = Math.max(20, (e - s) / 60 * HOUR_H - 2);
      const edit = canEdit(it);
      const id = it.ev ? it.ev.id : it.step.id;
      return `<div class="tg-ev ${ui.sheet && ui.sheet.id === id ? 'sheet-on' : ''} ${past ? 'past' : ''} ${h < 34 ? 'short' : ''} ${it.step ? 'step' : ''} ${it.step && it.step.auto ? 'auto' : ''} ${it.step && it.step.done ? 'done' : ''} ${edit ? 'editable' : 'ro'}" style="top:${top}px;height:${h}px;left:calc(${col / n * 100}% + 1px);width:calc(${100 / n}% - 4px);--gc:${esc(itemColor(it))}"
        data-kind="${it.ev ? 'ev' : 'st'}" data-id="${id}" ${it.step ? `data-pid="${it.project.id}"` : ''} data-date="${dayKey(d)}" data-s="${s}" data-e="${e}">
        <div class="tg-ev-t">${it.step ? (it.step.done ? '✓ ' : it.step.auto ? '✦ ' : '◯ ') : ''}${esc(itemTitle(it))}</div>
        <div class="tg-ev-time">${fmtHM(itemStart(it))}${it.ev ? '–' + fmtHM(itemEnd(it)) : it.step.duration ? ' · ' + it.step.duration + ' min' : ''}${it.ev && it.ev.location ? ' · ' + esc(it.ev.location) : ''}</div>
        ${it.ev && typeof travelBadge === 'function' ? travelBadge(it.ev, true) : ''}
        ${edit && it.ev ? '<i class="tg-rs"></i>' : ''}
      </div>`;
    }).join('');
    const nowLine = sameDay(d, now) ? `<div class="tg-now" style="top:${mins(now) / 60 * HOUR_H}px"></div>` : '';
    return `<div class="tg-col ${sameDay(d, now) ? 'today' : ''} ${(d.getDay() + 6) % 7 > 4 ? 'we' : ''}" data-date="${dayKey(d)}">${blocks}${nowLine}</div>`;
  }).join('');
  const showNow = days.some(d => sameDay(d, now));
  const gutter = [...Array(24)].map((_, h) => `<div class="tg-hour" style="top:${h * HOUR_H}px">${h ? pad(h) + ':00' : ''}</div>`).join('')
    + (showNow ? `<div class="tg-now-label" style="top:${mins(now) / 60 * HOUR_H}px">${fmtHM(now)}</div>` : '');
  const tz = (Intl.DateTimeFormat('it-IT', { timeZoneName: 'short' }).formatToParts(now).find(p => p.type === 'timeZoneName') || {}).value || '';
  return `<div class="tg" style="--n:${days.length}">
    <div class="tg-head"><div class="tg-tz">${esc(tz)}</div>${head}</div>
    <div class="tg-allrow ${hasAll ? '' : 'noall'}"><div class="tg-all-label">Tutto il giorno</div>${allRow}</div>
    <div class="tg-body" id="tg-body"><div class="tg-grid" style="height:${24 * HOUR_H}px"><div class="tg-gutter">${gutter}</div>${cols}</div></div>
  </div>`;
}

function viewAgenda() {
  const today = new Date();
  if (!ui.month) ui.month = new Date(today.getFullYear(), today.getMonth(), 1);
  if (!ui.sel) ui.sel = dayKey(today);
  const mode = calMode();
  if (mode !== 'mese') {
    const sel = parse(ui.sel);
    let days;
    if (mode === 'giorno') days = [sel];
    else { const ws = weekStartOf(sel); days = [...Array(7)].map((_, i) => addDays(ws, i)); if (data.settings.hideWeekend) days = days.slice(0, 5); }
    const a = days[0], b = days[days.length - 1];
    const title = mode === 'giorno' ? sel.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) : (a.getMonth() === b.getMonth() ? fmtMonth(a) : `${MESI[a.getMonth()]} – ${MESI[b.getMonth()]} ${b.getFullYear()}`);
    return `<div class="agenda tgwrap">${agendaToolbar(title, mode === 'settimana' ? `Settimana ${isoWeek(sel)}` : relDay(sel) === 'Oggi' ? 'Oggi' : '')}<div class="tg-row">${viewTimeGrid(days)}${typeof sheetHTML === 'function' ? sheetHTML() : ''}</div></div>`;
  }
  const m = ui.month;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // lunedì = 0
  const gridStart = addDays(first, -offset);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const its = itemsOn(d, ui.chips);
    const chips = its.slice(0, 3).map(x => {
      const multi = x.ev && (x.ev.allDay || spanDays(x.ev) > 1);
      return `<span class="dchip ${multi ? 'bar' : ''}" style="--gc:${esc(itemColor(x))}"><i></i>${multi ? '' : `<em>${fmtHM(itemStart(x))}</em>`}${esc(itemTitle(x))}</span>`;
    }).join('');
    cells.push(`<button class="day ${d.getMonth() !== m.getMonth() ? 'other' : ''} ${sameDay(d, today) ? 'today' : ''} ${dayKey(d) === ui.sel ? 'sel' : ''} ${(d.getDay() + 6) % 7 > 4 ? 'we' : ''}" data-action="sel-day" data-date="${dayKey(d)}">
      <span class="num">${d.getDate()}</span>
      <span class="dchips">${chips}${its.length > 3 ? `<span class="dmore">+${its.length - 3}</span>` : ''}</span>
    </button>`);
  }
  const selD = parse(ui.sel);
  const its = itemsOn(selD, ui.chips);
  const chip = (k, label, color) => `<button class="chip ${ui.chips[k] ? 'on' : ''}" data-action="chip" data-k="${k}"><span class="mark" style="background:${ui.chips[k] ? color : 'var(--text-3)'}"></span>${label}</button>`;

  return `
  <div class="agenda modern">
    <div class="agenda-main">
      ${agendaToolbar(fmtMonth(m), '')}
      <div class="cal">
        <div class="cal-grid">
          ${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map(x => `<div class="dow">${x}</div>`).join('')}
          ${cells.join('')}
        </div>
      </div>
    </div>
    ${typeof sheetHTML === 'function' && ui.sheet ? sheetHTML() : `<aside class="day-side">
      <div class="day-side-head">
        <div class="day-big"><b>${selD.getDate()}</b><span>${selD.toLocaleDateString('it-IT', { weekday: 'long' })}<small>${relDay(selD) === 'Oggi' || relDay(selD) === 'Domani' ? relDay(selD) + ' · ' : ''}${its.length} ${its.length === 1 ? 'elemento' : 'elementi'}</small></span></div>
        <button class="icon-btn round" data-action="new-event" data-date="${ui.sel}" title="Nuovo evento">${icon('i-plus')}</button>
      </div>
      <div class="stack">
        ${its.length ? its.map(it => it.ev ? eventCard(it.ev, { showCat: true, sheet: true }) : stepCard(it.step, it.project, true)).join('') : `<div class="empty"><b>Niente in programma</b>Fai clic su un giorno del calendario per aggiungere un evento.</div>`}
      </div>
    </aside>`}
  </div>`;
}

function viewReminders() {
  const list = remindersList();
  const now = new Date();
  const t0 = startOfDay(now), t1 = addDays(t0, 1), t2 = addDays(t0, 2), t7 = addDays(t0, 7);
  const groups = [
    ['late', 'In ritardo', r => r.when < now && r.kind === 'st'],
    ['', 'Oggi', r => r.when >= t0 && r.when < t1 && !(r.when < now && r.kind === 'st')],
    ['', 'Domani', r => r.when >= t1 && r.when < t2],
    ['', 'Prossimi 7 giorni', r => r.when >= t2 && r.when < t7],
    ['', 'Più avanti', r => r.when >= t7],
  ];
  const row = (r) => {
    const remTime = r.kind === 'ev' ? r.ev.reminder : r.step.reminder;
    const action = r.kind === 'ev' ? `data-action="edit-event" data-id="${r.ev.id}"` : `data-action="open-project" data-id="${r.project.id}"`;
    return `<div class="rem" ${action}>
      ${r.kind === 'st' ? `<button class="check" data-action="complete-step" data-pid="${r.project.id}" data-id="${r.step.id}" title="Segna come fatto">${icon('i-check')}</button>` : `<span class="bell evb">${icon('i-calendar')}</span>`}
      <div class="grow" style="min-width:0">
        <div class="rem-title">${esc(r.title)}</div>
        <div class="card-sub">${r.sub ? `${icon('i-folder')} ${esc(r.sub)}` : ''}${remTime !== null && remTime !== undefined ? ` &nbsp;${icon('i-bell')} ${remShort(remTime)}` : ''}</div>
      </div>
      <div class="rem-when"><b>${r.kind === 'ev' && r.ev.allDay ? 'Tutto il giorno' : fmtHM(r.when)}</b>${relDay(r.when)}</div>
    </div>`;
  };
  const body = groups.map(([cls, title, f]) => {
    const items = list.filter(f);
    if (!items.length) return '';
    return `<div class="rem-group ${cls}"><h3>${title} · ${items.length}</h3><div class="rem-list">${items.map(row).join('')}</div></div>`;
  }).join('');

  return `
  <div style="max-width:820px">
    <div class="eyebrow">Non perdere il filo</div>
    <h1 class="large-title">Promemoria</h1>
    <div class="subtitle">Riceverai una notifica sul desktop all'orario impostato, anche con la finestra chiusa (Promemo resta nell'area di notifica).</div>
    ${body || `<div class="empty" style="margin-top:24px"><b>Nessun promemoria</b>Aggiungi un promemoria a un passo o a un appuntamento.</div>`}
  </div>`;
}

// ---------- Account collegati ----------
let syncing = false;
function renderSyncButton() {
  const b = $('#btn-sync'); if (!b) return;
  const accs = data.accounts || [];
  b.hidden = !accs.length;
  b.classList.toggle('spin', syncing);
  const last = accs.map(a => a.lastSync).filter(Boolean).sort().pop();
  b.title = syncing ? 'Sincronizzazione in corso…' : last ? `Sincronizza ora · ultima ${stamp(last).toLowerCase()}` : 'Sincronizza ora';
  b.classList.toggle('err', accs.some(a => a.error));
}

const provIcon = (a) => `<span class="prov prov-${a.provider}">${provLetter(a.provider)}</span>`;

function viewAccounts() {
  const accs = data.accounts || [];
  const count = (a) => data.events.filter(e => e.source && e.source.acc === a.id).length;
  return `
  <div style="max-width:880px">
    <div class="eyebrow">Tutti i tuoi calendari, in un posto</div>
    <h1 class="large-title">Account collegati</h1>
    <div class="subtitle">Gli eventi arrivano in Promemo e, dove il servizio lo permette, quelli che crei o modifichi qui tornano indietro. La sincronizzazione avviene all'avvio e ogni ${data.settings.syncMinutes || 15} minuti.</div>

    ${accs.length ? `<div class="stack" style="margin-top:22px">${accs.map(a => `
      <div class="card acc">
        <div class="row">
          ${provIcon(a)}
          <div class="grow">
            <div class="acc-name">${esc(a.name)}</div>
            <div class="card-sub">${PROV[a.provider]} · ${count(a)} eventi · ${a.lastSync ? 'sincronizzato ' + stamp(a.lastSync).toLowerCase() : 'mai sincronizzato'}</div>
          </div>
          <label class="row" style="gap:8px;color:var(--text-2);font-size:12.5px">Attivo <input type="checkbox" class="switch" data-acc-toggle="${a.id}" ${a.enabled ? 'checked' : ''}></label>
          <button class="btn small" data-action="acc-sync" data-id="${a.id}" ${syncing ? 'disabled' : ''}>${icon('i-sync')} Sincronizza</button>
          <button class="icon-btn" data-action="acc-menu" data-id="${a.id}">${icon('i-more')}</button>
        </div>
        ${a.error ? `<div class="acc-err">${icon('i-close')} ${esc(a.error)}</div>` : ''}
        <div class="acc-cals">
          ${a.calendars.map(c => `
            <label class="acc-cal">
              <i style="background:${esc(c.color)}"></i>
              <span class="grow">${esc(c.name)}</span>
              ${c.writable ? '<span class="tiny">Lettura e scrittura</span>' : '<span class="tiny">Sola lettura</span>'}
              <input type="checkbox" class="switch" data-cal-toggle="${a.id}" data-cal="${esc(c.id)}" ${c.enabled ? 'checked' : ''}>
            </label>`).join('')}
        </div>
        <div class="acc-groups">
          <div class="row"><span class="tiny grow">Gruppi e colori${a.provider === 'notion' ? (a.config.colorProp ? ` · da colonna “${esc(a.config.colorProp)}”` : '') : a.provider === 'google' ? ' · uno per calendario' : a.provider === 'calendly' ? ' · uno per tipo di appuntamento' : ' · dalle categorie del calendario'}</span>${a.provider === 'notion' ? `<button class="link" data-action="notion-color" data-id="${a.id}">${a.config.colorProp ? 'Cambia colonna' : 'Colora per colonna'}</button>` : ''}</div>
          <div class="grp-chips">${(a.groups || []).map(g => `<button class="pill grp-chip" data-action="grp-color" data-type="acc" data-acc="${a.id}" data-gid="${esc(g.id)}"><i style="background:${esc(g.color)}"></i>${esc(g.name || a.name)}</button>`).join('')}</div>
        </div>
        ${a.provider === 'calendly' ? `<label class="row acc-foot"><span class="muted grow">Nascondi le copie che Calendly scrive in Google o negli altri calendari</span><input type="checkbox" class="switch" data-acc-dedupe="${a.id}" ${a.config?.dedupe !== false ? 'checked' : ''}></label>` : ''}
        <div class="row acc-foot">
          <span class="muted grow">Promemoria predefinito per gli eventi importati</span>
          <select class="select-chip" data-acc-rem="${a.id}">${REMINDERS.map(([v, l]) => `<option value="${v === null ? '' : v}" ${a.defaultReminder === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
      </div>`).join('')}</div>` : ''}

    <div class="section-head"><h2>${accs.length ? 'Aggiungi un altro account' : 'Collega un account'}</h2></div>
    <div class="prov-grid">
      <button class="card clickable prov-tile" data-action="add-google">${provIcon({ provider: 'google' })}<b>Google Calendar</b><span>Il calendario del tuo account Gmail. Lettura e scrittura.</span></button>
      <button class="card clickable prov-tile" data-action="add-notion">${provIcon({ provider: 'notion' })}<b>Notion</b><span>Un database con una proprietà data. Lettura e scrittura.</span></button>
      <button class="card clickable prov-tile" data-action="add-calendly">${provIcon({ provider: 'calendly' })}<b>Calendly</b><span>Le prenotazioni ricevute, con nome, email e risposte di chi prenota. Sola lettura.</span></button>
      <button class="card clickable prov-tile" data-action="add-ics">${provIcon({ provider: 'ics' })}<b>Calendario da link</b><span>iCloud, Outlook, Nextcloud, Proton, orari universitari… (.ics, sola lettura)</span></button>
    </div>
  </div>`;
}

function setBusy(form, busy, label) {
  const b = form.querySelector('.btn-primary');
  if (!b) return;
  if (busy) { b.dataset.label = b.innerHTML; b.innerHTML = `<span class="spinner"></span> ${label || 'Attendere…'}`; b.disabled = true; }
  else { b.innerHTML = b.dataset.label || b.innerHTML; b.disabled = false; }
}
const showErr = (form, msg) => { const el = form.querySelector('.form-err'); el.textContent = msg || ''; el.hidden = !msg; };

function modalGoogle() {
  openModal(`
    <h2>${provIcon({ provider: 'google' })} Collega Google Calendar</h2>
    <p class="muted" style="margin-top:-6px">Google richiede che ogni app desktop abbia le proprie credenziali. Si creano una volta sola, gratis, in circa 5 minuti:</p>
    <ol class="howto">
      <li>Apri <a href="#" data-action="open-url" data-url="https://console.cloud.google.com/projectcreate">Google Cloud Console</a> e crea un progetto (es. “Promemo”).</li>
      <li>In <a href="#" data-action="open-url" data-url="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">API e servizi → Libreria</a> abilita <b>Google Calendar API</b>.</li>
      <li>In <a href="#" data-action="open-url" data-url="https://console.cloud.google.com/auth/overview">Google Auth Platform</a> configura l'app come <b>Esterna</b>, poi in <i>Pubblico</i> premi <b>Pubblica app</b> (in modalità “test” Google scollega l'account ogni 7 giorni). Al primo accesso vedrai “app non verificata”: è la tua, scegli <i>Avanzate → Vai a Promemo</i>.</li>
      <li>In <a href="#" data-action="open-url" data-url="https://console.cloud.google.com/auth/clients">Client</a> → <b>Crea client</b> → tipo <b>App desktop</b>. Copia ID client e client secret qui sotto.</li>
    </ol>
    <form class="form" data-submit="connect-google">
      <label class="field"><span>ID client</span><input name="clientId" required placeholder="123456-abc.apps.googleusercontent.com" spellcheck="false"></label>
      <label class="field"><span>Client secret</span><input name="clientSecret" type="password" placeholder="GOCSPX-…" spellcheck="false"></label>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Accedi con Google</button></div>
    </form>`);
}

function modalNotion(pre = {}) {
  const known = (data.accounts || []).filter(a => a.provider === 'notion');
  openModal(`
    <h2>${provIcon({ provider: 'notion' })} ${pre.database ? 'Mostra in Agenda' : 'Collega un database Notion'}</h2>
    ${known.length ? `<p class="muted" style="margin-top:-6px">Puoi collegare tutti i database che vuoi (lezioni, allenamenti, scadenze…): ognuno diventa un calendario con i suoi colori. Il token dell'integrazione già salvato si riusa.</p>` : ''}
    <ol class="howto" ${known.length ? 'style="display:none"' : ''}>
      <li>Su <a href="#" data-action="open-url" data-url="https://www.notion.so/profile/integrations">notion.so/profile/integrations</a> crea una <b>integrazione interna</b> e copia il <b>token</b>.</li>
      <li>Apri il database in Notion → menu <b>⋯</b> → <b>Connessioni</b> → aggiungi la tua integrazione.</li>
      <li>Copia il link del database (<i>Condividi → Copia link</i>) e incollalo qui.</li>
    </ol>
    <form class="form" data-submit="inspect-notion">
      ${known.length ? `<label class="field"><span>Integrazione</span><select name="fromAcc" data-notion-from><option value="${known[0].id}">Usa il token già salvato (${esc(known[0].name)})</option><option value="">Un altro token…</option></select></label>` : ''}
      <label class="field" ${known.length ? 'style="display:none"' : ''} data-token-field><span>Token dell'integrazione</span><input name="token" type="password" ${known.length ? '' : 'required'} placeholder="ntn_…" spellcheck="false"></label>
      <label class="field"><span>Link o ID del database</span><input name="database" required placeholder="https://www.notion.so/…" spellcheck="false" value="${esc(pre.database || '')}"></label>
      <div class="notion-map" hidden></div>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Verifica database</button></div>
    </form>`, (m) => {
      const sel = m.querySelector('[data-notion-from]');
      sel && sel.addEventListener('change', () => { const f = m.querySelector('[data-token-field]'); f.style.display = sel.value ? 'none' : ''; m.querySelector('.howto').style.display = sel.value ? 'none' : ''; f.querySelector('input').required = !sel.value; });
      if (pre.database && known.length) setTimeout(() => m.querySelector('form').requestSubmit(), 50);
    });
}

function modalCalendly() {
  openModal(`
    <h2>${provIcon({ provider: 'calendly' })} Collega Calendly</h2>
    <p class="muted" style="margin-top:-6px">Le prenotazioni arrivano con il nome di chi prenota, l'email, le risposte al modulo e i link per spostare o annullare. Funziona anche con il piano gratuito.</p>
    <ol class="howto">
      <li>Accedi a Calendly con l'account delle ripetizioni e apri <a href="#" data-action="open-url" data-url="https://calendly.com/integrations/api_webhooks">Integrazioni → API e webhook</a>.</li>
      <li>In <b>Token di accesso personali</b> premi <b>Genera nuovo token</b>, dagli un nome (es. “Promemo”) e copialo: Calendly lo mostra una sola volta.</li>
    </ol>
    <form class="form" data-submit="connect-calendly">
      <label class="field"><span>Token di accesso personale</span><input name="token" type="password" required placeholder="eyJraWQiOi…" spellcheck="false"></label>
      <label class="switch-row" style="border:0;padding:4px 0"><div>Nascondi i doppioni<small>Calendly copia ogni prenotazione nel calendario collegato (Google, Outlook…): mostro solo quella di Calendly</small></div><input type="checkbox" class="switch" name="dedupe" checked></label>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Collega Calendly</button></div>
    </form>`);
}

function modalIcs() {
  openModal(`
    <h2>${provIcon({ provider: 'ics' })} Calendario da link</h2>
    <p class="muted" style="margin-top:-6px">Incolla l'indirizzo iCal (.ics o webcal://) del calendario. Dove trovarlo:</p>
    <ul class="howto">
      <li><b>iCloud</b>: app Calendario → condividi calendario → <i>Calendario pubblico</i>.</li>
      <li><b>Outlook / Microsoft 365</b>: Impostazioni → Calendario → Calendari condivisi → <i>Pubblica un calendario</i> → link ICS.</li>
      <li><b>Google</b> (solo lettura, senza credenziali): Impostazioni del calendario → <i>Indirizzo segreto in formato iCal</i>.</li>
      <li><b>Nextcloud, Proton, Fastmail</b>, orari dei corsi: cerca “link di iscrizione” o “esporta iCal”.</li>
    </ul>
    <form class="form" data-submit="connect-ics">
      <label class="field"><span>Indirizzo</span><input name="url" required placeholder="webcal://… oppure https://….ics" spellcheck="false"></label>
      <label class="field"><span>Nome (facoltativo)</span><input name="name" placeholder="Es. Calendario lezioni"></label>
      <input type="hidden" name="color" value="#8e5bd9">
      <div class="field"><span>Colore</span><div class="swatches" data-pick="color">${['#e5562a', '#2f9e5b', '#2f7ae5', '#8e5bd9', '#d9467a', '#1f9aa5', '#c9930a', '#8e8e93'].map((c, i) => `<button type="button" style="background:${c}" class="${i === 3 ? 'on' : ''}" data-v="${c}"></button>`).join('')}</div></div>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Aggiungi calendario</button></div>
    </form>`, (m) => {
      const g = m.querySelector('[data-pick]');
      g.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-v]'); if (!b) return; g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); m.querySelector('[name=color]').value = b.dataset.v; });
    });
}

// ---------- Palette comandi ----------
function openPalette() {
  closePopover(true);
  openModal(`<div class="palette"><label class="pal-input">${icon('i-search')}<input id="pal-q" placeholder="Cerca o scrivi un comando…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></label><div class="pal-list" id="pal-list"></div></div>`, (m) => {
    m.classList.add('modal-palette');
    const q = m.querySelector('#pal-q'), list = m.querySelector('#pal-list');
    let items = [], idx = 0;
    const cmds = [
      { t: 'Nuovo appuntamento', i: 'i-calendar', k: 'evento crea', run: () => modalEvent(null, {}) },
      { t: 'Nuovo progetto', i: 'i-folder', k: 'crea', run: () => modalProject() },
      { t: 'Nuovo promemoria', i: 'i-bell', k: 'passo crea', run: () => modalStep(null) },
      { t: 'Vai a Home', i: 'i-home', k: 'apri', run: () => go('home') },
      { t: 'Vai a Progetti', i: 'i-folder', k: 'apri', run: () => go('progetti') },
      { t: 'Vai ad Agenda', i: 'i-calendar', k: 'apri calendario', run: () => go('agenda') },
      { t: 'Vai a Promemoria', i: 'i-bell', k: 'apri', run: () => go('promemoria') },
      { t: 'Account collegati', i: 'i-sync', k: 'google notion calendly', run: () => go('account') },
      { t: 'Sincronizza ora', i: 'i-sync', k: 'aggiorna', run: () => actions['sync-now']() },
      { t: 'Impostazioni', i: 'i-gear', k: 'tema scuro chiaro', run: () => modalSettings() },
    ];
    const draw = () => {
      const v = q.value.trim().toLowerCase();
      const has = (x) => (x || '').toLowerCase().includes(v);
      const c = cmds.filter(x => !v || has(x.t) || has(x.k)).map(x => ({ ...x, sec: 'Azioni' }));
      const ps = v ? data.projects.filter(p => has(p.title) || p.steps.some(st => has(st.text))).slice(0, 5).map(p => ({ t: p.title, i: 'i-folder', sub: nextStep(p)?.text || '', sec: 'Progetti', run: () => go('progetti', { projectId: p.id, projFilter: p.status === 'archiviato' ? 'archivio' : 'attivi', catFilter: null }) })) : [];
      const now = new Date();
      const es = v ? data.events.filter(e => has(e.title) || has(e.location)).sort((a, b) => Math.abs(parse(a.start) - now) - Math.abs(parse(b.start) - now)).slice(0, 6).map(e => ({ t: e.title, i: 'i-calendar', color: groupInfo(e).color, sub: `${relDay(parse(e.start))}${e.allDay ? '' : ' · ' + fmtHM(parse(e.start))}`, sec: 'Eventi', run: () => modalEvent(e) })) : [];
      const top = PALETTE_TOP.flatMap(f => f(q.value) || []).map(x => ({ ...x, sec: x.sec || 'Crea' }));
      const ex = PALETTE_EXTRA.filter(x => !v || has(x.t) || has(x.k)).map(x => ({ ...x, sec: 'Azioni' }));
      items = [...top, ...es, ...ps, ...c, ...ex];
      idx = Math.min(idx, Math.max(0, items.length - 1));
      let last = '';
      list.innerHTML = items.map((x, n) => { const head = x.sec !== last ? `<div class="pal-sec">${x.sec}</div>` : ''; last = x.sec; return `${head}<button class="pal-item ${n === idx ? 'on' : ''}" data-n="${n}">${x.color ? `<i class="pal-dot" style="background:${esc(x.color)}"></i>` : icon(x.i)}<span class="grow">${esc(x.t)}</span>${x.sub ? `<span class="tiny">${esc(x.sub)}</span>` : ''}</button>`; }).join('') || '<div class="empty" style="margin:10px">Nessun risultato</div>';
      list.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' });
    };
    const runIt = (n) => { const x = items[n]; if (!x) return; closeModal(); setTimeout(() => x.run(), 10); };
    q.addEventListener('input', () => { idx = 0; draw(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); draw(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); draw(); }
      if (e.key === 'Enter') { e.preventDefault(); runIt(idx); }
    });
    list.addEventListener('click', (e) => { const b = e.target.closest('.pal-item'); if (b) runIt(+b.dataset.n); });
    draw();
  });
}

function viewSearch() {
  const q = ui.search.toLowerCase();
  const match = (s) => (s || '').toLowerCase().includes(q);
  const ps = data.projects.filter(p => match(p.title) || match(p.description) || p.steps.some(s => match(s.text)) || p.traces.some(t => match(t.title) || match(t.body)));
  const evs = data.events.filter(e => match(e.title) || match(e.location) || match(e.notes));
  return `
  <div class="eyebrow">Ricerca</div>
  <h1 class="large-title">“${esc(ui.search)}”</h1>
  <div class="grid-2">
    <div><div class="section-head"><h2>Progetti (${ps.length})</h2></div><div class="stack">${ps.map(p => projectCard(p)).join('') || '<div class="empty">Nessun risultato.</div>'}</div></div>
    <div><div class="section-head"><h2>Appuntamenti ed eventi (${evs.length})</h2></div><div class="stack">${evs.map(e => eventCard(e)).join('') || '<div class="empty">Nessun risultato.</div>'}</div></div>
  </div>`;
}

let rendering = false;
function render() {
  if (rendering) return; // evita ridisegni annidati (es. eventi di blur durante la sostituzione del contenuto)
  rendering = true;
  try { renderNow(); } finally { rendering = false; }
}
function renderNow() {
  DAYIDX = buildDayIdx();
  try { renderInner(); } finally { DAYIDX = null; }
}
function renderInner() {
  applySidebar();
  renderSidebar();
  const v = $('#view');
  const scroll = v.querySelector('.detail-pane')?.scrollTop;
  const titles = { home: 'Home', progetti: 'Progetti', agenda: 'Agenda', promemoria: 'Promemoria', account: 'Account collegati' };
  const xv = EXTRA_VIEWS[ui.view];
  $('#toolbar-title').textContent = ui.search ? 'Ricerca' : xv ? xv.title : titles[ui.view];
  v.classList.toggle('full', (ui.view === 'progetti' || (ui.view === 'agenda' && calMode() !== 'mese') || !!(xv && xv.full && xv.full())) && !ui.search);
  v.innerHTML = ui.search ? viewSearch() : xv ? xv.render() : ui.view === 'home' ? viewHome() : ui.view === 'progetti' ? viewProjects() : ui.view === 'agenda' ? viewAgenda() : ui.view === 'account' ? viewAccounts() : viewReminders();
  renderSyncButton();
  if (ui.view === 'agenda' && !ui.search && calMode() !== 'mese') initTimeGrid();
  if (xv && xv.after && !ui.search) xv.after(v);
  if (scroll) { const dp = v.querySelector('.detail-pane'); if (dp) dp.scrollTop = scroll; }
}

function go(view, extra = {}) {
  closePopover(true);
  const changed = ui.view !== view;
  ui.view = view; ui.search = ''; $('#global-search').value = '';
  Object.assign(ui, extra);
  render();
  if (changed) { const v = $('#view'); v.style.animation = 'none'; v.offsetHeight; v.style.animation = ''; v.scrollTop = 0; }
}

// ---------- Modali ----------
function openModal(html, onMount) {
  $('#modal').className = 'modal';
  $('#modal').innerHTML = html;
  $('#modal-backdrop').hidden = false;
  onMount && onMount($('#modal'));
  const f = $('#modal').querySelector('input:not([type=checkbox]),textarea');
  f && setTimeout(() => f.focus(), 30);
}
function closeModal() { $('#modal-backdrop').hidden = true; $('#modal').innerHTML = ''; $('#modal').className = 'modal'; }

const remSelect = (val, name = 'reminder') =>
  `<select name="${name}">${REMINDERS.map(([v, l]) => `<option value="${v === null ? '' : v}" ${val === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const readRem = (v) => v === '' ? null : Number(v);
const projSelect = (val) => `<select name="projectId"><option value="">Nessuno</option>${data.projects.filter(p => p.status !== 'archiviato' || p.id === val).map(p => `<option value="${p.id}" ${p.id === val ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select>`;

function defaultStart(dateKey) {
  const now = new Date();
  const d = dateKey ? parse(dateKey) : new Date(now);
  if (dateKey && dateKey === dayKey(now) || !dateKey) { d.setHours(now.getHours() + 1, 0, 0, 0); }
  else d.setHours(9, 0, 0, 0);
  return d;
}

function modalNew() {
  openModal(`
    <h2>Cosa vuoi aggiungere?</h2>
    ${typeof quickFieldHTML === 'function' ? quickFieldHTML() : ''}
    <div class="type-picker">
      <button data-action="new-project">${icon('i-folder')}Progetto<small>Un piano, un viaggio, un obiettivo</small></button>
      <button data-action="new-event">${icon('i-calendar')}Appuntamento<small>Con data, ora e luogo</small></button>
      <button data-action="new-step">${icon('i-bell')}Promemoria<small>Un passo da fare entro una data</small></button>
    </div>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Annulla</button></div>`, (m) => typeof quickFieldBind === 'function' && quickFieldBind(m));
}

function modalProject() {
  openModal(`
    <h2>Nuovo progetto</h2>
    <form class="form" data-submit="save-project">
      <label class="field"><span>Titolo</span><input name="title" required placeholder="Es. Weekend a Lisbona"></label>
      <label class="field"><span>Descrizione</span><textarea name="description" placeholder="Di cosa si tratta, in due righe"></textarea></label>
      <div class="field-row">
        <label class="field"><span>Raccolta</span><select name="category"><option value="">Nessuna</option>${data.categories.map(c => `<option value="${c.id}" ${ui.catFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Primo passo (facoltativo)</span><input name="step" placeholder="Es. Prenotare il volo"></label>
      </div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Crea progetto</button></div>
    </form>`);
}

function calendarSelect(ev) {
  const accs = (data.accounts || []).filter(a => a.enabled);
  if (ev && ev.source) {
    const a = accOf(ev), c = calOf(ev);
    return `<select name="calendar" disabled><option>${a ? `${PROV[a.provider]} · ${esc(c ? c.name : a.name)}` : 'Promemo'}</option></select>`;
  }
  const sel = ev && ev.pushTo ? `${ev.pushTo.acc}|${ev.pushTo.cal}` : (ev ? '' : data.settings.defaultCalendar || '');
  let opts = `<option value="">Promemo · solo su questo computer</option>`;
  for (const a of accs) for (const c of a.calendars.filter(c => c.writable && c.enabled)) {
    const v = `${a.id}|${c.id}`;
    opts += `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${PROV[a.provider]} · ${esc(c.name)}</option>`;
  }
  return `<select name="calendar">${opts}</select>`;
}

function eventFormHTML(ev, preset = {}, compact = false) {
  const isNew = !ev;
  const s = ev ? parse(ev.start) : preset.start ? parse(preset.start) : defaultStart(preset.date);
  const e = ev ? parse(ev.end || ev.start) : preset.end ? parse(preset.end) : new Date(s.getTime() + 3600000);
  const e0 = ev || { title: '', kind: 'appuntamento', projectId: preset.pid || '', allDay: false, location: '', reminder: 15, notes: '' };
  const ro = ev && isReadOnly(ev);
  const dis = ro ? 'disabled' : '';
  const a = ev && accOf(ev);
  return `
    <form class="form" data-submit="save-event" data-id="${ev ? ev.id : ''}">
      ${ro ? `<div class="note-ro">${icon('i-sync')} Evento importato da “${esc(a.name)}” in sola lettura: puoi cambiare solo tipo, progetto e promemoria.</div>` : ''}
      <label class="field"><span>Titolo</span><input name="title" required value="${esc(e0.title)}" placeholder="${compact ? 'Nuovo evento' : 'Es. Dentista'}" ${dis}></label>
      <div class="${compact ? 'row' : 'field'}" style="${compact ? 'gap:12px' : ''}">${compact ? '' : '<span>Tipo</span>'}
        <div class="segmented wide" data-seg="kind" style="${compact ? 'flex:1' : ''}">
          <button type="button" class="${e0.kind === 'appuntamento' ? 'on' : ''}" data-v="appuntamento">Appuntamento</button>
          <button type="button" class="${e0.kind === 'evento' ? 'on' : ''}" data-v="evento">Evento</button>
        </div>
        <input type="hidden" name="kind" value="${e0.kind}">
        ${compact ? `<label class="row" style="gap:7px;font-size:12.5px;color:var(--text-2);white-space:nowrap">Giornata <input type="checkbox" class="switch" name="allDay" ${e0.allDay ? 'checked' : ''} ${dis}></label>` : ''}
      </div>
      ${compact ? '' : `<label class="switch-row" style="padding:2px 0;border:0"><span>Tutto il giorno</span><input type="checkbox" class="switch" name="allDay" ${e0.allDay ? 'checked' : ''} ${dis}></label>`}
      <div class="field-row">
        <label class="field"><span>Inizio</span><input name="start" type="${e0.allDay ? 'date' : 'datetime-local'}" value="${e0.allDay ? dayKey(s) : iso(s)}" required ${dis}></label>
        <label class="field"><span>Fine</span><input name="end" type="${e0.allDay ? 'date' : 'datetime-local'}" value="${e0.allDay ? dayKey(e) : iso(e)}" required ${dis}></label>
      </div>
      <label class="field"><span>Luogo</span><input name="location" value="${esc(e0.location)}" placeholder="Facoltativo" ${dis}></label>
      ${ro ? '' : repeatFieldHTML(e0.rrule, s)}
      <div class="field-row">
        <label class="field"><span>Promemoria</span>${remSelect(e0.reminder)}</label>
        <label class="field"><span>Progetto</span>${projSelect(e0.projectId)}</label>
      </div>
      <label class="field"><span>Calendario</span>${calendarSelect(ev)}</label>
      ${compact
        ? `<details class="more-notes"><summary>Aggiungi note</summary><textarea name="notes" rows="3" placeholder="Note facoltative">${esc(e0.notes)}</textarea></details>`
        : `<label class="field"><span>Note</span><textarea name="notes" rows="3" placeholder="Facoltative" ${dis}>${esc(e0.notes)}</textarea></label>`}
      <div class="modal-actions">
        ${!isNew ? `<button type="button" class="btn danger left" data-action="del-event" data-id="${ev.id}">${icon('i-trash')} Elimina</button>` : ''}
        ${ev && ev.source && ev.source.url ? `<button type="button" class="btn ${isNew ? 'left' : ''}" data-action="open-url" data-url="${esc(ev.source.url)}">${a.provider === 'calendly' ? 'Sposta in Calendly' : 'Apri in ' + PROV[a.provider].replace(' Calendar', '')}</button>` : ''}
        <button type="button" class="btn" data-action="close-all">Annulla</button><button class="btn-primary">${isNew ? 'Aggiungi' : 'Salva'}</button>
      </div>
    </form>`;
}

// campo "Ripeti" (eventi e compiti)
function repeatFieldHTML(rule, start) {
  const r = rule || {}; const wd = start ? start.getDay() : new Date().getDay();
  const v = !r.freq ? '' : r.freq === 'weekly' && +r.interval === 2 ? 'biweekly' : r.freq === 'weekly' && r.byday && r.byday.length === 5 && !r.byday.includes(0) && !r.byday.includes(6) ? 'weekdays' : r.freq;
  const days = r.byday && r.byday.length ? r.byday : [wd];
  const D = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'G'], [5, 'V'], [6, 'S'], [0, 'D']];
  return `<div class="field rep-field"><span>Ripeti</span><div class="row" style="gap:8px;flex-wrap:wrap">
    <select name="rfreq" class="rep-sel">${[['', 'Mai'], ['daily', 'Ogni giorno'], ['weekdays', 'Nei giorni feriali'], ['weekly', 'Ogni settimana'], ['biweekly', 'Ogni 2 settimane'], ['monthly', 'Ogni mese'], ['yearly', 'Ogni anno']].map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div class="day-pick rep-days" ${v === 'weekly' || v === 'biweekly' ? '' : 'hidden'}>${D.map(([d, l]) => `<button type="button" data-rd="${d}" class="${days.includes(d) ? 'on' : ''}">${l}</button>`).join('')}</div>
    <label class="rep-until" ${v ? '' : 'hidden'}>fino al <input type="date" name="runtil" value="${esc(r.until || '')}"></label>
    <input type="hidden" name="rdays" value="${days.join(',')}"></div></div>`;
}
function readRepeat(fd) {
  const f = fd.get('rfreq'); if (!f) return null;
  const days = String(fd.get('rdays') || '').split(',').filter(x => x !== '').map(Number);
  const r = f === 'weekdays' ? { freq: 'weekly', interval: 1, byday: [1, 2, 3, 4, 5] } : f === 'biweekly' ? { freq: 'weekly', interval: 2, byday: days } : f === 'weekly' ? { freq: 'weekly', interval: 1, byday: days } : { freq: f, interval: 1 };
  if (fd.get('runtil')) r.until = fd.get('runtil');
  return r;
}
document.addEventListener('change', (e) => { const sel = e.target.closest('.rep-sel'); if (!sel) return; const box = sel.closest('.rep-field'); box.querySelector('.rep-days').hidden = !['weekly', 'biweekly'].includes(sel.value); box.querySelector('.rep-until').hidden = !sel.value; });
document.addEventListener('click', (e) => { const b = e.target.closest('.rep-days [data-rd]'); if (!b) return; b.classList.toggle('on'); const box = b.closest('.rep-field'); const on = [...box.querySelectorAll('.rep-days .on')].map(x => x.dataset.rd); if (!on.length) { b.classList.add('on'); on.push(b.dataset.rd); } box.querySelector('[name=rdays]').value = on.join(','); });

function bindEventForm(m) {
  const ad = m.querySelector('[name=allDay]');
  ad.addEventListener('change', () => {
    for (const n of ['start', 'end']) {
      const inp = m.querySelector(`[name=${n}]`);
      const v = inp.value;
      inp.type = ad.checked ? 'date' : 'datetime-local';
      inp.value = ad.checked ? v.slice(0, 10) : (v.length === 10 ? v + (n === 'start' ? 'T09:00' : 'T10:00') : v);
    }
  });
  const st = m.querySelector('[name=start]'), en = m.querySelector('[name=end]');
  let delta = parse(en.value) - parse(st.value);
  st.addEventListener('change', () => { const ns = parse(st.value); if (!ns) return; const ne = new Date(ns.getTime() + Math.max(delta, 0)); en.value = en.type === 'date' ? dayKey(ne) : iso(ne); });
  en.addEventListener('change', () => { delta = parse(en.value) - parse(st.value); });
  const seg = m.querySelector('[data-seg=kind]');
  seg.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-v]'); if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    m.querySelector('[name=kind]').value = b.dataset.v;
    if (b.dataset.v === 'evento' && !ad.checked && !ad.disabled) { ad.checked = true; ad.dispatchEvent(new Event('change')); }
  });
}

function modalEvent(ev, preset = {}) {
  closePopover();
  openModal(`<h2>${ev ? 'Modifica' : 'Nuovo appuntamento'}</h2>${eventFormHTML(ev, preset)}`, bindEventForm);
}

// ---------- Popup animato sul giorno ----------
let popState = null;
function closePopover(instant) {
  const pop = $('#popover-layer .day-pop');
  document.querySelectorAll('.day.popping').forEach(x => x.classList.remove('popping'));
  if (!pop) { popState = null; return; }
  if (popState) { document.removeEventListener('mousedown', popState.outside, true); popState.onClose && popState.onClose(); }
  popState = null;
  if (instant) { pop.remove(); return; }
  pop.classList.add('closing');
  pop.addEventListener('animationend', () => pop.remove(), { once: true });
}

function openDayPopover(dateKey, opts = {}) {
  closePopover(true);
  const cell = opts.anchor || document.querySelector(`.day[data-date="${dateKey}"]`);
  if (!cell) return;
  const d = parse(dateKey);
  const its = itemsOn(d, { appuntamento: true, evento: true, passo: true });
  const layer = $('#popover-layer');
  const pop = document.createElement('div');
  pop.className = 'day-pop';
  pop.innerHTML = `
    <div class="pop-arrow"></div>
    <div class="pop-body">
    <div class="pop-head">
      <div class="pop-date"><span class="pop-dnum">${d.getDate()}</span><div><div class="pop-wd">${d.toLocaleDateString('it-IT', { weekday: 'long' })}</div><div class="tiny">${d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</div></div></div>
      <button class="icon-btn" data-action="close-all" title="Chiudi (Esc)">${icon('i-close')}</button>
    </div>
    ${its.length ? `<div class="pop-list">${its.map(it => it.ev
      ? `<button class="pop-item" data-action="edit-event" data-id="${it.ev.id}"><i style="background:${esc(groupInfo(it.ev).color)}"></i><span class="grow">${esc(it.ev.title)}</span><span class="tiny">${it.ev.allDay ? 'Giorno' : fmtHM(parse(it.ev.start))}</span></button>`
      : `<button class="pop-item" data-action="sheet" data-kind="st" data-pid="${it.project.id}" data-id="${it.step.id}"><i style="background:${esc(localGroup(it.project).color)}"></i><span class="grow">${esc(it.step.text)}</span><span class="tiny">${fmtHM(parse(it.step.due))}</span></button>`).join('')}
</div>` : ''}
    <div class="pop-label">Nuovo evento</div>
    ${eventFormHTML(null, { date: dateKey, start: opts.start, end: opts.end }, true)}
    </div>`;
  layer.appendChild(pop);
  bindEventForm(pop);

  // posizione: a destra della cella, altrimenti a sinistra; verticalmente centrata e contenuta nella finestra
  const r = cell.getBoundingClientRect();
  const W = pop.offsetWidth, H = Math.min(pop.offsetHeight, window.innerHeight - 24);
  let side = 'right';
  let left = r.right + 14;
  if (left + W > window.innerWidth - 12) { side = 'left'; left = r.left - 14 - W; }
  if (left < 12) { side = 'below'; left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12)); }
  let top = side === 'below' ? r.bottom + 12 : r.top + r.height / 2 - 120;
  top = Math.max(12, Math.min(top, window.innerHeight - H - 12));
  pop.style.left = left + 'px'; pop.style.top = top + 'px'; pop.querySelector('.pop-body').style.maxHeight = (window.innerHeight - 24) + 'px';
  pop.dataset.side = side;
  const ay = Math.max(18, Math.min(r.top + r.height / 2 - top, H - 18));
  const ax = r.left + r.width / 2 - left;
  pop.style.setProperty('--ay', ay + 'px');
  pop.style.setProperty('--ax', ax + 'px');
  pop.style.transformOrigin = side === 'right' ? `0 ${ay}px` : side === 'left' ? `100% ${ay}px` : `${ax}px 0`;
  if (!opts.anchor) cell.classList.add('popping');
  setTimeout(() => pop.querySelector('input[name=title]').focus(), 120);

  const outside = (e) => {
    if (pop.contains(e.target) || e.target.closest('.modal-backdrop')) return;
    if (e.target.closest('.day') || e.target.closest('.tg-col')) return; // un altro giorno o fascia: lo gestisce il clic
    closePopover();
  };
  popState = { outside, date: dateKey, onClose: opts.onClose };
  setTimeout(() => document.addEventListener('mousedown', outside, true));
}
function closeAll() { closeModal(); closePopover(); }

const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
function calShift(dir) {
  const mode = calMode();
  closePopover(true);
  if (mode === 'mese') { ui.month = addMonths(ui.month, dir); }
  else {
    const d = addDays(parse(ui.sel), mode === 'giorno' ? dir : 7 * dir);
    ui.sel = dayKey(d); ui.month = new Date(d.getFullYear(), d.getMonth(), 1);
  }
  render();
}

// mini calendario nella barra laterale (come Notion Calendar)
function renderMiniMonth() {
  const box = $('#side-mini'); if (!box) return;
  if (ui.view !== 'agenda') { box.hidden = true; return; }
  box.hidden = false;
  const sel = parse(ui.sel || dayKey(new Date()));
  if (!ui.mini || ui.miniFor !== ui.sel) { ui.mini = new Date(sel.getFullYear(), sel.getMonth(), 1); ui.miniFor = ui.sel; }
  const m = ui.mini, start = weekStartOf(m), today = new Date();
  const ws = weekStartOf(sel), mode = calMode();
  let rows = '';
  for (let w = 0; w < 6; w++) {
    const wd = addDays(start, w * 7);
    rows += `<span class="mm-wk">${isoWeek(wd)}</span>`;
    for (let i = 0; i < 7; i++) {
      const d = addDays(wd, i);
      const inSel = mode === 'settimana' ? (d >= ws && d < addDays(ws, 7)) : mode === 'giorno' ? sameDay(d, sel) : false;
      const has = itemsOn(d, ui.chips).length > 0;
      rows += `<button class="mm-d ${d.getMonth() !== m.getMonth() ? 'other' : ''} ${sameDay(d, today) ? 'today' : ''} ${inSel ? 'insel' : ''} ${sameDay(d, sel) ? 'sel' : ''} ${has ? 'has' : ''}" data-action="mini-day" data-date="${dayKey(d)}">${d.getDate()}</button>`;
    }
  }
  box.innerHTML = `<div class="mm-head"><b>${fmtMonth(m)}</b><button class="mm-nav" data-action="mini-prev">${icon('i-chev-l')}</button><button class="mm-nav" data-action="mini-next">${icon('i-chev-r')}</button></div>
    <div class="mm-grid"><span class="mm-wk"></span>${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map(x => `<span class="mm-dow">${x}</span>`).join('')}${rows}</div>`;
}

let tgDrag = null;
function initTimeGrid() {
  const body = $('#tg-body'); if (!body) return;
  const startH = data.settings.dayStartHour ?? 7;
  body.scrollTop = ui.tgScroll ?? Math.max(0, startH * HOUR_H - 10);
  body.addEventListener('scroll', () => { ui.tgScroll = body.scrollTop; }, { passive: true });
  const grid = body.querySelector('.tg-grid');
  const colsEls = [...grid.querySelectorAll('.tg-col')];
  const snap = (m) => Math.max(0, Math.min(1440, Math.round(m / 15) * 15));
  const yToMin = (col, y) => (y - col.getBoundingClientRect().top) / HOUR_H * 60;
  const colAt = (x) => colsEls.find(c => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
  const toIso = (dk, m) => { const d = parse(dk); d.setHours(0, m, 0, 0); return iso(d); };

  grid.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const evEl = e.target.closest('.tg-ev');
    const col = e.target.closest('.tg-col');
    if (!col) return;
    e.preventDefault();
    closePopover(true);
    if (evEl) {
      tgDrag = { type: e.target.closest('.tg-rs') ? 'resize' : 'move', el: evEl, x0: e.clientX, y0: e.clientY, s: +evEl.dataset.s, e: +evEl.dataset.e, col0: colsEls.indexOf(col), moved: false };
    } else {
      const m = snap(yToMin(col, e.clientY) - 7);
      const ghost = document.createElement('div');
      ghost.className = 'tg-ghost';
      ghost.style.top = (m / 60 * HOUR_H) + 'px'; ghost.style.height = (HOUR_H / 4) + 'px';
      col.appendChild(ghost);
      tgDrag = { type: 'create', col, m0: m, m1: m + 15, ghost, moved: false, y0: e.clientY };
    }
  });

  const onMove = (e) => {
    const d = tgDrag; if (!d) return;
    if (d.type === 'create') {
      if (Math.abs(e.clientY - d.y0) > 4) d.moved = true;
      const m = snap(yToMin(d.col, e.clientY));
      d.m1 = Math.max(m, d.m0 + 15); const a = Math.min(d.m0, m), b = Math.max(d.m0 + 15, m);
      d.a = a; d.b = b;
      d.ghost.style.top = (a / 60 * HOUR_H) + 'px'; d.ghost.style.height = ((b - a) / 60 * HOUR_H) + 'px';
      d.ghost.textContent = `${pad(Math.floor(a / 60))}:${pad(a % 60)}–${pad(Math.floor(b / 60))}:${pad(b % 60)}`;
      return;
    }
    if (!d.el.classList.contains('editable')) return;
    const dy = e.clientY - d.y0, dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dy) < 4 && Math.abs(dx) < 4) return;
    d.moved = true; d.el.classList.add('dragging');
    const dm = Math.round(dy / HOUR_H * 60 / 15) * 15;
    if (d.type === 'resize') {
      d.ne = Math.max(d.s + 15, Math.min(1440, d.e + dm)); d.ns = d.s;
      d.el.style.height = ((d.ne - d.s) / 60 * HOUR_H - 2) + 'px';
    } else {
      const dur = d.e - d.s;
      d.ns = Math.max(0, Math.min(1440 - dur, d.s + dm)); d.ne = d.ns + dur;
      const c = colAt(e.clientX); const ci = c ? colsEls.indexOf(c) : d.col0;
      d.dday = d.el.dataset.kind === 'ev' || d.el.dataset.kind === 'st' ? ci - d.col0 : 0;
      const cw = colsEls[0].getBoundingClientRect().width;
      d.el.style.transform = `translate(${d.dday * cw}px, ${(d.ns - d.s) / 60 * HOUR_H}px)`;
    }
    d.el.querySelector('.tg-ev-time').textContent = `${pad(Math.floor(d.ns / 60))}:${pad(d.ns % 60)}–${pad(Math.floor(d.ne / 60))}:${pad(d.ne % 60)}`;
  };

  const onUp = () => {
    const d = tgDrag; if (!d) return;
    tgDrag = null;
    if (d.type === 'create') {
      const a = d.moved ? d.a ?? d.m0 : d.m0, b = d.moved ? d.b ?? d.m0 + 60 : Math.min(1440, d.m0 + 60);
      if (!d.moved) { d.ghost.style.height = ((b - a) / 60 * HOUR_H) + 'px'; }
      d.ghost.textContent = `${pad(Math.floor(a / 60))}:${pad(a % 60)}–${pad(Math.floor(b / 60))}:${pad(b % 60)}`;
      const dk = d.col.dataset.date;
      openDayPopover(dk, { anchor: d.ghost, start: toIso(dk, a), end: toIso(dk, b), onClose: () => d.ghost.remove() });
      return;
    }
    const el = d.el;
    if (!d.moved) { // semplice clic: apri
      openSheet(el.dataset.kind === 'ev' ? { kind: 'ev', id: el.dataset.id, occ: el.dataset.date || null } : { kind: 'st', pid: el.dataset.pid, id: el.dataset.id });
      return;
    }
    const dk = dayKey(addDays(parse(el.dataset.date), d.dday || 0));
    if (el.dataset.kind === 'ev') {
      const ev = data.events.find(x => x.id === el.dataset.id);
      const os = parse(ev.start), oe = parse(ev.end || ev.start);
      // mantiene la data di inizio originale se l'evento parte prima del giorno mostrato
      const ns = d.type === 'resize' ? os : (() => { const x = parse(dk); x.setHours(0, d.ns, 0, 0); return x; })();
      const ne = d.type === 'resize' ? (() => { const x = parse(el.dataset.date); x.setHours(0, d.ne, 0, 0); return x; })() : new Date(ns.getTime() + (oe - os));
      ev.start = iso(ns); ev.end = iso(ne); delete ev.notifiedAt;
      const p = proj(ev.projectId); if (p) touch(p);
      toast(ev.source ? `Spostato · aggiorno ${PROV[accOf(ev).provider]}…` : 'Spostato');
    } else {
      const p = proj(el.dataset.pid); const st = p.steps.find(x => x.id === el.dataset.id);
      const x = parse(dk); x.setHours(0, d.ns, 0, 0); st.due = iso(x); delete st.notifiedAt; touch(p);
      toast('Scadenza spostata');
    }
    save(); render();
  };
  if (!initTimeGrid.bound) {
    initTimeGrid.bound = true;
    window.addEventListener('mousemove', onMoveProxy);
    window.addEventListener('mouseup', onUpProxy);
  }
  initTimeGrid.onMove = onMove; initTimeGrid.onUp = onUp;
}
function onMoveProxy(e) { initTimeGrid.onMove && initTimeGrid.onMove(e); }
function onUpProxy(e) { initTimeGrid.onUp && initTimeGrid.onUp(e); }

function modalStep(pid, step) {
  const isNew = !step;
  const s0 = step || { text: '', due: iso(defaultStart()), reminder: 0 };
  openModal(`
    <h2>${isNew ? 'Nuovo promemoria' : 'Modifica passo'}</h2>
    <form class="form" data-submit="save-step" data-id="${step ? step.id : ''}" data-oldpid="${pid || ''}">
      <label class="field"><span>Cosa devi fare</span><input name="text" required value="${esc(s0.text)}" placeholder="Es. Pagare la bolletta"></label>
      <label class="field"><span>Progetto</span>${projSelect(pid || ui.projectId || data.projects.find(p => p.status === 'attivo')?.id)}</label>
      <div class="field-row">
        <label class="field"><span>Scadenza</span><input name="due" type="datetime-local" value="${s0.due || ''}"></label>
        <label class="field"><span>Avvisami</span>${remSelect(s0.reminder)}</label>
      </div>
      <div class="modal-actions">
        ${!isNew ? `<button type="button" class="btn danger left" data-action="del-step" data-pid="${pid}" data-id="${step.id}">${icon('i-trash')} Elimina</button>` : ''}
        <button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">${isNew ? 'Aggiungi' : 'Salva'}</button>
      </div>
    </form>`);
}

function modalTrace(pid, tr) {
  const t0 = tr || { title: '', body: '', at: iso(new Date()) };
  openModal(`
    <h2>${tr ? 'Modifica traccia' : 'Nuova traccia'}</h2>
    <form class="form" data-submit="save-trace" data-pid="${pid}" data-id="${tr ? tr.id : ''}">
      <label class="field"><span>Titolo</span><input name="title" required value="${esc(t0.title)}" placeholder="Es. Prenotazioni confermate"></label>
      <label class="field"><span>Dettagli</span><textarea name="body" rows="5" placeholder="Codici, orari, link, decisioni…">${esc(t0.body)}</textarea></label>
      <label class="field"><span>Data e ora</span><input name="at" type="datetime-local" value="${t0.at}"></label>
      <div class="modal-actions">
        ${tr ? `<button type="button" class="btn danger left" data-action="del-trace" data-pid="${pid}" data-id="${tr.id}">${icon('i-trash')} Elimina</button>` : ''}
        <button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Salva</button>
      </div>
    </form>`);
}

function modalCategory(c) {
  const c0 = c || { name: '', color: '#0a84ff', icon: 'folder' };
  openModal(`
    <h2>${c ? 'Modifica raccolta' : 'Nuova raccolta'}</h2>
    <form class="form" data-submit="save-cat" data-id="${c ? c.id : ''}">
      <label class="field"><span>Nome</span><input name="name" required value="${esc(c0.name)}" placeholder="Es. Palestra"></label>
      <input type="hidden" name="color" value="${hex(c0.color)}"><input type="hidden" name="icon" value="${c0.icon}">
      <div class="field"><span>Colore</span><div class="swatches" data-pick="color">${[...new Set([hex(c0.color), ...SHADES.flatMap(x => x[1].slice(1, 3))])].map(k => `<button type="button" style="background:${k}" class="${k === hex(c0.color) ? 'on' : ''}" data-v="${k}"></button>`).join('')}</div></div>
      <div class="field"><span>Simbolo</span><div class="swatches icons" data-pick="icon">${CAT_ICONS.map(k => `<button type="button" class="${k === c0.icon ? 'on' : ''}" data-v="${k}">${icon('c-' + k)}</button>`).join('')}</div></div>
      <div class="modal-actions">
        ${c ? `<button type="button" class="btn danger left" data-action="del-cat" data-id="${c.id}">${icon('i-trash')} Elimina</button>` : ''}
        <button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Salva</button>
      </div>
    </form>`, (m) => {
      m.querySelectorAll('[data-pick]').forEach(g => g.addEventListener('click', (ev) => {
        const b = ev.target.closest('button[data-v]'); if (!b) return;
        g.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on');
        m.querySelector(`[name=${g.dataset.pick}]`).value = b.dataset.v;
      }));
    });
}

const ACCENTS = [['#e5562a', 'Arancio'], ['#e5484d', 'Rosso'], ['#d6336c', 'Lampone'], ['#7048e8', 'Viola'], ['#0a84ff', 'Blu'], ['#1098ad', 'Turchese'], ['#2b8a3e', 'Verde'], ['#495057', 'Grafite']];
const SET_PANES = [
  ['generale', 'i-home', 'Generale'], ['aspetto', 'i-palette', 'Aspetto'], ['calendario', 'i-calendar', 'Calendario'],
  ['notifiche', 'i-bell', 'Notifiche'], ['sicurezza', 'i-lock', 'Password'], ['blocco', 'i-image', 'Schermata di blocco'], ['dati', 'i-archive', 'Dati e backup'],
];
const segHTML = (key, opts, val) => `<div class="segmented" data-seg-set="${key}">${opts.map(([k, l]) => `<button type="button" class="${String(val) === String(k) ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>`;
const sw = (key, on, attr = 'data-setting') => `<input type="checkbox" class="switch" ${attr}="${key}" ${on ? 'checked' : ''}>`;
const srow = (title, sub, control) => `<div class="set-row"><div class="set-txt"><div>${title}</div>${sub ? `<small>${sub}</small>` : ''}</div><div class="set-ctl">${control}</div></div>`;

function paneHTML(id, ls) {
  const s = data.settings;
  if (id === 'generale') return `<h3>Generale</h3>
    <div class="set-group">
      ${srow('Il tuo nome', 'Usato nel saluto della Home', `<input class="set-input" data-name-in value="${esc(s.userName || '')}" placeholder="Es. Daniele">`)}
      ${srow('Calendario per i nuovi eventi', 'Dove salvare ciò che crei', `<select class="set-select" data-def-cal>${calendarSelect(null).replace(/^<select name="calendar">|<\/select>$/g, '')}</select>`)}
    </div>
    <div class="set-group">${srow('Scorciatoie', 'Ctrl+K palette · Ctrl+N nuovo · Ctrl+F cerca · Ctrl+1…5 sezioni', '')}</div>`;
  if (id === 'aspetto') return `<h3>Aspetto</h3>
    <div class="set-group">
      ${srow('Tema', '', segHTML('theme', [['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']], s.theme))}
      ${srow('Colore principale', 'Pulsanti, evidenziazioni e oggi', `<div class="acc-sw">${ACCENTS.map(([c, n]) => `<button type="button" title="${n}" data-accent="${c}" class="${(s.accent || '#e5562a') === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div>`)}
    </div>`;
  if (id === 'calendario') return `<h3>Calendario</h3>
    <div class="set-group">
      ${srow('Vista predefinita dell\'agenda', '', segHTML('calMode', [['giorno', 'Giorno'], ['settimana', 'Settimana'], ['mese', 'Mese']], s.calMode || 'settimana'))}
      ${srow('Inizio della giornata', 'Ora mostrata in alto quando apri la settimana', `<select class="set-select" data-num="dayStartHour">${[...Array(13)].map((_, h) => `<option value="${h}" ${(s.dayStartHour ?? 7) === h ? 'selected' : ''}>${pad(h)}:00</option>`).join('')}</select>`)}
      ${srow('Mostra il fine settimana', 'Nella vista Settimana', sw('showWeekend', !s.hideWeekend, 'data-inv'))}
    </div>`;
  if (id === 'notifiche') return `<h3>Notifiche</h3>
    <div class="set-group">
      ${srow('Notifiche desktop', 'Avvisi all\'orario dei promemoria', sw('notifications', s.notifications))}
      ${srow('Resta attiva nell\'area di notifica', 'Chiudendo la finestra Promemo continua a ricordarti gli impegni', sw('closeToTray', s.closeToTray))}
      ${srow('Avvia all\'accesso', lockInfo.configured ? 'Con la password attiva si apre la schermata di blocco' : 'Parte in background quando entri nel desktop', sw('autostart', s.autostart))}
    </div>
    <div class="set-group">${srow('Prova', 'Invia una notifica di esempio', `<button class="btn small" data-action="test-notif">${icon('i-bell')} Prova notifica</button>`)}</div>`;
  if (id === 'sicurezza') return `<h3>Password</h3>
    <div class="set-group">
      ${srow('Password all\'avvio', lockInfo.configured ? 'Attiva · dati e credenziali cifrati con AES-256 su questo computer' : 'Non attiva · chiunque usi il PC può aprire Promemo', lockInfo.configured ? '<button class="btn small" data-action="pw-change">Cambia</button><button class="btn small danger" data-action="pw-remove">Disattiva</button>' : '<button class="btn-primary small-p" data-action="pw-setup">Attiva</button>')}
      ${lockInfo.configured ? srow('Suggerimento', lockInfo.hint ? esc(lockInfo.hint) : 'Nessuno', '<button class="btn small" data-action="pw-change">Modifica</button>') : ''}
    </div>
    <p class="set-note">Se dimentichi la password puoi entrare con la chiave di recupero mostrata all'attivazione.</p>`;
  if (id === 'dati') return `<h3>Dati e backup</h3>
    <div class="set-group">
      ${srow('Esporta un backup', lockInfo.configured ? 'File JSON non cifrato: conservalo con cura' : 'Tutti i progetti, eventi e impostazioni in un file JSON', '<button class="btn small" data-action="export">Esporta…</button>')}
      ${srow('Importa un backup', 'Sostituisce i dati attuali (gli account collegati restano)', '<button class="btn small" data-action="import">Importa…</button>')}
      ${srow('Cartella dei dati', '~/.config/Promemo', '<button class="btn small" data-action="folder">Apri</button>')}
    </div>`;
  if (id === 'blocco') {
    const c = { ...LS_DEF, ...ls };
    const palettes = Object.entries(LS_PALETTES).map(([k, p]) => { const cs = p.c || c.colors; return `<button type="button" class="pal-tile ${c.palette === k ? 'on' : ''}" data-ls-pal="${k}"><span style="background:${p.base || '#f3f2ef'}"><i style="background:${cs[0]}"></i><i style="background:${cs[1]}"></i><i style="background:${cs[2]}"></i></span>${p.name}</button>`; }).join('');
    return `<h3>Schermata di blocco</h3>
    ${lockInfo.configured ? '' : `<div class="set-banner">${icon('i-lock')} La schermata compare all'avvio solo con la password attiva. <button class="link" data-action="pw-setup">Attiva la password</button></div>`}
    <div class="ls-prev-wrap"><div class="ls-prev" id="ls-prev"></div><button class="btn small ls-full" data-action="ls-preview">${icon('i-eye')} Anteprima a schermo intero</button></div>
    <div class="set-group">
      ${srow('Sfondo', '', segHTML('ls.bg', [['aurora', 'Aurora'], ['tinta', 'Tinta unita'], ['immagine', 'Immagine']], c.bg))}
      ${c.bg === 'aurora' ? `<div class="set-sub"><div class="pal-grid">${palettes}</div>
        ${c.palette === 'personalizzato' ? `<div class="row" style="gap:10px;margin-top:10px">${c.colors.map((x, i) => `<label class="color-pick"><input type="color" value="${x}" data-ls-color="${i}"><span>Colore ${i + 1}</span></label>`).join('')}</div>` : ''}
        ${srow('Movimento lento dello sfondo', '', sw('animate', c.animate, 'data-ls-bool'))}</div>` : ''}
      ${c.bg === 'tinta' ? `<div class="set-sub"><div class="row" style="gap:8px;flex-wrap:wrap">${['#f3f2ef', '#ffffff', '#e7f5ff', '#fff4e6', '#1c1c1e', '#0b0f24', '#1b4332', '#5f3dc4', '#c92a2a'].map(x => `<button type="button" class="dot-sw ${c.solid === x ? 'on' : ''}" data-ls-solid="${x}" style="background:${x}"></button>`).join('')}<label class="color-pick"><input type="color" value="${c.solid}" data-ls-solid-in><span>Altro</span></label></div></div>` : ''}
      ${c.bg === 'immagine' ? `<div class="set-sub">
        <div class="row" style="gap:8px">${c.imageData ? `<img class="ls-thumb" src="${c.imageData}" alt="">` : '<span class="muted">Nessuna immagine scelta</span>'}<span class="grow"></span><button class="btn small" data-action="ls-image">Scegli immagine…</button>${c.imageData ? '<button class="btn small danger" data-action="ls-image-clear">Rimuovi</button>' : ''}</div>
        ${srow('Sfocatura', `${c.blur} px`, `<input type="range" min="0" max="40" value="${c.blur}" data-ls-range="blur">`)}
        ${srow('Oscuramento', `${c.dim}%`, `<input type="range" min="0" max="80" value="${c.dim}" data-ls-range="dim">`)}
      </div>` : ''}
    </div>
    <div class="set-group">
      ${srow('Orologio', '', sw('clock', c.clock, 'data-ls-bool'))}
      ${c.clock ? srow('Stile dell\'orologio', '', segHTML('ls.clockWeight', [['300', 'Sottile'], ['500', 'Normale'], ['700', 'Marcato'], ['800', 'Pesante']], c.clockWeight)) : ''}
      ${c.clock ? srow('Dimensione', `${c.clockSize} px`, `<input type="range" min="48" max="140" value="${c.clockSize}" data-ls-range="clockSize">`) : ''}
      ${srow('Data', '', sw('date', c.date, 'data-ls-bool'))}
    </div>
    <div class="set-group">
      ${srow('Titolo', 'Al posto di “Promemo”', `<input class="set-input" data-ls-text="welcome" maxlength="60" value="${esc(c.welcome)}" placeholder="Es. Bentornato, Daniele">`)}
      ${srow('Sottotitolo', '', `<input class="set-input" data-ls-text="subtitle" maxlength="90" value="${esc(c.subtitle)}" placeholder="Inserisci la password per sbloccare">`)}
      ${srow('Icona dell\'app', '', sw('icon', c.icon, 'data-ls-bool'))}
      ${srow('Mostra il suggerimento della password', '', sw('showHint', c.showHint, 'data-ls-bool'))}
    </div>
    <div class="set-group">
      ${srow('Riquadro', '', segHTML('ls.card', [['vetro', 'Vetro'], ['solido', 'Pieno'], ['minimale', 'Minimale']], c.card))}
      ${srow('Colore del testo', '', segHTML('ls.text', [['auto', 'Automatico'], ['scuro', 'Scuro'], ['chiaro', 'Chiaro']], c.text))}
    </div>
    <div class="set-foot"><span class="set-note">Tutto ciò che scrivi qui è visibile prima dello sblocco: evita informazioni riservate.</span><button class="btn small" data-action="ls-reset">Ripristina predefiniti</button></div>`;
  }
  return '';
}

let setPane = 'generale', lsCfg = null;
async function modalSettings(pane) {
  if (pane) setPane = pane;
  lsCfg = await api.lsGet();
  openModal(`<div class="set-win">
      <nav class="set-nav">${SET_PANES.map(([k, ic, l]) => `<button class="set-nav-i ${setPane === k ? 'on' : ''}" data-pane="${k}">${icon(ic)}${l}</button>`).join('')}</nav>
      <div class="set-main"><div class="set-pane" id="set-pane"></div><div class="set-close"><button class="btn-primary" data-action="close-modal">Fine</button></div></div>
    </div>`, (m) => {
      m.classList.add('modal-settings');
      m.querySelector('.set-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-pane]'); if (!b) return; setPane = b.dataset.pane; m.querySelectorAll('.set-nav-i').forEach(x => x.classList.toggle('on', x === b)); drawPane(m); });
      drawPane(m);
    });
}

function drawPane(m) {
  const box = m.querySelector('#set-pane');
  const keep = box.scrollTop;
  box.innerHTML = paneHTML(setPane, lsCfg);
  box.scrollTop = keep;
  const s = data.settings;
  const prev = box.querySelector('#ls-prev');
  if (prev) requestAnimationFrame(() => renderLockPreview(prev, lsCfg));
  const lsPatch = async (patch, redraw = false) => {
    Object.assign(lsCfg, patch);
    if (prev) renderLockPreview(prev, lsCfg);
    clearTimeout(lsPatch.t);
    lsPatch.t = setTimeout(async () => { const r = await api.lsSet(Object.fromEntries(Object.entries(lsCfg).filter(([k]) => k !== 'imageData'))); if (r) { lsCfg = r; lockInfo.lockscreen = r; } }, 250);
    if (redraw) drawPane(m);
  };
  box.querySelectorAll('[data-seg-set]').forEach(g => g.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    const key = g.dataset.segSet, v = b.dataset.v;
    g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (key === 'theme') { s.theme = v; applyTheme(); save(); }
    else if (key === 'calMode') { s.calMode = v; ui.calMode = v; save(); render(); }
    else if (key.startsWith('ls.')) { const k = key.slice(3); lsPatch({ [k]: k === 'clockWeight' ? +v : v }, k === 'bg' || k === 'clock'); }
  }));
  box.querySelectorAll('[data-accent]').forEach(b => b.addEventListener('click', () => { s.accent = b.dataset.accent; applyTheme(); save(); box.querySelectorAll('[data-accent]').forEach(x => x.classList.toggle('on', x === b)); }));
  box.querySelector('[data-name-in]')?.addEventListener('input', (e) => { s.userName = e.target.value; save(); });
  box.querySelector('[data-def-cal]')?.addEventListener('change', (e) => { s.defaultCalendar = e.target.value; save(); });
  box.querySelectorAll('[data-num]').forEach(x => x.addEventListener('change', () => { s[x.dataset.num] = +x.value; ui.tgScroll = null; save(); }));
  box.querySelectorAll('[data-setting]').forEach(inp => inp.addEventListener('change', () => { s[inp.dataset.setting] = inp.checked; save(); }));
  box.querySelectorAll('[data-inv]').forEach(inp => inp.addEventListener('change', () => { s.hideWeekend = !inp.checked; save(); render(); }));
  box.querySelectorAll('[data-ls-pal]').forEach(b => b.addEventListener('click', () => lsPatch({ palette: b.dataset.lsPal }, true)));
  box.querySelectorAll('[data-ls-color]').forEach(inp => inp.addEventListener('input', () => { const cs = [...lsCfg.colors]; cs[+inp.dataset.lsColor] = inp.value; lsPatch({ colors: cs }); }));
  box.querySelectorAll('[data-ls-solid]').forEach(b => b.addEventListener('click', () => lsPatch({ solid: b.dataset.lsSolid }, true)));
  box.querySelector('[data-ls-solid-in]')?.addEventListener('input', (e) => lsPatch({ solid: e.target.value }));
  box.querySelectorAll('[data-ls-bool]').forEach(inp => inp.addEventListener('change', () => lsPatch({ [inp.dataset.lsBool]: inp.checked }, inp.dataset.lsBool === 'clock')));
  box.querySelectorAll('[data-ls-range]').forEach(inp => inp.addEventListener('input', () => { lsPatch({ [inp.dataset.lsRange]: +inp.value }); const sm = inp.closest('.set-row').querySelector('small'); if (sm) sm.textContent = inp.value + (inp.dataset.lsRange === 'dim' ? '%' : ' px'); }));
  box.querySelectorAll('[data-ls-text]').forEach(inp => inp.addEventListener('input', () => lsPatch({ [inp.dataset.lsText]: inp.value })));
}

function applyTheme() {
  const t = data.settings.theme;
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  const a = data.settings.accent;
  if (a && a !== '#e5562a') {
    root.style.setProperty('--accent', a);
    root.style.setProperty('--accent-soft', `color-mix(in srgb, ${a} 14%, transparent)`);
    root.style.setProperty('--accent-ink', `color-mix(in srgb, ${a} 78%, var(--text))`);
  } else ['--accent', '--accent-soft', '--accent-ink'].forEach(k => root.style.removeProperty(k));
}

function showMenu(anchor, items) {
  const layer = $('#popover-layer');
  const r = anchor.getBoundingClientRect();
  layer.innerHTML = `<div class="menu">${items.map(it => it === '-' ? '<hr>' : `<button class="${it.danger ? 'danger' : ''}" data-mi="${it.id}">${icon(it.icon)} ${it.label}</button>`).join('')}</div>`;
  const m = layer.firstChild;
  m.style.top = (r.bottom + 6) + 'px';
  m.style.left = Math.min(r.right - 210, window.innerWidth - 220) + 'px';
  const close = () => { layer.innerHTML = ''; document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!m.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-mi]'); if (!b) return; close(); items.find(i => i.id === b.dataset.mi).run(); });
}

// ---------- Azioni ----------
function findStep(pid, id) { const p = proj(pid); return [p, p?.steps.find(s => s.id === id)]; }

const actions = {
  nav: (el) => go(el.dataset.view, el.dataset.view === 'progetti' ? { catFilter: null } : {}),
  cat: (el) => go('progetti', { catFilter: el.dataset.id, projFilter: 'attivi' }),
  'clear-cat': () => go('progetti', { catFilter: null }),
  'new-cat': () => modalCategory(),
  'edit-cat': (el) => modalCategory(cat(el.dataset.id)),
  'del-cat': (el) => {
    const id = el.dataset.id;
    data.categories = data.categories.filter(c => c.id !== id);
    data.projects.forEach(p => { if (p.category === id) p.category = ''; });
    ui.catFilter = null; save(); closeModal(); render(); toast('Raccolta eliminata');
  },
  'open-project': (el) => closePopover(true) || go('progetti', { projectId: el.dataset.id, projFilter: proj(el.dataset.id)?.status === 'archiviato' ? 'archivio' : (ui.view === 'progetti' ? ui.projFilter : 'attivi'), catFilter: ui.view === 'progetti' ? ui.catFilter : null }),
  'proj-filter': (el) => { ui.projFilter = el.dataset.f; ui.projectId = null; render(); },
  'toggle-star': (el) => { const p = proj(el.dataset.id); p.starred = !p.starred; save(); render(); },
  'proj-menu': (el) => {
    const p = proj(el.dataset.id);
    showMenu(el, [
      { id: 'tr', icon: 'i-note', label: 'Aggiungi traccia', run: () => modalTrace(p.id) },
      { id: 'ev', icon: 'i-calendar', label: 'Aggiungi appuntamento', run: () => modalEvent(null, { pid: p.id }) },
      '-',
      p.status === 'attivo'
        ? { id: 'pa', icon: 'i-clock', label: 'Metti in pausa', run: () => { p.status = 'in pausa'; touch(p); save(); render(); } }
        : { id: 'ac', icon: 'i-check', label: 'Riattiva', run: () => { p.status = 'attivo'; touch(p); ui.projFilter = 'attivi'; save(); render(); } },
      p.status !== 'archiviato' && { id: 'ar', icon: 'i-archive', label: 'Archivia', run: () => { p.status = 'archiviato'; save(); render(); toast('Progetto archiviato'); } },
      '-',
      { id: 'del', icon: 'i-trash', label: 'Elimina progetto', danger: true, run: () => {
        openModal(`<h2>Eliminare “${esc(p.title)}”?</h2><p class="muted">Verranno eliminati anche passi, tracce e appuntamenti collegati. Non si può annullare.</p>
          <div class="modal-actions"><button class="btn" data-action="close-modal">Annulla</button><button class="btn-primary" style="background:#e0352b" data-action="confirm-del-project" data-id="${p.id}">Elimina</button></div>`);
      } },
    ].filter(Boolean));
  },
  'confirm-del-project': (el) => {
    const id = el.dataset.id;
    data.projects = data.projects.filter(p => p.id !== id);
    data.events = data.events.filter(e => e.projectId !== id);
    ui.projectId = null; save(); closeModal(); render(); toast('Progetto eliminato');
  },
  'toggle-step': (el) => { const [p, s] = findStep(el.dataset.pid, el.dataset.id); s.done = !s.done; s.doneAt = s.done ? iso(new Date()) : null; touch(p); save(); render(); },
  'complete-step': (el, ev) => {
    ev.stopPropagation();
    const [p, s] = findStep(el.dataset.pid, el.dataset.id);
    s.done = true; s.doneAt = iso(new Date());
    p.traces.push({ id: uid(), title: `Fatto: ${s.text}`, body: '', at: iso(new Date()) });
    touch(p); save(); render(); toast('Passo completato');
  },
  'del-step': (el) => { const p = proj(el.dataset.pid); p.steps = p.steps.filter(s => s.id !== el.dataset.id); touch(p); save(); closeModal(); render(); },
  'edit-step': (el) => { const [, s] = findStep(el.dataset.pid, el.dataset.id); modalStep(el.dataset.pid, s); },
  'new-step': (el) => modalStep(el.dataset.pid || null),
  'new-trace': (el) => modalTrace(el.dataset.pid),
  'edit-trace': (el) => { const p = proj(el.dataset.pid); modalTrace(p.id, p.traces.find(t => t.id === el.dataset.id)); },
  'del-trace': (el) => { const p = proj(el.dataset.pid); p.traces = p.traces.filter(t => t.id !== el.dataset.id); save(); closeModal(); render(); },
  'new-project': () => modalProject(),
  'new-event': (el) => modalEvent(null, { pid: el.dataset.pid, date: el.dataset.date || (ui.view === 'agenda' ? ui.sel : null) }),
  'edit-event': (el) => { closePopover(true); modalEvent(data.events.find(e => e.id === el.dataset.id)); },
  'del-event': (el) => {
    const e = data.events.find(x => x.id === el.dataset.id);
    data.events = data.events.filter(x => x !== e);
    save(); closeAll(); render();
    toast(e && e.source && !isReadOnly(e) ? `Eliminato anche da ${PROV[accOf(e).provider]}` : e && isReadOnly(e) ? 'Nascosto: tornerà alla prossima sincronizzazione se esiste ancora' : 'Eliminato');
  },
  'goto-agenda': (el) => { const d = parse(el.dataset.date); go('agenda', { sel: el.dataset.date, month: new Date(d.getFullYear(), d.getMonth(), 1) }); },
  'sel-day': (el) => {
    const k = el.dataset.date;
    if (popState && popState.date === k) { closePopover(); return; }
    ui.sel = k; const d = parse(k);
    if (d.getMonth() !== ui.month.getMonth()) ui.month = new Date(d.getFullYear(), d.getMonth(), 1);
    closePopover(true); render(); openDayPopover(k);
  },
  'close-all': () => closeAll(),
  'pw-change': () => modalNewPassword(false),
  'ls-preview': async () => { const st = await api.lockState(); closeModal(); showLock({ ...st, lockscreen: lsCfg }, true); },
  'ls-image': async () => { const r = await api.lsImage(); if (r && r.error) return toast(r.error); if (r) { lsCfg = r; lockInfo.lockscreen = r; const m = $('#modal'); if (m.classList.contains('modal-settings')) drawPane(m); } },
  'ls-image-clear': async () => { const r = await api.lsImageClear(); if (r) { lsCfg = r; lockInfo.lockscreen = r; drawPane($('#modal')); } },
  'ls-reset': async () => { const r = await api.lsReset(); if (r) { lsCfg = r; lockInfo.lockscreen = r; drawPane($('#modal')); toast('Schermata ripristinata'); } },
  'pw-remove': () => modalRemovePassword(),
  'pw-setup': () => { closeModal(); showSetup(true); },
  palette: () => openPalette(),
  'grp-toggle': (el) => { const row = el.closest('.cal-row'); setGroup(el, { visible: row.classList.contains('off') }); },
  'grp-color': (el) => showColorPicker(el, currentGroupColor(el), (c) => setGroup(el, { color: c })),
  'acc-collapse': (el) => { const k = el.dataset.key; collapsed[k] = !collapsed[k]; try { localStorage.setItem('promemo.collapsed', JSON.stringify(collapsed)); } catch {} el.closest('.cal-acc').classList.toggle('collapsed', !!collapsed[k]); },
  'notion-color': (el) => modalNotionColor(el.dataset.id),
  'open-url': (el) => api.openUrl(el.dataset.url),
  'sync-now': async () => { const r = await api.syncNow(); if (!r.ok) toast(r.error); },
  'cal-prev': () => calShift(-1),
  'cal-next': () => calShift(1),
  'cal-today': () => { const t = new Date(); ui.month = new Date(t.getFullYear(), t.getMonth(), 1); ui.sel = dayKey(t); ui.tgScroll = null; render(); },
  'cal-mode': (el) => { ui.calMode = el.dataset.m; data.settings.calMode = el.dataset.m; save(); const d = parse(ui.sel); ui.month = new Date(d.getFullYear(), d.getMonth(), 1); closePopover(true); render(); },
  'cal-day': (el) => { ui.sel = el.dataset.date; ui.calMode = 'giorno'; render(); },
  'mini-day': (el) => { ui.sel = el.dataset.date; const d = parse(ui.sel); ui.month = new Date(d.getFullYear(), d.getMonth(), 1); if (ui.view !== 'agenda') go('agenda'); else render(); },
  'mini-prev': () => { ui.mini = addMonths(ui.mini, -1); renderMiniMonth(); },
  'mini-next': () => { ui.mini = addMonths(ui.mini, 1); renderMiniMonth(); },
  chip: (el) => { ui.chips[el.dataset.k] = !ui.chips[el.dataset.k]; render(); },
  'close-modal': () => closeModal(),
  'test-notif': () => api.testNotification(),
  export: async () => { if (await api.exportData()) toast(lockInfo.configured ? 'Backup esportato (il file non è cifrato: conservalo con cura)' : 'Backup esportato'); },
  import: async () => {
    try { const d = await api.importData(); if (d) { data = d; closeModal(); applyTheme(); render(); toast('Dati importati'); } }
    catch (e) { toast('File non valido'); }
  },
  folder: () => api.openFolder(),
  'add-google': () => modalGoogle(),
  'add-notion': () => modalNotion(),
  'add-ics': () => modalIcs(),
  'add-calendly': () => modalCalendly(),
  'acc-sync': async (el) => { const r = await api.syncNow(el.dataset.id); if (!r.ok) toast(r.error); },
  'acc-menu': (el) => {
    const a = data.accounts.find(x => x.id === el.dataset.id);
    showMenu(el, [
      { id: 'keep', icon: 'i-archive', label: 'Disconnetti, tieni gli eventi', run: async () => { await api.removeAccount({ id: a.id, removeEvents: false }); toast('Account disconnesso'); } },
      { id: 'drop', icon: 'i-trash', label: 'Disconnetti e rimuovi eventi', danger: true, run: async () => { await api.removeAccount({ id: a.id, removeEvents: true }); toast('Account e eventi rimossi'); } },
    ]);
  },
};

const submits = {
  'pw-change': async (f, fd) => {
    if (fd.get('next') !== fd.get('next2')) return showErr(f, 'Le due password non coincidono.');
    setBusy(f, true, 'Salvo…');
    const r = await api.lockChange({ current: fd.get('current') || '', next: fd.get('next'), hint: fd.get('hint') });
    setBusy(f, false);
    if (!r.ok) return showErr(f, r.error);
    lockInfo = await api.lockState(); closeModal(); toast('Password aggiornata'); if (setPane === 'sicurezza' && !f.closest('.lock')) modalSettings('sicurezza');
  },
  'pw-remove': async (f, fd) => {
    setBusy(f, true, 'Decifro…');
    const r = await api.lockRemove({ current: fd.get('current') });
    setBusy(f, false);
    if (!r.ok) return showErr(f, r.error);
    lockInfo = await api.lockState(); closeModal(); toast('Password disattivata'); modalSettings('sicurezza');
  },
  'connect-google': async (f, fd) => {
    showErr(f); setBusy(f, true, 'Completa l’accesso nel browser…');
    const r = await api.google({ clientId: fd.get('clientId').trim(), clientSecret: fd.get('clientSecret').trim() });
    setBusy(f, false);
    if (!r.ok) return showErr(f, r.error);
    closeModal(); go('account'); toast('Google Calendar collegato');
  },
  'inspect-notion': async (f, fd) => {
    showErr(f);
    const map = f.querySelector('.notion-map');
    if (!map.hidden) { // secondo passaggio: collega
      setBusy(f, true, 'Collegamento…');
      const r = await api.notion({ token: (fd.get('token') || '').trim(), fromAcc: fd.get('fromAcc') || '', databaseId: f.dataset.db, title: f.dataset.title, titleProp: fd.get('titleProp'), dateProp: fd.get('dateProp'), locProp: fd.get('locProp'), notesProp: fd.get('notesProp'), colorProp: fd.get('colorProp') });
      setBusy(f, false);
      if (!r.ok) return showErr(f, r.error);
      closeModal(); if (ui.view !== 'notion') go('account'); else render(); toast(`“${f.dataset.title}” ora è in Agenda`); return;
    }
    setBusy(f, true, 'Verifica…');
    const r = await api.notionInspect({ token: (fd.get('token') || '').trim(), fromAcc: fd.get('fromAcc') || '', database: fd.get('database').trim() });
    setBusy(f, false);
    if (!r.ok) return showErr(f, r.error);
    const { id, title, props } = r.value;
    const of = (types) => props.filter(p => types.includes(p.type));
    const dates = of(['date']);
    if (!dates.length) return showErr(f, `Il database “${title}” non ha proprietà di tipo Data.`);
    const opt = (list, empty) => (empty ? `<option value="">${empty}</option>` : '') + list.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
    f.dataset.db = id; f.dataset.title = title;
    map.hidden = false;
    map.innerHTML = `
      <div class="note-ok">${icon('i-check')} Database trovato: <b>${esc(title)}</b>. Scegli quali colonne usare:</div>
      <div class="field-row">
        <label class="field"><span>Titolo</span><select name="titleProp">${opt(of(['title']))}</select></label>
        <label class="field"><span>Data</span><select name="dateProp">${opt(dates)}</select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Luogo</span><select name="locProp">${opt(of(['rich_text', 'select', 'place']), 'Nessuno')}</select></label>
        <label class="field"><span>Note</span><select name="notesProp">${opt(of(['rich_text']), 'Nessuna')}</select></label>
      </div>
      <label class="field"><span>Colori da (Seleziona / Stato)</span><select name="colorProp">${opt(of(['select', 'multi_select', 'status']), 'Nessuna, un solo colore')}</select></label>`;
    f.querySelectorAll('[name=token],[name=database]').forEach(i => i.readOnly = true);
    f.querySelector('[name=fromAcc]') && (f.querySelector('[name=fromAcc]').disabled = false, f.querySelector('[name=fromAcc]').style.pointerEvents = 'none');
    f.querySelector('.btn-primary').textContent = 'Collega database';
  },
  'connect-calendly': async (f, fd) => {
    showErr(f); setBusy(f, true, 'Verifica…');
    const r = await api.calendly({ token: fd.get('token').trim(), dedupe: fd.get('dedupe') === 'on' });
    setBusy(f, false);
    if (!r.ok) return showErr(f, r.error);
    closeModal(); go('account'); toast('Calendly collegato');
  },
  'connect-ics': async (f, fd) => {
    showErr(f); setBusy(f, true, 'Scarico il calendario…');
    const r = await api.ics({ url: fd.get('url').trim(), name: fd.get('name').trim(), color: fd.get('color') });
    setBusy(f, false);
    if (!r.ok) return showErr(f, r.error);
    closeModal(); go('account'); toast('Calendario aggiunto');
  },
  'save-project': (f, fd) => {
    const now = iso(new Date());
    const p = { id: uid(), title: fd.get('title').trim(), description: fd.get('description').trim(), category: fd.get('category'), starred: false, status: 'attivo', createdAt: now, updatedAt: now, steps: [], traces: [] };
    if (fd.get('step').trim()) p.steps.push({ id: uid(), text: fd.get('step').trim(), due: null, reminder: null, done: false });
    data.projects.push(p);
    save(); closeModal(); go('progetti', { projectId: p.id, projFilter: 'attivi', catFilter: ui.catFilter && p.category === ui.catFilter ? ui.catFilter : null });
  },
  'save-event': (f, fd) => {
    const cur = f.dataset.id && data.events.find(x => x.id === f.dataset.id);
    if (cur && isReadOnly(cur)) {
      Object.assign(cur, { kind: fd.get('kind'), projectId: fd.get('projectId'), reminder: readRem(fd.get('reminder')) });
      delete cur.notifiedAt; save(); closeAll(); render(); toast('Salvato'); return;
    }
    const allDay = fd.get('allDay') === 'on';
    let start = fd.get('start'), end = fd.get('end') || start;
    if (parse(end) < parse(start)) end = start;
    const obj = { title: fd.get('title').trim(), kind: fd.get('kind'), projectId: fd.get('projectId'), allDay,
      start: allDay ? start.slice(0, 10) + 'T00:00' : start, end: allDay ? end.slice(0, 10) + 'T23:59' : end,
      location: fd.get('location').trim(), reminder: readRem(fd.get('reminder')), notes: fd.get('notes').trim(), rrule: readRepeat(fd) };
    if (obj.rrule && cur && cur.rrule && cur.rrule.exdates) obj.rrule.exdates = cur.rrule.exdates;
    if (!obj.rrule) delete obj.rrule;
    if (f.dataset.id) {
      const e = data.events.find(x => x.id === f.dataset.id);
      if (e.start !== obj.start || e.reminder !== obj.reminder) delete e.notifiedAt;
      if (!obj.rrule) delete e.rrule;
      Object.assign(e, obj);
      const cv = fd.get('calendar');
      if (!e.source) { if (cv) { const [acc, ...c] = cv.split('|'); e.pushTo = { acc, cal: c.join('|') }; } else delete e.pushTo; }
    } else {
      const ne = { id: uid(), ...obj };
      const cv = fd.get('calendar');
      if (cv) { const [acc, ...c] = cv.split('|'); ne.pushTo = { acc, cal: c.join('|') }; }
      data.events.push(ne);
    }
    const p = proj(obj.projectId); if (p) touch(p);
    const target = fd.get('calendar') ? (data.accounts || []).find(a => a.id === fd.get('calendar').split('|')[0]) : (cur && cur.source ? accOf(cur) : null);
    save(); closeAll(); render(); toast(target ? `Salvato · invio a ${PROV[target.provider]}…` : 'Salvato');
  },
  'save-step': (f, fd) => {
    const pid = fd.get('projectId');
    let p = proj(pid);
    if (!p) { // senza progetto: uso/creo il progetto "Promemoria sparsi"
      p = data.projects.find(x => x.title === 'Promemoria sparsi' && x.status !== 'archiviato');
      if (!p) { const now = iso(new Date()); p = { id: uid(), title: 'Promemoria sparsi', description: 'Cose da ricordare non legate a un progetto.', category: '', starred: false, status: 'attivo', createdAt: now, updatedAt: now, steps: [], traces: [] }; data.projects.push(p); }
    }
    const obj = { text: fd.get('text').trim(), due: fd.get('due') || null, reminder: readRem(fd.get('reminder')) };
    if (obj.reminder !== null && !obj.due) obj.reminder = null;
    if (f.dataset.id) {
      const oldP = proj(f.dataset.oldpid);
      const s = oldP.steps.find(x => x.id === f.dataset.id);
      if (s.due !== obj.due || s.reminder !== obj.reminder) delete s.notifiedAt;
      Object.assign(s, obj);
      if (oldP !== p) { oldP.steps = oldP.steps.filter(x => x !== s); p.steps.push(s); }
    } else p.steps.push({ id: uid(), ...obj, done: false });
    touch(p); save(); closeModal(); render(); toast('Salvato');
  },
  'add-step': (f, fd) => {
    const text = fd.get('text').trim(); if (!text) return;
    const p = proj(f.dataset.pid);
    p.steps.push({ id: uid(), text, due: null, reminder: null, done: false });
    touch(p); save(); render();
    $('#view [data-submit="add-step"] input')?.focus();
  },
  'save-trace': (f, fd) => {
    const p = proj(f.dataset.pid);
    const obj = { title: fd.get('title').trim(), body: fd.get('body').trim(), at: fd.get('at') || iso(new Date()) };
    if (f.dataset.id) Object.assign(p.traces.find(t => t.id === f.dataset.id), obj);
    else p.traces.push({ id: uid(), ...obj });
    touch(p); save(); closeModal(); render();
  },
  'save-cat': (f, fd) => {
    const obj = { name: fd.get('name').trim(), color: fd.get('color'), icon: fd.get('icon') };
    if (f.dataset.id) Object.assign(cat(f.dataset.id), obj);
    else data.categories.push({ id: uid(), ...obj });
    save(); closeModal(); render();
  },
};

// ---------- Eventi DOM ----------
document.addEventListener('click', (e) => {
  if (!data && !e.target.closest('#lock')) return;
  const w = e.target.closest('[data-win]');
  if (w) { api[w.dataset.win](); return; }
  const a = e.target.closest('[data-action]');
  if (!a) return;
  if (a.tagName === 'BUTTON' && a.closest('form') && a.type !== 'button') return;
  const fn = actions[a.dataset.action];
  if (fn) { if (a.closest('.card') && a !== a.closest('.card')) e.stopPropagation(); fn(a, e); }
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-submit]'); if (!f) return;
  e.preventDefault();
  submits[f.dataset.submit](f, new FormData(f));
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.accDedupe) { await api.updateAccount({ id: t.dataset.accDedupe, patch: { dedupe: t.checked } }); return; }
  if (t.dataset.accToggle) { await api.updateAccount({ id: t.dataset.accToggle, patch: { enabled: t.checked } }); return; }
  if (t.dataset.calToggle) { await api.updateAccount({ id: t.dataset.calToggle, patch: { calendars: [{ id: t.dataset.cal, enabled: t.checked }] } }); return; }
  if ('accRem' in t.dataset) { await api.updateAccount({ id: t.dataset.accRem, patch: { defaultReminder: t.value === '' ? null : Number(t.value) } }); return; }
  const el = e.target.closest('[data-change="proj-cat"]');
  if (el) { const p = proj(el.dataset.id); p.category = el.value; touch(p); save(); render(); }
});
// modifica in linea titolo / descrizione progetto
document.addEventListener('focusout', (e) => {
  const el = e.target.closest('[data-edit]'); if (!el) return;
  const p = proj(el.dataset.id); if (!p) return;
  const v = el.innerText.trim();
  if (el.dataset.edit === 'proj-title') { if (v && v !== p.title) { p.title = v; touch(p); save(); render(); } else el.innerText = p.title; }
  if (el.dataset.edit === 'proj-desc' && v !== p.description) { p.description = v; touch(p); save(); }
});
document.addEventListener('keydown', (e) => {
  if (!data) return;
  const ed = e.target.closest('[data-edit="proj-title"]');
  if (ed && e.key === 'Enter') { e.preventDefault(); ed.blur(); }
  if (e.key === 'Escape') {
    if (!$('#modal-backdrop').hidden) closeModal();
    else if ($('#popover-layer .day-pop')) closePopover();
    else if ($('#popover-layer .menu')) $('#popover-layer').innerHTML = '';
    else if (ui.search) { ui.search = ''; $('#global-search').value = ''; render(); }
    else if (document.activeElement?.blur) document.activeElement.blur();
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); modalNew(); }
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#global-search').focus(); }
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); }
  if (mod && ['1', '2', '3', '4', '5'].includes(e.key)) { e.preventDefault(); go(['home', 'progetti', 'agenda', 'promemoria', 'account'][+e.key - 1]); }
});
$('#modal-backdrop').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
$('#btn-new').addEventListener('click', modalNew);
$('#btn-settings').addEventListener('click', () => modalSettings());
function applySidebar() {
  const app = $('.app');
  const manual = !!(data && data.settings.sidebarCollapsed);
  const auto = window.innerWidth < 1060;
  app.classList.toggle('collapsed', manual || auto);
  $('#btn-side').title = app.classList.contains('collapsed') ? 'Espandi la barra laterale (Ctrl+B)' : 'Riduci la barra laterale (Ctrl+B)';
}
function toggleSidebar() {
  if (!data) return;
  const app = $('.app');
  data.settings.sidebarCollapsed = !app.classList.contains('collapsed');
  save(); applySidebar();
}
$('#btn-side').addEventListener('click', toggleSidebar);
window.addEventListener('resize', () => { applySidebar(); });
$('#btn-sync').addEventListener('click', () => actions['sync-now']());
$('#global-search').addEventListener('input', (e) => { ui.search = e.target.value.trim(); render(); });
document.querySelector('.titlebar-drag').addEventListener('dblclick', () => api.maximize());
document.querySelector('.toolbar').addEventListener('dblclick', (e) => { if (e.target.closest('.toolbar-actions')) return; api.maximize(); });
window.addEventListener('blur', () => document.body.classList.add('blurred'));
window.addEventListener('focus', () => document.body.classList.remove('blurred'));

api.onDataChanged((d) => { if (dirty) return; data = d; if (typeof historyReset === 'function') historyReset(); if (document.activeElement?.closest('#sheet textarea, #sheet [contenteditable], .ai-drawer input, .ndb input, .ndb select')) return; render(); });
api.onSyncStatus((st) => { syncing = !!st.syncing; renderSyncButton(); if (ui.view === 'account' && $('#modal-backdrop').hidden) render(); });
api.onNavigate((r) => {
  if (r.action === 'new') return modalNew();
  if (r.view === 'agenda') { const d = parse(r.date); go('agenda', { sel: r.date, month: new Date(d.getFullYear(), d.getMonth(), 1) }); }
  else if (r.view === 'progetti') go('progetti', { projectId: r.id, projFilter: 'attivi', catFilter: null });
});

// aggiorna "in corso", saluti e scadenze ogni minuto
setInterval(() => { if (!data || tgDrag || popState) return; const lk = $('#lock'); if (lk && !lk.hidden) return; if ($('#modal-backdrop').hidden && !document.activeElement?.closest('[contenteditable], input, textarea')) render(); }, 60000);

// ---------- Schermata di accesso ----------
let lockInfo = { configured: false };
const LS_PALETTES = {
  tramonto: { name: 'Tramonto', c: ['#ff8a4c', '#5ac8fa', '#9775fa'] },
  oceano: { name: 'Oceano', c: ['#3bc9db', '#4dabf7', '#748ffc'] },
  bosco: { name: 'Bosco', c: ['#69db7c', '#38d9a9', '#ffd43b'] },
  lavanda: { name: 'Lavanda', c: ['#da77f2', '#9775fa', '#f783ac'] },
  sabbia: { name: 'Sabbia', c: ['#ffc078', '#ffa8a8', '#ffe066'] },
  notte: { name: 'Notte', c: ['#7048e8', '#1c7ed6', '#e64980'], base: '#0b0f24', dark: true },
  personalizzato: { name: 'Su misura', c: null },
};
const LS_DEF = { bg: 'aurora', palette: 'tramonto', colors: ['#ff8a4c', '#5ac8fa', '#9775fa'], solid: '#1c1c1e', blur: 0, dim: 25, animate: true, clock: true, clockWeight: 700, clockSize: 86, date: true, welcome: '', subtitle: '', showHint: true, card: 'vetro', text: 'auto', icon: true };
const lum = (h) => { const m = String(h).replace('#', '').match(/.{2}/g); if (!m) return 1; const [r, g, b] = m.map(x => parseInt(x, 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

// calcola sfondo, classi e colore del testo della schermata di blocco
function lockLook(cfg0) {
  const cfg = { ...LS_DEF, ...(cfg0 || {}) };
  let bg = '', base = '', dark = false;
  if (cfg.bg === 'immagine' && cfg.imageData) {
    const b = +cfg.blur || 0;
    bg = `<div class="lock-img" style="background-image:url('${cfg.imageData}');filter:blur(${b}px);inset:${-b * 2}px"></div><div class="lock-dim" style="opacity:${(+cfg.dim || 0) / 100}"></div>`;
    base = '#111'; dark = true;
  } else if (cfg.bg === 'tinta') {
    base = cfg.solid; dark = lum(cfg.solid) < 0.55;
  } else {
    const p = LS_PALETTES[cfg.palette] || LS_PALETTES.tramonto;
    const cs = p.c || cfg.colors;
    base = p.base || ''; dark = !!p.dark;
    bg = `<div class="lock-bg ${cfg.animate ? '' : 'still'}">${cs.map(c => `<i style="background:${esc(c)}"></i>`).join('')}</div>`;
  }
  if (cfg.text === 'chiaro') dark = true; else if (cfg.text === 'scuro') dark = false;
  const drag = `<div class="lock-drag"><div class="traffic"><button class="tl tl-close" data-lockwin="close" title="Esci"></button><button class="tl tl-min" data-lockwin="minimize"></button><button class="tl tl-max" data-lockwin="maximize"></button></div></div>`;
  return { cfg, html: bg + drag, cls: `lock ${dark ? 'ls-light' : ''} ls-card-${cfg.card}`, base };
}
function applyLook(el, look, extra = '') {
  el.className = look.cls + ' ' + extra;
  el.style.background = look.base || '';
}

function lockClock(cfg = LS_DEF) {
  const now = new Date();
  if (!cfg.clock && !cfg.date) return '';
  return `<div class="lock-clock">${cfg.date ? `<div class="lock-date">${now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</div>` : ''}${cfg.clock ? `<div class="lock-time" style="font-weight:${+cfg.clockWeight};font-size:${+cfg.clockSize}px">${fmtHM(now)}</div>` : ''}</div>`;
}

function lockCardHTML(cfg, mode, hint, preview) {
  return `<form class="lock-card" id="lock-form" autocomplete="off">
      ${cfg.icon ? '<img src="../build/icon.png" class="lock-icon" alt="">' : ''}
      <div class="lock-title">${esc(cfg.welcome || 'Promemo')}</div>
      <div class="lock-sub">${mode === 'pw' ? esc(cfg.subtitle || 'Inserisci la password per sbloccare') : 'Inserisci la chiave di recupero'}</div>
      <div class="lock-field">
        <input id="lock-in" type="${mode === 'pw' ? 'password' : 'text'}" placeholder="${mode === 'pw' ? 'Password' : 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'}" spellcheck="false" ${mode === 'rec' ? 'style="text-transform:uppercase;letter-spacing:.06em"' : ''} ${preview === 'mini' ? 'tabindex="-1"' : ''}>
        ${mode === 'pw' ? `<button type="button" class="lock-eye" id="lock-eye" title="Mostra" tabindex="-1">${icon('i-eye')}</button>` : ''}
        <button class="lock-go" title="Sblocca" tabindex="-1">${icon('i-arrow-r')}</button>
      </div>
      <div class="lock-msg" id="lock-msg">${mode === 'pw' && hint && cfg.showHint ? 'Suggerimento: ' + esc(hint) : ''}</div>
      ${preview ? '' : `<button type="button" class="lock-link" id="lock-switch">${mode === 'pw' ? 'Password dimenticata? Usa la chiave di recupero' : 'Torna alla password'}</button>`}
      ${preview === 'full' ? '<button type="button" class="lock-link" id="lock-exit">Esci dall\'anteprima (Esc)</button>' : ''}
    </form>`;
}

// anteprima in miniatura per le impostazioni
function renderLockPreview(box, cfg) {
  const look = lockLook(cfg);
  box.innerHTML = `<div class="ls-scale"></div>`;
  const inner = box.firstChild;
  inner.className = 'ls-scale ' + look.cls;
  inner.style.background = look.base || 'var(--bg)';
  inner.innerHTML = look.html + lockClock(look.cfg) + lockCardHTML(look.cfg, 'pw', lockInfo.hint || '', 'mini');
  const k = box.clientWidth / 1280;
  inner.style.transform = `scale(${k})`;
}


function strength(pw) {
  let n = 0;
  if (pw.length >= 8) n++; if (pw.length >= 12) n++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++;
  if (/\d/.test(pw)) n++; if (/[^A-Za-z0-9]/.test(pw)) n++;
  return Math.min(4, n);
}

function bindLockWin(el) {
  el.querySelectorAll('[data-lockwin]').forEach(b => b.addEventListener('click', () => api[b.dataset.lockwin]()));
}

function showLock(st, preview = false) {
  const el = $('#lock');
  const look = lockLook(st.lockscreen);
  el.hidden = false; applyLook(el, look, preview ? 'over-full' : '');
  let mode = 'pw';
  const closePreview = () => { el.classList.add('leaving'); setTimeout(() => { el.hidden = true; el.innerHTML = ''; el.className = 'lock'; el.style.background = ''; }, 400); document.removeEventListener('keydown', escPrev, true); };
  const escPrev = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePreview(); } };
  if (preview) document.addEventListener('keydown', escPrev, true);
  const draw = () => {
    el.innerHTML = look.html + lockClock(look.cfg) + lockCardHTML(look.cfg, mode, st.hint, preview ? 'full' : '');
    bindLockWin(el);
    const inp = el.querySelector('#lock-in');
    setTimeout(() => inp.focus(), 60);
    el.querySelector('#lock-switch')?.addEventListener('click', () => { mode = mode === 'pw' ? 'rec' : 'pw'; draw(); });
    el.querySelector('#lock-exit')?.addEventListener('click', closePreview);
    el.querySelector('#lock-eye')?.addEventListener('click', () => { inp.type = inp.type === 'password' ? 'text' : 'password'; inp.focus(); });
    el.querySelector('#lock-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (preview) { closePreview(); return; }
      if (!inp.value) return;
      const card = el.querySelector('.lock-card');
      card.classList.add('busy');
      const r = await api.unlock({ secret: inp.value, recovery: mode === 'rec' });
      card.classList.remove('busy');
      if (!r.ok) {
        const msg = el.querySelector('#lock-msg');
        msg.textContent = r.error + (r.wait ? ` Attendi ${Math.ceil(r.wait / 1000)} s.` : '');
        msg.classList.add('err');
        card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
        inp.select();
        return;
      }
      await enterApp();
      if (r.recovered) modalNewPassword(true);
    });
  };
  draw();
  clearInterval(showLock._t);
  showLock._t = setInterval(() => { const t = el.querySelector('.lock-time'); if (el.hidden) return clearInterval(showLock._t); if (t) t.textContent = fmtHM(new Date()); }, 15000);
}

async function enterApp() {
  data = await api.getData();
  lockInfo = await api.lockState();
  applyTheme();
  render();
  const el = $('#lock');
  if (!el.hidden) { el.classList.add('leaving'); setTimeout(() => { el.hidden = true; el.innerHTML = ''; el.className = 'lock'; el.style.background = ''; }, 450); }
}

function showSetup(fromSettings) {
  const el = $('#lock');
  const look = lockLook(lockInfo.lockscreen);
  el.hidden = false; applyLook(el, look, fromSettings ? 'over' : '');
  el.innerHTML = `${look.html}
    <form class="lock-card wide" id="setup-form" autocomplete="off">
      <img src="../build/icon.png" class="lock-icon" alt="">
      <div class="lock-title">Proteggi Promemo</div>
      <div class="lock-sub">Scegli una password: ti verrà chiesta a ogni avvio e servirà a cifrare impegni, progetti e credenziali degli account su questo computer.</div>
      <div class="lock-stack">
        <input id="su-pw" type="password" placeholder="Password (almeno 8 caratteri)" class="lock-input">
        <div class="meter"><i id="su-meter"></i></div>
        <input id="su-pw2" type="password" placeholder="Ripeti la password" class="lock-input">
        <input id="su-hint" type="text" placeholder="Suggerimento (facoltativo, visibile a chiunque)" class="lock-input" maxlength="80">
      </div>
      <div class="lock-msg" id="su-msg"></div>
      <div class="lock-actions">
        <button type="button" class="btn" id="su-later">${fromSettings ? 'Annulla' : 'Non ora'}</button>
        <button class="btn-primary" id="su-go">Attiva protezione</button>
      </div>
    </form>`;
  bindLockWin(el);
  const pw = el.querySelector('#su-pw'), pw2 = el.querySelector('#su-pw2'), msg = el.querySelector('#su-msg');
  setTimeout(() => pw.focus(), 60);
  pw.addEventListener('input', () => { const n = strength(pw.value); const m = el.querySelector('#su-meter'); m.style.width = (n / 4 * 100) + '%'; m.dataset.s = n; });
  el.querySelector('#su-later').addEventListener('click', () => {
    if (!fromSettings) { data.settings.lockDeclined = true; save(); }
    el.classList.add('leaving'); setTimeout(() => { el.hidden = true; el.innerHTML = ''; }, 400);
  });
  el.querySelector('#setup-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    msg.classList.add('err');
    if (pw.value.length < 8) { msg.textContent = 'Usa almeno 8 caratteri.'; return; }
    if (pw.value !== pw2.value) { msg.textContent = 'Le due password non coincidono.'; pw2.select(); return; }
    const btn = el.querySelector('#su-go'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Cifro i dati…';
    await new Promise(r => setTimeout(r, 200)); // lascia partire eventuali salvataggi in sospeso
    const r = await api.lockSetup({ password: pw.value, hint: el.querySelector('#su-hint').value });
    if (!r.ok) { btn.disabled = false; btn.textContent = 'Attiva protezione'; msg.textContent = r.error; return; }
    lockInfo = await api.lockState();
    showRecovery(r.recovery);
  });
}

function showRecovery(code) {
  const el = $('#lock');
  el.innerHTML = `${lockLook(lockInfo.lockscreen).html}
    <div class="lock-card wide">
      <div class="lock-badge">${icon('i-check')}</div>
      <div class="lock-title">Protezione attiva</div>
      <div class="lock-sub">Questa è la tua <b>chiave di recupero</b>. Se dimentichi la password è l'unico modo per riaprire i dati: senza, nessuno può recuperarli. Scrivila su carta o salvala nel gestore di password.</div>
      <div class="rec-code" id="rec-code">${esc(code)}</div>
      <div class="lock-actions center"><button class="btn" id="rec-copy">${icon('i-note')} Copia</button></div>
      <label class="lock-check"><input type="checkbox" id="rec-ok"> Ho conservato la chiave in un posto sicuro</label>
      <div class="lock-actions"><button class="btn-primary" id="rec-done" disabled>Continua</button></div>
    </div>`;
  bindLockWin(el);
  el.querySelector('#rec-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); toast('Chiave copiata'); }
    catch { const r = document.createRange(); r.selectNodeContents(el.querySelector('#rec-code')); getSelection().removeAllRanges(); getSelection().addRange(r); }
  });
  el.querySelector('#rec-ok').addEventListener('change', (e) => { el.querySelector('#rec-done').disabled = !e.target.checked; });
  el.querySelector('#rec-done').addEventListener('click', () => { el.classList.add('leaving'); setTimeout(() => { el.hidden = true; el.innerHTML = ''; }, 400); toast('Da ora Promemo chiederà la password a ogni avvio'); });
}

function modalNewPassword(recovered) {
  openModal(`<h2>${recovered ? 'Scegli una nuova password' : 'Cambia password'}</h2>
    ${recovered ? '<p class="muted" style="margin-top:-6px">Hai sbloccato con la chiave di recupero: imposta subito una nuova password. La chiave di recupero resta valida.</p>' : ''}
    <form class="form" data-submit="pw-change">
      ${recovered ? '' : '<label class="field"><span>Password attuale</span><input name="current" type="password" required></label>'}
      <label class="field"><span>Nuova password</span><input name="next" type="password" required minlength="8" placeholder="Almeno 8 caratteri"></label>
      <label class="field"><span>Ripeti la nuova password</span><input name="next2" type="password" required></label>
      <label class="field"><span>Suggerimento (facoltativo)</span><input name="hint" maxlength="80" value="${esc(lockInfo.hint || '')}"></label>
      <div class="form-err" hidden></div>
      <div class="modal-actions">${recovered ? '' : '<button type="button" class="btn" data-action="close-modal">Annulla</button>'}<button class="btn-primary">Salva password</button></div>
    </form>`);
}

function modalRemovePassword() {
  openModal(`<h2>Disattiva la password</h2>
    <p class="muted" style="margin-top:-6px">I dati torneranno salvati senza cifratura e Promemo si aprirà senza chiedere nulla. Le credenziali degli account restano protette dal portachiavi di sistema.</p>
    <form class="form" data-submit="pw-remove">
      <label class="field"><span>Password attuale</span><input name="current" type="password" required></label>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary" style="background:#e0352b">Disattiva</button></div>
    </form>`);
}

(async function init() {
  lockInfo = await api.lockState();
  if (lockInfo.locked) { showLock(lockInfo); return; }
  data = await api.getData();
  applyTheme();
  render();
  if (!lockInfo.configured && !data.settings.lockDeclined) showSetup(false);
})();
window.addEventListener('scroll', () => { if (window.scrollY) window.scrollTo(0, 0); });
