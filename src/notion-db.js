/* Promemo — gestione dei database Notion: elenco, tabella con modifica in linea, nuove righe */
'use strict';

const ndb = { accs: null, acc: null, dbs: null, db: null, schema: null, rows: [], next: null, sort: null, q: '', dq: '', loading: false, err: '', more: false, saving: {} };
const NDB_EDIT = ['title', 'rich_text', 'number', 'select', 'status', 'multi_select', 'checkbox', 'date', 'url', 'email', 'phone_number'];
const NDB_ICON = { title: 'Aa', rich_text: '≡', number: '#', select: '▾', status: '◐', multi_select: '☰', date: '📅', checkbox: '☑', url: '🔗', email: '@', phone_number: '☏', place: '📍', people: '👤', relation: '↗', formula: 'ƒ', rollup: 'Σ', files: '📎', created_time: '⏱', last_edited_time: '⏱' };
const N_COLORS = { default: '#8e8e93', gray: '#8e8e93', brown: '#a0785a', orange: '#f08a24', yellow: '#e8b10b', green: '#40c057', blue: '#2f7ae5', purple: '#9775fa', pink: '#f06595', red: '#e5484d' };

async function ndbInit() {
  ndb.loading = true; ndb.err = ''; render();
  ndb.accs = await api.ndbAccounts();
  if (!ndb.accs.length) { ndb.loading = false; render(); return; }
  if (!ndb.acc || !ndb.accs.some(a => a.id === ndb.acc)) ndb.acc = ndb.accs[0].id;
  const r = await api.ndbList(ndb.acc);
  ndb.loading = false;
  if (!r.ok) { ndb.err = r.error; ndb.dbs = []; render(); return; }
  ndb.dbs = r.value;
  render();
  if (!ndb.db && ndb.dbs.length) ndbOpen(ndb.dbs[0].id);
}
async function ndbOpen(id) {
  ndb.db = id; ndb.schema = null; ndb.rows = []; ndb.next = null; ndb.sort = null; ndb.q = ''; ndb.err = ''; ndb.loading = true; render();
  const s = await api.ndbSchema({ acc: ndb.acc, db: id });
  if (ndb.db !== id) return;
  if (!s.ok) { ndb.err = s.error; ndb.loading = false; render(); return; }
  // il titolo per primo, poi l'ordine di Notion
  ndb.schema = { ...s.value, props: [...s.value.props.filter(p => p.type === 'title'), ...s.value.props.filter(p => p.type !== 'title')] };
  await ndbQuery();
}
async function ndbQuery(more) {
  ndb.loading = !more; ndb.more = !!more; render();
  const sorts = ndb.sort ? [{ property: ndb.sort.prop, direction: ndb.sort.dir }] : undefined;
  const id = ndb.db;
  const r = await api.ndbQuery({ acc: ndb.acc, db: id, cursor: more ? ndb.next : undefined, sorts });
  if (ndb.db !== id) return;
  ndb.loading = false; ndb.more = false;
  if (!r.ok) { ndb.err = r.error; render(); return; }
  ndb.rows = more ? ndb.rows.concat(r.value.rows) : r.value.rows;
  ndb.next = r.value.next;
  render();
}

// ---------- valori → testo e payload Notion ----------
const rt = (v) => { const s = String(v || ''); const out = []; for (let i = 0; i < s.length; i += 2000) out.push({ type: 'text', text: { content: s.slice(i, i + 2000) } }); return out; };
// ora locale con fuso (Notion altrimenti la legge come UTC)
function withOffset(v) {
  if (!v.includes('T') || /[+-]\d\d:\d\d$|Z$/.test(v)) return v;
  const o = -new Date(v).getTimezoneOffset(), a = Math.abs(o);
  return `${v}:00${o >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
function ndbPayload(type, v, old) {
  switch (type) {
    case 'title': return { title: rt(v) };
    case 'rich_text': return { rich_text: rt(v) };
    case 'number': return { number: v === '' || v == null ? null : Number(v) };
    case 'checkbox': return { checkbox: !!v };
    case 'select': return { select: v ? { name: v } : null };
    case 'status': return { status: v ? { name: v } : null };
    case 'multi_select': return { multi_select: v.map(name => ({ name })) };
    case 'date': { if (!v) return { date: null }; const st = withOffset(v); return { date: { start: st, end: old && old.end && old.end >= st ? old.end : null } }; }
    case 'url': return { url: v || null };
    case 'email': return { email: v || null };
    case 'phone_number': return { phone_number: v || null };
  }
  return null;
}
function ndbText(p) {
  const v = p && p.value;
  if (v == null || v === '') return '';
  switch (p.type) {
    case 'select': case 'status': return v.name;
    case 'multi_select': return v.map(o => o.name).join(', ');
    case 'date': return v.start ? v.start.replace('T', ' ').slice(0, 16) + (v.end ? ' → ' + v.end.replace('T', ' ').slice(0, 16) : '') : '';
    case 'checkbox': return v ? '✓' : '';
    case 'place': return v.name || v.address || `${v.lat}, ${v.lon}`;
    default: return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}
const optTag = (o) => `<span class="ntag" style="--nc:${N_COLORS[o.color] || N_COLORS.default}">${esc(o.name)}</span>`;

function ndbCell(row, col) {
  const p = row.props[col.name] || { type: col.type, value: null };
  const v = p.value, k = `data-row="${row.id}" data-prop="${esc(col.name)}"`;
  const busy = ndb.saving[row.id + col.name] ? ' saving' : '';
  switch (col.type) {
    case 'title': case 'rich_text': case 'url': case 'email': case 'phone_number':
      return `<td class="nc t-${col.type}${busy}"><input class="ncell" ${k} value="${esc(v || '')}" spellcheck="false">${col.type === 'title' ? `<button class="nopen" data-action="open-url" data-url="${esc(row.url)}" title="Apri in Notion">↗</button>` : ''}</td>`;
    case 'number': return `<td class="nc num${busy}"><input class="ncell" type="number" step="any" ${k} value="${v ?? ''}"></td>`;
    case 'checkbox': return `<td class="nc ctr${busy}"><input type="checkbox" class="ncheck" ${k} ${v ? 'checked' : ''}></td>`;
    case 'select': case 'status':
      return `<td class="nc${busy}"><select class="nsel" ${k} style="--nc:${N_COLORS[(col.options.find(o => o.name === v?.name) || {}).color] || 'transparent'}">${col.type === 'select' || !v ? '<option value="">—</option>' : ''}${col.options.map(o => `<option ${v && v.name === o.name ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></td>`;
    case 'multi_select':
      return `<td class="nc${busy}"><button class="nmulti" data-action="ndb-multi" ${k}>${(v || []).map(optTag).join('') || '<span class="muted">—</span>'}</button></td>`;
    case 'date': {
      const hasT = v && v.start && v.start.includes('T');
      const val = v && v.start ? (hasT ? v.start.slice(0, 16) : v.start.slice(0, 10)) : '';
      return `<td class="nc${busy}"><input class="ncell" type="${hasT ? 'datetime-local' : 'date'}" ${k} value="${esc(val)}">${v && v.end ? `<span class="tiny"> → ${esc(v.end.slice(0, hasT ? 16 : 10).replace('T', ' '))}</span>` : ''}</td>`;
    }
    default: return `<td class="nc ro" title="${esc(ndbText(p))}">${esc(ndbText(p))}</td>`;
  }
}

async function ndbSave(rowId, propName, value) {
  const row = ndb.rows.find(r => r.id === rowId); const col = ndb.schema.props.find(p => p.name === propName);
  if (!row || !col) return;
  const old = row.props[propName] ? row.props[propName].value : null;
  const payload = ndbPayload(col.type, value, old);
  if (!payload) return;
  ndb.saving[rowId + propName] = true;
  const r = await api.ndbUpdate({ acc: ndb.acc, page: rowId, props: { [propName]: payload } });
  delete ndb.saving[rowId + propName];
  if (!r.ok) { toast(r.error); ndbRender(); return; }
  Object.assign(row, r.value);
  ndbRender();
}
// ridisegna mantenendo il campo in cui si sta scrivendo
function ndbRender() {
  const a = document.activeElement, key = a && a.dataset && a.dataset.row ? [a.dataset.row, a.dataset.prop] : null;
  render();
  if (key) { const n = [...document.querySelectorAll('.ndb-table [data-row]')].find(x => x.dataset.row === key[0] && x.dataset.prop === key[1]); n && n.focus(); }
}

function viewNotionDb() {
  if (!ndb.accs) { ndbInit(); return `<div class="empty" style="margin-top:40px"><span class="spinner"></span> Carico i database Notion…</div>`; }
  if (!ndb.accs.length) return `<div class="page-wide setup-page"><div class="eyebrow">I tuoi dati, senza aprire il browser</div><h1 class="large-title">Database Notion</h1>
    <div class="empty" style="margin-top:22px"><b>Nessun account Notion collegato</b>Collega Notion in <a class="link" data-action="nav" data-view="account">Account collegati</a>, poi condividi con l'integrazione le pagine o i database da gestire.</div></div>`;
  const dq = ndb.dq.toLowerCase();
  const dbs = (ndb.dbs || []).filter(d => !dq || d.title.toLowerCase().includes(dq));
  const s = ndb.schema;
  const q = ndb.q.toLowerCase();
  const rows = s ? ndb.rows.filter(r => !r.archived && (!q || Object.values(r.props).some(p => ndbText(p).toLowerCase().includes(q)))) : [];
  const head = s ? s.props.map(c => { const on = ndb.sort && ndb.sort.prop === c.name; return `<th class="${on ? 'sorted' : ''}" data-action="ndb-sort" data-prop="${esc(c.name)}" title="${esc(c.type)}${NDB_EDIT.includes(c.type) ? '' : ' · sola lettura'}"><span class="nti">${NDB_ICON[c.type] || '·'}</span>${esc(c.name)}${on ? (ndb.sort.dir === 'ascending' ? ' ↑' : ' ↓') : ''}</th>`; }).join('') : '';
  return `<div class="ndb">
    <aside class="ndb-side">
      ${ndb.accs.length > 1 ? `<select class="ndb-acc" data-ndb-acc>${ndb.accs.map(a => `<option value="${a.id}" ${a.id === ndb.acc ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}
      <div class="ndb-find">${icon('i-search')}<input placeholder="Cerca un database" value="${esc(ndb.dq)}" data-ndb-dq></div>
      <div class="ndb-list">${dbs.map(d => `<button class="ndb-item ${d.id === ndb.db ? 'on' : ''}" data-action="ndb-open" data-id="${d.id}"><span class="ndb-ic">${esc(d.icon || '▦')}</span><span class="grow">${esc(d.title)}</span></button>`).join('') || `<div class="tiny" style="padding:10px">${ndb.dbs ? 'Nessun database condiviso con l’integrazione.' : ''}</div>`}</div>
      <button class="btn small" data-action="ndb-reload" style="margin-top:8px">${icon('i-refresh')} Aggiorna elenco</button>
    </aside>
    <section class="ndb-main">
      ${s ? `<div class="ndb-title"><div class="eyebrow">Database Notion</div><h1 class="large-title" style="font-size:26px">${esc((s.icon ? s.icon + ' ' : '') + s.title)}</h1>
        <div class="subtitle">${rows.length}${ndb.next ? '+' : ''} righe · ${s.props.length} colonne · le modifiche vanno subito su Notion</div></div>
      <div class="ndb-head">
        <div class="ndb-find grow">${icon('i-search')}<input placeholder="Filtra le righe" value="${esc(ndb.q)}" data-ndb-q></div>
        <button class="btn small" data-action="open-url" data-url="${esc(s.url)}">Apri in Notion</button>
        ${ndbInAgenda(s) ? `<button class="btn small" data-action="nav" data-view="agenda" title="Già sincronizzato come calendario">${icon('i-check')} In Agenda</button>` : s.props.some(p => p.type === 'date') ? `<button class="btn small" data-action="ndb-agenda" title="Le righe con una data diventano eventi">${icon('i-calendar')} Mostra in Agenda</button>` : ''}
        <button class="btn-primary" data-action="ndb-new">${icon('i-plus')} Nuova riga</button>
      </div>` : ''}
      ${ndb.err ? `<div class="form-err" style="margin:10px 0">${esc(ndb.err)}</div>` : ''}
      ${ndb.loading ? `<div class="empty" style="margin-top:20px"><span class="spinner"></span> Carico…</div>` : s ? `<div class="ndb-scroll"><table class="ndb-table"><thead><tr>${head}<th class="nact"></th></tr></thead><tbody>
        ${rows.map(r => `<tr>${s.props.map(c => ndbCell(r, c)).join('')}<td class="nact"><button class="icon-btn" data-action="ndb-archive" data-id="${r.id}" title="Archivia in Notion">${icon('i-trash')}</button></td></tr>`).join('')}
      </tbody></table>${!rows.length ? '<div class="empty" style="margin:16px">Nessuna riga</div>' : ''}
      ${ndb.next ? `<div style="text-align:center;padding:14px"><button class="btn small" data-action="ndb-more" ${ndb.more ? 'disabled' : ''}>${ndb.more ? '<span class="spinner"></span>' : ''} Carica altre righe</button></div>` : ''}</div>`
      : !ndb.err ? `<div class="empty" style="margin-top:20px">Scegli un database a sinistra.</div>` : ''}
    </section>
  </div>`;
}

function ndbMultiMenu(el) {
  const row = ndb.rows.find(r => r.id === el.dataset.row), col = ndb.schema.props.find(p => p.name === el.dataset.prop);
  const cur = new Set(((row.props[col.name] || {}).value || []).map(o => o.name));
  const layer = $('#popover-layer'), rc = el.getBoundingClientRect();
  layer.innerHTML = `<div class="menu ndb-menu">${col.options.map(o => `<label class="ndb-opt"><input type="checkbox" value="${esc(o.name)}" ${cur.has(o.name) ? 'checked' : ''}>${optTag(o)}</label>`).join('') || '<div class="tiny" style="padding:8px">Nessuna opzione</div>'}
    <div class="ndb-menu-foot"><button class="btn small" data-x="no">Annulla</button><button class="btn-primary small" data-x="ok">Applica</button></div></div>`;
  const m = layer.firstChild;
  m.style.top = Math.min(rc.bottom + 4, window.innerHeight - m.offsetHeight - 10) + 'px';
  m.style.left = Math.min(rc.left, window.innerWidth - m.offsetWidth - 10) + 'px';
  const close = () => { layer.innerHTML = ''; document.removeEventListener('mousedown', out, true); };
  const out = (e) => { if (!m.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', out, true));
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'ok') { const v = [...m.querySelectorAll('input:checked')].map(i => i.value); close(); ndbSave(row.id, col.name, v); } else close();
  });
}

const ndbInAgenda = (s) => (data.accounts || []).some(a => a.provider === 'notion' && a.calendars.some(c => c.id.replace(/-/g, '') === s.id.replace(/-/g, '')));
Object.assign(actions, {
  'ndb-agenda': () => modalNotion({ database: ndb.schema.id }),
  'ndb-open': (el) => ndbOpen(el.dataset.id),
  'ndb-reload': () => { ndb.accs = null; ndb.dbs = null; render(); },
  'ndb-more': () => ndbQuery(true),
  'ndb-sort': (el) => { const p = el.dataset.prop; ndb.sort = !ndb.sort || ndb.sort.prop !== p ? { prop: p, dir: 'ascending' } : ndb.sort.dir === 'ascending' ? { prop: p, dir: 'descending' } : null; ndbQuery(); },
  'ndb-multi': (el) => ndbMultiMenu(el),
  'ndb-new': async () => {
    const t = ndb.schema.props.find(p => p.type === 'title');
    const r = await api.ndbCreate({ acc: ndb.acc, db: ndb.db, props: { [t.name]: { title: rt('Nuova riga') } } });
    if (!r.ok) { toast(r.error); return; }
    ndb.rows.unshift(r.value); render();
    const inp = document.querySelector(`.ndb-table input[data-row="${r.value.id}"]`); inp && (inp.focus(), inp.select());
  },
  'ndb-archive': async (el) => {
    if (!el.classList.contains('confirm')) { el.classList.add('confirm'); el.title = 'Premi di nuovo per archiviare'; setTimeout(() => el.classList.remove('confirm'), 2500); return; }
    const r = await api.ndbArchive({ acc: ndb.acc, page: el.dataset.id });
    if (!r.ok) { toast(r.error); return; }
    ndb.rows = ndb.rows.filter(x => x.id !== el.dataset.id); toast('Riga archiviata in Notion'); render();
  },
});

// modifica in linea: testo al blur/invio, il resto al cambio
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.classList && t.classList.contains('ncell') && e.key === 'Enter') { e.preventDefault(); t.blur(); }
  if (t.classList && t.classList.contains('ncell') && e.key === 'Escape') { const row = ndb.rows.find(r => r.id === t.dataset.row); t.dataset.cancel = '1'; t.value = ndbText(row.props[t.dataset.prop]) ; t.blur(); }
});
document.addEventListener('focusout', (e) => {
  const t = e.target;
  if (!t.classList || !t.classList.contains('ncell') || t.type === 'date' || t.type === 'datetime-local') return;
  if (t.dataset.cancel) { delete t.dataset.cancel; return; }
  const row = ndb.rows.find(r => r.id === t.dataset.row); if (!row) return;
  const p = row.props[t.dataset.prop];
  const old = p ? (p.type === 'number' ? (p.value ?? '') : (p.value || '')) : '';
  if (String(old) !== t.value) ndbSave(row.id, t.dataset.prop, t.value);
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches && t.matches('[data-ndb-acc]')) { ndb.acc = t.value; ndb.db = null; ndb.schema = null; ndb.accs = null; render(); return; }
  if (!t.dataset || !t.dataset.row || !t.closest('.ndb-table')) return;
  if (t.classList.contains('ncheck')) ndbSave(t.dataset.row, t.dataset.prop, t.checked);
  else if (t.classList.contains('nsel')) ndbSave(t.dataset.row, t.dataset.prop, t.value);
  else if (t.type === 'date' || t.type === 'datetime-local') ndbSave(t.dataset.row, t.dataset.prop, t.value);
});
let ndbFilterT = null;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.matches || !t.matches('[data-ndb-q],[data-ndb-dq]')) return;
  const key = t.matches('[data-ndb-q]') ? 'q' : 'dq';
  ndb[key] = t.value;
  clearTimeout(ndbFilterT);
  ndbFilterT = setTimeout(() => { const pos = t.selectionStart; render(); const n = document.querySelector(key === 'q' ? '[data-ndb-q]' : '[data-ndb-dq]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 180);
});

EXTRA_NAV.push(['notion', 'i-db', 'Database Notion', null]);
EXTRA_VIEWS.notion = { title: 'Database Notion', render: viewNotionDb, full: () => true };
if (data) render();
