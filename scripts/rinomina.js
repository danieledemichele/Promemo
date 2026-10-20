#!/usr/bin/env node
// Rinomina l'app in tutti i file del progetto.
// Uso:  node scripts/rinomina.js Ordito
// I dati già salvati vengono recuperati al primo avvio dalla vecchia cartella la cartella dati del nome precedente.
const fs = require('fs');
const path = require('path');

const nuovo = (process.argv[2] || '').trim();
if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 -]{1,30}$/.test(nuovo)) {
  console.error('Uso: node scripts/rinomina.js NuovoNome');
  process.exit(1);
}
const vecchio = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).productName;
const slug = nuovo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const vslug = vecchio.toLowerCase();
const files = ['package.json', 'main.js', 'preload.js', 'sync.js', 'ics.js', 'src/app.js', 'src/index.html', 'README.md'];
for (const f of files) {
  const p = path.join(__dirname, '..', f);
  if (!fs.existsSync(p)) continue;
  const before = fs.readFileSync(p, 'utf8');
  const after = before
    .replace(new RegExp(`\\b${vecchio}\\b`, 'g'), nuovo)
    .replace(new RegExp(`\\b${vslug}\\b`, 'g'), slug);
  if (after !== before) { fs.writeFileSync(p, after); console.log('aggiornato', f); }
}
// ricorda il vecchio nome per recuperare i dati
const mp = path.join(__dirname, '..', 'main.js');
let m = fs.readFileSync(mp, 'utf8');
m = m.replace(/const LEGACY_NAMES = \[(.*?)\];/, (all, list) => `const LEGACY_NAMES = [${list}, ${JSON.stringify(vecchio)}];`);
fs.writeFileSync(mp, m);
console.log(`\nFatto: ${vecchio} → ${nuovo} (pacchetto "${slug}"). Ora: npm run dist`);
