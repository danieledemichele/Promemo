// Promemo — tempo di viaggio: da dove parti, quanto ci metti, a che ora uscire
// Indirizzi: Nominatim (OpenStreetMap) · Percorsi: routing.openstreetmap.de (auto, a piedi, bici)
'use strict';
const GEO = process.env.PROMEMO_GEOCODE_API || 'https://nominatim.openstreetmap.org';
const ROUTE = process.env.PROMEMO_ROUTE_API || 'https://routing.openstreetmap.de';
const PROFILE = { car: 'routed-car', foot: 'routed-foot', bike: 'routed-bike' };
const ONLINE = /^(https?:|www\.)|meet\.google|zoom\.us|teams\.microsoft|webex|online|videochiamata|da remoto/i;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function hav(a, b) {
  const R = 6371, r = (x) => x * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function createTravel(ctx) {
  // ctx: data(), commit(), notify(title, body, route), version
  const UA = { 'User-Agent': `Promemo/${ctx.version} (app desktop personale; https://github.com/danieledemichele/Promemo)`, 'Accept-Language': 'it' };
  let lastGeo = 0;
  const cfg = () => ({ enabled: false, mode: 'auto', buffer: 5, notify: true, home: null, ...(ctx.data().settings.travel || {}) });
  const cache = () => { const d = ctx.data(); d.geo = d.geo || { places: {}, routes: {} }; return d.geo; };

  async function getJson(url) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    try { const r = await fetch(url, { headers: UA, signal: ctl.signal }); if (!r.ok) throw new Error(`Errore ${r.status}`); return await r.json(); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'Il servizio di mappe non risponde' : e.cause ? 'Mappe non raggiungibili: sei offline?' : e.message); }
    finally { clearTimeout(t); }
  }
  async function search(q, limit = 5) {
    const wait = 1100 - (Date.now() - lastGeo); if (wait > 0) await new Promise(r => setTimeout(r, wait)); // 1 richiesta al secondo
    lastGeo = Date.now();
    const home = cfg().home;
    const p = new URLSearchParams({ q, format: 'jsonv2', limit: String(limit), addressdetails: '0' });
    if (home) p.set('viewbox', `${home.lon - 0.6},${home.lat + 0.45},${home.lon + 0.6},${home.lat - 0.45}`);
    const j = await getJson(`${GEO}/search?${p}`);
    return j.map(x => ({ name: x.name || String(x.display_name).split(',')[0], label: x.display_name, lat: +x.lat, lon: +x.lon }));
  }
  async function place(q) {
    const key = q.trim().toLowerCase(); const c = cache().places;
    if (key in c && (c[key] || Date.now() - (c[key + '#miss'] || 0) < 7 * 864e5)) return c[key];
    const home = cfg().home;
    let r = await search(q, 1);
    if (!r.length && home && home.city && !/,/.test(q)) r = await search(`${q}, ${home.city}`, 1);
    c[key] = r[0] ? { lat: r[0].lat, lon: r[0].lon, label: r[0].label } : null;
    if (!r[0]) c[key + '#miss'] = Date.now();
    return c[key];
  }
  async function route(a, b, mode) {
    const key = `${mode}:${a.lat.toFixed(4)},${a.lon.toFixed(4)}>${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;
    const c = cache().routes; if (c[key]) return c[key];
    const j = await getJson(`${ROUTE}/${PROFILE[mode]}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
    if (!j.routes || !j.routes[0]) throw new Error('Percorso non trovato');
    c[key] = { s: j.routes[0].duration, m: j.routes[0].distance };
    return c[key];
  }

  // il tragitto verso un evento: dall'impegno precedente (se vicino nel tempo) o da casa
  async function legFor(ev, prevEv) {
    const c = cfg();
    if (!ev.location || ONLINE.test(ev.location)) return null;
    const to = await place(ev.location); if (!to) return { error: 'Indirizzo non trovato' };
    let from = c.home, fromName = 'casa';
    if (prevEv && prevEv.location && !ONLINE.test(prevEv.location)) { const p = await place(prevEv.location); if (p) { from = p; fromName = prevEv.title; } }
    if (!from) return { error: 'Imposta il punto di partenza' };
    const km = hav(from, to);
    if (km < 0.08) return { min: 0, km: 0, mode: 'foot', from: fromName, same: true };
    let mode = c.mode === 'auto' ? (km <= 1.3 ? 'foot' : 'car') : c.mode;
    const r = await route(from, to, mode);
    let min = r.s / 60;
    if (mode === 'car') min = min * 1.15 + 5; // traffico e parcheggio
    return { min: Math.max(1, Math.round(min)), km: Math.round(r.m / 100) / 10, mode, from: fromName };
  }

  let busy = false;
  async function refresh() {
    const d = ctx.data(); const c = cfg();
    if (!d || !c.enabled || busy) return 0;
    busy = true;
    try {
      const now = Date.now(), until = now + 36 * 3600000;
      const Recur = require('./src/recur.js');
      const evs = Recur.expand(d.events, new Date(now - 864e5), new Date(until)).filter(e => !e.allDay && e.start && !e.tripRef).map(e => ({ e, s: new Date(e.start).getTime(), en: new Date(e.end || e.start).getTime() }))
        .filter(x => x.en > now - 3600000 && x.s < until).sort((a, b) => a.s - b.s);
      const out = { ...(d.travel || {}) }; let n = 0;
      for (let i = 0; i < evs.length; i++) {
        const { e, s } = evs[i];
        const tid = e._occ ? `${e.id}@${e._occ}` : e.id;
        if (!e.location) { delete out[tid]; continue; }
        const prev = [...evs.slice(0, i)].reverse().find(x => x.e.location && x.en <= s && s - x.en < 3 * 3600000 && new Date(x.s).toDateString() === new Date(s).toDateString());
        const key = `${e.location}|${prev ? prev.e.location : ''}|${c.mode}|${c.home ? c.home.lat + ',' + c.home.lon : ''}`;
        if (out[tid] && out[tid].key === key && out[tid].start === e.start) continue;
        try {
          const leg = await legFor(e, prev && prev.e);
          if (!leg) { delete out[tid]; continue; }
          const leave = leg.min != null ? new Date(s - (leg.min + (leg.same ? 0 : c.buffer)) * 60000) : null;
          out[tid] = { ...leg, key, start: e.start, leaveAt: leave ? iso(leave) : null, notified: out[tid] && out[tid].start === e.start ? out[tid].notified : null };
          n++;
        } catch (err) { out[tid] = { error: err.message, key: null, start: e.start }; console.warn(`tempo di viaggio per «${e.location}»: ${err.message}`); }
      }
      for (const id of Object.keys(out)) if (!d.events.some(e => e.id === id.split('@')[0]) || (out[id].start && out[id].start < iso(new Date(now - 864e5)))) delete out[id];
      d.travel = out;
      if (n) ctx.commit();
      return n;
    } finally { busy = false; }
  }

  const MODE_TXT = { car: 'in auto', foot: 'a piedi', bike: 'in bici' };
  function checkLeave() {
    const d = ctx.data(); const c = cfg();
    if (!d || !c.enabled || !c.notify || !d.settings.notifications) return;
    const now = Date.now(); let ch = false;
    for (const [id, t] of Object.entries(d.travel || {})) {
      if (!t.leaveAt || t.same || t.notified === t.leaveAt) continue;
      const at = new Date(t.leaveAt).getTime();
      if (at - 5 * 60000 <= now && now < at + 20 * 60000) {
        const e0 = d.events.find(x => x.id === id.split('@')[0]); if (!e0) continue; const e = { ...e0, start: t.start };
        ctx.notify(now >= at ? `Esci ora · ${e.title}` : `Esci alle ${t.leaveAt.slice(11, 16)} · ${e.title}`, `${t.min} min ${MODE_TXT[t.mode] || ''} da ${t.from}${t.km ? ` (${String(t.km).replace('.', ',')} km)` : ''}\nInizia alle ${e.start.slice(11, 16)}${e.location ? ' · ' + e.location : ''}`, { view: 'agenda', date: e.start.slice(0, 10) });
        t.notified = t.leaveAt; ch = true;
      }
    }
    if (ch) ctx.commit();
  }

  return { search, refresh, checkLeave, cfg };
}

module.exports = { createTravel };
