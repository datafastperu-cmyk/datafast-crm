import { NextRequest, NextResponse } from 'next/server';

// Rutas que no requieren sesión
const PUBLIC_PATHS = ['/login', '/installl', '/forgot-password', '/reset-password'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// ─── Portal del Cliente ───────────────────────────────────────
// El portal se sirve en su propio subdominio (PORTAL_DOMAIN). El aislamiento es por
// Host, no por ruta: el dominio del ERP no sirve /portal/* y el dominio del portal no
// sirve nada del ERP. Sin PORTAL_DOMAIN definido el comportamiento es el de siempre —
// una instalación sin portal no cambia en nada.
const PORTAL_LOGIN  = '/portal/login';
const PORTAL_INICIO = '/portal';

function dominioPortal(): string {
  return (process.env.PORTAL_DOMAIN ?? '').split(':')[0].trim().toLowerCase();
}

function hostDe(request: NextRequest): string {
  return (request.headers.get('host') ?? '').split(':')[0].trim().toLowerCase();
}

function middlewarePortal(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // El abonado escribe "cliente.miempresa.pe" a secas → se le lleva al portal.
  // Es un redirect y no un rewrite a propósito: con rewrite, la ruta del navegador y
  // la del router de Next divergen, y `usePathname` deja de coincidir con los `href`
  // de la navegación (menú activo equivocado, enlaces que no resuelven).
  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = PORTAL_INICIO;
    return NextResponse.redirect(url);
  }

  // Cualquier otra ruta fuera de /portal no existe en este dominio.
  if (!pathname.startsWith('/portal')) {
    return NextResponse.rewrite(new URL('/not-found', request.url));
  }

  // portal_refresh_token es HttpOnly: el navegador no la lee, el middleware sí —
  // corre en el servidor. El access token vence a los 30 min y se renueva aparte.
  const conSesion = request.cookies.has('portal_refresh_token');

  if (!conSesion && pathname !== PORTAL_LOGIN) {
    const url = request.nextUrl.clone();
    url.pathname = PORTAL_LOGIN;
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (conSesion && pathname === PORTAL_LOGIN) {
    const url = request.nextUrl.clone();
    url.pathname = PORTAL_INICIO;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const portal = dominioPortal();
  if (portal && hostDe(request) === portal) {
    return middlewarePortal(request);
  }

  // Dominio del ERP: el portal no existe aquí. 404 en vez de redirigir, para no
  // confirmar que el portal está desplegado en este servidor.
  if (pathname.startsWith('/portal')) {
    return NextResponse.rewrite(new URL('/not-found', request.url));
  }

  // El refresh_token es la cookie de larga duración (7 días).
  // El access_token vence en 15 min y se renueva client-side.
  const hasSession = request.cookies.has('refresh_token');

  // Ruta protegida sin sesión → redirigir al login
  if (!hasSession && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Guardar destino original para redirigir después del login
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Ya tiene sesión e intenta acceder al login → redirigir al dashboard
  if (hasSession && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Excluir archivos estáticos, internos de Next.js y rutas /api/* (proxied al backend)
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)).*)',
  ],
};
