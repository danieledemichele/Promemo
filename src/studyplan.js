/* Promemo — piano di studio verso un esame: capitoli → sessioni pianificate da sole, ripassi distanziati, ripasso finale.
   Condiviso (interfaccia, test, telefono). */
(function (root) {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // "Travi iperstatiche — 6", "Torsione 4h", "Taglio (3 ore)", "Instabilità" → { name, hours }
  function parseChapters(text, defHours = 4) {
    return String(text || '').split(/\n+/).map(l => l.trim().replace(/^[-•*\d.)\s]+(?=\D)/, '')).filter(Boolean).map(l => {
      const m = l.match(/^(.*?)[\s—–:-]*\(?\s*(\d+(?:[.,]\d+)?)\s*(?:h|ore|ora)?\s*\)?\s*$/i);
      if (m && m[1].trim()) return { name: m[1].trim(), hours: Math.max(0.5, parseFloat(m[2].replace(',', '.'))) };
      return { name: l, hours: defHours };
    });
  }

  // giorni utili per studiare tra due date (esclusa la fine)
  function studyDays(from, to, days) { const out = []; for (let d = day0(from); d < to; d = addD(d, 1)) if (days.includes(d.getDay())) out.push(new Date(d)); return out; }

  // opts: { name, exam: 'AAAA-MM-GG' | 'AAAA-MM-GGTHH:MM', chapters: [{name, hours}], session (min), maxDay (min), days, start, end, reviews (bool), finalDays, category }
  function build(opts, now = new Date()) {
    const exam = new Date(opts.exam.length === 10 ? opts.exam + 'T09:00' : opts.exam);
    const examDay = day0(exam);
    const days = opts.days && opts.days.length ? opts.days : [1, 2, 3, 4, 5, 6];
    const session = Math.max(15, +opts.session || 90), maxDay = Math.max(session, +opts.maxDay || 120);
    const finalDays = Math.max(0, Math.min(7, opts.finalDays ?? 2));
    const chapters = (opts.chapters || []).filter(c => c && c.name);
    if (!chapters.length) throw new Error('Aggiungi almeno un capitolo o argomento');
    if (examDay <= day0(now)) throw new Error('La data dell’esame deve essere nel futuro');
    // gli ultimi N giorni di studio prima dell'esame (tra quelli scelti) sono per il ripasso finale
    const finals = []; for (let d = addD(examDay, -1); finals.length < finalDays && d > day0(now); d = addD(d, -1)) if (days.includes(d.getDay())) finals.unshift(new Date(d));
    const studyEnd = finals[0] || examDay;
    let A = studyDays(addD(day0(now), now.getHours() + now.getMinutes() / 60 + session / 60 > (+opts.end || 20) ? 1 : 0), studyEnd, days);
    if (!A.length) A = studyDays(day0(now), examDay, days);
    if (!A.length) throw new Error('Non ci sono giorni di studio prima dell’esame: scegli altri giorni');
    const total = chapters.reduce((a, c) => a + c.hours, 0);
    const stamp = (d, h, m) => `${dk(d)}T${pad(h)}:${pad(m)}`;
    const steps = [];
    const mk = (text, min, from, until, extra = {}) => steps.push({ id: 's-' + uid(), text, done: false, auto: true, duration: Math.round(min), due: null, deadline: until, notBefore: from && from > now ? stamp(from, 0, 0) : undefined, reminder: null, study: true, ...extra });
    // ogni argomento ha i suoi giorni, in proporzione alle sessioni e a quante ne stanno in un giorno
    const perDay = Math.max(1, Math.floor(maxDay / session));
    const counts = chapters.map(c => Math.max(1, Math.round(c.hours * 60 / session)));
    const allSess = counts.reduce((a, n) => a + n, 0);
    const need = Math.ceil(allSess / perDay), scale = Math.max(1, A.length / need);
    let cum = 0;
    const chapterEnds = [];
    for (const [ci, c] of chapters.entries()) {
      const a = Math.min(A.length - 1, Math.floor(cum / perDay * scale)); cum += counts[ci];
      const b = Math.max(a, Math.ceil(cum / perDay * scale) - 1);
      const from = A[a], to = A[Math.min(b, A.length - 1)];
      const n = counts[ci];
      const per = c.hours * 60 / n;
      for (let k = 0; k < n; k++) mk(n > 1 ? `${c.name} · ${k + 1}/${n}` : c.name, per, ci === 0 && k === 0 ? null : from, stamp(to, 23, 59), { chapter: ci });
      chapterEnds.push(to);
    }
    // ripassi distanziati: il giorno dopo, dopo 3 giorni e dopo una settimana (se c'è tempo prima dell'esame)
    if (opts.reviews !== false) for (const [ci, end] of chapterEnds.entries()) {
      for (const gap of [1, 4, 10]) {
        const d = addD(end, gap); if (d >= examDay) continue;
        mk(`Ripasso: ${chapters[ci].name}`, 30, d, stamp(addD(d, 1), 23, 59), { chapter: ci, review: gap });
      }
    }
    // gli ultimi giorni: simulazione e ripasso generale
    for (const [i, d] of finals.entries()) {
      mk(i === 0 && finals.length > 1 ? 'Simulazione d’esame (un compito completo, a tempo)' : 'Ripasso generale', Math.min(maxDay, Math.max(session, 120)), d, stamp(d, 23, 59), { final: true });
    }
    const nowS = stamp(now, now.getHours(), now.getMinutes());
    const project = { id: 'p-' + uid(), title: `Esame: ${opts.name}`, category: opts.category || '', description: `Piano di studio · ${chapters.length} ${chapters.length === 1 ? 'argomento' : 'argomenti'}, ${Math.round(total * 10) / 10} ore · esame il ${exam.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}`, starred: true, status: 'attivo', createdAt: nowS, updatedAt: nowS, steps, traces: [{ id: 't-' + uid(), title: 'Piano di studio creato', body: chapters.map(c => `${c.name} · ${c.hours} h`).join('\n'), at: nowS }],
      study: { exam: opts.exam, start: +opts.start || 15, end: +opts.end || 20, days, maxDay, session, chapters, total, finalDays: finals.length } };
    const event = { id: 'e-' + uid(), title: `Esame: ${opts.name}`, kind: 'appuntamento', projectId: project.id, allDay: opts.exam.length === 10, start: opts.exam.length === 10 ? opts.exam + 'T00:00' : opts.exam, end: opts.exam.length === 10 ? opts.exam + 'T23:59' : stamp(exam, Math.min(23, exam.getHours() + 3), exam.getMinutes()), location: opts.location || '', reminder: 1440, notes: '' };
    // quanto tempo c'è davvero
    const capacity = A.length * perDay * session / 60;
    return { project, event, total, capacity, days: A.length, tight: need > A.length * 0.9 };
  }

  // a che punto sei: ore fatte, ore previste a oggi, sessioni che non ci stanno
  function progress(p, now = new Date()) {
    const s = p.study; if (!s) return null;
    const work = p.steps.filter(x => x.study && !x.review && !x.final);
    const doneMin = work.filter(x => x.done).reduce((a, x) => a + (+x.duration || 0), 0), totMin = work.reduce((a, x) => a + (+x.duration || 0), 0) || 1;
    const exam = new Date(s.exam.length === 10 ? s.exam + 'T09:00' : s.exam);
    const created = new Date(p.createdAt);
    const span = Math.max(1, (exam - created) - s.finalDays * 864e5);
    const expected = Math.max(0, Math.min(1, (now - created) / span));
    const dueMin = work.filter(x => !x.done && x.deadline && new Date(x.deadline) < now).reduce((a, x) => a + (+x.duration || 0), 0);
    return { done: doneMin / totMin, expected, doneH: doneMin / 60, totH: totMin / 60, daysLeft: Math.round((day0(exam) - day0(now)) / 864e5), late: p.steps.filter(x => x.study && !x.done && (x.autoLate || !x.due)).length, overdueH: dueMin / 60, next: p.steps.filter(x => x.study && !x.done && x.due).sort((a, b) => a.due.localeCompare(b.due))[0] || null };
  }

  const api = { build, parseChapters, progress };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PromemoStudy = api;
})(typeof window !== 'undefined' ? window : globalThis);
