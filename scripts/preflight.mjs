import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// What a Drawdy submission needs beyond the repository's own tests: Drawdy
// builds the pushed commit, refuses a version that is not above the live one,
// and fails a bundle over its limit.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://backend.drawdy.io";
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const newer = (a, b) => {
    const [x, y] = [a, b].map((v) => v.split(".").map(Number));
    const i = x.findIndex((n, k) => n !== y[k]);
    return i >= 0 && x[i] > y[i];
};
const problems = [];

if (git("status", "--porcelain")) problems.push("The tree has uncommitted changes; Drawdy builds the pushed commit, not this tree.");

execFileSync("pnpm", ["--silent", "run", "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
if (git("status", "--porcelain")) problems.push("The build changed files; commit them.");
const bundle = statSync(join(ROOT, "dist", "main.js")).size;
if (bundle > MAX_BUNDLE_BYTES) problems.push(`The bundle is ${bundle} bytes; Drawdy takes ${MAX_BUNDLE_BYTES}.`);

git("fetch", "--quiet", "origin");
const head = git("rev-parse", "HEAD");
const tip = git("rev-parse", "origin/HEAD");
if (head !== tip) problems.push(`HEAD ${head.slice(0, 7)} is not the tip of origin's default branch (${tip.slice(0, 7)}); push it first.`);

const res = await fetch(`${API}/api/extensions/catalog/${encodeURIComponent(manifest.driverId)}`);
if (!res.ok && res.status !== 404) throw new Error(`Drawdy catalog: HTTP ${res.status}`);
const live = res.ok ? (await res.json()).entry : null;
if (live && !newer(manifest.driverVersion, live.version)) problems.push(`driverVersion ${manifest.driverVersion} is not above the live ${live.version}; bump it in manifest.json and CHANGELOG.md.`);

console.log(`${manifest.driverId} ${manifest.driverVersion} at ${head.slice(0, 7)} · bundle ${(bundle / 1024).toFixed(0)} KB`);
console.log(live ? `Live: ${live.version} at ${live.commitSha.slice(0, 7)}, published ${live.publishedAt}` : "Live: not published yet");
if (problems.length) {
    for (const p of problems) console.log(`✗ ${p}`);
    process.exit(1);
}
console.log(`✓ Ready to submit ${head} as ${manifest.driverVersion}.`);
