/* Promemo — riepilogo del mattino e della sera */
'use strict';
const briefCfg = () => ({ enabled: true, morning: '07:30', evening: '21:00', ...(data.settings.brief || {}) });
function briefItemRow(it, now) {
  const s = itemStart(it), g = it.ev ? groupInfo(it.ev) : localGroup(it.project);
  const tr = it.ev && typeof travelOf === 'function' ? travelOf(it.ev) : null;
  return `<div class="br-row ${itemEnd(it) < now && !(it.step && !it.step.done) ? 'past' : ''}" style="--gc:${esc(g.color)}">
    <span class="br-t">${it.ev && it.ev.allDay ? 'Giorno' : fmtHM(s)}</span><i class="br-dot"></i>
    <span class="grow"><b>${it.step && it.step.auto ? '✦ ' : ''}${esc(itemTitle(it))}</b>${it.ev && it.ev.location ? `<small>${esc(it.ev.location)}</small>` : it.step ? `<small>${esc(it.project.title)}</small>` : ''}</span>
    ${tr && tr.leaveAt && !tr.same && travelCfg().enabled ? `<span class="br-leave">esci ${tr.leaveAt.slice(11, 16)}</span>` : ''}
  </div>`;
}
function modalBrief(kind) {
  const now = new Date(), morning = kind !== 'sera';
  const today = itemsOn(now), tmr = itemsOn(addDays(now, 1));
  const steps = data.projects.filter(p => p.status !== 'archiviato').flatMap(p => p.steps.map(st => ({ p, st })));
  const late = steps.filter(x => !x.st.done && x.st.due && parse(x.st.due) < startOfDay(now));
  const doneToday = steps.filter(x => x.st.done && x.st.doneAt && sameDay(parse(x.st.doneAt), now));
  const open = steps.filter(x => !x.st.done && x.st.due && parse(x.st.due) < addDays(startOfDay(now), 1));
  const w = typeof wxDay === 'function' && typeof wx !== 'undefined' && wx ? wxDay(dayKey(now)) : null;
  const wtxt = w ? `${wxIcon(w.code, true, 28)}<span>${esc(wxInfo(w.code)[0])} · ${Math.round(w.max)}° / ${Math.round(w.min)}°${w.rain ? ` · pioggia ${w.rain}%` : ''}</span>` : '';
  const name = data.settings.userName ? ', ' + esc(data.settings.userName) : '';
  const body = morning ? `
      <div class="br-head"><div><div class="eyebrow">${esc(fmtLong(now))}</div><h2>Buongiorno${name}</h2></div>${wtxt ? `<div class="br-wx">${wtxt}</div>` : ''}</div>
      <div class="br-sec">Oggi · ${today.length ? today.length + (today.length === 1 ? ' elemento' : ' elementi') : 'giornata libera'}</div>
      <div class="br-list">${today.map(it => briefItemRow(it, now)).join('') || '<div class="br-empty">Niente in agenda: goditi la giornata.</div>'}</div>
      ${late.length ? `<div class="br-sec warn">In ritardo · ${late.length}</div><div class="br-list">${late.slice(0, 8).map(({ p, st }) => `<div class="br-row"><span class="br-t">${esc(relDay(parse(st.due)))}</span><i class="br-dot" style="background:#e0352b"></i><span class="grow"><b>${esc(st.text)}</b><small>${esc(p.title)}</small></span><button class="btn small" data-br="today" data-pid="${p.id}" data-id="${st.id}">Oggi</button><button class="btn small" data-br="done" data-pid="${p.id}" data-id="${st.id}">${icon('i-check')}</button></div>`).join('')}</div>` : ''}`
    : `
      <div class="br-head"><div><div class="eyebrow">${esc(fmtLong(now))}</div><h2>Com’è andata oggi</h2></div></div>
      <div class="br-stats"><div><b>${doneToday.length}</b><span>${doneToday.length === 1 ? 'cosa fatta' : 'cose fatte'}</span></div><div><b>${today.filter(it => it.ev).length}</b><span>impegni</span></div><div><b>${typeof focusMinutes === 'function' ? focusMinutes(now) : 0}′</b><span>di concentrazione</span></div></div>
      ${doneToday.length ? `<div class="br-sec ok">Fatto</div><div class="br-list">${doneToday.map(({ p, st }) => `<div class="br-row done"><span class="br-t">${fmtHM(parse(st.doneAt))}</span><i class="br-dot" style="background:var(--green)"></i><span class="grow"><b>${esc(st.text)}</b><small>${esc(p.title)}</small></span></div>`).join('')}</div>` : ''}
      ${open.length ? `<div class="br-sec warn">Da spostare · ${open.length}</div><div class="br-list">${open.map(({ p, st }) => `<label class="br-row"><input type="checkbox" class="br-chk" data-pid="${p.id}" data-id="${st.id}" checked><span class="grow"><b>${esc(st.text)}</b><small>${esc(p.title)} · ${esc(relDay(parse(st.due)))}</small></span></label>`).join('')}</div>` : '<div class="br-empty">Niente in sospeso. 👏</div>'}
      <div class="br-sec">Domani</div>
      <div class="br-list">${tmr.slice(0, 8).map(it => briefItemRow(it, now)).join('') || '<div class="br-empty">Nessun impegno.</div>'}</div>`;
  openModal(`<div class="brief">${body}
    <div class="modal-actions">${!morning && open.length ? '<button class="btn-primary" data-br="move">Sposta a domani</button>' : ''}<button class="btn" data-action="close-modal">${morning ? 'Iniziamo' : 'Chiudi'}</button></div></div>`, (m) => {
    m.classList.add('modal-brief');
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-br]'); if (!b) return;
      const k = b.dataset.br;
      const find = (pid, id) => { const p = proj(pid); return [p, p && p.steps.find(x => x.id === id)]; };
      if (k === 'done') { const [p, st] = find(b.dataset.pid, b.dataset.id); st.done = true; st.doneAt = iso(new Date()); touch(p); save(); b.closest('.br-row').classList.add('done'); b.remove(); }
      if (k === 'today') { const [p, st] = find(b.dataset.pid, b.dataset.id); const d = parse(st.due); const n = new Date(); n.setHours(Math.max(n.getHours() + 1, d.getHours()), d.getMinutes(), 0, 0); st.due = iso(n); delete st.notifiedAt; touch(p); save(); b.closest('.br-row').remove(); toast('Spostato a oggi'); }
      if (k === 'move') {
        let n = 0;
        m.querySelectorAll('.br-chk:checked').forEach(c => { const [p, st] = find(c.dataset.pid, c.dataset.id); if (!st) return; if (st.auto) { delete st.autoDue; st.due = null; st.notBefore = iso(addDays(startOfDay(new Date()), 1)); } else { const d = parse(st.due); const t = addDays(startOfDay(new Date()), 1); t.setHours(d.getHours(), d.getMinutes()); st.due = iso(t); } delete st.notifiedAt; touch(p); n++; });
        save(); closeModal(); render(); toast(n ? `${n} ${n === 1 ? 'compito spostato' : 'compiti spostati'} a domani` : 'Nulla da spostare');
      }
    });
  });
}
api.onNavigate((r) => { if (r && r.action === 'brief') setTimeout(() => modalBrief(r.kind), 150); });
PALETTE_EXTRA.push({ t: 'Riepilogo del mattino', i: 'i-sunrise', k: 'buongiorno giornata oggi', run: () => modalBrief('mattina') }, { t: 'Riepilogo della sera', i: 'i-clock', k: 'sera com’è andata sposta domani', run: () => modalBrief('sera') });

// impostazioni → Notifiche
const _paneHTML_br = paneHTML;
paneHTML = function (id, ls) {
  if (id !== 'notifiche') return _paneHTML_br(id, ls);
  const c = briefCfg();
  return _paneHTML_br(id, ls) + `<h3 style="margin-top:22px">Riepiloghi</h3>
    <div class="set-group">
      ${srow('Riepilogo del mattino e della sera', 'Una notifica con la giornata; un clic apre il riepilogo', `<input type="checkbox" class="switch" data-brs="enabled" ${c.enabled ? 'checked' : ''}>`)}
      ${srow('Al mattino', 'Impegni, meteo, a che ora uscire, compiti in ritardo', `<input type="time" class="set-input" style="width:110px" data-brs="morning" value="${esc(c.morning)}"><button class="btn small" data-brs-open="mattina">Vedi</button>`)}
      ${srow('La sera', 'Cosa hai fatto, cosa spostare a domani', `<input type="time" class="set-input" style="width:110px" data-brs="evening" value="${esc(c.evening)}"><button class="btn small" data-brs-open="sera">Vedi</button>`)}
    </div>`;
};
const _drawPane_br = drawPane;
drawPane = function (m) {
  _drawPane_br(m);
  if (setPane !== 'notifiche') return;
  m.querySelectorAll('[data-brs]').forEach(el => el.addEventListener('change', () => { data.settings.brief = { ...briefCfg(), [el.dataset.brs]: el.type === 'checkbox' ? el.checked : el.value }; save(); }));
  m.querySelectorAll('[data-brs-open]').forEach(b => b.addEventListener('click', () => { closeModal(); modalBrief(b.dataset.brsOpen); }));
};
