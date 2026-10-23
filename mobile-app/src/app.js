/* Promemo Android — interfaccia */
'use strict';
const S = PM.S;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => s ? new Date(s.length === 10 ? s + 'T00:00' : s) : null;
const day0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hm = (s) => s ? s.slice(11, 16) : '';
const rel = (d) => { const n = Math.round((day0(d) - day0(new Date())) / 864e5); return n === 0 ? 'Oggi' : n === 1 ? 'Domani' : n === -1 ? 'Ieri' : d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const REM = [[null, 'Nessuno'], [0, "All'orario"], [5, '5 minuti prima'], [15, '15 minuti prima'], [30, '30 minuti prima'], [60, '1 ora prima'], [120, '2 ore prima'], [1440, '1 giorno prima']];
const REP = [['', 'Mai'], ['daily', 'Ogni giorno'], ['weekdays', 'Nei giorni feriali'], ['weekly', 'Ogni settimana'], ['biweekly', 'Ogni 2 settimane'], ['monthly', 'Ogni mese'], ['yearly', 'Ogni anno']];
const repKey = (r) => !r ? '' : r.freq === 'weekly' && r.byday && r.byday.length === 5 && !r.byday.includes(0) && !r.byday.includes(6) ? 'weekdays' : r.freq === 'weekly' && +r.interval === 2 ? 'biweekly' : r.freq;
const repRule = (k, d) => !k ? null : k === 'weekdays' ? { freq: 'weekly', interval: 1, byday: [1, 2, 3, 4, 5] } : k === 'biweekly' ? { freq: 'weekly', interval: 2, byday: [d.getDay()] } : k === 'weekly' ? { freq: 'weekly', interval: 1, byday: [d.getDay()] } : { freq: k, interval: 1 };
let tab = 'assistente', selDay = dk(new Date()), openProject = null;

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2400); }
function steps() { return S.data.projects.filter(p => p.status !== 'archiviato').flatMap(p => p.steps.map(st => ({ p, st }))); }
function itemsOn(d) {
  const k = dk(d), out = [];
  for (const e of PromemoRecur.expand(PM.allEvents(), addD(d, -1), addD(d, 1))) {
    if (!e.start) continue; const s = e.start.slice(0, 10), en = (e.end || e.start).slice(0, 10);
    if (s <= k && en >= k) out.push({ ev: e, sort: e.allDay || s !== en ? '0' : e.start });
  }
  for (const { p, st } of steps()) if (st.due && st.due.slice(0, 10) === k) out.push({ st, p, sort: st.due });
  return out.sort((a, b) => a.sort.localeCompare(b.sort));
}
function leaveOf(e) { const x = S.data.ext; if (!x || !x.settings || !x.settings.travel || !x.travel) return null; const t = x.travel[e._occ ? `${e.id}@${e._occ}` : e.id]; return t && t.leaveAt && !t.same ? t : null; }
const row = (it) => {
  if (it.st) { const { st, p } = it; return `<div class="it ${st.done ? 'done' : ''}" style="--c:#8e8e93" data-open="st" data-id="${st.id}"><button class="ck ${st.done ? 'on' : ''}" data-ck="${st.id}" aria-label="Fatto">✓</button><div class="grow"><b>${st.auto ? '✦ ' : ''}${esc(st.text)}</b><small>${st.due ? hm(st.due) + ' · ' : ''}${esc(p.title)}${st.repeat ? ' · ↻' : ''}</small></div></div>`; }
  const e = it.ev, lv = leaveOf(e);
  return `<div class="it" style="--c:${esc(PM.colorOf(e))}" data-open="ev" data-id="${e.id}" data-occ="${e._occ || ''}"><span class="tm">${e.allDay || e.start.slice(0, 10) !== (e.end || e.start).slice(0, 10) ? 'Giorno' : hm(e.start)}</span><div class="grow"><b>${esc(e.title)}</b><small>${[e.allDay ? '' : `${hm(e.start)}–${hm(e.end)}`, e.location, PM.groupName(e), e.rrule ? '↻' : ''].filter(Boolean).map(esc).join(' · ')}</small>${lv ? `<em>esci alle ${lv.leaveAt.slice(11, 16)} · ${lv.min} min</em>` : ''}</div></div>`;
};

function viewToday() {
  const now = new Date(), its = itemsOn(now), nowS = PM.isoL(now);
  const next = its.find(x => x.ev && !x.ev.allDay && (x.ev.end || x.ev.start) > nowS);
  const late = steps().filter(x => !x.st.done && x.st.due && x.st.due.slice(0, 10) < dk(now));
  let h = '';
  if (next) { const lv = leaveOf(next.ev); h += `<div class="next" style="--c:${esc(PM.colorOf(next.ev))}" data-open="ev" data-id="${next.ev.id}" data-occ="${next.ev._occ || ''}"><small>${next.ev.start <= nowS ? 'In corso' : 'Prossimo'}</small><b>${esc(next.ev.title)}</b><span>${hm(next.ev.start)}–${hm(next.ev.end)}${next.ev.location ? ' · ' + esc(next.ev.location) : ''}</span>${lv ? `<em>esci alle ${lv.leaveAt.slice(11, 16)}</em>` : ''}</div>`; }
  h += `<h3>Oggi · ${cap(now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>${its.map(row).join('') || '<div class="empty">Giornata libera</div>'}`;
  if (late.length) h += `<h3 class="warn">In ritardo</h3>${late.map(x => row(x)).join('')}`;
  const tm = itemsOn(addD(now, 1));
  h += `<h3>Domani</h3>${tm.map(row).join('') || '<div class="empty">Niente in agenda</div>'}`;
  return h;
}
function viewAgenda() {
  const sel = parse(selDay), start = addD(day0(new Date()), -1);
  const strip = [...Array(21)].map((_, i) => { const d = addD(start, i), k = dk(d), n = itemsOn(d).length; return `<button class="dd ${k === selDay ? 'on' : ''} ${k === dk(new Date()) ? 'today' : ''}" data-day="${k}"><small>${d.toLocaleDateString('it-IT', { weekday: 'short' }).slice(0, 3)}</small><b>${d.getDate()}</b><i>${n ? '•'.repeat(Math.min(3, n)) : ''}</i></button>`; }).join('');
  return `<div class="strip" id="strip">${strip}</div><div class="day-head"><h3>${cap(rel(sel))}</h3><button class="link" data-newev>+ Nuovo evento</button></div>${itemsOn(sel).map(row).join('') || '<div class="empty">Niente in questo giorno</div>'}`;
}
function viewTasks() {
  const all = steps().filter(x => !x.st.done), k = dk(new Date());
  const groups = [['In ritardo', all.filter(x => x.st.due && x.st.due.slice(0, 10) < k), 'warn'], ['Oggi', all.filter(x => x.st.due && x.st.due.slice(0, 10) === k)], ['Prossimi', all.filter(x => x.st.due && x.st.due.slice(0, 10) > k).sort((a, b) => a.st.due.localeCompare(b.st.due))], ['Senza data', all.filter(x => !x.st.due)]];
  const done = steps().filter(x => x.st.done && x.st.doneAt && x.st.doneAt.slice(0, 10) === k);
  return groups.filter(g => g[1].length).map(([t, l, c]) => `<h3 class="${c || ''}">${t} · ${l.length}</h3>${l.map(row).join('')}`).join('') + (done.length ? `<h3 class="ok">Fatti oggi</h3>${done.map(row).join('')}` : '') || '<div class="empty"><b>Nessun compito</b>Aggiungine uno scrivendo qui sotto, es. “studiare cap. 4 entro venerdì”.</div>';
}
function viewProjects() {
  if (openProject) {
    const p = S.data.projects.find(x => x.id === openProject); if (!p) { openProject = null; return viewProjects(); }
    const open = p.steps.filter(s => !s.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')), done = p.steps.filter(s => s.done);
    return `<button class="back" data-back>‹ Progetti</button><h2>${esc(p.title)}</h2>${p.description ? `<p class="muted">${esc(p.description)}</p>` : ''}
      <form class="inline-add" data-add-step="${p.id}"><input placeholder="Nuovo passo… (es. chiamare il tecnico domani alle 10)" enterkeyhint="done"><button>+</button></form>
      ${open.map(st => row({ st, p })).join('') || '<div class="empty">Nessun passo aperto</div>'}${done.length ? `<h3 class="ok">Fatti · ${done.length}</h3>${done.slice(-10).reverse().map(st => row({ st, p })).join('')}` : ''}`;
  }
  const trips = ((S.data.ext && S.data.ext.trips) || []).filter(t => t.start && (t.end || t.start) >= dk(new Date())).slice(0, 4);
  return (trips.length ? `<h3>Viaggi</h3>${trips.map(t => `<div class="it" style="--c:#0a84ff"><span class="tm big">${esc(t.icon || '✈️')}</span><div class="grow"><b>${esc(t.name)}</b><small>${parse(t.start).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}${t.end ? ' – ' + parse(t.end.slice(0, 10)).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : ''} · ${t.items.length} tappe</small></div></div>`).join('')}` : '')
    + `<h3>Progetti</h3>${S.data.projects.filter(p => p.status === 'attivo').map(p => { const o = p.steps.filter(s => !s.done); const nx = o.sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))[0]; return `<div class="it" style="--c:var(--accent)" data-proj="${p.id}"><span class="tm">${o.length}</span><div class="grow"><b>${esc(p.title)}</b><small>${esc(nx ? nx.text : 'Nessun passo aperto')}</small></div><span class="chev">›</span></div>`; }).join('') || '<div class="empty">Nessun progetto: si creano sul computer.</div>'}`;
}
function viewMore() {
  const c = S.cfg;
  return `<h2>Altro</h2>
    <div class="card"><b>Sincronizzazione</b>
      <p class="muted">${c.host ? `Computer: <code>${esc(c.host)}</code>` : 'Telefono non abbinato.'}${c.cloud ? `<br>Fuori casa: ${c.cloud.type === 'dropbox' ? 'Dropbox' : 'WebDAV'} (cifrato)` : ''}<br>${S.lastSync ? `Ultima: ${new Date(S.lastSync).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (${S.lastVia})` : 'Mai sincronizzato'}${S.lastError ? `<br><span class="err">${esc(S.lastError)}</span>` : ''}</p>
      <div class="btns"><button class="btn" data-sync>Sincronizza ora</button></div>
      <p class="muted small">Per abbinare: sul computer apri Impostazioni → Telefono, scheda “App Android”, e inquadra il codice con la fotocamera. In alternativa incolla qui il link di abbinamento.</p>
      <form class="inline-add" data-pair><input placeholder="promemo://abbina?h=…" autocapitalize="off" autocomplete="off"><button>→</button></form>
    </div>
    <div class="card"><b>Notifiche</b><p class="muted">Promemoria e “esci alle” dei prossimi 14 giorni, anche ad app chiusa.</p><div class="btns"><button class="btn" data-perm>Consenti le notifiche</button></div></div>
    <div class="card"><b>Registro</b><p class="muted">Errori e malfunzionamenti dell'app (ultime righe).</p><div class="btns"><button class="btn" data-showlog>Mostra</button><button class="btn" data-copylog>Copia</button></div><pre class="log" id="log" hidden></pre></div>
    <p class="muted small center">Promemo per Android · ${esc(window.PM_VERSION || '')}</p>`;
}

function render() {
  const main = $('#main');
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const name = (S.data.ext && S.data.ext.settings && S.data.ext.settings.userName) || '';
  $('#hello').textContent = name ? `Ciao, ${name}` : 'Promemo';
  const acc = S.data.ext && S.data.ext.settings && S.data.ext.settings.accent; if (acc) document.documentElement.style.setProperty('--accent', acc);
  main.innerHTML = tab === 'assistente' ? viewAssistant() : tab === 'oggi' ? viewToday() : tab === 'agenda' ? viewAgenda() : tab === 'compiti' ? viewTasks() : tab === 'progetti' ? viewProjects() : viewMore();
  $('#add').hidden = tab === 'altro' || tab === 'assistente';
  document.body.classList.toggle('ag-mode', tab === 'assistente');
  if (tab === 'agenda') { const on = $('#strip .on'); on && on.scrollIntoView({ inline: 'center', block: 'nearest' }); }
  syncPill();
}
function syncPill() {
  const el = $('#sub');
  if (S.syncing) { el.textContent = 'Sincronizzo…'; $('#refresh').classList.add('spin'); return; }
  $('#refresh').classList.remove('spin');
  el.textContent = S.lastError && !S.lastSync ? 'Non sincronizzato' : S.lastSync ? `Sincronizzato ${agoText(S.lastSync)}` : S.cfg.host || S.cfg.cloud ? 'In attesa' : 'Non abbinato';
  el.classList.toggle('err', !!S.lastError);
}
const agoText = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'ora' : m < 60 ? `${m} min fa` : `alle ${new Date(t).toTimeString().slice(0, 5)}`; };
window.onSyncState = (n) => { if (n) render(); else syncPill(); };

// ---------- scheda di modifica ----------
function findStep(id) { for (const p of S.data.projects) { const st = p.steps.find(x => x.id === id); if (st) return { p, st }; } return {}; }
function openSheet(kind, id, occ) {
  let html = '';
  if (kind === 'st') {
    const { p, st } = findStep(id); if (!st) return;
    html = `<form data-save="st" data-id="${id}"><h2 contenteditable="plaintext-only" data-f="text">${esc(st.text)}</h2>
      <label class="row"><span>Fatto</span><input type="checkbox" class="sw" name="done" ${st.done ? 'checked' : ''}></label>
      <label class="row"><span>${st.auto ? 'Entro' : 'Quando'}</span><input type="datetime-local" name="${st.auto ? 'deadline' : 'due'}" value="${esc((st.auto ? st.deadline : st.due) || '')}"></label>
      ${st.auto ? `<div class="row"><span>Pianificato</span><b>${st.due ? cap(rel(parse(st.due))) + ' ' + hm(st.due) : '—'}</b></div>` : ''}
      <label class="row"><span>Promemoria</span><select name="reminder">${REM.map(([v, l]) => `<option value="${v ?? ''}" ${st.reminder === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="row"><span>Ripeti</span><select name="repeat">${REP.map(([v, l]) => `<option value="${v}" ${repKey(st.repeat) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="row"><span>Progetto</span><select name="pid">${S.data.projects.filter(x => x.status !== 'archiviato').map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
      <label class="col"><span>Note</span><textarea name="notes" rows="4">${esc(st.notes || '')}</textarea></label>
      <div class="btns"><button type="button" class="btn danger" data-del="st" data-id="${id}">Elimina</button><span class="grow"></span><button class="btn primary">Salva</button></div></form>`;
  } else {
    const e0 = S.data.events.find(x => x.id === id) || ((S.data.ext && S.data.ext.events) || []).find(x => x.id === id);
    if (!e0) return;
    const ro = !S.data.events.includes(e0);
    const e = occ && e0.rrule ? PromemoRecur.instance(e0, parse(occ)) : e0;
    if (ro) {
      const lv = leaveOf(e);
      html = `<h2>${esc(e.title)}</h2><p class="muted">${cap(rel(parse(e.start)))}${e.allDay ? '' : ` · ${hm(e.start)}–${hm(e.end)}`}</p>
        ${e.location ? `<div class="row"><span>Luogo</span><b>${esc(e.location)}</b></div>` : ''}${lv ? `<div class="row"><span>Esci alle</span><b>${lv.leaveAt.slice(11, 16)} · ${lv.min} min da ${esc(lv.from)}</b></div>` : ''}
        <div class="row"><span>Calendario</span><b>${esc(PM.groupName(e))}</b></div>${e.notes ? `<p class="notes">${esc(e.notes)}</p>` : ''}
        <p class="muted small">Arriva dai calendari collegati al computer: si modifica lì o nel servizio originale.</p><div class="btns"><span class="grow"></span><button type="button" class="btn" data-close>Chiudi</button></div>`;
    } else {
      const v = (s) => (s || '').slice(0, e.allDay ? 10 : 16);
      html = `<form data-save="ev" data-id="${id}"><h2 contenteditable="plaintext-only" data-f="title">${esc(e0.title)}</h2>
        ${e0.rrule ? `<p class="muted">↻ ${esc(PromemoRecur.describe(e0.rrule))}${occ ? ` · <button type="button" class="link" data-skip="${id}" data-occ="${occ}">Salta questa volta</button>` : ''}</p>` : ''}
        <label class="row"><span>Tutto il giorno</span><input type="checkbox" class="sw" name="allDay" ${e0.allDay ? 'checked' : ''}></label>
        <label class="row"><span>Inizio</span><input type="${e0.allDay ? 'date' : 'datetime-local'}" name="start" value="${esc(v(e0.start))}"></label>
        <label class="row"><span>Fine</span><input type="${e0.allDay ? 'date' : 'datetime-local'}" name="end" value="${esc(v(e0.end))}"></label>
        <label class="row"><span>Luogo</span><input name="location" value="${esc(e0.location || '')}" placeholder="Facoltativo"></label>
        <label class="row"><span>Promemoria</span><select name="reminder">${REM.map(([x, l]) => `<option value="${x ?? ''}" ${e0.reminder === x ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="row"><span>Ripeti</span><select name="repeat">${REP.map(([x, l]) => `<option value="${x}" ${repKey(e0.rrule) === x ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="col"><span>Note</span><textarea name="notes" rows="3">${esc(e0.notes || '')}</textarea></label>
        <div class="btns"><button type="button" class="btn danger" data-del="ev" data-id="${id}">Elimina</button><span class="grow"></span><button class="btn primary">Salva</button></div></form>`;
    }
  }
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false; requestAnimationFrame(() => $('#sheet').classList.add('open'));
}
function closeSheet() { $('#sheet').classList.remove('open'); setTimeout(() => { $('#sheet').hidden = true; }, 220); }
function saveSheet(f) {
  const fd = new FormData(f), id = f.dataset.id;
  if (f.dataset.save === 'st') {
    const { p, st } = findStep(id); if (!st) return;
    st.text = $('[data-f=text]', f).innerText.trim() || st.text;
    const wasDone = st.done; st.done = !!fd.get('done'); if (st.done && !wasDone) st.doneAt = PM.isoL(new Date()); if (!st.done) st.doneAt = null;
    if (st.auto) { st.deadline = fd.get('deadline') || null; delete st.autoDue; } else { if (fd.get('due') !== st.due) delete st.notifiedAt; st.due = fd.get('due') || null; }
    st.reminder = fd.get('reminder') === '' ? null : +fd.get('reminder');
    const rp = repRule(fd.get('repeat'), st.due ? parse(st.due) : new Date()); if (rp) st.repeat = rp; else delete st.repeat;
    st.notes = fd.get('notes');
    const np = S.data.projects.find(x => x.id === fd.get('pid'));
    if (np && np !== p) { p.steps = p.steps.filter(x => x !== st); np.steps.push(st); }
    PM.spawnRepeats();
  } else {
    const e = S.data.events.find(x => x.id === id); if (!e) return;
    const allDay = !!fd.get('allDay'); let s = fd.get('start'), en = fd.get('end') || s; if (en < s) en = s;
    Object.assign(e, { title: $('[data-f=title]', f).innerText.trim() || e.title, allDay, start: allDay ? s.slice(0, 10) + 'T00:00' : s, end: allDay ? en.slice(0, 10) + 'T23:59' : en, location: fd.get('location').trim(), reminder: fd.get('reminder') === '' ? null : +fd.get('reminder'), notes: fd.get('notes') });
    const rp = repRule(fd.get('repeat'), parse(e.start)); if (rp) e.rrule = { ...rp, ...(e.rrule && e.rrule.exdates ? { exdates: e.rrule.exdates } : {}) }; else delete e.rrule;
    delete e.notifiedAt;
  }
  PM.persist(); closeSheet(); render(); toast('Salvato');
}

// ---------- aggiunta con una frase ----------
function addFromText(text, pid) {
  const r = PromemoNLP.parse(text, { projects: S.data.projects.filter(p => p.status !== 'archiviato') });
  if (!r.title) return toast('Scrivi cosa vuoi aggiungere');
  if (r.kind === 'passo' || pid) {
    let p = S.data.projects.find(x => x.id === (pid || r.projectId)) || S.data.projects.find(x => x.inbox && x.status !== 'archiviato');
    if (!p) { p = { id: 'p-' + PM.uid(), title: 'Da fare', category: '', description: 'Compiti aggiunti al volo', starred: false, status: 'attivo', createdAt: PM.isoL(new Date()), updatedAt: PM.isoL(new Date()), steps: [], traces: [], inbox: true }; S.data.projects.push(p); }
    const due = r.due || (r.start && pid ? r.start : null);
    const st = { id: 's-' + PM.uid(), text: r.title, due, reminder: r.reminder ?? (due && !r.auto ? 0 : null), done: false, duration: r.duration || (r.auto ? 60 : 30) };
    if (r.priority) st.priority = r.priority; if (r.auto) { st.auto = true; st.deadline = r.deadline; } if (r.repeat || r.rrule) st.repeat = r.repeat || r.rrule;
    p.steps.push(st);
  } else {
    const e = { id: 'e-' + PM.uid(), title: r.title, kind: r.kind, projectId: r.projectId || '', allDay: !!r.allDay, start: r.start, end: r.end, location: r.location || '', reminder: r.reminder ?? (r.allDay ? null : 15), notes: '' };
    if (r.rrule) e.rrule = r.rrule;
    S.data.events.push(e);
  }
  PM.persist(); render();
  toast(`Aggiunto: ${r.title}${PromemoNLP.describe(r)[1] ? ' · ' + PromemoNLP.describe(r)[1][1] : ''}`);
}

// ---------- eventi ----------
document.addEventListener('click', async (e) => {
  const t = e.target;
  const tb = t.closest('.tabs [data-tab]'); if (tb) { tab = tb.dataset.tab; openProject = null; render(); window.scrollTo(0, 0); return; }
  const ck = t.closest('[data-ck]'); if (ck) { e.stopPropagation(); const { st } = findStep(ck.dataset.ck); if (st) { st.done = !st.done; st.doneAt = st.done ? PM.isoL(new Date()) : null; PM.spawnRepeats(); PM.persist(); render(); toast(st.done ? 'Fatto ✓' : 'Riaperto'); } return; }
  const dd = t.closest('[data-day]'); if (dd) { selDay = dd.dataset.day; render(); return; }
  const pj = t.closest('[data-proj]'); if (pj) { openProject = pj.dataset.proj; render(); window.scrollTo(0, 0); return; }
  if (t.closest('[data-back]')) { openProject = null; render(); return; }
  const op = t.closest('[data-open]'); if (op && !t.closest('#sheet')) { openSheet(op.dataset.open, op.dataset.id, op.dataset.occ); return; }
  if (t.closest('[data-close]') || t.id === 'sheet') { closeSheet(); return; }
  const del = t.closest('[data-del]');
  if (del) {
    if (!del.classList.contains('confirm')) { del.classList.add('confirm'); del.textContent = 'Conferma'; return; }
    if (del.dataset.del === 'st') { for (const p of S.data.projects) p.steps = p.steps.filter(x => x.id !== del.dataset.id); }
    else S.data.events = S.data.events.filter(x => x.id !== del.dataset.id);
    PM.persist(); closeSheet(); render(); toast('Eliminato'); return;
  }
  const sk = t.closest('[data-skip]'); if (sk) { const ev = S.data.events.find(x => x.id === sk.dataset.skip); ev.rrule = { ...ev.rrule, exdates: [...new Set([...(ev.rrule.exdates || []), sk.dataset.occ])] }; PM.persist(); closeSheet(); render(); toast('Saltato'); return; }
  if (t.closest('#refresh') || t.closest('[data-sync]')) { await PM.syncNow('manuale'); render(); toast(S.lastError && !S.lastSync ? S.lastError : 'Sincronizzato'); return; }
  if (t.closest('[data-perm]')) { if (PM.LN) { const r = await PM.LN.requestPermissions(); toast(r.display === 'granted' ? 'Notifiche attive' : 'Notifiche non consentite'); PM.persist(); } else toast('Disponibile nell’app installata'); return; }
  if (t.closest('[data-showlog]')) { const l = $('#log'); l.hidden = !l.hidden; l.textContent = PM.LOG.slice(-120).join('\n') || '(vuoto)'; return; }
  if (t.closest('[data-copylog]')) { try { await navigator.clipboard.writeText(PM.LOG.join('\n')); toast('Registro copiato'); } catch { toast('Copia non riuscita'); } return; }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target;
  if (f.dataset.save) return saveSheet(f);
  if (f.id === 'add') { const i = $('#add-in'); if (i.value.trim()) { addFromText(i.value.trim(), tab === 'progetti' ? openProject : null); i.value = ''; $('#add').removeAttribute('data-hint'); } return; }
  if (f.dataset.addStep) { const i = f.querySelector('input'); if (i.value.trim()) { addFromText(i.value.trim(), f.dataset.addStep); i.value = ''; } return; }
  if ('pair' in f.dataset) { const v = f.querySelector('input').value.trim(); try { await PM.pairFromUrl(v); render(); toast('Telefono abbinato'); } catch (err) { toast(err.message); } }
});
document.addEventListener('change', (e) => { const f = e.target.closest('form[data-save="ev"]'); if (f && e.target.name === 'allDay') { for (const n of ['start', 'end']) { const i = f.querySelector(`[name=${n}]`); const v = i.value; i.type = e.target.checked ? 'date' : 'datetime-local'; i.value = e.target.checked ? v.slice(0, 10) : v.length === 10 ? v + (n === 'start' ? 'T09:00' : 'T10:00') : v; } } });
$('#add-in').addEventListener('input', (e) => { const t = e.target.value.trim(); if (!t) { $('#add').removeAttribute('data-hint'); return; } const r = PromemoNLP.parse(t, { projects: S.data.projects }); $('#add').dataset.hint = [r.title, ...PromemoNLP.describe(r).map(x => x[1])].join(' · '); });

// ---------- avvio ----------
(async () => {
  await PM.loadAll();
  S.lastSync = S.cfg.lastSync || null; S.lastVia = S.cfg.lastVia || '';
  render();
  if (PM.APP) {
    PM.APP.addListener('appUrlOpen', async (ev) => { if (/^promemo:/.test(ev.url)) { try { await PM.pairFromUrl(ev.url); render(); toast('Telefono abbinato'); } catch (err) { toast(err.message); } } });
    PM.APP.addListener('appStateChange', (st) => { if (st.isActive) PM.syncNow('ripresa').then(render); });
    PM.APP.addListener('backButton', () => { if (!$('#sheet').hidden) closeSheet(); else if (openProject) { openProject = null; render(); } else if (tab !== 'assistente') { tab = 'assistente'; render(); } else PM.APP.exitApp(); });
    try { const l = await PM.APP.getLaunchUrl(); if (l && l.url && /^promemo:/.test(l.url)) { await PM.pairFromUrl(l.url); toast('Telefono abbinato'); } } catch { /* */ }
    try { const info = await PM.APP.getInfo(); window.PM_VERSION = info.version; } catch { /* */ }
  }
  if (PM.LN) { try { const p = await PM.LN.checkPermissions(); if (p.display === 'prompt') await PM.LN.requestPermissions(); } catch { /* */ } }
  const h = new URLSearchParams(location.hash.slice(1)).get('pair'); if (h) { history.replaceState(null, '', location.pathname); try { await PM.pairFromUrl(decodeURIComponent(h)); } catch (err) { toast(err.message); } }
  await PM.syncNow('avvio'); render();
  setInterval(() => { if (!document.hidden) PM.syncNow('periodica').then(n => { if (n) render(); }); }, 120000);
  setInterval(() => { if (!document.hidden) syncPill(); }, 30000);
})();
