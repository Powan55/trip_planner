const path = require('path');

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

module.exports = nextConfig;
