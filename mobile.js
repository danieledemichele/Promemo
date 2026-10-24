// Promemo — sul telefono: piccolo server nella rete di casa (o nella VPN) che serve un'app web per il telefono
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const FILES = {
  '/': ['src/mobile/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['src/mobile/app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['src/mobile/app.css', 'text/css; charset=utf-8'],
  '/nlp.js': ['src/nlp.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['src/mobile/manifest.webmanifest', 'application/manifest+json'],
  '/icon.png': ['build/icon.png', 'image/png'],
};

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const vpn = /^(wg|tun|tailscale|zt|utun)/i.test(name);
      out.push({ ip: a.address, iface: name, vpn });
    }
  }
  return out.sort((x, y) => x.vpn - y.vpn || (/^192\.168\./.test(y.ip) - /^192\.168\./.test(x.ip)));
}

function createMobile(ctx) {
  // ctx: data(), commit(), quickAdd(text), root, onChange()
  let server = null, port = null, lastErr = '', seen = {};
  // chiave sbagliata troppe volte dallo stesso indirizzo: fermo per 10 minuti (contro chi prova a indovinarla)
  const fails = new Map();
  const blocked = (ip) => { const f = fails.get(ip); return !!(f && f.until > Date.now()); };
  const fail = (ip) => { const now = Date.now(), f = fails.get(ip) || { n: 0, first: now, until: 0 }; if (now - f.first > 10 * 60000) { f.n = 0; f.first = now; } f.n++; if (f.n >= 10) f.until = now + 10 * 60000; fails.set(ip, f); if (fails.size > 500) fails.clear(); };
  const cfg = () => ({ enabled: false, port: 8787, token: '', ...(ctx.data() && ctx.data().settings.mobile || {}) });
  const tokenOk = (req) => {
    const c = cfg(); if (!c.token) return false;
    const got = String(req.headers['x-promemo-key'] || '');
    const a = Buffer.from(got), b = Buffer.from(c.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function state() {
    const d = ctx.data(); const now = new Date();
    const hidden = new Set(d.settings.hiddenLocal || []);
    const groupOf = (e) => {
      if (e.tripRef) return { name: 'Viaggi', color: (d.settings.trips || {}).color || '#0a84ff', visible: !hidden.has('__trips') };
      if (e.source) { const a = d.accounts.find(x => x.id === e.source.acc); const g = a && (a.groups || []).find(x => x.id === e.source.group); return { name: g ? g.name : a ? a.name : '', color: g ? g.color : '#8e8e93', visible: !!(a && a.enabled && (!g || g.visible !== false)) }; }
      const p = d.projects.find(x => x.id === e.projectId); const c = p && d.categories.find(x => x.id === p.category);
      return { name: c ? c.name : 'Personale', color: c ? ({ orange: '#e5562a', green: '#2f9e5b', blue: '#2f7ae5', purple: '#8e5bd9', pink: '#d9467a', teal: '#1f9aa5', yellow: '#c9930a', gray: '#8e8e93' }[c.color] || c.color) : (d.settings.localColor || '#e5562a'), visible: !hidden.has(c ? c.id : '') };
    };
    const Recur = require('./src/recur.js');
    const evAll = Recur.expand(d.events, new Date(now.getTime() - 864e5), new Date(now.getTime() + 15 * 864e5));
    const days = [];
    for (let i = 0; i < 14; i++) {
      const day = new Date(now); day.setDate(day.getDate() + i); const k = dk(day);
      const items = [];
      for (const e of evAll) {
        if (!e.start) continue; const s = e.start.slice(0, 10), en = (e.end || e.start).slice(0, 10);
        if (s > k || en < k) continue; const g = groupOf(e); if (!g.visible) continue;
        const tr = d.travel && d.travel[e._occ ? `${e.id}@${e._occ}` : e.id];
        items.push({ type: 'ev', id: e.id, title: e.title, allDay: !!e.allDay || s !== en, start: e.start, end: e.end, location: e.location || '', color: g.color, group: g.name, leave: tr && tr.leaveAt && !tr.same && (d.settings.travel || {}).enabled ? tr.leaveAt.slice(11, 16) : null });
      }
      for (const p of d.projects) { if (p.status === 'archiviato') continue; for (const st of p.steps) if (st.due && st.due.slice(0, 10) === k) items.push({ type: 'st', id: st.id, pid: p.id, title: st.text, start: st.due, done: !!st.done, auto: !!st.auto, project: p.title, color: '#8e8e93' }); }
      items.sort((a, b) => (a.allDay ? '0' : a.start).localeCompare(b.allDay ? '0' : b.start));
      days.push({ date: k, items });
    }
    const late = d.projects.filter(p => p.status !== 'archiviato').flatMap(p => p.steps.filter(st => !st.done && st.due && st.due.slice(0, 10) < dk(now)).map(st => ({ id: st.id, pid: p.id, title: st.text, start: st.due, project: p.title })));
    const projects = d.projects.filter(p => p.status === 'attivo').map(p => ({ id: p.id, title: p.title, open: p.steps.filter(s => !s.done).length, next: (p.steps.filter(s => !s.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))[0] || {}).text || '' }));
    const trips = Object.values(d.trips || {}).filter(t => t.start && (t.end || t.start).slice(0, 10) >= dk(now)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3).map(t => ({ name: t.name, icon: t.icon, start: t.start, end: t.end, stops: t.items.length }));
    return { name: d.settings.userName || '', accent: d.settings.accent || '#e5562a', at: new Date().toISOString(), days, late, projects, trips, projectsAll: d.projects.filter(p => p.status !== 'archiviato').map(p => ({ id: p.id, title: p.title })) };
  }

  function handler(req, res) {
    const u = new URL(req.url, 'http://x');
    // l'app Android (origine http://localhost) parla con il computer: consento solo le sue origini
    const origin = req.headers.origin || '';
    if (/^(https?|capacitor):\/\/localhost(:\d+)?$/.test(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Headers', 'X-Promemo-Key, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST'); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const send = (code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    if (req.method === 'GET' && FILES[u.pathname]) {
      const [f, type] = FILES[u.pathname];
      try { return send(200, fs.readFileSync(path.join(ctx.root, f)), type); } catch { return send(404, 'non trovato', 'text/plain'); }
    }
    if (!u.pathname.startsWith('/api/')) return send(404, { error: 'non trovato' });
    const ip = req.socket.remoteAddress || '';
    if (blocked(ip)) return send(429, { error: 'Troppi tentativi con una chiave sbagliata: riprova tra 10 minuti' });
    if (!tokenOk(req)) { fail(ip); return send(401, { error: 'Abbina di nuovo il telefono dalle impostazioni di Promemo' }); }
    fails.delete(ip);
    if (!ctx.data()) return send(423, { error: 'Promemo è bloccata sul computer' });
    seen[(req.headers['user-agent'] || '').slice(0, 80)] = new Date().toISOString();
    if (req.method === 'GET' && u.pathname === '/api/state') return send(200, state());
    if (req.method === 'GET' && u.pathname === '/api/sync/config') {
      if (!ctx.sync || !ctx.sync.enabled()) return send(409, { error: 'Attiva la sincronizzazione nelle impostazioni di Promemo sul computer' });
      return Promise.resolve(ctx.sync.config()).then(c => send(200, { cloud: c, desktop: ctx.sync.state().dev }));
    }
    if (req.method !== 'POST') return send(405, { error: 'metodo non ammesso' });
    let body = '';
    const limit = u.pathname === '/api/sync' ? 30 * 1024 * 1024 : 20000;
    let tooBig = false;
    req.on('data', (c) => { if (tooBig) return; body += c; if (body.length > limit) { tooBig = true; send(413, { error: 'richiesta troppo grande' }); req.destroy(); } });
    req.on('end', () => {
      if (tooBig) return;
      let j = {}; try { j = JSON.parse(body || '{}'); } catch { return send(400, { error: 'richiesta non valida' }); }
      try {
        if (u.pathname === '/api/sync') {
          if (!ctx.sync || !ctx.sync.enabled()) return send(409, { error: 'Attiva la sincronizzazione nelle impostazioni di Promemo sul computer' });
          const n = j.state ? ctx.sync.merge(j.state) : 0;
          return send(200, { ok: true, merged: n, state: ctx.sync.state() });
        }
        if (u.pathname === '/api/agent/chat') {
          if (!ctx.agentChat) return send(404, { error: 'non disponibile' });
          return Promise.resolve(ctx.agentChat(String(j.text || ''), Array.isArray(j.history) ? j.history : [])).then(t => t ? send(200, { ok: true, text: t }) : send(409, { error: 'Sul computer non è configurato un motore IA' })).catch(e => send(502, { error: e.message }));
        }
        if (u.pathname === '/api/add') { const r = ctx.quickAdd(String(j.text || ''), { pid: j.pid }); return send(200, { ok: true, title: r.title, text: r.text }); }
        if (u.pathname === '/api/step') {
          const p = ctx.data().projects.find(x => x.id === j.pid); const st = p && p.steps.find(x => x.id === j.id);
          if (!st) return send(404, { error: 'compito non trovato' });
          st.done = !!j.done; st.doneAt = st.done ? new Date().toISOString().slice(0, 16) : null; st.qrev = (ctx.data().rev || 0) + 1;
          if (st.done) p.traces.push({ id: crypto.randomBytes(5).toString('hex'), title: `Fatto: ${st.text}`, body: 'dal telefono', at: st.doneAt });
          ctx.commit(); return send(200, { ok: true });
        }
        send(404, { error: 'non trovato' });
      } catch (e) { send(400, { error: e.message }); }
    });
  }

  function stop() { if (server) { server.close(); server = null; port = null; } }
  function start() {
    const c = cfg();
    if (!c.enabled || !c.token) { stop(); return; }
    if (server && port === c.port) return;
    stop();
    lastErr = '';
    server = http.createServer(handler);
    server.on('error', (e) => { lastErr = e.code === 'EADDRINUSE' ? `La porta ${c.port} è già usata da un altro programma` : e.message; server = null; port = null; ctx.onChange && ctx.onChange(); });
    server.listen(c.port, '0.0.0.0', () => { port = c.port; ctx.onChange && ctx.onChange(); });
  }
  function status() {
    const c = cfg();
    return { enabled: c.enabled, running: !!(server && port), port: c.port, error: lastErr, addresses: lanAddresses().map(a => ({ ...a, url: `http://${a.ip}:${c.port}/#k=${c.token}` })), seen };
  }
  return { start, stop, status, lanAddresses };
}

module.exports = { createMobile };
