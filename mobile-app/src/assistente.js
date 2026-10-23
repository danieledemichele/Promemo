/* Promemo Android — la schermata dell'assistente: cosa ho notato, cosa fare adesso, e un tasto per un nuovo evento */
'use strict';
const AG_IC = { conflitto: '⧉', partenza: '➜', ritardo: '!', scadenza: '◎', spazio: '◷', carico: '▥', domani: '☀', viaggio: '✈', account: '↻', ia: '✦' };
const AG_LV = { alta: 'Importante', media: 'Da guardare', info: 'Suggerimento' };
const AG_PHONE_OPS = ['dismiss', 'steps-today', 'steps-tomorrow', 'steps-auto', 'step-at', 'step-done', 'quick', 'open-ev', 'open-day', 'open-st', 'open-trip', 'focus'];
let agAll = false;

function agDismissed() { S.cfg.agDismissed = S.cfg.agDismissed || {}; return S.cfg.agDismissed; }
function agentNow() {
  const x = S.data.ext || {}, st = x.settings || {};
  let r = { summary: '', insights: [] };
  try {
    r = PromemoAgent.analyze({ events: PM.allEvents(), projects: S.data.projects, travel: st.travel ? (x.travel || {}) : {}, trips: x.trips || [], accounts: [], planner: { start: 9, end: 19, ...(st.planner || {}) }, now: new Date(), hidden: () => false });
  } catch (e) { PM.plog('warn', 'assistente: ' + e.message); }
  const ag = x.agent || {};
  const dis = agDismissed();
  // i suggerimenti dell'IA arrivano dal computer; le regole girano qui, sui dati più freschi
  const tips = (ag.tips || []).filter(t => !dis[t.id]);
  const lv = { alta: 0, media: 1, info: 2 };
  const items = r.insights.filter(i => !dis[i.id]).map(i => ({ ...i, actions: (i.actions || []).filter(a => AG_PHONE_OPS.includes(a.op)) })).concat(tips).sort((a, b) => (lv[a.level] ?? 3) - (lv[b.level] ?? 3));
  return { summary: ag.aiSummary && ag.at && Date.now() - new Date(ag.at) < 6 * 3600e3 ? ag.aiSummary : r.summary, ai: !!(ag.aiSummary && ag.at && Date.now() - new Date(ag.at) < 6 * 3600e3), at: ag.at, items, feed: ag.feed || [] };
}

// l'impegno in corso (con l'avanzamento) o il prossimo
function agNowCard() {
  const now = new Date(), nowS = PM.isoL(now);
  const its = itemsOn(now).filter(x => x.ev && !x.ev.allDay && (x.ev.end || x.ev.start) > nowS);
  const cur = its.find(x => x.ev.start <= nowS), nx = cur || its[0];
  if (!nx) {
    const t = itemsOn(addD(now, 1)).find(x => x.ev && !x.ev.allDay);
    return `<div class="ag-now idle"><div class="ag-now-top"><small>Adesso</small><span class="chip">Libero</span></div><b>Niente altro in agenda oggi</b><span>${t ? `Domani alle ${hm(t.ev.start)}: ${esc(t.ev.title)}` : 'Neanche domani: giornata leggera.'}</span></div>`;
  }
  const e = nx.ev, s = parse(e.start), en = parse(e.end || e.start);
  const pct = cur ? Math.max(2, Math.min(100, Math.round((now - s) / Math.max(1, en - s) * 100))) : 0;
  const mins = Math.round((s - now) / 60000);
  const lv = leaveOf(e);
  return `<div class="ag-now" style="--c:${esc(PM.colorOf(e))}" data-open="ev" data-id="${e.id}" data-occ="${e._occ || ''}">
    <div class="ag-now-top"><small>${cur ? 'Azione in corso' : 'Prossima azione'}</small><span class="chip ${cur ? 'run' : ''}">${cur ? 'In corso' : mins < 60 ? `tra ${mins} min` : `alle ${hm(e.start)}`}</span></div>
    <b>${esc(e.title)}</b><span>${hm(e.start)}–${hm(e.end)}${e.location ? ' · ' + esc(e.location) : ''}${lv && !cur ? ` · esci alle ${lv.leaveAt.slice(11, 16)}` : ''}</span>
    ${cur ? `<div class="ag-prog"><i style="width:${pct}%"></i></div><div class="ag-prog-l"><span>${pct}%</span><span>finisce alle ${hm(e.end)}</span></div>` : ''}
  </div>`;
}

function agItem(i) {
  return `<div class="ag-it lv-${i.level || 'info'}">
    <div class="ag-it-top"><span class="ag-ic">${AG_IC[i.kind] || '✦'}</span><small>${AG_LV[i.level] || 'Suggerimento'}${i.ai ? ' · IA' : ''}</small><button class="ag-x" data-agx="${esc(i.id)}" aria-label="Ignora">×</button></div>
    <b>${esc(i.title)}</b>${i.text ? `<span>${esc(i.text)}</span>` : ''}
    ${(i.actions || []).length ? `<div class="ag-acts">${i.actions.map((a, n) => `<button class="btn ${n === 0 ? 'primary' : ''}" data-aga="${esc(i.id)}" data-n="${n}">${esc(a.label)}</button>`).join('')}</div>` : ''}
  </div>`;
}

function viewAssistant() {
  const a = agentNow(), shown = agAll ? a.items : a.items.slice(0, 3);
  const now = new Date();
  return `<div class="ag-screen">
    <div class="ag-glass">
      <div class="ag-bar"><button class="ag-round" data-tab-go="altro" aria-label="Menu">≡</button><span class="ag-pill">${a.items.length ? `${a.items.length} ${a.items.length === 1 ? 'suggerimento' : 'suggerimenti'}` : 'Tutto in ordine'}</span><button class="ag-round" data-agfeed aria-label="Cosa ho notato">◷</button></div>
      <div class="ag-insight"><small>${a.ai ? 'La tua giornata · IA' : 'La tua giornata'}</small>
        <p>${esc(a.summary || 'Sincronizza con il computer e ti dico cosa conta oggi.')}</p>
        <em>${cap(now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }))} · ${pad(now.getHours())}:${pad(now.getMinutes())}${a.at ? ` · piano del computer ${agoText(a.at)}` : ''}</em></div>
      ${agNowCard()}
      ${shown.map(agItem).join('')}
      ${a.items.length > 3 ? `<button class="link ag-more" data-agmore>${agAll ? 'Mostra meno' : `Mostra tutti (${a.items.length})`}</button>` : ''}
    </div>
    <div class="ag-dock">
      <button class="ag-round" data-agquick aria-label="Scrivi una frase">✎</button>
      <button class="ag-new" data-newev><span>+</span> Nuovo evento</button>
      <button class="ag-round" data-agmic aria-label="Detta">🎙</button>
    </div>
  </div>`;
}

// ---------- azioni proposte, eseguite sul telefono (arrivano al computer con la sincronizzazione) ----------
function agFind(pid, sid) { const p = S.data.projects.find(x => x.id === pid); return [p, p && p.steps.find(s => s.id === sid)]; }
function agRun(item, a) {
  const { op, args = {} } = a, now = new Date();
  const done = (msg) => { agDismissed()[item.id] = now.toISOString(); PM.persist(); kvSave(); render(); toast(msg); };
  if (op === 'open-ev') return openSheet('ev', args.id);
  if (op === 'open-day') { tab = 'agenda'; selDay = args.date; return render(); }
  if (op === 'open-st' || op === 'focus') return openSheet('st', args.sid);
  if (op === 'open-trip') { tab = 'progetti'; return render(); }
  if (op === 'quick') { addFromText(args.text); return done('Aggiunto'); }
  if (op === 'steps-today' || op === 'steps-tomorrow') {
    let n = 0;
    for (const [pid, sid] of args.ids || []) {
      const [p, s] = agFind(pid, sid); if (!s) continue;
      const t = new Date(now); if (op === 'steps-tomorrow') t.setDate(t.getDate() + 1);
      const old = s.due ? parse(s.due) : null; t.setHours(old ? old.getHours() : 9, old ? old.getMinutes() : 0, 0, 0);
      if (op === 'steps-today' && t < now) { t.setTime(now.getTime() + 3600000); t.setMinutes(0); }
      if (s.auto) { delete s.autoDue; s.due = null; if (op === 'steps-tomorrow') s.notBefore = PM.isoL(day0(addD(now, 1))); } else s.due = PM.isoL(t);
      delete s.notifiedAt; p.updatedAt = PM.isoL(now); n++;
    }
    return done(`${n} ${n === 1 ? 'compito spostato' : 'compiti spostati'} a ${op === 'steps-today' ? 'oggi' : 'domani'}`);
  }
  if (op === 'steps-auto') {
    for (const [pid, sid] of args.ids || []) { const [p, s] = agFind(pid, sid); if (!s) continue; s.auto = true; s.deadline = s.deadline || dk(addD(now, 3)) + 'T23:59'; delete s.autoDue; s.due = null; p.updatedAt = PM.isoL(now); }
    return done('Il computer troverà il tempo negli spazi liberi');
  }
  if (op === 'step-at') { const [p, s] = agFind(args.pid, args.sid); if (s) { s.due = args.start; if (s.auto) s.autoDue = args.start + '!'; delete s.notifiedAt; p.updatedAt = PM.isoL(now); } return done(`Fissato alle ${String(args.start).slice(11, 16)}`); }
  if (op === 'step-done') { const [p, s] = agFind(args.pid, args.sid); if (s) { s.done = true; s.doneAt = PM.isoL(now); p.updatedAt = PM.isoL(now); PM.spawnRepeats(); } return done('Fatto ✓'); }
}
function kvSave() { try { PM.kv.set('cfg', JSON.stringify(S.cfg)); } catch { /* */ } }

function agFeedSheet() {
  const f = [...agentNow().feed].reverse();
  $('#sheet-body').innerHTML = `<h2>Cosa ho notato</h2><p class="muted small">Il computer legge agenda, compiti, viaggi e calendari collegati ogni poche ore; qui trovi le ultime cose che ha notato.</p>
    ${f.length ? f.map(x => `<div class="ag-feed lv-${x.level}"><span>${new Date(x.at).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><div><b>${esc(x.title)}</b><small>${esc(x.text || '')}</small></div></div>`).join('') : '<div class="empty">Ancora niente: sincronizza con il computer.</div>'}
    <div class="btns"><button class="btn" data-agreset>Mostra di nuovo gli ignorati</button><span class="grow"></span><button class="btn" data-close>Chiudi</button></div>`;
  $('#sheet').hidden = false; requestAnimationFrame(() => $('#sheet').classList.add('open'));
}

// ---------- nuovo evento ----------
function openNewEvent(preset = {}) {
  const now = new Date();
  const base = preset.date && preset.date !== dk(now) ? parse(preset.date + 'T09:00') : new Date(Math.ceil((now.getTime() + 15 * 60000) / 3600000) * 3600000);
  const end = new Date(base.getTime() + 3600000);
  const v = (d) => PM.isoL(d).slice(0, 16);
  $('#sheet-body').innerHTML = `<form data-save="new-ev"><h2>Nuovo evento</h2>
    <label class="row"><span>Titolo</span><input name="title" placeholder="Es. Cena con Marco" required autocomplete="off" enterkeyhint="next"></label>
    <label class="row"><span>Tutto il giorno</span><input type="checkbox" class="sw" name="allDay"></label>
    <label class="row"><span>Inizio</span><input type="datetime-local" name="start" value="${v(base)}"></label>
    <label class="row"><span>Fine</span><input type="datetime-local" name="end" value="${v(end)}"></label>
    <label class="row"><span>Luogo</span><input name="location" placeholder="Facoltativo" autocomplete="off"></label>
    <label class="row"><span>Promemoria</span><select name="reminder">${REM.map(([x, l]) => `<option value="${x ?? ''}" ${x === 15 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="row"><span>Ripeti</span><select name="repeat">${REP.map(([x, l]) => `<option value="${x}">${l}</option>`).join('')}</select></label>
    ${S.data.projects.some(p => p.status === 'attivo') ? `<label class="row"><span>Progetto</span><select name="pid"><option value="">Nessuno</option>${S.data.projects.filter(p => p.status === 'attivo').map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></label>` : ''}
    <label class="col"><span>Note</span><textarea name="notes" rows="3"></textarea></label>
    <div class="btns"><button type="button" class="btn" data-close>Annulla</button><span class="grow"></span><button class="btn primary">Aggiungi</button></div></form>`;
  $('#sheet').hidden = false; requestAnimationFrame(() => { $('#sheet').classList.add('open'); setTimeout(() => $('#sheet [name=title]').focus(), 230); });
}
function saveNewEvent(f) {
  const fd = new FormData(f), title = String(fd.get('title') || '').trim();
  if (!title) return toast('Scrivi il titolo');
  const allDay = !!fd.get('allDay'); let s = fd.get('start'), en = fd.get('end') || s; if (en < s) en = s;
  const e = { id: 'e-' + PM.uid(), title, kind: 'appuntamento', projectId: fd.get('pid') || '', allDay, start: allDay ? s.slice(0, 10) + 'T00:00' : s, end: allDay ? en.slice(0, 10) + 'T23:59' : en, location: String(fd.get('location') || '').trim(), reminder: fd.get('reminder') === '' ? null : +fd.get('reminder'), notes: fd.get('notes') || '' };
  const rp = repRule(fd.get('repeat'), parse(e.start)); if (rp) e.rrule = rp;
  S.data.events.push(e);
  PM.persist(); closeSheet(); render();
  toast(`Aggiunto: ${title} · ${cap(rel(parse(e.start)))}${allDay ? '' : ' alle ' + hm(e.start)}`);
}

// la frase veloce (anche dettata con il microfono della tastiera)
function openQuick(mic) {
  $('#sheet-body').innerHTML = `<form data-save="quick"><h2>${mic ? 'Detta' : 'Scrivi'}</h2>
    <p class="muted small">${mic ? 'Tocca il microfono della tastiera e di’ cosa aggiungere, es. “dentista martedì alle 9” o “studiare cap. 4 entro venerdì”.' : 'Una frase basta: capisco data, ora, luogo, ripetizione e scadenza.'}</p>
    <label class="col"><textarea name="text" rows="3" placeholder="Es. riunione con Laura giovedì alle 15 in ufficio" enterkeyhint="done"></textarea></label>
    <p class="muted small" id="q-hint"></p>
    <div class="btns"><button type="button" class="btn" data-close>Annulla</button><span class="grow"></span><button class="btn primary">Aggiungi</button></div></form>`;
  $('#sheet').hidden = false; requestAnimationFrame(() => { $('#sheet').classList.add('open'); setTimeout(() => $('#sheet [name=text]').focus(), 230); });
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-newev]')) { e.stopImmediatePropagation(); return openNewEvent(tab === 'agenda' ? { date: selDay } : {}); }
  if (t.closest('[data-agquick]')) { e.stopImmediatePropagation(); return openQuick(false); }
  if (t.closest('[data-agmic]')) { e.stopImmediatePropagation(); return openQuick(true); }
  if (t.closest('[data-agfeed]')) { e.stopImmediatePropagation(); return agFeedSheet(); }
  if (t.closest('[data-agmore]')) { e.stopImmediatePropagation(); agAll = !agAll; return render(); }
  if (t.closest('[data-agreset]')) { e.stopImmediatePropagation(); S.cfg.agDismissed = {}; kvSave(); closeSheet(); render(); return toast('Rivedrai anche quelli ignorati'); }
  const go = t.closest('[data-tab-go]'); if (go) { e.stopImmediatePropagation(); tab = go.dataset.tabGo; render(); return window.scrollTo(0, 0); }
  const x = t.closest('[data-agx]'); if (x) { e.stopImmediatePropagation(); agDismissed()[x.dataset.agx] = new Date().toISOString(); kvSave(); render(); return toast('Nascosto'); }
  const b = t.closest('[data-aga]');
  if (b) { e.stopImmediatePropagation(); const it = agentNow().items.find(i => i.id === b.dataset.aga); const a = it && it.actions[+b.dataset.n]; if (a) agRun(it, a); }
}, true);
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.dataset.save === 'new-ev') { e.preventDefault(); e.stopImmediatePropagation(); saveNewEvent(f); }
  if (f.dataset.save === 'quick') { e.preventDefault(); e.stopImmediatePropagation(); const v = f.querySelector('textarea').value.trim(); if (v) { addFromText(v); closeSheet(); } }
}, true);
document.addEventListener('input', (e) => {
  if (!e.target.closest('form[data-save="quick"] textarea')) return;
  const v = e.target.value.trim(), h = $('#q-hint'); if (!h) return;
  if (!v) { h.textContent = ''; return; }
  const r = PromemoNLP.parse(v, { projects: S.data.projects }); h.textContent = [r.title, ...PromemoNLP.describe(r).map(x => x[1])].join(' · ');
});
document.addEventListener('change', (e) => { const f = e.target.closest('form[data-save="new-ev"]'); if (f && e.target.name === 'allDay') { for (const n of ['start', 'end']) { const i = f.querySelector(`[name=${n}]`); const v = i.value; i.type = e.target.checked ? 'date' : 'datetime-local'; i.value = e.target.checked ? v.slice(0, 10) : v.length === 10 ? v + (n === 'start' ? 'T09:00' : 'T10:00') : v; } } });
