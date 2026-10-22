/* Promemo — Statistiche: dove va il tempo, concentrazione, compiti fatti e pannelli personali
   (ripetizioni con compenso, ore di lezione per classe, andamento da un database Notion come gli allenamenti) */
'use strict';

const stUi = { p: 'settimana', off: 0, ndb: {}, loading: {} };
const panels = () => (data.settings.panels = data.settings.panels || []);
const fmtH = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h${m ? ' ' + m : ''}` : `${m} min`; };
const euro = (v) => v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

function statRange() {
  const now = new Date();
  if (stUi.p === 'mese') { const a = new Date(now.getFullYear(), now.getMonth() + stUi.off, 1); const b = new Date(a.getFullYear(), a.getMonth() + 1, 1); return [a, b, a.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })]; }
  const a = startOfDay(addDays(now, -((now.getDay() + 6) % 7) + 7 * stUi.off)); const b = addDays(a, 7);
  return [a, b, `${a.getDate()} ${MESI[a.getMonth()]} – ${addDays(b, -1).getDate()} ${MESI[addDays(b, -1).getMonth()]}`];
}
// minuti di ogni evento con orario dentro l'intervallo
function timedEvents(a, b, pred = () => true) {
  const out = [];
  for (const e of PromemoRecur.expand(data.events, addDays(a, -1), b)) {
    if (e.allDay || !e.start || !pred(e)) continue;
    const s = parse(e.start), en = parse(e.end || e.start);
    if (en - s > 20 * 3600000 || en <= a || s >= b) continue;
    const min = (Math.min(en, b) - Math.max(s, a)) / 60000;
    if (min > 0) out.push({ e, s, min });
  }
  return out;
}
function allGroups() {
  const m = new Map();
  for (const e of data.events) { if (e.allDay) continue; const g = groupInfo(e); if (!m.has(g.key)) m.set(g.key, { key: g.key, name: g.name || 'Senza nome', color: g.color, acc: g.acc ? g.acc.name : 'Promemo' }); }
  return [...m.values()].sort((x, y) => x.acc.localeCompare(y.acc) || x.name.localeCompare(y.name));
}

function barChart(days, series, h = 150) {
  const W = 700, P = 28, n = days.length, bw = Math.min(46, (W - P) / n * 0.62);
  const max = Math.max(60, ...days.map(d => d.total)) ;
  const yMax = Math.ceil(max / 60) * 60, step = yMax / 60 > 8 ? 120 : 60;
  const y = (v) => h - 18 - (v / yMax) * (h - 30);
  let grid = '';
  for (let v = 0; v <= yMax; v += step) grid += `<line x1="${P}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="sg"/><text x="${P - 6}" y="${y(v) + 3}" class="sy">${v / 60}h</text>`;
  const bars = days.map((d, i) => {
    const cx = P + (i + 0.5) * (W - P) / n;
    let acc = 0;
    const segs = series.map(sr => { const v = d.by[sr.key] || 0; if (!v) return ''; const y1 = y(acc + v), y0 = y(acc); acc += v; return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y0 - y1).toFixed(1)}" fill="${esc(sr.color)}" rx="3"><title>${esc(sr.name)}: ${fmtH(v)}</title></rect>`; }).join('');
    const fx = d.focus ? `<circle cx="${cx}" cy="${y(d.focus)}" r="3.5" class="sfocus"><title>Concentrazione: ${fmtH(d.focus)}</title></circle>` : '';
    return segs + fx + `<text x="${cx}" y="${h - 3}" class="sx ${d.today ? 'on' : ''}">${esc(d.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${h}" class="schart">${grid}${bars}</svg>`;
}

function lineChart(series, h = 170) {
  const all = series.flatMap(s => s.pts); if (!all.length) return '<div class="br-empty">Nessun dato con data e valore.</div>';
  const W = 700, P = 36;
  const x0 = Math.min(...all.map(p => p.t)), x1 = Math.max(...all.map(p => p.t)), v0 = Math.min(0, ...all.map(p => p.v)), v1 = Math.max(...all.map(p => p.v)) || 1;
  const x = (t) => P + (x1 === x0 ? (W - P) / 2 : (t - x0) / (x1 - x0) * (W - P - 10));
  const y = (v) => h - 22 - (v - v0) / (v1 - v0 || 1) * (h - 34);
  let grid = '';
  for (let i = 0; i <= 4; i++) { const v = v0 + (v1 - v0) * i / 4; grid += `<line x1="${P}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="sg"/><text x="${P - 6}" y="${y(v) + 3}" class="sy">${Math.round(v * 10) / 10}</text>`; }
  const months = []; for (let d = new Date(x0); d <= new Date(x1); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(new Date(d.getFullYear(), d.getMonth(), 1));
  const xl = months.filter(m => m.getTime() >= x0 - 864e5 * 31).slice(-8).map(m => `<text x="${Math.max(P, x(Math.max(m.getTime(), x0)))}" y="${h - 4}" class="sx" text-anchor="start">${MESI[m.getMonth()]}</text>`).join('');
  const lines = series.map(s => { const pts = s.pts.sort((a, b) => a.t - b.t); return `<polyline points="${pts.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}" stroke="${s.color}" class="sl"/>${pts.map(p => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3" fill="${s.color}"><title>${esc(s.name)} · ${new Date(p.t).toLocaleDateString('it-IT')} · ${p.v}</title></circle>`).join('')}`; }).join('');
  return `<svg viewBox="0 0 ${W} ${h}" class="schart">${grid}${lines}${xl}</svg>`;
}

// ---------- pannelli ----------
function personOf(title) {
  const m = String(title).match(/(?:·|-|–|con)\s+([A-ZÀ-Ý][\p{L}']+(?:\s+[A-ZÀ-Ý][\p{L}']+)?)\s*$/u);
  return m ? m[1] : null;
}
function panelHours(pn, a, b) {
  const keys = new Set(pn.groups || []);
  const ev = timedEvents(a, b, e => keys.has(groupInfo(e).key));
  const min = ev.reduce((s, x) => s + x.min, 0);
  const rates = pn.rates || {};
  const money = ev.reduce((s, x) => s + x.min / 60 * (+rates[groupInfo(x.e).key] || +pn.rate || 0), 0);
  const byG = {}, byP = {};
  for (const x of ev) { const g = groupInfo(x.e); byG[g.key] = byG[g.key] || { name: g.name, color: g.color, min: 0, n: 0 }; byG[g.key].min += x.min; byG[g.key].n++; const p = personOf(x.e.title); if (p) { byP[p] = byP[p] || { min: 0, n: 0 }; byP[p].min += x.min; byP[p].n++; } }
  const persons = Object.entries(byP).sort((x, y) => y[1].min - x[1].min).slice(0, 6);
  const hasMoney = pn.rate || Object.values(rates).some(Number);
  return `<div class="pn-kpis"><div><b>${ev.length}</b><span>${pn.unit || 'incontri'}</span></div><div><b>${fmtH(min)}</b><span>ore</span></div>${hasMoney ? `<div><b>${euro(money)}</b><span>compenso</span></div>` : ''}</div>
    <div class="pn-rows">${Object.values(byG).sort((x, y) => y.min - x.min).map(g => `<div class="pn-row"><i style="background:${esc(g.color)}"></i><span class="grow">${esc(g.name)}</span><span>${g.n} · ${fmtH(g.min)}</span><span class="pn-bar"><em style="width:${min ? g.min / min * 100 : 0}%;background:${esc(g.color)}"></em></span></div>`).join('') || '<div class="br-empty">Niente in questo periodo.</div>'}</div>
    ${persons.length ? `<div class="pn-sub">Per persona</div><div class="pn-people">${persons.map(([n, v]) => `<span>${esc(n)} <b>${v.n}</b></span>`).join('')}</div>` : ''}`;
}
async function ndbRows(pn) {
  const k = pn.db; const c = stUi.ndb[k];
  if (c && Date.now() - c.at < 10 * 60000) return c.rows;
  if (stUi.loading[k]) return null;
  stUi.loading[k] = true;
  try {
    let rows = [], cursor;
    for (let i = 0; i < 10; i++) { const r = await api.ndbQuery({ acc: pn.acc, db: pn.db, cursor }); if (!r.ok) throw new Error(r.error); rows = rows.concat(r.value.rows); if (!r.value.next) break; cursor = r.value.next; }
    stUi.ndb[k] = { at: Date.now(), rows };
    return rows;
  } catch (e) { stUi.ndb[k] = { at: Date.now(), rows: [], err: e.message }; return []; }
  finally { delete stUi.loading[k]; if (ui.view === 'statistiche') render(); }
}
const ndbVal = (p) => { if (!p) return null; const v = p.value; if (v == null) return null; if (typeof v === 'number') return v; if (typeof v === 'string') return v; if (Array.isArray(v)) return v.map(o => o.name || o).join(', '); if (v.name) return v.name; if (v.start) return v.start; return null; };
function panelNotion(pn, a, b) {
  const c = stUi.ndb[pn.db];
  if (!c) { ndbRows(pn); return '<div class="br-empty"><span class="spinner"></span> Carico da Notion…</div>'; }
  if (c.err) return `<div class="form-err">${esc(c.err)}</div>`;
  const rows = c.rows.filter(r => !r.archived).map(r => { const d = ndbVal(r.props[pn.dateProp]); return { r, t: d ? parse(String(d).slice(0, 16)).getTime() : null, v: pn.numProp ? Number(ndbVal(r.props[pn.numProp])) : 1, g: pn.groupProp ? String(ndbVal(r.props[pn.groupProp]) || '—') : (pn.title || 'Valore') }; }).filter(x => x.t && !isNaN(x.v));
  const inP = rows.filter(x => x.t >= a.getTime() && x.t < b.getTime());
  const COLS = ['#0a84ff', '#e5562a', '#2f9e5b', '#9775fa', '#d6336c', '#1098ad', '#c9930a', '#5c636a'];
  const groups = {};
  for (const x of rows) (groups[x.g] = groups[x.g] || []).push(x);
  const top = Object.entries(groups).sort((x, y) => y[1].length - x[1].length).slice(0, 12);
  const sel = pn.sel && groups[pn.sel] ? pn.sel : null;
  const show = (sel ? top.filter(([g]) => g === sel) : top.slice(0, pn.numProp ? 4 : 1)).map(([g, xs]) => {
    // un punto al giorno: il massimo (es. carico) o la somma (es. km)
    const byDay = {}; for (const x of xs) { const k = new Date(x.t).toDateString(); byDay[k] = byDay[k] == null ? x.v : pn.agg === 'sum' ? byDay[k] + x.v : Math.max(byDay[k], x.v); }
    return { name: g, color: COLS[top.findIndex(t => t[0] === g) % COLS.length], pts: Object.entries(byDay).map(([k, v]) => ({ t: new Date(k).getTime(), v })) };
  });
  const last = show[0] && show[0].pts.sort((x, y) => x.t - y.t);
  const delta = last && last.length > 1 ? last[last.length - 1].v - last[0].v : null;
  return `<div class="pn-kpis"><div><b>${inP.length}</b><span>${esc(pn.unit || 'righe')} nel periodo</span></div><div><b>${rows.length}</b><span>in totale</span></div>${pn.numProp && delta != null && show.length === 1 ? `<div><b>${delta > 0 ? '+' : ''}${Math.round(delta * 10) / 10}</b><span>${esc(pn.numProp)} dall'inizio</span></div>` : ''}</div>
    ${pn.numProp ? lineChart(show) : ''}
    ${pn.groupProp && top.length > 1 ? `<div class="pn-chips"><button class="${sel ? '' : 'on'}" data-pn-sel="${pn.id}" data-g="">Principali</button>${top.map(([g, xs], i) => `<button class="${sel === g ? 'on' : ''}" data-pn-sel="${pn.id}" data-g="${esc(g)}"><i style="background:${COLS[i % COLS.length]}"></i>${esc(g)} <small>${xs.length}</small></button>`).join('')}</div>` : ''}`;
}
function panelHTML(pn, a, b) {
  const body = pn.type === 'notion' ? panelNotion(pn, a, b) : panelHours(pn, a, b);
  return `<div class="panel pn"><div class="panel-head"><h2>${esc(pn.icon || (pn.type === 'notion' ? '📈' : '⏱️'))} ${esc(pn.title)}</h2><span><button class="link" data-act-pn="edit" data-id="${pn.id}">Modifica</button></span></div>${body}</div>`;
}

// ---------- vista ----------
function viewStats() {
  const [a, b, label] = statRange();
  const now = new Date();
  const days = []; for (let d = new Date(a); d < b; d = addDays(d, 1)) days.push(new Date(d));
  const ev = timedEvents(a, b);
  const series = {}; const perDay = days.map(d => ({ label: stUi.p === 'mese' ? String(d.getDate()) : d.toLocaleDateString('it-IT', { weekday: 'short' }), today: sameDay(d, now), by: {}, total: 0, focus: focusMinutes(d) }));
  for (const x of ev) { const g = groupInfo(x.e); series[g.key] = series[g.key] || { key: g.key, name: g.name || 'Senza nome', color: g.color, min: 0, n: 0 }; series[g.key].min += x.min; series[g.key].n++; const i = Math.floor((startOfDay(x.s) - a) / 864e5); if (perDay[i]) { perDay[i].by[g.key] = (perDay[i].by[g.key] || 0) + x.min; perDay[i].total += x.min; } }
  const sr = Object.values(series).sort((x, y) => y.min - x.min);
  const tot = sr.reduce((s, x) => s + x.min, 0);
  const steps = data.projects.flatMap(p => p.steps.map(st => ({ p, st })));
  const done = steps.filter(x => x.st.done && x.st.doneAt && parse(x.st.doneAt) >= a && parse(x.st.doneAt) < b);
  const onTime = done.filter(x => !x.st.due || x.st.doneAt <= (x.st.deadline || x.st.due).slice(0, 10) + 'T23:59').length;
  const fs = (data.focus || []).filter(s => parse(s.start) >= a && parse(s.start) < b);
  const fmin = fs.reduce((s, x) => s + x.min, 0);
  const byProj = {}; for (const s of fs) { const k = s.pid && proj(s.pid) ? proj(s.pid).title : s.label || 'Altro'; byProj[k] = (byProj[k] || 0) + s.min; }
  const byPj = {}; for (const x of done) byPj[x.p.title] = (byPj[x.p.title] || 0) + 1;
  return `<div class="stats">
    <div class="row" style="align-items:flex-end;gap:12px;flex-wrap:wrap">
      <div class="grow"><div class="eyebrow">Come usi il tuo tempo</div><h1 class="large-title">Statistiche</h1><div class="subtitle">${esc(label.replace(/^./, c => c.toUpperCase()))}</div></div>
      <div class="segmented">${[['settimana', 'Settimana'], ['mese', 'Mese']].map(([k, l]) => `<button class="${stUi.p === k ? 'on' : ''}" data-st-p="${k}">${l}</button>`).join('')}</div>
      <div class="row" style="gap:4px"><button class="icon-btn" data-st-off="-1">${icon('i-chev-l')}</button><button class="btn small" data-st-off="0">Oggi</button><button class="icon-btn" data-st-off="1">${icon('i-chev-r')}</button></div>
    </div>
    <div class="st-kpis">
      <div class="tile"><div class="tile-label">${icon('i-calendar')} In agenda</div><div class="tile-big">${fmtH(tot)}</div><div class="tile-sub">${ev.length} impegni con orario</div></div>
      <div class="tile"><div class="tile-label">${icon('i-target')} Concentrazione</div><div class="tile-big">${fmtH(fmin)}</div><div class="tile-sub">${fs.length} sessioni</div></div>
      <div class="tile"><div class="tile-label">${icon('i-check')} Compiti fatti</div><div class="tile-big">${done.length}</div><div class="tile-sub">${done.length ? Math.round(onTime / done.length * 100) + '% entro la scadenza' : 'nessuno nel periodo'}</div></div>
      <div class="tile"><div class="tile-label">${icon('i-clock')} Media al giorno</div><div class="tile-big">${fmtH(tot / days.length)}</div><div class="tile-sub">di impegni</div></div>
    </div>
    <div class="st-grid">
      <div class="panel"><div class="panel-head"><h2>Ore per giorno</h2><span class="tiny">● concentrazione</span></div>${barChart(perDay, sr)}</div>
      <div class="panel"><div class="panel-head"><h2>Dove va il tempo</h2></div><div class="pn-rows">${sr.map(g => `<div class="pn-row"><i style="background:${esc(g.color)}"></i><span class="grow">${esc(g.name)}</span><span>${fmtH(g.min)} · ${Math.round(g.min / tot * 100)}%</span><span class="pn-bar"><em style="width:${g.min / tot * 100}%;background:${esc(g.color)}"></em></span></div>`).join('') || '<div class="br-empty">Nessun impegno con orario.</div>'}</div></div>
      <div class="panel"><div class="panel-head"><h2>Concentrazione per attività</h2><button class="link" data-action="focus-start">Avvia</button></div><div class="pn-rows">${Object.entries(byProj).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="pn-row"><i style="background:var(--accent)"></i><span class="grow">${esc(k)}</span><span>${fmtH(v)}</span><span class="pn-bar"><em style="width:${v / fmin * 100}%"></em></span></div>`).join('') || '<div class="br-empty">Avvia un timer di concentrazione da un compito o con Ctrl+K.</div>'}</div></div>
      <div class="panel"><div class="panel-head"><h2>Compiti fatti per progetto</h2></div><div class="pn-rows">${Object.entries(byPj).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="pn-row"><i style="background:var(--green)"></i><span class="grow">${esc(k)}</span><span>${v}</span><span class="pn-bar"><em style="width:${v / done.length * 100}%;background:var(--green)"></em></span></div>`).join('') || '<div class="br-empty">Niente completato in questo periodo.</div>'}</div></div>
    </div>
    <div class="row" style="margin:26px 0 10px;align-items:baseline"><h2 class="grow" style="margin:0;font-size:20px;letter-spacing:-.02em">I tuoi pannelli</h2><button class="btn small" data-act-pn="new">${icon('i-plus')} Nuovo pannello</button></div>
    ${panels().length ? `<div class="st-grid">${panels().map(pn => panelHTML(pn, a, b)).join('')}</div>` : `<div class="empty"><b>Nessun pannello</b>Per esempio: ore e compenso delle ripetizioni, ore di lezione per classe, andamento dei carichi dal database degli allenamenti.</div>`}
  </div>`;
}

// ---------- editor dei pannelli ----------
async function modalPanel(pn) {
  const isNew = !pn;
  pn = pn ? JSON.parse(JSON.stringify(pn)) : { id: uid(), type: 'ore', title: '', groups: [], rates: {} };
  const groups = allGroups();
  const accs = await api.ndbAccounts();
  const draw = (m) => {
    const body = m.querySelector('#pn-body');
    if (pn.type === 'ore') {
      body.innerHTML = `<div class="field"><span>Calendari e gruppi da contare</span><div class="pn-pick">${groups.map(g => `<label class="pn-g"><input type="checkbox" value="${esc(g.key)}" ${pn.groups.includes(g.key) ? 'checked' : ''}><i style="background:${esc(g.color)}"></i><span class="grow">${esc(g.name)}<small>${esc(g.acc)}</small></span><input class="set-input pn-rate" data-key="${esc(g.key)}" type="number" min="0" step="1" placeholder="€/h" value="${pn.rates[g.key] || ''}"></label>`).join('') || '<span class="muted">Nessun impegno con orario.</span>'}</div><small class="muted">Facoltativo: la tariffa oraria per calcolare il compenso (es. ripetizioni da 60 e da 90 minuti).</small></div>
        <label class="field"><span>Come chiamarli</span><input name="unit" value="${esc(pn.unit || '')}" placeholder="incontri, lezioni, sedute…"></label>`;
    } else {
      body.innerHTML = accs.length ? `<label class="field"><span>Database Notion</span><select name="db"><option value="">Carico…</option></select></label><div id="pn-props"></div>` : '<div class="form-err">Collega prima un account Notion.</div>';
      if (accs.length) (async () => {
        pn.acc = pn.acc || accs[0].id;
        const r = await api.ndbList(pn.acc); const sel = body.querySelector('[name=db]');
        if (!r.ok) { sel.innerHTML = `<option>${esc(r.error)}</option>`; return; }
        sel.innerHTML = '<option value="">Scegli…</option>' + r.value.map(d => `<option value="${d.id}" ${d.id === pn.db ? 'selected' : ''}>${esc((d.icon ? d.icon + ' ' : '') + d.title)}</option>`).join('');
        const props = async () => {
          const box = body.querySelector('#pn-props'); pn.db = sel.value; if (!pn.db) { box.innerHTML = ''; return; }
          box.innerHTML = '<span class="muted">Carico le colonne…</span>';
          const s = await api.ndbSchema({ acc: pn.acc, db: pn.db }); if (!s.ok) { box.innerHTML = `<div class="form-err">${esc(s.error)}</div>`; return; }
          const of = (ts) => s.value.props.filter(p => ts.includes(p.type));
          const opt = (list, v, empty) => (empty ? `<option value="">${empty}</option>` : '') + list.map(p => `<option ${p.name === v ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
          if (!pn.title) m.querySelector('[name=title]').value = s.value.title;
          box.innerHTML = `<div class="field-row"><label class="field"><span>Data</span><select name="dateProp">${opt(of(['date', 'created_time']), pn.dateProp)}</select></label>
            <label class="field"><span>Valore da seguire</span><select name="numProp">${opt(of(['number', 'formula', 'rollup']), pn.numProp, 'Nessuno: conta le righe')}</select></label></div>
            <div class="field-row"><label class="field"><span>Una linea per</span><select name="groupProp">${opt(of(['title', 'select', 'status', 'multi_select', 'rich_text']), pn.groupProp, 'Tutto insieme')}</select></label>
            <label class="field"><span>Nello stesso giorno</span><select name="agg"><option value="max" ${pn.agg !== 'sum' ? 'selected' : ''}>Il massimo (es. carico)</option><option value="sum" ${pn.agg === 'sum' ? 'selected' : ''}>La somma (es. km, ripetizioni)</option></select></label></div>
            <label class="field"><span>Come chiamare le righe</span><input name="unit" value="${esc(pn.unit || '')}" placeholder="allenamenti, serie, lezioni…"></label>`;
        };
        sel.addEventListener('change', props); if (pn.db) props();
      })();
    }
  };
  openModal(`<h2>${isNew ? 'Nuovo pannello' : 'Modifica pannello'}</h2>
    <form class="form" data-submit="panel">
      <div class="segmented wide" id="pn-type">${[['ore', '⏱️ Ore e compenso dall’agenda'], ['notion', '📈 Andamento da Notion']].map(([k, l]) => `<button type="button" data-t="${k}" class="${pn.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="field-row"><label class="field"><span>Titolo</span><input name="title" required value="${esc(pn.title)}" placeholder="Es. Ripetizioni, Lezioni ISI, Allenamenti"></label><label class="field" style="max-width:110px"><span>Icona</span><input name="icon" value="${esc(pn.icon || '')}" placeholder="📚" maxlength="4"></label></div>
      <div id="pn-body"></div>
      <div class="modal-actions">${isNew ? '' : '<button type="button" class="btn danger" data-pn-del>Elimina</button><span class="grow"></span>'}<button type="button" class="btn" data-action="close-modal">Annulla</button><button class="btn-primary">${isNew ? 'Aggiungi' : 'Salva'}</button></div>
    </form>`, (m) => {
      m.classList.add('modal-panel');
      m.querySelector('#pn-type').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; pn.type = b.dataset.t; m.querySelectorAll('#pn-type button').forEach(x => x.classList.toggle('on', x === b)); draw(m); });
      m.querySelector('[data-pn-del]')?.addEventListener('click', () => { data.settings.panels = panels().filter(x => x.id !== pn.id); save(); closeModal(); render(); });
      m._pn = pn; draw(m);
    });
}
submits.panel = (f, fd) => {
  const m = $('#modal'), pn = m._pn;
  pn.title = fd.get('title').trim(); pn.icon = fd.get('icon').trim(); pn.unit = (fd.get('unit') || '').trim();
  if (pn.type === 'ore') {
    pn.groups = [...f.querySelectorAll('.pn-g input[type=checkbox]:checked')].map(i => i.value);
    pn.rates = {}; f.querySelectorAll('.pn-rate').forEach(i => { if (+i.value) pn.rates[i.dataset.key] = +i.value; });
    if (!pn.groups.length) return toast('Scegli almeno un calendario');
  } else {
    if (!fd.get('db')) return toast('Scegli un database');
    Object.assign(pn, { db: fd.get('db'), dateProp: fd.get('dateProp'), numProp: fd.get('numProp') || '', groupProp: fd.get('groupProp') || '', agg: fd.get('agg') });
    delete stUi.ndb[pn.db];
  }
  const list = panels(); const i = list.findIndex(x => x.id === pn.id);
  if (i >= 0) list[i] = pn; else list.push(pn);
  save(); closeModal(); render();
};

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-st-p],[data-st-off],[data-act-pn],[data-pn-sel]'); if (!t || ui.view !== 'statistiche') return;
  if (t.dataset.stP) { stUi.p = t.dataset.stP; stUi.off = 0; }
  if (t.dataset.stOff != null) stUi.off = +t.dataset.stOff === 0 ? 0 : stUi.off + +t.dataset.stOff;
  if (t.dataset.actPn === 'new') return modalPanel();
  if (t.dataset.actPn === 'edit') return modalPanel(panels().find(x => x.id === t.dataset.id));
  if (t.dataset.pnSel) { const pn = panels().find(x => x.id === t.dataset.pnSel); pn.sel = t.dataset.g || null; save(); }
  render();
});

EXTRA_NAV.push(['statistiche', 'i-chart', 'Statistiche', null]);
EXTRA_VIEWS.statistiche = { title: 'Statistiche', render: viewStats };
PALETTE_EXTRA.push({ t: 'Statistiche', i: 'i-chart', k: 'tempo ore compenso ripetizioni allenamenti', run: () => go('statistiche') });
if (data) render();
