const path = require('path');

// Opt-in only: disabled, the wrapper returns nextConfig unchanged, so normal builds stay
// byte-identical. Keys off npm_lifecycle_event too because inline `ANALYZE=1` fails under
// cmd.exe on Windows.
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === '1' || process.env.npm_lifecycle_event === 'analyze',
  openAnalyzer: false,
});

// GitHub Pages project path. Empty locally; CI sets NEXT_PUBLIC_BASE_PATH=/<repo>.
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
    // Read from package.json at build time so the shown version can't drift from it.
    NEXT_PUBLIC_APP_VERSION: require('./package.json').version,
  },
  outputFileTracingRoot: path.join(__dirname, '../'),
  // Otherwise `next dev` writes generated markdown files into trip/ on every start, one of
  // them over a path this repo keeps a hand-written file at.
  agentRules: false,
  // No `eslint` key: Next 16 removed it. Lint runs in CI's checks job instead.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: { unoptimized: true },
  // KNOWN CEILING: this is why package.json passes --webpack. scripts/gen-sw.mjs depends on
  // these chunk names and on .next/react-loadable-manifest.json, which Turbopack doesn't emit.
  // Moving off webpack means replacing that manifest read first.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.output.filename = 'static/chunks/[name]-[contenthash:8].js';
      config.output.chunkFilename = 'static/chunks/[contenthash:16].js';
    }
    return config;
  },
};

module.exports = withBundleAnalyzer(nextConfig);
