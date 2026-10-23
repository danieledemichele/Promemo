/* Promemo — schede degli studenti dalle prenotazioni di Calendly: storico delle lezioni e appunti */
'use strict';
const lessonWho = (e) => (e && e.source && e.source.extra && e.source.extra.list && e.source.extra.list[0]) || null;
const studentKey = (w) => w ? String(w.email || w.name || '').toLowerCase() : '';
const isLesson = (e) => { const a = e && e.source && data.accounts.find(x => x.id === e.source.acc); return !!(a && (a.provider === 'calendly' || a.provider === 'calcom')); };
function studentLessons(key) {
  return PromemoRecur.expand(data.events.filter(e => isLesson(e) && studentKey(lessonWho(e)) === key), addDays(new Date(), -400), addDays(new Date(), 120)).sort((a, b) => a.start.localeCompare(b.start));
}

function studentBlockHTML(ev) {
  const w = lessonWho(ev); if (!w) return '';
  const key = studentKey(w), st = (data.students || {})[key] || { notes: {} };
  const all = studentLessons(key), now = iso(new Date());
  const past = all.filter(e => e.start < now), next = all.find(e => e.start > now && e.id !== ev.id);
  const prev = Object.entries(st.notes || {}).filter(([id]) => id !== ev.id).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 4);
  const mine = (st.notes || {})[ev.id];
  return `<div class="student">
    <div class="row"><div class="st-av">${esc((w.name || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="grow"><b>${esc(w.name || w.email)}</b><div class="tiny">${past.length} ${past.length === 1 ? 'lezione fatta' : 'lezioni fatte'}${next ? ` · prossima ${stamp(next.start).toLowerCase()}` : ''}${w.email ? ' · ' + esc(w.email) : ''}</div></div></div>
    ${(w.qa || []).length ? `<div class="st-qa">${w.qa.map(q => `<div>${esc(q)}</div>`).join('')}</div>` : ''}
    ${prev.length ? `<div class="st-prev">${prev.map(([, n]) => `<div><span>${new Date(n.at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}</span>${esc(n.text)}</div>`).join('')}</div>` : ''}
    <label class="field" style="margin-top:8px"><span>Appunti di questa lezione</span><textarea rows="2" data-lesson-note="${esc(ev.id)}" data-key="${esc(key)}" data-name="${esc(w.name || '')}" data-at="${esc(ev.start)}" placeholder="Cosa avete fatto, cosa resta da fare, compiti assegnati">${esc(mine ? mine.text : '')}</textarea></label>
  </div>`;
}
const _eventFormHTML_st = eventFormHTML;
eventFormHTML = function (ev, preset, compact) {
  const h = _eventFormHTML_st(ev, preset, compact);
  return ev && isLesson(ev) ? h.replace('<div class="modal-actions">', studentBlockHTML(ev) + '<div class="modal-actions">') : h;
};
// gli appunti si salvano mentre scrivi (non serve premere Salva)
let lessonT = null;
document.addEventListener('input', (e) => {
  const t = e.target; if (!t.dataset || !t.dataset.lessonNote) return;
  clearTimeout(lessonT);
  lessonT = setTimeout(() => {
    data.students = data.students || {};
    const s = data.students[t.dataset.key] = data.students[t.dataset.key] || { name: t.dataset.name, notes: {} };
    s.name = t.dataset.name || s.name;
    const v = t.value.trim();
    if (v) s.notes[t.dataset.lessonNote] = { at: t.dataset.at, text: v.slice(0, 2000) }; else delete s.notes[t.dataset.lessonNote];
    save();
  }, 500);
});

// stato degli slot nella scheda dell'account Calendly
const _viewAccounts_st = viewAccounts;
viewAccounts = function () {
  let h = _viewAccounts_st();
  for (const a of data.accounts.filter(x => x.provider === 'calendly')) {
    const sc = (a.slots && a.slots.schedules) || [];
    const n = sc.reduce((t, s) => t + s.rules.filter(r => r.type === 'wday').reduce((x, r) => x + r.intervals.length, 0), 0);
    const line = `<label class="row acc-foot"><span class="muted grow">${a.slots && a.slots.error && !sc.length ? `Slot fissi non leggibili (${esc(a.slots.error)}): rigenera il token con il permesso “availability”` : n ? `Slot fissi letti da Calendly: ${n} ${n === 1 ? 'fascia' : 'fasce'} a settimana. L'assistente ti avvisa se un impegno che Calendly non vede cade in uno slot.` : 'Gli slot fissi arrivano alla prossima sincronizzazione'}</span></label>`;
    h = h.replace(`data-acc-dedupe="${a.id}"`, `data-acc-dedupe="${a.id}"`).replace(new RegExp(`(<input type="checkbox" class="switch" data-acc-dedupe="${a.id}"[^>]*></label>)`), `$1${line}`);
  }
  return h;
};
