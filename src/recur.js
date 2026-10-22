/* Promemo — ripetizioni: "ogni lunedì e mercoledì", "ogni 2 settimane", "ogni mese fino al 20 dicembre"
   regola: { freq: 'daily'|'weekly'|'monthly'|'yearly', interval: 1, byday: [1,3] (0 = domenica), until: 'AAAA-MM-GG', count, exdates: ['AAAA-MM-GG'] }
   Condiviso da interfaccia, processo principale, telefono. */
(function (root) {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const iso = (d) => `${dk(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const parse = (s) => new Date(s.length === 10 ? s + 'T00:00' : s);
  const day0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const days = (a, b) => Math.round((day0(b) - day0(a)) / 864e5);
  const monday = (d) => { const x = day0(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const RR_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  // la regola "cade" in questo giorno? (senza contare count/exdates)
  function matches(rule, base, d) {
    const n = days(base, d); if (n < 0) return false;
    const iv = Math.max(1, +rule.interval || 1);
    if (rule.until && dk(d) > rule.until) return false;
    switch (rule.freq) {
      case 'daily': return n % iv === 0;
      case 'weekly': { const bd = rule.byday && rule.byday.length ? rule.byday : [base.getDay()]; if (!bd.includes(d.getDay())) return false; return Math.round((monday(d) - monday(base)) / (7 * 864e5)) % iv === 0; }
      case 'monthly': { if (d.getDate() !== base.getDate()) return false; const m = (d.getFullYear() - base.getFullYear()) * 12 + d.getMonth() - base.getMonth(); return m % iv === 0; }
      case 'yearly': return d.getDate() === base.getDate() && d.getMonth() === base.getMonth() && (d.getFullYear() - base.getFullYear()) % iv === 0;
      default: return false;
    }
  }
  // numero d'ordine dell'occorrenza (per "per 10 volte")
  function ordinal(rule, base, d) { let n = 0; for (let x = day0(base); x <= d; x.setDate(x.getDate() + 1)) if (matches(rule, base, x)) n++; return n; }
  function occursOn(rule, startIso, d) {
    if (!rule || !rule.freq) return false;
    const base = parse(startIso); const day = day0(d);
    if (!matches(rule, base, day)) return false;
    if (rule.exdates && rule.exdates.includes(dk(day))) return false;
    if (rule.count && ordinal(rule, base, day) > rule.count) return false;
    return true;
  }
  // l'occorrenza di un evento in quel giorno, con inizio e fine spostati
  function instance(ev, d) {
    const s = parse(ev.start), e = parse(ev.end || ev.start);
    const ns = day0(d); ns.setHours(s.getHours(), s.getMinutes(), 0, 0);
    const ne = new Date(ns.getTime() + (e - s));
    return Object.assign({}, ev, { start: ev.allDay ? dk(ns) + 'T00:00' : iso(ns), end: ev.allDay ? dk(ne) + 'T23:59' : iso(ne), _occ: dk(ns) });
  }
  // tutte le occorrenze tra due date (inclusa la prima)
  function between(ev, from, to) {
    const out = []; if (!ev.rrule) return out;
    const a = day0(from), b = day0(to), base = day0(parse(ev.start));
    for (let x = new Date(Math.max(a, base)); x <= b; x.setDate(x.getDate() + 1)) if (occursOn(ev.rrule, ev.start, x)) out.push(instance(ev, x));
    return out;
  }
  // espande una lista di eventi in una finestra: le ripetizioni diventano singole occorrenze
  function expand(events, from, to) {
    const out = [];
    for (const e of events) {
      if (!e.rrule) { out.push(e); continue; }
      out.push(...between(e, from, to));
    }
    return out;
  }
  // la prossima data dopo "after" (per i compiti ripetuti)
  function next(rule, startIso, after) {
    const base = parse(startIso); const a = parse(after);
    for (let i = 1; i < 800; i++) { const x = day0(a); x.setDate(x.getDate() + i); if (occursOn(rule, startIso, x)) { x.setHours(base.getHours(), base.getMinutes(), 0, 0); return iso(x); } }
    return null;
  }
  function toRRULE(rule) {
    const p = [`FREQ=${String(rule.freq).toUpperCase()}`];
    if (+rule.interval > 1) p.push(`INTERVAL=${rule.interval}`);
    if (rule.freq === 'weekly' && rule.byday && rule.byday.length) p.push(`BYDAY=${rule.byday.map(d => RR_DAY[d]).join(',')}`);
    if (rule.until) p.push(`UNTIL=${rule.until.replace(/-/g, '')}T235959Z`);
    else if (rule.count) p.push(`COUNT=${rule.count}`);
    return 'RRULE:' + p.join(';');
  }
  function describe(rule) {
    if (!rule || !rule.freq) return 'Mai';
    const iv = +rule.interval || 1;
    let s = { daily: iv > 1 ? `Ogni ${iv} giorni` : 'Ogni giorno', weekly: iv > 1 ? `Ogni ${iv} settimane` : 'Ogni settimana', monthly: iv > 1 ? `Ogni ${iv} mesi` : 'Ogni mese', yearly: iv > 1 ? `Ogni ${iv} anni` : 'Ogni anno' }[rule.freq];
    if (rule.freq === 'weekly' && rule.byday && rule.byday.length) {
      const d = [...rule.byday].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      s = (iv > 1 ? `Ogni ${iv} settimane, ` : 'Ogni ') + (d.length === 5 && !d.includes(0) && !d.includes(6) ? 'giorno feriale' : d.map(x => GIORNI[x]).join(d.length === 2 ? ' e ' : ', ').replace(/, ([^,]+)$/, ' e $1'));
    }
    if (rule.until) s += ` fino al ${parse(rule.until).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    else if (rule.count) s += `, ${rule.count} volte`;
    return s;
  }
  const api = { occursOn, instance, between, expand, next, toRRULE, describe, GIORNI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PromemoRecur = api;
})(typeof window !== 'undefined' ? window : globalThis);
