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
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../'),
  },
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
