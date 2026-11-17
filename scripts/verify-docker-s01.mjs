// Verify the harlequin Docker image serves the SPA correctly.
// 1) Image `harlequin` exists (build it if missing).
// 2) Run container on port 3000, curl / and /callback -> index.html.
// 3) Curl a hashed /assets/* file -> 200 + immutable cache header.
// 4) Report image size.
// Usage: node scripts/verify-docker-s01.mjs   (also wired as `npm run verifydocker`)
import { execFileSync } from "node:child_process";

const IMAGE = "harlequin";
const PORT = 3000;
const CONTAINER = "harlequin-verify-s01";
const BASE = `http://localhost:${PORT}`;

function docker(args, opts = {}) {
  return execFileSync("docker", args, { encoding: "utf8", ...opts }).trim();
}

function imageExists(name) {
  try {
    docker(["image", "inspect", name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

if (!imageExists(IMAGE)) {
  console.log(`Image ${IMAGE} not found; building...`);
  docker(["build", "-t", IMAGE, "."], { stdio: "inherit" });
} else {
  console.log(`Image ${IMAGE} found.`);
}

const sizeRaw = docker(["image", "inspect", IMAGE, "--format", "{{.Size}}"]);
const sizeMB = (Number(sizeRaw) / 1024 / 1024).toFixed(1);
console.log(`Image size: ${sizeMB} MB (${sizeRaw} bytes)`);

// Clean any stale verification container
try {
  docker(["rm", "-f", CONTAINER], { stdio: "pipe" });
} catch {
  /* not running */
}
docker(["run", "-d", "--name", CONTAINER, "-p", `${PORT}:80`, IMAGE]);
console.log(`Container ${CONTAINER} started on port ${PORT}.`);

async function check(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.text();
  const cache = res.headers.get("cache-control") ?? "";
  return { status: res.status, cache, body };
}

const failures = [];

// Wait for nginx to come up (up to ~15s)
let ready = false;
for (let i = 0; i < 30; i++) {
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
  console.error("FAIL: container did not respond on port 3000 within 15s");
  docker(["logs", CONTAINER], { stdio: "inherit" });
  process.exit(1);
}

// 1) / and /callback must both serve index.html
const index = await check("/");
if (index.status !== 200 || !index.body.includes("<div id=\"root\">") || !index.body.includes("<script")) {
  failures.push(`/ did not return a valid index.html (status ${index.status})`);
} else {
  console.log(`PASS / -> ${index.status} index.html (${index.body.length} bytes)`);
}

const callback = await check("/callback");
if (callback.status !== 200 || !callback.body.includes("<div id=\"root\">")) {
  failures.push(`/callback did not return index.html (status ${callback.status})`);
} else {
  console.log(`PASS /callback -> ${callback.status} index.html (${callback.body.length} bytes)`);
}

// 2) Find a hashed /assets/* file from index.html and check 200 + immutable
const assetMatch = index.body.match(/(?:src|href)="(\/assets\/[^"]+)"/);
if (!assetMatch) {
  failures.push("No /assets/* reference found in index.html");
} else {
  const assetPath = assetMatch[1];
  const asset = await check(assetPath);
  if (asset.status !== 200) {
    failures.push(`${assetPath} returned ${asset.status}`);
  } else if (!/immutable/.test(asset.cache) || !/max-age=31536000/.test(asset.cache)) {
    failures.push(`${assetPath} missing immutable cache header (got: "${asset.cache}")`);
  } else {
    console.log(`PASS ${assetPath} -> ${asset.status}, Cache-Control: ${asset.cache}`);
  }

  // 3) index.html must be no-cache
  if (!/no-cache/.test(index.cache)) {
    failures.push(`/ missing no-cache header (got: "${index.cache}")`);
  } else {
    console.log(`PASS / Cache-Control: ${index.cache}`);
  }
}

docker(["rm", "-f", CONTAINER], { stdio: "pipe" });

if (failures.length > 0) {
  console.error("FAILED checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nAll docker S01 checks passed. Image size: ${sizeMB} MB`);
