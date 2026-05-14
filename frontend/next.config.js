/** @type {import('next').NextConfig} */
const nextConfig = {
  // App Router habilitado por defecto en Next 14
  reactStrictMode: true,

  // Proxy: el frontend en /3000 redirige /api/** al backend en /4000
  async rewrites() {
    return [
      {
        source:      '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/:path*`,
      },
    ];
  },

  // Imágenes: permitir el dominio del backend para logos y fotos
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.fibranet.pe',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  // Variables de entorno disponibles en el cliente
  env: {
    NEXT_PUBLIC_APP_NAME: 'FibraNet ISP',
    NEXT_PUBLIC_VERSION:  '1.0.0',
  },

  // Headers de seguridad
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',          value: 'DENY' },
          { key: 'X-Content-Type-Options',    value: 'nosniff' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection',          value: '1; mode=block' },
        ],
      },
    ];
  },

  // Webpack: alias para importaciones más limpias
  webpack(config) {
    return config;
  },
};

module.exports = nextConfig;
