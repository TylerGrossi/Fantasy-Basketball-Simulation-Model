/**
 * Make the Next.js output directory safe to build into on a OneDrive-synced Windows box.
 *
 * Runs automatically before `npm run dev` and `npm run build` (predev/prebuild), so nobody
 * has to remember it.
 *
 * THE PROBLEM. This repo sits under `.../OneDrive/Projects/...`. OneDrive treats build
 * output like documents: it syncs the thousands of files a build writes and then, under
 * Files On-Demand, DEHYDRATES them into cloud placeholders (reparse points) and can drop
 * others mid-build. A dev server that started cleanly then serves 500s on every route:
 *
 *     Cannot find module './611.js'
 *     ENOENT: no such file or directory, open '.next\routes-manifest.json'
 *     EINVAL: readlink '.next\static\chunks'
 *
 * Every one of those looks like a code or cache fault. None of them is. Deleting `.next`
 * and restarting "fixes" it right up until OneDrive dehydrates the new output too, which
 * is why it kept coming back.
 *
 * THE FIX. `attrib +P` is Windows' "always keep on this device" pin. Pinning the folder
 * makes OneDrive materialise its contents and never dehydrate them, and the pin is
 * inherited by files created later — so it holds for every subsequent build, not just the
 * files present right now. The directory is created first because a pin needs something to
 * apply to.
 *
 * Deliberately NOT the fix: relocating distDir outside the synced tree. Next emits
 * `require('react/jsx-runtime')` into the server bundles and Node resolves that from the
 * output file's own directory, so an output dir with no `node_modules` above it 500s on
 * every route instead. See the comment in next.config.mjs.
 *
 * No-ops on macOS/Linux and on CI, where none of this applies.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, process.env.NEXT_DIST_DIR || ".next");

if (process.platform !== "win32" || process.env.CI || process.env.VERCEL) {
  process.exit(0);
}

/**
 * FIRST CHOICE: keep build output out of OneDrive entirely.
 *
 * Pinning (below) stops dehydration, but OneDrive still UPLOADS every file a build writes
 * and holds a lock on each while it does — `next dev` then fails mid-compile with
 * `EBUSY: resource busy or locked, open '.next\server\app\…'`, pages hang or never load,
 * and OneDrive burns ~2 cores the whole time. Measured 2026-10-20.
 *
 * So `.next` stays at its path inside the project but is a JUNCTION to a folder under
 * %LOCALAPPDATA%, which OneDrive never sees. The relocated-distDir failure described
 * above doesn't apply: beside the real folder sits a second junction, `node_modules`,
 * pointing back at the project's, so Node's walk up from any output file still finds
 * `react/jsx-runtime` — and finds the SAME copy the project uses.
 *
 * Falls through to the pin when a junction can't be made, so nothing gets worse.
 */
const outside = path.join(
  process.env.LOCALAPPDATA || path.join(root, ".."),
  "fbbsim-build",
  path.basename(dist)
);
const isJunction = (() => {
  try {
    return fs.lstatSync(dist).isSymbolicLink();
  } catch {
    return false;
  }
})();
if (isJunction && fs.existsSync(outside)) {
  console.log(`ensure-dist: ${path.basename(dist)} -> ${outside} (outside OneDrive)`);
  process.exit(0);
}
try {
  fs.mkdirSync(outside, { recursive: true });
  const nm = path.join(path.dirname(outside), "node_modules");
  if (!fs.existsSync(nm)) fs.symlinkSync(path.join(root, "node_modules"), nm, "junction");
  // A plain dist dir (old build output, or a fresh clone) is replaced by the link; it
  // only ever holds regenerable output.
  fs.rmSync(dist, { recursive: true, force: true });
  fs.symlinkSync(outside, dist, "junction");
  console.log(`ensure-dist: ${path.basename(dist)} -> ${outside} (outside OneDrive)`);
  process.exit(0);
} catch (e) {
  console.warn(`ensure-dist: could not relocate ${path.basename(dist)} (${e.message}); pinning instead`);
}

fs.mkdirSync(dist, { recursive: true });

/**
 * Two passes, and BOTH matter:
 *
 *   1. the directory itself — this is the one that carries forward, because OneDrive
 *      applies a pinned folder's state to files created in it later, which is the entire
 *      point (a build writes its files long after this script has exited).
 *   2. anything already inside it, for a dist dir that predates this script.
 *
 * Pinning only `.next\*` (pass 2 alone) was tried and left later-written files
 * unpinned — 12 of 101 came back as placeholders on the very next build.
 */
const pin = (args) =>
  new Promise((resolve) => execFile("attrib", args, { cwd: root }, (err) => resolve(err)));

const err =
  (await pin(["+P", "/d", dist])) || (await pin(["+P", "/s", "/d", path.join(dist, "*")]));

if (err) {
  // A failed pin is not worth blocking a build over — it just means the OneDrive symptoms
  // above can recur, and the message says where to look when they do.
  console.warn(`ensure-dist: could not pin ${path.basename(dist)} (${err.message})`);
  console.warn("ensure-dist: OneDrive may dehydrate build output; see next.config.mjs.");
} else {
  console.log(`ensure-dist: ${path.basename(dist)} pinned (always keep on this device)`);
}
