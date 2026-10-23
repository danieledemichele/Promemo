/* Promemo — piano di studio verso un esame (interfaccia) */
'use strict';
const ST_DAYS = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'G'], [5, 'V'], [6, 'S'], [0, 'D']];

function modalStudy() {
  const def = { start: 15, end: 20, days: [1, 2, 3, 4, 5, 6], session: 90, maxDay: 120, finalDays: 2, ...(data.settings.studyDefaults || {}) };
  const exam = dayKey(addDays(new Date(), 28));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  openModal(`<h2>${icon('c-cap')} Piano di studio</h2>
    <p class="muted" style="margin-top:-6px">Scrivi gli argomenti e quante ore pensi che servano: Promemo divide tutto in sessioni, le mette negli spazi liberi fino all'esame, aggiunge i ripassi e, se salti un giorno, ripianifica da solo.</p>
    <form class="form" data-submit="study-create">
      <div class="field-row">
        <label class="field" style="flex:2"><span>Esame</span><input name="name" required placeholder="Es. Scienza delle costruzioni"></label>
        <label class="field"><span>Data</span><input type="date" name="date" required value="${exam}" min="${dayKey(addDays(new Date(), 1))}"></label>
        <label class="field"><span>Ora (facoltativa)</span><input type="time" name="time"></label>
      </div>
      <label class="field"><span>Argomenti, uno per riga, con le ore (es. “Travi iperstatiche — 6”)</span><textarea name="chapters" rows="6" required placeholder="Travi iperstatiche — 6&#10;Torsione 4h&#10;Taglio 3&#10;Esercizi d'esame — 8"></textarea></label>
      <div class="field-row">
        <label class="field"><span>Ore per argomento se non le scrivi</span><select name="defHours">${[2, 3, 4, 6, 8].map(v => `<option value="${v}" ${v === 4 ? 'selected' : ''}>${v} ore</option>`).join('')}</select></label>
        <label class="field"><span>Durata di una sessione</span><select name="session">${[45, 60, 90, 120].map(v => `<option value="${v}" ${v === def.session ? 'selected' : ''}>${v} min</option>`).join('')}</select></label>
        <label class="field"><span>Al massimo al giorno</span><select name="maxDay">${[60, 90, 120, 150, 180, 240, 300].map(v => `<option value="${v}" ${v === def.maxDay ? 'selected' : ''}>${v % 60 ? (v / 60).toString().replace('.', ',') : v / 60} ${v === 60 ? 'ora' : 'ore'}</option>`).join('')}</select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Quando studi</span><div class="row" style="gap:6px"><select name="start">${hours.map(h => `<option value="${h}" ${h === def.start ? 'selected' : ''}>dalle ${pad(h)}</option>`).join('')}</select><select name="end">${hours.map(h => `<option value="${h}" ${h === def.end ? 'selected' : ''}>alle ${pad(h)}</option>`).join('')}</select></div></label>
        <div class="field"><span>Giorni</span><div class="st-days">${ST_DAYS.map(([d, l]) => `<label><input type="checkbox" name="d${d}" ${def.days.includes(d) ? 'checked' : ''}><i>${l}</i></label>`).join('')}</div></div>
      </div>
      <div class="field-row">
        <label class="field"><span>Ultimi giorni per il ripasso finale</span><select name="finalDays">${[0, 1, 2, 3, 4].map(v => `<option value="${v}" ${v === def.finalDays ? 'selected' : ''}>${v ? v + (v === 1 ? ' giorno' : ' giorni') : 'Nessuno'}</option>`).join('')}</select></label>
        <label class="field"><span>Raccolta</span><select name="category"><option value="">Nessuna</option>${data.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <label class="switch-row" style="border:0;padding:4px 0"><div>Ripassi distanziati<small>Mezz'ora di ripasso il giorno dopo, dopo 3 giorni e dopo una settimana da ogni argomento: si ricorda molto di più</small></div><input type="checkbox" class="switch" name="reviews" checked></label>
      <div class="st-preview muted" id="st-prev"></div>
      <div class="form-err" hidden></div>
      <div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">Crea il piano</button></div>
    </form>`, (m) => {
    const f = m.querySelector('form');
    const upd = () => { const o = studyOpts(f); const el = m.querySelector('#st-prev'); try { const r = PromemoStudy.build(o); el.innerHTML = `${r.project.steps.length} sessioni · ${Math.round(r.total * 10) / 10} ore di studio in ${r.days} giorni utili · al massimo ${Math.round(r.capacity)} ore disponibili${r.tight ? ' · <b style="color:#e0352b">molto stretto: aumenta le ore al giorno o i giorni</b>' : ''}`; } catch (e) { el.textContent = o.chapters.length ? e.message : ''; } };
    f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
  });
}
function studyOpts(f) {
  const fd = new FormData(f);
  const days = ST_DAYS.map(([d]) => d).filter(d => fd.get('d' + d));
  return { name: String(fd.get('name') || '').trim() || 'Esame', exam: fd.get('date') + (fd.get('time') ? 'T' + fd.get('time') : ''), chapters: PromemoStudy.parseChapters(fd.get('chapters'), +fd.get('defHours')), session: +fd.get('session'), maxDay: +fd.get('maxDay'), start: +fd.get('start'), end: +fd.get('end'), days, finalDays: +fd.get('finalDays'), reviews: !!fd.get('reviews'), category: fd.get('category') || '' };
}
submits['study-create'] = (f) => {
  const o = studyOpts(f);
  if (o.end <= o.start) return showErr(f, 'L’orario di fine deve venire dopo quello di inizio');
  let r; try { r = PromemoStudy.build(o); } catch (e) { return showErr(f, e.message); }
  data.projects.push(r.project); data.events.push(r.event);
  data.settings.studyDefaults = { start: o.start, end: o.end, days: o.days, session: o.session, maxDay: o.maxDay, finalDays: o.finalDays };
  save(); closeModal();
  go('progetti', { projectId: r.project.id, projFilter: 'attivi', catFilter: null });
  toast(`Piano creato: ${r.project.steps.length} sessioni fino all’esame`);
};

// riquadro nel progetto: avanzamento, prossima sessione, regolazioni
function studyPanelHTML(p) {
  const g = PromemoStudy.progress(p); if (!g) return '';
  const s = p.study, pct = Math.round(g.done * 100), exp = Math.round(g.expected * 100);
  const behind = g.done + 0.1 < g.expected;
  return `<div class="study-panel">
    <div class="row"><div class="grow"><div class="label">${icon('c-cap')} Piano di studio</div>
      <b>${g.daysLeft > 0 ? `Esame tra ${g.daysLeft} ${g.daysLeft === 1 ? 'giorno' : 'giorni'}` : g.daysLeft === 0 ? 'Esame oggi' : 'Esame passato'}</b>
      <span class="muted"> · ${Math.round(g.doneH * 10) / 10} di ${Math.round(g.totH * 10) / 10} ore fatte</span></div>
      <span class="pill ${behind ? 'warn' : 'ok'}">${behind ? 'Un po’ indietro' : 'In linea'}</span></div>
    <div class="study-bar"><i style="width:${pct}%"></i><em style="left:${exp}%" title="Dove dovresti essere oggi"></em></div>
    <div class="st-preview muted">${pct}% fatto · oggi dovresti essere intorno al ${exp}%${g.next ? ` · prossima sessione ${stamp(g.next.due).toLowerCase()}: ${esc(g.next.text)}` : ''}</div>
    ${g.late ? `<div class="acc-err" style="margin-top:8px">${g.late} ${g.late === 1 ? 'sessione non ci sta' : 'sessioni non ci stanno'} prima della scadenza: aumenta le ore al giorno o aggiungi un giorno.</div>` : ''}
    <div class="row study-ctl">
      <label>Al giorno <select data-study="maxDay" data-id="${p.id}">${[60, 90, 120, 150, 180, 240, 300].map(v => `<option value="${v}" ${v === +s.maxDay ? 'selected' : ''}>${String(v / 60).replace('.', ',')} h</option>`).join('')}</select></label>
      <label>Dalle <select data-study="start" data-id="${p.id}">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === +s.start ? 'selected' : ''}>${pad(h)}</option>`).join('')}</select></label>
      <label>alle <select data-study="end" data-id="${p.id}">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === +s.end ? 'selected' : ''}>${pad(h)}</option>`).join('')}</select></label>
      <div class="st-days small">${ST_DAYS.map(([d, l]) => `<label><input type="checkbox" data-study-day="${d}" data-id="${p.id}" ${s.days.includes(d) ? 'checked' : ''}><i>${l}</i></label>`).join('')}</div>
    </div>
  </div>`;
}
const _projectDetail_st = projectDetail;
projectDetail = function (p) {
  const h = _projectDetail_st(p);
  return p && p.study ? h.replace('<div class="detail-grid">', studyPanelHTML(p) + '<div class="detail-grid">') : h;
};
document.addEventListener('change', (e) => {
  const t = e.target;
  const k = t.dataset && (t.dataset.study || (t.dataset.studyDay != null ? 'day' : null)); if (!k) return;
  const p = proj(t.dataset.id); if (!p || !p.study) return;
  if (k === 'day') { const d = +t.dataset.studyDay; p.study.days = t.checked ? [...new Set([...p.study.days, d])] : p.study.days.filter(x => x !== d); if (!p.study.days.length) { p.study.days = [d]; t.checked = true; } }
  else p.study[k] = +t.value;
  if (p.study.end <= p.study.start) p.study.end = Math.min(23, p.study.start + 1);
  // le sessioni non ancora fatte si ripianificano con le nuove regole
  for (const st of p.steps) if (st.study && !st.done && st.auto && !(st.autoDue && st.due && st.due !== st.autoDue)) { st.due = null; delete st.autoDue; }
  touch(p); save(); render(); toast('Ripianifico le sessioni');
});

// nel menu "Nuovo" e nella palette
const _modalNew_st = modalNew;
modalNew = function () {
  _modalNew_st();
  const tp = document.querySelector('#modal .type-picker');
  if (tp && !tp.querySelector('[data-action="new-study"]')) tp.insertAdjacentHTML('beforeend', `<button data-action="new-study">${icon('c-cap')}Piano di studio<small>Sessioni e ripassi fino all'esame</small></button>`);
};
Object.assign(actions, { 'new-study': () => modalStudy() });
PALETTE_EXTRA.push({ t: 'Nuovo piano di studio', i: 'c-cap', k: 'esame studiare studio università capitoli ripasso', run: () => modalStudy() });
