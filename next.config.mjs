/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Build output directory. Defaults to `.next`, which is what Vercel and CI expect —
   * that default must not change.
   *
   * The escape hatch exists because this repo lives inside a OneDrive folder on Windows,
   * and OneDrive fights `.next`: it turns freshly written files into sync placeholders
   * (reparse points) and removes others mid-build. That surfaces as
   * `EINVAL: readlink '.next\static\chunks'` killing `next dev` seconds after it prints
   * its banner, and as `ENOENT: routes-manifest.json` making every route 500 on a server
   * that started cleanly. Neither is a code fault; neither is fixable from inside the app.
   *
   * Point NEXT_DIST_DIR at a path outside the synced tree and the build lands somewhere
   * OneDrive never looks.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
export default nextConfig;
