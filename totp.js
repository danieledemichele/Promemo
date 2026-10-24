// Promemo — verifica in due passaggi (TOTP, RFC 6238): funziona con Google Authenticator, Microsoft Authenticator,
// Aegis, 2FAS, Authy, Proton Pass, Bitwarden, 1Password, Ente Auth…
'use strict';
const crypto = require('crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  const clean = String(s || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, val = 0; const out = [];
  for (const ch of clean) { const i = B32.indexOf(ch); if (i < 0) throw new Error('Chiave non valida'); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function hotp(key, counter, digits = 6) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(c).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
const step = (t = Date.now(), period = 30) => Math.floor(t / 1000 / period);
const code = (secret, t = Date.now()) => hotp(b32decode(secret), step(t));
// accetta il codice attuale e quelli vicini (±1, orologi un po' sfasati); restituisce lo step usato, oppure -1
function verify(secret, input, { t = Date.now(), window = 1, notBefore = -1 } = {}) {
  const c = String(input || '').replace(/\D/g, '');
  if (c.length !== 6) return -1;
  const key = b32decode(secret), s = step(t);
  for (let w = -window; w <= window; w++) {
    const st = s + w;
    if (st <= notBefore) continue; // lo stesso codice non vale due volte
    const exp = Buffer.from(hotp(key, st)), got = Buffer.from(c);
    if (crypto.timingSafeEqual(exp, got)) return st;
  }
  return -1;
}
const newSecret = () => b32encode(crypto.randomBytes(20));
const uri = (secret, account, issuer = 'Promemo') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
// codici di emergenza: si mostrano una volta, si conservano solo come impronta
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normBackup = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashBackup = (s) => crypto.createHash('sha256').update('promemo-2fa|' + normBackup(s)).digest('hex');
function backupCodes(n = 10) { return Array.from({ length: n }, () => { const b = crypto.randomBytes(8); const s = [...b].map(x => ALPH[x % 32]).join(''); return s.slice(0, 4) + '-' + s.slice(4); }); }

module.exports = { b32encode, b32decode, hotp, code, verify, newSecret, uri, backupCodes, hashBackup, normBackup, step };
