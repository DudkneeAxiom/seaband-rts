/* ===========================================================
   Single-file build.
   Flattens every ES module (and three.js) into one classic
   <script> inside one HTML file, so the game can be opened
   straight from a URL or a saved file with no server at all.
   Modules keep their own scope via a tiny CommonJS-style
   registry, so nothing collides and load order stays honest.
   =========================================================== */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT_DIR = path.join(ROOT, 'dist-single');
const ENTRY = 'src/main.js';

/* ---------- module graph ---------- */
const modules = new Map();     // id -> { code, deps }

function resolveSpec(fromId, spec) {
  if (spec === 'three') return 'three';
  const dir = path.posix.dirname(fromId);
  let p = path.posix.normalize(path.posix.join(dir, spec));
  if (p.startsWith('./')) p = p.slice(2);
  return p;
}

const IMPORT_RE = /import\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]\s*;?/g;
const BARE_IMPORT_RE = /(^|\n)\s*import\s*['"]([^'"]+)['"]\s*;?/g;

function transform(id, src) {
  const deps = new Set();
  const exported = [];      // [exportedName, localName]

  let code = src.replace(BARE_IMPORT_RE, (m, pre, spec) => {
    deps.add(resolveSpec(id, spec));
    return `${pre}__req(${JSON.stringify(resolveSpec(id, spec))});`;
  });

  code = code.replace(IMPORT_RE, (m, clause, spec) => {
    const dep = resolveSpec(id, spec);
    deps.add(dep);
    const c = clause.trim();
    const req = `__req(${JSON.stringify(dep)})`;
    if (c.startsWith('*')) {                       // import * as NS
      const ns = c.replace(/^\*\s*as\s*/, '').trim();
      return `const ${ns} = ${req};`;
    }
    if (c.startsWith('{')) {                       // import { a, b as c }
      const inner = c.slice(1, c.lastIndexOf('}'));
      const binds = splitList(inner).map(part => {
        const [name, alias] = part.split(/\s+as\s+/).map(s => s.trim());
        return alias ? `${name}: ${alias}` : name;
      });
      return `const { ${binds.join(', ')} } = ${req};`;
    }
    throw new Error(`${id}: unsupported import clause "${c}"`);
  });

  if (/export\s+default/.test(code)) throw new Error(`${id}: export default is not supported`);
  if (/export\s*\{[^}]*\}\s*from/.test(code)) throw new Error(`${id}: re-exports are not supported`);

  // export { a, b as c };
  code = code.replace(/(^|\n)export\s*\{([^}]*)\}\s*;?/g, (m, pre, inner) => {
    for (const part of splitList(inner)) {
      const [local, alias] = part.split(/\s+as\s+/).map(s => s.trim());
      exported.push([alias || local, local]);
    }
    return pre;
  });
  // export const / let / var / function / class / async function
  code = code.replace(/(^|\n)export\s+(const|let|var|function\*?|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g,
    (m, pre, kind, name) => {
      exported.push([name, name]);
      return `${pre}${kind} ${name}`;
    });
  // catch multi-declarator `export const a = 1, b = 2;`
  if (/(^|\n)export\s/.test(code)) {
    throw new Error(`${id}: an export form was left untransformed:\n` +
      code.split('\n').filter(l => /^export\s/.test(l)).join('\n'));
  }

  const tail = exported.map(([name, local]) => `  __e[${JSON.stringify(name)}] = ${local};`).join('\n');
  return { code: `'use strict';\n${code}\n${tail}\n`, deps: [...deps] };
}

function splitList(s) {
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

function load(id) {
  if (modules.has(id)) return;
  modules.set(id, null);       // reserve, guards cycles
  const src = fs.readFileSync(path.join(ROOT, id), 'utf8');
  const { code, deps } = transform(id, src);
  modules.set(id, { code, deps });
  for (const d of deps) if (d !== 'three') load(d);
}
load(ENTRY);

/* ---------- three.js: rewrite its single import + export lists ---------- */
function exportListToAssignments(list) {
  return splitList(list).map(part => {
    const [local, alias] = part.split(/\s+as\s+/).map(s => s.trim());
    return `__e[${JSON.stringify(alias || local)}]=${local};`;
  }).join('');
}
function bundleThree() {
  const core = fs.readFileSync(path.join(ROOT, 'vendor/three.core.min.js'), 'utf8');
  const mod = fs.readFileSync(path.join(ROOT, 'vendor/three.module.min.js'), 'utf8');

  // core: one trailing export{...}
  const ci = core.lastIndexOf('export{');
  if (ci < 0) throw new Error('three.core: no export list found');
  const coreBody = core.slice(0, ci);
  const coreList = core.slice(ci + 7, core.lastIndexOf('}'));
  if (/\}\s*from/.test(core.slice(ci))) throw new Error('three.core: unexpected re-export');
  const coreCode = `${coreBody}\n${exportListToAssignments(coreList)}`;

  // module: one leading import{...}from"./three.core.min.js", then export lists
  const im = /import\{([\s\S]*?)\}from"\.\/three\.core\.min\.js";?/.exec(mod);
  if (!im) throw new Error('three.module: no core import found');
  const binds = splitList(im[1]).map(part => {
    const [name, alias] = part.split(/\s+as\s+/).map(s => s.trim());
    return alias ? `${name}:${alias}` : name;
  });
  let modCode = mod.slice(0, im.index)
    + `const{${binds.join(',')}}=__req("three/core");var __core=__req("three/core");`
    + mod.slice(im.index + im[0].length);
  // re-exports first: `export{A,B as C}from"./three.core.min.js"` pulls from core
  modCode = modCode.replace(/export\{([^}]*)\}from"[^"]+";?/g, (m, list) =>
    splitList(list).map(part => {
      const [src, alias] = part.split(/\s+as\s+/).map(s => s.trim());
      return `__e[${JSON.stringify(alias || src)}]=__core[${JSON.stringify(src)}];`;
    }).join(''));
  // then plain export lists of local bindings
  modCode = modCode.replace(/export\{([^}]*)\}\s*;?/g, (m, list) => exportListToAssignments(list));
  if (/(^|[;\s{}])export[\s{]/.test(modCode)) throw new Error('three.module: leftover export');

  return { coreCode, modCode };
}
const three = bundleThree();

/* ---------- emit ---------- */
const order = [];
const seen = new Set();
(function visit(id) {
  if (seen.has(id) || id === 'three') return;
  seen.add(id);
  for (const d of modules.get(id).deps) visit(d);
  order.push(id);
})(ENTRY);

const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// keep only what lives inside <body>, minus the module script tag
/* Stamp the build into the loading card. "Which copy is that?" is the first
   question about any bug report from a device, and iOS answers downloads by
   renaming them -2, -3, -4 rather than replacing them — so a tester can very
   easily be looking at a file from three builds ago and neither of you can
   tell. Now the card says. */
const STAMP = new Date().toISOString().replace('T', ' ').slice(0, 16) + 'Z';
const body = html
  .slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  .replace(/<script type="module"[\s\S]*?<\/script>/g, '')
  .replace('data-build="dev"', `data-build="${STAMP}"`)
  .replace('>dev build<', `>${STAMP}<`)
  .trim();

const def = (id, code) =>
  `__def(${JSON.stringify(id)}, function(__e, __req, module){\n${code}\n});\n`;

// When the page is hosted inside someone else's <head>, our meta tags may be
// ignored. Assert them from script so the viewport is right wherever this runs.
const PRELUDE =
  `(function(){\n` +
  `  var metas = {\n` +
  `    viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',\n` +
  `    'theme-color': '#0b2a3a',\n` +
  `    'apple-mobile-web-app-capable': 'yes',\n` +
  `    'mobile-web-app-capable': 'yes',\n` +
  `    'apple-mobile-web-app-status-bar-style': 'black-translucent'\n` +
  `  };\n` +
  `  for (var k in metas) {\n` +
  `    var m = document.querySelector('meta[name="' + k + '"]');\n` +
  `    if (!m) { m = document.createElement('meta'); m.setAttribute('name', k); document.head.appendChild(m); }\n` +
  `    m.setAttribute('content', metas[k]);\n` +
  `  }\n` +
  `  var s = document.documentElement.style;\n` +
  `  s.height = '100%'; s.overflow = 'hidden';\n` +
  `})();\n`;

const script =
  PRELUDE +
  `(function(){\n` +
  `var __m = Object.create(null);\n` +
  `function __def(id, fn){ __m[id] = { fn: fn, e: null }; }\n` +
  `function __req(id){\n` +
  `  var m = __m[id];\n` +
  `  if (!m) throw new Error('module not bundled: ' + id);\n` +
  `  if (!m.e) { m.e = {}; var mod = { exports: m.e }; m.fn(m.e, __req, mod); m.e = mod.exports; }\n` +
  `  return m.e;\n` +
  `}\n` +
  def('three/core', three.coreCode) +
  def('three', three.modCode) +
  order.map(id => def(id, modules.get(id).code)).join('') +
  `__req(${JSON.stringify(ENTRY)});\n` +
  `})();\n`;

const HEAD =
  `<title>Salt &amp; Tally</title>\n` +
  `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n` +
  `<meta name="theme-color" content="#0b2a3a">\n` +
  `<meta name="description" content="Salt &amp; Tally — a maritime sandbox: one battered cutter, a handful of sailors, and an ocean full of sails.">\n` +
  `<meta name="apple-mobile-web-app-capable" content="yes">\n` +
  `<meta name="mobile-web-app-capable" content="yes">\n` +
  `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n` +
  `<link rel="apple-touch-icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E%3Crect width='180' height='180' fill='%230c2836'/%3E%3Ctext x='90' y='128' font-size='110' text-anchor='middle'%3E%E2%9A%93%3C/text%3E%3C/svg%3E">\n` +
  `<style>\n${css}\n</style>\n`;

const BODY = `${body}\n<script>\n${script}</script>\n`;

fs.mkdirSync(OUT_DIR, { recursive: true });
// for the hosted artifact: content only, the host supplies doctype/head/body
fs.writeFileSync(path.join(OUT_DIR, 'artifact.html'), HEAD + BODY);
// for saving to a device and opening straight from Files
fs.writeFileSync(path.join(OUT_DIR, 'salt-and-tally.html'),
  `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${HEAD}</head>\n<body>\n${BODY}</body>\n</html>\n`);

const kb = f => (fs.statSync(path.join(OUT_DIR, f)).size / 1024).toFixed(0);
console.log(`modules bundled : ${order.length} + three.js`);
console.log(`artifact.html   : ${kb('artifact.html')} KB`);
console.log(`standalone      : ${kb('salt-and-tally.html')} KB`);
console.log(`load order      : ${order.join(' ')}`);
