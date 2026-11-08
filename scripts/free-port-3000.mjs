#!/usr/bin/env node
/**
 * Frees port 3000 (the pinned Spotify OAuth redirect URI port) from any stale
 * listener before vite starts, so `npm run dev` does not fail with
 * "Port 3000 is already in use" when a previous dev-server process lingered.
 * Best effort: if nothing holds the port, exits 0 silently.
 */
import { execSync } from 'node:child_process';

const PORT = 3000;

try {
  const pids = execSync(`lsof -ti tcp:${PORT}`, { encoding: 'utf8' }).trim();
  if (pids) {
    console.log(`[predev] killing stale process(es) on port ${PORT}: ${pids.split('\n').join(', ')}`);
    for (const pid of pids.split(/\s+/).filter(Boolean)) {
      try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ }
    }
    // give the OS a moment to release the socket
    await new Promise((r) => setTimeout(r, 300));
  }
} catch {
  // lsof exit 1 = no listener; nothing to do
}
process.exit(0);
