// Promemo — altri servizi: CalDAV (iCloud, Nextcloud, Fastmail, Yahoo, Zoho, mailbox.org, Posteo, Synology…),
// Outlook / Microsoft 365 (Graph), Cal.com (prenotazioni) e Todoist (compiti, nei due sensi)
'use strict';
const http = require('http');
const crypto = require('crypto');
const { parseICS } = require('./ics');

const GRAPH = process.env.PROMEMO_GRAPH_API || 'https://graph.microsoft.com/v1.0';
const MSAUTH = process.env.PROMEMO_MS_AUTH || 'https://login.microsoftonline.com/common/oauth2/v2.0';
const CALCOM = process.env.PROMEMO_CALCOM_API || 'https://api.cal.com/v2';
const TODOIST = process.env.PROMEMO_TODOIST_API || 'https://api.todoist.com/api/v1';
const MS_SCOPE = 'offline_access User.Read Calendars.ReadWrite';

const CALDAV_PRESETS = {
  icloud: { name: 'iCloud', url: 'https://caldav.icloud.com/', help: 'Usa il tuo Apple ID e una password specifica per app (appleid.apple.com → Accesso e sicurezza → Password specifiche per le app).' },
  nextcloud: { name: 'Nextcloud', url: '', help: 'Indirizzo del tuo Nextcloud (es. https://cloud.esempio.it): aggiungo io /remote.php/dav. Meglio una password per app (Impostazioni → Sicurezza).' },
  fastmail: { name: 'Fastmail', url: 'https://caldav.fastmail.com/dav/', help: 'Crea una password per app in Impostazioni → Privacy e sicurezza → Password per app (accesso Calendari).' },
  yahoo: { name: 'Yahoo', url: 'https://caldav.calendar.yahoo.com/', help: 'Serve una password per app generata da Sicurezza dell’account Yahoo.' },
  zoho: { name: 'Zoho Calendar', url: 'https://calendar.zoho.eu/caldav/', help: 'Per account .com usa https://calendar.zoho.com/caldav/. Serve una password per app.' },
  mailbox: { name: 'mailbox.org', url: 'https://dav.mailbox.org/caldav/', help: 'Email e password di mailbox.org (o una password per app).' },
  posteo: { name: 'Posteo', url: 'https://posteo.de:8443/', help: 'Email e password di Posteo.' },
  synology: { name: 'Synology', url: '', help: 'Indirizzo del NAS con il pacchetto Calendar, es. https://nas.local:5001/caldav/.' },
  caldav: { name: 'CalDAV', url: '', help: 'Qualsiasi server CalDAV (Radicale, Baïkal, SOGo, Kerio…): indirizzo, utente e password.' },
};

const pad = (n) => String(n).padStart(2, '0');
const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayStr = (d) => localISO(d).slice(0, 10);
const parseLocal = (s) => new Date(s.length === 10 ? s + 'T00:00' : s);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const uid = () => crypto.randomBytes(6).toString('hex');
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TZ = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';
async function readJson(res) { const t = await res.text(); try { return t ? JSON.parse(t) : null; } catch { return { raw: t }; } }
function windowRange() { const now = new Date(); return { from: addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -60), to: addDays(now, 400) }; }

// ---------- XML minimo per le risposte WebDAV ----------
const xmlDecode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '\r').replace(/&#10;/g, '\n').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const tagRe = (name) => new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i');
const tag = (xml, name) => { const m = String(xml).match(tagRe(name)); return m ? m[1] : null; };
const hasTag = (xml, name) => new RegExp(`<(?:[\\w-]+:)?${name}[\\s/>]`, 'i').test(String(xml));
function responses(xml) {
  const out = []; const re = /<(?:[\w-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi; let m;
  while ((m = re.exec(xml))) out.push({ href: xmlDecode((tag(m[1], 'href') || '').trim()), body: m[1] });
  return out;
}

// ---------- iCalendar in uscita ----------
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const icsUTC = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
function fold(line) { const out = []; let s = line; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = ' ' + s.slice(n); } out.push(s); return out.join('\r\n'); }
function toICS(e, uidv) {
  const s = parseLocal(e.start), en = parseLocal(e.end || e.start);
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Promemo//IT', 'BEGIN:VEVENT', `UID:${uidv}`, `DTSTAMP:${icsUTC(new Date())}`];
  if (e.allDay) { L.push(`DTSTART;VALUE=DATE:${icsDate(s)}`, `DTEND;VALUE=DATE:${icsDate(addDays(en, 1))}`); }
  else { L.push(`DTSTART:${icsUTC(s)}`, `DTEND:${icsUTC(en < s ? s : en)}`); }
  L.push(`SUMMARY:${icsEsc(e.title)}`);
  if (e.location) L.push(`LOCATION:${icsEsc(e.location)}`);
  if (e.notes) L.push(`DESCRIPTION:${icsEsc(e.notes)}`);
  L.push('END:VEVENT', 'END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

function createExtraProviders(ctx) {
  // ctx: data(), commit(), secret(id), setSecret(id, v), removeSecret(id), openExternal(url), ensureGroup(acc, id, name, color), syncAll(id), log
  // ================= CalDAV =================
  const auth = (s) => 'Basic ' + Buffer.from(`${s.user}:${s.password}`).toString('base64');
  async function dav(s, url, method, body, depth, extra = {}) {
    const res = await fetch(url, { method, headers: { Authorization: auth(s), 'Content-Type': 'application/xml; charset=utf-8', ...(depth != null ? { Depth: String(depth) } : {}), ...extra }, body, redirect: 'follow' });
    if (res.status === 401 || res.status === 403) throw new Error('Utente o password non accettati dal server CalDAV (per iCloud, Yahoo e Fastmail serve una password per app).');
    return res;
  }
  const abs = (base, href) => new URL(href, base).toString();
  async function davDiscover(s) {
    let start = s.url;
    if (s.preset === 'nextcloud' && !/remote\.php\/dav/.test(start)) start = start.replace(/\/+$/, '') + '/remote.php/dav/';
    const P1 = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
    let principal = null;
    for (const u of [start, abs(start, '/.well-known/caldav')]) {
      try {
        const r = await dav(s, u, 'PROPFIND', P1, 0);
        if (r.status >= 400) continue;
        const x = await r.text(); const h = tag(tag(x, 'current-user-principal') || '', 'href');
        if (h) { principal = abs(r.url || u, xmlDecode(h.trim())); break; }
      } catch (e) { if (/password/.test(e.message)) throw e; }
    }
    if (!principal) throw new Error('Non trovo il calendario a questo indirizzo: controlla l’indirizzo del server.');
    const r2 = await dav(s, principal, 'PROPFIND', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/><d:displayname/></d:prop></d:propfind>', 0);
    const x2 = await r2.text();
    const homeH = tag(tag(x2, 'calendar-home-set') || '', 'href');
    if (!homeH) throw new Error('Il server non indica dove sono i calendari.');
    const home = abs(principal, xmlDecode(homeH.trim()));
    const r3 = await dav(s, home, 'PROPFIND', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>', 1);
    const cals = [];
    for (const it of responses(await r3.text())) {
      if (!hasTag(tag(it.body, 'resourcetype') || '', 'calendar')) continue;
      const comps = tag(it.body, 'supported-calendar-component-set');
      if (comps && !/VEVENT/i.test(comps)) continue;
      const priv = tag(it.body, 'current-user-privilege-set');
      const color = (xmlDecode(tag(it.body, 'calendar-color') || '').trim().match(/^#[0-9a-f]{6}/i) || [])[0];
      cals.push({ id: abs(home, it.href), name: xmlDecode(tag(it.body, 'displayname') || '').trim() || it.href.split('/').filter(Boolean).pop(), color: color || '#8e5bd9', writable: !priv || /<(?:[\w-]+:)?(write|write-content|all)\b/i.test(priv) });
    }
    if (!cals.length) throw new Error('Nessun calendario trovato per questo utente.');
    return { principal, home, cals };
  }
  async function caldavConnect({ preset = 'caldav', url, user, password }) {
    const p = CALDAV_PRESETS[preset] || CALDAV_PRESETS.caldav;
    const base = String(url || p.url || '').trim();
    if (!/^https?:\/\//i.test(base)) throw new Error('Inserisci l’indirizzo del server (https://…).');
    if (!user || !password) throw new Error('Inserisci utente e password.');
    const s = { preset, url: base, user: String(user).trim(), password: String(password) };
    const info = await davDiscover(s);
    const id = 'acc-' + uid();
    ctx.setSecret(id, s);
    const acc = { id, provider: 'caldav', name: `${p.name} · ${s.user}`, enabled: true, defaultReminder: 15, config: { preset, home: info.home },
      calendars: info.cals.map((c, i) => ({ ...c, enabled: i === 0 || info.cals.length <= 4 })), groups: [] };
    for (const c of acc.calendars) ctx.ensureGroup(acc, c.id, c.name, c.color);
    const d = ctx.data(); d.accounts.push(acc); ctx.commit();
    ctx.syncAll(id);
    return acc;
  }
  const caldav = {
    async pull(acc, cal) {
      const s = ctx.secret(acc.id); if (!s) throw new Error('Credenziali mancanti: ricollega l’account.');
      const { from, to } = windowRange();
      const body = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${icsUTC(from)}" end="${icsUTC(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
      const r = await dav(s, cal.id, 'REPORT', body, 1);
      if (r.status >= 400) throw new Error(`CalDAV: ${r.status}`);
      const items = [];
      for (const it of responses(await r.text())) {
        const data = xmlDecode(tag(it.body, 'calendar-data') || ''); if (!data) continue;
        const etag = xmlDecode(tag(it.body, 'getetag') || '').trim();
        const href = abs(cal.id, it.href);
        const rec = /^RRULE:/m.test(data) || /^RECURRENCE-ID/m.test(data);
        for (const o of parseICS(data, from, to)) {
          items.push({ rid: rec ? `${href}#${o.start.getTime()}` : href, title: o.title || '(senza titolo)', start: localISO(o.start), end: o.allDay ? dayStr(addDays(o.end, 0)) + 'T23:59' : localISO(o.end), allDay: o.allDay, location: o.location || '', notes: o.notes || '', url: '', group: cal.id, extra: { etag, uid: o.uid, ...(rec ? { ro: true } : {}) } });
        }
      }
      return items;
    },
    async create(acc, cal, e) {
      const s = ctx.secret(acc.id), u = crypto.randomUUID ? crypto.randomUUID() : uid() + uid();
      const href = cal.replace(/\/?$/, '/') + u + '.ics';
      const r = await dav(s, href, 'PUT', toICS(e, u), null, { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' });
      if (r.status >= 400) throw new Error(`CalDAV: creazione non riuscita (${r.status})`);
      return { rid: href, url: '' };
    },
    async update(acc, cal, rid, e) {
      if (rid.includes('#')) return; // una ripetizione: si modifica nel servizio
      const s = ctx.secret(acc.id), u = (e.source && e.source.extra && e.source.extra.uid) || rid.split('/').pop().replace(/\.ics$/, '');
      const r = await dav(s, rid, 'PUT', toICS(e, u), null, { 'Content-Type': 'text/calendar; charset=utf-8' });
      if (r.status === 404 || r.status === 410) { const x = new Error('non trovato'); x.gone = true; throw x; }
      if (r.status >= 400) throw new Error(`CalDAV: modifica non riuscita (${r.status})`);
    },
    async remove(acc, cal, rid) {
      if (rid.includes('#')) return;
      const r = await dav(ctx.secret(acc.id), rid, 'DELETE', null, null);
      if (r.status >= 400 && r.status !== 404 && r.status !== 410) throw new Error(`CalDAV: eliminazione non riuscita (${r.status})`);
    },
  };

  // ================= Outlook / Microsoft 365 =================
  async function msAuth(clientId) {
    const verifier = b64url(crypto.randomBytes(32)), challenge = b64url(crypto.createHash('sha256').update(verifier).digest()), state = b64url(crypto.randomBytes(16));
    const server = http.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
    const redirect = `http://localhost:${server.address().port}`;
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { server.close(); reject(new Error('Tempo scaduto: accesso non completato.')); }, 5 * 60000);
      server.on('request', (req, res) => {
        const u = new URL(req.url, redirect); if (u.pathname !== '/') { res.writeHead(404); return res.end(); }
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Promemo</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh"><div style="text-align:center"><div style="font-size:42px">${ok ? '✓' : '✕'}</div><h2>${ok ? 'Account collegato' : 'Accesso non riuscito'}</h2><p>Puoi chiudere questa scheda e tornare a Promemo.</p></div>`);
        clearTimeout(timer); server.close();
        ok ? resolve(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error_description') || 'Accesso negato.'));
      });
      ctx.openExternal(`${MSAUTH}/authorize?` + new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirect, response_mode: 'query', scope: MS_SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' }));
    });
    const res = await fetch(`${MSAUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier, scope: MS_SCOPE }) });
    const j = await readJson(res);
    if (!res.ok) throw new Error(`Microsoft: ${j?.error_description || j?.error || res.status}`);
    return j;
  }
  async function msToken(acc) {
    const s = ctx.secret(acc.id); if (!s || !s.refresh_token) throw new Error('Account Microsoft non autorizzato: ricollegalo.');
    if (s.access_token && s.expiry > Date.now() + 60000) return s.access_token;
    const res = await fetch(`${MSAUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: s.client_id, grant_type: 'refresh_token', refresh_token: s.refresh_token, scope: MS_SCOPE }) });
    const j = await readJson(res);
    if (!res.ok) throw new Error(j?.error === 'invalid_grant' ? 'Accesso a Microsoft scaduto: ricollega l’account.' : `Microsoft: ${j?.error_description || res.status}`);
    ctx.setSecret(acc.id, { ...s, access_token: j.access_token, refresh_token: j.refresh_token || s.refresh_token, expiry: Date.now() + (j.expires_in || 3600) * 1000 });
    return j.access_token;
  }
  async function gr(acc, path, opts = {}) {
    const res = await fetch(path.startsWith('http') ? path : GRAPH + path, { ...opts, headers: { Authorization: `Bearer ${await msToken(acc)}`, 'Content-Type': 'application/json', Prefer: `outlook.timezone="${TZ()}"`, ...(opts.headers || {}) } });
    if (res.status === 204) return null;
    const j = await readJson(res);
    if (res.status === 404 || res.status === 410) { const e = new Error('non trovato'); e.gone = true; throw e; }
    if (!res.ok) throw new Error(`Outlook: ${j?.error?.message || res.status}`);
    return j;
  }
  async function outlookCalendars(acc) {
    const j = await gr(acc, '/me/calendars?$top=100');
    const prev = new Map((acc.calendars || []).map(c => [c.id, c]));
    acc.calendars = (j.value || []).map(c => ({ id: c.id, name: c.name, color: /^#/.test(c.hexColor || '') ? c.hexColor : '#0f6cbd', writable: c.canEdit !== false, primary: !!c.isDefaultCalendar, enabled: prev.has(c.id) ? prev.get(c.id).enabled : !!c.isDefaultCalendar }));
    for (const c of acc.calendars) ctx.ensureGroup(acc, c.id, c.name, c.color);
  }
  async function outlookConnect({ clientId }) {
    if (!clientId) throw new Error('Inserisci l’ID applicazione (client).');
    const j = await msAuth(String(clientId).trim());
    const id = 'acc-' + uid();
    ctx.setSecret(id, { client_id: String(clientId).trim(), refresh_token: j.refresh_token, access_token: j.access_token, expiry: Date.now() + (j.expires_in || 3600) * 1000 });
    const acc = { id, provider: 'outlook', name: 'Outlook', enabled: true, defaultReminder: 15, calendars: [], groups: [] };
    try { const me = await gr(acc, '/me?$select=mail,userPrincipalName,displayName'); acc.name = me.mail || me.userPrincipalName || 'Outlook'; await outlookCalendars(acc); }
    catch (e) { ctx.removeSecret(id); throw e; }
    const d = ctx.data(); d.accounts.push(acc); ctx.commit();
    ctx.syncAll(id);
    return acc;
  }
  const msLocal = (t) => (t && t.dateTime ? t.dateTime.slice(0, 16) : '');
  const msBody = (e) => {
    const s = parseLocal(e.start), en = parseLocal(e.end || e.start);
    return { subject: e.title, body: { contentType: 'text', content: e.notes || '' }, location: { displayName: e.location || '' }, isAllDay: !!e.allDay,
      start: { dateTime: e.allDay ? dayStr(s) + 'T00:00:00' : localISO(s) + ':00', timeZone: TZ() },
      end: { dateTime: e.allDay ? dayStr(addDays(en, 1)) + 'T00:00:00' : localISO(en < s ? s : en) + ':00', timeZone: TZ() } };
  };
  const outlook = {
    async refresh(acc) { await outlookCalendars(acc); },
    async pull(acc, cal) {
      const { from, to } = windowRange();
      let url = `/me/calendars/${encodeURIComponent(cal.id)}/calendarView?` + new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $top: '500', $select: 'id,subject,start,end,isAllDay,location,bodyPreview,webLink,type,isCancelled' });
      const items = []; let guard = 0;
      while (url && guard++ < 40) {
        const j = await gr(acc, url);
        for (const ev of j.value || []) {
          if (ev.isCancelled) continue;
          const allDay = !!ev.isAllDay;
          const start = allDay ? msLocal(ev.start).slice(0, 10) + 'T00:00' : msLocal(ev.start);
          const end = allDay ? dayStr(addDays(parseLocal(msLocal(ev.end).slice(0, 10)), -1)) + 'T23:59' : msLocal(ev.end);
          items.push({ rid: ev.id, title: ev.subject || '(senza titolo)', start, end, allDay, location: (ev.location && ev.location.displayName) || '', notes: ev.bodyPreview || '', url: ev.webLink || '', group: cal.id, extra: ev.type === 'occurrence' ? { ro: true } : undefined });
        }
        url = j['@odata.nextLink'] || null;
      }
      return items;
    },
    create: async (acc, cal, e) => { const j = await gr(acc, `/me/calendars/${encodeURIComponent(cal)}/events`, { method: 'POST', body: JSON.stringify(msBody(e)) }); return { rid: j.id, url: j.webLink || '' }; },
    update: async (acc, cal, rid, e) => { await gr(acc, `/me/events/${encodeURIComponent(rid)}`, { method: 'PATCH', body: JSON.stringify(msBody(e)) }); },
    remove: async (acc, cal, rid) => { await gr(acc, `/me/events/${encodeURIComponent(rid)}`, { method: 'DELETE' }); },
  };

  // ================= Cal.com (sola lettura) =================
  async function cc(key, path) {
    const res = await fetch(path.startsWith('http') ? path : CALCOM + path, { headers: { Authorization: `Bearer ${key}`, 'cal-api-version': '2024-08-13' } });
    const j = await readJson(res);
    if (res.status === 401 || res.status === 403) throw new Error('Chiave API di Cal.com non valida.');
    if (!res.ok) throw new Error(`Cal.com: ${j?.error?.message || j?.message || res.status}`);
    return j;
  }
  async function calcomConnect({ apiKey }) {
    const key = String(apiKey || '').trim(); if (!key) throw new Error('Incolla la chiave API di Cal.com.');
    let name = 'Cal.com';
    try { const me = await fetch(CALCOM + '/me', { headers: { Authorization: `Bearer ${key}`, 'cal-api-version': '2024-06-11' } }).then(readJson); name = (me && me.data && (me.data.email || me.data.username)) || name; } catch { /* */ }
    await cc(key, '/bookings?take=1');
    const id = 'acc-' + uid();
    ctx.setSecret(id, { token: key });
    const acc = { id, provider: 'calcom', name, enabled: true, defaultReminder: 60, calendars: [{ id: 'calcom', name: 'Cal.com', color: '#292929', enabled: true, writable: false }], groups: [] };
    const d = ctx.data(); d.accounts.push(acc); ctx.commit();
    ctx.syncAll(id);
    return acc;
  }
  const calcom = {
    async pull(acc) {
      const key = ctx.secret(acc.id)?.token; const { from, to } = windowRange();
      const items = []; let skip = 0, guard = 0;
      for (;;) {
        const j = await cc(key, '/bookings?' + new URLSearchParams({ afterStart: from.toISOString(), beforeEnd: to.toISOString(), take: '100', skip: String(skip) }));
        for (const b of j.data || []) {
          if (/cancel|reject/i.test(b.status || '')) continue;
          const list = (b.attendees || []).map(a => ({ name: a.name || '', email: a.email || '', qa: Object.entries(b.bookingFieldsResponses || {}).filter(([k, v]) => !['name', 'email', 'guests', 'location'].includes(k) && v && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`) }));
          const who = list.map(x => x.name).filter(Boolean).join(', ');
          items.push({ rid: String(b.uid || b.id), title: who && !String(b.title || '').includes(who) ? `${b.title} · ${who}` : (b.title || 'Prenotazione'), start: localISO(new Date(b.start)), end: localISO(new Date(b.end)), allDay: false, location: b.meetingUrl ? 'Online · ' + b.meetingUrl : (typeof b.location === 'string' ? b.location : ''), notes: list.map(x => `Con: ${x.name}${x.email ? ' <' + x.email + '>' : ''}${x.qa.length ? '\n' + x.qa.join('\n') : ''}`).join('\n'), url: '', group: (b.eventType && b.eventType.slug) || 'Cal.com', extra: { list } });
        }
        if (!(j.pagination && j.pagination.hasNextPage) || guard++ > 20) break;
        skip += 100;
      }
      return items;
    },
  };

  // ================= Todoist (compiti nei due sensi) =================
  async function td(token, body) {
    const res = await fetch(TODOIST + '/sync', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await readJson(res);
    if (res.status === 401 || res.status === 403) throw new Error('Token di Todoist non valido.');
    if (!res.ok) throw new Error(`Todoist: ${j?.error || res.status}`);
    return j;
  }
  async function todoistConnect({ token }) {
    const t = String(token || '').trim(); if (!t) throw new Error('Incolla il token API di Todoist.');
    const j = await td(t, { sync_token: '*', resource_types: ['user', 'projects'] });
    const id = 'acc-' + uid();
    ctx.setSecret(id, { token: t });
    const acc = { id, provider: 'todoist', name: (j.user && (j.user.email || j.user.full_name)) || 'Todoist', enabled: true, calendars: [], groups: [], config: { proj: {}, known: [] } };
    const d = ctx.data(); d.accounts.push(acc); ctx.commit();
    ctx.syncAll(id);
    return acc;
  }
  const tdHash = (st) => crypto.createHash('sha1').update(JSON.stringify([st.text, st.due || '', !!st.done, st.priority || ''])).digest('hex').slice(0, 12);
  const PRIO = { 4: 'alta', 3: 'media', 2: 'bassa' }, PRIO_R = { alta: 4, media: 3, bassa: 2 };
  const todoist = {
    async syncTasks(acc) {
      const token = ctx.secret(acc.id)?.token; if (!token) throw new Error('Token mancante: ricollega Todoist.');
      const d = ctx.data(), c = acc.config = acc.config || {}; c.proj = c.proj || {}; c.known = c.known || [];
      const j = await td(token, { sync_token: '*', resource_types: ['projects', 'items'] });
      const now = localISO(new Date()), qrev = (d.rev || 0) + 1;
      const projName = new Map((j.projects || []).filter(p => !p.is_deleted && !p.is_archived).map(p => [String(p.id), p.inbox_project ? 'Inbox' : p.name]));
      const projFor = (tpid) => {
        tpid = String(tpid);
        let p = d.projects.find(x => x.id === c.proj[tpid]);
        if (!p) { p = { qrev, id: 'p-' + uid(), title: `Todoist · ${projName.get(tpid) || 'Progetto'}`, category: '', description: 'Compiti sincronizzati con Todoist', starred: false, status: 'attivo', createdAt: now, updatedAt: now, steps: [], traces: [], todoist: { acc: acc.id, project: tpid } }; d.projects.push(p); c.proj[tpid] = p.id; }
        return p;
      };
      const local = new Map(); for (const p of d.projects) for (const st of p.steps) if (st.todo && st.todo.acc === acc.id) local.set(String(st.todo.id), { p, st });
      const remote = new Map((j.items || []).filter(i => !i.is_deleted).map(i => [String(i.id), i]));
      const cmds = [], uuid = () => crypto.randomUUID ? crypto.randomUUID() : uid() + uid();
      const dueOf = (i) => !i.due ? null : i.due.date.length > 10 ? i.due.date.slice(0, 16) : i.due.date + 'T09:00';
      const dueIn = (st) => !st.due ? null : st.todo && st.todo.dateOnly && st.due.slice(11, 16) === '09:00' ? { date: st.due.slice(0, 10) } : { date: st.due.slice(0, 16) + ':00' };
      let changed = 0;
      // 1. dal servizio a Promemo, e modifiche locali verso il servizio
      for (const [id, it] of remote) {
        const l = local.get(id);
        if (it.checked && !l) continue;
        if (!l) {
          const p = projFor(it.project_id);
          const st = { qrev, id: 's-' + uid(), text: it.content, due: dueOf(it), done: !!it.checked, reminder: it.due && it.due.date.length > 10 ? 0 : null, duration: it.duration && it.duration.unit === 'minute' ? it.duration.amount : 30, notes: it.description || '', todo: { acc: acc.id, id, dateOnly: !!(it.due && it.due.date.length === 10), rec: !!(it.due && it.due.is_recurring) } };
          if (PRIO[it.priority]) st.priority = PRIO[it.priority];
          st.todo.h = tdHash(st); p.steps.push(st); p.updatedAt = now; changed++;
          continue;
        }
        const { st, p } = l;
        if (tdHash(st) !== st.todo.h) {
          // cambiato qui: lo mando a Todoist
          if (st.done && !it.checked) cmds.push({ type: 'item_close', uuid: uuid(), args: { id } });
          else if (!st.done && it.checked) cmds.push({ type: 'item_uncomplete', uuid: uuid(), args: { id } });
          if (!st.done) cmds.push({ type: 'item_update', uuid: uuid(), args: { id, content: st.text, due: dueIn(st), priority: PRIO_R[st.priority] || 1 } });
          st.todo.h = tdHash(st);
        } else {
          const nd = dueOf(it);
          if (st.text !== it.content || st.due !== nd || st.done !== !!it.checked) { st.text = it.content; st.due = nd; st.done = !!it.checked; st.doneAt = st.done ? (st.doneAt || now) : null; delete st.notifiedAt; st.todo.dateOnly = !!(it.due && it.due.date.length === 10); st.todo.h = tdHash(st); p.updatedAt = now; changed++; }
        }
      }
      // compiti spariti dal servizio: fatti (o eliminati) in Todoist
      for (const [id, { st, p }] of local) {
        if (remote.has(id)) continue;
        if (tdHash(st) !== st.todo.h && !st.done) { cmds.push({ type: 'item_uncomplete', uuid: uuid(), args: { id } }); st.todo.h = tdHash(st); continue; }
        if (!st.done) { st.done = true; st.doneAt = now; st.todo.h = tdHash(st); p.updatedAt = now; changed++; }
      }
      // 2. nuovi compiti scritti in Promemo nei progetti di Todoist
      for (const p of d.projects.filter(x => x.todoist && x.todoist.acc === acc.id && x.status !== 'archiviato')) {
        for (const st of p.steps) {
          if (st.todo || st.done) continue;
          const temp = uuid();
          cmds.push({ type: 'item_add', uuid: uuid(), temp_id: temp, args: { content: st.text, project_id: p.todoist.project, ...(st.due ? { due: { date: st.due.slice(0, 16) + ':00' } } : {}), ...(PRIO_R[st.priority] ? { priority: PRIO_R[st.priority] } : {}) } });
          st.todo = { acc: acc.id, id: temp, temp: true };
        }
      }
      // 3. eliminati in Promemo
      const nowIds = new Set(); for (const p of d.projects) for (const st of p.steps) if (st.todo && st.todo.acc === acc.id) nowIds.add(String(st.todo.id));
      for (const id of c.known) if (!nowIds.has(id) && remote.has(id)) cmds.push({ type: 'item_delete', uuid: uuid(), args: { id } });
      if (cmds.length) {
        const r = await td(token, { commands: cmds });
        const map = r.temp_id_mapping || {};
        for (const p of d.projects) for (const st of p.steps) if (st.todo && st.todo.temp && map[st.todo.id]) { st.todo = { acc: acc.id, id: String(map[st.todo.id]) }; st.todo.h = tdHash(st); }
        const bad = Object.entries(r.sync_status || {}).filter(([, v]) => v !== 'ok');
        if (bad.length) ctx.log.warn('todoist', `${bad.length} modifiche rifiutate: ${JSON.stringify(bad[0][1]).slice(0, 160)}`);
      }
      c.known = []; for (const p of d.projects) for (const st of p.steps) if (st.todo && st.todo.acc === acc.id && !st.todo.temp) c.known.push(String(st.todo.id));
      acc.taskCount = c.known.length;
      return changed + cmds.length;
    },
  };

  return { providers: { caldav, outlook, calcom, todoist }, caldavConnect, outlookConnect, calcomConnect, todoistConnect, CALDAV_PRESETS };
}

module.exports = { createExtraProviders, CALDAV_PRESETS, toICS, responses, tag };
