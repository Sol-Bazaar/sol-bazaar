/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '1mb',
    },
  },
}

module.exports = nextConfig