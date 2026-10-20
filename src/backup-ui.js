/* Promemo — interfaccia dei backup (impostazioni, ripristino, avviso di versione più recente) */
'use strict';

const BK_TYPES = {
  folder: ['Cartella sincronizzata', 'MEGA, Dropbox, Nextcloud, Google Drive, OneDrive… tramite la loro app sul PC'],
  dropbox: ['Dropbox (diretto)', 'Senza app Dropbox installata: carica via internet'],
  webdav: ['WebDAV', 'Nextcloud, ownCloud, Koofr, kDrive, Box, NAS…'],
  rclone: ['rclone', 'MEGA, Google Drive, OneDrive, pCloud e altri 70 servizi'],
};
const bkCfg = () => ({ enabled: false, auto: 'change', keep: 10, checkRemote: true, delayMin: 10, ...(data.settings.backup || {}) });
let bkInfo = { hasPass: false, hasDropbox: false, hasWebdav: false }, bkDetected = [], bkBusy = false;
const fmtWhen = (iso) => { if (!iso) return 'mai'; const d = new Date(iso); return `${relDay(d).toLowerCase()} alle ${fmtHM(d)}`; };
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB';

function bkDestHTML(b) {
  const d = b.dest || {};
  if (d.type === 'folder') return `
    ${srow('Cartella', 'Dentro verrà creata la cartella <code>Promemo-backup</code>', `<input class="set-input" id="bk-path" value="${esc(d.path || '')}" placeholder="~/MEGA"><button class="btn small" data-bk="choose">Scegli…</button>`)}
    ${bkDetected.length ? `<div class="set-sub bk-detect"><span class="set-note">Trovate sul computer:</span>${bkDetected.map(x => `<button class="pill bk-chip ${d.path === x.path ? 'on' : ''}" data-bk="pick" data-path="${esc(x.path)}">${esc(x.name)} · ${esc(x.path.replace(/^\/home\/[^/]+/, '~'))}</button>`).join('')}</div>` : '<div class="set-sub"><span class="set-note">Installa l\'app del tuo servizio (es. MEGA Desktop, Dropbox, Nextcloud) e scegli la sua cartella: il servizio caricherà i backup online e li porterà sugli altri computer.</span></div>'}`;
  if (d.type === 'dropbox') return `
    ${srow('App key', 'Crea un\'app su dropbox.com/developers/apps · tipo “Scoped access”, accesso “App folder”, permessi files.content.write e files.content.read', `<input class="set-input" id="bk-dbx-key" value="${esc(d.appKey || '')}" placeholder="abc123xyz">`)}
    ${srow('Account', bkInfo.hasDropbox ? '<span style="color:var(--green)">Collegato ✓</span>' : 'Non collegato', `<button class="btn small" data-bk="dbx-start">${bkInfo.hasDropbox ? 'Ricollega' : 'Apri Dropbox'}</button>`)}
    <div class="set-sub" id="bk-dbx-code" hidden>${srow('Codice di accesso', 'Dopo aver autorizzato, Dropbox mostra un codice: incollalo qui', '<input class="set-input" id="bk-dbx-c" placeholder="Incolla il codice"><button class="btn small" data-bk="dbx-finish">Collega</button>')}</div>`;
  if (d.type === 'webdav') return `
    ${srow('Indirizzo', 'Es. Nextcloud: https://cloud.esempio.it/remote.php/dav/files/UTENTE/Promemo', `<input class="set-input wide" id="bk-url" value="${esc(d.url || '')}" placeholder="https://…">`)}
    ${srow('Utente', '', `<input class="set-input" id="bk-user" value="${esc(d.user || '')}">`)}
    ${srow('Password', bkInfo.hasWebdav ? 'Salvata ✓ (per Nextcloud usa una “password per app”)' : 'Per Nextcloud usa una “password per app”', '<input class="set-input" type="password" id="bk-wpass" placeholder="••••••"><button class="btn small" data-bk="wpass">Salva</button>')}`;
  if (d.type === 'rclone') return `
    ${srow('Percorso rclone', 'Configura prima il servizio con <code>rclone config</code> (es. un remoto “mega”), poi scrivi remoto:cartella', `<input class="set-input" id="bk-remote" value="${esc(d.remote || '')}" placeholder="mega:Promemo">`)}
    <div class="set-sub"><span class="set-note">Installazione: <code>sudo apt install rclone</code>. Funziona con MEGA, Google Drive, OneDrive, pCloud, Box, Proton Drive, S3 e molti altri.</span></div>`;
  return '';
}

function bkPaneHTML() {
  const b = bkCfg();
  const st = b.lastError ? `<span style="color:#e0352b">Ultimo tentativo non riuscito: ${esc(b.lastError)}</span>` : b.lastAt ? `Ultimo backup ${fmtWhen(b.lastAt)}${b.lastSize ? ' · ' + fmtSize(b.lastSize) : ''}${b.dirty ? ' · modifiche da salvare' : ' · tutto salvato'}` : 'Nessun backup ancora';
  return `<h3>Dati e backup</h3>
    <div class="bk-hero ${b.enabled ? 'on' : ''}">
      <div class="bk-ic">${icon('i-archive')}</div>
      <div class="grow"><b>${b.enabled ? 'Backup automatico attivo' : 'Backup automatico disattivato'}</b><small>${st}</small></div>
      <button class="btn small" data-bk="now" ${bkBusy || !b.dest ? 'disabled' : ''}>${bkBusy ? '<span class="spinner dark"></span> In corso…' : 'Esegui ora'}</button>
      <button class="btn small" data-bk="restore" ${!b.dest ? 'disabled' : ''}>Ripristina…</button>
    </div>
    <div class="set-group">
      ${srow('Backup automatico', 'Copia cifrata di progetti, eventi, note e impostazioni (le credenziali degli account non vengono mai incluse)', `<input type="checkbox" class="switch" id="bk-enabled" ${b.enabled ? 'checked' : ''}>`)}
      ${srow('Dove', BK_TYPES[b.dest?.type]?.[1] || 'Scegli una destinazione', `<select class="set-select" id="bk-type"><option value="">Scegli…</option>${Object.entries(BK_TYPES).map(([k, [l]]) => `<option value="${k}" ${b.dest?.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${bkDestHTML(b)}
      ${b.dest?.type ? srow('Verifica', '<span id="bk-test-st">Controlla che la destinazione sia raggiungibile</span>', '<button class="btn small" data-bk="test">Prova</button>') : ''}
    </div>
    <div class="set-group">
      ${srow('Password dei backup', bkInfo.hasPass ? 'Impostata ✓ · serve per ripristinare, anche su un altro computer: conservala' : 'Obbligatoria: i file vengono cifrati prima di lasciare il PC', `<input class="set-input" type="password" id="bk-pass" placeholder="${bkInfo.hasPass ? 'Nuova password' : 'Almeno 8 caratteri'}"><button class="btn small" data-bk="pass">${bkInfo.hasPass ? 'Cambia' : 'Imposta'}</button>`)}
    </div>
    <div class="set-group">
      ${srow('Quando', '', segHTML('bk.auto', [['change', 'Dopo le modifiche'], ['daily', 'Una volta al giorno'], ['manual', 'Solo a mano']], b.auto))}
      ${b.auto === 'change' ? srow('Attendi dopo l\'ultima modifica', 'Raggruppa più modifiche in un solo backup; viene fatto comunque alla chiusura', `<select class="set-select" id="bk-delay">${[2, 5, 10, 30].map(m => `<option value="${m}" ${+b.delayMin === m ? 'selected' : ''}>${m} minuti</option>`).join('')}</select>`) : ''}
      ${srow('Versioni da conservare', 'Le più vecchie vengono eliminate', `<select class="set-select" id="bk-keep">${[[5, '5'], [10, '10'], [30, '30'], [90, '90'], [0, 'Tutte']].map(([v, l]) => `<option value="${v}" ${+b.keep === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${srow('Sincronizza tra computer', 'Se su un altro PC viene salvato un backup più recente, Promemo ti propone di ripristinarlo', `<input type="checkbox" class="switch" id="bk-remote-chk" ${b.checkRemote !== false ? 'checked' : ''}>`)}
    </div>
    <div class="set-group">
      ${srow('Ripristina da un file', 'Un file .pmbak salvato altrove', '<button class="btn small" data-bk="file">Scegli file…</button>')}
      ${srow('Esporta in JSON', lockInfo.configured ? 'File leggibile, non cifrato: conservalo con cura' : 'File leggibile con tutti i dati', '<button class="btn small" data-action="export">Esporta…</button>')}
      ${srow('Importa da JSON', 'Sostituisce i dati attuali (gli account collegati restano)', '<button class="btn small" data-action="import">Importa…</button>')}
      ${srow('Cartella dei dati', '~/.config/Promemo', '<button class="btn small" data-action="folder">Apri</button>')}
    </div>`;
}

const _paneHTML_bk = paneHTML;
paneHTML = function (id, ls) { return id === 'dati' ? bkPaneHTML() : _paneHTML_bk(id, ls); };
const _drawPane_bk = drawPane;
let bkFetchedAt = 0;
drawPane = function (m) {
  _drawPane_bk(m);
  if (setPane !== 'dati') return;
  bindBk(m);
  if (Date.now() - bkFetchedAt > 3000) {
    bkFetchedAt = Date.now();
    Promise.all([api.bkStatus(), api.bkDetect()]).then(([st, d]) => { bkInfo = st || bkInfo; bkDetected = d || []; if (setPane === 'dati' && $('#modal').classList.contains('modal-settings')) drawPane(m); });
  }
};

function bkSet(patch, m, redraw = true) {
  data.settings.backup = { ...bkCfg(), ...patch };
  save();
  if (redraw && m) drawPane(m);
}

function bindBk(m) {
  const box = m.querySelector('#set-pane');
  const b = bkCfg();
  const q = (s) => box.querySelector(s);
  q('#bk-enabled')?.addEventListener('change', (e) => {
    if (e.target.checked && (!b.dest || !bkInfo.hasPass)) { e.target.checked = false; toast(!b.dest ? 'Scegli prima dove salvare i backup' : 'Imposta prima la password dei backup'); return; }
    bkSet({ enabled: e.target.checked }, m);
  });
  q('#bk-type')?.addEventListener('change', (e) => bkSet({ dest: e.target.value ? { type: e.target.value } : null, enabled: e.target.value ? b.enabled : false }, m));
  q('#bk-path')?.addEventListener('change', (e) => bkSet({ dest: { ...b.dest, path: e.target.value.trim() } }, m));
  q('#bk-url')?.addEventListener('change', (e) => bkSet({ dest: { ...b.dest, url: e.target.value.trim() } }, m, false));
  q('#bk-user')?.addEventListener('change', (e) => bkSet({ dest: { ...b.dest, user: e.target.value.trim() } }, m, false));
  q('#bk-remote')?.addEventListener('change', (e) => bkSet({ dest: { ...b.dest, remote: e.target.value.trim() } }, m, false));
  q('#bk-dbx-key')?.addEventListener('change', (e) => bkSet({ dest: { ...b.dest, appKey: e.target.value.trim() } }, m, false));
  q('#bk-delay')?.addEventListener('change', (e) => bkSet({ delayMin: +e.target.value }, m, false));
  q('#bk-keep')?.addEventListener('change', (e) => bkSet({ keep: +e.target.value }, m, false));
  q('#bk-remote-chk')?.addEventListener('change', (e) => bkSet({ checkRemote: e.target.checked }, m, false));
  box.querySelectorAll('[data-seg-set="bk.auto"] button').forEach(x => x.addEventListener('click', () => bkSet({ auto: x.dataset.v }, m)));
  box.querySelectorAll('[data-bk]').forEach(el => el.addEventListener('click', async () => {
    const a = el.dataset.bk;
    if (a === 'choose') { const p = await api.bkChooseFolder(); if (p) bkSet({ dest: { type: 'folder', path: p } }, m); }
    if (a === 'pick') bkSet({ dest: { type: 'folder', path: el.dataset.path } }, m);
    if (a === 'test') {
      const out = q('#bk-test-st'); out.textContent = 'Verifico…'; out.style.color = '';
      const r = await api.bkTest(bkCfg().dest);
      out.textContent = r.ok ? '✓ ' + r.value : '✕ ' + r.error; out.style.color = r.ok ? 'var(--green)' : '#e0352b';
    }
    if (a === 'pass') {
      const v = q('#bk-pass').value;
      let old;
      if (bkInfo.hasPass) { old = await askText('Password attuale dei backup', 'Per cambiarla, inserisci quella attuale.', true); if (old === null) return; }
      const r = await api.bkPass({ pass: v, old });
      if (!r.ok) return toast(r.error);
      bkInfo.hasPass = true; toast('Password dei backup salvata'); drawPane(m);
    }
    if (a === 'wpass') { const v = q('#bk-wpass').value; await api.bkSecret({ key: 'backup:webdav', value: v }); bkInfo.hasWebdav = !!v; toast('Password salvata'); drawPane(m); }
    if (a === 'dbx-start') {
      const k = q('#bk-dbx-key').value.trim(); bkSet({ dest: { ...bkCfg().dest, appKey: k } }, null, false);
      const r = await api.bkDbxStart(k);
      if (!r.ok) return toast(r.error);
      q('#bk-dbx-code').hidden = false; q('#bk-dbx-c').focus();
    }
    if (a === 'dbx-finish') {
      const r = await api.bkDbxFinish(q('#bk-dbx-c').value);
      if (!r.ok) return toast(r.error);
      bkInfo.hasDropbox = true; toast('Dropbox collegato'); drawPane(m);
    }
    if (a === 'now') {
      bkBusy = true; drawPane(m);
      const r = await api.bkNow();
      bkBusy = false;
      toast(r.ok ? (r.value?.skipped ? 'Backup già in corso' : 'Backup completato') : r.error);
      setTimeout(() => drawPane(m), 50);
    }
    if (a === 'restore') modalRestore();
    if (a === 'file') {
      const r = await api.bkPeekFile();
      if (!r.ok) return toast(r.error);
      if (!r.value) return;
      confirmRestore({ file: r.value.file, createdAt: r.value.header.createdAt, device: r.value.header.device });
    }
  }));
}

// piccolo dialogo di testo (sostituisce prompt(), che in Electron non esiste)
function askText(title, sub, password) {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'ask-layer';
    layer.innerHTML = `<form class="ask-box"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}<input type="${password ? 'password' : 'text'}" autocomplete="off"><div class="modal-actions"><button type="button" class="btn" data-x>Annulla</button><button class="btn-primary">OK</button></div></form>`;
    document.body.appendChild(layer);
    const inp = layer.querySelector('input'); setTimeout(() => inp.focus(), 30);
    const done = (v) => { layer.remove(); resolve(v); };
    layer.querySelector('[data-x]').addEventListener('click', () => done(null));
    layer.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(inp.value); });
    layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
  });
}

async function modalRestore() {
  openModal(`<h2>Ripristina un backup</h2><p class="muted" style="margin-top:-6px">Scegli una versione. I dati attuali vengono sostituiti (prima ne salvo una copia di sicurezza); account collegati, password e impostazioni dei backup restano quelli di questo computer.</p>
    <div class="bk-list" id="bk-list"><div class="empty">Carico l'elenco…</div></div>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Chiudi</button></div>`, async (m) => {
      const r = await api.bkList();
      const box = m.querySelector('#bk-list');
      if (!r.ok) { box.innerHTML = `<div class="form-err">${esc(r.error)}</div>`; return; }
      if (!r.value.length) { box.innerHTML = '<div class="empty">Nessun backup trovato nella destinazione.</div>'; return; }
      const b = bkCfg();
      box.innerHTML = r.value.map((x, i) => `<button class="bk-row" data-i="${i}">
        <span class="bk-row-ic">${icon('i-archive')}</span>
        <span class="grow"><b>${new Date(x.createdAt).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</b><small>${esc(x.device)}${x.size ? ' · ' + fmtSize(x.size) : ''}${x.name === b.lastName ? ' · ultimo di questo PC' : ''}${i === 0 ? ' · il più recente' : ''}</small></span>
        ${icon('i-chev-r', 'chev')}</button>`).join('');
      box.addEventListener('click', (e) => { const el = e.target.closest('.bk-row'); if (el) confirmRestore(r.value[+el.dataset.i]); });
    });
}

async function confirmRestore(item) {
  try { bkInfo = (await api.bkStatus()) || bkInfo; } catch {}
  const when = new Date(item.createdAt).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  openModal(`<h2>Ripristinare il backup del ${esc(when)}?</h2>
    <p class="muted" style="margin-top:-6px">Creato su <b>${esc(item.device || '?')}</b>. Progetti, eventi, note e impostazioni attuali verranno sostituiti.</p>
    <form class="form" data-submit="bk-restore">
      <label class="field"><span>Password dei backup ${bkInfo.hasPass ? '(lascia vuoto per usare quella salvata)' : ''}</span><input type="password" name="pw" ${bkInfo.hasPass ? '' : 'required'}></label>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Ripristina</button></div>
    </form>`, (m) => { m.querySelector('form')._item = item; });
}
submits['bk-restore'] = async (f, fd) => {
  const it = f._item;
  setBusy(f, true, 'Ripristino…');
  const r = await api.bkRestore({ name: it.file ? null : it.name, file: it.file || null, password: fd.get('pw') || null });
  setBusy(f, false);
  if (!r.ok) return showErr(f, r.error);
  closeModal(); hideBkBanner(); toast('Dati ripristinati');
};

// ---------- avviso: c'è un backup più recente da un altro computer ----------
function hideBkBanner() { document.querySelector('.bk-banner')?.remove(); }
api.onBackupRemote((item) => {
  if (!data) return;
  hideBkBanner();
  const el = document.createElement('div');
  el.className = 'bk-banner';
  el.innerHTML = `${icon('i-sync')}<div class="grow"><b>C'è una versione più recente dei tuoi dati</b><small>Salvata su ${esc(item.device)} ${fmtWhen(item.createdAt)}. Vuoi portarla su questo computer?</small></div>
    <button class="btn small" data-x="no">Ignora</button><button class="btn-primary small-p" data-x="yes">Aggiorna</button>`;
  document.querySelector('.toolbar').after(el);
  el.querySelector('[data-x=no]').addEventListener('click', () => { api.bkDismiss(item.name); hideBkBanner(); });
  el.querySelector('[data-x=yes]').addEventListener('click', () => confirmRestore(item));
});
api.onBackupStatus((st) => {
  const b = document.querySelector('[data-bk=now]');
  if (st.backup === 'running') { bkBusy = true; if (b) { b.disabled = true; b.innerHTML = '<span class="spinner dark"></span> In corso…'; } }
  else { bkBusy = false; const m = $('#modal'); if (m.classList.contains('modal-settings') && setPane === 'dati') drawPane(m); }
});
