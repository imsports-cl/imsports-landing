/** @type {import('next').NextConfig} */
const nextConfig = {
  // Serve the .well-known files from public/ with correct headers.
  // Apple exige application/json, sin redirect y sin extensión.
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
      {
        source: '/.well-known/assetlinks.json',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      // join.html existía en el sitio estático y sigue en public/.
      // En nextjs-migration la ruta /join/:code daba 404; se restaura.
      { source: '/join/:code', destination: '/join.html' },
    ];
  },
};

export default nextConfig;
