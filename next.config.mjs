// next.config.mjs
const isProd = process.env.NODE_ENV === 'production';
const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || (isProd ? 'https://cryptoscope-be-latest.onrender.com' : 'http://localhost:5050');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Prevent buffering for SSE endpoints
        source: '/api/:path(.*-sse)',
        headers: [
          { key: 'X-Accel-Buffering', value: 'no' },
          { key: 'Cache-Control', value: 'no-cache, no-transform' },
        ],
      },
    ];
  },
  async rewrites() {
    const target = BACKEND_URL.trim();
    const normalized = target.endsWith('/') ? target.slice(0, -1) : target;
    return {
      beforeFiles: [
        // Serve an SVG as favicon to avoid 404s in dev when no favicon.ico exists
        { source: '/favicon.ico', destination: '/globe.svg' },
      ],
      // Match Next.js file-system routes (like /api/auth/*) BEFORE proxying
      afterFiles: [
        // Proxy all remaining API calls (including SSE) through Next.js to avoid CORS
        { source: '/api/:path*', destination: `${normalized}/api/:path*` },
      ],
    };
  },
};

export default nextConfig;
