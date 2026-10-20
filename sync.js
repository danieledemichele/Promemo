// Trama — sincronizzazione con Google Calendar, Notion e calendari .ics
'use strict';
const http = require('http');
const crypto = require('crypto');
const { parseICS } = require('./ics');

const GAPI = process.env.TRAMA_GOOGLE_API || 'https://www.googleapis.com';
const GAUTH = process.env.TRAMA_GOOGLE_AUTH || 'https://accounts.google.com/o/oauth2/v2/auth';
const GTOKEN = process.env.TRAMA_GOOGLE_TOKEN || 'https://oauth2.googleapis.com/token';
const NAPI = process.env.TRAMA_NOTION_API || 'https://api.notion.com';
const NVER = '2022-06-28';
const GSCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events';

const pad = (n) => String(n).padStart(2, '0');
const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayStr = (d) => localISO(d).slice(0, 10);
const uid = () => crypto.randomBytes(6).toString('hex');
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function isoOffset(d) {
  const o = -d.getTimezoneOffset(), s = o >= 0 ? '+' : '-', a = Math.abs(o);
  return `${localISO(d)}:00${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parseLocal = (s) => new Date(s.length === 10 ? s + 'T00:00' : s);

function windowRange() {
  const now = new Date();
  return { from: addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -60), to: addDays(now, 400) };
}

// campi "condivisi" con il servizio esterno: se cambiano, l'evento va inviato
const CORE = ['title', 'start', 'end', 'allDay', 'location', 'notes'];
const coreHash = (e) => crypto.createHash('sha1').update(JSON.stringify(CORE.map(k => e[k] ?? ''))).digest('hex').slice(0, 16);

async function readJson(res) {
  const t = await res.text();
  try { return t ? JSON.parse(t) : null; } catch { return { raw: t }; }
}

// Colori delle opzioni Notion → tavolozza di Trama
const NOTION_COLORS = { default: '#8e8e93', gray: '#8e8e93', brown: '#a0785a', orange: '#f08a24', yellow: '#d9a50b', green: '#34a853', blue: '#0a84ff', purple: '#8e5bd9', pink: '#e0569b', red: '#e5484d' };
const AUTO = ['#e5484d', '#0a84ff', '#34a853', '#f08a24', '#8e5bd9', '#5ac8fa', '#e0569b', '#d9a50b', '#1f9aa5', '#a0785a'];

// garantisce che il gruppo esista nell'account (lo crea con un colore sensato)
function ensureGroup(acc, id, name, color) {
  acc.groups = acc.groups || [];
  let g = acc.groups.find(x => x.id === id);
  if (!g) {
    g = { id, name: name || id, color: color || AUTO[acc.groups.length % AUTO.length], visible: true };
    acc.groups.push(g);
  }
  return g;
}

function createSync(ctx) {
  // ctx: data(), commit(), secret(id), setSecret(id, obj), removeSecret(id), openExternal(url), status(obj)
  let running = false, again = false;

  // ---------------- Google ----------------
  async function gToken(acc) {
    const s = ctx.secret(acc.id);
    if (!s || !s.refresh_token) throw new Error('Account Google non autorizzato: ricollegalo.');
    if (s.access_token && s.expiry > Date.now() + 60000) return s.access_token;
    const res = await fetch(GTOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: s.client_id, client_secret: s.client_secret || '', refresh_token: s.refresh_token, grant_type: 'refresh_token' }),
    });
    const j = await readJson(res);
    if (!res.ok) throw new Error(j?.error === 'invalid_grant' ? 'Accesso a Google scaduto o revocato: ricollega l’account.' : `Google: ${j?.error_description || j?.error || res.status}`);
    ctx.setSecret(acc.id, { ...s, access_token: j.access_token, expiry: Date.now() + (j.expires_in || 3600) * 1000 });
    return j.access_token;
  }

  async function gFetch(acc, path, opts = {}) {
    const token = await gToken(acc);
    const res = await fetch(GAPI + path, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (res.status === 204) return null;
    const j = await readJson(res);
    if (res.status === 404 || res.status === 410) { const e = new Error('non trovato'); e.gone = true; throw e; }
    if (!res.ok) throw new Error(`Google: ${j?.error?.message || res.status}`);
    return j;
  }

  async function googleConnect({ clientId, clientSecret }) {
    if (!clientId) throw new Error('Inserisci il Client ID.');
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const server = http.createServer();
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const redirect = `http://127.0.0.1:${server.address().port}`;
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { server.close(); reject(new Error('Tempo scaduto: accesso non completato.')); }, 5 * 60000);
      server.on('request', (req, res) => {
        const u = new URL(req.url, redirect);
        if (u.pathname !== '/') { res.writeHead(404); return res.end(); }
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Trama</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#1d1d1f;background:#f5f4f1"><div style="text-align:center"><div style="font-size:42px">${ok ? '✓' : '✕'}</div><h2>${ok ? 'Account collegato' : 'Accesso non riuscito'}</h2><p>Puoi chiudere questa scheda e tornare a Trama.</p></div>`);
        clearTimeout(timer); server.close();
        ok ? resolve(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error') === 'access_denied' ? 'Accesso negato.' : 'Risposta di Google non valida.'));
      });
      const url = `${GAUTH}?` + new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: GSCOPE, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state });
      ctx.openExternal(url);
    });
    const res = await fetch(GTOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret || '', redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }),
    });
    const j = await readJson(res);
    if (!res.ok) throw new Error(`Google: ${j?.error_description || j?.error || res.status}`);
    const id = 'acc-' + uid();
    ctx.setSecret(id, { client_id: clientId, client_secret: clientSecret, refresh_token: j.refresh_token, access_token: j.access_token, expiry: Date.now() + (j.expires_in || 3600) * 1000 });
    const acc = { id, provider: 'google', name: 'Google', enabled: true, defaultReminder: 15, calendars: [] };
    try {
      await refreshGoogleCalendars(acc);
    } catch (e) { ctx.removeSecret(id); throw e; }
    const d = ctx.data(); d.accounts.push(acc); ctx.commit();
    syncAll();
    return acc;
  }

  async function refreshGoogleCalendars(acc) {
    const j = await gFetch(acc, '/calendar/v3/users/me/calendarList?maxResults=250');
    const prev = new Map((acc.calendars || []).map(c => [c.id, c]));
    acc.calendars = (j.items || []).map(c => ({
      id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor || '#4285f4',
      enabled: prev.has(c.id) ? prev.get(c.id).enabled : !!c.primary,
      writable: ['owner', 'writer'].includes(c.accessRole), primary: !!c.primary,
    })).sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name));
    const primary = acc.calendars.find(c => c.primary);
    if (primary) acc.name = primary.id;
    for (const c of acc.calendars) ensureGroup(acc, c.id, c.name, c.color);
  }

  function gToLocal(t, isEnd) {
    if (t.date) { const d = parseLocal(t.date); return { s: dayStr(isEnd ? addDays(d, -1) : d) + (isEnd ? 'T23:59' : 'T00:00'), allDay: true }; }
    return { s: localISO(new Date(t.dateTime)), allDay: false };
  }

  async function googlePull(acc, cal) {
    const { from, to } = windowRange();
    const items = [];
    let pageToken = '';
    do {
      const q = new URLSearchParams({ singleEvents: 'true', timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: '2500', showDeleted: 'false' });
      if (pageToken) q.set('pageToken', pageToken);
      const j = await gFetch(acc, `/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
      for (const ev of j.items || []) {
        if (ev.status === 'cancelled' || !ev.start) continue;
        const s = gToLocal(ev.start, false), e = gToLocal(ev.end || ev.start, true);
        items.push({ rid: ev.id, title: ev.summary || '(senza titolo)', start: s.s, end: e.s, allDay: s.allDay, location: ev.location || '', notes: (ev.description || '').replace(/<[^>]+>/g, '').slice(0, 4000), url: ev.htmlLink || '', group: cal.id });
      }
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return items;
  }

  function gBody(e) {
    const s = parseLocal(e.start), en = parseLocal(e.end || e.start);
    return {
      summary: e.title, location: e.location || '', description: e.notes || '',
      start: e.allDay ? { date: dayStr(s) } : { dateTime: isoOffset(s) },
      end: e.allDay ? { date: dayStr(addDays(en, 1)) } : { dateTime: isoOffset(en < s ? s : en) },
    };
  }

  const google = {
    pull: googlePull,
    create: async (acc, cal, e) => { const j = await gFetch(acc, `/calendar/v3/calendars/${encodeURIComponent(cal)}/events`, { method: 'POST', body: JSON.stringify(gBody(e)) }); return { rid: j.id, url: j.htmlLink }; },
    update: async (acc, cal, rid, e) => { await gFetch(acc, `/calendar/v3/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(rid)}`, { method: 'PATCH', body: JSON.stringify(gBody(e)) }); },
    remove: async (acc, cal, rid) => { await gFetch(acc, `/calendar/v3/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(rid)}`, { method: 'DELETE' }); },
  };

  // ---------------- Notion ----------------
  async function nFetch(token, path, opts = {}) {
    const res = await fetch(NAPI + path, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NVER, 'Content-Type': 'application/json' } });
    const j = await readJson(res);
    if (res.status === 404) { const e = new Error(j?.message || 'Database non trovato: hai condiviso il database con l’integrazione?'); e.gone = true; throw e; }
    if (res.status === 401) throw new Error('Token Notion non valido.');
    if (!res.ok) throw new Error(`Notion: ${j?.message || res.status}`);
    return j;
  }
  const notionId = (s) => {
    const seg = String(s).trim().split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop();
    const uuid = seg.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    if (uuid) return uuid[0].replace(/-/g, '');
    const m = seg.match(/([0-9a-f]{32})$/i);
    return m ? m[1] : null;
  };
  const plain = (arr) => (arr || []).map(t => t.plain_text || t.text?.content || '').join('');

  async function notionInspect({ token, database }) {
    const id = notionId(database);
    if (!token) throw new Error('Inserisci il token dell’integrazione.');
    if (!id) throw new Error('Link o ID del database non valido.');
    const db = await nFetch(token, `/v1/databases/${id}`);
    return { id, title: plain(db.title) || 'Database Notion', props: Object.entries(db.properties).map(([name, p]) => ({ name, type: p.type, options: (p[p.type] && p[p.type].options || []).map(o => ({ name: o.name, color: o.color })) })) };
  }

  // colonne disponibili per un database già collegato
  async function notionProps(accId) {
    const acc = ctx.data().accounts.find(a => a.id === accId);
    if (!acc || acc.provider !== 'notion') throw new Error('Account Notion non trovato');
    return notionInspect({ token: ctx.secret(acc.id)?.token, database: acc.calendars[0].id });
  }

  // imposta la colonna da cui prendere i colori e crea i gruppi dalle sue opzioni
  async function setNotionColorProp(accId, prop) {
    const info = await notionProps(accId);
    const acc = ctx.data().accounts.find(a => a.id === accId);
    acc.config.colorProp = prop || '';
    const keep = new Map((acc.groups || []).map(g => [g.id, g]));
    acc.groups = [];
    const p = info.props.find(x => x.name === prop);
    for (const o of (p ? p.options : [])) {
      const old = keep.get(o.name);
      acc.groups.push(old || { id: o.name, name: o.name, color: NOTION_COLORS[o.color] || AUTO[acc.groups.length % AUTO.length], visible: true });
    }
    ensureGroup(acc, '', prop ? 'Senza ' + prop.toLowerCase() : acc.name, keep.get('')?.color || '#8e8e93');
    // riassegna subito i gruppi agli eventi alla prossima sincronizzazione
    ctx.data().events.forEach(e => { if (e.source && e.source.acc === accId) e.source.group = null; });
    ctx.commit();
    await syncAll(accId);
    return acc;
  }

  async function notionConnect({ token, databaseId, title, titleProp, dateProp, locProp, notesProp, colorProp }) {
    if (!dateProp) throw new Error('Scegli la proprietà data.');
    const id = 'acc-' + uid();
    ctx.setSecret(id, { token });
    const acc = { id, provider: 'notion', name: title, enabled: true, defaultReminder: null,
      calendars: [{ id: databaseId, name: title, color: '#37352f', enabled: true, writable: true }],
      config: { titleProp, dateProp, locProp: locProp || '', notesProp: notesProp || '', colorProp: '' }, groups: [] };
    const d = ctx.data(); d.accounts.push(acc); ctx.commit();
    if (colorProp) await setNotionColorProp(id, colorProp);
    else { ensureGroup(acc, '', title, '#8e8e93'); syncAll(); }
    return acc;
  }

  function nDateToLocal(date) {
    const allDay = date.start.length === 10;
    if (allDay) return { allDay, start: date.start + 'T00:00', end: (date.end || date.start).slice(0, 10) + 'T23:59' };
    const s = new Date(date.start);
    const e = date.end ? new Date(date.end) : new Date(s.getTime() + 3600000);
    return { allDay, start: localISO(s), end: localISO(e) };
  }
  function nGroup(prop) {
    if (!prop) return '';
    if (prop.select) return prop.select.name || '';
    if (prop.status) return prop.status.name || '';
    if (Array.isArray(prop.multi_select)) return prop.multi_select[0]?.name || '';
    return '';
  }
  function nText(prop) {
    if (!prop) return '';
    if (prop.rich_text) return plain(prop.rich_text);
    if (prop.title) return plain(prop.title);
    if (prop.select) return prop.select.name || '';
    if (typeof prop.url === 'string') return prop.url;
    if (prop.place) return prop.place.name || prop.place.address || '';
    return '';
  }

  const notion = {
    async pull(acc, cal) {
      const token = ctx.secret(acc.id)?.token;
      const { from } = windowRange();
      const c = acc.config, items = [];
      let cursor;
      do {
        const body = { page_size: 100, filter: { property: c.dateProp, date: { on_or_after: dayStr(from) } } };
        if (cursor) body.start_cursor = cursor;
        const j = await nFetch(token, `/v1/databases/${cal.id}/query`, { method: 'POST', body: JSON.stringify(body) });
        for (const p of j.results || []) {
          if (p.archived || p.in_trash) continue;
          const dp = p.properties[c.dateProp];
          if (!dp || !dp.date || !dp.date.start) continue;
          const titleProp = c.titleProp && p.properties[c.titleProp] ? p.properties[c.titleProp] : Object.values(p.properties).find(x => x.type === 'title' || Array.isArray(x.title));
          items.push({ rid: p.id, title: nText(titleProp) || '(senza titolo)', ...nDateToLocal(dp.date), location: c.locProp ? nText(p.properties[c.locProp]) : '', notes: c.notesProp ? nText(p.properties[c.notesProp]) : '', url: p.url || '', group: c.colorProp ? nGroup(p.properties[c.colorProp]) : '' });
        }
        cursor = j.has_more ? j.next_cursor : null;
      } while (cursor);
      return items;
    },
    props(acc, e) {
      const c = acc.config;
      const s = parseLocal(e.start), en = parseLocal(e.end || e.start);
      const date = e.allDay
        ? { start: dayStr(s), end: dayStr(en) !== dayStr(s) ? dayStr(en) : null }
        : { start: isoOffset(s), end: en > s ? isoOffset(en) : null };
      const props = { [c.titleProp]: { title: [{ text: { content: e.title } }] }, [c.dateProp]: { date } };
      if (c.locProp) props[c.locProp] = { rich_text: [{ text: { content: e.location || '' } }] };
      if (c.notesProp) props[c.notesProp] = { rich_text: [{ text: { content: (e.notes || '').slice(0, 1900) } }] };
      return props;
    },
    async create(acc, cal, e) {
      const j = await nFetch(ctx.secret(acc.id)?.token, '/v1/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: cal }, properties: notion.props(acc, e) }) });
      return { rid: j.id, url: j.url };
    },
    async update(acc, cal, rid, e) { await nFetch(ctx.secret(acc.id)?.token, `/v1/pages/${rid}`, { method: 'PATCH', body: JSON.stringify({ properties: notion.props(acc, e) }) }); },
    async remove(acc, cal, rid) { await nFetch(ctx.secret(acc.id)?.token, `/v1/pages/${rid}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }); },
  };

  // ---------------- ICS (sola lettura) ----------------
  async function icsConnect({ name, url, color }) {
    let u = String(url || '').trim().replace(/^webcals?:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(u)) throw new Error('Indirizzo non valido: deve iniziare con https:// o webcal://');
    const res = await fetch(u);
    if (!res.ok) throw new Error(`Impossibile scaricare il calendario (${res.status}).`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Il link non restituisce un calendario .ics.');
    const calName = (text.match(/X-WR-CALNAME:(.+)/) || [])[1]?.trim();
    const id = 'acc-' + uid();
    const acc = { id, provider: 'ics', name: name || calName || new URL(u).hostname, enabled: true, defaultReminder: null, url: u,
      calendars: [{ id: 'ics', name: name || calName || 'Calendario', color: color || '#8e5bd9', enabled: true, writable: false }],
      groups: [{ id: 'ics', name: name || calName || 'Calendario', color: color || '#8e5bd9', visible: true }] };
    const d = ctx.data(); d.accounts.push(acc); ctx.commit();
    syncAll();
    return acc;
  }

  const ics = {
    async pull(acc) {
      const res = await fetch(acc.url);
      if (!res.ok) throw new Error(`Calendario non raggiungibile (${res.status}).`);
      const { from, to } = windowRange();
      return parseICS(await res.text(), from, to).map(o => ({
        rid: o.rid, title: o.title, start: localISO(o.start), end: o.allDay ? dayStr(o.end) + 'T23:59' : localISO(o.end),
        allDay: o.allDay, location: o.location, notes: o.notes, url: '', group: o.category || 'ics',
      }));
    },
  };

  const providers = { google, notion, ics };

  // ---------------- Unione dei dati ----------------
  function merge(accId, calId, items) {
    const d = ctx.data();
    const acc = d.accounts.find(a => a.id === accId);
    if (!acc) return;
    const { from } = windowRange();
    const existing = d.events.filter(e => e.source && e.source.acc === accId && e.source.cal === calId);
    const byRid = new Map(existing.map(e => [e.source.rid, e]));
    const seen = new Set();
    const rev = (d.rev || 0) + 1;
    for (const it of items) {
      if (seen.has(it.rid)) continue;
      seen.add(it.rid);
      const core = { title: it.title, start: it.start, end: it.end, allDay: it.allDay, location: it.location, notes: it.notes };
      const e = byRid.get(it.rid);
      const gid = it.group ?? calId;
      const gname = gid === '' ? acc.name : acc.provider === 'google' ? ((acc.calendars.find(c => c.id === calId) || {}).name || gid) : acc.provider === 'ics' && gid === 'ics' ? acc.calendars[0].name : gid;
      const grp = ensureGroup(acc, gid, gname, acc.provider === 'google' ? (acc.calendars.find(c => c.id === calId) || {}).color : null);
      if (e) {
        e.source.group = grp.id;
        // se l'evento ha modifiche locali non ancora inviate, non lo sovrascrivo
        if (coreHash(e) !== e.source.hash && acc.provider !== 'ics') continue;
        if (e.start !== core.start || e.allDay !== core.allDay) delete e.notifiedAt;
        Object.assign(e, core);
        e.source.hash = coreHash(e); e.source.url = it.url;
      } else {
        const multi = it.start.slice(0, 10) !== it.end.slice(0, 10);
        const ne = { id: 'e-' + uid(), kind: it.allDay && multi ? 'evento' : 'appuntamento', projectId: '', reminder: it.allDay ? null : (acc.defaultReminder ?? null), ...core, source: { acc: accId, cal: calId, rid: it.rid, url: it.url, rev, group: grp.id } };
        ne.source.hash = coreHash(ne);
        d.events.push(ne);
      }
    }
    // eventi spariti dal servizio (solo nella finestra sincronizzata)
    d.events = d.events.filter(e => {
      if (!e.source || e.source.acc !== accId || e.source.cal !== calId) return true;
      if (seen.has(e.source.rid)) return true;
      if (!e.source.rid) return true; // in attesa di creazione
      return parseLocal(e.end || e.start) < from;
    });
  }

  // invia modifiche locali in sospeso
  async function pushPending(acc) {
    const p = providers[acc.provider];
    if (!p.create) return;
    const d = ctx.data();
    // eliminazioni
    for (const del of (d.pendingDeletes || []).filter(x => x.acc === acc.id)) {
      try { await p.remove(acc, del.cal, del.rid); } catch (e) { if (!e.gone) throw e; }
      const dd = ctx.data(); dd.pendingDeletes = (dd.pendingDeletes || []).filter(x => x !== del && !(x.acc === del.acc && x.rid === del.rid));
    }
    // creazioni e modifiche
    for (const ev of d.events.slice()) {
      const target = ev.source && ev.source.acc === acc.id ? ev.source : (ev.pushTo && ev.pushTo.acc === acc.id ? ev.pushTo : null);
      if (!target) continue;
      const cal = acc.calendars.find(c => c.id === target.cal);
      if (!cal || !cal.writable) continue;
      const hash = coreHash(ev);
      if (ev.source && ev.source.rid) {
        if (hash === ev.source.hash) continue;
        try { await p.update(acc, cal.id, ev.source.rid, ev); }
        catch (e) { if (e.gone) { const r = await p.create(acc, cal.id, ev); Object.assign(fresh(ev.id)?.source || {}, r); } else throw e; }
        const f = fresh(ev.id); if (f && f.source) f.source.hash = hash;
      } else {
        const r = await p.create(acc, cal.id, ev);
        const f = fresh(ev.id);
        if (f) { f.source = { acc: acc.id, cal: cal.id, rid: r.rid, url: r.url || '', hash: coreHash(f) === hash ? hash : 'stale', rev: (ctx.data().rev || 0) + 1 }; delete f.pushTo; }
      }
    }
  }
  const fresh = (id) => ctx.data().events.find(e => e.id === id);

  async function syncAccount(acc) {
    const p = providers[acc.provider];
    if (!p) return;
    await pushPending(acc);
    if (acc.provider === 'google') { try { await refreshGoogleCalendars(acc); } catch (e) { /* elenco calendari non critico */ } }
    for (const cal of acc.calendars.filter(c => c.enabled)) {
      const items = await p.pull(acc, cal);
      merge(acc.id, cal.id, items);
    }
    // calendari disattivati: rimuovo gli eventi importati
    const off = new Set(acc.calendars.filter(c => !c.enabled).map(c => c.id));
    const d = ctx.data();
    d.events = d.events.filter(e => !(e.source && e.source.acc === acc.id && off.has(e.source.cal) && e.source.rid));
  }

  async function syncAll(onlyId) {
    if (running) { again = true; return; }
    running = true;
    ctx.status({ syncing: true });
    try {
      const d = ctx.data();
      for (const acc of (d.accounts || []).filter(a => a.enabled && (!onlyId || a.id === onlyId))) {
        const id = acc.id;
        try {
          await syncAccount(acc);
          const a = ctx.data().accounts.find(x => x.id === id);
          if (a) { a.lastSync = localISO(new Date()); a.error = ''; }
        } catch (e) {
          const a = ctx.data().accounts.find(x => x.id === id);
          if (a) a.error = e.cause ? `Rete non raggiungibile (${e.cause.code || e.message})` : e.message;
        }
        ctx.commit();
      }
    } finally {
      running = false;
      ctx.status({ syncing: false });
      if (again) { again = false; setTimeout(() => syncAll(), 500); }
    }
  }

  function disconnect(accId, removeEvents) {
    const d = ctx.data();
    d.accounts = d.accounts.filter(a => a.id !== accId);
    d.pendingDeletes = (d.pendingDeletes || []).filter(x => x.acc !== accId);
    if (removeEvents) d.events = d.events.filter(e => !(e.source && e.source.acc === accId));
    else d.events.forEach(e => { if (e.source && e.source.acc === accId) delete e.source; if (e.pushTo && e.pushTo.acc === accId) delete e.pushTo; });
    ctx.removeSecret(accId);
    ctx.commit();
  }

  // Riconcilia i dati inviati dall'interfaccia con quelli correnti (che la sync può aver aggiornato)
  function reconcile(cur, incoming) {
    const base = incoming.rev || 0;
    const curById = new Map(cur.events.map(e => [e.id, e]));
    const inIds = new Set(incoming.events.map(e => e.id));
    for (const e of incoming.events) {
      const c = curById.get(e.id);
      if (c && c.source && c.source.rid && (!e.source || e.source.rid !== c.source.rid)) { e.source = { ...c.source, hash: e.source?.rid ? e.source.hash : c.source.hash }; delete e.pushTo; }
      if (c && c.source && e.source && c.source.rid === e.source.rid && coreHash(e) === coreHash(c)) e.source.hash = c.source.hash;
    }
    for (const c of cur.events) {
      if (inIds.has(c.id) || !c.source || !c.source.rid) continue;
      if ((c.source.rev || 0) > base) { incoming.events.push(c); continue; } // arrivato dopo: lo tengo
      const acc = cur.accounts.find(a => a.id === c.source.acc);
      const cal = acc && acc.calendars.find(x => x.id === c.source.cal);
      if (cal && cal.writable) (incoming.pendingDeletes = incoming.pendingDeletes || cur.pendingDeletes || []).push({ acc: c.source.acc, cal: c.source.cal, rid: c.source.rid });
    }
    incoming.accounts = cur.accounts; // gli account li gestisce solo il processo principale
    if (!incoming.pendingDeletes) incoming.pendingDeletes = cur.pendingDeletes || [];
    incoming.rev = (cur.rev || 0) + 1;
    const needsPush = incoming.events.some(e => e.pushTo || (e.source && e.source.rid && coreHash(e) !== e.source.hash)) || incoming.pendingDeletes.length;
    return { data: incoming, needsPush: !!needsPush };
  }

  return { syncAll, googleConnect, notionInspect, notionConnect, icsConnect, disconnect, reconcile, refreshGoogleCalendars, notionProps, setNotionColorProp, ensureGroup };
}

module.exports = { createSync, coreHash };
