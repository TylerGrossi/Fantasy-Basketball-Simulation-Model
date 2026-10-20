import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * This project's own folder, stated outright. Left to infer it, Next found a stray
 * package-lock.json two levels up (OneDrive\Projects\) and took THAT as the workspace
 * root — so the dev server watched and resolved against every project in the OneDrive
 * folder, and every request paid for it (~1.2s even for an API route that returns a 400
 * immediately; 2026-10-20).
 */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: projectRoot,
  turbopack: { root: projectRoot },

  /**
   * Build output directory. Stays `.next`, INSIDE the project — see the warning below
   * before moving it.
   *
   * This repo lives in a OneDrive folder on Windows, and OneDrive fights build output: it
   * dehydrates freshly written files into cloud placeholders and drops others mid-build.
   * Symptoms that look like code faults and are not:
   *
   *   - `EINVAL: readlink '.next\static\chunks'` killing `next dev` right after its banner
   *   - `Cannot find module './611.js'` on every route
   *   - `ENOENT: routes-manifest.json` making every page 500 on a server that started clean
   *
   * The fix is `scripts/ensure-dist.mjs` (wired to `predev`/`prebuild`), which pins `.next`
   * as "always keep on this device" so OneDrive can never dehydrate it. NOT a relocated
   * distDir.
   *
   * DON'T point distDir outside the project to dodge OneDrive — it was tried and it fails
   * worse. Next emits `require('react/jsx-runtime')` into the server bundles, and Node
   * resolves that from the OUTPUT file's directory. Under `%LOCALAPPDATA%\nextdist\…`
   * there is no `node_modules` anywhere up the tree, so every route 500s with
   * `Cannot find module 'react/jsx-runtime'` — a cleaner-looking break that is just as dead.
   *
   * `NEXT_DIST_DIR` remains as an escape hatch for a throwaway output dir (still inside the
   * project, e.g. `.next-verify`, which is how a build can be checked without clobbering a
   * running dev server's chunks).
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  /**
   * DEV ONLY: how many compiled pages `next dev` keeps in memory. The defaults (5 pages,
   * dropped after 60s idle) are for big apps; with ~30 routes they meant moving around the
   * menu kept throwing away pages compiled a minute ago and recompiling them — a multi-
   * second stall on a page you had just seen. Keep them all, for an hour.
   */
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 100,
  },
};
export default nextConfig;
