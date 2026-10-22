/* Promemo — impostazioni per widget, scorciatoia globale e telefono */
'use strict';
let mobSt = null, mobQr = {}, psySt = null, mobLoaded = false;
const SC_LABEL = (s) => String(s || '').replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + ');
SET_PANES.splice(SET_PANES.findIndex(p => p[0] === 'notifiche') + 1, 0, ['desktop', 'i-widget', 'Widget e scorciatoie'], ['telefono', 'i-phone', 'Telefono']);
const _paneHTML_dk = paneHTML;
paneHTML = function (id, ls) {
  if (id === 'desktop') {
    const w = { enabled: false, onTop: true, ...(data.settings.widget || {}) };
    const sc = data.settings.quickShortcut ?? 'CommandOrControl+Alt+Space';
    return `<h3>Widget e scorciatoie</h3>
      <div class="set-group">
        ${srow('Widget sul desktop', 'Un riquadro sempre visibile con il prossimo impegno, il conto alla rovescia e la giornata. Si sposta trascinandolo', `<input type="checkbox" class="switch" data-dk="widget" ${w.enabled ? 'checked' : ''}>`)}
        ${srow('Sempre in primo piano', 'Sopra le altre finestre', `<input type="checkbox" class="switch" data-dk="onTop" ${w.onTop ? 'checked' : ''}>`)}
      </div>
      <div class="set-group">
        ${srow('Aggiunta rapida da qualsiasi app', `Premi la scorciatoia, scrivi una frase e Invio · <span id="dk-sc-st"></span>`, `<select class="set-select" data-dk="sc">${['CommandOrControl+Alt+Space', 'Super+Alt+Space', 'CommandOrControl+Shift+Space', 'Alt+Space', 'CommandOrControl+Alt+N', ''].map(x => `<option value="${x}" ${x === sc ? 'selected' : ''}>${x ? SC_LABEL(x) : 'Nessuna'}</option>`).join('')}</select><button class="btn small" data-dk-try>Prova</button>`)}
      </div>
      <p class="set-note">Su GNOME con Wayland le scorciatoie globali delle app possono non funzionare: in <i>Impostazioni di sistema → Tastiera → Scorciatoie personalizzate</i> aggiungi il comando <code><span id="dk-exec">promemo</span> --aggiungi</code> (oppure <code>--widget</code> per mostrare e nascondere il widget).</p>`;
  }
  if (id === 'telefono') {
    const s = mobSt || {}; const c = { enabled: false, port: 8787, ...(data.settings.mobile || {}) };
    const main = (s.addresses || []).filter(a => !a.vpn), vpn = (s.addresses || []).filter(a => a.vpn);
    const sel = mobQr.ip || (main[0] || vpn[0] || {}).ip;
    const cur = (s.addresses || []).find(a => a.ip === sel);
    return `<h3>Promemo sul telefono</h3>
      <p class="set-note" style="margin:-4px 0 12px">Il telefono apre un'app web servita da questo computer: agenda di oggi e della settimana, compiti da spuntare, progetti, viaggi e aggiunta con una frase. Funziona nella rete di casa; fuori casa attraverso la tua VPN (es. WireGuard).</p>
      <div class="set-group">
        ${srow('Accesso dal telefono', s.running ? `<span style="color:var(--green)">Attivo sulla porta ${s.port}</span>` : s.error ? `<span style="color:#e0352b">${esc(s.error)}</span>` : 'Spento', `<input type="checkbox" class="switch" data-mb="enabled" ${c.enabled ? 'checked' : ''}>`)}
        ${srow('Porta', '', `<input class="set-input" type="number" min="1024" max="65535" style="width:96px" data-mb="port" value="${c.port}">`)}
      </div>
      <h3 style="margin-top:20px">App Android e sincronizzazione</h3>
      <div class="set-group">
        ${srow('Sincronizza con l’app Android', 'Modifiche in entrambe le direzioni: in rete subito, fuori casa attraverso il cloud dei backup', `<input type="checkbox" class="switch" data-ps="enabled" ${(psySt || {}).enabled ? 'checked' : ''}>`)}
        ${(psySt || {}).enabled ? srow('Anche fuori casa (cloud)', (psySt.dest && psySt.hasPass) ? (['webdav', 'dropbox'].includes(psySt.dest) ? `Attraverso ${psySt.dest === 'dropbox' ? 'Dropbox' : 'WebDAV/Nextcloud'}, cifrato con la password dei backup` : `La destinazione dei backup (${esc(psySt.dest)}) non è raggiungibile dal telefono: usa Dropbox o WebDAV`) : 'Configura prima una destinazione e la password in <a class="link" data-pane-go="dati">Dati e backup</a>', `<input type="checkbox" class="switch" data-ps="cloud" ${psySt.cloud !== false ? 'checked' : ''}>`) : ''}
        ${(psySt || {}).enabled ? srow('Stato', psySt.lastError ? `<span style="color:#e0352b">${esc(psySt.lastError)}</span>` : psySt.lastAt ? `Ultima sincronizzazione ${esc(stamp(psySt.lastAt).toLowerCase())}${Object.values(psySt.phones || {}).length ? ' · ' + Object.values(psySt.phones).map(p => `${esc(p.name)} (${p.via})`).join(', ') : ''}` : 'In attesa del primo collegamento dal telefono', '<button class="btn small" data-ps-now>Sincronizza ora</button>') : ''}
        ${srow('Scarica l’app', 'Il file .apk si trova tra gli allegati di ogni release su GitHub', '<button class="btn small" data-action="open-url" data-url="https://github.com/danieledemichele/Promemo/releases/latest">Apri le release</button>')}
      </div>
      ${c.enabled && s.running ? `<div class="mb-pair">
        <div class="mb-qr" id="mb-qr">${mobQr.svg || '<span class="spinner"></span>'}</div>
        <div class="mb-txt"><div class="segmented" style="margin-bottom:8px"><button class="${mobQr.mode !== 'web' ? 'on' : ''}" data-mb-mode="app">App Android</button><button class="${mobQr.mode === 'web' ? 'on' : ''}" data-mb-mode="web">Browser</button></div>
          <b>Abbina il telefono</b>${mobQr.mode !== 'web' ? '<ol><li>Collega il telefono alla stessa rete (o alla VPN).</li><li>Inquadra il codice con la fotocamera (o con Google Lens) e scegli <i>Apri con Promemo</i>.</li><li>L’app scarica i dati e, se attivo, riceve anche l’accesso al cloud per sincronizzarsi fuori casa.</li></ol>' : '<ol><li>Collega il telefono alla stessa rete (o alla VPN).</li><li>Inquadra il codice con la fotocamera e apri il link.</li><li>Dal menu del browser scegli <i>Aggiungi a schermata Home</i>.</li></ol>'}
          ${(s.addresses || []).length > 1 ? `<div class="mb-ips">${(s.addresses || []).map(a => `<button class="${a.ip === sel ? 'on' : ''}" data-mb-ip="${a.ip}">${esc(a.ip)}<small>${a.vpn ? 'VPN · ' : ''}${esc(a.iface)}</small></button>`).join('')}</div>` : ''}
          ${cur ? `<code class="mb-url">${esc(cur.url.replace(/#k=.*/, ''))}</code>` : '<span class="muted">Nessuna rete trovata</span>'}
          <div class="row" style="gap:6px;margin-top:10px"><button class="btn small" data-mb-new>Nuova chiave</button><span class="set-note" style="margin:0">scollega i telefoni già abbinati</span></div>
        </div></div>` : ''}
      <p class="set-note">Il collegamento non è cifrato (HTTP): usalo nella rete di casa o dentro una VPN. Senza la chiave contenuta nel codice QR nessuno può leggere i tuoi dati.${Object.keys(s.seen || {}).length ? ` Ultimo accesso: ${esc(stamp(Object.values(s.seen).sort().pop()).toLowerCase())}.` : ''}</p>`;
  }
  return _paneHTML_dk(id, ls);
};
async function mobRefresh(m, ip) {
  mobSt = await api.mobileStatus();
  const a = (mobSt.addresses || []).find(x => x.ip === (ip || mobQr.ip)) || (mobSt.addresses || [])[0];
  const mode = mobQr.mode || 'app';
  const appUrl = a ? `promemo://abbina?h=${encodeURIComponent(a.ip + ':' + mobSt.port)}&k=${encodeURIComponent(a.url.split('#k=')[1] || '')}` : '';
  mobQr = a ? { ip: a.ip, mode, appUrl, svg: await api.mobileQr(mode === 'app' ? appUrl : a.url) } : {};
  psySt = await api.psyncStatus();
  if (setPane === 'telefono' && $('#modal').classList.contains('modal-settings')) _drawPane_dk_inner(m);
}
const _drawPane_dk = drawPane;
function _drawPane_dk_inner(m) { drawPane(m); }
drawPane = function (m) {
  _drawPane_dk(m);
  const box = m.querySelector('#set-pane');
  if (setPane === 'desktop') {
    api.shortcutState().then(s => { const ex = box.querySelector('#dk-exec'); if (ex && s.exec) ex.textContent = s.exec; const el = box.querySelector('#dk-sc-st'); if (el) el.innerHTML = !s.shortcut ? 'disattivata' : s.ok ? '<span style="color:var(--green)">attiva</span>' : s.ok === false ? `<span style="color:#e0352b">non disponibile${s.wayland ? ' (Wayland)' : ''}: usa il comando qui sotto</span>` : ''; });
    box.querySelector('[data-dk=widget]').addEventListener('change', (e) => api.widgetToggle(e.target.checked));
    box.querySelector('[data-dk=onTop]').addEventListener('change', (e) => api.widgetSet({ onTop: e.target.checked }));
    box.querySelector('[data-dk=sc]').addEventListener('change', async (e) => { data.settings.quickShortcut = e.target.value; await flushSave(); const ok = await api.shortcutSet(e.target.value); toast(e.target.value ? (ok ? 'Scorciatoia attiva' : 'Scorciatoia non disponibile') : 'Scorciatoia disattivata'); drawPane(m); });
    box.querySelector('[data-dk-try]').addEventListener('click', () => api.quickOpen());
  }
  if (setPane === 'telefono') {
    if (!mobLoaded) { mobLoaded = true; mobRefresh(m); }
    box.querySelectorAll('[data-mb]').forEach(el => el.addEventListener('change', async () => {
      await flushSave();
      mobSt = await api.mobileSet({ [el.dataset.mb]: el.type === 'checkbox' ? el.checked : +el.value });
      const d = await api.getData(); if (d) data = d;
      mobQr = {}; drawPane(m); setTimeout(() => mobRefresh(m), 400);
    }));
    box.querySelectorAll('[data-mb-ip]').forEach(b => b.addEventListener('click', () => mobRefresh(m, b.dataset.mbIp)));
    box.querySelectorAll('[data-mb-mode]').forEach(b => b.addEventListener('click', () => { mobQr.mode = b.dataset.mbMode; mobRefresh(m); }));
    box.querySelectorAll('[data-ps]').forEach(el => el.addEventListener('change', async () => {
      const k = el.dataset.ps; await flushSave();
      if (k === 'enabled' && el.checked && !(data.settings.mobile || {}).enabled) mobSt = await api.mobileSet({ enabled: true });
      psySt = { ...(await api.psyncSet({ [k]: el.checked })), dest: psySt && psySt.dest, hasPass: psySt && psySt.hasPass };
      const d = await api.getData(); if (d) data = d; mobRefresh(m);
    }));
    box.querySelector('[data-ps-now]')?.addEventListener('click', async (e) => { const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span>'; const r = await api.psyncNow(); toast(r.ok ? (r.value == null ? 'Niente da sincronizzare nel cloud' : `Sincronizzato · ${r.value} modifiche ricevute`) : r.error); mobRefresh(m); });
    box.querySelector('[data-pane-go]')?.addEventListener('click', () => { setPane = 'dati'; m.querySelectorAll('.set-nav-i').forEach(x => x.classList.toggle('on', x.dataset.pane === 'dati')); drawPane(m); });
    box.querySelector('[data-mb-new]')?.addEventListener('click', async () => { await flushSave(); await api.mobileSet({ newToken: true }); const d = await api.getData(); if (d) data = d; toast('Nuova chiave: abbina di nuovo il telefono'); mobRefresh(m); });
  }
};
api.onMobileStatus((s) => { mobSt = s; });
const _modalSettings_dk = modalSettings;
modalSettings = async function (pane) { mobLoaded = false; return _modalSettings_dk(pane); };
PALETTE_EXTRA.push(
  { t: 'Aggiunta rapida (finestra)', i: 'i-spark', k: 'scorciatoia frase veloce', run: () => api.quickOpen() },
  { t: 'Mostra o nascondi il widget', i: 'i-widget', k: 'desktop riquadro', run: () => api.widgetToggle() },
  { t: 'Abbina il telefono', i: 'i-phone', k: 'mobile cellulare qr', run: () => modalSettings('telefono') },
);
