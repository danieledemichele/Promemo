// Parser iCalendar (.ics) minimale con fusi orari e ricorrenze comuni
'use strict';

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line) {
  const i = line.indexOf(':');
  if (i < 0) return null;
  const left = line.slice(0, i), value = line.slice(i + 1);
  const parts = left.split(';');
  const name = parts[0].toUpperCase();
  const params = {};
  for (const p of parts.slice(1)) { const [k, v] = p.split('='); if (k) params[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); }
  return { name, params, value };
}

const unescape = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

// offset (ms) del fuso tz all'istante utc
function tzOffset(utcMs, tz) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return asUTC - utcMs;
  } catch { return null; }
}

// Windows/Outlook usano nomi propri: i più comuni
const WIN_TZ = { 'W. Europe Standard Time': 'Europe/Rome', 'Romance Standard Time': 'Europe/Paris', 'GMT Standard Time': 'Europe/London', 'Central Europe Standard Time': 'Europe/Budapest', 'Eastern Standard Time': 'America/New_York', 'Pacific Standard Time': 'America/Los_Angeles', 'UTC': 'UTC' };

function parseDate(prop) {
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || prop.params.VALUE === 'DATE') return { date: new Date(+y, +mo - 1, +d), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))), allDay: false };
  const tzid = prop.params.TZID && (WIN_TZ[prop.params.TZID] || prop.params.TZID);
  if (tzid) {
    const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0));
    const off = tzOffset(guess, tzid);
    if (off !== null) {
      let t = guess - off;
      const off2 = tzOffset(t, tzid); if (off2 !== null && off2 !== off) t = guess - off2;
      return { date: new Date(t), allDay: false };
    }
  }
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)), allDay: false }; // ora "fluttuante": locale
}

function parseDuration(v) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+w || 0) * 7 * 86400 + (+d || 0) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + (+s || 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Espande RRULE (DAILY, WEEKLY con BYDAY, MONTHLY per giorno del mese, YEARLY)
function expand(start, rule, from, to, exdates) {
  const r = Object.fromEntries(rule.split(';').map(x => x.split('=')));
  const freq = r.FREQ, interval = Math.max(1, +r.INTERVAL || 1);
  const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseDate({ value: r.UNTIL, params: {} })?.date : null;
  const byday = r.BYDAY ? r.BYDAY.split(',').map(x => DAYS[x.slice(-2)]).filter(x => x !== undefined) : null;
  const out = [];
  let n = 0, guard = 0;
  const push = (d) => {
    if (until && d > until) return false;
    if (n >= count) return false;
    n++;
    if (d >= from && d <= to && !exdates.has(d.getTime())) out.push(new Date(d));
    return true;
  };
  const cur = new Date(start);
  while (guard++ < 5000 && out.length < 800) {
    if (cur > to && freq !== 'WEEKLY') break;
    if (freq === 'DAILY') { if (!push(cur)) break; cur.setDate(cur.getDate() + interval); }
    else if (freq === 'WEEKLY') {
      const weekStart = new Date(cur); weekStart.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
      if (weekStart > to) break;
      const days = byday && byday.length ? byday.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : [start.getDay()];
      let stop = false;
      for (const wd of days) {
        const d = new Date(weekStart); d.setDate(weekStart.getDate() + ((wd + 6) % 7));
        d.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        if (d < start) continue;
        if (!push(d)) { stop = true; break; }
      }
      if (stop) break;
      cur.setTime(weekStart.getTime()); cur.setDate(cur.getDate() + 7 * interval);
      cur.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
    } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
      const k = guard - 1;
      const months = (freq === 'MONTHLY' ? 1 : 12) * interval * k;
      const d = new Date(start.getFullYear(), start.getMonth() + months, start.getDate(), start.getHours(), start.getMinutes(), start.getSeconds());
      if (d > to) break;
      if (d.getDate() === start.getDate()) { if (!push(d)) break; } // mese troppo corto: salta
    }
    else { push(cur); break; }
  }
  return out;
}

/**
 * Restituisce gli eventi nell'intervallo [from, to]:
 * { uid, rid, title, start: Date, end: Date, allDay, location, notes }
 */
function parseICS(text, from, to) {
  const lines = unfold(text);
  const events = [];
  const overrides = new Map(); // uid|recurrence-id -> evento modificato
  let cur = null, depth = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === 'BEGIN:VEVENT') { cur = { props: {} }; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }       // VALARM ecc.
    if (line.startsWith('END:') && depth > 0) { depth--; continue; }
    if (line === 'END:VEVENT') { events.push(cur); cur = null; continue; }
    if (depth > 0) continue;
    const p = parseLine(line); if (!p) continue;
    if (p.name === 'EXDATE') (cur.props.EXDATE = cur.props.EXDATE || []).push(p);
    else cur.props[p.name] = p;
  }

  const out = [];
  for (const ev of events) {
    const P = ev.props;
    if (!P.DTSTART) continue;
    if (P.STATUS && P.STATUS.value.toUpperCase() === 'CANCELLED') continue;
    const s = parseDate(P.DTSTART); if (!s) continue;
    let dur;
    if (P.DTEND) { const e = parseDate(P.DTEND); dur = e ? e.date - s.date : 0; }
    else if (P.DURATION) dur = parseDuration(P.DURATION.value);
    else dur = s.allDay ? 86400000 : 0;
    const base = {
      uid: P.UID ? P.UID.value : 'x' + s.date.getTime(),
      title: P.SUMMARY ? unescape(P.SUMMARY.value) : '(senza titolo)',
      location: P.LOCATION ? unescape(P.LOCATION.value) : '',
      notes: P.DESCRIPTION ? unescape(P.DESCRIPTION.value).slice(0, 2000) : '',
      allDay: s.allDay,
      category: P.CATEGORIES ? unescape(P.CATEGORIES.value.split(',')[0]).trim() : '',
    };
    const mk = (start) => {
      let end = new Date(start.getTime() + dur);
      if (base.allDay) { end = new Date(end.getTime() - 86400000); if (end < start) end = new Date(start); }
      return { ...base, rid: base.uid + '@' + start.getTime(), start, end };
    };
    if (P['RECURRENCE-ID']) {
      const rd = parseDate(P['RECURRENCE-ID']);
      if (rd) overrides.set(base.uid + '@' + rd.date.getTime(), mk(s.date));
      continue;
    }
    if (P.RRULE) {
      const ex = new Set();
      for (const e of P.EXDATE || []) for (const v of e.value.split(',')) { const d = parseDate({ value: v, params: e.params }); if (d) ex.add(d.date.getTime()); }
      for (const d of expand(s.date, P.RRULE.value, new Date(from.getTime() - dur), to, ex)) out.push(mk(d));
    } else {
      const o = mk(s.date);
      if (o.end >= from && o.start <= to) out.push(o);
    }
  }
  // applica le occorrenze modificate
  return out.map(o => {
    const ov = overrides.get(o.rid);
    return ov ? { ...ov, rid: o.rid } : o;
  });
}

module.exports = { parseICS };
