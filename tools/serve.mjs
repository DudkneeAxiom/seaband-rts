/* A static file server in twenty lines of node, so `npm start` needs nothing
   fetched and works on a machine that is offline or behind a proxy.
   Usage: node tools/serve.mjs [port] */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
/* argv[2] is a port only when this file is the program. `node tools/all.mjs
   --fast` imports us with somebody else's arguments, and +('--fast') is NaN,
   which listen() rejects — so check who is running before reading them. */
const IS_ENTRY = import.meta.url === pathToHref(process.argv[1]);
const PORT = +((IS_ENTRY && process.argv[2]) || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.zip': 'application/zip',
};

export function serve(port = PORT) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(ROOT, url === '/' ? 'index.html' : url);
    // never serve outside the repo, whatever the request says
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        // always fresh: this is a development server and a stale module is an
        // afternoon of debugging something you already fixed
        'cache-control': 'no-store',
      });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

/** True if something is already answering on that port. */
export async function isUp(port = PORT) {
  try {
    const r = await fetch(`http://localhost:${port}/index.html`, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch { return false; }
}

if (IS_ENTRY) {
  await serve(PORT);
  console.log(`Commodore — http://localhost:${PORT}`);
  console.log('Ctrl-C to stop.');
}
function pathToHref(p) {
  return p ? new URL(`file://${path.resolve(p)}`).href : '';
}
