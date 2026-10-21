/* Promemo — Viaggi: destinazioni e itinerari da Notion, racconti scritti dall'IA */
'use strict';

const tripsCfg = () => data.settings.trips || {};
const tripsAll = () => Object.values(data.trips || {});
const tripUi = { filter: 'tutti', gen: {}, syncing: false, err: '' };

// ---------- etichette ----------
const EMOJI_RE = /^\p{Extended_Pictographic}️?\s*/u;
const T_IT = { Travel: 'Viaggio', 'Check-in': 'Check-in', Food: 'Cibo', Activity: 'Attività', Transport: 'Trasporto', Sightseeing: 'Visita', Shopping: 'Shopping', Rest: 'Riposo', Museum: 'Museo', Park: 'Parco' };
const TR_IT = { Plane: ['✈️', 'Aereo'], Train: ['🚆', 'Treno'], Car: ['🚗', 'Auto'], 'Public Transport': ['🚇', 'Mezzi pubblici'], Bus: ['🚌', 'Bus'], Ferry: ['⛴️', 'Traghetto'], Boat: ['⛴️', 'Traghetto'] };
const ST_IT = { Visited: 'Visitato', 'In Planning': 'In programma', 'Want to go': 'Da visitare', 'Non iniziato': 'Da fare', 'In corso': 'In corso', Fatto: 'Fatto' };
const typeEmoji = (t) => (String(t || '').match(EMOJI_RE) || ['📍'])[0].trim();
const typeLabel = (t) => { const l = String(t || '').replace(EMOJI_RE, '').trim(); return T_IT[l] || l; };
const stLabel = (s) => ST_IT[s] || s || '';
function tripBucket(t) {
  const s = String(t.status || '');
  if (/visit|fatto|done|stato/i.test(s)) return 'visitati';
  if (/want|desider|sogno|wish/i.test(s)) return 'desideri';
  if (/plan|program|prenot/i.test(s)) return 'programma';
  if (!t.start) return 'desideri';
  return parse((t.end || t.start).slice(0, 10)) < startOfDay(new Date()) ? 'visitati' : 'programma';
}
const BUCKET = { visitati: ['Visitato', '#2f9e5b'], programma: ['In programma', '#0a84ff'], desideri: ['Da visitare', '#9775fa'] };
const tripColor = (t) => BUCKET[tripBucket(t)][1];

function tripRange(t) {
  if (!t.start) return 'Date da decidere';
  const s = parse(t.start.slice(0, 10)), e = t.end ? parse(t.end.slice(0, 10)) : null;
  const o = { day: 'numeric', month: 'short' };
  const y = (d) => d.getFullYear();
  if (!e || sameDay(s, e)) return s.toLocaleDateString('it-IT', { ...o, year: 'numeric' });
  return `${s.toLocaleDateString('it-IT', y(s) === y(e) ? o : { ...o, year: 'numeric' })} – ${e.toLocaleDateString('it-IT', { ...o, year: 'numeric' })}`;
}
const money = (n, cur = '€') => n == null || n === '' ? '' : `${cur} ${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 })}`;

// ---------- distanze e spostamenti ----------
function haversine(a, b) {
  const R = 6371, r = (x) => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const hasXY = (it) => it && it.place && it.place.lat != null && it.place.lon != null;
const dayOf = (it) => it.start ? it.start.slice(0, 10) : '';
function transfer(prev, cur) {
  if (!hasXY(prev) || !hasXY(cur) || dayOf(prev) !== dayOf(cur)) return null;
  const km = haversine(prev.place, cur.place);
  if (km < 0.05) return { km, icon: '📍', text: 'Stesso posto' };
  const dist = km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`;
  if (km <= 1.5) return { km, walk: true, icon: '🚶', text: `A piedi · ${Math.max(2, Math.round(km * 1.25 / 4.8 * 60))} min · ${dist}` };
  if (km <= 40) return { km, icon: '🚇', text: `Mezzi o taxi · circa ${Math.round(km * 1.3 / 20 * 60 + 8)} min · ${dist}` };
  return { km, icon: '🚆', text: `Spostamento lungo · ${dist}` };
}
function tripStats(t) {
  const days = [...new Set(t.items.map(dayOf).filter(Boolean))];
  let km = 0, walk = 0;
  t.items.forEach((it, i) => { const tr = i && transfer(t.items[i - 1], it); if (tr) { km += tr.km; if (tr.walk) walk += tr.km; } });
  const cost = t.items.reduce((s, it) => s + (Number(it.cost) || 0), 0);
  const booked = t.items.filter(i => i.booked).length;
  return { days: days.length, km, walk, cost, booked };
}

// ---------- IA ----------
function tripPrompt(t) {
  const past = tripBucket(t) === 'visitati';
  const lines = t.items.map((it, i) => [
    `#${i + 1}`, it.start ? it.start.replace('T', ' ').replace(' 00:00', '') : 'senza data', it.time && !it.start?.includes('T') ? it.time : '',
    typeLabel(it.type), it.title, it.place?.name ? `luogo: ${it.place.name}${it.place.address ? ' (' + it.place.address + ')' : ''}` : '',
    it.anno ? `anno storico: ${it.anno}` : '', it.notes ? `note: ${it.notes.slice(0, 200)}` : '', it.storia ? 'storia già scritta' : '',
  ].filter(Boolean).join(' · '));
  const sys = `Sei una guida di viaggio italiana colta e calorosa. Scrivi in italiano, con frasi chiare e concrete, senza inventare fatti incerti: se non sei sicuro di una data o di un dettaglio, restane sul generale. ${past ? "Il viaggio è già stato fatto: scrivi l'introduzione e le sintesi come un ricordo, al passato." : 'Il viaggio deve ancora avvenire o è in corso: scrivi al presente o al futuro, come una guida.'} Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo e senza blocchi di codice.`;
  const user = `Viaggio: ${t.name}${t.start ? ` · dal ${t.start.slice(0, 10)}${t.end ? ' al ' + t.end.slice(0, 10) : ''}` : ''}${t.nights ? ` · ${t.nights} notti` : ''}${t.transport.length ? ' · mezzi: ' + t.transport.join(', ') : ''}${t.buddy.length ? ' · con: ' + t.buddy.join(', ') : ''}${t.type.length ? ' · tipo: ' + t.type.join(', ') : ''}.

Tappe (dati da Notion, non modificarli):
${lines.join('\n') || '(nessuna tappa)'}

Restituisci questo JSON:
{"intro": "3-4 frasi che raccontano il viaggio nel suo insieme",
 "giorni": [{"data": "AAAA-MM-GG", "titolo": "massimo 5 parole", "sintesi": "1-2 frasi sulla giornata"}],
 "tappe": [{"n": 1, "storia": "2-4 frasi su storia, curiosità e cosa guardare nel luogo; una sola frase per voli, trasferimenti, pasti e check-in", "spostamento": "come si arriva dalla tappa precedente, breve (es. 'Metro Jubilee line fino a Westminster'); stringa vuota per la prima tappa del giorno", "consiglio": "un consiglio pratico breve, opzionale"}],
 "consigli": ["3-5 consigli pratici per questo viaggio"]}
Una voce in "tappe" per ogni tappa, nello stesso ordine, con "n" uguale al numero della tappa. Una voce in "giorni" per ogni data presente.`;
  return { sys, user };
}
function parseJsonLoose(txt) {
  const s = String(txt || '').replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error("L'IA non ha restituito un risultato leggibile. Riprova.");
  return JSON.parse(s.slice(a, b + 1));
}
async function tripGenerate(id) {
  const t = data.trips[id]; if (!t || tripUi.gen[id]) return;
  tripUi.gen[id] = true; render();
  try {
    const { sys, user } = tripPrompt(t);
    const r = await api.aiChat({ system: sys, messages: [{ role: 'user', content: user }], maxTokens: Math.min(16000, 1800 + t.items.length * 320) });
    if (!r.ok) throw new Error(r.error);
    const j = parseJsonLoose(r.text);
    const ai = { at: new Date().toISOString(), intro: String(j.intro || ''), consigli: (j.consigli || []).map(String).slice(0, 6), giorni: {}, tappe: {} };
    for (const g of j.giorni || []) if (g && g.data) ai.giorni[String(g.data).slice(0, 10)] = { titolo: String(g.titolo || ''), sintesi: String(g.sintesi || '') };
    (j.tappe || []).forEach((x, i) => { const it = t.items[(Number(x.n) || i + 1) - 1]; if (it) ai.tappe[it.id] = { storia: String(x.storia || ''), spostamento: String(x.spostamento || ''), consiglio: String(x.consiglio || '') }; });
    t.ai = ai;
    await api.tripAi({ id, ai });
    toast('Racconto del viaggio pronto');
  } catch (e) { toast(e.message || String(e)); }
  finally { delete tripUi.gen[id]; render(); }
}

// ---------- sincronizzazione ----------
async function flushSave() {
  clearTimeout(saveTimer); dirty = false;
  const r = await api.setData(data);
  if (r && r.rev) Object.assign(data, r);
}
async function tripSyncNow(quiet) {
  if (tripUi.syncing) return;
  tripUi.syncing = true; tripUi.err = ''; render();
  const r = await api.tripSync();
  tripUi.syncing = false;
  if (!r.ok) { tripUi.err = r.error; if (!quiet) toast(r.error); }
  else { const d = await api.getData(); if (d) { data = d; } if (!quiet) toast(`Viaggi aggiornati da Notion`); }
  render();
}

// ---------- vista: elenco dei viaggi ----------
function tripCard(t) {
  const st = tripStats(t), b = tripBucket(t);
  const tr = t.transport.map(x => (TR_IT[x] || ['', x])[0] || '').join(' ');
  return `<button class="trip-card" data-action="trip-open" data-id="${t.id}" style="--tc:${tripColor(t)}">
    <div class="trip-cover"><span class="trip-emoji">${esc(t.icon || '✈️')}</span>${t.favorite ? `<span class="trip-fav" title="Preferito">${icon('i-star')}</span>` : ''}<span class="trip-st">${BUCKET[b][0]}</span></div>
    <div class="trip-body">
      <div class="trip-name">${esc(t.name)}</div>
      <div class="trip-dates">${esc(tripRange(t))}${t.nights ? ` · ${t.nights} notti` : ''}</div>
      <div class="trip-meta">${tr ? `<span>${tr}</span>` : ''}${t.items.length ? `<span>${t.items.length} tappe</span>` : t.itineraryDb ? '<span>Itinerario vuoto</span>' : ''}${st.days ? `<span>${st.days} giorni</span>` : ''}${t.ai ? `<span class="ai">${icon('i-spark')}</span>` : ''}</div>
    </div>
  </button>`;
}
function viewTrips() {
  const cfg = tripsCfg();
  if (!cfg.destDb) return tripSetupView();
  if (ui.trip && data.trips && data.trips[ui.trip]) return viewTrip(data.trips[ui.trip]);
  const all = tripsAll();
  const order = { programma: 0, visitati: 1, desideri: 2 };
  const list = all.filter(t => tripUi.filter === 'tutti' || tripBucket(t) === tripUi.filter)
    .sort((a, b) => order[tripBucket(a)] - order[tripBucket(b)] || (tripBucket(a) === 'programma' ? (a.start || '9').localeCompare(b.start || '9') : (b.start || '').localeCompare(a.start || '')));
  const n = (k) => all.filter(t => tripBucket(t) === k).length;
  const upcoming = all.filter(t => tripBucket(t) === 'programma' && t.start).sort((a, b) => a.start.localeCompare(b.start))[0];
  return `<div class="trips">
    <div class="row" style="align-items:flex-end;gap:12px">
      <div class="grow">
        <div class="eyebrow">Dal tuo database Notion</div>
        <h1 class="large-title">Viaggi</h1>
        <div class="subtitle">${all.length ? `${n('visitati')} visitati · ${n('programma')} in programma · ${n('desideri')} da visitare` : 'Nessuna destinazione trovata nel database.'}${upcoming ? ` · prossimo: <b>${esc(upcoming.name)}</b> ${esc(relDay(parse(upcoming.start.slice(0, 10))).toLowerCase())}` : ''}</div>
      </div>
      <button class="btn small" data-action="trip-setup">${icon('i-gear')} Imposta</button>
      <button class="btn small" data-action="trip-sync" ${tripUi.syncing ? 'disabled' : ''}>${tripUi.syncing ? '<span class="spinner"></span> Aggiorno…' : icon('i-refresh') + ' Aggiorna da Notion'}</button>
    </div>
    ${tripUi.err ? `<div class="form-err" style="margin-top:12px">${esc(tripUi.err)}</div>` : ''}
    <div class="segmented" style="margin:18px 0 14px">${[['tutti', 'Tutti'], ['programma', 'In programma'], ['visitati', 'Visitati'], ['desideri', 'Da visitare']].map(([k, l]) => `<button class="${tripUi.filter === k ? 'on' : ''}" data-action="trip-filter" data-f="${k}">${l}</button>`).join('')}</div>
    ${list.length ? `<div class="trip-grid">${list.map(tripCard).join('')}</div>` : `<div class="empty"><b>${all.length ? 'Nessun viaggio in questo filtro' : 'Ancora nessun viaggio'}</b>${all.length ? 'Prova un altro filtro.' : 'Premi “Aggiorna da Notion” per scaricare le destinazioni.'}</div>`}
  </div>`;
}

function tripSetupView() {
  return `<div style="max-width:720px">
    <div class="eyebrow">Itinerari dai tuoi database</div>
    <h1 class="large-title">Viaggi</h1>
    <div class="subtitle">Promemo legge da Notion i dati essenziali di ogni viaggio — destinazione, date, mezzi, tappe con orario e luogo — e l'intelligenza artificiale scrive il resto: il racconto, le sintesi dei giorni, la storia dei luoghi e come spostarsi tra una tappa e l'altra.</div>
    <div class="card" style="margin-top:22px;padding:20px 22px">
      <div class="trip-steps">
        <div><b>1</b><span>Collega Notion in <a class="link" data-action="nav" data-view="account">Account collegati</a> e condividi con l'integrazione la pagina del tuo planner di viaggio.</span></div>
        <div><b>2</b><span>Scegli il database delle destinazioni (es. “Destinations”). L'itinerario di ogni viaggio viene trovato da solo dentro la sua pagina.</span></div>
        <div><b>3</b><span>Apri un viaggio e fai scrivere il racconto all'IA. Le tappe compaiono anche in Agenda.</span></div>
      </div>
      <div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn-primary" data-action="trip-setup">${icon('c-plane')} Scegli il database</button></div>
    </div>
  </div>`;
}

async function modalTripSetup() {
  const accs = await api.ndbAccounts();
  if (!accs.length) { toast('Collega prima un account Notion'); go('account'); return; }
  const cfg = tripsCfg();
  openModal(`<h2>${icon('c-plane')} Viaggi da Notion</h2>
    <p class="muted" style="margin-top:-6px">Scegli il database con le destinazioni. Promemo riconosce da solo le colonne (Nome, Stato, Date, Notti, Trasporto…) e cerca l'itinerario dentro ogni pagina.</p>
    <form class="form" data-submit="trip-setup">
    ${accs.length > 1 ? `<label class="field"><span>Account</span><select name="acc">${accs.map(a => `<option value="${a.id}" ${a.id === cfg.acc ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : `<input type="hidden" name="acc" value="${accs[0].id}">`}
    <label class="field"><span>Database delle destinazioni</span><select name="db" disabled><option>Carico i database…</option></select></label>
    <label class="row"><span class="grow">Mostra viaggi e tappe in Agenda</span><input type="checkbox" class="switch" name="agenda" ${cfg.agenda !== false ? 'checked' : ''}></label>
    <label class="row"><span class="grow">Scarica l'itinerario anche dei viaggi “da visitare”</span><input type="checkbox" class="switch" name="all" ${cfg.allItineraries ? 'checked' : ''}></label>
    <div class="form-err" hidden></div>
    <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary" type="submit">Salva e scarica</button></div>
  </form>`, (m) => {
    const accSel = m.querySelector('[name=acc]'), dbSel = m.querySelector('[name=db]');
    const load = async () => {
      dbSel.disabled = true; dbSel.innerHTML = '<option>Carico i database…</option>';
      const r = await api.ndbList(accSel.value);
      if (!r.ok) { const e = m.querySelector('.form-err'); e.textContent = r.error; e.hidden = false; return; }
      const dbs = r.value;
      const guess = cfg.destDb || (dbs.find(d => /destin|viagg|trip|travel|mete/i.test(d.title) && !/itiner/i.test(d.title)) || {}).id;
      dbSel.innerHTML = dbs.length ? dbs.map(d => `<option value="${d.id}" ${d.id === guess ? 'selected' : ''}>${esc((d.icon ? d.icon + ' ' : '') + d.title)}</option>`).join('') : '<option value="">Nessun database condiviso con l’integrazione</option>';
      dbSel.disabled = !dbs.length;
    };
    accSel.tagName === 'SELECT' && accSel.addEventListener('change', load);
    load();
  });
}
submits['trip-setup'] = async (f, fd) => {
  if (!fd.get('db')) return;
  const prev = tripsCfg();
  data.settings.trips = { ...prev, acc: fd.get('acc'), destDb: fd.get('db'), agenda: !!fd.get('agenda'), allItineraries: !!fd.get('all') };
  if (prev.destDb && prev.destDb !== data.settings.trips.destDb) data.trips = {};
  closeModal();
  await flushSave();
  ui.trip = null; go('viaggi');
  if (prev.agenda !== data.settings.trips.agenda && prev.destDb === data.settings.trips.destDb) await api.tripAgenda();
  tripSyncNow();
};

// ---------- vista: dettaglio del viaggio ----------
function viewTrip(t) {
  const st = tripStats(t), ai = t.ai, gen = !!tripUi.gen[t.id];
  const mode = ui.tripMode || 'percorso';
  const now = new Date();
  const timed = t.items.filter(i => i.start);
  const next = timed.find(i => parse(i.start) >= now);
  const ongoing = t.start && parse(t.start.slice(0, 10)) <= now && now <= addDays(parse((t.end || t.start).slice(0, 10)), 1);
  const chips = [
    ...t.transport.map(x => `<span class="tchip">${(TR_IT[x] || ['🧭'])[0]} ${esc((TR_IT[x] || [0, x])[1])}</span>`),
    ...t.buddy.map(x => `<span class="tchip">👥 ${esc(x)}</span>`),
    ...t.type.map(x => `<span class="tchip">${esc(x)}</span>`),
    ...t.budget.map(x => `<span class="tchip">💶 ${esc(x)}</span>`),
  ].join('');
  const nextBox = next && tripBucket(t) !== 'visitati' ? `<div class="tside-card next">
      <div class="tiny-label">${ongoing ? 'Prossima tappa' : 'Si parte con'}</div>
      <button class="tnext" data-action="trip-focus" data-id="${next.id}"><span class="tnext-e">${typeEmoji(next.type)}</span><span class="grow"><b>${esc(next.title)}</b><span>${esc(relDay(parse(next.start)))} · ${fmtHM(parse(next.start))}${next.place?.name ? ' · ' + esc(next.place.name) : ''}</span></span>${icon('i-chev-r')}</button>
    </div>` : '';
  const statBox = `<div class="tstats">
      <div><b>${t.items.length}</b><span>tappe</span></div>
      <div><b>${st.days || t.nights || '—'}</b><span>${st.days ? 'giorni' : 'notti'}</span></div>
      <div><b>${st.km ? st.km.toLocaleString('it-IT', { maximumFractionDigits: 1 }) : '—'}</b><span>km tra le tappe</span></div>
      <div><b>${st.walk ? st.walk.toLocaleString('it-IT', { maximumFractionDigits: 1 }) : '—'}</b><span>km a piedi</span></div>
      ${st.cost ? `<div><b>${esc(money(st.cost, t.currency || '€'))}</b><span>costo stimato</span></div>` : ''}
      ${t.items.length ? `<div><b>${st.booked}/${t.items.length}</b><span>prenotate</span></div>` : ''}
    </div>`;
  const introBox = `<div class="tside-card intro">
      <div class="tiny-label">${icon('i-spark')} Il racconto ${ai ? `<button class="link" data-action="trip-ai" data-id="${t.id}" ${gen ? 'disabled' : ''}>${gen ? 'Scrivo…' : 'Riscrivi'}</button>` : ''}</div>
      ${gen && !ai ? `<div class="tgen"><span class="spinner"></span> L'IA sta scrivendo il racconto, le sintesi dei giorni e la storia di ${t.items.length} luoghi…</div>`
      : ai ? `<p>${esc(ai.intro)}</p>`
      : `<p class="muted">Dati da Notion, parole dall'IA: fatti scrivere il racconto del viaggio, una sintesi per ogni giorno, la storia dei luoghi e come spostarti tra le tappe.</p><button class="btn-primary" data-action="trip-ai" data-id="${t.id}" ${t.items.length ? '' : 'disabled'}>${icon('i-spark')} Scrivi con l'IA</button>`}
    </div>`;
  const tips = ai && ai.consigli && ai.consigli.length ? `<div class="tside-card"><div class="tiny-label">💡 Consigli</div><ul class="ttips">${ai.consigli.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : '';
  const body = !t.items.length
    ? `<div class="empty" style="margin-top:8px"><b>${t.itineraryDb ? 'Itinerario vuoto' : 'Nessun itinerario trovato'}</b>${t.itineraryDb ? 'Aggiungi le tappe nel database dell’itinerario su Notion.' : 'Crea nella pagina del viaggio su Notion un database con le tappe (attività, data e ora, luogo, tipo), poi aggiorna.'}${t.error ? `<br><span class="form-err" style="display:inline-block;margin-top:8px">${esc(t.error)}</span>` : ''}</div>`
    : mode === 'mappa' ? tripMap(t) : mode === 'elenco' ? tripTable(t) : tripRoute(t);
  return `<div class="trip-detail" style="--tc:${tripColor(t)}">
    <aside class="tside">
      <button class="tback" data-action="trip-back">${icon('i-chev-l')} Tutti i viaggi</button>
      <div class="thead">
        <span class="temoji">${esc(t.icon || '✈️')}</span>
        <span class="tstatus">${esc(stLabel(t.status) || BUCKET[tripBucket(t)][0])}</span>
      </div>
      <h1 class="display">${esc(t.name)}</h1>
      <div class="tdates">${esc(tripRange(t))}${t.nights ? ` · ${t.nights} notti` : ''}</div>
      ${chips ? `<div class="tchips">${chips}</div>` : ''}
      ${introBox}${nextBox}${statBox}${tips}
      <div class="row tfoot">
        <button class="btn small" data-action="open-url" data-url="${esc(t.url)}">Apri in Notion</button>
        <button class="btn small" data-action="trip-sync" ${tripUi.syncing ? 'disabled' : ''}>${tripUi.syncing ? '<span class="spinner"></span>' : icon('i-refresh')} Aggiorna</button>
      </div>
      <div class="tiny tsrc">Dati: Notion${t.syncedAt ? ' · ' + esc(stamp(t.syncedAt).toLowerCase()) : ''}${ai ? ' · Testi: IA, ' + esc(relDay(new Date(ai.at)).toLowerCase()) : ''}</div>
    </aside>
    <section class="tmain">
      <div class="tmain-head">
        <div class="segmented">${[['percorso', 'Percorso', 'i-route'], ['elenco', 'Elenco', 'i-list'], ['mappa', 'Mappa', 'i-map']].map(([k, l, ic]) => `<button class="${mode === k ? 'on' : ''}" data-action="trip-mode" data-m="${k}">${icon(ic)} ${l}</button>`).join('')}</div>
        ${mode === 'percorso' && st.days > 1 ? `<div class="tdays">${[...new Set(t.items.map(dayOf).filter(Boolean))].map((d, i) => `<button class="tday-chip" data-action="trip-day" data-d="${d}">G${i + 1} · ${esc(parse(d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' }))}</button>`).join('')}</div>` : ''}
      </div>
      <div class="tscroll">${body}</div>
    </section>
  </div>`;
}

const tripDays = (t) => { const m = new Map(); t.items.forEach((it, i) => { const k = dayOf(it) || 'senza-data'; if (!m.has(k)) m.set(k, []); m.get(k).push([it, i]); }); return [...m.entries()]; };
const DAY_COLORS = ['#0a84ff', '#e5562a', '#2f9e5b', '#9775fa', '#d6336c', '#1098ad', '#c9930a', '#5c636a'];

function stopTime(it) { if (it.start && !it.allDay) return fmtHM(parse(it.start)); return esc(it.time || ''); }
function tripRoute(t) {
  const ai = t.ai || {};
  return tripDays(t).map(([d, list], di) => {
    const gd = (ai.giorni || {})[d];
    const dd = d === 'senza-data' ? null : parse(d);
    return `<div class="tday" id="tday-${d}" style="--dc:${DAY_COLORS[di % DAY_COLORS.length]}">
      <div class="tday-head">
        <span class="tday-n">Giorno ${di + 1}</span>
        <div class="grow"><div class="tday-title">${gd && gd.titolo ? esc(gd.titolo) : dd ? esc(fmtLong(dd).replace(/^./, c => c.toUpperCase())) : 'Senza data'}</div>
        <div class="tday-sub">${dd && gd && gd.titolo ? esc(fmtLong(dd)) + ' · ' : ''}${list.length} ${list.length === 1 ? 'tappa' : 'tappe'}</div></div>
      </div>
      ${gd && gd.sintesi ? `<p class="tday-sum">${esc(gd.sintesi)}</p>` : ''}
      <div class="tstops">${list.map(([it, i], k) => {
        const prev = k ? list[k - 1][0] : null;
        const tr = prev ? transfer(prev, it) : null;
        const x = (ai.tappe || {})[it.id] || {};
        const story = it.storia || x.storia || '';
        const move = (tr || (k && x.spostamento)) ? `<div class="tmove">${tr ? `<span>${tr.icon} ${esc(tr.text)}</span>` : ''}${x.spostamento ? `<span class="tmove-ai">${esc(x.spostamento)}</span>` : ''}</div>` : '';
        return `${move}<div class="tstop ${ui.tripFocus === it.id ? 'focus' : ''} ${/fatto|done/i.test(it.status) ? 'done' : ''}" id="tstop-${it.id}">
          <div class="tstop-time">${stopTime(it)}</div>
          <div class="tstop-rail"><span class="tstop-dot">${typeEmoji(it.type)}</span></div>
          <div class="tstop-body">
            <div class="tstop-title">${esc(it.title)}</div>
            <div class="tstop-meta">${it.place?.name ? `<span>${icon('i-pin')} ${esc(it.place.name)}</span>` : ''}${it.type ? `<span>${esc(typeLabel(it.type))}</span>` : ''}${it.anno ? `<span>🏛️ ${esc(it.anno)}</span>` : ''}${it.cost ? `<span>${esc(money(it.cost, t.currency || '€'))}</span>` : ''}${it.booked ? '<span class="ok">Prenotato</span>' : ''}${it.status ? `<span class="st">${esc(stLabel(it.status))}</span>` : ''}</div>
            ${story ? `<div class="tstory"><p class="clamp">${esc(story)}</p>${story.length > 220 ? '<button class="link" data-action="trip-more">Leggi tutto</button>' : ''}${!it.storia ? `<span class="tai" title="Scritto dall'IA">${icon('i-spark')}</span>` : ''}</div>` : ''}
            ${it.notes ? `<div class="tnote">${icon('i-note')} ${esc(it.notes)}</div>` : ''}
            ${it.cercare ? `<div class="tnote">🔎 Da cercare: ${esc(it.cercare)}</div>` : ''}
            ${x.consiglio ? `<div class="tnote tip">💡 ${esc(x.consiglio)}</div>` : ''}
          </div>
        </div>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}

function tripTable(t) {
  const days = tripDays(t);
  return `<table class="ttable"><thead><tr><th>#</th><th>Giorno</th><th>Ora</th><th>Tappa</th><th>Luogo</th><th>Tipo</th><th>Costo</th><th>Stato</th></tr></thead><tbody>
    ${days.map(([d, list], di) => list.map(([it, i]) => `<tr data-action="trip-focus" data-id="${it.id}">
      <td class="n">${i + 1}</td><td>G${di + 1}${d !== 'senza-data' ? ' · ' + esc(parse(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })) : ''}</td><td class="n">${stopTime(it)}</td>
      <td><b>${typeEmoji(it.type)} ${esc(it.title)}</b></td><td>${esc(it.place?.name || '')}</td><td>${esc(typeLabel(it.type))}</td>
      <td class="n">${esc(money(it.cost, t.currency || '€'))}</td><td>${it.booked ? '<span class="pill ok">Prenotato</span> ' : ''}${esc(stLabel(it.status))}</td></tr>`).join('')).join('')}
  </tbody></table>`;
}

function tripMap(t) {
  const days = [...new Set(t.items.map(dayOf))];
  const colorOf = (it) => DAY_COLORS[Math.max(0, days.indexOf(dayOf(it))) % DAY_COLORS.length];
  const fd = ui.tripMapDay && days.includes(ui.tripMapDay) ? ui.tripMapDay : null;
  const pts = t.items.map((it, i) => ({ it, i })).filter(p => hasXY(p.it) && (!fd || dayOf(p.it) === fd));
  const dayChips = `<div class="tdays tmap-days"><button class="tday-chip ${fd ? '' : 'on'}" data-action="trip-mapday" data-d="">Tutti i giorni</button>${days.filter(Boolean).map((d, i) => `<button class="tday-chip ${fd === d ? 'on' : ''}" data-action="trip-mapday" data-d="${d}"><i style="background:${DAY_COLORS[i % DAY_COLORS.length]}"></i>G${i + 1} · ${esc(parse(d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' }))}</button>`).join('')}</div>`;
  if (!pts.length) return dayChips + `<div class="empty"><b>Nessuna tappa con coordinate</b>Usa una colonna “Luogo” di tipo posizione in Notion per vedere la mappa.</div>`;
  const W = 760, H = 480, P = 44;
  // i luoghi molto lontani (aeroporti, gite fuori città) non schiacciano la mappa: restano sul bordo
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const c = { lat: med(pts.map(p => p.it.place.lat)), lon: med(pts.map(p => p.it.place.lon)) };
  const dist = pts.map(p => haversine(c, p.it.place));
  const lim = pts.length >= 4 ? Math.max(6, 4 * med(dist)) : Infinity;
  pts.forEach((p, k) => { p.far = dist[k] > lim; p.km = dist[k]; });
  const core = pts.filter(p => !p.far);
  const lats = core.map(p => p.it.place.lat), lons = core.map(p => p.it.place.lon);
  const mid = (Math.min(...lats) + Math.max(...lats)) / 2, k = Math.cos(mid * Math.PI / 180);
  const xs = lons.map(l => l * k), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...lats), maxY = Math.max(...lats);
  const sc = Math.min((W - 2 * P) / Math.max(maxX - minX, 0.002), (H - 2 * P) / Math.max(maxY - minY, 0.002));
  const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
  const raw = (pl) => [ox + (pl.lon * k - minX) * sc, oy + (maxY - pl.lat) * sc];
  const cx = W / 2, cy = H / 2, E = 22;
  const xy = (pl) => { let [x, y] = raw(pl); if (x >= E && x <= W - E && y >= E && y <= H - E) return [x, y]; const dx = x - cx, dy = y - cy; const f = Math.min(Math.abs((W / 2 - E) / (dx || 1e-9)), Math.abs((H / 2 - E) / (dy || 1e-9))); return [cx + dx * f, cy + dy * f]; };
  const kmPerPx = 111.32 / sc;
  const ref = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find(v => v / kmPerPx > 60) || 1000;
  const lines = days.map(d => { const ps = pts.filter(p => dayOf(p.it) === d); return ps.length > 1 ? `<polyline points="${ps.map(p => xy(p.it.place).map(v => v.toFixed(1)).join(',')).join(' ')}" stroke="${colorOf(ps[0].it)}" />` : ''; }).join('');
  const focus = pts.find(p => p.it.id === ui.tripFocus)?.it || pts[0].it;
  const fx = (t.ai && t.ai.tappe || {})[focus.id] || {};
  const label = (p) => { const [x, y] = xy(p.it.place); const right = x < W - 170; return `<text class="tlbl" x="${(x + (right ? 15 : -15)).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${esc((p.it.place.name || p.it.title).slice(0, 28))}${p.far ? ` · ${Math.round(p.km)} km` : ''}</text>`; };
  const far = pts.filter(p => p.far);
  return `${dayChips}<div class="tmap">
    <svg viewBox="0 0 ${W} ${H}" class="tmap-svg" role="img" aria-label="Mappa delle tappe">
      <defs><pattern id="tgrid" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M38 0H0V38" class="tgrid"/></pattern></defs>
      <rect width="${W}" height="${H}" fill="url(#tgrid)"/>
      <g class="troutes">${lines}</g>
      <g class="tlbls">${(fd || pts.length <= 8 ? pts : [...far, ...pts.filter(p => p.it.id === focus.id)]).map(label).join('')}</g>
      ${pts.map(p => { const [x, y] = xy(p.it.place); const on = p.it.id === focus.id; return `<g class="tpt ${on ? 'on' : ''} ${p.far ? 'far' : ''}" data-action="trip-pick" data-id="${p.it.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><title>${esc(p.i + 1 + '. ' + p.it.title + (p.it.place.name ? ' — ' + p.it.place.name : ''))}</title><circle r="${on ? 13 : 10}" fill="${colorOf(p.it)}"/><text dy="3.6">${p.i + 1}</text></g>`; }).join('')}
      <g class="tscale" transform="translate(${P - 20} ${H - 20})"><line x1="0" x2="${(ref / kmPerPx).toFixed(1)}" y1="0" y2="0"/><text x="0" y="-7" text-anchor="start">${ref < 1 ? ref * 1000 + ' m' : ref + ' km'}</text></g>
    </svg>
    ${far.length ? `<div class="tmap-far">Sul bordo, fuori scala: ${far.map(p => `${p.i + 1}. ${esc(p.it.place.name || p.it.title)} (${Math.round(p.km)} km)`).join(' · ')}</div>` : ''}
    <div class="card tmap-card" style="--dc:${colorOf(focus)}">
      <div class="row" style="gap:10px"><span class="tstop-dot">${typeEmoji(focus.type)}</span><div class="grow"><div class="tstop-title">${t.items.indexOf(focus) + 1}. ${esc(focus.title)}</div><div class="tstop-meta">${focus.start ? `<span>${esc(relDay(parse(focus.start)))}${focus.allDay ? '' : ' · ' + fmtHM(parse(focus.start))}</span>` : ''}${focus.place?.name ? `<span>${icon('i-pin')} ${esc(focus.place.name)}</span>` : ''}</div></div><button class="btn small" data-action="trip-focus" data-id="${focus.id}">Nel percorso</button></div>
      ${focus.storia || fx.storia ? `<p class="tmap-story">${esc(focus.storia || fx.storia)}</p>` : ''}
    </div>
  </div>`;
}

// ---------- azioni ----------
Object.assign(actions, {
  'trip-open': (el) => { ui.trip = el.dataset.id; ui.tripMode = 'percorso'; ui.tripFocus = null; ui.tripMapDay = null; go('viaggi', { trip: el.dataset.id }); },
  'trip-back': () => { ui.trip = null; ui.tripFocus = null; render(); $('#view').scrollTop = 0; },
  'trip-filter': (el) => { tripUi.filter = el.dataset.f; render(); },
  'trip-sync': () => tripSyncNow(),
  'trip-setup': () => modalTripSetup(),
  'trip-ai': (el) => tripGenerate(el.dataset.id),
  'trip-mode': (el) => { ui.tripMode = el.dataset.m; render(); },
  'trip-day': (el) => { const d = document.getElementById('tday-' + el.dataset.d); d && d.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'trip-more': (el) => { const p = el.parentElement.querySelector('p'); const open = p.classList.toggle('clamp'); el.textContent = open ? 'Leggi tutto' : 'Mostra meno'; },
  'trip-mapday': (el) => { ui.tripMapDay = el.dataset.d || null; ui.tripFocus = null; render(); },
  'trip-pick': (el) => { ui.tripFocus = el.dataset.id; render(); },
  'trip-focus': (el) => { ui.tripFocus = el.dataset.id; ui.tripMode = 'percorso'; ui.tripScrollTo = el.dataset.id; render(); },
});
// gli eventi dell'agenda che arrivano da un viaggio aprono l'itinerario
function openTripFromEvent(e) {
  if (!e || !e.tripRef || !data.trips || !data.trips[e.tripRef.dest]) return false;
  closePopover(true);
  if (typeof closeSheet === 'function' && ui.sheet) closeSheet();
  ui.trip = e.tripRef.dest; ui.tripMode = 'percorso'; ui.tripFocus = e.tripRef.item || null; ui.tripScrollTo = e.tripRef.item || null;
  go('viaggi');
  return true;
}
const _openSheet = openSheet;
openSheet = function (sh) { if (sh && sh.kind === 'ev' && openTripFromEvent(data.events.find(x => x.id === sh.id))) return; return _openSheet(sh); };
for (const k of ['edit-event', 'sheet']) {
  const orig = actions[k];
  actions[k] = (el) => { const e = data.events.find(x => x.id === el.dataset.id); if (openTripFromEvent(e)) return; return orig(el); };
}

// ---------- agenda: gruppo “Viaggi” ----------
const TRIP_KEY = '__trips';
const _groupInfo = groupInfo;
groupInfo = function (e) {
  if (e && e.tripRef) return { key: 'trips::', color: tripsCfg().color || '#0a84ff', name: 'Viaggi', visible: !hiddenLocal().includes(TRIP_KEY) };
  return _groupInfo(e);
};
const _renderSideCals = renderSideCals;
renderSideCals = function () {
  _renderSideCals();
  const evs = data.events.filter(e => e.tripRef);
  if (!evs.length) return;
  const g = groupInfo(evs[0]);
  const n = evs.filter(e => parse(e.end || e.start) >= startOfDay(new Date())).length;
  const html = `<div class="cal-acc ${collapsed.trips ? 'collapsed' : ''}">
    <button class="cal-acc-head" data-action="acc-collapse" data-key="trips">${icon('i-chev-r', 'cal-chev')}<span class="prov mini prov-notion">N</span><span class="cal-acc-name">Viaggi da Notion</span></button>
    <div class="cal-groups">${calRow({ type: 'trip', gid: TRIP_KEY, color: g.color, name: 'Viaggi e tappe', visible: g.visible, count: n })}</div></div>`;
  $('#side-cals').insertAdjacentHTML('beforeend', html);
};
const _setGroup = setGroup, _curColor = currentGroupColor;
setGroup = async function (el, patch) {
  if (el.dataset.type !== 'trip') return _setGroup(el, patch);
  if ('color' in patch) data.settings.trips = { ...tripsCfg(), color: patch.color };
  if ('visible' in patch) { const h = new Set(hiddenLocal()); patch.visible ? h.delete(TRIP_KEY) : h.add(TRIP_KEY); data.settings.hiddenLocal = [...h]; }
  save(); render();
};
currentGroupColor = function (el) { return el.dataset.type === 'trip' ? (tripsCfg().color || '#0a84ff') : _curColor(el); };

// ---------- registrazione della sezione ----------
EXTRA_NAV.push(['viaggi', 'c-plane', 'Viaggi', () => { const n = tripsAll().filter(t => tripBucket(t) === 'programma').length; return n ? `<span class="count">${n}</span>` : ''; }]);
EXTRA_VIEWS.viaggi = {
  title: 'Viaggi',
  render: viewTrips,
  full: () => !!(ui.trip && data.trips && data.trips[ui.trip] && tripsCfg().destDb),
  after: (v) => {
    if (ui.tripScrollTo) {
      const el = document.getElementById('tstop-' + ui.tripScrollTo); ui.tripScrollTo = null;
      el && requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }));
    }
  },
};
if (data) render();
