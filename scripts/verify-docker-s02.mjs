// Verify the harlequin app via docker compose (S02).
// 1) docker compose up -d --build (compose maps host 3000 -> container 80).
// 2) curl / and /callback -> index.html (SPA fallback).
// 3) Assert the served index contains NO mock-injection script tag
//    (the vite-mock.config.ts harness injects /mock/uat-mock-setup.ts into
//    index.html; per MEM034/MEM041 the live build must never contain it).
// 4) docker compose down.
// Usage: node scripts/verify-docker-s02.mjs   (also wired as `npm run verifydocker2`)
import { execFileSync } from "node:child_process";

const PORT = 3000;
const BASE = `http://localhost:${PORT}`;
const SERVICE = "app";

function compose(args, opts = {}) {
  const out = execFileSync("docker", ["compose", ...args], { encoding: "utf8", ...opts });
  return typeof out === "string" ? out.trim() : "";
}

// Clean up no matter what happens below (kill container on failure too).
try {
  process.on("exit", () => {
    try {
      compose(["down", "--remove-orphans"], { stdio: "pipe" });
    } catch {
      /* best effort */
    }
  });
} catch {
  /* node supports process exit hook */
}

console.log("docker compose up -d --build ...");
compose(["up", "-d", "--build"], { stdio: "inherit" });
console.log("Compose stack is up (host port 3000 -> container 80).");

async function check(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.text();
  const cache = res.headers.get("cache-control") ?? "";
  return { status: res.status, cache, body };
}

const failures = [];

// Wait for nginx to come up (up to ~20s; build may already have warmed layers)
let ready = false;
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(`${BASE}/`);
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {
    /* retry */
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  console.error("FAIL: compose service did not respond on port 3000 within 20s");
  execFileSync("docker", ["compose", "logs", SERVICE], { stdio: "inherit" });
  process.exit(1);
}

// 1) / must return a valid index.html
const index = await check("/");
if (index.status !== 200 || !index.body.includes('<div id="root">') || !index.body.includes("<script")) {
  failures.push(`/ did not return a valid index.html (status ${index.status})`);
} else {
  console.log(`PASS / -> ${index.status} index.html (${index.body.length} bytes)`);
}

// 2) NO mock-injection script tag in the live build
const MOCK_MARKERS = ["uat-mock-setup", "/mock/", "vite-mock", "window.__HARLEQUIN_MOCK__"];
for (const marker of MOCK_MARKERS) {
  if (index.body.includes(marker)) {
    failures.push(`/ served index contains mock-injection marker: "${marker}" (live build must not be mocked)`);
  }
}
if (!failures.some((f) => f.includes("mock-injection"))) {
  console.log("PASS / contains no mock-injection script tag");
}

// 3) /callback SPA fallback must serve index.html
const callback = await check("/callback");
if (callback.status !== 200 || !callback.body.includes('<div id="root">')) {
  failures.push(`/callback did not return index.html (status ${callback.status})`);
} else {
  console.log(`PASS /callback -> ${callback.status} index.html (${callback.body.length} bytes)`);
}

// 4) A hashed /assets/* file must be 200 + immutable; index no-cache
const assetMatch = index.body.match(/(?:src|href)="(\/assets\/[^"]+)"/);
if (assetMatch) {
  const asset = await check(assetMatch[1]);
  if (asset.status !== 200) {
    failures.push(`${assetMatch[1]} returned ${asset.status}`);
  } else if (!/immutable/.test(asset.cache) || !/max-age=31536000/.test(asset.cache)) {
    failures.push(`${assetMatch[1]} missing immutable cache header (got: "${asset.cache}")`);
  } else {
    console.log(`PASS ${assetMatch[1]} -> ${asset.status}, Cache-Control: ${asset.cache}`);
  }
  if (!/no-cache/.test(index.cache)) {
    failures.push(`/ missing no-cache header (got: "${index.cache}")`);
  } else {
    console.log(`PASS / Cache-Control: ${index.cache}`);
  }
} else {
  failures.push("No /assets/* reference found in index.html");
}

console.log("docker compose down ...");

if (failures.length > 0) {
  console.error("FAILED checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nAll docker compose S02 checks passed (live build, no mock injection).");
