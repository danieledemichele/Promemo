// prepara la cartella www per Capacitor: l'app del telefono più i moduli condivisi con il computer
const fs = require('fs'), path = require('path');
const root = __dirname, www = path.join(root, 'www');
fs.rmSync(www, { recursive: true, force: true }); fs.mkdirSync(www, { recursive: true });
const copy = (from, to) => fs.copyFileSync(path.join(root, from), path.join(www, to || path.basename(from)));
for (const f of fs.readdirSync(path.join(root, 'src'))) copy(path.join('src', f), f);
for (const f of ['nlp.js', 'recur.js', 'syncmodel.js']) copy(path.join('..', 'src', f), f);
copy(path.join('node_modules', 'scrypt-js', 'scrypt.js'), 'scrypt.js');
copy(path.join('..', 'build', 'icon.png'), 'icon.png');
console.log('www pronto:', fs.readdirSync(www).join(', '));
