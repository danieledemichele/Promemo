/* Promemo — impostazioni: tutte le integrazioni in una scheda */
'use strict';

const INT_PROV = [
  ['google', 'Google Calendar', 'Calendari Gmail e Workspace, in entrambe le direzioni', 'add-google'],
  ['notion', 'Notion', 'Ogni database con una data diventa un calendario: lezioni, allenamenti, scadenze…', 'add-notion'],
  ['calendly', 'Calendly', 'Prenotazioni con nome, email e risposte di chi prenota', 'add-calendly'],
  ['ics', 'Calendari web (.ics)', 'Università, festività, calendari condivisi: solo lettura', 'add-ics'],
];
function intAccRow(a) {
  const n = data.events.filter(e => e.source && e.source.acc === a.id).length;
  const sub = a.error ? `<span style="color:#e0352b">${esc(a.error)}</span>` : `${n} eventi${a.lastSync ? ' · aggiornato ' + esc(stamp(a.lastSync).toLowerCase()) : ''}${a.enabled ? '' : ' · in pausa'}`;
  return `<div class="int-acc">
    <span class="int-dot" style="background:${esc((a.groups && a.groups[0] && a.groups[0].color) || '#8e8e93')}"></span>
    <div class="grow"><div class="int-acc-n">${esc(a.name)}</div><small>${sub}</small></div>
    <button class="icon-btn" data-int="sync" data-id="${a.id}" title="Sincronizza ora">${icon('i-refresh')}</button>
    <input type="checkbox" class="switch" data-int-on="${a.id}" ${a.enabled ? 'checked' : ''} title="Attivo">
  </div>`;
}
function intCard(ic, title, sub, status, btn, extra = '') {
  return `<div class="int-card"><div class="int-top">${ic}<div class="grow"><b>${title}</b><small>${sub}</small></div>${status ? `<span class="int-st ${status[1]}">${status[0]}</span>` : ''}${btn}</div>${extra}</div>`;
}

SET_PANES.splice(1, 0, ['integrazioni', 'i-sync', 'Integrazioni']);
const _paneHTML_int = paneHTML;
paneHTML = function (id, ls) {
  if (id !== 'integrazioni') return _paneHTML_int(id, ls);
  const accs = data.accounts || [], s = data.settings;
  const cals = INT_PROV.map(([p, name, sub, act]) => {
    const mine = accs.filter(a => a.provider === p);
    const err = mine.some(a => a.error);
    return intCard(`<span class="prov prov-${p}">${provLetter(p)}</span>`, name, sub,
      mine.length ? [err ? 'Da controllare' : mine.length > 1 ? `${mine.length} collegati` : 'Collegato', err ? 'warn' : 'ok'] : null,
      `<button class="btn small" data-int="add" data-act="${act}">${icon('i-plus')} ${mine.length ? 'Aggiungi' : 'Collega'}</button>`,
      mine.length ? `<div class="int-accs">${mine.map(intAccRow).join('')}</div>` : '');
  }).join('');
  const notion = accs.some(a => a.provider === 'notion');
  const tc = s.trips || {}, nTrips = Object.keys(data.trips || {}).length;
  const ai = { provider: 'none', ...(s.ai || {}) }, AIN = { none: 'Non attivo', anthropic: 'Claude (Anthropic)', ollama: 'Ollama', openai: 'Compatibile OpenAI' };
  const bk = s.backup || {}, BKN = { folder: 'cartella', dropbox: 'Dropbox', webdav: 'WebDAV / Nextcloud', rclone: 'rclone' };
  const wxc = { enabled: true, name: 'Cagliari', ...(s.weather || {}) };
  const u = (typeof upd !== 'undefined' && upd) || {};
  return `<h3>Integrazioni</h3>
    <p class="set-note" style="margin:-4px 0 14px">Tutti i servizi collegati a Promemo, in un posto. Le credenziali restano su questo computer${lockInfo.configured ? ', cifrate con la tua password' : ''}.</p>
    <div class="int-sec">Calendari e agende</div>
    ${cals}
    <div class="int-sec">Notion</div>
    ${intCard(`<span class="int-ic">${icon('c-plane')}</span>`, 'Viaggi', 'Destinazioni e itinerari dal tuo planner, con racconti scritti dall’IA',
      tc.destDb ? [`${nTrips} viaggi`, 'ok'] : null,
      notion ? `<button class="btn small" data-int="trips">${tc.destDb ? 'Cambia database' : 'Imposta'}</button>` : '<span class="int-hint">Collega prima Notion</span>')}
    ${intCard(`<span class="int-ic">${icon('i-db')}</span>`, 'Database Notion', 'Sfoglia e modifica qualsiasi database condiviso con l’integrazione',
      null, notion ? `<button class="btn small" data-int="ndb">Apri</button>` : '<span class="int-hint">Collega prima Notion</span>')}
    <div class="int-sec">Servizi</div>
    ${intCard(`<span class="int-ic">${icon('i-spark')}</span>`, 'Assistente IA', 'Organizza la giornata e scrive i racconti dei viaggi',
      ai.provider !== 'none' ? [AIN[ai.provider] || ai.provider, 'ok'] : null, `<button class="btn small" data-int-pane="assistente">Configura</button>`)}
    ${intCard(`<span class="int-ic">${icon('i-sun')}</span>`, 'Meteo', 'Open-Meteo, gratuito e senza account',
      wxc.enabled ? [esc(wxc.name), 'ok'] : ['Spento', ''], `<button class="btn small" data-int-pane="meteo">Configura</button>`)}
    ${intCard(`<span class="int-ic">${icon('i-archive')}</span>`, 'Backup nel cloud', 'Copie cifrate su cartella sincronizzata, Dropbox, Nextcloud o rclone',
      bk.enabled && bk.dest ? [BKN[bk.dest.type || bk.dest] || 'Attivo', 'ok'] : null, `<button class="btn small" data-int-pane="dati">Configura</button>`)}
    ${intCard(`<span class="int-ic">${icon('i-refresh')}</span>`, 'Aggiornamenti da GitHub', 'Nuove versioni di Promemo, con avviso accanto al meteo',
      u.available ? [`Disponibile la ${esc(u.available.version)}`, 'warn'] : (s.update || {}).auto === false ? ['Manuale', ''] : ['Automatico', 'ok'], `<button class="btn small" data-int-pane="aggiornamenti">Apri</button>`)}
    <div class="int-sec">Sincronizzazione</div>
    <div class="set-group">
      ${srow('Frequenza', 'Ogni quanto Promemo scarica le novità da calendari, Notion e viaggi', `<select class="set-select" data-int-every>${[5, 10, 15, 30, 60].map(m => `<option value="${m}" ${(s.syncMinutes || 15) === m ? 'selected' : ''}>Ogni ${m} minuti</option>`).join('')}</select>`)}
      ${srow('Sincronizza tutto adesso', '', `<button class="btn small" data-int="all">${icon('i-sync')} Sincronizza</button>`)}
    </div>`;
};
const _drawPane_int = drawPane;
drawPane = function (m) {
  _drawPane_int(m);
  if (setPane !== 'integrazioni') return;
  const box = m.querySelector('#set-pane');
  box.querySelectorAll('[data-int-pane]').forEach(b => b.addEventListener('click', () => {
    setPane = b.dataset.intPane;
    m.querySelectorAll('.set-nav-i').forEach(x => x.classList.toggle('on', x.dataset.pane === setPane));
    box.scrollTop = 0; drawPane(m);
  }));
  box.querySelectorAll('[data-int-on]').forEach(inp => inp.addEventListener('change', async () => { await api.updateAccount({ id: inp.dataset.intOn, patch: { enabled: inp.checked } }); }));
  box.querySelector('[data-int-every]')?.addEventListener('change', (e) => { data.settings.syncMinutes = +e.target.value; save(); toast(`Sincronizzazione ogni ${e.target.value} minuti`); });
  box.querySelectorAll('[data-int]').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.int;
    if (k === 'add') { closeModal(); actions[b.dataset.act](b); }
    if (k === 'trips') { closeModal(); modalTripSetup(); }
    if (k === 'ndb') { closeModal(); go('notion'); }
    if (k === 'sync' || k === 'all') {
      b.disabled = true; b.classList.add('spin');
      const r = await api.syncNow(k === 'sync' ? b.dataset.id : undefined);
      if (k === 'all' && data.settings.trips && data.settings.trips.destDb) await api.tripSync();
      b.disabled = false; b.classList.remove('spin');
      if (!r.ok) toast(r.error); else toast('Sincronizzato');
      if (setPane === 'integrazioni' && $('#modal').classList.contains('modal-settings')) drawPane(m);
    }
  }));
};
