// Promemo — test di sicurezza (node --test). Non servono Electron né la rete: i servizi sono simulati.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---------------------------------------------------------------- verifica in due passaggi
test('TOTP: vettori ufficiali RFC 6238 (SHA-1)', () => {
  const T = require('../totp');
  const key = Buffer.from('12345678901234567890');
  for (const [t, exp] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']]) {
    assert.equal(T.hotp(key, Math.floor(t / 30), 8), exp);
  }
  assert.ok(T.b32decode(T.b32encode(key)).equals(key));
});
test('TOTP: tolleranza di ±30 s, niente riuso dello stesso codice, niente codici malformati', () => {
  const T = require('../totp');
  const s = T.newSecret(), now = Date.now();
  const st = T.verify(s, T.code(s, now), { t: now });
  assert.ok(st >= 0);
  assert.ok(T.verify(s, T.code(s, now - 30000), { t: now }) >= 0, 'il codice precedente vale ancora');
  assert.equal(T.verify(s, T.code(s, now - 90000), { t: now }), -1, 'un codice di 90 s fa non vale');
  assert.equal(T.verify(s, T.code(s, now), { t: now, notBefore: st }), -1, 'lo stesso codice non vale due volte');
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined]) assert.equal(T.verify(s, bad, { t: now }), -1);
  assert.equal(s.length, 32, '160 bit di chiave');
});
test('codici di emergenza: casuali, conservati solo come impronta', () => {
  const T = require('../totp');
  const c = T.backupCodes(10);
  assert.equal(new Set(c).size, 10);
  for (const x of c) assert.match(x, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(T.hashBackup(c[0]), T.hashBackup(c[0].toLowerCase().replace('-', ' ')));
  assert.ok(!T.hashBackup(c[0]).includes(T.normBackup(c[0])));
});

// ---------------------------------------------------------------- cassaforte
test('cassaforte: password giusta, sbagliata, chiave di recupero, file manomesso', async () => {
  const V = require('../vault');
  const { header, dataKey, recovery } = await V.create('Segreta-2026', '');
  assert.ok((await V.unlock(header, 'Segreta-2026')).equals(dataKey));
  assert.equal(await V.unlock(header, 'segreta-2026'), null);
  assert.ok((await V.unlock(header, recovery.toLowerCase(), true)).equals(dataKey));
  assert.equal(header.kdf.N, 1 << 15, 'scrypt N = 32768');
  const box = V.seal(dataKey, 'dati riservati');
  assert.equal(V.open(dataKey, box).toString(), 'dati riservati');
  const bad = Buffer.from(box); bad[bad.length - 1] ^= 1;
  assert.throws(() => V.open(dataKey, bad), 'un byte cambiato viene scoperto (AES-GCM)');
  assert.throws(() => V.open(crypto.randomBytes(32), box));
  const a = V.seal(dataKey, 'x'), b = V.seal(dataKey, 'x');
  assert.notDeepEqual(a.subarray(4, 16), b.subarray(4, 16), 'IV sempre nuovo');
  const h2 = await V.setPassword({ ...header, totp: { enc: 'x' } }, dataKey, 'Nuova-Password-1');
  assert.ok(h2.totp, 'cambiare password non toglie la verifica in due passaggi');
  assert.ok((await V.unlock(h2, 'Nuova-Password-1')).equals(dataKey));
});
test('file di sincronizzazione del telefono: password sbagliata e file alterato', async () => {
  const P = require('../phonesync');
  const salt = crypto.randomBytes(16);
  const buf = await P.seal({ a: 1 }, 'pass-backup', salt);
  assert.deepEqual(await P.open(buf, 'pass-backup'), { a: 1 });
  await assert.rejects(() => P.open(buf, 'altra'), /errata/);
  await assert.rejects(() => P.open(Buffer.from('ciao'), 'pass-backup'));
});

// ---------------------------------------------------------------- registro
test('registro: i segreti non finiscono nel file', () => {
  const L = require('../log');
  const samples = ['Bearer abc.def.ghi', 'sk-ant-api03-abcdefghijk', 'ntn_1234567890abc', 'cal_live_0123456789', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkw.abcdefghijkl', '{"password":"segreta"}', '{"refresh_token":"1//abc"}', 'Basic ZGFuaWVsZTpwYXNzd29yZA==', 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXPJBSWY3DP', 'http://10.0.0.2:8787/#k=AbCdEfGhIjKlMnOp', 'ghp_abcdefghijklmnopqrstuvwxyz0123'];
  for (const s of samples) assert.ok(!L.clean(s).includes(s.replace(/^.*?(?=[A-Za-z0-9_]{8,})/, '').slice(0, 12)) || L.clean(s).includes('[nascosto]'), s);
  for (const s of samples) assert.ok(L.clean(s).includes('[nascosto]'), 'non nascosto: ' + s);
  assert.equal(L.clean('sha256 841aa8760c8a9bf7'), 'sha256 841aa8760c8a9bf7', 'le impronte restano leggibili');
});

// ---------------------------------------------------------------- server del telefono
function startMobile(token) {
  const { createMobile } = require('../mobile');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = { settings: { mobile: { enabled: true, port, token } }, events: [], projects: [], accounts: [], categories: [], trips: {}, travel: {} };
  const m = createMobile({ data: () => data, commit() {}, quickAdd: () => ({ title: 'x', text: '' }), root: ROOT });
  m.start();
  return { m, port };
}
function req(port, p, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers, agent: false }, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    r.on('error', (e) => resolve({ status: 0, error: e.code }));
    if (body) r.write(body); r.end();
  });
}
test('server del telefono: chiave obbligatoria, blocco dopo 10 errori, niente file fuori dall’app, limite di dimensione', async () => {
  const token = crypto.randomBytes(18).toString('base64url');
  const { m, port } = startMobile(token);
  await new Promise(r => setTimeout(r, 150));
  try {
    assert.equal((await req(port, '/api/state')).status, 401, 'senza chiave');
    assert.equal((await req(port, '/api/state', { headers: { 'x-promemo-key': token.slice(0, -1) + 'x' } })).status, 401, 'chiave quasi giusta');
    assert.equal((await req(port, '/api/state', { headers: { 'x-promemo-key': token } })).status, 200, 'chiave giusta');
    for (const p of ['/../package.json', '/%2e%2e/main.js', '/src/../main.js', '/main.js', '/promemo.json']) assert.equal((await req(port, p)).status, 404, p);
    const evil = await req(port, '/api/state', { headers: { origin: 'https://sito-malevolo.example', 'x-promemo-key': token } });
    assert.equal(evil.headers['access-control-allow-origin'], undefined, 'nessun CORS per altri siti');
    const big = await req(port, '/api/add', { method: 'POST', headers: { 'x-promemo-key': token, 'content-type': 'application/json' }, body: 'x'.repeat(30000) });
    assert.ok([413, 0].includes(big.status), 'richiesta troppo grande rifiutata');
    for (let i = 0; i < 10; i++) await req(port, '/api/state', { headers: { 'x-promemo-key': 'sbagliata' } });
    assert.equal((await req(port, '/api/state', { headers: { 'x-promemo-key': token } })).status, 429, 'dopo 10 tentativi sbagliati si ferma anche la chiave giusta per un po’');
  } finally { m.stop(); }
});

// ---------------------------------------------------------------- aggiornamenti
test('aggiornamenti: un file con impronta diversa non viene accettato', async () => {
  const payload = Buffer.from('pacchetto finto');
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-length': payload.length }); r.end(payload); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/p.deb`;
  const { createUpdater } = require('../updater');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  const up = createUpdater({ app: { getVersion: () => '1.0.0', isPackaged: false, getPath: () => dir }, send() {} });
  const good = 'sha256:' + crypto.createHash('sha256').update(payload).digest('hex');
  await up._download({ url, size: payload.length, digest: good }, path.join(dir, 'ok.deb'));
  assert.ok(fs.existsSync(path.join(dir, 'ok.deb')));
  await assert.rejects(() => up._download({ url, size: payload.length, digest: 'sha256:' + '0'.repeat(64) }, path.join(dir, 'ko.deb')), /impronta/);
  assert.ok(!fs.existsSync(path.join(dir, 'ko.deb')), 'il file sbagliato viene cancellato');
  srv.close();
});
test('aggiornamenti: nessun uso di /tmp condivisa per il pacchetto e installazione con argomenti, non con una stringa', () => {
  const s = read('updater.js');
  assert.ok(!/os\.tmpdir\(\)/.test(s.split('async function install')[1] || ''), 'il .deb non passa da /tmp');
  assert.match(s, /execFile\('pkexec', \['\/bin\/sh', '-c', script, 'promemo-agg', file\]/);
  assert.ok(!/\$\{file\}/.test(s.match(/const script = '[^']*'/)[0]), 'il percorso non entra nello script');
});

// ---------------------------------------------------------------- Electron (controlli sul codice)
test('finestre: isolamento, sandbox, niente Node nelle pagine', () => {
  const s = read('main.js');
  const prefs = s.match(/webPreferences:\s*\{[^}]*\}|const sidePrefs = \{[^}]*\}/g) || [];
  assert.ok(prefs.length >= 2);
  for (const p of prefs) { assert.match(p, /contextIsolation: true/); assert.match(p, /nodeIntegration: false/); assert.match(p, /sandbox: true/); assert.ok(!/webSecurity:\s*false/.test(p)); }
  assert.ok(!/webviewTag:\s*true/.test(s));
  assert.match(s, /will-attach-webview/);
  assert.match(s, /setPermissionRequestHandler/);
  assert.match(s, /web-contents-created/);
  assert.ok(!/allowRunningInsecureContent|enableRemoteModule/.test(s));
});
test('pagine: CSP senza eval né script esterni, niente gestori inline', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.html'))) {
    const h = read('src/' + f);
    const csp = (h.match(/Content-Security-Policy" content="([^"]*)"/) || [])[1];
    assert.ok(csp, 'CSP mancante in ' + f);
    assert.ok(!/unsafe-eval/.test(csp), f);
    assert.match(csp, /default-src 'self'/);
    assert.ok(!/script-src[^;]*(https?:|\*)/.test(csp), 'script esterni in ' + f);
    assert.ok(!/\son[a-z]+=["']/i.test(h.replace(/<script[\s\S]*?<\/script>/g, '')), 'gestore inline in ' + f);
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'))) {
    const js = read('src/' + f);
    assert.ok(!/\son(click|load|error|mouseover|change|input|submit)=["'\\]/i.test(js), 'gestore inline nel modello HTML di ' + f);
    assert.ok(!/\beval\(|new Function\(/.test(js), 'eval in ' + f);
  }
});
test('preload: espone solo funzioni, mai ipcRenderer intero', () => {
  const s = read('preload.js');
  assert.ok(!/exposeInMainWorld\([^)]*ipcRenderer\s*\)/.test(s));
  assert.ok(!/:\s*ipcRenderer\s*[,}]/.test(s));
  assert.ok(!/require\(['"](fs|child_process)['"]\)/.test(s));
});
test('link esterni: solo https e indirizzi validi', () => {
  const s = read('main.js');
  assert.match(s, /ipcMain\.on\('open-url', \(_e, url\) => safeExternal/);
  assert.match(s, /u\.protocol === 'https:'/);
  assert.ok(!/shell\.openExternal\((?!u\.href|url\))/.test(s.replace(/process\.env\.PROMEMO_TEST_AUTH \? [^:]+: shell\.openExternal\(url\)/g, '')), 'openExternal fuori dal controllo');
});
test('file dei dati: solo per il tuo utente', () => {
  const s = read('main.js');
  assert.match(s, /function writeAtomic\(file, buf\) \{ const t = file \+ '\.tmp'; fs\.writeFileSync\(t, buf, \{ mode: 0o600 \}\)/);
  assert.match(s, /writeAtomic\(dataFile\(\)/);
  assert.match(s, /chmodSync\(dir, 0o700\)/);
});
test('parser: ICS e XML ostili non bloccano né iniettano', () => {
  const { parseICS } = require('../ics');
  const big = 'BEGIN:VCALENDAR\r\n' + 'BEGIN:VEVENT\r\nSUMMARY:<img src=x onerror=alert(1)>\r\nDTSTART:20261101T100000Z\r\nDTEND:20261101T110000Z\r\nRRULE:FREQ=SECONDLY\r\nEND:VEVENT\r\n'.repeat(5) + 'END:VCALENDAR';
  const t0 = Date.now();
  const r = parseICS(big, new Date('2026-10-01'), new Date('2026-12-01'));
  assert.ok(Date.now() - t0 < 3000, 'nessun ciclo infinito con ripetizioni estreme');
  assert.ok(Array.isArray(r));
  const { responses } = require('../providers2');
  assert.equal(responses('<d:multistatus><d:response><d:href>&lt;script&gt;</d:href></d:response></d:multistatus>')[0].href, '<script>', 'il testo resta testo (viene poi mostrato con esc)');
});
