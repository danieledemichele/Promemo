/* Promemo Android — chiedi all'assistente: comandi in italiano (anche a voce) e domande libere all'IA del computer */
'use strict';
let chatLog = [];
const CH_SUGG = ['Cosa ho domani?', 'Quando sono libero oggi?', 'Trovami 2 ore per studiare entro venerdì', 'Sposta la palestra a giovedì alle 19'];
const chNorm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9: ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'uno', 'di', 'del', 'della', 'dei', 'a', 'al', 'alla', 'alle', 'ad', 'con', 'per', 'mio', 'mia', 'miei', 'mie', 'e']);
const words = (t) => chNorm(t).split(' ').filter(w => w && !STOP.has(w));

// trova l'evento o il compito che somiglia di più alle parole dette
function chFind(q, { events = true, withSteps = true } = {}) {
  const qw = words(q); if (!qw.length) return null;
  const now = PM.isoL(addD(new Date(), -1)), lim = PM.isoL(addD(new Date(), 60));
  const cands = [];
  if (events) for (const e of PM.allEvents()) {
    if (e.rrule) { const occ = PromemoRecur.expand([e], new Date(), addD(new Date(), 60))[0]; if (occ) cands.push({ ev: e, occ, title: e.title }); continue; }
    if (e.start && e.start >= now && e.start <= lim) cands.push({ ev: e, title: e.title });
  }
  if (withSteps) for (const { p, st } of steps()) if (!st.done) cands.push({ st, p, title: st.text });
  let best = null, bs = 0;
  for (const c of cands) {
    const tw = words(c.title); let s = 0;
    for (const w of qw) if (tw.some(x => x === w)) s += 2; else if (tw.some(x => x.startsWith(w.slice(0, 5)) && w.length > 3)) s += 1;
    s = s / (qw.length * 2);
    const soon = (c.occ ? c.occ.start : c.ev ? c.ev.start : c.st.due) || '9';
    if (s > bs || (s === bs && best && soon < best.soon)) { bs = s; best = { ...c, soon }; }
  }
  return bs >= 0.5 ? best : null;
}

// separa "la palestra" da "a giovedì alle 19"
function chSplitWhen(rest) {
  const w = rest.split(' ');
  for (let i = 1; i < w.length; i++) {
    const tail = w.slice(i).join(' '), r = PromemoNLP.parse(tail);
    if (r.start && !r.title) {
      let head = w.slice(0, i); while (head.length && STOP.has(chNorm(head[head.length - 1]))) head.pop();
      return { what: head.join(' '), when: r };
    }
  }
  return null;
}
const chDay = (d) => cap(rel(d));
const chList = (its) => its.map(it => it.st ? `• ${it.st.due ? hm(it.st.due) + ' ' : ''}${it.st.text}${it.st.done ? ' ✓' : ''}` : `• ${it.ev.allDay ? 'tutto il giorno' : hm(it.ev.start)} ${it.ev.title}${it.ev.location ? ' · ' + it.ev.location : ''}`).join('\n');

function chFree(d) {
  const pl = { start: 9, end: 19, ...((S.data.ext && S.data.ext.settings && S.data.ext.settings.planner) || {}) };
  const from = new Date(day0(d)); from.setHours(pl.start, 0, 0, 0);
  const to = new Date(day0(d)); to.setHours(pl.end, 0, 0, 0);
  const t0 = sameDayPh(d, new Date()) ? new Date(Math.max(from, Math.ceil(Date.now() / 900000) * 900000)) : from;
  const busy = itemsOn(d).filter(x => x.ev && !x.ev.allDay).map(x => [parse(x.ev.start), parse(x.ev.end || x.ev.start)])
    .concat(itemsOn(d).filter(x => x.st && x.st.due && !x.st.done).map(x => [parse(x.st.due), new Date(parse(x.st.due).getTime() + (x.st.duration || 30) * 60000)])).sort((a, b) => a[0] - b[0]);
  const out = []; let cur = t0;
  for (const [s, e] of busy) { if (s - cur >= 30 * 60000 && s <= to) out.push([cur, s < to ? s : to]); if (e > cur) cur = e; }
  if (to - cur >= 30 * 60000) out.push([cur, to]);
  return out;
}
const sameDayPh = (a, b) => dk(a) === dk(b);
const fmtHM = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const durTxt = (m) => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;

async function chAnswer(text) {
  const n = chNorm(text);
  const when = PromemoNLP.parse(text);
  const dayD = when.start ? parse(when.start.slice(0, 10)) : new Date();
  // 1. domande sull'agenda
  if (/\b(cosa|che cosa|che)\b.*\b(ho|c e|devo|tocca)\b|\b(impegni|agenda|programma|appuntamenti)\b/.test(n) && !/^(sposta|rimanda|anticipa|posticipa|cancella|elimina)/.test(n)) {
    if (/\bsettimana\b/.test(n)) {
      const lines = []; for (let i = 0; i < 7; i++) { const d = addD(day0(new Date()), i), its = itemsOn(d); if (its.length) lines.push(`${cap(rel(d))}: ${its.map(x => x.ev ? (x.ev.allDay ? '' : hm(x.ev.start) + ' ') + x.ev.title : x.st.text).join(', ')}`); }
      return { t: lines.length ? lines.join('\n') : 'Settimana libera: nessun impegno nei prossimi 7 giorni.' };
    }
    const its = itemsOn(dayD);
    return { t: its.length ? `${chDay(dayD)} hai ${its.length} ${its.length === 1 ? 'cosa' : 'cose'}:\n${chList(its)}` : `${chDay(dayD)} non hai niente in agenda.`, acts: [{ label: 'Apri l’agenda', run: () => { closeSheet(); tab = 'agenda'; selDay = dk(dayD); render(); } }] };
  }
  // 2. spazi liberi
  if (/\b(libero|libera|liberi|spazio|buchi|buco)\b/.test(n)) {
    const fr = chFree(dayD);
    return { t: fr.length ? `${chDay(dayD)} sei libero:\n${fr.map(([a, b]) => `• ${fmtHM(a)}–${fmtHM(b)} (${durTxt(Math.round((b - a) / 60000))})`).join('\n')}` : `${chDay(dayD)} non vedo spazi liberi di almeno mezz’ora nel tuo orario.` };
  }
  // 3. sposta
  let m = n.match(/^(sposta|rimanda|anticipa|posticipa)\s+(.+)$/);
  if (m) {
    const raw = text.trim().split(/\s+/).slice(1).join(' ');
    const sp = chSplitWhen(raw);
    if (!sp) return { t: 'Dimmi anche quando, ad esempio “sposta la palestra a giovedì alle 19”.' };
    const f = chFind(sp.what);
    if (!f) return { t: `Non trovo “${sp.what}” tra i prossimi impegni e compiti.` };
    if (f.ev && f.ev._ro) return { t: `“${f.ev.title}” arriva da un calendario collegato: si sposta lì o dal computer.` };
    const r = sp.when;
    if (f.ev) {
      const e = S.data.events.find(x => x.id === f.ev.id), prev = { start: e.start, end: e.end, rrule: e.rrule && { ...e.rrule } };
      const os = parse(f.occ ? f.occ.start : e.start), oe = parse(f.occ ? f.occ.end : e.end || e.start), dur = oe - os;
      let ns = parse(r.start); if (r.allDay) { ns.setHours(os.getHours(), os.getMinutes(), 0, 0); }
      if (e.rrule && f.occ) {
        // una ripetizione: salto questa volta e creo un evento singolo
        e.rrule = { ...e.rrule, exdates: [...new Set([...(e.rrule.exdates || []), f.occ.start.slice(0, 10)])] };
        const one = { ...e, id: 'e-' + PM.uid(), start: PM.isoL(ns), end: PM.isoL(new Date(ns.getTime() + dur)) }; delete one.rrule; delete one.notifiedAt; S.data.events.push(one);
        PM.persist(); render();
        return { t: `Spostato solo questa volta: “${e.title}” ${rel(ns).toLowerCase()} alle ${fmtHM(ns)}.`, acts: [{ label: 'Annulla', run: () => { S.data.events = S.data.events.filter(x => x.id !== one.id); e.rrule = prev.rrule; PM.persist(); render(); chPush({ t: 'Annullato.' }); } }] };
      }
      e.start = PM.isoL(ns); e.end = PM.isoL(new Date(ns.getTime() + dur)); delete e.notifiedAt;
      PM.persist(); render();
      return { t: `Fatto: “${e.title}” ${rel(ns).toLowerCase()} alle ${fmtHM(ns)}.`, acts: [{ label: 'Annulla', run: () => { e.start = prev.start; e.end = prev.end; PM.persist(); render(); chPush({ t: 'Annullato.' }); } }] };
    }
    const s = f.st, prev = { due: s.due, deadline: s.deadline, auto: s.auto, autoDue: s.autoDue };
    let ns = parse(r.start); if (r.allDay) { const od = s.due ? parse(s.due) : null; ns.setHours(od ? od.getHours() : 9, od ? od.getMinutes() : 0, 0, 0); }
    s.due = PM.isoL(ns); if (s.auto) s.autoDue = s.due + '!'; delete s.notifiedAt; f.p.updatedAt = PM.isoL(new Date());
    PM.persist(); render();
    return { t: `Fatto: “${s.text}” ${rel(ns).toLowerCase()} alle ${fmtHM(ns)}.`, acts: [{ label: 'Annulla', run: () => { Object.assign(s, prev); if (!prev.autoDue) delete s.autoDue; PM.persist(); render(); chPush({ t: 'Annullato.' }); } }] };
  }
  // 4. trova il tempo per…
  m = n.match(/^(trovami|trova|pianifica|blocca|riservami|riserva|organizza)\b/);
  if (m) {
    const dm = n.match(/(\d+(?:[.,]\d+)?)\s*(ore|ora|h|minuti|min)\b/) || (/\bun ora\b|\bmezz ora\b/.test(n) ? [null, /mezz/.test(n) ? '0.5' : '1', 'ore'] : null);
    const min = dm ? Math.round(parseFloat(String(dm[1]).replace(',', '.')) * (/^min/.test(dm[2]) ? 1 : 60)) : 60;
    let title = text.replace(/^\s*\S+\s*/, '').replace(/^(?:del\s+|un\s+|mezz['’]?\s*)?(?:\d+(?:[.,]\d+)?\s*)?(?:ore|ora|h|minuti|min)?\s*(?:di tempo\s*)?(?:per|a)?\s*/i, '');
    const r = PromemoNLP.parse(title);
    title = (r.title || title).replace(/\s+(entro|prima di)\s*$/i, '').trim();
    if (!title) return { t: 'Per cosa? Ad esempio “trovami 2 ore per studiare idraulica entro venerdì”.' };
    const deadline = r.deadline || (r.start ? (r.allDay ? r.start.slice(0, 10) + 'T23:59' : r.start) : PM.isoL(addD(day0(new Date()), 7)).slice(0, 10) + 'T23:59');
    let p = S.data.projects.find(x => x.inbox && x.status !== 'archiviato');
    if (!p) { p = { id: 'p-' + PM.uid(), title: 'Da fare', category: '', description: 'Compiti aggiunti al volo', starred: false, status: 'attivo', createdAt: PM.isoL(new Date()), updatedAt: PM.isoL(new Date()), steps: [], traces: [], inbox: true }; S.data.projects.push(p); }
    const st = { id: 's-' + PM.uid(), text: cap(title), due: null, auto: true, deadline, duration: min, done: false, reminder: null };
    p.steps.push(st); PM.persist(); render();
    return { t: `Ok: ${durTxt(min)} per “${st.text}” entro ${rel(parse(deadline)).toLowerCase()}. Il computer trova lo spazio libero alla prossima sincronizzazione.`, acts: [{ label: 'Annulla', run: () => { p.steps = p.steps.filter(x => x !== st); PM.persist(); render(); chPush({ t: 'Annullato.' }); } }] };
  }
  // 5. fatto
  m = n.match(/^(ho fatto|ho finito|fatto|segna (?:come )?fatto|completato|completata|finito)\s+(.+)$/);
  if (m) {
    const f = chFind(m[2], { events: false });
    if (!f) return { t: `Non trovo il compito “${m[2]}”.` };
    f.st.done = true; f.st.doneAt = PM.isoL(new Date()); PM.spawnRepeats(); PM.persist(); render();
    return { t: `Segnato come fatto: “${f.st.text}” ✓`, acts: [{ label: 'Annulla', run: () => { f.st.done = false; f.st.doneAt = null; PM.persist(); render(); chPush({ t: 'Riaperto.' }); } }] };
  }
  // 6. elimina (con conferma)
  m = n.match(/^(cancella|elimina|togli)\s+(.+)$/);
  if (m) {
    const f = chFind(m[2]);
    if (!f) return { t: `Non trovo “${m[2]}”.` };
    if (f.ev && f.ev._ro) return { t: `“${f.ev.title}” arriva da un calendario collegato: si elimina lì.` };
    const name = f.ev ? f.ev.title : f.st.text;
    return { t: `Elimino “${name}”${f.ev ? ' (' + rel(parse(f.occ ? f.occ.start : f.ev.start)).toLowerCase() + ')' : ''}?`, acts: [{ label: 'Elimina', danger: true, run: () => { if (f.ev) S.data.events = S.data.events.filter(x => x.id !== f.ev.id); else f.p.steps = f.p.steps.filter(x => x !== f.st); PM.persist(); render(); chPush({ t: 'Eliminato.' }); } }] };
  }
  // 7. una frase con data o scadenza: la aggiungo
  if (when.title && (when.start || when.due || when.deadline || when.auto || when.rrule || when.repeat) && !/\?\s*$/.test(text)) {
    addFromText(text);
    const desc = PromemoNLP.describe(when).map(x => x[1]).join(' · ');
    return { t: `Aggiunto: ${when.title}${desc ? ' · ' + desc : ''}.` };
  }
  // 8. tutto il resto: l'IA del computer
  try {
    const t = await PM.askDesktop(text, chatLog.filter(m => !m.wait).slice(-7, -1).map(m => ({ t: m.t, me: !!m.me })));
    return { t, ai: true };
  } catch (e) {
    return { t: `${e.message === 'non raggiungibile' || e.message === 'tempo scaduto' ? 'Per le domande libere serve il computer acceso sulla stessa rete.' : e.message + '.'}\nQui posso già: dirti cosa hai in un giorno, quando sei libero, spostare un impegno, trovare il tempo per un compito, segnare qualcosa come fatto o aggiungere un appuntamento.` };
  }
}

function chPush(msg) {
  chatLog.push(msg); chatLog = chatLog.slice(-40);
  const box = $('#chat-log'); if (!box) return;
  box.insertAdjacentHTML('beforeend', chBubble(msg, chatLog.length - 1));
  box.scrollTop = box.scrollHeight;
}
const chBubble = (m, i) => `<div class="cb ${m.me ? 'me' : ''} ${m.wait ? 'wait' : ''}" data-ci="${i}">${esc(m.t).replace(/\n/g, '<br>')}${m.ai ? '<small>dal computer · IA</small>' : ''}${(m.acts || []).length ? `<div class="cb-acts">${m.acts.map((a, n) => `<button class="btn ${a.danger ? 'confirm' : n === 0 ? 'primary' : ''}" data-chact="${i}" data-n="${n}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;

async function chSend(text) {
  text = String(text || '').trim(); if (!text) return;
  chPush({ t: text, me: true });
  const wait = { t: '…', wait: true }; chPush(wait);
  let ans;
  try { ans = await chAnswer(text); } catch (e) { ans = { t: 'Qualcosa è andato storto: ' + e.message }; PM.plog('error', 'chat: ' + e.message); }
  const i = chatLog.indexOf(wait); if (i >= 0) chatLog.splice(i, 1);
  const el = $('#chat-log .cb.wait'); if (el) el.remove();
  chPush(ans);
}

function openChat(voice) {
  $('#sheet-body').innerHTML = `<div class="chat"><h2>Chiedi</h2>
    <div class="chat-log" id="chat-log">${chatLog.length ? chatLog.map(chBubble).join('') : `<div class="cb">Ciao! Chiedimi cosa hai in programma, quando sei libero, oppure dimmi cosa spostare o aggiungere.</div>`}</div>
    <div class="chat-sugg">${CH_SUGG.map(s => `<button class="pill" data-chs="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <form class="chat-in" data-chat><input id="chat-in" placeholder="Scrivi o detta…" autocomplete="off" enterkeyhint="send"><button type="button" class="ag-round mic" data-chmic aria-label="Detta">🎙</button><button class="send" aria-label="Invia">↑</button></form></div>`;
  $('#sheet').hidden = false;
  requestAnimationFrame(() => { $('#sheet').classList.add('open'); const b = $('#chat-log'); b.scrollTop = b.scrollHeight; if (voice) chVoice(); else setTimeout(() => $('#chat-in') && $('#chat-in').focus(), 230); });
}

// dettatura: riconoscimento vocale di Android; altrimenti il microfono della tastiera
async function chVoice() {
  const sr = PM.speech();
  const fallback = (why) => { const i = $('#chat-in'); if (i) { i.focus(); i.placeholder = 'Tocca il microfono della tastiera e parla'; } if (why) PM.plog('warn', 'voce: ' + why); };
  if (!sr) return fallback();
  try {
    const av = await sr.available(); if (!av || !av.available) return fallback('riconoscimento non disponibile');
    let p = await sr.checkPermissions(); if (p.speechRecognition !== 'granted') p = await sr.requestPermissions();
    if (p.speechRecognition !== 'granted') { toast('Consenti il microfono per dettare'); return fallback('permesso negato'); }
    const mic = $('[data-chmic]'); if (mic) mic.classList.add('on');
    const r = await sr.start({ language: 'it-IT', maxResults: 1, prompt: 'Dimmi pure', partialResults: false, popup: true });
    if (mic) mic.classList.remove('on');
    const t = r && r.matches && r.matches[0];
    if (t) chSend(t);
  } catch (e) { const mic = $('[data-chmic]'); if (mic) mic.classList.remove('on'); if (!/cancel|no match|annull/i.test(e.message || '')) fallback(e.message); }
}

document.addEventListener('click', (e) => {
  const t = e.target;
  const s = t.closest('[data-chs]'); if (s) { e.stopImmediatePropagation(); return chSend(s.dataset.chs); }
  if (t.closest('[data-chmic]')) { e.stopImmediatePropagation(); return chVoice(); }
  const a = t.closest('[data-chact]');
  if (a) { e.stopImmediatePropagation(); const m = chatLog[+a.dataset.chact]; const x = m && m.acts && m.acts[+a.dataset.n]; if (x) { m.acts = []; a.parentElement.remove(); x.run(); } }
}, true);
document.addEventListener('submit', (e) => {
  if (!('chat' in e.target.dataset)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const i = $('#chat-in'); const v = i.value; i.value = ''; chSend(v);
}, true);
