/* Promemo — tempo di viaggio nell'interfaccia: "esci alle 15:20", impostazioni "Spostamenti" */
'use strict';
const TR_MODE = { car: ['🚗', 'in auto'], foot: ['🚶', 'a piedi'], bike: ['🚲', 'in bici'] };
const travelCfg = () => ({ enabled: false, mode: 'auto', buffer: 5, notify: true, home: null, ...(data.settings.travel || {}) });
const travelOf = (e) => (data.travel || {})[e._occ ? `${e.id}@${e._occ}` : e.id];
function travelBadge(e, compact) {
  const t = travelOf(e); if (!t || !t.leaveAt || t.same || !travelCfg().enabled) return '';
  const m = TR_MODE[t.mode] || TR_MODE.car;
  const late = parse(t.leaveAt) < new Date() && parse(e.start) > new Date();
  return compact ? `<div class="tg-ev-leave ${late ? 'late' : ''}">${m[0]} esci ${t.leaveAt.slice(11, 16)}</div>`
    : `<span class="sep"></span><span class="tl-leave ${late ? 'late' : ''}">${m[0]} esci alle ${t.leaveAt.slice(11, 16)} · ${t.min} min</span>`;
}
function travelSheetRow(e) {
  const t = travelOf(e); if (!t || !travelCfg().enabled) return '';
  if (t.error) return `<div class="sh-prop"><span>${icon('i-route')} Viaggio</span><span class="muted">${esc(t.error)}</span></div>`;
  if (t.same) return `<div class="sh-prop"><span>${icon('i-route')} Viaggio</span><span>Sei già lì dopo l'impegno precedente</span></div>`;
  const m = TR_MODE[t.mode] || TR_MODE.car;
  return `<div class="sh-prop"><span>${icon('i-route')} Esci alle</span><b>${t.leaveAt.slice(11, 16)} <span class="muted" style="font-weight:400">· ${m[0]} ${t.min} min ${m[1]} da ${esc(t.from)}${t.km ? ` · ${String(t.km).replace('.', ',')} km` : ''}</span></b></div>`;
}

SET_PANES.splice(SET_PANES.findIndex(p => p[0] === 'meteo') + 1, 0, ['spostamenti', 'i-route', 'Spostamenti']);
const _paneHTML_tr = paneHTML;
paneHTML = function (id, ls) {
  if (id !== 'spostamenti') return _paneHTML_tr(id, ls);
  const c = travelCfg();
  return `<h3>Spostamenti</h3>
    <p class="set-note" style="margin:-4px 0 12px">Per gli impegni con un luogo Promemo calcola il tragitto e ti dice a che ora uscire: da casa, oppure dal luogo dell'impegno precedente se è nella stessa giornata.</p>
    <div class="set-group">
      ${srow('Calcola il tempo di viaggio', 'Indirizzi e percorsi da OpenStreetMap', `<input type="checkbox" class="switch" data-tr="enabled" ${c.enabled ? 'checked' : ''}>`)}
      ${srow('Parti da', c.home ? esc(c.home.label || c.home.name) : 'Non impostato', `<form id="tr-form" class="row" style="gap:6px"><input class="set-input" id="tr-q" placeholder="Il tuo indirizzo" autocomplete="off"><button class="btn small">Cerca</button></form>`)}
      <div class="set-sub" id="tr-res" hidden></div>
      ${srow('Mezzo', 'Automatico: a piedi sotto 1,3 km, altrimenti in auto', segHTML('tr.mode', [['auto', 'Automatico'], ['car', 'Auto'], ['foot', 'A piedi'], ['bike', 'Bici']], c.mode))}
      ${srow('Margine', 'Tempo in più per prepararti', `<select class="set-select" data-tr="buffer">${[0, 5, 10, 15, 20, 30].map(m => `<option value="${m}" ${c.buffer === m ? 'selected' : ''}>${m ? m + ' min' : 'Nessuno'}</option>`).join('')}</select>`)}
      ${srow('Avvisami quando uscire', 'Una notifica qualche minuto prima', `<input type="checkbox" class="switch" data-tr="notify" ${c.notify ? 'checked' : ''}>`)}
    </div>
    <p class="set-note">Vengono inviati a OpenStreetMap solo gli indirizzi degli impegni, mai titoli o note. In auto il tempo include un 15% per il traffico e 5 minuti per parcheggiare.</p>`;
};
const _drawPane_tr = drawPane;
drawPane = function (m) {
  _drawPane_tr(m);
  if (setPane !== 'spostamenti') return;
  const box = m.querySelector('#set-pane');
  const set = (patch, redraw) => { data.settings.travel = { ...travelCfg(), ...patch }; save(); if (redraw) drawPane(m); setTimeout(() => api.travelRefresh(), 400); };
  box.querySelectorAll('[data-tr]').forEach(el => el.addEventListener('change', () => set({ [el.dataset.tr]: el.type === 'checkbox' ? el.checked : +el.value })));
  box.querySelector('[data-seg-set="tr.mode"]').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; box.querySelectorAll('[data-seg-set="tr.mode"] button').forEach(x => x.classList.toggle('on', x === b)); set({ mode: b.dataset.v }); });
  box.querySelector('#tr-form').addEventListener('submit', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const q = box.querySelector('#tr-q').value.trim(); if (!q) return;
    const res = box.querySelector('#tr-res'); res.hidden = false; res.innerHTML = '<span class="set-note">Cerco…</span>';
    const r = await api.travelSearch(q);
    if (!r.ok) { res.innerHTML = `<span class="set-note" style="color:#e0352b">${esc(r.error)}</span>`; return; }
    if (!r.value.length) { res.innerHTML = '<span class="set-note">Indirizzo non trovato: prova con via, numero e città.</span>'; return; }
    res.innerHTML = r.value.map((x, i) => `<button class="wx-place" data-i="${i}">${icon('i-pin')}<b>${esc(x.name)}</b><small>${esc(x.label)}</small></button>`).join('');
    res.querySelectorAll('.wx-place').forEach(b => b.addEventListener('click', () => { const x = r.value[+b.dataset.i]; const city = (x.label.split(',').map(s => s.trim()).find((s, i) => i > 0 && !/^\d/.test(s) && !/sardegna|italia|provincia|città metropolitana/i.test(s)) || ''); set({ home: { name: x.name, label: x.label, lat: x.lat, lon: x.lon, city }, enabled: true }, true); toast('Punto di partenza salvato'); }));
  }, true);
};
