/* Promemo — assistente IA che organizza la giornata con una serie di domande */
'use strict';

const AI_PROV = { none: 'Nessuno', anthropic: 'Claude (Anthropic)', ollama: 'Ollama sul computer', openai: 'Compatibile OpenAI' };
const AI_DEF = {
  anthropic: { model: 'claude-sonnet-5-5', models: [['claude-sonnet-5-5', 'Claude Sonnet 5.5 · consigliato'], ['claude-haiku-5-5', 'Claude Haiku 5.5 · più rapido ed economico'], ['claude-opus-5-5', 'Claude Opus 5.5 · più accurato']], baseUrl: '' },
  ollama: { model: 'llama3.1', models: [['llama3.1', 'Llama 3.1'], ['qwen2.5', 'Qwen 2.5'], ['mistral', 'Mistral'], ['gemma2', 'Gemma 2']], baseUrl: 'http://localhost:11434' },
  openai: { model: 'gpt-4o-mini', models: [], baseUrl: 'https://api.openai.com/v1' },
};
const aiCfg = () => ({ provider: 'none', ...(data.settings.ai || {}) });
const aiReady = () => aiCfg().provider !== 'none';
const aiModel = () => { const c = aiCfg(); return c.model || AI_DEF[c.provider]?.model || ''; };
const TIPI = {
  impegno: ['Impegno', '#8e8e93'], lavoro: ['Lavoro', '#0a84ff'], studio: ['Studio', '#7048e8'], passo: ['Da fare', '#2b8a3e'],
  pausa: ['Pausa', '#40c057'], pasto: ['Pasto', '#f08a24'], spostamento: ['Spostamento', '#868e96'], personale: ['Personale', '#e0569b'],
};

let ai = { day: null, msgs: [], busy: false, error: '', addedFor: null };

// ---------- contesto inviato al modello ----------
function hm(d) { return fmtHM(d); }
function aiContext(dayK) {
  const now = new Date();
  const day = parse(dayK);
  const isToday = sameDay(day, now);
  const lines = [];
  lines.push(`Adesso: ${now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ore ${hm(now)}.`);
  lines.push(`Giornata da pianificare: ${day.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} (${relDay(day).toLowerCase()}).${isToday ? ` Non pianificare nulla prima delle ${hm(now)}.` : ''}`);
  if (data.settings.userName) lines.push(`Nome dell'utente: ${data.settings.userName}.`);
  const its = itemsOn(day, { appuntamento: true, evento: true, passo: true }).filter(it => it.ev);
  const allDay = its.filter(it => it.ev.allDay || spanDays(it.ev) > 1);
  const timed = its.filter(it => !allDay.includes(it)).filter(it => !(it.ev.planDay === dayK));
  lines.push('\nImpegni già in calendario quel giorno:');
  if (!timed.length) lines.push('- nessuno');
  for (const it of timed) {
    const e = it.ev, g = groupInfo(e);
    lines.push(`- [id=${e.id}] ${hm(parse(e.start))}–${hm(parse(e.end || e.start))} ${e.title}${e.location ? ' · luogo: ' + e.location : ''} · calendario: ${g.name}${isReadOnly(e) || e.source ? ' · fisso' : ' · spostabile solo se l\'utente lo chiede'}`);
  }
  if (allDay.length) { lines.push('Eventi di tutto il giorno:'); for (const it of allDay) lines.push(`- ${it.ev.title}`); }
  // passi aperti: in ritardo, in scadenza entro 7 giorni, senza scadenza nei progetti preferiti
  const steps = [];
  for (const p of data.projects) {
    if (p.status !== 'attivo') continue;
    for (const st of p.steps) {
      if (st.done) continue;
      const due = st.due ? parse(st.due) : null;
      if (due && due > addDays(day, 7)) continue;
      if (!due && !p.starred) continue;
      steps.push({ p, st, due });
    }
  }
  steps.sort((a, b) => (a.due || addDays(day, 30)) - (b.due || addDays(day, 30)));
  lines.push('\nCose da fare (passi dei progetti):');
  if (!steps.length) lines.push('- nessuna');
  for (const { p, st, due } of steps.slice(0, 25)) {
    lines.push(`- [id=${st.id}] ${st.text} · progetto "${p.title}"${due ? ` · scadenza ${due.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })} ${hm(due)}${due < now ? ' (IN RITARDO)' : ''}` : ' · senza scadenza'}`);
  }
  const next = itemsOn(addDays(day, 1), { appuntamento: true, evento: false, passo: false }).slice(0, 4);
  if (next.length) { lines.push('\nIl giorno dopo (solo per contesto):'); for (const it of next) lines.push(`- ${hm(itemStart(it))} ${itemTitle(it)}`); }
  return lines.join('\n');
}

function aiSystem(dayK) {
  return `Sei l'assistente di pianificazione di Promemo, un'app di agenda personale. Parli italiano, con tono cordiale, diretto e conciso (al massimo 2 frasi per messaggio).
Obiettivo: costruire insieme all'utente un piano realistico a blocchi orari per la giornata indicata nel contesto.

Procedura:
1. Fai domande UNA alla volta, al massimo 4 in tutto, per capire: la priorità principale della giornata; quando l'utente rende meglio per il lavoro concentrato; vincoli (pasti, sport, spostamenti, ora in cui vuole finire); quanto vuole riempire la giornata. Per ogni domanda proponi da 2 a 5 risposte brevi in "opzioni" (massimo 5 parole ciascuna). Non chiedere ciò che l'utente ha già detto. Se l'utente chiede subito il piano, proponilo senza altre domande.
2. Poi proponi il piano nel campo "piano". Regole del piano:
   - includi gli impegni già in calendario con tipo "impegno", il loro "rif" (l'id) e gli orari esatti; non sovrapporre altri blocchi;
   - dai priorità ai passi IN RITARDO e alle scadenze vicine, collegandoli con "rif" uguale all'id del passo e tipo "passo";
   - blocchi di lavoro concentrato di 45–120 minuti, con pause di 10–20 minuti tra blocchi lunghi; inserisci i pasti se la giornata li attraversa e gli spostamenti quando cambia il luogo;
   - orari in formato HH:MM, multipli di 15 minuti, in ordine; non inventare impegni fissi che non esistono;
   - lascia un po' di margine: non riempire ogni minuto.
3. Dopo il piano l'utente può chiedere modifiche: rispondi con il piano aggiornato e completo.

Rispondi SEMPRE e SOLO con un oggetto JSON valido, senza testo prima o dopo, con questa forma:
{"messaggio": "testo per l'utente", "opzioni": ["risposta breve", "..."], "piano": null}
oppure, quando proponi il piano:
{"messaggio": "breve commento", "opzioni": ["Va bene così", "Più pause", "Finisci prima"], "piano": {"titolo": "titolo breve", "blocchi": [{"inizio": "09:00", "fine": "10:30", "titolo": "…", "tipo": "impegno|lavoro|studio|passo|pausa|pasto|spostamento|personale", "rif": "id oppure null", "nota": "facoltativa"}], "consigli": ["massimo 3 consigli brevi"]}}

CONTESTO
${aiContext(dayK)}`;
}

function parseAI(text) {
  let j = null;
  const t = String(text || '').trim();
  try { j = JSON.parse(t); } catch {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { j = JSON.parse(t.slice(a, b + 1)); } catch { j = null; } }
  }
  if (!j || typeof j !== 'object') return { messaggio: t || '…', opzioni: [], piano: null };
  const okT = (x) => /^\d{1,2}:\d{2}$/.test(String(x || ''));
  let piano = j.piano && Array.isArray(j.piano.blocchi) ? {
    titolo: String(j.piano.titolo || 'Piano della giornata'),
    blocchi: j.piano.blocchi.filter(b => okT(b.inizio) && okT(b.fine)).map(b => ({ inizio: b.inizio.padStart(5, '0'), fine: b.fine.padStart(5, '0'), titolo: String(b.titolo || '').slice(0, 120), tipo: TIPI[b.tipo] ? b.tipo : 'lavoro', rif: b.rif && b.rif !== 'null' ? String(b.rif) : null, nota: b.nota ? String(b.nota).slice(0, 200) : '' }))
      .filter(b => b.fine > b.inizio).sort((a, b) => a.inizio.localeCompare(b.inizio)),
    consigli: Array.isArray(j.piano.consigli) ? j.piano.consigli.slice(0, 3).map(String) : [],
  } : null;
  if (piano && !piano.blocchi.length) piano = null;
  return { messaggio: String(j.messaggio || j.message || ''), opzioni: Array.isArray(j.opzioni) ? j.opzioni.slice(0, 5).map(String) : [], piano };
}

// ---------- conversazione ----------
async function aiSend(text) {
  if (ai.busy || !text.trim()) return;
  ai.error = '';
  ai.msgs.push({ role: 'user', content: text.trim() });
  ai.busy = true; drawAI();
  const r = await api.aiChat({ system: aiSystem(ai.day), messages: ai.msgs.map(m => ({ role: m.role, content: m.content })) });
  ai.busy = false;
  if (!r.ok) { ai.error = r.error; ai.msgs.pop(); ai.retry = text; drawAI(); return; }
  ai.msgs.push({ role: 'assistant', content: r.text, view: parseAI(r.text) });
  drawAI();
}

function aiStart(dayK, intent) {
  if (!aiReady()) { modalSettings('assistente'); return; }
  const day = parse(dayK);
  ai = { day: dayK, msgs: [], busy: false, error: '', addedFor: null };
  openAI();
  aiSend(intent || `Aiutami a organizzare ${sameDay(day, new Date()) ? 'il resto di oggi' : relDay(day).toLowerCase() === 'domani' ? 'la giornata di domani' : 'la giornata di ' + fmtLong(day)}.`);
}

function openAI() {
  const d = $('#ai-drawer');
  d.hidden = false; d.classList.remove('closing');
  if (!ai.day) { const n = new Date(); ai.day = dayKey(n.getHours() >= 19 ? addDays(n, 1) : n); }
  drawAI();
  setTimeout(() => d.querySelector('#ai-in')?.focus(), 80);
}
function closeAI() {
  const d = $('#ai-drawer'); if (d.hidden) return;
  d.classList.add('closing');
  setTimeout(() => { d.hidden = true; d.classList.remove('closing'); }, 220);
}

function blockColor(b) {
  if (b.rif) {
    const ev = data.events.find(e => e.id === b.rif);
    if (ev) return groupInfo(ev).color;
    for (const p of data.projects) if (p.steps.some(s => s.id === b.rif)) return localGroup(p).color;
  }
  return TIPI[b.tipo][1];
}

function planHTML(piano, idx) {
  const dk = ai.day;
  const added = ai.addedFor === idx;
  const existingPlan = data.events.some(e => e.planDay === dk);
  return `<div class="ai-plan">
    <div class="ai-plan-head"><b>${esc(piano.titolo)}</b><span>${esc(fmtLong(parse(dk)))}</span></div>
    <div class="ai-blocks">${piano.blocchi.map(b => `
      <div class="ai-blk ${b.tipo === 'impegno' ? 'fixed' : ''}" style="--gc:${esc(blockColor(b))}">
        <div class="ai-blk-t"><b>${b.inizio}</b><span>${b.fine}</span></div>
        <div class="ai-blk-b"><div class="ai-blk-title">${b.tipo === 'impegno' ? icon('i-lock') : ''}${esc(b.titolo)}</div>${b.nota ? `<div class="ai-blk-note">${esc(b.nota)}</div>` : ''}</div>
        <span class="ai-tag">${TIPI[b.tipo][0]}</span>
      </div>`).join('')}</div>
    ${piano.consigli.length ? `<ul class="ai-tips">${piano.consigli.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <div class="ai-plan-act">
      ${added ? `<span class="ai-ok">${icon('i-check')} Aggiunto all'agenda</span><button class="btn small" data-ai="remove">Rimuovi</button>`
               : `<button class="btn-primary small-p" data-ai="add" data-idx="${idx}">${icon('i-calendar')} ${existingPlan ? 'Sostituisci il piano in agenda' : 'Aggiungi all\'agenda'}</button>`}
      <button class="btn small" data-ai="goto">Vedi in agenda</button>
    </div>
  </div>`;
}

function drawAI() {
  const d = $('#ai-drawer'); if (d.hidden) return;
  const c = aiCfg();
  const lastA = [...ai.msgs].reverse().find(m => m.role === 'assistant');
  const day = parse(ai.day);
  const body = ai.msgs.map((m, i) => {
    if (m.role === 'user') return `<div class="ai-msg me">${esc(m.content)}</div>`;
    const v = m.view;
    return `<div class="ai-msg bot">${v.messaggio ? `<div>${esc(v.messaggio)}</div>` : ''}${v.piano ? planHTML(v.piano, i) : ''}</div>`;
  }).join('');
  const intro = !ai.msgs.length ? `<div class="ai-empty">${icon('i-spark')}<b>Organizziamo ${sameDay(day, new Date()) ? 'la tua giornata' : 'la giornata di ' + relDay(day).toLowerCase()}</b><span>Ti farò qualche domanda e poi ti propongo un piano a blocchi con i tuoi impegni, le cose da fare e le pause.</span>
      <div class="ai-start"><button class="btn-primary" data-ai="start">Iniziamo</button><button class="btn" data-ai="direct">Proponi subito un piano</button></div></div>` : '';
  const remote = c.provider === 'anthropic' || c.provider === 'openai';
  d.innerHTML = `
    <div class="ai-head">
      <span class="ai-logo">${icon('i-spark')}</span>
      <div class="grow"><b>Assistente</b><small>${esc(AI_PROV[c.provider] || '')}${aiModel() ? ' · ' + esc(aiModel()) : ''}</small></div>
      <div class="segmented ai-day">${[[dayKey(new Date()), 'Oggi'], [dayKey(addDays(new Date(), 1)), 'Domani']].map(([k, l]) => `<button class="${ai.day === k ? 'on' : ''}" data-ai="day" data-k="${k}">${l}</button>`).join('')}</div>
      <button class="icon-btn" data-ai="reset" title="Ricomincia">${icon('i-refresh')}</button>
      <button class="icon-btn" data-ai="close" title="Chiudi (Esc)">${icon('i-close')}</button>
    </div>
    <div class="ai-body" id="ai-body">
      ${remote ? `<div class="ai-privacy">${icon('i-lock')} Per creare il piano, gli impegni e i passi del giorno vengono inviati a ${c.provider === 'anthropic' ? 'Anthropic' : 'il servizio configurato'}.</div>` : ''}
      ${intro}${body}
      ${ai.busy ? '<div class="ai-msg bot typing"><i></i><i></i><i></i></div>' : ''}
      ${ai.error ? `<div class="ai-err">${esc(ai.error)} <button class="link" data-ai="retry">Riprova</button> · <button class="link" data-ai="settings">Impostazioni</button></div>` : ''}
    </div>
    ${lastA && lastA.view.opzioni.length && !ai.busy ? `<div class="ai-opts">${lastA.view.opzioni.map(o => `<button class="ai-chip" data-ai="opt">${esc(o)}</button>`).join('')}</div>` : ''}
    <form class="ai-input" id="ai-form"><input id="ai-in" placeholder="${ai.msgs.length ? 'Rispondi o chiedi una modifica…' : 'Scrivi cosa vuoi fare oggi…'}" autocomplete="off" ${ai.busy ? 'disabled' : ''}><button class="ai-send" ${ai.busy ? 'disabled' : ''} title="Invia">${icon('i-send')}</button></form>`;
  const b = d.querySelector('#ai-body'); b.scrollTop = b.scrollHeight;
  if (!ai.busy) d.querySelector('#ai-in').focus();
}

function aiAddPlan(idx) {
  const m = ai.msgs[idx]; if (!m || !m.view.piano) return;
  const dk = ai.day;
  data.events = data.events.filter(e => e.planDay !== dk);
  const rem = data.settings.ai?.reminder ?? 5;
  let n = 0;
  for (const b of m.view.piano.blocchi) {
    if (b.tipo === 'impegno' || (b.rif && data.events.some(e => e.id === b.rif))) continue;
    let projectId = '';
    if (b.rif) for (const p of data.projects) if (p.steps.some(s => s.id === b.rif)) projectId = p.id;
    data.events.push({ id: uid(), title: b.titolo, kind: 'appuntamento', projectId, allDay: false, location: '', reminder: rem === '' ? null : rem,
      start: `${dk}T${b.inizio}`, end: `${dk}T${b.fine}`, notes: (b.nota ? b.nota + '\n' : '') + 'Creato dall\'assistente di Promemo', planDay: dk, planType: b.tipo });
    n++;
  }
  ai.addedFor = idx;
  save(); render(); drawAI();
  toast(`${n} blocchi aggiunti all'agenda`);
}

$('#ai-drawer').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ai]'); if (!b) return;
  const a = b.dataset.ai;
  if (a === 'close') closeAI();
  if (a === 'reset') { ai.msgs = []; ai.error = ''; ai.addedFor = null; drawAI(); }
  if (a === 'day') { ai.day = b.dataset.k; ai.msgs = []; ai.error = ''; ai.addedFor = null; drawAI(); }
  if (a === 'start') aiStart(ai.day);
  if (a === 'direct') aiStart(ai.day, 'Proponi subito un piano per la giornata, senza domande: usa buon senso.');
  if (a === 'opt') aiSend(b.textContent);
  if (a === 'retry' && ai.retry) { const t = ai.retry; ai.retry = null; aiSend(t); }
  if (a === 'settings') { closeAI(); modalSettings('assistente'); }
  if (a === 'add') aiAddPlan(+b.dataset.idx);
  if (a === 'remove') { data.events = data.events.filter(x => x.planDay !== ai.day); ai.addedFor = null; save(); render(); drawAI(); toast('Piano rimosso dall\'agenda'); }
  if (a === 'goto') { const d = parse(ai.day); closeAI(); go('agenda', { sel: ai.day, month: new Date(d.getFullYear(), d.getMonth(), 1), calMode: 'giorno' }); }
});
$('#ai-drawer').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#ai-in'); const t = inp.value; inp.value = '';
  if (!ai.msgs.length && !ai.busy) { aiStart(ai.day, t); return; }
  aiSend(t);
});
document.addEventListener('keydown', (e) => {
  if (!data) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); $('#ai-drawer').hidden ? openAI() : closeAI(); }
  if (e.key === 'Escape' && !$('#ai-drawer').hidden && $('#modal-backdrop').hidden) closeAI();
});
$('#btn-ai').addEventListener('click', () => { if (!aiReady()) return modalSettings('assistente'); $('#ai-drawer').hidden ? openAI() : closeAI(); });

// ---------- riquadro nella Home ----------
function aiHomeCard() {
  const now = new Date();
  const late = now.getHours() >= 18;
  const planned = data.events.some(e => e.planDay === dayKey(now));
  return `<section class="ai-card">
    <div class="ai-card-ic">${icon('i-spark')}</div>
    <div class="ai-card-txt"><b>${planned ? 'Il piano di oggi è in agenda' : 'Organizza la giornata con l\'assistente'}</b>
      <span>${aiReady() ? 'Rispondi a qualche domanda: preparo un piano a blocchi con impegni, cose da fare e pause, da aggiungere all\'agenda con un clic.' : 'Collega un motore di intelligenza artificiale (Claude, oppure Ollama gratis sul tuo computer) per farti aiutare a pianificare.'}</span></div>
    <div class="ai-card-act">${aiReady()
      ? `<button class="${late ? 'btn' : 'btn-primary'}" data-action="ai-start" data-day="${dayKey(now)}">${planned ? 'Rivedi oggi' : 'Organizza oggi'}</button><button class="${late ? 'btn-primary' : 'btn'}" data-action="ai-start" data-day="${dayKey(addDays(now, 1))}">Domani</button>`
      : '<button class="btn-primary" data-action="ai-setup">Configura</button>'}</div>
  </section>`;
}
Object.assign(actions, {
  'ai-start': (el) => aiStart(el.dataset.day),
  'ai-setup': () => modalSettings('assistente'),
});

// ---------- sezione delle impostazioni ----------
SET_PANES.splice(5, 0, ['assistente', 'i-spark', 'Assistente']);
const _paneHTML = paneHTML;
paneHTML = function (id, ls) {
  if (id !== 'assistente') return _paneHTML(id, ls);
  const c = aiCfg(), d = AI_DEF[c.provider] || {};
  const model = c.model || d.model || '';
  const keyRow = (c.provider === 'anthropic' || c.provider === 'openai') ? srow('Chiave API', `<span id="ai-key-st">…</span>${c.provider === 'anthropic' ? ' · creala su console.anthropic.com → API Keys' : ''}`, `<input class="set-input" type="password" id="ai-key" placeholder="${c.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}" autocomplete="off"><button class="btn small" data-aiset="savekey">Salva</button>`) : '';
  return `<h3>Assistente</h3>
    <p class="set-note" style="margin:-6px 0 14px">L'assistente della Home ti fa qualche domanda e prepara un piano a blocchi per la giornata, partendo dai tuoi impegni e dalle cose da fare.</p>
    <div class="set-group">
      ${srow('Motore', '', `<select class="set-select" id="ai-prov">${Object.entries(AI_PROV).map(([k, l]) => `<option value="${k}" ${c.provider === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${c.provider !== 'none' ? srow('Modello', c.provider === 'ollama' ? 'Il nome del modello scaricato con <code>ollama pull</code>' : '', d.models && d.models.length && c.provider === 'anthropic'
        ? `<select class="set-select" id="ai-model">${d.models.map(([k, l]) => `<option value="${k}" ${model === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`
        : `<input class="set-input" id="ai-model" value="${esc(model)}" list="ai-models"><datalist id="ai-models">${(d.models || []).map(([k]) => `<option value="${k}">`).join('')}</datalist>`) : ''}
      ${c.provider === 'ollama' || c.provider === 'openai' ? srow('Indirizzo', '', `<input class="set-input" id="ai-base" value="${esc(c.baseUrl || d.baseUrl)}">`) : ''}
      ${keyRow}
      ${c.provider !== 'none' ? srow('Promemoria sui blocchi aggiunti', '', `<select class="set-select" id="ai-rem">${[['', 'Nessuno'], [0, 'All\'orario'], [5, '5 minuti prima'], [10, '10 minuti prima'], [15, '15 minuti prima']].map(([v, l]) => `<option value="${v}" ${String(c.reminder ?? 5) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`) : ''}
      ${c.provider !== 'none' ? srow('Prova', '<span id="ai-test-st">Verifica che il motore risponda</span>', '<button class="btn small" data-aiset="test">Prova connessione</button>') : ''}
    </div>
    ${c.provider === 'anthropic' ? '<p class="set-note">Con Claude il servizio è a consumo sul tuo account Anthropic: una pianificazione costa in genere qualche centesimo. Gli impegni e i passi del giorno pianificato vengono inviati ad Anthropic; la chiave resta cifrata su questo computer.</p>' : ''}
    ${c.provider === 'ollama' ? '<p class="set-note">Ollama fa girare il modello sul tuo PC: gratis e senza inviare nulla in rete. Installalo da ollama.com, poi in un terminale: <code>ollama pull llama3.1</code>. Servono circa 8 GB di RAM; con modelli piccoli il piano è meno preciso.</p>' : ''}
    ${c.provider === 'openai' ? '<p class="set-note">Funziona con qualsiasi servizio che usa l\'interfaccia <code>/chat/completions</code> (OpenAI, LM Studio, Groq, OpenRouter…).</p>' : ''}`;
};
const _drawPane = drawPane;
drawPane = function (m) {
  _drawPane(m);
  if (setPane !== 'assistente') return;
  const box = m.querySelector('#set-pane');
  const s = data.settings;
  const set = (patch, redraw) => { s.ai = { ...aiCfg(), ...patch }; save(); render(); if (redraw) drawPane(m); };
  box.querySelector('#ai-prov').addEventListener('change', (e) => { const p = e.target.value; set({ provider: p, model: AI_DEF[p]?.model || '', baseUrl: AI_DEF[p]?.baseUrl || '' }, true); });
  box.querySelector('#ai-model')?.addEventListener('change', (e) => set({ model: e.target.value.trim() }));
  box.querySelector('#ai-base')?.addEventListener('change', (e) => set({ baseUrl: e.target.value.trim() }));
  box.querySelector('#ai-rem')?.addEventListener('change', (e) => set({ reminder: e.target.value === '' ? '' : +e.target.value }));
  const st = box.querySelector('#ai-key-st');
  if (st) api.aiHasKey(aiCfg().provider).then(h => { st.textContent = h ? 'Salvata ✓' : 'Non impostata'; });
  box.querySelectorAll('[data-aiset]').forEach(b => b.addEventListener('click', async () => {
    if (b.dataset.aiset === 'savekey') {
      const k = box.querySelector('#ai-key').value.trim();
      await api.aiKey({ provider: aiCfg().provider, key: k });
      box.querySelector('#ai-key').value = '';
      st.textContent = k ? 'Salvata ✓' : 'Rimossa';
      toast(k ? 'Chiave salvata' : 'Chiave rimossa');
    }
    if (b.dataset.aiset === 'test') {
      const out = box.querySelector('#ai-test-st');
      out.textContent = 'Attendo la risposta…'; b.disabled = true;
      const r = await api.aiChat({ system: 'Rispondi solo con JSON {"messaggio": "..."}.', messages: [{ role: 'user', content: 'Saluta in italiano in 5 parole.' }] });
      b.disabled = false;
      out.textContent = r.ok ? '✓ ' + (parseAI(r.text).messaggio || 'Il motore risponde') : '✕ ' + r.error;
      out.style.color = r.ok ? 'var(--green)' : '#e0352b';
    }
  }));
};

// la Home potrebbe essere già stata disegnata prima del caricamento di questo file
if (typeof data !== 'undefined' && data) render();
