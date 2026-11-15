// S03-T03 verify: full gate suite for the refresh-resume slice, wrapped as a
// single bare-string command (`npm run verify:game-uat`) because the task-verify
// engine cannot run compound/chained shell commands (MEM: verify must be a
// bare string; each gate here is spawned as an independent run-to-completion
// child process — no `&&`, no long-running server rows, per the host contract).
//
// Gates (each also independently runnable via its own npm script):
//   1. npm run verify:units  — vitest run (whole unit suite)
//   2. npm run verify:types  — tsc --noEmit
//   3. npm run verify:walk   — node scripts/uat-run.mjs (self-contained
//      vite-mock browser UAT walk: spawns its own dev server + chrome-for-
//      testing, curl-verifies mock injection first, tears down in finally,
//      exits with the walk's code — includes the G3 hard-refresh resume)
import { spawnSync } from 'node:child_process';

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' });

let failed = false;
const gate = (label, status) => {
  const ok = status === 0;
  console.log(`\n${ok ? 'PASS' : 'FAIL'} gate: ${label}`);
  if (!ok) failed = true;
};

console.log('verify-t03: gate 1/3 — unit suite (vitest run)');
gate('vitest run', run('npx', ['vitest', 'run']).status);

console.log('verify-t03: gate 2/3 — typecheck (tsc --noEmit)');
gate('tsc --noEmit', run('npx', ['tsc', '--noEmit']).status);

console.log('verify-t03: gate 3/3 — vite-mock browser UAT walk (uat-run.mjs)');
gate('uat-run.mjs walk', run('node', ['scripts/uat-run.mjs']).status);

console.log(
  failed
    ? 'verify-t03: one or more gates FAILED'
    : 'verify-t03: all 3 gates passed',
);
process.exit(failed ? 1 : 0);