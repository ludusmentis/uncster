// S04-T1 verify: typecheck + vitest + UAT spec edge expectation updated per D023.
// Bare-string wrapper: `npm run verifys04t1` (task-verify engine cannot run compound commands).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (cmd, args) =>
  spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });

let failed = false;
const step = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failed = true;
};

const tsc = run('npx', ['tsc', '--noEmit']);
step('tsc --noEmit', tsc.status === 0);

const vitest = run('npx', ['vitest', 'run']);
step('vitest run', vitest.status === 0);

const spec = readFileSync(
  '.gsd/phases/06-playlist-balance-histogram-logout-redire/06-02-UAT.md',
  'utf8',
);
step('UAT spec single-year edge no longer says "no warning"', !spec.includes('no warning.') || !/Single-year playlist.*no warning/.test(spec));
step('UAT spec single-year edge cites D023', /Single-year[^\n]*D023/.test(spec));

const test = readFileSync('src/game/periodBalance.test.ts', 'utf8');
step('periodBalance.test.ts single-year comment cites D023', /D023/.test(test));

process.exit(failed ? 1 : 0);
