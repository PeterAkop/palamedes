/** @type {import('next').NextConfig} */
const nextConfig = {
  // @react-pdf/renderer pulls in fontkit / yoga-layout (wasm + node deps) for
  // server-side PDF rendering; keep it out of the bundler so it loads as a
  // normal Node module in the route.
  serverExternalPackages: ['@react-pdf/renderer'],
  experimental: {
    // Router Cache stale times. Default for `dynamic` is 30s — too sticky
    // for our pattern of "mutate → router.refresh → expect fresh data".
    // 0 = always re-fetch on navigation. Same approach as the sibling
    // compliance-assistant project.
    staleTimes: {
      dynamic: 0,
      static: 180,
    },
  },
};

export default nextConfig;
