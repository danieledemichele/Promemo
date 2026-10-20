// Promemo — cassaforte locale: cifratura dei dati con password + chiave di recupero
// Schema: una chiave dati casuale (AES-256-GCM) cifra i file; la chiave dati è a sua volta
// "avvolta" due volte, con una chiave derivata dalla password e con una derivata dalla chiave
// di recupero (scrypt). Cambiare password riavvolge solo la chiave dati, i file restano come sono.
'use strict';
const crypto = require('crypto');

const KDF = { alg: 'scrypt', N: 1 << 15, r: 8, p: 1 };
const MAGIC = Buffer.from('PMV1');
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // senza 0/O e 1/I

const b64 = (b) => Buffer.from(b).toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64');
const normRec = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function kdf(secret, salt, p = KDF) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(secret).normalize('NFKC'), salt, 32, { N: p.N, r: p.r, p: p.p, maxmem: 128 * p.N * p.r * 2 }, (e, k) => e ? reject(e) : resolve(k));
  });
}

function seal(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(Buffer.isBuffer(plain) ? plain : Buffer.from(plain)), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

function open(key, buf) {
  if (!buf || buf.length < 32 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error('Formato non riconosciuto');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

function recoveryCode() {
  const bytes = crypto.randomBytes(24);
  const chars = [...bytes].map(b => ALPH[b % 32]).join('');
  return chars.match(/.{4}/g).join('-'); // 6 gruppi da 4 = 120 bit
}

async function create(password, hint = '') {
  const dataKey = crypto.randomBytes(32);
  const saltPw = crypto.randomBytes(16), saltRec = crypto.randomBytes(16);
  const recovery = recoveryCode();
  const [kp, kr] = await Promise.all([kdf(password, saltPw), kdf(normRec(recovery), saltRec)]);
  const header = {
    v: 1, kdf: KDF, createdAt: new Date().toISOString(), hint: String(hint || '').slice(0, 80),
    saltPw: b64(saltPw), wrapPw: b64(seal(kp, dataKey)),
    saltRec: b64(saltRec), wrapRec: b64(seal(kr, dataKey)),
  };
  return { header, dataKey, recovery };
}

// restituisce la chiave dati se il segreto è corretto, altrimenti null
async function unlock(header, secret, useRecovery = false) {
  const salt = unb64(useRecovery ? header.saltRec : header.saltPw);
  const k = await kdf(useRecovery ? normRec(secret) : secret, salt, header.kdf || KDF);
  try { return open(k, unb64(useRecovery ? header.wrapRec : header.wrapPw)); } catch { return null; }
}

async function setPassword(header, dataKey, password, hint) {
  const saltPw = crypto.randomBytes(16);
  const kp = await kdf(password, saltPw);
  return { ...header, kdf: KDF, saltPw: b64(saltPw), wrapPw: b64(seal(kp, dataKey)), hint: hint === undefined ? header.hint : String(hint || '').slice(0, 80), changedAt: new Date().toISOString() };
}

module.exports = { create, unlock, setPassword, seal, open, recoveryCode, kdf };
