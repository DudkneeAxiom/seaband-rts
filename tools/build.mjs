/* Produce a clean static build in dist/ and an itch.io-ready zip.
   No bundler: the game ships as the same ES modules it develops with. */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIST = path.join(ROOT, 'dist');
const INCLUDE = ['index.html', 'style.css', 'src', 'vendor', 'LICENSE-three.txt'];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let files = 0, bytes = 0;
function copy(rel) {
  const from = path.join(ROOT, rel), to = path.join(DIST, rel);
  if (!fs.existsSync(from)) return;
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from)) copy(path.join(rel, f));
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    files++; bytes += st.size;
  }
}
for (const f of INCLUDE) copy(f);

// itch.io serves the zip contents at the root; nothing else needed.
const zipPath = path.join(ROOT, 'salt-and-tally-web.zip');
fs.rmSync(zipPath, { force: true });
execSync(`cd "${DIST}" && zip -qr "${zipPath}" .`);
const zipSize = fs.statSync(zipPath).size;

console.log(`dist/       ${files} files, ${(bytes / 1024).toFixed(0)} KB`);
console.log(`zip         ${path.basename(zipPath)}, ${(zipSize / 1024).toFixed(0)} KB`);
console.log('\nitch.io: upload the zip, tick "This file will be played in the browser",');
console.log('set the viewport to 960x540 or wider and enable fullscreen + mobile friendly.');
