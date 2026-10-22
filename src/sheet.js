/* Promemo — scheda laterale con dettagli e note di un compito o di un evento (Agenda) */
'use strict';

const PRIO = [['', 'Nessuna'], ['bassa', 'Bassa'], ['media', 'Media'], ['alta', 'Alta']];

function sheetTarget() {
  const s = ui.sheet; if (!s) return null;
  if (s.kind === 'st') {
    const p = proj(s.pid); const st = p && p.steps.find(x => x.id === s.id);
    return st ? { p, st } : null;
  }
  const ev = data.events.find(x => x.id === s.id);
  return ev ? { ev } : null;
}

const stRepKey = (st) => { const r = st.repeat; if (!r) return ''; if (r.freq === 'weekly' && r.byday && r.byday.length === 5 && !r.byday.includes(0) && !r.byday.includes(6)) return 'weekdays'; if (r.freq === 'weekly' && +r.interval === 2) return 'biweekly'; return r.freq; };
function openSheet(s) {
  closePopover(true);
  if (ui.view !== 'agenda') go('agenda');
  ui.sheet = s; ui.sheetNew = true;
  render();
  setTimeout(() => { ui.sheetNew = false; }, 400);
}
function closeSheet() { if (!ui.sheet) return; ui.sheet = null; render(); }

const savedAt = () => `Salvato alle ${fmtHM(new Date())}`;

function sheetHTML() {
  const t = sheetTarget();
  if (!t) { ui.sheet = null; return ''; }
  const anim = ui.sheetNew ? 'enter' : '';
  if (t.st) {
    const { p, st } = t;
    const c = cat(p.category), g = localGroup(p);
    const late = !st.done && st.due && parse(st.due) < new Date();
    const subs = st.checklist || [];
    const doneN = subs.filter(x => x.done).length;
    const others = p.steps.filter(x => x.id !== st.id && !x.done).slice(0, 5);
    return `<aside class="sheet ${anim}" id="sheet" style="--gc:${esc(g.color)}">
      <div class="sh-top">
        <span class="sh-kind">${icon('i-step')} Compito</span>
        <button class="icon-btn" data-sh="close" title="Chiudi (Esc)">${icon('i-close')}</button>
      </div>
      <div class="sh-scroll">
        <div class="sh-title-row">
          <button class="check ${st.done ? 'on' : ''}" data-sh="toggle" title="${st.done ? 'Segna da fare' : 'Segna come fatto'}">${icon('i-check')}</button>
          <div class="sh-title ${st.done ? 'done' : ''}" contenteditable="plaintext-only" spellcheck="false" data-shf="text">${esc(st.text)}</div>
        </div>
        <div class="sh-chips">
          <button class="pill sh-proj" data-sh="project">${icon('i-folder')} ${esc(p.title)}</button>
          ${c ? `<span class="pill" style="color:${hex(c.color)}"><i class="dot" style="background:${hex(c.color)}"></i>${esc(c.name)}</span>` : ''}
          ${st.done ? '<span class="pill ok">Fatto</span>' : late ? '<span class="pill live">In ritardo</span>' : ''}
          ${st.priority ? `<span class="pill prio-${st.priority}">Priorità ${st.priority}</span>` : ''}
        </div>

        <div class="sh-props">
          <label class="sh-prop"><span>${icon('i-spark')} Pianifica Promemo</span><input type="checkbox" class="switch" data-shf="auto" ${st.auto ? 'checked' : ''} title="Promemo trova il tempo libero prima della scadenza e lo sposta se qualcosa cambia"></label>
          ${st.auto ? `<label class="sh-prop"><span>${icon('i-calendar')} Entro</span><input type="datetime-local" data-shf="deadline" value="${esc(st.deadline || '')}"></label>
          <div class="sh-prop sh-auto-info"><span>${icon('i-clock')} Quando</span><span>${st.due ? `${esc(relDay(parse(st.due)))} · ${fmtHM(parse(st.due))}${st.autoLate ? ' <b class="late">oltre la scadenza</b>' : ''}${st.autoDue && st.due !== st.autoDue ? ' · fissato da te' : ''}` : 'Cerco uno spazio libero…'}</span></div>`
          : `<label class="sh-prop"><span>${icon('i-calendar')} Scadenza</span><input type="datetime-local" data-shf="due" value="${esc(st.due || '')}"></label>`}
          <label class="sh-prop"><span>${icon('i-clock')} Durata</span><select data-shf="duration">${[15, 30, 45, 60, 90, 120, 180, 240].map(m => `<option value="${m}" ${(+st.duration || 30) === m ? 'selected' : ''}>${m < 60 ? m + ' min' : (m / 60) + ' h'}</option>`).join('')}</select></label>
          <label class="sh-prop"><span>${icon('i-bell')} Promemoria</span><select data-shf="reminder">${REMINDERS.map(([v, l]) => `<option value="${v === null ? '' : v}" ${st.reminder === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="sh-prop"><span>${icon('i-refresh')} Ripeti</span><select data-shf="repeat">${[['', 'Mai'], ['daily', 'Ogni giorno'], ['weekdays', 'Nei giorni feriali'], ['weekly', 'Ogni settimana'], ['biweekly', 'Ogni 2 settimane'], ['monthly', 'Ogni mese'], ['yearly', 'Ogni anno']].map(([k, l]) => `<option value="${k}" ${stRepKey(st) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="sh-prop"><span>${icon('i-star')} Priorità</span><select data-shf="priority">${PRIO.map(([v, l]) => `<option value="${v}" ${(st.priority || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>

        <div class="sh-sec">
          <div class="sh-sec-h">Sotto-attività ${subs.length ? `<span class="tiny">${doneN}/${subs.length}</span>` : ''}</div>
          ${subs.length ? `<div class="sh-prog"><i style="width:${subs.length ? doneN / subs.length * 100 : 0}%"></i></div>` : ''}
          <div class="sh-subs">${subs.map(x => `<div class="sh-sub ${x.done ? 'done' : ''}">
            <button class="check mini2 ${x.done ? 'on' : ''}" data-sh="sub-toggle" data-sid="${x.id}">${icon('i-check')}</button>
            <span class="grow" contenteditable="plaintext-only" spellcheck="false" data-sub-edit="${x.id}">${esc(x.text)}</span>
            <button class="icon-btn sm" data-sh="sub-del" data-sid="${x.id}" title="Elimina">${icon('i-close')}</button></div>`).join('')}</div>
          <form class="sh-add" data-sh-form="sub"><span>${icon('i-plus')}</span><input placeholder="Aggiungi una sotto-attività" autocomplete="off"></form>
        </div>

        <div class="sh-sec sh-notes-sec">
          <div class="sh-sec-h">Note <span class="tiny" id="sh-saved">${st.notesAt ? 'Modificate ' + esc(stamp(st.notesAt).toLowerCase()) : ''}</span></div>
          <textarea class="sh-notes" data-shf="notes" placeholder="Appunti, link, idee, cosa ricordarti per questo compito…" spellcheck="true">${esc(st.notes || '')}</textarea>
          <div class="sh-note-act"><button class="btn small" data-sh="to-trace" ${st.notes ? '' : 'disabled'}>${icon('i-note')} Salva come traccia nel progetto</button></div>
        </div>

        ${others.length ? `<div class="sh-sec"><div class="sh-sec-h">Altri passi del progetto</div>${others.map(x => `<button class="sh-other" data-sh="other" data-sid="${x.id}"><i class="dot" style="background:${esc(g.color)}"></i><span class="grow">${esc(x.text)}</span><span class="tiny">${x.due ? relDay(parse(x.due)) : ''}</span></button>`).join('')}</div>` : ''}
      </div>
      <div class="sh-foot">
        <button class="btn small danger" data-sh="del">${icon('i-trash')} Elimina</button>
        <span class="grow"></span>
        ${!st.done ? `<button class="btn small" data-action="focus-start" data-pid="${p.id}" data-id="${st.id}">${icon('i-target')} Concentrati</button>` : ''}
        <button class="btn small" data-sh="project">Apri progetto</button>
      </div>
    </aside>`;
  }
  const { ev } = t;
  const g = groupInfo(ev), a = accOf(ev), ro = isReadOnly(ev);
  const occ = ev.rrule && ui.sheet && ui.sheet.occ ? PromemoRecur.instance(ev, parse(ui.sheet.occ)) : null;
  const s = parse((occ || ev).start), e = parse((occ || ev).end || (occ || ev).start);
  const p = proj(ev.projectId);
  const inv = ev.source?.extra?.list || [];
  const when = ev.allDay
    ? (spanDays(ev) > 1 ? `${fmtLong(s)} – ${fmtLong(e)}` : `${fmtLong(s)} · tutto il giorno`)
    : `${fmtLong(s)} · ${fmtHM(s)}–${fmtHM(e)}${dayKey(s) !== dayKey(e) ? ' (' + fmtLong(e) + ')' : ''}`;
  return `<aside class="sheet ${anim}" id="sheet" style="--gc:${esc(g.color)}">
    <div class="sh-top">
      <span class="sh-kind">${icon('i-calendar')} ${ev.kind === 'evento' ? 'Evento' : 'Appuntamento'}</span>
      <button class="icon-btn" data-sh="close" title="Chiudi (Esc)">${icon('i-close')}</button>
    </div>
    <div class="sh-scroll">
      <div class="sh-title-row"><span class="sh-color"></span><div class="sh-title">${esc(ev.title)}</div></div>
      <div class="sh-when">${esc(when)}</div>
      <div class="sh-chips">
        <span class="pill"><i class="dot" style="background:${esc(g.color)}"></i>${esc(g.name)}</span>
        ${a ? `<span class="pill">${esc(PROV[a.provider])}${ro ? ' · sola lettura' : ''}</span>` : ''}
        ${ev.reminder !== null && ev.reminder !== undefined ? `<span class="pill">${icon('i-bell')} ${remShort(ev.reminder)}</span>` : ''}
        ${ev.planDay ? '<span class="pill">Dal piano dell\'assistente</span>' : ''}
      </div>
      <div class="sh-props">
        ${ev.location ? `<div class="sh-prop"><span>${icon('i-pin')} Luogo</span><b>${/^online · https?:/i.test(ev.location) ? `<a href="#" data-sh="url" data-url="${esc(ev.location.replace(/^online · /i, ''))}">Collegamento online</a>` : esc(ev.location)}</b></div>` : ''}
        ${typeof travelSheetRow === 'function' ? travelSheetRow(ev) : ''}
        ${ev.rrule ? `<div class="sh-prop"><span>${icon('i-refresh')} Si ripete</span><b>${esc(PromemoRecur.describe(ev.rrule))}${occ ? ` <button class="link" data-sh="ev-skip" data-occ="${occ._occ}">Salta questa volta</button>` : ''}</b></div>` : ''}
        <label class="sh-prop"><span>${icon('i-folder')} Progetto</span><select data-shf="ev-project"><option value="">Nessuno</option>${data.projects.filter(x => x.status !== 'archiviato' || x.id === ev.projectId).map(x => `<option value="${x.id}" ${x.id === ev.projectId ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
        <label class="sh-prop"><span>${icon('i-bell')} Promemoria</span><select data-shf="ev-reminder">${REMINDERS.map(([v, l]) => `<option value="${v === null ? '' : v}" ${ev.reminder === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      ${inv.length ? `<div class="sh-sec"><div class="sh-sec-h">Partecipanti</div>${inv.map(x => `<div class="sh-person"><span class="sh-av">${esc((x.name || '?').slice(0, 1).toUpperCase())}</span><span class="grow"><b>${esc(x.name)}</b><small>${esc(x.email || '')}</small>${x.qa && x.qa.length ? `<small>${x.qa.map(esc).join('<br>')}</small>` : ''}</span></div>`).join('')}</div>` : ''}
      ${ev.notes ? `<div class="sh-sec"><div class="sh-sec-h">Descrizione${a ? ' <span class="tiny">da ' + esc(PROV[a.provider]) + '</span>' : ''}</div><div class="sh-desc">${esc(ev.notes).replace(/(https?:\/\/[^\s<]+)/g, '<a href="#" data-sh="url" data-url="$1">$1</a>')}</div></div>` : ''}
      <div class="sh-sec sh-notes-sec">
        <div class="sh-sec-h">Appunti <span class="tiny" id="sh-saved">${ev.memoAt ? 'Modificati ' + esc(stamp(ev.memoAt).toLowerCase()) : 'solo su questo computer'}</span></div>
        <textarea class="sh-notes" data-shf="memo" placeholder="Cosa preparare, cosa è emerso, cose da ricordare…">${esc(ev.memo || '')}</textarea>
        ${p ? `<div class="sh-note-act"><button class="btn small" data-sh="to-trace" ${ev.memo ? '' : 'disabled'}>${icon('i-note')} Salva come traccia nel progetto</button></div>` : ''}
      </div>
    </div>
    <div class="sh-foot">
      <button class="btn small danger" data-sh="ev-del">${icon('i-trash')} Elimina</button>
      <span class="grow"></span>
      ${ev.source && ev.source.url ? `<button class="btn small" data-sh="url" data-url="${esc(ev.source.url)}">Apri in ${esc(PROV[a.provider].replace(' Calendar', ''))}</button>` : ''}
      <button class="btn small" data-sh="ev-edit">${icon('i-edit')} Modifica</button>
    </div>
  </aside>`;
}

// ---------- interazioni ----------
let shTimer = null;
function shSaveSoon(label) {
  clearTimeout(shTimer);
  shTimer = setTimeout(() => { save(); const el = $('#sh-saved'); if (el) el.textContent = label || savedAt(); }, 500);
}
const refreshKeepFocus = () => { const sc = $('#sheet .sh-scroll')?.scrollTop; render(); const n = $('#sheet .sh-scroll'); if (n && sc) n.scrollTop = sc; };

document.addEventListener('click', (e) => {
  const b = e.target.closest('#sheet [data-sh]'); if (!b) return;
  const t = sheetTarget(); if (!t) return;
  const a = b.dataset.sh;
  if (a === 'close') return closeSheet();
  if (a === 'url') { e.preventDefault(); return api.openUrl(b.dataset.url); }
  if (t.st) {
    const { p, st } = t;
    if (a === 'toggle') { st.done = !st.done; st.doneAt = st.done ? iso(new Date()) : null; if (st.done) p.traces.push({ id: uid(), title: `Fatto: ${st.text}`, body: '', at: iso(new Date()) }); touch(p); save(); refreshKeepFocus(); if (st.done) toast('Compito completato'); }
    if (a === 'project') go('progetti', { projectId: p.id, projFilter: p.status === 'archiviato' ? 'archivio' : 'attivi', catFilter: null });
    if (a === 'sub-toggle') { const x = st.checklist.find(y => y.id === b.dataset.sid); x.done = !x.done; save(); refreshKeepFocus(); }
    if (a === 'sub-del') { st.checklist = st.checklist.filter(y => y.id !== b.dataset.sid); save(); refreshKeepFocus(); }
    if (a === 'other') { ui.sheet = { kind: 'st', pid: p.id, id: b.dataset.sid }; render(); }
    if (a === 'to-trace' && st.notes) { p.traces.push({ id: uid(), title: `Note: ${st.text}`, body: st.notes, at: iso(new Date()) }); touch(p); save(); toast('Aggiunta alla timeline del progetto'); }
    if (a === 'del') { p.steps = p.steps.filter(x => x !== st); touch(p); ui.sheet = null; save(); render(); toast('Compito eliminato'); }
  } else {
    const { ev } = t;
    if (a === 'ev-edit') modalEvent(ev);
    if (a === 'ev-del') actions['del-event']({ dataset: { id: ev.id } });
    if (a === 'ev-skip') { ev.rrule = { ...ev.rrule, exdates: [...new Set([...(ev.rrule.exdates || []), b.dataset.occ])] }; ui.sheet = null; save(); render(); toast('Questa volta è saltata · Ctrl+Z per annullare'); }
    if (a === 'to-trace' && ev.memo) { const p = proj(ev.projectId); if (p) { p.traces.push({ id: uid(), title: `Appunti: ${ev.title}`, body: ev.memo, at: iso(new Date()) }); touch(p); save(); toast('Aggiunti alla timeline del progetto'); } }
  }
});

document.addEventListener('input', (e) => {
  const f = e.target.closest('#sheet [data-shf]'); if (!f) return;
  const t = sheetTarget(); if (!t) return;
  const k = f.dataset.shf;
  if (k === 'notes') { t.st.notes = f.value; t.st.notesAt = iso(new Date()); shSaveSoon(); const tb = $('#sheet [data-sh=to-trace]'); if (tb) tb.disabled = !f.value; autoGrow(f); }
  if (k === 'memo') { t.ev.memo = f.value; t.ev.memoAt = iso(new Date()); shSaveSoon(); const tb = $('#sheet [data-sh=to-trace]'); if (tb) tb.disabled = !f.value; autoGrow(f); }
});
document.addEventListener('change', (e) => {
  const f = e.target.closest('#sheet [data-shf]'); if (!f) return;
  const t = sheetTarget(); if (!t) return;
  const k = f.dataset.shf;
  if (t.st) {
    const { p, st } = t;
    if (k === 'due') { st.due = f.value || null; delete st.notifiedAt; if (!st.due) st.reminder = null; }
    if (k === 'duration') st.duration = +f.value;
    if (k === 'auto') { st.auto = f.checked; if (st.auto) { if (!st.deadline) st.deadline = st.due || iso(addDays(new Date(), 7)).slice(0, 10) + 'T23:59'; delete st.autoDue; } else { delete st.autoDue; delete st.autoLate; } }
    if (k === 'deadline') { st.deadline = f.value || null; delete st.autoDue; }
    if (k === 'reminder') { st.reminder = f.value === '' ? null : +f.value; delete st.notifiedAt; }
    if (k === 'priority') st.priority = f.value;
    if (k === 'repeat') { const v = f.value; if (!v) delete st.repeat; else { const wd = st.due ? parse(st.due).getDay() : new Date().getDay(); st.repeat = v === 'weekdays' ? { freq: 'weekly', interval: 1, byday: [1, 2, 3, 4, 5] } : v === 'biweekly' ? { freq: 'weekly', interval: 2, byday: [wd] } : v === 'weekly' ? { freq: 'weekly', interval: 1, byday: [wd] } : { freq: v, interval: 1 }; if (!st.due && !st.auto) { const d = new Date(); d.setHours(9, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); st.due = iso(d); } } }
    touch(p); save(); refreshKeepFocus();
  } else {
    const ev = t.ev;
    if (k === 'ev-project') ev.projectId = f.value;
    if (k === 'ev-reminder') { ev.reminder = f.value === '' ? null : +f.value; delete ev.notifiedAt; }
    save(); refreshKeepFocus();
  }
});
document.addEventListener('focusout', (e) => {
  const t = sheetTarget(); if (!t || !t.st) return;
  const ti = e.target.closest('#sheet [data-shf=text]');
  if (ti) { const v = ti.innerText.trim(); if (v && v !== t.st.text) { t.st.text = v; touch(t.p); save(); render(); } else ti.innerText = t.st.text; }
  const se = e.target.closest('#sheet [data-sub-edit]');
  if (se) { const x = (t.st.checklist || []).find(y => y.id === se.dataset.subEdit); const v = se.innerText.trim(); if (x && v) { x.text = v; save(); } }
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('#sheet [data-shf=text], #sheet [data-sub-edit]') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  if (e.key === 'Escape' && ui.sheet && $('#modal-backdrop').hidden && !$('#popover-layer .day-pop') && !document.activeElement?.closest('#sheet textarea')) { closeSheet(); }
}, true);
document.addEventListener('submit', (e) => {
  const f = e.target.closest('#sheet [data-sh-form=sub]'); if (!f) return;
  e.preventDefault(); e.stopPropagation();
  const t = sheetTarget(); if (!t || !t.st) return;
  const v = f.querySelector('input').value.trim(); if (!v) return;
  (t.st.checklist = t.st.checklist || []).push({ id: uid(), text: v, done: false });
  save(); refreshKeepFocus();
  setTimeout(() => $('#sheet [data-sh-form=sub] input')?.focus(), 0);
}, true);

function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(520, Math.max(140, el.scrollHeight + 2)) + 'px'; }
// dopo ogni disegno adatto l'altezza delle note
new MutationObserver(() => { const ta = document.querySelector('#sheet .sh-notes'); if (ta && !ta._g) { ta._g = true; autoGrow(ta); } }).observe(document.getElementById('view'), { childList: true, subtree: true });

Object.assign(actions, {
  sheet: (el) => openSheet(el.dataset.kind === 'ev' ? { kind: 'ev', id: el.dataset.id, occ: el.dataset.occ || el.dataset.date || null } : { kind: 'st', pid: el.dataset.pid, id: el.dataset.id }),
});
