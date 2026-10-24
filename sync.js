// Promemo — sincronizzazione con Google Calendar, Notion e calendari .ics
'use strict';
const http = require('http');
const crypto = require('crypto');
const { parseICS } = require('./ics');
const { createExtraProviders } = require('./providers2');

const GAPI = process.env.PROMEMO_GOOGLE_API || 'https://www.googleapis.com';
const GAUTH = process.env.PROMEMO_GOOGLE_AUTH || 'https://accounts.google.com/o/oauth2/v2/auth';
const GTOKEN = process.env.PROMEMO_GOOGLE_TOKEN || 'https://oauth2.googleapis.com/token';
const NAPI = process.env.PROMEMO_NOTION_API || 'https://api.notion.com';
const NVER = '2022-06-28';
const CAPI = process.env.PROMEMO_CALENDLY_API || 'https://api.calendly.com';
const GSCOPE = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

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
const coreHash = (e) => crypto.createHash('sha1').update(JSON.stringify(CORE.map(k => e[k] ?? '')) + (e.rrule ? JSON.stringify(e.rrule) : '')).digest('hex').slice(0, 16);

async function readJson(res) {
  const t = await res.text();
  try { return t ? JSON.parse(t) : null; } catch { return { raw: t }; }
}

// Colori delle opzioni Notion → tavolozza di Promemo
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

  // accesso OAuth (PKCE, redirect su 127.0.0.1): restituisce i token
  async function googleAuth(clientId, clientSecret, scope) {
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
        res.end(`<!doctype html><meta charset="utf-8"><title>Promemo</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#1d1d1f;background:#f5f4f1"><div style="text-align:center"><div style="font-size:42px">${ok ? '✓' : '✕'}</div><h2>${ok ? 'Account collegato' : 'Accesso non riuscito'}</h2><p>Puoi chiudere questa scheda e tornare a Promemo.</p></div>`);
        clearTimeout(timer); server.close();
        ok ? resolve(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error') === 'access_denied' ? 'Accesso negato.' : 'Risposta di Google non valida.'));
      });
      const url = `${GAUTH}?` + new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state });
      ctx.openExternal(url);
    });
    const res = await fetch(GTOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret || '', redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }),
    });
    const j = await readJson(res);
    if (!res.ok) throw new Error(`Google: ${j?.error_description || j?.error || res.status}`);
    return j;
  }

  async function googleConnect({ clientId, clientSecret, mail }) {
    if (!clientId) throw new Error('Inserisci il Client ID.');
    const j = await googleAuth(clientId, clientSecret, GSCOPE + (mail ? ' ' + GMAIL_SCOPE : ''));
    const id = 'acc-' + uid();
    ctx.setSecret(id, { client_id: clientId, client_secret: clientSecret, refresh_token: j.refresh_token, access_token: j.access_token, expiry: Date.now() + (j.expires_in || 3600) * 1000 });
    const acc = { id, provider: 'google', name: 'Google', enabled: true, defaultReminder: 15, calendars: [] };
    if (mail && String(j.scope || '').includes(GMAIL_SCOPE)) acc.mail = { enabled: true };
    try {
      await refreshGoogleCalendars(acc);
    } catch (e) { ctx.removeSecret(id); throw e; }
    const d = ctx.data(); d.accounts.push(acc); ctx.commit();
    syncAll();
    return acc;
  }

  // aggiunge (o toglie) la lettura della posta a un account Google già collegato
  async function googleGrantMail(accId) {
    const d = ctx.data(), acc = d.accounts.find(a => a.id === accId && a.provider === 'google');
    if (!acc) throw new Error('Account Google non trovato');
    const s = ctx.secret(acc.id) || {};
    if (!s.client_id) throw new Error('Credenziali dell’account mancanti: ricollegalo.');
    const j = await googleAuth(s.client_id, s.client_secret, GSCOPE + ' ' + GMAIL_SCOPE);
    if (!String(j.scope || '').includes(GMAIL_SCOPE)) throw new Error('Google non ha concesso la lettura della posta: abilita la Gmail API e il permesso gmail.readonly nel tuo progetto.');
    ctx.setSecret(acc.id, { ...s, refresh_token: j.refresh_token || s.refresh_token, access_token: j.access_token, expiry: Date.now() + (j.expires_in || 3600) * 1000 });
    acc.mail = { ...(acc.mail || {}), enabled: true, grantedAt: new Date().toISOString() };
    ctx.commit();
    return acc;
  }
  async function gFetchAcc(accId, path) { const acc = ctx.data().accounts.find(a => a.id === accId); if (!acc) throw new Error('Account non trovato'); return gFetch(acc, path); }

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
      // le ripetizioni create in Promemo restano una sola serie (Google le restituisce già espanse)
      const own = new Map(ctx.data().events.filter(x => x.rrule && x.source && x.source.acc === acc.id && x.source.cal === cal.id).map(x => [x.source.rid, x]));
      for (const ev of j.items || []) {
        if (ev.recurringEventId && own.has(ev.recurringEventId)) {
          const x = own.get(ev.recurringEventId);
          if (!items.some(i => i.rid === ev.recurringEventId)) items.push({ rid: ev.recurringEventId, title: x.title, start: x.start, end: x.end, allDay: x.allDay, location: x.location || '', notes: x.notes || '', url: x.source.url || '', group: cal.id, keep: true });
          continue;
        }
        if (ev.status === 'cancelled' || !ev.start) continue;
        if (skipCalendlyCopy((ev.description || '') + ' ' + (ev.location || ''))) continue;
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
      ...(e.rrule ? { recurrence: [require('./src/recur.js').toRRULE(e.rrule), ...(e.rrule.exdates || []).map(x => e.allDay ? `EXDATE;VALUE=DATE:${x.replace(/-/g, '')}` : `EXDATE;TZID=${Intl.DateTimeFormat().resolvedOptions().timeZone}:${x.replace(/-/g, '')}T${e.start.slice(11, 16).replace(':', '')}00`)] } : {}),
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

  async function notionInspect({ token, database, fromAcc }) {
    if (!token && fromAcc) token = ctx.secret(fromAcc)?.token;
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

  // cambia le colonne usate per un database già collegato
  async function setNotionMap(accId, m) {
    const info = await notionProps(accId);
    const acc = ctx.data().accounts.find(a => a.id === accId);
    const type = (n) => (info.props.find(p => p.name === n) || {}).type || '';
    if (m.dateProp && type(m.dateProp) !== 'date') throw new Error('La colonna della data deve essere di tipo Data');
    Object.assign(acc.config, { titleProp: m.titleProp || acc.config.titleProp, dateProp: m.dateProp || acc.config.dateProp, locProp: m.locProp || '', notesProp: m.notesProp || '', durProp: m.durProp || '', hideProps: m.hideProps || [], checked: true });
    acc.config.locType = type(acc.config.locProp); acc.config.notesType = type(acc.config.notesProp);
    ctx.commit();
    await syncAll(accId);
    return acc;
  }

  async function notionConnect({ token, fromAcc, databaseId, title, titleProp, dateProp, locProp, notesProp, colorProp, durProp }) {
    if (!dateProp) throw new Error('Scegli la proprietà data.');
    if (!token && fromAcc) token = ctx.secret(fromAcc)?.token;
    if (!token) throw new Error('Token Notion mancante.');
    const dup = ctx.data().accounts.find(a => a.provider === 'notion' && a.calendars.some(c => c.id.replace(/-/g, '') === String(databaseId).replace(/-/g, '')));
    if (dup) throw new Error(`Questo database è già in Agenda come “${dup.name}”.`);
    const id = 'acc-' + uid();
    ctx.setSecret(id, { token });
    const acc = { id, provider: 'notion', name: title, enabled: true, defaultReminder: null,
      calendars: [{ id: databaseId, name: title, color: '#37352f', enabled: true, writable: true }],
      config: { titleProp, dateProp, locProp: locProp || '', notesProp: notesProp || '', colorProp: '', ...(durProp !== undefined ? { durProp: durProp || '' } : {}) }, groups: [] };
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
  function nGroup(prop, rel) {
    if (!prop) return '';
    if (prop.select) return prop.select.name || '';
    if (prop.status) return prop.status.name || '';
    if (Array.isArray(prop.multi_select)) return prop.multi_select[0]?.name || '';
    if (Array.isArray(prop.relation)) { const id = prop.relation[0] && prop.relation[0].id; return id ? (rel && rel[id] && rel[id] !== '—' ? rel[id] : '…' + id) : ''; }
    if (prop.type === 'rollup') return (nValue(prop, () => '').split(', ')[0] || '');
    return '';
  }
  function nText(prop) {
    if (!prop) return '';
    if (prop.rich_text) return plain(prop.rich_text);
    if (prop.title) return plain(prop.title);
    if (prop.select) return prop.select.name || '';
    if (typeof prop.url === 'string') return prop.url;
    if (prop.place) return [prop.place.name, prop.place.address].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ');
    return '';
  }
  // qualsiasi colonna in testo leggibile (per la scheda dell'evento)
  function nValue(prop, rel) {
    if (!prop) return '';
    switch (prop.type) {
      case 'title': return plain(prop.title);
      case 'rich_text': return plain(prop.rich_text);
      case 'select': return prop.select ? prop.select.name : '';
      case 'status': return prop.status ? prop.status.name : '';
      case 'multi_select': return (prop.multi_select || []).map(o => o.name).join(', ');
      case 'number': return prop.number == null ? '' : String(prop.number).replace('.', ',');
      case 'checkbox': return prop.checkbox ? 'Sì' : '';
      case 'url': return prop.url || '';
      case 'email': return prop.email || '';
      case 'phone_number': return prop.phone_number || '';
      case 'place': return nText(prop);
      case 'people': return (prop.people || []).map(p => p.name || '').filter(Boolean).join(', ');
      case 'relation': return (prop.relation || []).map(r => rel(r.id)).filter(Boolean).join(', ');
      case 'formula': { const f = prop.formula || {}; return f.type === 'string' ? f.string || '' : f.type === 'number' ? (f.number == null ? '' : String(f.number)) : f.type === 'boolean' ? (f.boolean ? 'Sì' : '') : f.type === 'date' && f.date ? f.date.start : ''; }
      case 'rollup': { const r = prop.rollup || {}; if (r.type === 'number') return r.number == null ? '' : String(r.number); if (r.type === 'date') return r.date ? r.date.start : ''; return [...new Set((r.array || []).map(x => nValue(x, rel)).filter(Boolean).flatMap(x => x.split(', ')))].join(', '); }
      case 'date': return prop.date ? prop.date.start.replace('T', ' ').slice(0, 16) : '';
      case 'unique_id': return prop.unique_id ? `${prop.unique_id.prefix ? prop.unique_id.prefix + '-' : ''}${prop.unique_id.number}` : '';
      default: return '';
    }
  }
  // minuti da una colonna "durata" (numero, scelta, testo: "90", "1,5 h", "45 min")
  function nMinutes(prop, name) {
    const v = nValue(prop, () => '').split(',')[0].trim(); if (!v) return 0;
    const n = parseFloat(v.replace(',', '.')); if (!isFinite(n) || n <= 0) return 0;
    const hours = /\bh\b|ore|ora/i.test(v) || (/\bore\b|hours?/i.test(name) && !/min/i.test(name) && n <= 12);
    return Math.round(hours ? n * 60 : n);
  }
  const LOC_NAME = /^(luogo|location|dove|aula|sede|indirizzo|posto|place|venue)$/i;
  const DUR_NAME = /durata|ore previste|minuti|duration|\bmin\b/i;

  const notion = {
    async pull(acc, cal) {
      const token = ctx.secret(acc.id)?.token;
      const { from } = windowRange();
      const c = acc.config, items = [];
      const rel = c.relNames = c.relNames || {}, needRel = new Set();
      let cursor;
      do {
        const body = { page_size: 100, filter: { property: c.dateProp, date: { on_or_after: dayStr(from) } } };
        if (cursor) body.start_cursor = cursor;
        const j = await nFetch(token, `/v1/databases/${cal.id}/query`, { method: 'POST', body: JSON.stringify(body) });
        for (const p of j.results || []) {
          if (p.archived || p.in_trash) continue;
          // colonne riconosciute dal nome la prima volta (il luogo non deve essere un'altra colonna, la durata si usa per la fine)
          if (!c.checked) {
            const P = p.properties, byName = (re, types) => Object.keys(P).find(k => re.test(k.trim()) && types.includes(P[k].type));
            const loc = c.locProp && P[c.locProp];
            if ((!c.locProp || (loc && !['place', 'rich_text'].includes(loc.type))) && byName(LOC_NAME, ['place', 'rich_text', 'select'])) c.locProp = byName(LOC_NAME, ['place', 'rich_text', 'select']);
            if (c.durProp === undefined) c.durProp = byName(DUR_NAME, ['number', 'select', 'multi_select', 'rich_text', 'formula']) || '';
            c.locType = c.locProp && P[c.locProp] ? P[c.locProp].type : '';
            c.notesType = c.notesProp && P[c.notesProp] ? P[c.notesProp].type : '';
            if (c.hideProps === undefined) c.hideProps = Object.keys(P).filter(k => ['formula', 'created_time', 'last_edited_time', 'created_by', 'last_edited_by', 'button', 'files'].includes(P[k].type));
            c.checked = true;
          }
          const dp = p.properties[c.dateProp];
          if (!dp || !dp.date || !dp.date.start) continue;
          const titleProp = c.titleProp && p.properties[c.titleProp] ? p.properties[c.titleProp] : Object.values(p.properties).find(x => x.type === 'title' || Array.isArray(x.title));
          const when = nDateToLocal(dp.date);
          const mins = c.durProp && !dp.date.end && !when.allDay ? nMinutes(p.properties[c.durProp], c.durProp) : 0;
          if (mins) when.end = localISO(new Date(parseLocal(when.start).getTime() + mins * 60000));
          // tutte le altre colonne, per la scheda
          const skip = new Set([c.titleProp, c.dateProp, c.locProp, c.notesProp, ...(c.hideProps || [])].filter(Boolean));
          const props = [];
          for (const [k, v] of Object.entries(p.properties)) {
            if (skip.has(k) || v.type === 'title') continue;
            if (v.type === 'relation') for (const r of v.relation || []) if (!rel[r.id]) needRel.add(r.id);
          if (k === c.colorProp && v.type === 'relation') for (const r of v.relation || []) if (!rel[r.id]) needRel.add(r.id);
            props.push([k, v]);
          }
          items.push({ rid: p.id, title: nText(titleProp) || '(senza titolo)', ...when, location: c.locProp ? nText(p.properties[c.locProp]) : '', notes: c.notesProp ? nText(p.properties[c.notesProp]) : '', url: p.url || '', group: c.colorProp ? nGroup(p.properties[c.colorProp], rel) : '', _props: props, _colorRel: c.colorProp && p.properties[c.colorProp] && p.properties[c.colorProp].type === 'relation', extra: { durMin: mins || undefined } });
        }
        cursor = j.has_more ? j.next_cursor : null;
      } while (cursor);
      // nomi delle pagine collegate (es. Materia), una volta sola
      for (const id of [...needRel].slice(0, 40)) {
        try { const pg = await nFetch(token, `/v1/pages/${id}`); const t = Object.values(pg.properties || {}).find(x => x.type === 'title'); rel[id] = (t && plain(t.title)) || '—'; } catch { rel[id] = '—'; }
      }
      for (const it of items) {
        if (it._colorRel && it.group && it.group.startsWith('…')) { const id = it.group.slice(1); it.group = rel[id] && rel[id] !== '—' ? rel[id] : ''; }
        delete it._colorRel;
        it.extra.props = it._props.map(([k, v]) => ({ n: k, v: nValue(v, (id) => rel[id] && rel[id] !== '—' ? rel[id] : '') })).filter(x => x.v);
        delete it._props;
      }
      return items;
    },
    props(acc, e) {
      const c = acc.config;
      const s = parseLocal(e.start), en = parseLocal(e.end || e.start);
      const date = e.allDay
        ? { start: dayStr(s), end: dayStr(en) !== dayStr(s) ? dayStr(en) : null }
        : { start: isoOffset(s), end: en > s ? isoOffset(en) : null };
      // se la fine viene dalla durata, su Notion resta solo l'inizio
      const dm = e.source && e.source.extra && e.source.extra.durMin;
      if (!e.allDay && dm && en.getTime() - s.getTime() === dm * 60000) date.end = null;
      const props = { [c.titleProp]: { title: [{ text: { content: e.title } }] }, [c.dateProp]: { date } };
      // il luogo si scrive solo se la colonna è di testo (un luogo di Notion richiede le coordinate)
      if (c.locProp && (!c.locType || c.locType === 'rich_text')) props[c.locProp] = { rich_text: [{ text: { content: e.location || '' } }] };
      if (c.locProp && c.locType === 'select' && e.location) props[c.locProp] = { select: { name: e.location.slice(0, 100) } };
      if (c.notesProp && (!c.notesType || c.notesType === 'rich_text')) props[c.notesProp] = { rich_text: [{ text: { content: (e.notes || '').slice(0, 1900) } }] };
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

  // ---------------- Calendly (sola lettura) ----------------
  // Calendly scrive anche nel calendario collegato (Google/Outlook): se Calendly è collegato
  // direttamente, quelle copie vengono nascoste per non vedere ogni appuntamento due volte.
  function skipCalendlyCopy(text) {
    const on = (ctx.data().accounts || []).some(a => a.provider === 'calendly' && a.enabled && a.config?.dedupe !== false);
    return on && /calendly\.com/i.test(text || '');
  }

  async function cFetch(token, path) {
    const res = await fetch(path.startsWith('http') ? path : CAPI + path, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    const j = await readJson(res);
    if (res.status === 401) throw new Error('Token Calendly non valido o revocato (succede anche se cambi password o metodo di accesso): generane uno nuovo.');
    if (!res.ok) throw new Error(`Calendly: ${j?.message || j?.title || res.status}`);
    return j;
  }

  async function calendlyConnect({ token, dedupe }) {
    if (!token) throw new Error('Incolla il token personale di Calendly.');
    const me = await cFetch(token, '/users/me');
    const u = me.resource;
    const id = 'acc-' + uid();
    ctx.setSecret(id, { token });
    const acc = { id, provider: 'calendly', name: u.email || u.name || 'Calendly', enabled: true, defaultReminder: 60, user: u.uri,
      calendars: [{ id: 'calendly', name: 'Calendly', color: '#1a73e8', enabled: true, writable: false }],
      groups: [], config: { dedupe: dedupe !== false, link: u.scheduling_url || '' } };
    const d = ctx.data(); d.accounts.push(acc); ctx.commit();
    syncAll();
    return acc;
  }

  function cLocation(l) {
    if (!l) return '';
    if (l.location) return l.location;
    if (l.join_url) return 'Online · ' + l.join_url;
    const T = { google_conference: 'Google Meet', zoom: 'Zoom', microsoft_teams_conference: 'Microsoft Teams', webex_conference: 'Webex', outbound_call: 'Telefonata', inbound_call: 'Telefonata', ask_invitee: 'Da definire' };
    return T[l.type] || '';
  }

  const calendly = {
    async pull(acc) {
      const token = ctx.secret(acc.id)?.token;
      const { from, to } = windowRange();
      // gli slot fissi (orari di disponibilità): servono all'assistente per accorgersi degli impegni che Calendly non vede
      try {
        const av = await cFetch(token, '/user_availability_schedules?' + new URLSearchParams({ user: acc.user }));
        acc.slots = { at: new Date().toISOString(), schedules: (av.collection || []).map(s => ({ name: s.name, default: !!s.default, timezone: s.timezone, rules: (s.rules || []).map(r => ({ type: r.type, wday: r.wday, date: r.date, intervals: (r.intervals || []).map(i => ({ from: i.from, to: i.to })) })) })) };
      } catch (e) { acc.slots = { ...(acc.slots || {}), error: e.message }; }
      const known = new Map(ctx.data().events.filter(e => e.source && e.source.acc === acc.id && e.source.extra).map(e => [e.source.rid, e.source.extra]));
      const items = [];
      let invErr = '';
      let url = '/scheduled_events?' + new URLSearchParams({ user: acc.user, min_start_time: from.toISOString(), max_start_time: to.toISOString(), status: 'active', count: '100', sort: 'start_time:asc' });
      let guard = 0;
      while (url && guard++ < 30) {
        const j = await cFetch(token, url);
        for (const ev of j.collection || []) {
          const rid = ev.uri.split('/').pop();
          // chi ha prenotato: lo rileggo se manca (prima un errore lo lasciava vuoto per sempre)
          let inv = known.get(rid);
          if (!inv || !inv.v2 || !(inv.list || []).length) {
            try {
              const ij = await cFetch(token, `/scheduled_events/${rid}/invitees?count=10&status=active`);
              const list = (ij.collection || []).map(x => ({ name: x.name || [x.first_name, x.last_name].filter(Boolean).join(' '), email: x.email || '', qa: (x.questions_and_answers || []).sort((a, b) => (a.position || 0) - (b.position || 0)).map(q => `${q.question}: ${q.answer}`), cancel: x.cancel_url || '', reschedule: x.reschedule_url || '' }));
              inv = { list, v2: true };
            } catch (e) { invErr = e.message; inv = { list: [] }; }
          }
          const first = inv.list[0];
          const who = inv.list.map(x => x.name).filter(Boolean).join(', ');
          // la materia (o l'argomento) dalle risposte al modulo di prenotazione
          const SUBJ = /materi|argoment|corso|esame|insegnament|disciplin|subject|topic|cosa vuoi|di cosa/i;
          const qa = first ? first.qa.map(x => { const i = x.indexOf(': '); return [x.slice(0, i), x.slice(i + 2)]; }) : [];
          const subj = ((qa.find(([q, a]) => SUBJ.test(q) && a && a.length < 80) || [])[1] || '').trim();
          inv.subject = subj;
          const notes = [
            ...inv.list.map(x => `Con: ${x.name}${x.email ? ' <' + x.email + '>' : ''}${x.qa.length ? '\n' + x.qa.join('\n') : ''}`),
            first && first.reschedule ? `Sposta: ${first.reschedule}` : '',
            first && first.cancel ? `Annulla: ${first.cancel}` : '',
          ].filter(Boolean).join('\n');
          items.push({
            rid, title: [ev.name, who, subj].filter(Boolean).join(' · '),
            start: localISO(new Date(ev.start_time)), end: localISO(new Date(ev.end_time)), allDay: false,
            location: cLocation(ev.location), notes, url: first?.reschedule || '', group: ev.name, extra: inv,
          });
        }
        url = j.pagination && j.pagination.next_page ? j.pagination.next_page : null;
      }
      acc.warn = invErr ? (/403|permess|permission|scope|forbidden|unauthori/i.test(invErr) ? 'Non posso leggere chi ha prenotato: rigenera il token di Calendly con il permesso di lettura degli invitati (scheduled_events / invitees).' : `Partecipanti non letti: ${invErr}`) : '';
      return items;
    },
  };

  const ics = {
    async pull(acc) {
      const res = await fetch(acc.url);
      if (!res.ok) throw new Error(`Calendario non raggiungibile (${res.status}).`);
      const { from, to } = windowRange();
      return parseICS(await res.text(), from, to).map(o => ({
        rid: o.rid, title: o.title, start: localISO(o.start), end: o.allDay ? dayStr(o.end) + 'T23:59' : localISO(o.end),
        allDay: o.allDay, location: o.location, notes: o.notes, url: '', group: o.category || 'ics',
      })).filter(o => !skipCalendlyCopy(o.notes + ' ' + o.location));
    },
  };

  const extra = createExtraProviders({ ...ctx, ensureGroup, syncAll: (id) => syncAll(id), log: ctx.log || { warn: console.warn, info() {}, error: console.error } });
  const providers = { google, notion, ics, calendly, ...extra.providers };

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
        if (it.extra) e.source.extra = it.extra;
        // se l'evento ha modifiche locali non ancora inviate, non lo sovrascrivo
        if (coreHash(e) !== e.source.hash && acc.provider !== 'ics') continue;
        if (e.start !== core.start || e.allDay !== core.allDay) delete e.notifiedAt;
        Object.assign(e, core);
        e.source.hash = coreHash(e); e.source.url = it.url;
      } else {
        const multi = it.start.slice(0, 10) !== it.end.slice(0, 10);
        const ne = { id: 'e-' + uid(), kind: it.allDay && multi ? 'evento' : 'appuntamento', projectId: '', reminder: it.allDay ? null : (acc.defaultReminder ?? null), ...core, source: { acc: accId, cal: calId, rid: it.rid, url: it.url, rev, group: grp.id, ...(it.extra ? { extra: it.extra } : {}) } };
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
    if (p.refresh) { try { await p.refresh(acc); } catch (e) { /* elenco calendari non critico */ } }
    if (p.syncTasks) await p.syncTasks(acc);
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
          console.warn(`sincronizzazione ${a ? a.provider + ' «' + a.name + '»' : id}: ${a ? a.error : e.message}`);
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

  return { caldavConnect: extra.caldavConnect, outlookConnect: extra.outlookConnect, calcomConnect: extra.calcomConnect, todoistConnect: extra.todoistConnect, setNotionMap, syncAll, googleConnect, googleGrantMail, gFetchAcc, notionInspect, notionConnect, icsConnect, disconnect, reconcile, refreshGoogleCalendars, calendlyConnect, notionProps, setNotionColorProp, ensureGroup };
}

module.exports = { createSync, coreHash };
