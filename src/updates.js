/* Promemo — avviso di aggiornamento accanto al meteo e pagina “Aggiornamenti” nelle impostazioni */
'use strict';

let upd = null, updVer = '', updQuiet = false;
const updCfg = () => ({ auto: true, skip: '', ...(data && data.settings.update || {}) });

function updMd(txt) {
  const inl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>').replace(/_([^_\s][^_]*?)_/g, '<i>$1</i>');
  let html = '', list = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const l = raw.trim();
    const li = l.match(/^[-*•]\s+(.*)/);
    if (li) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inl(li[1])}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (!l) continue;
    const h = l.match(/^#{1,4}\s+(.*)/);
    html += h ? `<h4>${inl(h[1])}</h4>` : `<p>${inl(l)}</p>`;
  }
  return html + (list ? '</ul>' : '') || '<p class="muted">Nessuna nota di rilascio.</p>';
}
const updSize = (b) => b >= 1048576 ? `${(b / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 0 })} MB` : '';
const updShown = () => !!(upd && upd.available && updCfg().skip !== upd.available.version);

function renderUpdButton() {
  const b = $('#btn-upd'); if (!b) return;
  const on = updShown() || !!(upd && upd.installing);
  b.hidden = !on;
  if (!on) return;
  b.classList.toggle('blink', !updQuiet && !upd.installing);
  b.querySelector('span').textContent = upd.installing ? (upd.progress != null ? `Scarico ${Math.round(upd.progress * 100)}%` : 'Installo…') : `Aggiornamento ${upd.available.version}`;
  b.title = upd.installing ? 'Aggiornamento in corso' : `Promemo ${upd.available.version} è disponibile (hai la ${upd.current})`;
}

function updActionLabel() {
  if (!upd) return '';
  const a = upd.available;
  if (upd.mode === 'appimage' && a.appimage) return 'Aggiorna e riavvia';
  if (upd.mode === 'deb' && a.deb) return 'Installa e riavvia';
  return 'Apri la pagina di download';
}
function updPopHTML() {
  const a = upd.available;
  const prog = upd.installing ? `<div class="upd-prog"><i style="width:${upd.progress != null ? Math.round(upd.progress * 100) : 100}%" class="${upd.progress == null ? 'ind' : ''}"></i></div><div class="tiny" style="margin-top:6px">${upd.progress != null ? `Scarico… ${Math.round(upd.progress * 100)}%` : upd.mode === 'deb' ? 'Installo: conferma con la password del computer' : 'Preparo…'}</div>` : '';
  const how = upd.mode === 'appimage' ? `Promemo scarica la nuova AppImage${a.appimage && updSize(a.appimage.size) ? ' (' + updSize(a.appimage.size) + ')' : ''}, sostituisce quella attuale e si riapre.`
    : upd.mode === 'deb' ? `Promemo scarica il pacchetto .deb${a.deb && updSize(a.deb.size) ? ' (' + updSize(a.deb.size) + ')' : ''} e lo installa: il sistema ti chiederà la password.`
    : 'Si apre la pagina della release su GitHub da cui scaricare il pacchetto.';
  return `<div class="menu upd-pop">
    <div class="upd-head"><span class="upd-badge">${icon('i-spark')}</span><div class="grow"><b>Promemo ${esc(a.version)} è disponibile</b><small>Hai la ${esc(upd.current)}${a.date ? ' · pubblicata ' + esc(relDay(new Date(a.date)).toLowerCase()) : ''}</small></div></div>
    <div class="upd-notes">${updMd(a.notes)}</div>
    ${upd.error ? `<div class="form-err">${esc(upd.error)}</div>
      ${upd.mode === 'deb' && upd.file ? `<div class="upd-fix"><span>Oppure dal terminale:</span><code>sudo apt install ${esc(upd.file.path)}</code><div class="row" style="gap:6px;margin-top:6px"><button class="btn small" data-upd="copy">Copia il comando</button><button class="btn small" data-upd="reveal">Apri la cartella</button>${upd.detail ? '<button class="link" data-upd="detail">Dettagli</button>' : ''}</div>${upd.detail ? `<pre class="upd-detail" hidden>${esc(upd.detail)}</pre>` : ''}</div>` : ''}` : ''}
    ${prog || `<p class="upd-how">${how}</p>`}
    <div class="upd-actions">
      <button class="link" data-upd="skip">Salta questa versione</button><span class="grow"></span>
      <button class="btn small" data-upd="later">Più tardi</button>
      <button class="btn-primary small" data-upd="install" ${upd.installing ? 'disabled' : ''}>${upd.error && !upd.installing ? 'Riprova' : esc(updActionLabel())}</button>
    </div>
  </div>`;
}
function openUpdPop() {
  if (!upd || !upd.available) return;
  const layer = $('#popover-layer');
  layer.innerHTML = updPopHTML();
  const m = layer.firstChild, r = $('#btn-upd').getBoundingClientRect();
  m.style.top = (r.bottom + 8) + 'px';
  m.style.left = Math.max(12, Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - 12)) + 'px';
  const close = () => { if (layer.firstChild === m) layer.innerHTML = ''; document.removeEventListener('mousedown', out, true); };
  const out = (e) => { if (!m.isConnected) return document.removeEventListener('mousedown', out, true); if (!m.contains(e.target) && !e.target.closest('#btn-upd')) close(); };
  setTimeout(() => document.addEventListener('mousedown', out, true));
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-upd]'); if (!b) return;
    const k = b.dataset.upd;
    if (k === 'later') { updQuiet = true; if (upd.error) upd = await api.updReset(); renderUpdButton(); close(); toast('Te lo ricordo al prossimo avvio'); }
    if (k === 'copy') { try { await navigator.clipboard.writeText(`sudo apt install ${upd.file.path}`); toast('Comando copiato: incollalo nel terminale'); } catch { toast('Copia non riuscita'); } return; }
    if (k === 'reveal') { api.updReveal(); return; }
    if (k === 'detail') { const p = m.querySelector('.upd-detail'); if (p) p.hidden = !p.hidden; return; }
    if (k === 'skip') { data.settings.update = { ...updCfg(), skip: upd.available.version }; save(); close(); renderUpdButton(); toast(`Versione ${upd.available.version} saltata`); }
    if (k === 'install') { const r2 = await api.updInstall(); upd = r2; if (r2.restarting) toast('Riavvio Promemo…'); refreshUpdPop(); }
  });
}
function refreshUpdPop() {
  const m = $('#popover-layer .upd-pop'); if (!m || !upd || !upd.available) return;
  const pos = [m.style.top, m.style.left];
  const tmp = document.createElement('div'); tmp.innerHTML = updPopHTML();
  m.innerHTML = tmp.firstChild.innerHTML; [m.style.top, m.style.left] = pos;
}

// ---------- impostazioni: Aggiornamenti ----------
SET_PANES.push(['aggiornamenti', 'i-refresh', 'Aggiornamenti']);
const _paneHTML_upd = paneHTML;
paneHTML = function (id, ls) {
  if (id !== 'aggiornamenti') return _paneHTML_upd(id, ls);
  const c = updCfg(), u = upd || {};
  const status = u.checking ? '<span class="spinner"></span> Controllo…'
    : u.available ? `<b style="color:var(--accent-ink)">Disponibile la ${esc(u.available.version)}</b>`
    : u.error ? `<span style="color:#e0352b">${esc(u.error)}</span>`
    : u.checkedAt ? `Sei aggiornato · controllato ${esc(stamp(u.checkedAt).toLowerCase())}` : 'Non ancora controllato';
  const modeTxt = { appimage: 'AppImage: aggiornamento automatico con riavvio', deb: 'Pacchetto .deb: installazione con la password del sistema', manual: 'Versione di sviluppo: si apre la pagina di download' }[u.mode] || '';
  return `<h3>Aggiornamenti</h3>
    <div class="set-group">
      ${srow(`Promemo ${esc(u.current || updVer)}`, status, `<button class="btn small" data-upd-set="check" ${u.checking ? 'disabled' : ''}>${icon('i-refresh')} Controlla ora</button>${u.available && c.skip !== u.available.version ? '<button class="btn-primary small" data-upd-set="open">Vedi novità</button>' : ''}`)}
      ${srow('Controlla automaticamente', 'All’avvio e ogni 6 ore. Quando c’è una nuova versione, accanto al meteo compare un riquadro che lampeggia', `<input type="checkbox" class="switch" data-upd-set="auto" ${c.auto ? 'checked' : ''}>`)}
      ${c.skip ? srow('Versione saltata', esc(c.skip), '<button class="btn small" data-upd-set="unskip">Mostrala di nuovo</button>') : ''}
      ${modeTxt ? srow('Installazione', modeTxt, '') : ''}
    </div>
    <p class="set-note">Le versioni arrivano dalle release pubblicate su GitHub (danieledemichele/Promemo). Viene contattato solo GitHub, senza inviare dati personali.</p>`;
};
const _drawPane_upd = drawPane;
drawPane = function (m) {
  _drawPane_upd(m);
  if (setPane !== 'aggiornamenti') return;
  const box = m.querySelector('#set-pane');
  box.querySelectorAll('[data-upd-set]').forEach(el => el.addEventListener(el.type === 'checkbox' ? 'change' : 'click', async () => {
    const k = el.dataset.updSet;
    if (k === 'auto') { data.settings.update = { ...updCfg(), auto: el.checked }; save(); return; }
    if (k === 'unskip') { data.settings.update = { ...updCfg(), skip: '' }; save(); renderUpdButton(); drawPane(m); return; }
    if (k === 'open') { closeModal(); updQuiet = false; renderUpdButton(); setTimeout(openUpdPop, 50); return; }
    if (k === 'check') { upd = { ...(upd || {}), checking: true }; drawPane(m); upd = await api.updCheck(); renderUpdButton(); drawPane(m); }
  }));
};

// ---------- avvio ----------
(function () {
  const wxb = $('#btn-wx');
  wxb.insertAdjacentHTML('beforebegin', `<button class="upd-btn" id="btn-upd" hidden><i></i><span>Aggiornamento</span></button>`);
  $('#btn-upd').addEventListener('click', () => { if ($('#popover-layer .upd-pop')) { $('#popover-layer').innerHTML = ''; return; } openUpdPop(); });
  api.onUpdate((s) => {
    const wasNew = !(upd && upd.available) || (s.available && upd.available.version !== s.available.version);
    upd = s; if (wasNew && s.available) updQuiet = false;
    renderUpdButton(); refreshUpdPop();
    if ($('#modal').classList.contains('modal-settings') && setPane === 'aggiornamenti') drawPane($('#modal'));
  });
  api.updState().then(s => { upd = s; renderUpdButton(); });
  api.appVersion().then(v => { updVer = v; });
})();
