import { NextRequest, NextResponse } from 'next/server';

// Rutas que no requieren sesión
const PUBLIC_PATHS = ['/login', '/installl', '/forgot-password', '/reset-password'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// ─── Portal del Cliente ───────────────────────────────────────
// DOS MODOS, y el que aplica se decide solo. El ERP se instala en VPS distintos y también
// en redes locales sin IP pública ni dominio: exigir un subdominio dejaría sin portal
// justo a esas instalaciones.
//
//   · CON `PORTAL_DOMAIN` — modo SUBDOMINIO (recomendado). El aislamiento es por Host:
//     el dominio del ERP no sirve `/portal/*` y el del portal no sirve nada del ERP.
//     Cookies, CSP y rate-limit quedan separados de la sesión del operador.
//
//   · SIN `PORTAL_DOMAIN` — modo RUTA. El portal vive en `/portal/*` del mismo host, sea
//     una IP, `localhost` o lo que sea. No hay nada que configurar y funciona en una LAN.
//     El precio está en §14 del documento y es real: mismo origen que el ERP, así que la
//     separación entre la sesión del abonado y la del operador deja de ser estructural.
//     Por eso el subdominio sigue siendo lo recomendado en cuanto haya dominio.
const PORTAL_LOGIN  = '/portal/login';
const PORTAL_INICIO = '/portal';

function dominioPortal(): string {
  return (process.env.PORTAL_DOMAIN ?? '').split(':')[0].trim().toLowerCase();
}

function hostDe(request: NextRequest): string {
  return (request.headers.get('host') ?? '').split(':')[0].trim().toLowerCase();
}

// `dedicado` = el portal es dueño del host (modo subdominio). En modo ruta el mismo host
// sirve el ERP, así que ni se redirige la raíz ni se 404ea lo que no es del portal.
function middlewarePortal(request: NextRequest, dedicado: boolean) {
  const { pathname } = request.nextUrl;

  if (dedicado) {
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

  if (portal) {
    // Modo subdominio: el host manda.
    if (hostDe(request) === portal) return middlewarePortal(request, true);

    // Dominio del ERP: el portal no existe aquí. 404 en vez de redirigir, para no
    // confirmar que el portal está desplegado en este servidor.
    if (pathname.startsWith('/portal')) {
      return NextResponse.rewrite(new URL('/not-found', request.url));
    }
  } else if (pathname.startsWith('/portal')) {
    // Modo ruta: sin dominio configurado, el portal convive con el ERP en el mismo host.
    // Es lo que permite que una instalación local o con solo IP tenga portal.
    return middlewarePortal(request, false);
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
