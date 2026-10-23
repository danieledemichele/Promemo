/* Promemo — calendari annidati nella barra laterale: trascina una voce (o un intero account) sopra un'altra,
   es. il database "Lezioni 26/27" dentro "Lavoro". La voce che contiene altre voci ha una freccia per chiuderle
   e la sua casella accende o spegne tutto quello che contiene. */
'use strict';
const calTree = () => (data.settings.calTree = data.settings.calTree || {});
const nodeKeyOfRow = (row) => { const c = row.querySelector('.cal-check'); if (!c) return null; const d = c.dataset; return d.type === 'local' ? 'loc:' + d.gid : d.type === 'trip' ? 'trip' : d.type === 'acc' ? `grp:${d.acc}|${d.gid}` : null; };
const nodeName = (el) => (el.querySelector('.cal-name, .cal-acc-name') || {}).textContent || '';

function sideTreeApply() {
  const box = document.getElementById('side-cals'); if (!box) return;
  // chiavi su righe e blocchi
  box.querySelectorAll('.cal-row').forEach(r => { const k = nodeKeyOfRow(r); if (k) { r.dataset.node = k; r.draggable = true; } });
  box.querySelectorAll('.cal-acc').forEach(b => { const h = b.querySelector('.cal-acc-head'); const k = h && h.dataset.key; if (k && k !== 'local') { b.dataset.node = 'acc:' + k; h.draggable = true; } });
  const tree = calTree(), find = (k) => box.querySelector(`[data-node="${CSS.escape(k)}"]`);
  // pulizia: voci che non esistono più
  for (const [c, p] of Object.entries(tree)) if (!find(c) || !find(p) || c === p) delete tree[c];
  // annido (i genitori prima dei figli, così funziona anche su più livelli)
  const depth = (k, n = 0) => tree[k] && n < 10 ? depth(tree[k], n + 1) : n;
  for (const c of Object.keys(tree).sort((a, b) => depth(a) - depth(b))) {
    const child = find(c), parent = find(tree[c]); if (!child || !parent || parent.contains(child) || child.contains(parent)) continue;
    let sub = parent.nextElementSibling && parent.nextElementSibling.classList.contains('cal-sub') && parent.nextElementSibling.dataset.of === parent.dataset.node ? parent.nextElementSibling : null;
    if (!sub) {
      sub = document.createElement('div'); sub.className = 'cal-sub'; sub.dataset.of = parent.dataset.node;
      parent.after(sub);
      if (!parent.querySelector('.cal-twist')) parent.insertAdjacentHTML('afterbegin', `<button class="cal-twist" data-action="tree-collapse" data-key="${esc(parent.dataset.node)}" title="Mostra o nascondi le voci contenute">${icon('i-chev-r')}</button>`);
      parent.classList.add('has-sub');
      if (collapsed['tree:' + parent.dataset.node]) { sub.hidden = true; parent.classList.add('closed'); }
    }
    sub.appendChild(child);
    if (child.classList.contains('cal-row') || child.classList.contains('cal-acc')) child.classList.add('nested');
    if (!child.querySelector(':scope > .cal-out, :scope > .cal-acc-head > .cal-out')) {
      const host = child.classList.contains('cal-acc') ? child.querySelector('.cal-acc-head') : child;
      host.insertAdjacentHTML('beforeend', `<span class="cal-out" role="button" data-action="tree-out" data-key="${esc(c)}" title="Togli da “${esc(nodeName(parent).trim())}”">↰</span>`);
    }
  }
  // casella della voce che contiene altre voci: spenta solo se è tutto spento, a metà se misto
  box.querySelectorAll('.cal-row.has-sub').forEach(r => {
    const sub = r.nextElementSibling; if (!sub) return;
    const rows = [r, ...sub.querySelectorAll('.cal-row')], on = rows.filter(x => !x.classList.contains('off')).length;
    r.classList.toggle('mixed', on > 0 && on < rows.length);
  });
  // le righe vuote dei blocchi rimasti senza voci
  box.querySelectorAll('.cal-acc:not(.nested) > .cal-groups').forEach(g => { if (!g.children.length) g.innerHTML = '<div class="cal-empty">Le voci sono dentro un’altra voce</div>'; });
}
const _renderSideCals_tree = renderSideCals;
renderSideCals = function () { _renderSideCals_tree(); try { sideTreeApply(); } catch (e) { console.error('barra laterale', e); } };

// accende o spegne una voce e tutto ciò che contiene
async function treeToggle(row) {
  const sub = row.nextElementSibling && row.nextElementSibling.classList.contains('cal-sub') ? row.nextElementSibling : null;
  const visible = row.classList.contains('off') || row.classList.contains('mixed');
  const checks = [row, ...(sub ? sub.querySelectorAll('.cal-row') : [])].map(r => r.querySelector('.cal-check').dataset);
  const h = new Set(hiddenLocal()); const accPatch = {};
  for (const d of checks) {
    if (d.type === 'local' || d.type === 'trip') { const k = d.type === 'trip' ? '__trips' : d.gid; visible ? h.delete(k) : h.add(k); }
    if (d.type === 'acc') { const a = data.accounts.find(x => x.id === d.acc); const g = a && (a.groups || []).find(x => x.id === d.gid); if (g) { g.visible = visible; (accPatch[d.acc] = accPatch[d.acc] || []).push({ id: d.gid, visible }); } }
  }
  data.settings.hiddenLocal = [...h];
  save(); render();
  for (const [id, groups] of Object.entries(accPatch)) await api.updateAccount({ id, patch: { groups } });
}
const _grpToggle_tree = actions['grp-toggle'];
Object.assign(actions, {
  'grp-toggle': (el) => { const row = el.closest('.cal-row'); if (row && row.classList.contains('has-sub')) return treeToggle(row); return _grpToggle_tree(el); },
  'tree-collapse': (el, ev) => { ev && ev.stopPropagation(); const k = el.dataset.key; collapsed['tree:' + k] = !collapsed['tree:' + k]; try { localStorage.setItem('promemo.collapsed', JSON.stringify(collapsed)); } catch {} renderSideCals(); },
  'tree-out': (el, ev) => { ev && ev.stopPropagation(); delete calTree()[el.dataset.key]; save(); renderSideCals(); toast('Voce spostata fuori'); },
});

// trascinamento
let treeDrag = null;
document.addEventListener('dragstart', (e) => {
  const n = e.target.closest && e.target.closest('#side-cals [data-node], #side-cals .cal-acc-head');
  if (!n) return;
  const node = n.dataset.node ? n : n.closest('[data-node]'); if (!node) return;
  treeDrag = node.dataset.node;
  e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', treeDrag); } catch { /* */ }
  node.classList.add('dragging');
});
document.addEventListener('dragend', () => { treeDrag = null; document.querySelectorAll('#side-cals .dragging, #side-cals .drop-in, #side-cals .drop-out').forEach(x => x.classList.remove('dragging', 'drop-in', 'drop-out')); });
const dropTarget = (t) => {
  if (!treeDrag || !t.closest) return null;
  const row = t.closest('#side-cals .cal-row');
  if (row && row.dataset.node && row.dataset.node !== treeDrag) {
    const dragged = document.querySelector(`#side-cals [data-node="${CSS.escape(treeDrag)}"]`);
    if (dragged && dragged.contains(row)) return null; // non dentro se stessa
    return { el: row, parent: row.dataset.node };
  }
  const head = t.closest('#side-cals .cal-acc-head');
  if (head && head.dataset.key === 'local' || t.id === 'side-cals' || t.closest('.side-label-row')) return { el: head || t, out: true };
  return null;
};
document.addEventListener('dragover', (e) => {
  const d = dropTarget(e.target); if (!d) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('#side-cals .drop-in, #side-cals .drop-out').forEach(x => x !== d.el && x.classList.remove('drop-in', 'drop-out'));
  d.el.classList.add(d.out ? 'drop-out' : 'drop-in');
});
document.addEventListener('drop', (e) => {
  const d = dropTarget(e.target); if (!d) return;
  e.preventDefault();
  const k = treeDrag, t = calTree();
  if (d.out) { if (t[k]) { delete t[k]; toast('Voce spostata fuori'); } }
  else {
    // niente cicli: il nuovo genitore non può stare dentro la voce trascinata
    for (let p = d.parent, n = 0; p && n < 20; p = t[p], n++) if (p === k) return;
    t[k] = d.parent;
    collapsed['tree:' + d.parent] = false;
    toast(`Spostato dentro “${nodeName(d.el).trim()}”`);
  }
  save(); renderSideCals();
});

// ---------- voci della barra laterale: Viaggi, Database Notion e Statistiche si possono nascondere ----------
const SIDE_OPT = [['viaggi', 'Viaggi', 'Gli itinerari letti dal tuo planner di Notion'], ['notion', 'Database Notion', 'Sfogliare e modificare in tabella i database condivisi con l’integrazione, senza aprire Notion'], ['statistiche', 'Statistiche', 'Dove va il tuo tempo, ore per giorno e pannelli personali']];
const _paneHTML_side = paneHTML;
paneHTML = function (id, ls) {
  const h = _paneHTML_side(id, ls);
  if (id !== 'generale') return h;
  const hid = data.settings.sideHidden || [];
  return h + `<h4 class="set-h">Voci della barra laterale</h4><div class="set-group">${SIDE_OPT.map(([k, l, sub]) => `<label class="switch-row"><div>${l}<small>${sub}</small></div><input type="checkbox" class="switch" data-side-opt="${k}" ${hid.includes(k) ? '' : 'checked'}></label>`).join('')}</div><p class="set-note">Le sezioni nascoste restano raggiungibili con Ctrl+K.</p>`;
};
const _drawPane_side = drawPane;
drawPane = function (m) {
  _drawPane_side(m);
  if (setPane !== 'generale') return;
  m.querySelectorAll('[data-side-opt]').forEach(el => el.addEventListener('change', () => {
    const h = new Set(data.settings.sideHidden || []); el.checked ? h.delete(el.dataset.sideOpt) : h.add(el.dataset.sideOpt);
    data.settings.sideHidden = [...h]; save(); render();
  }));
};
