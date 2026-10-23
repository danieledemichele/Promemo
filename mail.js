// Promemo — l'assistente legge la posta (Gmail, sola lettura): inviti di calendario e, con l'IA, impegni e scadenze scritti nelle email
'use strict';
const { parseICS } = require('./ics');
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const b64d = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const QUERY = 'newer_than:3d -category:promotions -category:social -category:forums -in:chats -in:spam -in:trash';

function stripHtml(h) {
  return String(h).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
// raccoglie testo, html e allegati .ics da un messaggio Gmail (formato "full")
function walk(part, out) {
  if (!part) return out;
  const mt = (part.mimeType || '').toLowerCase(), fn = (part.filename || '').toLowerCase();
  if (mt === 'text/calendar' || fn.endsWith('.ics')) out.ics.push(part.body && part.body.data ? { data: b64d(part.body.data) } : { att: part.body && part.body.attachmentId });
  else if (mt === 'text/plain' && part.body && part.body.data && !fn) out.text.push(b64d(part.body.data));
  else if (mt === 'text/html' && part.body && part.body.data && !fn) out.html.push(b64d(part.body.data));
  for (const p of part.parts || []) walk(p, out);
  return out;
}
const header = (m, n) => ((m.payload && m.payload.headers) || []).find(h => h.name.toLowerCase() === n)?.value || '';
const fromName = (f) => (f.match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || f.replace(/[<>]/g, '');

function createMail(ctx) {
  // ctx: data(), gFetch(accId, path), ai(system, messages, opts) → testo | null, log
  const st = () => { const d = ctx.data(); d.agent = d.agent || {}; d.agent.mail = d.agent.mail || { seen: {}, found: [] }; const m = d.agent.mail; m.seen = m.seen || {}; m.found = m.found || []; return m; };
  const accounts = () => (ctx.data().accounts || []).filter(a => a.provider === 'google' && a.enabled && a.mail && a.mail.enabled);
  let busy = false;

  async function scanAccount(acc, m, pending) {
    const list = await ctx.gFetch(acc.id, `/gmail/v1/users/me/messages?maxResults=30&q=${encodeURIComponent(QUERY)}`);
    for (const { id } of (list && list.messages) || []) {
      const key = acc.id + ':' + id;
      if (m.seen[key]) continue;
      const msg = await ctx.gFetch(acc.id, `/gmail/v1/users/me/messages/${id}?format=full`);
      m.seen[key] = new Date().toISOString();
      const parts = walk(msg.payload, { text: [], html: [], ics: [] });
      const base = { msgId: id, acc: acc.id, from: fromName(header(msg, 'from')), subject: header(msg, 'subject') || '(senza oggetto)', link: `https://mail.google.com/mail/u/0/#all/${msg.threadId || id}`, at: new Date().toISOString() };
      // 1. inviti di calendario: non servono interpretazioni
      let fromIcs = 0;
      for (const p of parts.ics) {
        let txt = p.data;
        if (!txt && p.att) { try { const a = await ctx.gFetch(acc.id, `/gmail/v1/users/me/messages/${id}/attachments/${p.att}`); txt = b64d(a.data); } catch { /* */ } }
        if (!txt) continue;
        const cancel = /METHOD:CANCEL/i.test(txt);
        const now = new Date();
        for (const e of parseICS(txt, new Date(now.getTime() - 864e5), new Date(now.getTime() + 400 * 864e5)).slice(0, 3)) {
          m.found.push({ ...base, id: `m:${id}:${fromIcs}`, kind: cancel ? 'annullato' : 'evento', title: e.title || base.subject, start: iso(e.start), end: iso(e.end), allDay: !!e.allDay, location: e.location || '', reason: cancel ? 'Invito annullato' : 'Invito di calendario', icsUid: e.uid });
          fromIcs++;
        }
      }
      if (fromIcs) continue;
      const text = (parts.text.join('\n') || stripHtml(parts.html.join('\n')) || msg.snippet || '').replace(/\n>.*$/gm, '').slice(0, 1800);
      pending.push({ ...base, date: header(msg, 'date'), text });
    }
  }

  // 2. le altre email le legge l'IA (a gruppi), cercando appuntamenti e scadenze reali
  async function extract(pending, m) {
    if (!pending.length) return;
    const d = ctx.data(); if (!d.settings.ai || !d.settings.ai.provider || d.settings.ai.provider === 'none') return;
    const now = new Date();
    for (let i = 0; i < pending.length; i += 8) {
      const batch = pending.slice(i, i + 8);
      const sys = 'Leggi email in italiano o inglese e trovi solo impegni concreti per il destinatario: appuntamenti, riunioni, lezioni, visite, voli, prenotazioni, consegne e scadenze con una data. Ignori newsletter, pubblicità, ricevute senza data futura e notifiche automatiche irrilevanti. Non inventi date. Rispondi SOLO con JSON valido.';
      const user = `Oggi è ${now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.\n\n` + batch.map((x, n) => `### EMAIL ${n}\nDa: ${x.from}\nOggetto: ${x.subject}\nData: ${x.date}\n${x.text}`).join('\n\n') +
        '\n\nRestituisci {"trovati":[{"email":numero,"tipo":"evento"|"scadenza","titolo":"breve, senza il nome del mittente se non serve","inizio":"AAAA-MM-GGTHH:MM oppure AAAA-MM-GG","fine":"AAAA-MM-GGTHH:MM facoltativo","luogo":"facoltativo","motivo":"una frase"}]}. Lista vuota se non c\'è niente.';
      let j;
      try {
        const txt = await ctx.ai(sys, [{ role: 'user', content: user }], { maxTokens: 1200 });
        if (!txt) return;
        const s = String(txt).replace(/```(?:json)?/g, ''); j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
      } catch (e) { ctx.log.warn('posta', 'lettura con l’IA non riuscita: ' + e.message); continue; }
      for (const [n, f] of (j.trovati || []).entries()) {
        const x = batch[+f.email]; if (!x || !f.inizio || !/^\d{4}-\d\d-\d\d/.test(f.inizio)) continue;
        const allDay = f.inizio.length === 10;
        const start = allDay ? f.inizio + 'T00:00' : f.inizio.slice(0, 16);
        if (new Date(start) < new Date(now.getTime() - 864e5)) continue;
        let end = f.fine && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(f.fine) ? f.fine.slice(0, 16) : allDay ? f.inizio + 'T23:59' : iso(new Date(new Date(start).getTime() + 3600000));
        if (end < start) end = start;
        const { text, date, ...base } = x;
        m.found.push({ ...base, id: `m:${x.msgId}:a${n}`, kind: f.tipo === 'scadenza' ? 'scadenza' : 'evento', title: String(f.titolo || x.subject).slice(0, 120), start, end, allDay, location: String(f.luogo || ''), reason: String(f.motivo || '') });
      }
    }
  }

  async function scan(force) {
    const accs = accounts(); if (!accs.length || busy) return 0;
    const m = st();
    if (!force && m.lastScan && Date.now() - new Date(m.lastScan) < 50 * 60000) return 0;
    busy = true;
    const before = m.found.length, pending = [];
    try {
      for (const a of accs) {
        try { await scanAccount(a, m, pending); a.mail.error = ''; }
        catch (e) { a.mail.error = e.message; ctx.log.warn('posta', `${a.name}: ${e.message}`); }
      }
      await extract(pending.slice(0, 24), m);
      m.lastScan = new Date().toISOString();
      // pulizia: messaggi visti negli ultimi 30 giorni, trovati ancora utili
      for (const [k, v] of Object.entries(m.seen)) if (Date.now() - new Date(v) > 30 * 864e5) delete m.seen[k];
      m.found = m.found.filter(f => new Date(f.end || f.start) > new Date(Date.now() - 2 * 864e5)).slice(-80);
      const n = m.found.length - before;
      if (n) ctx.log.info('posta', `${n} impegni trovati nella posta`);
      return n;
    } finally { busy = false; }
  }

  return { scan, accounts, state: st };
}

module.exports = { createMail, stripHtml, walk };
