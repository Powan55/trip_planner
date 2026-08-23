const path = require('path');

// bundle attribution behind an explicit opt-in. Disabled, the wrapper
// returns nextConfig UNCHANGED (@next/bundle-analyzer/index.js: `if (!enabled)
// return nextConfig`) — no webpack plugin is pushed, so the normal build stays
// byte-identical. That byte-identity is the decision, not a nicety.
// Second trigger: `ANALYZE=1 next build` is not a runnable npm script on
// Windows (npm runs scripts via cmd.exe, where inline VAR=value is a syntax
// error) and no cross-env dependency is permitted, so `npm run analyze` keys off
// npm_lifecycle_event instead and works on every platform.
// Reports ->.next/analyze/*.html (gitignored). openAnalyzer:false so an
// unattended run never tries to spawn a browser.
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === '1' || process.env.npm_lifecycle_event === 'analyze',
  openAnalyzer: false,
});

// Single source of truth for the GitHub Pages project-page basePath.
// Empty for local dev; CI sets NEXT_PUBLIC_BASE_PATH=/<repo> for deploys.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: '.next',
  output: 'export',
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  productionBrowserSourceMaps: false,
  env: {
    // Single source of truth for the app's visible version: package.json's
    // "version" field, read fresh at every build (local + CI). — this
    // is deliberately the `env` config-key mechanism, NOT the shell-env-var
    // pattern basePath (above) uses, so it can never drift out of sync with
    // package.json and needs zero CI plumbing.
    NEXT_PUBLIC_APP_VERSION: require('./package.json').version,
  },
  // Next 15 promoted this out of `experimental` to the top level (a bare
  // `experimental.outputFileTracingRoot` now warns and no-ops). Same effect.
  outputFileTracingRoot: path.join(__dirname, '../'),
  // OFF, and not as a preference. Left on, next@16's `next dev` writes a pair of
  // tool-instruction markdown files into `trip/` on every start and re-creates them if you
  // delete them. One of the two is not gitignored, so it lands in the next `git add -A`; the
  // other silently plants a generated two-line stub at a path this repo already keeps a
  // hand-written, deliberately unpublished file at. Verified: with this false, a `next dev`
  // start writes neither.
  agentRules: false,
  // The `eslint` key is gone in Next 16 — `next build` no longer lints at all, and leaving
  // the key in warns "Unrecognized key(s)". Lint still gates where it always really did
  // (issue #32): ci.yml's `checks` job runs `npm run lint` (`eslint .` over all source,
  // including core/, hooks/, scripts/ and __tests__/), deploy.yml reaches that same job via
  // workflow_call (#46), and `build: needs: [checks]` means a red lint publishes nothing.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: { unoptimized: true },
  // KNOWN CEILING: the presence of this key is why package.json runs `next build --webpack`
  // and `next dev --webpack`. Next 16 defaults to Turbopack and hard-errors on a project that
  // has a `webpack` config and no `turbopack` config, so a flag either way is mandatory — and
  // `--turbopack` IGNORES the function below rather than translating it, which would change
  // the chunk filenames scripts/gen-sw.mjs derives its precache from. And measured, on a real
  // build: Turbopack does NOT emit `.next/react-loadable-manifest.json` at all — gen-sw reads
  // it to find the ssr:false islands and throws without it, so `--turbopack` fails the build
  // loudly rather than silently shipping a short precache. Moving off webpack means replacing
  // that manifest read first, not just dropping the flag.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.output.filename = 'static/chunks/[name]-[contenthash:8].js';
      config.output.chunkFilename = 'static/chunks/[contenthash:16].js';
    }
    return config;
  },
};

module.exports = withBundleAnalyzer(nextConfig);
