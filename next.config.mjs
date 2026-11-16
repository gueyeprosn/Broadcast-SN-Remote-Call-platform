/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  // Sortie autonome : l'image Docker n'embarque que les modules réellement
  // utilisés, au lieu de tout node_modules.
  output: 'standalone',
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
  async headers() {
    const base = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=()',
      },
    ]
    return [
      { source: '/((?!output).*)', headers: base },
      {
        // The vMix clean output page must be embeddable and never cached.
        source: '/output/:key*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), display-capture=(), geolocation=()',
          },
        ],
      },
    ]
  },
}
export default nextConfig
