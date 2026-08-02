/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

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
};
export default nextConfig;
