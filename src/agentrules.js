/* Promemo — l'assistente proattivo: cosa noto guardando agenda, compiti, viaggi e spostamenti, e cosa ti propongo di fare.
   Funziona senza IA (regole) ed è condiviso tra computer e telefono. */
(function (root) {
  'use strict';
  const R = root.PromemoRecur || (typeof require === 'function' ? require('./recur.js') : null);
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const iso = (d) => `${dk(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const P = (s) => new Date(s.length === 10 ? s + 'T00:00' : s);
  const hm = (s) => s.slice(11, 16);
  const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
  const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

  // ctx: { events (già comprensivi di quelli in sola lettura), projects, travel, trips, accounts, planner:{start,end}, now, hidden(e) }
  function analyze(ctx) {
    const now = ctx.now ? new Date(ctx.now) : new Date();
    const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
    const tmr = new Date(day0); tmr.setDate(tmr.getDate() + 1);
    const after = new Date(day0); after.setDate(after.getDate() + 2);
    const nowS = iso(now), todayK = dk(now), tmrK = dk(tmr);
    const evs = (R ? R.expand(ctx.events || [], new Date(day0.getTime() - 864e5), new Date(after.getTime() + 864e5)) : ctx.events || [])
      .filter(e => e.start && (!ctx.hidden || !ctx.hidden(e)));
    const timed = (k) => evs.filter(e => !e.allDay && e.start.slice(0, 10) === k && (e.end || e.start).slice(0, 10) === k).sort((a, b) => a.start.localeCompare(b.start));
    const tday = timed(todayK), tom = timed(tmrK);
    const steps = (ctx.projects || []).filter(p => p.status !== 'archiviato').flatMap(p => p.steps.map(st => ({ p, st }))).filter(x => !x.st.done);
    const trKey = (e) => e._occ ? `${e.id}@${e._occ}` : e.id;
    const out = [];
    const add = (x) => out.push({ level: 'media', actions: [], ...x });

    // 1. impegni sovrapposti (oggi e domani)
    for (const [k, list] of [[todayK, tday], [tmrK, tom]]) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (b.start >= (a.end || a.start)) break;
        if (a.id === b.id) continue;
        add({ id: `conf:${trKey(a)}:${trKey(b)}`, kind: 'conflitto', level: 'alta', title: `${k === todayK ? 'Oggi' : 'Domani'} due impegni si sovrappongono`, text: `“${a.title}” (${hm(a.start)}–${hm(a.end || a.start)}) e “${b.title}” (${hm(b.start)}–${hm(b.end || b.start)}).`, actions: [{ label: 'Apri “' + a.title.slice(0, 24) + '”', op: 'open-ev', args: { id: a.id, date: k } }, { label: 'Apri l’altro', op: 'open-ev', args: { id: b.id, date: k } }] });
      }
    }
    // 2. a che ora uscire e trasferimenti impossibili
    const tr = ctx.travel || {};
    let prevEnd = null, prevEv = null;
    for (const e of tday) {
      const t = tr[trKey(e)];
      if (t && t.leaveAt && !t.same && (e.end || e.start) > nowS) {
        const mins = Math.round((P(t.leaveAt) - now) / 60000);
        if (prevEnd && t.leaveAt < prevEnd && prevEv && prevEv.location && e.location && prevEv.location !== e.location) {
          add({ id: `stretto:${trKey(e)}`, kind: 'trasferimento', level: 'alta', title: `Non fai in tempo per “${e.title}”`, text: `Finisci “${prevEv.title}” alle ${hm(prevEnd)} ma per arrivare alle ${hm(e.start)} dovresti uscire alle ${hm(t.leaveAt)} (${t.min} min).`, actions: [{ label: 'Apri l’impegno', op: 'open-ev', args: { id: e.id, date: todayK } }] });
        } else if (mins <= 120 && mins >= -10) {
          add({ id: `esci:${trKey(e)}:${t.leaveAt}`, kind: 'esci', level: mins <= 30 ? 'alta' : 'media', title: mins <= 0 ? `Esci ora per “${e.title}”` : `Esci alle ${hm(t.leaveAt)} per “${e.title}”`, text: `${t.min} min ${{ car: 'in auto', foot: 'a piedi', bike: 'in bici' }[t.mode] || ''} da ${t.from}${e.location ? ' · ' + e.location : ''}. Inizia alle ${hm(e.start)}.`, actions: [{ label: 'Apri', op: 'open-ev', args: { id: e.id, date: todayK } }] });
        }
      }
      prevEnd = e.end || e.start; prevEv = e;
    }
    // 3. compiti in ritardo
    const late = steps.filter(x => x.st.due && x.st.due.slice(0, 10) < todayK);
    if (late.length) add({ id: `ritardo:${todayK}:${late.length}`, kind: 'ritardo', level: late.length > 3 ? 'alta' : 'media', title: `${late.length} ${late.length === 1 ? 'compito è' : 'compiti sono'} in ritardo`, text: late.slice(0, 3).map(x => `“${x.st.text}”`).join(', ') + (late.length > 3 ? ` e altri ${late.length - 3}` : '') + '.', actions: [{ label: 'Trova io il tempo', op: 'steps-auto', args: { ids: late.map(x => [x.p.id, x.st.id]) } }, { label: 'Sposta a oggi', op: 'steps-today', args: { ids: late.map(x => [x.p.id, x.st.id]) } }] });
    // 4. scadenze vicine non ancora pianificate
    const soon = steps.filter(x => { const dl = x.st.deadline || (!x.st.auto && x.st.due); return dl && dl >= nowS && dl.slice(0, 10) <= tmrK && (x.st.auto ? !x.st.due || x.st.autoLate : false); });
    for (const x of soon.slice(0, 3)) add({ id: `scad:${x.st.id}:${x.st.deadline}`, kind: 'scadenza', level: 'alta', title: `“${x.st.text}” scade ${x.st.deadline.slice(0, 10) === todayK ? 'oggi' : 'domani'} e non ha ancora un posto`, text: `Serve circa ${fmtMin(+x.st.duration || 60)}. Posso liberare uno spazio o puoi spostare la scadenza.`, actions: [{ label: 'Fallo stasera', op: 'step-at', args: { pid: x.p.id, sid: x.st.id, start: dk(now) + 'T' + pad(Math.max(now.getHours() + 1, 18)) + ':00' } }, { label: 'Apri', op: 'open-st', args: { pid: x.p.id, sid: x.st.id } }] });
    // 5. tempo libero di oggi: il blocco più lungo nell'orario di lavoro → il compito più urgente
    const pl = ctx.planner || { start: 9, end: 19 };
    const wEnd = new Date(day0); wEnd.setHours(pl.end, 0, 0, 0);
    let cur = new Date(Math.max(now.getTime(), new Date(day0).setHours(pl.start, 0, 0, 0)));
    let best = null;
    const busy = tday.map(e => [P(e.start), P(e.end || e.start)]).concat(steps.filter(x => x.st.due && x.st.due.slice(0, 10) === todayK).map(x => [P(x.st.due), new Date(P(x.st.due).getTime() + (+x.st.duration || 30) * 60000)])).sort((a, b) => a[0] - b[0]);
    for (const [a, b] of busy.concat([[wEnd, wEnd]])) { if (a > cur && a <= wEnd) { const m = (Math.min(a, wEnd) - cur) / 60000; if (m >= 90 && (!best || m > best.m)) best = { from: new Date(cur), to: new Date(Math.min(a, wEnd)), m }; } if (b > cur) cur = b; }
    const todo = steps.filter(x => !x.st.due || x.st.auto).sort((a, b) => ((a.st.deadline || '9') + (a.st.priority === 'alta' ? '0' : '1')).localeCompare((b.st.deadline || '9') + (b.st.priority === 'alta' ? '0' : '1')));
    if (best && todo.length && cur < wEnd) {
      const x = todo[0];
      add({ id: `libero:${todayK}:${hm(iso(best.from))}`, kind: 'libero', level: 'info', title: `Hai ${fmtMin(Math.round(best.m))} liberi dalle ${hm(iso(best.from))} alle ${hm(iso(best.to))}`, text: `Buon momento per “${x.st.text}”${x.st.deadline ? ` (entro ${GIORNI[P(x.st.deadline).getDay()]})` : ''}.`, actions: [{ label: 'Mettilo lì', op: 'step-at', args: { pid: x.p.id, sid: x.st.id, start: iso(best.from) } }, { label: 'Concentrati', op: 'focus', args: { pid: x.p.id, sid: x.st.id } }] });
    }
    // 6. giornata piena
    const busyMin = tday.reduce((s, e) => s + (P(e.end || e.start) - P(e.start)) / 60000, 0);
    if (busyMin >= 7 * 60) add({ id: `pieno:${todayK}`, kind: 'carico', level: 'info', title: `Oggi ${fmtMin(Math.round(busyMin))} di impegni`, text: 'Giornata piena: tieni una pausa e lascia ai prossimi giorni i compiti che possono aspettare.', actions: [{ label: 'Sposta i compiti a domani', op: 'steps-tomorrow', args: { ids: steps.filter(x => x.st.due && x.st.due.slice(0, 10) === todayK && x.st.priority !== 'alta').map(x => [x.p.id, x.st.id]) } }] });
    // 7. domani presto
    if (tom[0] && tom[0].start.slice(11) < '09:00' && now.getHours() >= 17) { const t = tr[trKey(tom[0])]; add({ id: `presto:${tmrK}`, kind: 'domani', level: 'info', title: `Domani si parte alle ${hm(tom[0].start)}`, text: `“${tom[0].title}”${t && t.leaveAt && !t.same ? ` · esci alle ${hm(t.leaveAt)}` : ''}${tom.length > 1 ? ` · ${tom.length} impegni in tutto` : ''}.`, actions: [{ label: 'Apri domani', op: 'open-day', args: { date: tmrK } }] }); }
    // 8. viaggi in arrivo
    for (const t of (ctx.trips || [])) {
      if (!t.start) continue;
      const days = Math.round((P(t.start.slice(0, 10)) - day0) / 864e5);
      if (days < 0 || days > 7) continue;
      const items = t.items || [], unb = items.filter(i => i.booked === false && /travel|check-in|activity|museum/i.test(i.type || '')).length;
      add({ id: `viaggio:${t.id}:${days}`, kind: 'viaggio', level: unb ? 'media' : 'info', title: days === 0 ? `Oggi parti per ${t.name}` : `Tra ${days} ${days === 1 ? 'giorno' : 'giorni'} parti per ${t.name}`, text: `${items.length} tappe${unb ? `, ${unb} da prenotare` : ', tutto prenotato'}.`, actions: [{ label: 'Apri l’itinerario', op: 'open-trip', args: { id: t.id } }].concat(days > 1 ? [{ label: 'Promemoria per la valigia', op: 'quick', args: { text: `preparare la valigia per ${t.name} ${days > 2 ? 'tra ' + (days - 1) + ' giorni' : 'domani'} alle 20` } }] : []) });
    }
    // 9. calendari che non si sincronizzano
    for (const a of (ctx.accounts || [])) if (a.error && a.enabled !== false) add({ id: `acc:${a.id}:${a.error.slice(0, 20)}`, kind: 'account', level: 'media', title: `“${a.name}” non si sincronizza`, text: a.error, actions: [{ label: 'Apri le integrazioni', op: 'open-settings', args: { pane: 'integrazioni' } }] });

    const order = { alta: 0, media: 1, info: 2 };
    out.sort((a, b) => order[a.level] - order[b.level]);
    // riepilogo in una frase
    const next = tday.find(e => (e.end || e.start) > nowS);
    const dueToday = steps.filter(x => x.st.due && x.st.due.slice(0, 10) === todayK).length;
    const summary = [
      tday.length ? `Oggi ${tday.length} ${tday.length === 1 ? 'impegno' : 'impegni'}${next ? `, il prossimo alle ${hm(next.start)}: ${next.title}` : ', tutti conclusi'}` : 'Oggi nessun impegno con orario',
      dueToday ? `${dueToday} ${dueToday === 1 ? 'compito' : 'compiti'} da fare` : '',
      late.length ? `${late.length} in ritardo` : '',
      tom.length ? `domani si parte alle ${hm(tom[0].start)}` : '',
    ].filter(Boolean).join(' · ') + '.';
    return { at: now.toISOString(), summary, insights: out.slice(0, 12) };
  }

  const api = { analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PromemoAgent = api;
})(typeof window !== 'undefined' ? window : globalThis);
