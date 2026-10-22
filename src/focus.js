/* Promemo — concentrazione: timer a cicli (25 + 5) legato a un compito, con registro del tempo */
'use strict';
const FOCUS_DEF = { work: 25, short: 5, long: 15, every: 4, autoBreak: true };
const focusCfg = () => ({ ...FOCUS_DEF, ...(data.settings.focus || {}) });
const focusRun = () => data && data.focusRun;
const focusLog = () => (data.focus = data.focus || []);
function focusMinutes(day, filter) {
  return Math.round((data.focus || []).filter(s => sameDay(parse(s.start), day) && (!filter || filter(s))).reduce((a, s) => a + s.min, 0));
}
function focusLabel(r) {
  if (!r) return '';
  if (r.sid) { const p = proj(r.pid); const st = p && p.steps.find(x => x.id === r.sid); if (st) return st.text; }
  return r.label || (r.pid && proj(r.pid) ? proj(r.pid).title : 'Concentrazione');
}
function focusStart(opt = {}) {
  const c = focusCfg();
  const min = opt.min || c.work;
  data.focusRun = { phase: 'work', pid: opt.pid || '', sid: opt.sid || '', label: opt.label || '', startedAt: iso(new Date()), endsAt: new Date(Date.now() + min * 60000).toISOString(), min, count: (focusRun() && focusRun().count) || 0, paused: null };
  save(); focusTick(); toast(`Concentrazione: ${min} minuti`);
}
function focusLogWork(r, endMs) {
  const mins = (endMs - parse(r.startedAt).getTime()) / 60000 - (r.pausedMin || 0);
  if (mins >= 1) focusLog().push({ id: uid(), start: r.startedAt, end: iso(new Date(endMs)), min: Math.round(mins), pid: r.pid, sid: r.sid, label: focusLabel(r) });
}
function focusStop(log = true) {
  const r = focusRun(); if (!r) return;
  if (r.phase === 'work' && log) focusLogWork(r, r.paused ? parse(r.paused).getTime() : Date.now());
  data.focusRun = null; save(); focusTick(); $('#popover-layer .focus-pop') && ($('#popover-layer').innerHTML = '');
}
function focusPause() {
  const r = focusRun(); if (!r) return;
  if (r.paused) { const pm = (Date.now() - new Date(r.paused).getTime()) / 60000; r.endsAt = new Date(new Date(r.endsAt).getTime() + pm * 60000).toISOString(); r.pausedMin = (r.pausedMin || 0) + pm; r.paused = null; }
  else r.paused = new Date().toISOString();
  save(); focusTick();
}
function focusNotify(title, body) { try { new Notification(title, { body, silent: false }); } catch { /* */ } }
function focusNext() {
  const r = focusRun(), c = focusCfg(); if (!r) return;
  if (r.phase === 'work') {
    focusLogWork(r, new Date(r.endsAt).getTime());
    const count = r.count + 1, long = count % c.every === 0;
    focusNotify('Pausa ☕', `${r.min} minuti su “${focusLabel(r)}”. ${long ? 'Pausa lunga' : 'Pausa'} di ${long ? c.long : c.short} minuti.`);
    if (!c.autoBreak) { data.focusRun = null; save(); focusTick(); return; }
    data.focusRun = { ...r, phase: 'break', count, min: long ? c.long : c.short, startedAt: iso(new Date()), endsAt: new Date(Date.now() + (long ? c.long : c.short) * 60000).toISOString(), paused: null, pausedMin: 0 };
  } else {
    focusNotify('Si riparte 🎯', `Altri ${c.work} minuti su “${focusLabel(r)}”?`);
    data.focusRun = null;
  }
  save(); focusTick();
}
function focusTick() {
  const b = $('#btn-focus'); if (!b || !data) return;
  const r = focusRun();
  b.hidden = !r;
  if (!r) return;
  const left = Math.max(0, (r.paused ? new Date(r.endsAt) - new Date(r.paused) : new Date(r.endsAt) - Date.now()) / 1000);
  if (!r.paused && left <= 0) return focusNext();
  b.classList.toggle('brk', r.phase === 'break'); b.classList.toggle('paused', !!r.paused);
  b.querySelector('span').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  b.style.setProperty('--p', (1 - left / (r.min * 60)).toFixed(3));
  b.title = `${r.phase === 'break' ? 'Pausa' : 'Concentrazione'} · ${focusLabel(r)}`;
  const pop = $('#popover-layer .focus-pop'); if (pop) pop.querySelector('.fp-time').textContent = b.querySelector('span').textContent;
}
function openFocusPop() {
  const r = focusRun(); const layer = $('#popover-layer');
  if (!r) return modalFocus();
  layer.innerHTML = `<div class="menu focus-pop"><div class="tiny-label">${r.phase === 'break' ? '☕ Pausa' : '🎯 Concentrazione'}${r.paused ? ' · in pausa' : ''}</div>
    <div class="fp-time">${$('#btn-focus span').textContent}</div><div class="fp-what">${esc(focusLabel(r))}</div>
    <div class="fp-acts"><button class="btn small" data-fp="pause">${r.paused ? 'Riprendi' : 'Pausa'}</button>${r.phase === 'break' ? '<button class="btn small" data-fp="skip">Salta la pausa</button>' : '<button class="btn small" data-fp="done">Compito fatto</button>'}<button class="btn small danger" data-fp="stop">Ferma</button></div>
    <div class="fp-today">Oggi: ${focusMinutes(new Date())} minuti di concentrazione</div></div>`;
  const m = layer.firstChild, rc = $('#btn-focus').getBoundingClientRect();
  m.style.top = (rc.bottom + 8) + 'px'; m.style.left = Math.max(12, rc.right - m.offsetWidth) + 'px';
  const out = (e) => { if (!m.isConnected) return document.removeEventListener('mousedown', out, true); if (!m.contains(e.target) && !e.target.closest('#btn-focus')) { layer.innerHTML = ''; document.removeEventListener('mousedown', out, true); } };
  setTimeout(() => document.addEventListener('mousedown', out, true));
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fp]'); if (!b) return;
    const k = b.dataset.fp;
    if (k === 'pause') { focusPause(); openFocusPop(); }
    if (k === 'stop') focusStop();
    if (k === 'skip') { data.focusRun = null; save(); focusTick(); layer.innerHTML = ''; focusStart({ pid: r.pid, sid: r.sid, label: r.label }); }
    if (k === 'done') { const p = proj(r.pid); const st = p && p.steps.find(x => x.id === r.sid); if (st) { st.done = true; st.doneAt = iso(new Date()); touch(p); } focusStop(); render(); toast('Compito completato'); }
  });
}
function modalFocus(pid, sid) {
  const c = focusCfg();
  const open = data.projects.filter(p => p.status !== 'archiviato').flatMap(p => p.steps.filter(s => !s.done).map(s => ({ p, s })))
    .sort((a, b) => (a.s.due || '9999').localeCompare(b.s.due || '9999')).slice(0, 40);
  openModal(`<h2>${icon('i-target')} Concentrazione</h2>
    <p class="muted" style="margin-top:-6px">Un timer a cicli: ${c.work} minuti di lavoro e ${c.short} di pausa, una pausa lunga ogni ${c.every}. Il tempo viene registrato nelle statistiche.</p>
    <form class="form" data-submit="focus-start">
      <label class="field"><span>Su cosa lavori</span><select name="what"><option value="">Senza un compito preciso</option>${open.map(({ p, s }) => `<option value="${p.id}|${s.id}" ${s.id === sid ? 'selected' : ''}>${esc(s.text)} · ${esc(p.title)}</option>`).join('')}</select></label>
      <label class="field"><span>Oppure scrivi</span><input name="label" placeholder="Es. Ripasso Tecnica delle Costruzioni"></label>
      <div class="field-row">
        <label class="field"><span>Durata</span><select name="min">${[15, 25, 45, 50, 60, 90].map(m => `<option ${m === c.work ? 'selected' : ''} value="${m}">${m} minuti</option>`).join('')}</select></label>
        <label class="field"><span>Pausa</span><select name="short">${[3, 5, 10, 15].map(m => `<option ${m === c.short ? 'selected' : ''} value="${m}">${m} minuti</option>`).join('')}</select></label>
      </div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">${icon('i-target')} Inizia</button></div>
    </form>`);
}
submits['focus-start'] = (f, fd) => {
  const [pid, sid] = (fd.get('what') || '|').split('|');
  data.settings.focus = { ...focusCfg(), work: +fd.get('min'), short: +fd.get('short') };
  closeModal(); focusStart({ pid, sid, label: fd.get('label').trim(), min: +fd.get('min') });
};
Object.assign(actions, { 'focus-start': (el) => { if (el.dataset.id) modalFocus(el.dataset.pid, el.dataset.id); else modalFocus(); } });
PALETTE_EXTRA.push({ t: 'Avvia concentrazione', i: 'i-target', k: 'pomodoro timer focus studio', run: () => modalFocus() });
(function () {
  $('#btn-wx').insertAdjacentHTML('beforebegin', `<button class="focus-btn" id="btn-focus" hidden><svg viewBox="0 0 36 36" class="fb-ring"><circle cx="18" cy="18" r="15"/><circle cx="18" cy="18" r="15" class="fb-p"/></svg><span>25:00</span></button>`);
  $('#btn-focus').addEventListener('click', () => { if ($('#popover-layer .focus-pop')) { $('#popover-layer').innerHTML = ''; return; } openFocusPop(); });
  setInterval(focusTick, 1000);
})();
