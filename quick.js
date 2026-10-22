// Promemo — creazione al volo da una frase (finestra rapida, telefono, palette)
'use strict';
const nlp = require('./src/nlp.js');
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function inbox(data) {
  let p = data.projects.find(x => x.inbox && x.status !== 'archiviato');
  if (!p) {
    const now = iso(new Date());
    p = { qrev: (data.rev || 0) + 1, id: 'p-' + uid(), title: 'Da fare', category: '', description: 'Compiti aggiunti al volo', starred: false, status: 'attivo', createdAt: now, updatedAt: now, steps: [], traces: [], inbox: true };
    data.projects.push(p);
  }
  return p;
}

// restituisce { kind, id, title, text } oppure lancia un errore leggibile
function createFromText(data, text, { pid } = {}) {
  const qrev = (data.rev || 0) + 1;
  const r = nlp.parse(text, { projects: data.projects.filter(p => p.status !== 'archiviato') });
  if (!r.title) throw new Error('Scrivi cosa vuoi aggiungere');
  if (r.kind === 'passo') {
    const p = (r.projectId && data.projects.find(x => x.id === r.projectId)) || (pid && data.projects.find(x => x.id === pid)) || inbox(data);
    const st = { id: 's-' + uid(), text: r.title, due: r.due || null, reminder: r.reminder ?? (r.due && !r.auto ? 0 : null), done: false, duration: r.duration || (r.auto ? 60 : 30), qrev };
    if (r.priority) st.priority = r.priority;
    if (r.auto) { st.auto = true; st.deadline = r.deadline || null; }
    p.steps.push(st); p.updatedAt = iso(new Date());
    return { kind: 'passo', id: st.id, pid: p.id, title: r.title, text: nlp.describe(r).map(x => x[1]).join(' · '), parsed: r };
  }
  const e = { id: 'e-' + uid(), title: r.title, kind: r.kind, projectId: r.projectId || '', allDay: !!r.allDay, start: r.start, end: r.end, location: r.location || '', reminder: r.reminder ?? (r.allDay ? null : 15), notes: '', qrev };
  const dc = data.settings.defaultCalendar;
  if (dc) { const [acc, ...c] = dc.split('|'); const a = data.accounts.find(x => x.id === acc && x.enabled); if (a) e.pushTo = { acc, cal: c.join('|') }; }
  data.events.push(e);
  return { kind: e.kind, id: e.id, title: r.title, text: nlp.describe(r).map(x => x[1]).join(' · '), parsed: r, push: !!e.pushTo };
}

module.exports = { createFromText, nlp };
