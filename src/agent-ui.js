/* Promemo — l'assistente proattivo nella Home: cosa ha notato, il piano della giornata e le azioni proposte */
'use strict';

const agentState = () => (data && data.agent) || {};
const agentCfg = () => ({ enabled: true, every: 2, ai: true, notify: true, quietFrom: 22, quietTo: 7, maxNotif: 6, ...(data.settings.agent || {}) });
let agentOpenAll = false;
const AG_LEVEL = { alta: 'Importante', media: 'Da guardare', info: 'Suggerimento' };
const AG_KIND_IC = { conflitto: 'i-calendar', partenza: 'i-route', ritardo: 'i-bell', scadenza: 'i-target', spazio: 'i-clock', carico: 'i-chart', domani: 'i-sunrise', viaggio: 'c-plane', account: 'i-sync', ia: 'i-spark' };

function agentAgo(isoS) {
  if (!isoS) return '';
  const m = Math.round((Date.now() - new Date(isoS)) / 60000);
  if (m < 1) return 'adesso';
  if (m < 60) return `${m} min fa`;
  const d = new Date(isoS);
  return sameDay(d, new Date()) ? `alle ${fmtHM(d)}` : `${fmtLong(d)}, ${fmtHM(d)}`;
}

function agentItemHTML(i) {
  const acts = (i.actions || []).map((a, n) => `<button class="${n === 0 ? 'btn-primary' : 'btn'} small" data-action="agent-act" data-id="${esc(i.id)}" data-n="${n}">${esc(a.label)}</button>`).join('');
  return `<div class="ag-item lv-${i.level || 'info'}">
    <div class="ag-item-ic">${icon(AG_KIND_IC[i.kind] || 'i-spark')}</div>
    <div class="ag-item-body">
      <div class="ag-item-top"><span class="ag-lv">${AG_LEVEL[i.level] || 'Suggerimento'}${i.ai ? ' · IA' : ''}</span>
        <button class="icon-btn ag-x" data-action="agent-dismiss" data-id="${esc(i.id)}" title="Ignora">${icon('i-close')}</button></div>
      <b>${esc(i.title)}</b>${i.text ? `<span>${esc(i.text)}</span>` : ''}
      ${acts ? `<div class="ag-acts">${acts}</div>` : ''}
    </div>
  </div>`;
}

function agentItems() {
  const a = agentState();
  const lv = { alta: 0, media: 1, info: 2 };
  return [...(a.insights || []), ...(a.tips || [])].sort((x, y) => (lv[x.level] ?? 3) - (lv[y.level] ?? 3));
}

function agentCardHTML() {
  if (!data || !agentCfg().enabled) return '';
  const a = agentState(), items = agentItems();
  const shown = agentOpenAll ? items : items.slice(0, 3);
  const summary = a.aiSummary || a.summary;
  return `<section class="ag-card" id="agent-card">
    <div class="ag-bg"></div>
    <div class="ag-glass">
      <div class="ag-bar">
        <div class="ag-who"><span class="ag-orb ${a.running ? 'on' : ''}">${icon('i-spark')}</span><div><b>Assistente</b><small>${a.running ? 'Sto leggendo agenda, compiti e viaggi…' : a.at ? `Ultima lettura ${agentAgo(a.at)}` : 'Leggo tutto tra poco'}</small></div></div>
        <span class="ag-pill">${items.length ? `${items.length} ${items.length === 1 ? 'suggerimento' : 'suggerimenti'}` : 'Tutto sotto controllo'}</span>
        <button class="icon-btn" data-action="agent-run" title="Rileggi adesso">${icon('i-refresh')}</button>
        <button class="icon-btn" data-action="agent-feed" title="Cosa ho notato">${icon('i-clock')}</button>
      </div>
      <div class="ag-insight">
        <div class="ag-eyebrow">La tua giornata${a.aiSummary ? ' · scritta dall’IA' : ''}</div>
        <p>${summary ? esc(summary) : 'Appena ho letto le tue fonti ti dico cosa conta oggi e cosa posso sistemare per te.'}</p>
      </div>
      ${shown.length ? `<div class="ag-list">${shown.map(agentItemHTML).join('')}</div>` : ''}
      ${items.length > 3 ? `<button class="link ag-more" data-action="agent-more">${agentOpenAll ? 'Mostra meno' : `Mostra tutti (${items.length})`}</button>` : ''}
    </div>
  </section>`;
}

// la card va sopra le tessere della Home
const _viewHome_ag = viewHome;
viewHome = function () { return _viewHome_ag().replace('<section class="bento">', agentCardHTML() + '<section class="bento">'); };

// aspetta che l'ultimo salvataggio sia arrivato al processo principale, poi esegue
async function agentFlush() { for (let i = 0; i < 20 && dirty; i++) await new Promise(r => setTimeout(r, 60)); }

async function agentRunOp(item, a) {
  const { op, args = {} } = a;
  // le azioni di navigazione restano qui
  if (op === 'open-ev') {
    const ev = data.events.find(e => e.id === args.id);
    if (ev && !ev.source && !ev.tripRef) return modalEvent(ev);
    const d = parse(args.date); return go('agenda', { sel: args.date, month: new Date(d.getFullYear(), d.getMonth(), 1) });
  }
  if (op === 'open-day') { const d = parse(args.date); return go('agenda', { sel: args.date, month: new Date(d.getFullYear(), d.getMonth(), 1) }); }
  if (op === 'open-st') { const [, s] = findStep(args.pid, args.sid); return s ? modalStep(args.pid, s) : null; }
  if (op === 'open-trip') { ui.trip = args.id; ui.tripMode = 'percorso'; return go('viaggi', { trip: args.id }); }
  if (op === 'open-settings') return modalSettings(args.pane);
  if (op === 'focus') { const [, s] = findStep(args.pid, args.sid); if (typeof focusStart === 'function') focusStart({ pid: args.pid, sid: args.sid, label: s ? s.text : '' }); return; }
  await agentFlush();
  try { const msg = await api.agentAct({ op, args, id: item.id }); toast(msg || 'Fatto'); }
  catch (e) { toast('Non riuscito: ' + (e.message || e)); }
}

function modalAgentFeed() {
  const a = agentState(), feed = [...(a.feed || [])].reverse();
  const byDay = {};
  for (const f of feed) { const k = dayKey(new Date(f.at)); (byDay[k] = byDay[k] || []).push(f); }
  openModal(`<h2>Cosa ho notato</h2>
    <p class="muted" style="margin-top:-6px">Leggo agenda, compiti, viaggi e calendari collegati ogni ${agentCfg().every} ${+agentCfg().every === 1 ? 'ora' : 'ore'} e dopo ogni sincronizzazione.</p>
    <div class="ag-feed">${Object.keys(byDay).length ? Object.entries(byDay).map(([k, fs]) => `<div class="ag-feed-day">${sameDay(parse(k), new Date()) ? 'Oggi' : fmtLong(parse(k))}</div>
      ${fs.map(f => `<div class="ag-feed-i lv-${f.level}"><span class="ag-feed-t">${fmtHM(new Date(f.at))}</span><div><b>${esc(f.title)}</b><small>${esc(f.text || '')}</small></div></div>`).join('')}`).join('') : '<div class="empty"><b>Ancora niente</b>Le cose che noto compariranno qui.</div>'}</div>
    <div class="modal-actions"><button class="btn" data-action="agent-settings">Impostazioni</button><button class="btn-primary" data-action="close-modal">Chiudi</button></div>`);
}

Object.assign(actions, {
  'agent-act': (el) => { const it = agentItems().find(x => x.id === el.dataset.id); if (it && it.actions[+el.dataset.n]) agentRunOp(it, it.actions[+el.dataset.n]); },
  'agent-dismiss': async (el) => { const id = el.dataset.id; const a = agentState(); a.insights = (a.insights || []).filter(i => i.id !== id); a.tips = (a.tips || []).filter(i => i.id !== id); render(); await agentFlush(); api.agentAct({ op: 'dismiss', id }); },
  'agent-run': async () => { const a = agentState(); a.running = true; render(); await agentFlush(); try { await api.agentRun(); } catch { toast('Lettura non riuscita'); } },
  'agent-feed': () => modalAgentFeed(),
  'agent-more': () => { agentOpenAll = !agentOpenAll; render(); },
  'agent-settings': () => modalSettings('agente'),
});

api.onNavigate((r) => {
  if (!r || r.action !== 'agent') return;
  go('home');
  setTimeout(() => { const c = document.getElementById('agent-card'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
});

PALETTE_EXTRA.push(
  { t: 'Assistente: rileggi adesso', i: 'i-spark', k: 'agente proattivo analizza riepilogo', run: () => actions['agent-run']() },
  { t: 'Assistente: cosa ho notato', i: 'i-clock', k: 'agente cronologia storico', run: () => modalAgentFeed() },
);

// ---------- impostazioni ----------
SET_PANES.splice(Math.max(0, SET_PANES.findIndex(p => p[0] === 'assistente')) + 1, 0, ['agente', 'i-target', 'Assistente proattivo']);
const _paneHTML_ag = paneHTML;
paneHTML = function (id, ls) {
  if (id !== 'agente') return _paneHTML_ag(id, ls);
  const c = agentCfg(), a = agentState();
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const aiOn = data.settings.ai && data.settings.ai.provider && data.settings.ai.provider !== 'none';
  return `<h3>Assistente proattivo</h3>
    <p class="set-note" style="margin:-6px 0 14px">Anche senza che tu chieda niente, Promemo legge agenda, compiti, viaggi, spostamenti e calendari collegati, nota sovrapposizioni, ritardi e spazi liberi, e ti propone cosa fare. Lo trovi in cima alla Home e sul telefono.</p>
    <div class="set-group">
      <label class="switch-row"><div>Attivo<small>${a.at ? `Ultima lettura ${agentAgo(a.at)}` : 'Non ha ancora letto niente'}</small></div><input type="checkbox" class="switch" data-ag="enabled" ${c.enabled ? 'checked' : ''}></label>
      ${srow('Rileggi ogni', 'Rilegge anche dopo ogni sincronizzazione e quando cambi qualcosa', `<select class="set-select" data-ag="every">${[[1, '1 ora'], [2, '2 ore'], [3, '3 ore'], [4, '4 ore'], [6, '6 ore'], [12, '12 ore']].map(([v, l]) => `<option value="${v}" ${+c.every === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      <label class="switch-row"><div>Piano scritto dall’IA<small>${aiOn ? 'Riassume la giornata e propone fino a 3 idee in più' : 'Serve un motore nella scheda Assistente'}</small></div><input type="checkbox" class="switch" data-ag="ai" ${c.ai && aiOn ? 'checked' : ''} ${aiOn ? '' : 'disabled'}></label>
      <label class="switch-row"><div>Avvisami per le cose importanti<small>Sovrapposizioni, partenze imminenti, scadenze</small></div><input type="checkbox" class="switch" data-ag="notify" ${c.notify ? 'checked' : ''}></label>
      ${srow('Silenzio', 'Nessun avviso in queste ore', `<select class="set-select" data-ag="quietFrom">${hours.map(h => `<option value="${h}" ${+c.quietFrom === h ? 'selected' : ''}>dalle ${pad(h)}:00</option>`).join('')}</select><select class="set-select" data-ag="quietTo">${hours.map(h => `<option value="${h}" ${+c.quietTo === h ? 'selected' : ''}>alle ${pad(h)}:00</option>`).join('')}</select>`)}
      ${srow('Avvisi al giorno', '', `<select class="set-select" data-ag="maxNotif">${[2, 4, 6, 10].map(v => `<option value="${v}" ${+c.maxNotif === v ? 'selected' : ''}>al massimo ${v}</option>`).join('')}</select>`)}
      ${srow('Adesso', '', '<button class="btn small" data-agset="run">Rileggi adesso</button><button class="btn small" data-agset="feed">Cosa ho notato</button><button class="btn small" data-agset="reset">Mostra di nuovo gli ignorati</button>')}
    </div>
    <p class="set-note">Tutta l’analisi avviene su questo computer. Al motore IA arrivano solo gli impegni di oggi e domani e i compiti aperti, e solo se il piano scritto dall’IA è attivo.</p>`;
};
const _drawPane_ag = drawPane;
drawPane = function (m) {
  _drawPane_ag(m);
  if (setPane !== 'agente') return;
  const box = m.querySelector('#set-pane');
  box.querySelectorAll('[data-ag]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.ag;
    const v = el.type === 'checkbox' ? el.checked : +el.value;
    data.settings.agent = { ...agentCfg(), [k]: v };
    save(); render();
  }));
  box.querySelectorAll('[data-agset]').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.agset;
    if (k === 'run') { b.disabled = true; b.textContent = 'Leggo…'; await agentFlush(); try { await api.agentRun(); toast('Fatto: guarda la Home'); } catch { toast('Lettura non riuscita'); } drawPane(m); }
    if (k === 'feed') modalAgentFeed();
    if (k === 'reset') { await agentFlush(); await api.agentAct({ op: 'reset-dismissed' }); toast('Rivedrai anche i suggerimenti ignorati'); }
  }));
};
