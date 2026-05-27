import { NextRequest, NextResponse } from 'next/server';

// Rutas que no requieren sesión
const PUBLIC_PATHS = ['/login', '/installl', '/forgot-password', '/reset-password'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    // Aplicar a todas las rutas excepto archivos estáticos e internos de Next.js
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)).*)',
  ],
};
