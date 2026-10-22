/* Promemo — pianificazione automatica: i compiti con "Pianifica Promemo" trovano da soli uno spazio libero prima della scadenza
   e si spostano se un impegno occupa il loro posto. Un compito spostato a mano resta dove l'hai messo. */
'use strict';

const PLAN_DEF = { enabled: true, start: 9, end: 19, days: [1, 2, 3, 4, 5], buffer: 10, lunch: true, horizon: 21 };
const planCfg = () => ({ ...PLAN_DEF, ...(data.settings.planner || {}) });
const PRIO_W = { alta: 0, media: 1, '': 2, bassa: 3 };

function planBusy(skipStep) {
  const busy = [];
  for (const e of PromemoRecur.expand(data.events, addDays(new Date(), -1), addDays(new Date(), 30))) {
    if (e.allDay || !e.start) continue;
    const s = parse(e.start), en = parse(e.end || e.start);
    if (en - s > 20 * 3600000) continue; // eventi di più giorni non bloccano le ore
    busy.push([s.getTime(), en.getTime()]);
  }
  for (const p of data.projects) {
    if (p.status === 'archiviato') continue;
    for (const st of p.steps) {
      if (st === skipStep || st.done || !st.due || st.auto) continue;
      const s = parse(st.due); busy.push([s.getTime(), s.getTime() + (+st.duration || 30) * 60000]);
    }
  }
  return busy;
}
const pinnedStep = (st) => !!(st.autoDue && st.due && st.due !== st.autoDue);

function planAuto() {
  if (!data) return 0;
  const c = planCfg();
  const tasks = [];
  for (const p of data.projects) { if (p.status === 'archiviato') continue; for (const st of p.steps) if (st.auto && !st.done) tasks.push({ p, st }); }
  if (!tasks.length) return 0;
  const now = new Date(); const t0 = Math.ceil((now.getTime() + 5 * 60000) / (15 * 60000)) * 15 * 60000;
  const buf = (c.buffer || 0) * 60000;
  const busy = planBusy();
  const overlaps = (s, e) => busy.some(([a, b]) => s < b + buf && e + buf > a);
  // le finestre di lavoro dei prossimi giorni
  const windows = [];
  for (let i = 0; i <= c.horizon; i++) {
    const d = startOfDay(addDays(now, i));
    if (!c.days.includes(d.getDay())) continue;
    const ranges = c.lunch && c.start < 13 && c.end > 14 ? [[c.start, 13], [14, c.end]] : [[c.start, c.end]];
    for (const [h1, h2] of ranges) { const a = new Date(d); a.setHours(h1, 0, 0, 0); const b = new Date(d); b.setHours(h2, 0, 0, 0); if (b.getTime() > t0) windows.push([Math.max(a.getTime(), t0), b.getTime()]); }
  }
  const findSlot = (dur, until, from = 0) => {
    for (const [a, b] of windows) {
      if (until && a >= until) break;
      if (b <= from) continue;
      for (let s = Math.max(a, Math.ceil(from / 9e5) * 9e5); s + dur <= b; s += 15 * 60000) if (!overlaps(s, s + dur)) return s;
    }
    return null;
  };
  let changed = 0;
  const keep = [], place = [];
  for (const t of tasks) {
    const st = t.st, dur = (+st.duration || 60) * 60000;
    const cur = st.due ? parse(st.due).getTime() : null;
    // resta dov'è se: spostato a mano, già iniziato, oppure ancora libero e prima della scadenza
    if (cur && (pinnedStep(st) || (cur <= now.getTime() && cur + dur > now.getTime()))) { busy.push([cur, cur + dur]); keep.push(t); continue; }
    if (cur && st.autoDue === st.due && cur > now.getTime() && (!st.notBefore || cur >= parse(st.notBefore).getTime()) && !overlaps(cur, cur + dur) && (!st.deadline || cur + dur <= parse(st.deadline).getTime())) { busy.push([cur, cur + dur]); keep.push(t); continue; }
    place.push(t);
  }
  place.sort((a, b) => (a.st.deadline || '9999').localeCompare(b.st.deadline || '9999') || (PRIO_W[a.st.priority || ''] - PRIO_W[b.st.priority || '']) || (+b.st.duration || 60) - (+a.st.duration || 60));
  for (const { p, st } of place) {
    const dur = (+st.duration || 60) * 60000;
    const until = st.deadline ? parse(st.deadline).getTime() - dur + 1 : null;
    const from = st.notBefore ? parse(st.notBefore).getTime() : 0;
    if (st.notBefore && from <= now.getTime()) delete st.notBefore;
    let s = findSlot(dur, until, from), late = false;
    if (s == null) { s = findSlot(dur, null, from); late = s != null && !!st.deadline; }
    const nd = s == null ? null : iso(new Date(s));
    if (nd !== st.due || late !== !!st.autoLate) {
      st.due = nd; st.autoDue = nd; if (late) st.autoLate = true; else delete st.autoLate;
      delete st.notifiedAt; touch(p); changed++;
    }
    if (s != null) busy.push([s, s + dur]);
  }
  return changed;
}

// si riattiva quando cambiano impegni o compiti
let planTimer = null, planning = false;
function schedulePlan(delay = 1200) {
  clearTimeout(planTimer);
  planTimer = setTimeout(() => {
    if (!data || planning || !planCfg().enabled) return;
    planning = true;
    try { const n = planAuto(); if (n) { _savePlan(); render(); } } finally { planning = false; }
  }, delay);
}
const _savePlan = save;
save = function () { _savePlan(); if (!planning) schedulePlan(); };
api.onDataChanged(() => schedulePlan(2000));
setInterval(() => schedulePlan(0), 10 * 60000);
const _planWait = setInterval(() => { if (data) { clearInterval(_planWait); schedulePlan(500); } }, 400);

// impostazioni
const _paneHTML_plan = paneHTML;
paneHTML = function (id, ls) {
  if (id !== 'calendario') return _paneHTML_plan(id, ls);
  const c = planCfg();
  const D = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'G'], [5, 'V'], [6, 'S'], [0, 'D']];
  return _paneHTML_plan(id, ls) + `<h3 style="margin-top:22px">Pianificazione automatica</h3>
    <div class="set-group">
      ${srow('Pianifica i compiti', 'I compiti con “Pianifica Promemo” trovano da soli uno spazio libero prima della scadenza', `<input type="checkbox" class="switch" data-plan="enabled" ${c.enabled ? 'checked' : ''}>`)}
      ${srow('Orario di lavoro', 'Solo in queste ore', `<select class="set-select" data-plan="start">${[...Array(16)].map((_, i) => i + 5).map(h => `<option value="${h}" ${c.start === h ? 'selected' : ''}>${pad(h)}:00</option>`).join('')}</select><span class="muted">–</span><select class="set-select" data-plan="end">${[...Array(16)].map((_, i) => i + 9).map(h => `<option value="${h}" ${c.end === h ? 'selected' : ''}>${pad(h)}:00</option>`).join('')}</select>`)}
      ${srow('Giorni', '', `<div class="day-pick">${D.map(([d, l]) => `<button type="button" data-plan-day="${d}" class="${c.days.includes(d) ? 'on' : ''}">${l}</button>`).join('')}</div>`)}
      ${srow('Pausa pranzo libera', '13:00–14:00', `<input type="checkbox" class="switch" data-plan="lunch" ${c.lunch ? 'checked' : ''}>`)}
      ${srow('Margine tra un impegno e l’altro', '', `<select class="set-select" data-plan="buffer">${[0, 5, 10, 15, 30].map(m => `<option value="${m}" ${c.buffer === m ? 'selected' : ''}>${m ? m + ' min' : 'Nessuno'}</option>`).join('')}</select>`)}
    </div>`;
};
const _drawPane_plan = drawPane;
drawPane = function (m) {
  _drawPane_plan(m);
  if (setPane !== 'calendario') return;
  const box = m.querySelector('#set-pane');
  const set = (patch) => { data.settings.planner = { ...planCfg(), ...patch }; Object.values(data.projects).forEach(p => p.steps.forEach(st => { if (st.auto && !pinnedStep(st)) delete st.autoDue; })); save(); };
  box.querySelectorAll('[data-plan]').forEach(el => el.addEventListener('change', () => { const k = el.dataset.plan; set({ [k]: el.type === 'checkbox' ? el.checked : +el.value }); }));
  box.querySelectorAll('[data-plan-day]').forEach(b => b.addEventListener('click', () => { const d = +b.dataset.planDay; const days = new Set(planCfg().days); days.has(d) ? days.delete(d) : days.add(d); b.classList.toggle('on'); set({ days: [...days] }); }));
};
