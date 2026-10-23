/* Promemo — tutti i servizi collegabili: calendari (Google, Outlook, iCloud e CalDAV), prenotazioni, compiti, link */
'use strict';
const CALDAV_UI = {
  icloud: { name: 'iCloud', sub: 'Calendari Apple: lettura e scrittura.', user: 'Apple ID (email)', pass: 'Password specifica per app', url: 'https://caldav.icloud.com/', steps: ['Su <a href="#" data-action="open-url" data-url="https://account.apple.com/account/manage">account.apple.com</a> → <b>Accesso e sicurezza</b> → <b>Password specifiche per le app</b> → genera una password per “Promemo”.', 'Inserisci qui sotto il tuo Apple ID e quella password (non quella dell’Apple ID).'] },
  nextcloud: { name: 'Nextcloud', sub: 'Il tuo cloud: lettura e scrittura.', user: 'Utente', pass: 'Password per app', url: '', askUrl: 'Indirizzo di Nextcloud (es. https://cloud.esempio.it)', steps: ['In Nextcloud: <b>Impostazioni personali → Sicurezza → Crea nuova password per app</b>.', 'Basta l’indirizzo principale: il percorso CalDAV lo trovo io.'] },
  fastmail: { name: 'Fastmail', sub: 'Lettura e scrittura.', user: 'Email Fastmail', pass: 'Password per app', url: 'https://caldav.fastmail.com/dav/', steps: ['In Fastmail: <b>Impostazioni → Privacy e sicurezza → Password per app</b>, con accesso ai calendari (CalDAV).'] },
  yahoo: { name: 'Yahoo Calendar', sub: 'Lettura e scrittura.', user: 'Email Yahoo', pass: 'Password per app', url: 'https://caldav.calendar.yahoo.com/', steps: ['In <b>Sicurezza dell’account Yahoo</b> genera una <b>password per app</b>.'] },
  zoho: { name: 'Zoho Calendar', sub: 'Lettura e scrittura.', user: 'Email Zoho', pass: 'Password per app', url: 'https://calendar.zoho.eu/caldav/', askUrl: 'Server (zoho.eu per l’Europa, zoho.com per gli altri)', steps: ['In Zoho: <b>Il mio account → Sicurezza → Password specifiche per le app</b>.'] },
  mailbox: { name: 'mailbox.org', sub: 'Lettura e scrittura.', user: 'Email', pass: 'Password', url: 'https://dav.mailbox.org/caldav/', steps: ['Usa email e password di mailbox.org (o una password per app, se hai attivato la verifica in due passaggi).'] },
  posteo: { name: 'Posteo', sub: 'Lettura e scrittura.', user: 'Email', pass: 'Password', url: 'https://posteo.de:8443/', steps: ['Usa email e password di Posteo.'] },
  synology: { name: 'Synology Calendar', sub: 'Il tuo NAS: lettura e scrittura.', user: 'Utente del NAS', pass: 'Password', url: '', askUrl: 'Indirizzo CalDAV del NAS (es. https://nas.local:5001/caldav/)', steps: ['Nel NAS installa <b>Synology Calendar</b>; l’indirizzo CalDAV è in Calendar → Impostazioni → Account CalDAV.'] },
  caldav: { name: 'Altro server CalDAV', sub: 'Radicale, Baïkal, SOGo, Kerio…', user: 'Utente', pass: 'Password', url: '', askUrl: 'Indirizzo del server CalDAV', steps: ['Indirizzo del server, utente e password: i calendari li trovo io.'] },
};

function provTilesHTML() {
  const t = (action, prov, title, sub, extra = '') => `<button class="card clickable prov-tile" data-action="${action}" ${extra}>${provIcon({ provider: prov.p || prov, config: prov.preset ? { preset: prov.preset } : null })}<b>${title}</b><span>${sub}</span></button>`;
  const cd = (k) => t('add-caldav', { p: 'caldav', preset: k }, CALDAV_UI[k].name, CALDAV_UI[k].sub, `data-preset="${k}"`);
  return `
    <div class="prov-sec">Calendari</div>
    <div class="prov-grid">
      ${t('add-google', 'google', 'Google Calendar', 'Il calendario del tuo account Gmail, anche la posta. Lettura e scrittura.')}
      ${t('add-outlook', 'outlook', 'Outlook e Microsoft 365', 'Outlook.com, Hotmail, account di lavoro e della scuola. Lettura e scrittura.')}
      ${cd('icloud')}${cd('nextcloud')}${cd('fastmail')}${cd('yahoo')}${cd('zoho')}${cd('mailbox')}${cd('posteo')}${cd('synology')}${cd('caldav')}
    </div>
    <div class="prov-sec">Prenotazioni</div>
    <div class="prov-grid">
      ${t('add-calendly', 'calendly', 'Calendly', 'Le prenotazioni ricevute, con nome, email e risposte di chi prenota. Sola lettura.')}
      ${t('add-calcom', 'calcom', 'Cal.com', 'Le prenotazioni di Cal.com, con i partecipanti e le risposte. Sola lettura.')}
    </div>
    <div class="prov-sec">Compiti e database</div>
    <div class="prov-grid">
      ${t('add-notion', 'notion', 'Notion', 'Un database con una proprietà data: lezioni, allenamenti, scadenze. Lettura e scrittura.')}
      ${t('add-todoist', 'todoist', 'Todoist', 'I compiti, divisi per progetto, nei due sensi: fatti, date, priorità.')}
    </div>
    <div class="prov-sec">Da un link (.ics, sola lettura)</div>
    <div class="prov-grid">
      ${t('add-ics', 'ics', 'Calendario da link', 'Qualsiasi indirizzo iCal o webcal://: orari dei corsi, calendari pubblici.')}
      ${t('add-ics', { p: 'proton' }, 'Proton Calendar', 'Con il link di condivisione del calendario.', 'data-hint="proton"')}
      ${t('add-ics', { p: 'airbnb' }, 'Airbnb, Booking, Vrbo', 'Le prenotazioni di un alloggio, dal link “esporta calendario”.', 'data-hint="affitti"')}
      ${t('add-ics', { p: 'ics' }, 'Orari universitari e scolastici', 'Il link iCal del piano lezioni (Cineca, UniCA, Easy Academy, Argo…).', 'data-hint="orari"')}
    </div>`;
}

function modalCaldav(preset = 'caldav') {
  const p = CALDAV_UI[preset] || CALDAV_UI.caldav;
  openModal(`<h2>${provIcon({ provider: 'caldav', config: { preset } })} Collega ${esc(p.name)}</h2>
    <ol class="howto">${p.steps.map(s => `<li>${s}</li>`).join('')}</ol>
    <form class="form" data-submit="connect-caldav" data-preset="${preset}">
      ${p.askUrl || !p.url ? `<label class="field"><span>${esc(p.askUrl || 'Indirizzo del server')}</span><input name="url" required placeholder="https://…" value="${esc(p.url || '')}" spellcheck="false"></label>` : `<input type="hidden" name="url" value="${esc(p.url)}">`}
      <label class="field"><span>${esc(p.user)}</span><input name="user" required autocomplete="off" spellcheck="false"></label>
      <label class="field"><span>${esc(p.pass)}</span><input name="password" type="password" required autocomplete="off"></label>
      <p class="muted small">Le credenziali restano cifrate su questo computer. Puoi scegliere quali calendari mostrare dopo il collegamento.</p>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Collega</button></div>
    </form>`);
}

function modalOutlook() {
  openModal(`<h2>${provIcon({ provider: 'outlook' })} Collega Outlook e Microsoft 365</h2>
    <p class="muted" style="margin-top:-6px">Come per Google, Microsoft chiede che l’app desktop abbia un proprio ID. Si crea una volta, gratis:</p>
    <ol class="howto">
      <li>Apri <a href="#" data-action="open-url" data-url="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">Microsoft Entra → Registrazioni app</a> (va bene anche un account Outlook.com personale) e premi <b>Nuova registrazione</b>.</li>
      <li>Nome “Promemo”; tipi di account: <b>account in qualsiasi directory e account Microsoft personali</b>.</li>
      <li>URI di reindirizzamento: piattaforma <b>Client pubblico/nativo (per dispositivi mobili e desktop)</b>, valore <code>http://localhost</code>. Registra.</li>
      <li>Copia l’<b>ID applicazione (client)</b> qui sotto. Al primo accesso Microsoft ti chiederà il permesso di leggere e scrivere i calendari.</li>
    </ol>
    <form class="form" data-submit="connect-outlook">
      <label class="field"><span>ID applicazione (client)</span><input name="clientId" required placeholder="00000000-0000-0000-0000-000000000000" spellcheck="false"></label>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Accedi con Microsoft</button></div>
    </form>`);
}

function modalCalcom() {
  openModal(`<h2>${provIcon({ provider: 'calcom' })} Collega Cal.com</h2>
    <ol class="howto"><li>In Cal.com apri <a href="#" data-action="open-url" data-url="https://app.cal.com/settings/developer/api-keys">Impostazioni → Sviluppatore → Chiavi API</a> e crea una chiave (scadenza a piacere).</li><li>Incollala qui sotto: le prenotazioni arrivano con i partecipanti, le risposte del modulo e, per le lezioni, la scheda dello studente.</li></ol>
    <form class="form" data-submit="connect-calcom">
      <label class="field"><span>Chiave API</span><input name="apiKey" type="password" required placeholder="cal_live_…" spellcheck="false"></label>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Collega Cal.com</button></div>
    </form>`);
}

function modalTodoist() {
  openModal(`<h2>${provIcon({ provider: 'todoist' })} Collega Todoist</h2>
    <p class="muted" style="margin-top:-6px">Ogni progetto di Todoist diventa un progetto di Promemo (“Todoist · Lavoro”…). Compiti nuovi, fatti, date e priorità vanno nei due sensi; i compiti con una data compaiono in agenda e nei promemoria.</p>
    <ol class="howto"><li>In Todoist apri <a href="#" data-action="open-url" data-url="https://app.todoist.com/app/settings/integrations/developer">Impostazioni → Integrazioni → Sviluppatore</a> e copia il <b>token API</b>.</li></ol>
    <form class="form" data-submit="connect-todoist">
      <label class="field"><span>Token API</span><input name="token" type="password" required spellcheck="false"></label>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Collega Todoist</button></div>
    </form>`);
}

// suggerimenti nella finestra del link .ics
const ICS_HINTS = {
  proton: ['Proton Calendar', 'In Proton Calendar: <b>Impostazioni → Calendari</b> → il calendario → <b>Condividi con chiunque</b> → <b>Crea link</b> (accesso completo agli eventi). Copia il link qui.'],
  affitti: ['Prenotazioni alloggio', '<b>Airbnb</b>: Calendario → Disponibilità → <i>Connetti calendari → Esporta calendario</i>. <b>Booking.com</b>: Extranet → Tariffe e disponibilità → <i>Sincronizza calendari</i> → esporta. <b>Vrbo</b>: Calendario → Importa/esporta.'],
  orari: ['Orario delle lezioni', 'Nel portale dell’università o del registro elettronico cerca <b>“Esporta in calendario”</b>, <b>“iCal”</b> o <b>“Iscriviti al calendario”</b> e copia il link (inizia con https:// o webcal://).'],
};
const _modalIcs_a2 = modalIcs;
modalIcs = function (hint) {
  _modalIcs_a2();
  const h = ICS_HINTS[hint]; if (!h) return;
  const m = document.querySelector('#modal');
  const ul = m.querySelector('.howto'); if (ul) ul.outerHTML = `<p class="howto-one">${h[1]}</p>`;
  const n = m.querySelector('[name=name]'); if (n) n.value = h[0];
};

Object.assign(actions, {
  'add-caldav': (el) => modalCaldav(el.dataset.preset),
  'add-outlook': () => modalOutlook(),
  'add-calcom': () => modalCalcom(),
  'add-todoist': () => modalTodoist(),
  'add-ics': (el) => modalIcs(el && el.dataset ? el.dataset.hint : undefined),
});
const connectWith = (fn, label, done) => async (f, fd) => {
  showErr(f); setBusy(f, true, label);
  const r = await fn(fd, f);
  setBusy(f, false);
  if (!r.ok) return showErr(f, r.error);
  closeModal(); go('account'); toast(done(r.value));
};
Object.assign(submits, {
  'connect-caldav': connectWith((fd, f) => api.caldav({ preset: f.dataset.preset, url: String(fd.get('url') || '').trim(), user: fd.get('user'), password: fd.get('password') }), 'Cerco i calendari…', (a) => `${a.calendars.length} ${a.calendars.length === 1 ? 'calendario trovato' : 'calendari trovati'}`),
  'connect-outlook': connectWith((fd) => api.outlook({ clientId: fd.get('clientId') }), 'Completa l’accesso nel browser…', () => 'Outlook collegato'),
  'connect-calcom': connectWith((fd) => api.calcom({ apiKey: fd.get('apiKey') }), 'Verifica…', () => 'Cal.com collegato'),
  'connect-todoist': connectWith((fd) => api.todoist({ token: fd.get('token') }), 'Verifica…', () => 'Todoist collegato: i compiti arrivano tra poco'),
});

// Todoist non ha calendari: nella scheda mostro i compiti sincronizzati
const _viewAccounts_a2 = viewAccounts;
viewAccounts = function () {
  let h = _viewAccounts_a2();
  for (const a of data.accounts.filter(x => x.provider === 'todoist')) {
    const projs = data.projects.filter(p => p.todoist && p.todoist.acc === a.id);
    const n = projs.reduce((t, p) => t + p.steps.filter(s => s.todo && !s.done).length, 0);
    h = h.replace(new RegExp(`(<div class="card-sub">Todoist · )\\d+ eventi`), `$1${n} compiti aperti in ${projs.length} ${projs.length === 1 ? 'progetto' : 'progetti'}`);
  }
  return h;
};
