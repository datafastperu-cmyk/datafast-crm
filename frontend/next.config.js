const path    = require('path');
const withPWA = require('@ducanh2912/next-pwa').default;

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  webpack(config) {
    config.resolve.alias['@'] = path.join(__dirname, 'src');
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',           value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options',     value: 'nosniff' },
          { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',         value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control',     value: 'on' },
        ],
      },
    ];
  },
  async rewrites() {
    // El CRM WhatsApp corre en su propio proceso (datafast-whatsapp, :4002),
    // aislado porque aloja Chromium. Estas dos reglas van ANTES de la genérica:
    // el navegador entra por el puerto de Next, no por nginx, así que sin ellas
    // las llamadas del CRM acaban en api-core — el proceso que no tiene el
    // cliente — y la pantalla se queda en "Iniciando cliente…" para siempre.
    const WA_API = process.env.WA_API_URL || 'http://localhost:4002';
    return [
      {
        source: '/api/v1/crm-nativo/:path*',
        destination: `${WA_API}/api/v1/crm-nativo/:path*`,
      },
      {
        // WebSocket del CRM (socket.io con path propio)
        source: '/wa-socket/:path*',
        destination: `${WA_API}/wa-socket/:path*`,
      },
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
    ],
  },
};

module.exports = withPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: true,
  // El Portal del Cliente queda FUERA del service worker.
  //
  // El SW se registra con alcance '/' y el portal vive en el mismo origen que el ERP
  // (modo ruta), así que sin esta exclusión intercepta también /portal/*. Dos motivos
  // para sacarlo, y el segundo ya mordió en producción:
  //
  //   1. Es lo que dice el diseño (§1.1): nada de servir desde caché la deuda, el estado
  //      del servicio o las facturas. Un abonado mirando un saldo viejo reclama por algo
  //      que ya pagó.
  //   2. Una respuesta cacheada sobrevive al despliegue que la corrige. Tras arreglar el
  //      bucle de redirección del login, el navegador seguía sirviendo la versión vieja
  //      desde el SW: el portal "no abría" con el servidor respondiendo en 50 ms.
  //
  // `exclude` deja /portal fuera del precaché y el denylist impide que el SW responda
  // navegaciones del portal con el fallback offline.
  exclude: [/^\/portal/],
  workboxOptions: {
    disableDevLogs: true,
    navigateFallbackDenylist: [/^\/portal/, /^\/api\//],
  },
})(nextConfig);
