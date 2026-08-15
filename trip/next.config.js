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
  // STAYS TRUE. Lint gates on the workflow, not the build (issue #32). ci.yml's `checks` job
  // runs `npm run lint` (`eslint .`), and since #46 deploy.yml reaches that same job through
  // workflow_call — so lint gates the feature-branch push, the pull request, AND a direct push
  // to main, and `build: needs: [checks]` means a red lint publishes nothing. There is no path
  // that ships without it.
  //
  // Flipping this to false does not add a gate, it adds a NARROWER duplicate: Next's build-lint
  // only walks app/pages/components/lib/src unless `eslint.dirs` is also set, while flat config
  // + `eslint .` covers all 573 source files including core/, hooks/, scripts/ and __tests__/.
  // So the naive flip costs every build a second eslint pass that sees LESS than the one already
  // running, and re-opens the blind spot #32 was filed about. If you flip it, set eslint.dirs too.
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: { unoptimized: true },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.output.filename = 'static/chunks/[name]-[contenthash:8].js';
      config.output.chunkFilename = 'static/chunks/[contenthash:16].js';
    }
    return config;
  },
};

module.exports = withBundleAnalyzer(nextConfig);
