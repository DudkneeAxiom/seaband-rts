/* Run every check, in one command, against a server this script starts itself.
   `npm test`. Add `--fast` to skip the two slow calibration runs. */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { serve, isUp } from './serve.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const fast = process.argv.includes('--fast');

/* Suites that assert, in the order it is most useful to see them fail. The
   two marked slow are calibration runs that print tables rather than verdicts. */
const SUITES = [
  ['origin', 'the questionnaire, its effects and the story spine'],
  ['systems', 'rules: contracts, discoveries, shoals, weight, time'],
  ['trade', 'the merchant road, upkeep and the way back from nothing'],
  ['shore', 'harbours built on land, and credit for shared kills'],
  ['helm', 'the compass against the real projection, and every key'],
  ['audio', 'the mixer under abuse: nothing clips, nothing goes NaN'],
  ['touch', 'taps, drags and pinches on the real canvas'],
  ['rig', 'the sails against the wind'],
  ['playthrough', 'the whole arc, driven through the real UI'],
  ['layout', 'no overlapping controls at five viewports'],
  ['gunnery', 'accuracy and duel outcomes', 'slow'],
  ['world', 'ten simulated minutes of nobody watching', 'slow'],
];

const run = (file, args = []) => new Promise(resolve => {
  const p = spawn(process.execPath, [path.join(ROOT, 'tools', file), ...args], { cwd: ROOT });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.on('close', code => resolve({ code, out }));
});

let server = null;
if (await isUp()) console.log('using the server already on :8080\n');
else { server = await serve(); console.log('started a server on :8080\n'); }

const results = [];
const t0 = Date.now();
for (const [name, what, slow] of SUITES) {
  if (fast && slow) { console.log(`  ${name.padEnd(12)} skipped (--fast)`); continue; }
  process.stdout.write(`  ${name.padEnd(12)} ${what} … `);
  const { code, out } = await run(`${name}.mjs`);
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const lay = out.match(/(\d+) layout problems/);
  const line = m ? `${m[1]} passed, ${m[2]} failed`
    : lay ? `${lay[1]} layout problems`
      : (code === 0 ? 'ok' : 'FAILED');
  const bad = code !== 0 || (m && +m[2] > 0) || (lay && +lay[1] > 0);
  console.log(bad ? `${line}  <<<` : line);
  results.push({ name, bad, out });
}

const broken = results.filter(r => r.bad);
console.log(`\n${results.length - broken.length}/${results.length} suites clean in ${Math.round((Date.now() - t0) / 1000)}s`);
for (const b of broken) {
  console.log(`\n──────── ${b.name} ────────`);
  console.log(b.out.split('\n').filter(l => /^FAIL|ERROR|!!/.test(l)).slice(0, 12).join('\n') || b.out.slice(-1200));
}
if (server) server.close();
process.exit(broken.length ? 1 : 0);
