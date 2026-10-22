/* Promemo — modello di sincronizzazione tra computer e telefono.
   Ogni elemento modificabile (evento locale, progetto, compito, raccolta) è un "record" con data di modifica e dispositivo;
   le cancellazioni restano annotate. Due dispositivi si scambiano lo stato e per ogni record vince la modifica più recente.
   Gli eventi dei calendari collegati e i viaggi arrivano dal computer in sola lettura ("ext"). Condiviso da desktop e telefono. */
(function (root) {
  'use strict';
  const VOLATILE = new Set(['notifiedAt', 'qrev', 'autoLate']);
  const ORDER = { cat: 0, pj: 1, st: 2, ev: 3 };
  // impronta veloce (FNV-1a) del contenuto, senza i campi che cambiano da soli
  function hash(v) {
    const s = JSON.stringify(v, (k, x) => VOLATILE.has(k) ? undefined : x);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + s.length.toString(36);
  }
  const ownEvent = (e) => !e.source && !e.tripRef;
  function records(d) {
    const out = new Map();
    for (const c of d.categories || []) out.set('cat:' + c.id, c);
    for (const p of d.projects || []) {
      const { steps, ...rest } = p;
      out.set('pj:' + p.id, rest);
      for (const st of steps || []) out.set('st:' + st.id, { ...st, _pid: p.id });
    }
    for (const e of d.events || []) if (ownEvent(e)) out.set('ev:' + e.id, e);
    return out;
  }
  // annota cosa è cambiato rispetto all'ultima volta: data di modifica e dispositivo
  function track(d, dev, now = Date.now()) {
    const meta = d.syncMeta = d.syncMeta || {};
    const recs = records(d); let n = 0;
    for (const [k, v] of recs) {
      const h = hash(v), m = meta[k];
      if (!m || m.del || m.h !== h) { meta[k] = { h, mod: m && !m.del && m.h === h ? m.mod : Math.max(now, m ? m.mod + 1 : 0), dev }; n++; }
    }
    for (const k of Object.keys(meta)) {
      const m = meta[k];
      if (!recs.has(k) && !m.del) { meta[k] = { del: true, mod: Math.max(now, m.mod + 1), dev }; n++; }
      else if (m.del && now - m.mod > 120 * 864e5) delete meta[k]; // cancellazioni più vecchie di 4 mesi
    }
    return n;
  }
  function build(d, dev, ext) {
    const meta = d.syncMeta || {}, recs = records(d), out = {};
    for (const [k, m] of Object.entries(meta)) {
      if (m.del) out[k] = { mod: m.mod, dev: m.dev, del: true };
      else if (recs.has(k)) out[k] = { mod: m.mod, dev: m.dev, v: recs.get(k) };
    }
    return { format: 'promemo-sync', v: 1, dev, at: new Date().toISOString(), recs: out, ...(ext ? { ext } : {}) };
  }
  const newer = (r, m) => !m || r.mod > m.mod || (r.mod === m.mod && String(r.dev) > String(m.dev));
  // unisce lo stato di un altro dispositivo: restituisce quanti record sono cambiati qui
  function merge(d, state) {
    if (!state || state.format !== 'promemo-sync') throw new Error('Stato di sincronizzazione non valido');
    const meta = d.syncMeta = d.syncMeta || {};
    d.events = d.events || []; d.projects = d.projects || []; d.categories = d.categories || [];
    const keys = Object.keys(state.recs || {}).sort((a, b) => ORDER[a.split(':')[0]] - ORDER[b.split(':')[0]]);
    let n = 0;
    for (const k of keys) {
      const r = state.recs[k]; if (!newer(r, meta[k])) continue;
      const [t, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      if (r.del) remove(d, t, id); else upsert(d, t, id, r.v);
      meta[k] = r.del ? { del: true, mod: r.mod, dev: r.dev } : { h: hash(t === 'st' ? r.v : r.v), mod: r.mod, dev: r.dev };
      n++;
    }
    return n;
  }
  function upsert(d, t, id, v) {
    v = JSON.parse(JSON.stringify(v));
    if (t === 'cat') { const i = d.categories.findIndex(x => x.id === id); i >= 0 ? (d.categories[i] = v) : d.categories.push(v); }
    if (t === 'ev') { const i = d.events.findIndex(x => x.id === id); i >= 0 ? (d.events[i] = { ...v, notifiedAt: d.events[i].notifiedAt }) : d.events.push(v); }
    if (t === 'pj') { const p = d.projects.find(x => x.id === id); if (p) { const steps = p.steps; Object.keys(p).forEach(k => delete p[k]); Object.assign(p, v, { steps }); } else d.projects.push({ ...v, steps: [] }); }
    if (t === 'st') {
      const pid = v._pid; delete v._pid;
      let p = d.projects.find(x => x.id === pid);
      if (!p) { p = { id: pid, title: 'Da fare', category: '', description: '', starred: false, status: 'attivo', createdAt: v.due || '', updatedAt: '', steps: [], traces: [] }; d.projects.push(p); }
      for (const q of d.projects) if (q !== p) { const i = q.steps.findIndex(x => x.id === id); if (i >= 0) q.steps.splice(i, 1); }
      const i = p.steps.findIndex(x => x.id === id);
      if (i >= 0) p.steps[i] = { ...v, notifiedAt: p.steps[i].notifiedAt }; else p.steps.push(v);
    }
  }
  function remove(d, t, id) {
    if (t === 'cat') d.categories = d.categories.filter(x => x.id !== id);
    if (t === 'ev') d.events = d.events.filter(x => x.id !== id);
    if (t === 'pj') d.projects = d.projects.filter(x => x.id !== id);
    if (t === 'st') for (const p of d.projects) p.steps = p.steps.filter(x => x.id !== id);
  }
  const api = { hash, records, track, build, merge, ownEvent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PromemoSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
