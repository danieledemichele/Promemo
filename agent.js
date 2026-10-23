// Promemo — assistente proattivo: ogni tot ore (e dopo ogni sincronizzazione) legge agenda, compiti, viaggi e
// spostamenti, nota cosa conta, propone azioni e, se c'è un motore IA, scrive il piano della giornata. Senza che glielo chieda nessuno.
'use strict';
const Rules = require('./src/agentrules.js');
const Recur = require('./src/recur.js');
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function createAgent(ctx) {
  // ctx: data(), commit(), notify(t, b, route), log, ai(system, messages, opts) → testo | null, quickAdd(text)
  const cfg = () => ({ enabled: true, every: 2, ai: true, notify: true, quietFrom: 22, quietTo: 7, maxNotif: 6, ...(ctx.data().settings.agent || {}) });
  const st = () => { const d = ctx.data(); d.agent = d.agent || { feed: [], dismissed: {}, notified: {} }; d.agent.feed = d.agent.feed || []; d.agent.dismissed = d.agent.dismissed || {}; d.agent.notified = d.agent.notified || {}; return d.agent; };
  let running = false, lastRun = 0;

  function context() {
    const d = ctx.data();
    const hidden = new Set(d.settings.hiddenLocal || []);
    const visible = (e) => {
      if (e.tripRef) return !hidden.has('__trips');
      if (!e.source) return true;
      const a = d.accounts.find(x => x.id === e.source.acc); if (!a || !a.enabled) return false;
      const g = (a.groups || []).find(x => x.id === e.source.group); return !g || g.visible !== false;
    };
    return { students: d.students || {}, events: d.events, projects: d.projects, travel: (d.settings.travel || {}).enabled ? d.travel : {}, trips: Object.values(d.trips || {}), accounts: d.accounts, planner: { start: 9, end: 19, ...(d.settings.planner || {}) }, hidden: (e) => !visible(e) };
  }

  // il piano della giornata scritto dall'IA (solo se il contesto è cambiato o è passato abbastanza tempo)
  async function aiPlan(force) {
    const c = cfg(), a = st(), d = ctx.data();
    if (!c.ai || !d.settings.ai || !d.settings.ai.provider || d.settings.ai.provider === 'none') return null;
    const now = new Date(), day0 = new Date(now); day0.setHours(0, 0, 0, 0);
    const evs = Recur.expand(d.events, day0, new Date(day0.getTime() + 2 * 864e5)).filter(e => e.start && e.start >= iso(day0) && e.start < iso(new Date(day0.getTime() + 2 * 864e5)))
      .sort((x, y) => x.start.localeCompare(y.start)).slice(0, 40).map(e => `- ${e.start.replace('T', ' ')}${e.allDay ? ' (tutto il giorno)' : '–' + (e.end || '').slice(11, 16)} · ${e.title}${e.location ? ' · ' + e.location : ''}`);
    const steps = d.projects.filter(p => p.status !== 'archiviato').flatMap(p => p.steps.filter(s => !s.done).map(s => ({ p, s })))
      .sort((x, y) => (x.s.deadline || x.s.due || '9').localeCompare(y.s.deadline || y.s.due || '9')).slice(0, 30)
      .map(({ p, s }) => `- [id=${s.id}] ${s.text} · progetto ${p.title}${s.due ? ' · quando ' + s.due.replace('T', ' ') : ''}${s.deadline ? ' · entro ' + s.deadline.replace('T', ' ') : ''}${s.priority ? ' · priorità ' + s.priority : ''} · ${s.duration || 30} min`);
    const facts = (a.insights || []).map(i => `- ${i.title}: ${i.text}`);
    const key = require('crypto').createHash('sha1').update(evs.join('\n') + steps.join('\n') + facts.join('\n') + now.toISOString().slice(0, 13)).digest('hex');
    if (!force && a.aiKey === key) return a.ai;
    const sys = `Sei l'assistente personale di ${d.settings.userName || "una persona"} dentro Promemo. Parli in italiano, in modo breve, concreto e gentile. Non inventi impegni: usi solo i dati forniti. Rispondi SOLO con un oggetto JSON valido.`;
    const user = `Adesso è ${now.toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.
Impegni di oggi e domani:
${evs.join('\n') || '(nessuno)'}
Compiti aperti:
${steps.join('\n') || '(nessuno)'}
Cose già notate:
${facts.join('\n') || '(niente)'}

Restituisci: {"riepilogo": "2-3 frasi su come va la giornata e su cosa concentrarsi", "suggerimenti": [{"titolo": "massimo 8 parole", "motivo": "una frase", "azione": {"tipo": "pianifica" | "sposta_a_domani" | "crea_compito" | "nessuna", "id": "id del compito se serve", "testo": "per crea_compito: una frase con data e ora, es. 'preparare la presentazione domani alle 10 per un'ora'"}}]}
Massimo 3 suggerimenti, utili e non ovvi; niente che ripeta le cose già notate.`;
    try {
      const txt = await ctx.ai(sys, [{ role: 'user', content: user }], { maxTokens: 900 });
      if (!txt) return null;
      const s = String(txt).replace(/```(?:json)?/g, ''), j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
      const out = { at: now.toISOString(), summary: String(j.riepilogo || ''), tips: (j.suggerimenti || []).slice(0, 3).map((x, i) => {
        const az = x.azione || {}; const actions = [];
        const sid = az.id && d.projects.find(p => p.steps.some(q => q.id === az.id));
        if (az.tipo === 'pianifica' && sid) actions.push({ label: 'Trova io il tempo', op: 'steps-auto', args: { ids: [[sid.id, az.id]] } });
        if (az.tipo === 'sposta_a_domani' && sid) actions.push({ label: 'Sposta a domani', op: 'steps-tomorrow', args: { ids: [[sid.id, az.id]] } });
        if (az.tipo === 'crea_compito' && az.testo) actions.push({ label: 'Aggiungi', op: 'quick', args: { text: String(az.testo) } });
        return { id: `ia:${key.slice(0, 8)}:${i}`, kind: 'ia', level: 'info', title: String(x.titolo || 'Suggerimento'), text: String(x.motivo || ''), actions, ai: true };
      }) };
      a.ai = out; a.aiKey = key;
      return out;
    } catch (e) { ctx.log.warn('assistente', 'piano IA: ' + e.message); return a.ai || null; }
  }

  // impegni trovati nella posta → suggerimenti (se non sono già in agenda)
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9à-ù]+/g, ' ').trim();
  function mailInsights() {
    const d = ctx.data(), m = d.agent && d.agent.mail; if (!m || !m.found) return [];
    const evs = d.events;
    const same = (f) => evs.find(e => e.start && e.start.slice(0, 10) === f.start.slice(0, 10) && (norm(e.title) === norm(f.title) || norm(e.title).includes(norm(f.title)) || norm(f.title).includes(norm(e.title)) || (!f.allDay && !e.allDay && e.start.slice(0, 16) === f.start.slice(0, 16))));
    const steps = d.projects.flatMap(p => p.steps);
    const fmt = (f) => { const dd = new Date(f.start); return dd.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) + (f.allDay ? '' : ' alle ' + f.start.slice(11, 16)); };
    const out = [];
    for (const f of m.found) {
      if (f.added) continue;
      if (f.kind === 'annullato') {
        const e = same(f); if (!e) continue;
        out.push({ id: f.id, kind: 'posta', level: 'alta', title: `Annullato: ${e.title}`, text: `${fmt(f)} · ${f.from} ha annullato l’invito.`, actions: [{ label: 'Apri l’evento', op: 'open-ev', args: { id: e.id, date: e.start.slice(0, 10) } }, { label: 'Apri la mail', op: 'open-url', args: { url: f.link } }] });
        continue;
      }
      if (same(f) || steps.some(x => norm(x.text) === norm(f.title))) continue;
      out.push({ id: f.id, kind: 'posta', level: f.kind === 'scadenza' || new Date(f.start) - Date.now() < 2 * 864e5 ? 'media' : 'info', title: `${f.kind === 'scadenza' ? 'Scadenza' : 'Nella posta'}: ${f.title}`, text: `${fmt(f)}${f.location ? ' · ' + f.location : ''} · da ${f.from}, “${f.subject}”.`,
        actions: [{ label: f.kind === 'scadenza' ? 'Aggiungi il compito' : 'Aggiungi in agenda', op: 'mail-add', args: { id: f.id, ev: { kind: f.kind, title: f.title, start: f.start, end: f.end, allDay: f.allDay, location: f.location, note: `Dalla mail di ${f.from}: “${f.subject}”\n${f.link}` } } }, { label: 'Apri la mail', op: 'open-url', args: { url: f.link } }] });
    }
    return out.slice(0, 6);
  }

  function quiet(c) { const h = new Date().getHours(); return c.quietFrom > c.quietTo ? (h >= c.quietFrom || h < c.quietTo) : (h >= c.quietFrom && h < c.quietTo); }

  async function run(reason = 'periodico', { force = false } = {}) {
    const c = cfg();
    if (!ctx.data() || !c.enabled || running) return null;
    running = true; lastRun = Date.now();
    const a = st(); a.running = true; a.reason = reason; ctx.commit();
    try {
      if (ctx.mail && c.mail !== false) { try { await ctx.mail.scan(reason === 'richiesta'); } catch (e) { ctx.log.warn('assistente', 'posta: ' + e.message); } }
      const r = Rules.analyze(context());
      r.insights = mailInsights().concat(r.insights);
      const now = new Date().toISOString();
      const fresh = r.insights.filter(i => !a.dismissed[i.id]);
      // registro di ciò che ho notato (una voce per novità)
      const known = new Set(a.feed.map(f => f.id));
      for (const i of fresh) if (!known.has(i.id)) a.feed.push({ id: i.id, at: now, kind: i.kind, level: i.level, title: i.title, text: i.text });
      a.feed = a.feed.slice(-120);
      Object.assign(a, { at: now, summary: r.summary, insights: fresh });
      const ai = await aiPlan(force);
      if (ai) { a.aiSummary = ai.summary; a.tips = ai.tips.filter(t => !a.dismissed[t.id]); } else { a.tips = a.tips || []; }
      // avviso solo per le cose importanti e nuove, fuori dalle ore di silenzio
      const day = now.slice(0, 10);
      const sent = Object.values(a.notified).filter(x => String(x).slice(0, 10) === day).length;
      if (c.notify && !quiet(c)) {
        let n = sent;
        for (const i of fresh.filter(x => x.level === 'alta' && !a.notified[x.id])) {
          if (n >= c.maxNotif) break;
          ctx.notify(`Promemo · ${i.title}`, i.text, { action: 'agent' }); a.notified[i.id] = now; n++;
        }
      }
      for (const [k, v] of Object.entries(a.notified)) if (Date.now() - new Date(v) > 3 * 864e5) delete a.notified[k];
      for (const [k, v] of Object.entries(a.dismissed)) if (Date.now() - new Date(v) > 14 * 864e5) delete a.dismissed[k];
      return a;
    } catch (e) { ctx.log.error('assistente', 'analisi non riuscita', e); return null; }
    finally { const b = st(); b.running = false; running = false; ctx.commit(); }
  }

  // le azioni proposte, eseguite qui così arrivano anche al telefono
  function findStep(pid, sid) { const p = ctx.data().projects.find(x => x.id === pid); return [p, p && p.steps.find(s => s.id === sid)]; }
  async function act(op, args = {}, id) {
    const d = ctx.data(), now = new Date(), a = st();
    const touch = (p) => { p.updatedAt = iso(now); };
    let msg = '';
    if (op === 'dismiss') { a.dismissed[id] = now.toISOString(); a.insights = (a.insights || []).filter(i => i.id !== id); a.tips = (a.tips || []).filter(i => i.id !== id); ctx.commit(); return 'Nascosto'; }
    if (op === 'reset-dismissed') { a.dismissed = {}; ctx.commit(); setTimeout(() => run('ripristino'), 200); return 'Fatto'; }
    if (op === 'steps-today' || op === 'steps-tomorrow') {
      let n = 0;
      for (const [pid, sid] of args.ids || []) {
        const [p, s] = findStep(pid, sid); if (!s) continue;
        const t = new Date(now); if (op === 'steps-tomorrow') t.setDate(t.getDate() + 1);
        const old = s.due ? new Date(s.due) : null;
        t.setHours(old ? old.getHours() : 9, old ? old.getMinutes() : 0, 0, 0);
        if (op === 'steps-today' && t < now) { t.setTime(now.getTime() + 3600000); t.setMinutes(0); }
        if (s.auto) { delete s.autoDue; s.due = null; s.notBefore = op === 'steps-tomorrow' ? iso(new Date(new Date(now).setHours(24, 0, 0, 0))) : undefined; } else s.due = iso(t);
        delete s.notifiedAt; touch(p); n++;
      }
      msg = `${n} ${n === 1 ? 'compito spostato' : 'compiti spostati'} a ${op === 'steps-today' ? 'oggi' : 'domani'}`;
    }
    if (op === 'steps-auto') {
      let n = 0;
      for (const [pid, sid] of args.ids || []) { const [p, s] = findStep(pid, sid); if (!s) continue; s.auto = true; s.deadline = s.deadline || iso(new Date(now.getTime() + 3 * 864e5)).slice(0, 10) + 'T23:59'; delete s.autoDue; s.due = null; touch(p); n++; }
      msg = `Pianifico ${n} ${n === 1 ? 'compito' : 'compiti'} negli spazi liberi`;
    }
    if (op === 'step-at') { const [p, s] = findStep(args.pid, args.sid); if (s) { s.due = args.start; if (s.auto) s.autoDue = args.start + '!'; delete s.notifiedAt; touch(p); msg = `“${s.text}” alle ${args.start.slice(11, 16)}`; } }
    if (op === 'study-more') {
      const p = d.projects.find(x => x.id === args.id);
      if (p && p.study) { p.study.maxDay = Math.min(360, (+p.study.maxDay || 120) + 30); for (const s of p.steps) if (s.study && !s.done && s.auto && !(s.autoDue && s.due && s.due !== s.autoDue)) { s.due = null; delete s.autoDue; } touch(p); msg = `Fino a ${String(p.study.maxDay / 60).replace('.', ',')} ore al giorno: ripianifico le sessioni`; }
    }
    if (op === 'step-done') { const [p, s] = findStep(args.pid, args.sid); if (s) { s.done = true; s.doneAt = iso(now); touch(p); msg = 'Fatto'; } }
    if (op === 'mail-add') {
      const f = args.ev || {}, m = d.agent.mail;
      const qrev = (d.rev || 0) + 1, uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      if (f.kind === 'scadenza') {
        let p = d.projects.find(x => x.inbox && x.status !== 'archiviato');
        if (!p) { p = { qrev, id: 'p-' + uid(), title: 'Da fare', category: '', description: 'Compiti aggiunti al volo', starred: false, status: 'attivo', createdAt: iso(now), updatedAt: iso(now), steps: [], traces: [], inbox: true }; d.projects.push(p); }
        p.steps.push({ qrev, id: 's-' + uid(), text: f.title, due: null, auto: true, deadline: f.allDay ? f.start.slice(0, 10) + 'T18:00' : f.start, duration: 60, done: false, notes: f.note || '', reminder: null });
        touch(p); msg = `Compito aggiunto: ${f.title} (entro ${f.start.slice(8, 10)}/${f.start.slice(5, 7)})`;
      } else {
        const e = { qrev, id: 'e-' + uid(), title: f.title, kind: 'appuntamento', projectId: '', allDay: !!f.allDay, start: f.start, end: f.end || f.start, location: f.location || '', reminder: f.allDay ? null : 30, notes: f.note || '' };
        const dc = d.settings.defaultCalendar;
        if (dc) { const [acc, ...cc] = dc.split('|'); const a = d.accounts.find(x => x.id === acc && x.enabled); if (a) e.pushTo = { acc, cal: cc.join('|') }; }
        d.events.push(e); if (e.pushTo && ctx.push) ctx.push();
        msg = `In agenda: ${f.title}`;
      }
      if (m) { const x = (m.found || []).find(y => y.id === args.id); if (x) x.added = true; }
    }
    if (op === 'quick') { const r = ctx.quickAdd(args.text); msg = `Aggiunto: ${r.title}`; }
    if (id) { a.dismissed[id] = now.toISOString(); }
    ctx.commit();
    setTimeout(() => run('dopo un’azione'), 400);
    return msg || 'Fatto';
  }

  // domande libere dal telefono: risponde l'IA del computer sui dati della prossima settimana
  async function chat(text, history = []) {
    const d = ctx.data(), now = new Date(), day0 = new Date(now); day0.setHours(0, 0, 0, 0);
    const to = new Date(day0.getTime() + 8 * 864e5);
    const evs = Recur.expand(d.events, day0, to).filter(e => e.start && e.start >= iso(day0) && e.start < iso(to)).sort((x, y) => x.start.localeCompare(y.start)).slice(0, 80)
      .map(e => `- ${e.start.replace('T', ' ')}${e.allDay ? ' (tutto il giorno)' : '–' + (e.end || '').slice(11, 16)} · ${e.title}${e.location ? ' · ' + e.location : ''}`);
    const steps = d.projects.filter(p => p.status !== 'archiviato').flatMap(p => p.steps.filter(s => !s.done).map(s => `- ${s.text} · ${p.title}${s.due ? ' · quando ' + s.due.replace('T', ' ') : ''}${s.deadline ? ' · entro ' + s.deadline.replace('T', ' ') : ''}`)).slice(0, 60);
    const a = st();
    const sys = `Sei l'assistente personale di ${d.settings.userName || 'una persona'} dentro Promemo e rispondi dal suo telefono. Italiano, breve (massimo 5 frasi o un elenco corto), concreto. Usi solo i dati forniti; se non lo sai, lo dici.
Adesso è ${now.toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.
Impegni dei prossimi 8 giorni:
${evs.join('\n') || '(nessuno)'}
Compiti aperti:
${steps.join('\n') || '(nessuno)'}
Cose notate dall'assistente:
${(a.insights || []).map(i => '- ' + i.title + ': ' + i.text).join('\n') || '(niente)'}`;
    const msgs = history.slice(-6).map(m => ({ role: m.me ? 'user' : 'assistant', content: String(m.t).slice(0, 1500) })).concat([{ role: 'user', content: String(text).slice(0, 1500) }]);
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    const out = await ctx.ai(sys, msgs, { maxTokens: 600 });
    return out ? String(out).trim() : null;
  }

  return { run, act, chat, mailInsights, cfg, lastRun: () => lastRun, running: () => running };
}

module.exports = { createAgent };
