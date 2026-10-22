/* Promemo — interpretazione di frasi in italiano: "ripetizione con Giulia giovedì alle 16 per un'ora, ricordamelo 30 minuti prima"
   Usato dall'interfaccia, dalla finestra di aggiunta rapida e dal telefono (processo principale). */
(function (root) {
  'use strict';
  const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const G_RE = { domenica: 0, dom: 0, lunedi: 1, lunedì: 1, lun: 1, martedi: 2, martedì: 2, mar: 2, mercoledi: 3, mercoledì: 3, mer: 3, giovedi: 4, giovedì: 4, gio: 4, venerdi: 5, venerdì: 5, ven: 5, sabato: 6, sab: 6 };
  const MESI = { gennaio: 0, gen: 0, febbraio: 1, feb: 1, marzo: 2, mar: 2, aprile: 3, apr: 3, maggio: 4, mag: 4, giugno: 5, giu: 5, luglio: 6, lug: 6, agosto: 7, ago: 7, settembre: 8, set: 8, ottobre: 9, ott: 9, novembre: 10, nov: 10, dicembre: 11, dic: 11 };
  const NUM = { un: 1, uno: 1, una: 1, "un'": 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, quindici: 15, venti: 20, trenta: 30, quaranta: 40, quarantacinque: 45 };
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const num = (s) => { s = String(s).toLowerCase().trim(); return /^\d+([.,]\d+)?$/.test(s) ? parseFloat(s.replace(',', '.')) : NUM[s] ?? NaN; };
  const NW = "(\\d+(?:[.,]\\d+)?|un'|una|un|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|quindici|venti|trenta|quaranta|quarantacinque)";
  const B = "(?<![\\p{L}\\d])", E = "(?![\\p{L}\\d])";

  function parse(text, opts = {}) {
    const now = opts.now ? new Date(opts.now) : new Date();
    const projects = opts.projects || [];
    let s = ' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ';
    const out = { title: '', kind: null, date: null, time: null, endTime: null, duration: null, reminder: null, location: '', projectId: null, deadline: null, auto: false, priority: '', allDay: false, matched: [] };
    const take = (re, fn) => { const m = s.match(re); if (!m) return null; const r = fn(m); if (r === false) return null; out.matched.push(m[0].trim()); s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); return m; };
    const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
    const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

    // tipo: compito / da fare
    take(new RegExp(`^\\s*(compito|da fare|todo|task|attività)\\s*:?\\s`, 'iu'), () => { out.kind = 'passo'; });
    // progetto: #nome
    take(/\s#([\p{L}\d_-]+)/u, (m) => { const q = m[1].toLowerCase(); const p = projects.find(x => x.title.toLowerCase().replace(/\s+/g, '').startsWith(q)) || projects.find(x => x.title.toLowerCase().includes(q)); if (p) out.projectId = p.id; else out.projectHint = m[1]; });
    // priorità
    take(new RegExp(`${B}(urgente|importante|priorità alta|!!?)${E}`, 'iu'), () => { out.priority = 'alta'; });
    take(new RegExp(`${B}(priorità bassa)${E}`, 'iu'), () => { out.priority = 'bassa'; });
    // pianifica automaticamente
    take(new RegExp(`${B}(pianificalo|pianifica(?:lo)? (?:tu|automaticamente)|trova(?:mi)? (?:il )?tempo)${E}`, 'iu'), () => { out.auto = true; out.kind = 'passo'; });
    // promemoria: "ricordamelo 30 minuti prima", "avvisami un'ora prima", "promemoria 1 giorno prima"
    take(new RegExp(`[,;]?\\s*(ricordamelo|ricordami|avvisami|promemoria|avviso)(?:\\s+${NW}\\s*(minut[oi]|min|or[ae]|h|giorn[oi])\\s+prima|\\s+il giorno prima|\\s+mezz'ora prima)?${E}`, 'iu'), (m) => {
      if (/giorno prima/i.test(m[0]) && !m[2]) out.reminder = 1440;
      else if (/mezz'ora/i.test(m[0])) out.reminder = 30;
      else if (m[2]) { const n = num(m[2]); const u = m[3].toLowerCase(); out.reminder = Math.round(n * (u.startsWith('or') || u === 'h' ? 60 : u.startsWith('giorn') ? 1440 : 1)); }
      else out.reminder = 15;
    });
    // durata: "per un'ora e mezza", "per 2 ore", "per 30 minuti", "per mezz'ora", "1h30", "90 min"
    take(new RegExp(`${B}per\\s+(?:${NW}\\s*(or[ae]|h|minut[oi]|min)(\\s+e\\s+mezz[ao])?|mezz'ora|tutto il giorno|tutta la giornata)${E}`, 'iu'), (m) => {
      if (/tutt/i.test(m[0])) { out.allDay = true; return; }
      if (/mezz'ora/i.test(m[0]) && !m[1]) { out.duration = 30; return; }
      const n = num(m[1]); const u = m[2].toLowerCase(); out.duration = Math.round(n * (u.startsWith('or') || u === 'h' ? 60 : 1)) + (m[3] ? 30 : 0);
    });
    take(new RegExp(`${B}(\\d{1,2})\\s?h\\s?(\\d{2})?${E}`, 'iu'), (m) => { out.duration = (+m[1]) * 60 + (+m[2] || 0); });
    take(new RegExp(`${B}(\\d{2,3})\\s?min(?:uti)?${E}`, 'iu'), (m) => { out.duration = +m[1]; });

    // scadenza: "entro venerdì", "entro il 30", "entro domani alle 12"
    let deadlineText = null;
    take(new RegExp(`${B}entro\\s+((?:il|la|lo|l')?\\s*[^,;]+?)(?=\\s*(?:[,;]|$|\\s+(?:alle|per|ricord|avvis|#|@)))`, 'iu'), (m) => { deadlineText = m[1]; out.kind = out.kind || 'passo'; });

    // luogo: "@Aula B", "presso ...", "in via ..."
    take(/\s@([^,;#]+?)(?=\s*(?:[,;#]|$))/u, (m) => { out.location = m[1].trim(); });
    if (!out.location) take(new RegExp(`${B}(?:presso|in)\\s+((?:via|viale|piazza|corso|aula|palestra|studio|scuola|ufficio|sede)\\s[^,;]+?)(?=\\s*(?:[,;]|$|\\s+(?:alle|dalle|per|oggi|domani|ricord|avvis)))`, 'iu'), (m) => { out.location = m[1].trim().replace(/^./, c => c.toUpperCase()); });
    if (!out.location) take(new RegExp(`${B}presso\\s+([^,;]+?)(?=\\s*(?:[,;]|$|\\s+(?:alle|dalle|per|oggi|domani|ricord|avvis)))`, 'iu'), (m) => { out.location = m[1].trim(); });

    // ripetizione: "ogni lunedì e mercoledì", "tutti i giorni", "ogni 2 settimane", "ogni mese", "fino al 20 dicembre", "per 10 volte"
    const GD = "lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica";
    take(new RegExp(`${B}(?:ogni|tutti i|tutte le)\\s+((?:(?:${GD})(?:\\s*,\\s*|\\s+e\\s+)?)+)`, 'iu'), (m) => { const ds = [...m[1].toLowerCase().replace(/ì/g, 'i').matchAll(/lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica/g)].map(x => G_RE[x[0]]); out.rrule = { freq: 'weekly', interval: 1, byday: [...new Set(ds)] }; });
    if (!out.rrule) take(new RegExp(`${B}(?:nei giorni feriali|dal lunedì al venerdì|tutti i giorni feriali|ogni giorno feriale)${E}`, 'iu'), () => { out.rrule = { freq: 'weekly', interval: 1, byday: [1, 2, 3, 4, 5] }; });
    if (!out.rrule) take(new RegExp(`${B}(?:ogni giorno|tutti i giorni|quotidianamente)${E}`, 'iu'), () => { out.rrule = { freq: 'daily', interval: 1 }; });
    if (!out.rrule) take(new RegExp(`${B}ogni\\s+(\\d+|due|tre|quattro)?\\s*(settiman[ae]|mes[ei]|ann[oi]|giorni)${E}`, 'iu'), (m) => { const n = m[1] ? num(m[1]) : 1; const f = /sett/i.test(m[2]) ? 'weekly' : /mes/i.test(m[2]) ? 'monthly' : /ann/i.test(m[2]) ? 'yearly' : 'daily'; out.rrule = { freq: f, interval: n || 1 }; });
    if (out.rrule) {
      take(new RegExp(`${B}fino\\s+al?l?\\s*([^,;]+?)(?=\\s*(?:[,;]|$|\\s+(?:alle|dalle|per|ricord|avvis|#|@)))`, 'iu'), (m) => { out._until = m[1]; });
      take(new RegExp(`${B}per\\s+(\\d+)\\s+volte${E}`, 'iu'), (m) => { out.rrule.count = +m[1]; });
    }

    // data
    const pickDate = (str) => {
      let d = null; const t = ' ' + str.toLowerCase().replace(/ì/g, 'i') + ' ';
      let m;
      if (/\boggi\b|stasera|stamattina|stanotte|stamani/.test(t)) d = day0;
      else if (/\bdopodomani\b/.test(t)) d = addD(day0, 2);
      else if (/\bdomani\b/.test(t)) d = addD(day0, 1);
      else if ((m = t.match(/\b(?:tra|fra)\s+(\d+|un|una|due|tre|quattro|cinque|sei|sette|dieci)\s+(giorn[oi]|settiman[ae]|mes[ei])\b/))) { const n = num(m[1]); d = /sett/.test(m[2]) ? addD(day0, 7 * n) : /mes/.test(m[2]) ? new Date(day0.getFullYear(), day0.getMonth() + n, day0.getDate()) : addD(day0, n); }
      else if (/settimana prossima|prossima settimana/.test(t)) { d = addD(day0, ((8 - day0.getDay()) % 7) || 7); }
      else if ((m = t.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/))) { let y = m[3] ? +m[3] : day0.getFullYear(); if (y < 100) y += 2000; d = new Date(y, +m[2] - 1, +m[1]); if (!m[3] && d < day0) d.setFullYear(y + 1); }
      else if ((m = t.match(/\b(\d{1,2})°?\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|gen|feb|apr|mag|giu|lug|ago|set|ott|nov|dic)\b(?:\s+(\d{4}))?/))) { d = new Date(m[3] ? +m[3] : day0.getFullYear(), MESI[m[2]], +m[1]); if (!m[3] && d < day0) d.setFullYear(d.getFullYear() + 1); }
      else if ((m = t.match(/\b(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)\b(\s+prossim[oa])?/))) { const w = G_RE[m[1]]; let diff = (w - day0.getDay() + 7) % 7; if (diff === 0) diff = 7; d = addD(day0, diff); }
      else if ((m = t.match(/\b(?:il|l')\s*(\d{1,2})\b/))) { d = new Date(day0.getFullYear(), day0.getMonth(), +m[1]); if (d < day0) d.setMonth(d.getMonth() + 1); }
      return d;
    };
    const DATE_RE = new RegExp(`${B}(?:(?:oggi|domani|dopodomani|stasera|stamattina|stamani|stanotte)|(?:(?:tra|fra)\\s+(?:\\d+|un|una|due|tre|quattro|cinque|sei|sette|dieci)\\s+(?:giorn[oi]|settiman[ae]|mes[ei]))|(?:la\\s+)?(?:settimana prossima|prossima settimana)|(?:\\d{1,2}[\\/.-]\\d{1,2}(?:[\\/.-]\\d{2,4})?)|(?:(?:il\\s+|l')?\\d{1,2}°?\\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|gen|feb|apr|mag|giu|lug|ago|set|ott|nov|dic)(?:\\s+\\d{4})?)|(?:(?:(?:il|di|questo|questa)\\s+)?(?:lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)(?:\\s+prossim[oa])?)|(?:(?:il|l')\\s*\\d{1,2}(?=\\s|$)))${E}`, 'iu');
    take(DATE_RE, (m) => { out.date = pickDate(m[0]); if (/stasera|stanotte/i.test(m[0])) out._eve = true; if (/stamattina|stamani/i.test(m[0])) out._morn = true; });
    if (out._until) { const u = pickDate(out._until); if (u) out.rrule.until = `${u.getFullYear()}-${pad(u.getMonth() + 1)}-${pad(u.getDate())}`; delete out._until; }
    // prima occorrenza di "ogni lunedì e mercoledì": il prossimo di quei giorni
    if (out.rrule && out.rrule.byday && !out.date) { for (let i = 0; i < 7; i++) { const d = addD(day0, i); if (out.rrule.byday.includes(d.getDay())) { out.date = d; break; } } }
    if (deadlineText) { const dd = pickDate(deadlineText); const tm = deadlineText.match(/(\d{1,2})(?::|\.)(\d{2})|alle\s+(\d{1,2})/); const d2 = dd || out.date || addD(day0, 7); out.deadline = new Date(d2); if (tm) out.deadline.setHours(+(tm[1] || tm[3]), +(tm[2] || 0)); else out.deadline.setHours(23, 59); }

    // orario: "dalle 10 alle 12", "alle 16:30", "alle 9 e mezza", "ore 18", "a mezzogiorno"
    const hm = (h, m, ctx) => { h = +h; m = +(m || 0); if (h < 8 && !/mattin|notte/i.test(ctx || '') && h !== 0) h += 12; if (out._eve && h < 12) h += 12; return [h, m]; };
    const T = "(\\d{1,2})(?:[:.](\\d{2})|\\s+e\\s+(mezza|un quarto|tre quarti))?";
    const mins = (m2, frac) => m2 != null ? +m2 : frac === 'mezza' ? 30 : frac === 'un quarto' ? 15 : frac === 'tre quarti' ? 45 : 0;
    take(new RegExp(`${B}dalle\\s+${T}\\s+alle\\s+${T}(\\s+di\\s+(?:mattina|sera|pomeriggio|notte))?${E}`, 'iu'), (m) => { out.time = hm(m[1], mins(m[2], m[3]), m[7]); out.endTime = hm(m[4], mins(m[5], m[6]), m[7]); if (out.endTime[0] < out.time[0]) out.endTime[0] += 12; });
    if (!out.time) take(new RegExp(`${B}(?:alle|all'|ore|verso le|per le)\\s*${T}(\\s+di\\s+(?:mattina|sera|pomeriggio|notte)|\\s+del\\s+pomeriggio)?${E}`, 'iu'), (m) => { out.time = hm(m[1], mins(m[2], m[3]), m[4]); });
    if (!out.time) take(new RegExp(`${B}a\\s+mezzogiorno${E}`, 'iu'), () => { out.time = [12, 0]; });
    if (!out.time) take(new RegExp(`${B}(\\d{1,2})[:.](\\d{2})${E}`, 'u'), (m) => { if (+m[1] > 23 || +m[2] > 59) return false; out.time = [+m[1], +m[2]]; });
    if (!out.time && out._eve) out.time = [20, 0];

    // titolo: ciò che resta
    let title = s.replace(/\s+/g, ' ').replace(/\s+([,;.])/g, '$1').replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '').replace(/\s(?:il|la|di|a|per|e)$/i, '').trim();
    out.title = title ? title.charAt(0).toUpperCase() + title.slice(1) : '';

    // composizione
    if (!out.kind) out.kind = out.time ? 'appuntamento' : out.date ? 'evento' : 'passo';
    if (out.rrule && out.kind === 'passo') { out.repeat = out.rrule; delete out.rrule; }
    if (out.kind === 'passo') {
      if (out.deadline && !out.time) out.auto = true;
      if (out.date || out.time) { const d = new Date(out.date || day0); const [h, mi] = out.time || [9, 0]; d.setHours(h, mi, 0, 0); out.due = iso(d); }
      if (out.deadline) out.deadline = iso(out.deadline);
      if (!out.duration && out.auto) out.duration = 60;
    } else {
      const d = new Date(out.date || day0);
      if (out.time && !out.allDay) {
        d.setHours(out.time[0], out.time[1], 0, 0);
        if (!out.date && d < now) d.setDate(d.getDate() + 1); // "alle 9" già passate: domani
        const e = out.endTime ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), out.endTime[0], out.endTime[1]) : new Date(d.getTime() + (out.duration || 60) * 60000);
        out.start = iso(d); out.end = iso(e);
      } else {
        out.allDay = true; out.kind = 'evento';
        out.start = iso(d).slice(0, 10) + 'T00:00'; out.end = iso(d).slice(0, 10) + 'T23:59';
      }
    }
    delete out._eve; delete out._morn;
    return out;
  }

  // descrizione leggibile del risultato (per l'anteprima)
  function describe(r) {
    const parts = [];
    const fd = (s) => { const d = new Date(s); return `${GIORNI[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
    const fh = (s) => s.slice(11, 16);
    if (r.kind === 'passo') {
      parts.push(['tipo', r.auto ? 'Compito pianificato da Promemo' : 'Compito']);
      if (r.due) parts.push(['quando', `${fd(r.due)} alle ${fh(r.due)}`]);
      if (r.deadline) parts.push(['entro', `${fd(r.deadline)}${r.deadline.slice(11, 16) !== '23:59' ? ' alle ' + fh(r.deadline) : ''}`]);
      if (r.duration) parts.push(['durata', r.duration >= 60 ? `${Math.floor(r.duration / 60)} h${r.duration % 60 ? ' ' + r.duration % 60 + ' min' : ''}` : r.duration + ' min']);
    } else {
      parts.push(['tipo', r.allDay ? 'Evento di un giorno' : 'Appuntamento']);
      parts.push(['quando', r.allDay ? fd(r.start) : `${fd(r.start)} · ${fh(r.start)}–${fh(r.end)}`]);
    }
    const rr = r.rrule || r.repeat;
    if (rr && root.PromemoRecur) parts.push(['ripete', root.PromemoRecur.describe(rr)]);
    else if (rr) { try { parts.push(['ripete', require('./recur.js').describe(rr)]); } catch { parts.push(['ripete', rr.freq]); } }
    if (r.location) parts.push(['luogo', r.location]);
    if (r.reminder != null) parts.push(['avviso', r.reminder >= 1440 ? `${r.reminder / 1440} g prima` : r.reminder >= 60 ? `${r.reminder / 60} h prima` : `${r.reminder} min prima`]);
    if (r.priority) parts.push(['priorità', r.priority]);
    return parts;
  }

  const api = { parse, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PromemoNLP = api;
})(typeof window !== 'undefined' ? window : globalThis);
