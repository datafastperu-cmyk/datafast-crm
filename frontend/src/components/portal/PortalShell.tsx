'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Home, User, LogOut, ChevronDown, Wifi, AlertTriangle, Loader2, MapPin, Receipt, Smartphone,
  Gauge, LifeBuoy, Layers,
} from 'lucide-react';

import { portalApi, PortalError, type PortalServicio } from '@/lib/api/portal';
import { usePortalStore } from '@/store/portal.store';
import { BotonPagoFlotante } from './PortalFacturacion';
import { cn } from '@/lib/utils';

interface ItemNav {
  href:  string;
  label: string;
  icon:  typeof Home;
  // La barra inferior de móvil admite 5 destinos legibles; a partir de ahí los íconos se
  // aprietan y se vuelven intocables con el pulgar. Las secciones secundarias viven en el
  // menú de escritorio y se alcanzan desde las tarjetas de Inicio.
  movil: boolean;
}

// La navegación crece por fases y respeta los toggles del panel: si el operador apaga
// una sección, su enlace desaparece Y su endpoint responde 404 — el menú no es el
// control de acceso, solo su reflejo.
function construirNav(secciones?: {
  comprobantes: boolean; wifi: boolean; dispositivos: boolean;
  soporte: boolean; consumo: boolean; planes: boolean;
}): ItemNav[] {
  const items: ItemNav[] = [{ href: '/portal', label: 'Inicio', icon: Home, movil: true }];
  if (secciones?.comprobantes) {
    items.push({ href: '/portal/facturas', label: 'Facturas', icon: Receipt, movil: true });
  }
  if (secciones?.wifi) {
    items.push({ href: '/portal/wifi', label: 'Mi WiFi', icon: Wifi, movil: true });
  }
  if (secciones?.dispositivos) {
    items.push({ href: '/portal/dispositivos', label: 'Equipos', icon: Smartphone, movil: false });
  }
  if (secciones?.consumo) {
    items.push({ href: '/portal/consumo', label: 'Consumo', icon: Gauge, movil: false });
  }
  if (secciones?.planes) {
    items.push({ href: '/portal/planes', label: 'Planes', icon: Layers, movil: false });
  }
  if (secciones?.soporte) {
    items.push({ href: '/portal/soporte', label: 'Soporte', icon: LifeBuoy, movil: true });
  }
  items.push({ href: '/portal/mis-datos', label: 'Mis datos', icon: User, movil: true });
  return items;
}

export function PortalShell({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname() ?? '';
  const { contratoId, setContratoId, limpiar } = usePortalStore();

  const { data: config } = useQuery({
    queryKey: ['portal-config-publica'],
    queryFn:  portalApi.config,
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const { data: perfil, isLoading, error } = useQuery({
    queryKey: ['portal-me'],
    queryFn:  portalApi.me,
    retry: (intentos, err) =>
      // Una sesión vencida no se reintenta: se manda al login. Reintentar solo retrasa
      // el mensaje y multiplica peticiones que ya sabemos que fallan.
      !(err instanceof PortalError && err.tipo === 'sesion') && intentos < 2,
  });

  // Sesión caída → al login. El middleware ya protege la ruta, pero el access token
  // puede vencer con el portal abierto y sin recargar la página.
  useEffect(() => {
    if (error instanceof PortalError && error.tipo === 'sesion') {
      limpiar();
      router.replace('/portal/login');
    }
  }, [error, router, limpiar]);

  // Memoizado: `?? []` crea un array nuevo en cada render y arrastraría a todos los
  // efectos que dependen de él a ejecutarse siempre.
  const servicios = useMemo<PortalServicio[]>(() => perfil?.servicios ?? [], [perfil]);

  const servicio = useMemo<PortalServicio | null>(() => {
    if (!servicios.length) return null;
    return servicios.find((s) => s.contratoId === contratoId) ?? servicios[0];
  }, [servicios, contratoId]);

  // Si el contrato guardado ya no existe (baja, traslado), se reancla al primero en vez
  // de dejar el portal apuntando a un servicio fantasma.
  useEffect(() => {
    if (servicio && servicio.contratoId !== contratoId) setContratoId(servicio.contratoId);
  }, [servicio, contratoId, setContratoId]);

  const nav = useMemo(() => construirNav(config?.secciones), [config]);

  const cerrarSesion = async () => {
    await portalApi.logout();
    limpiar();
    router.replace('/portal/login');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !(error instanceof PortalError && error.tipo === 'sesion')) {
    return (
      <ErrorPantalla
        mensaje={error instanceof PortalError ? error.message : 'No pudimos cargar tus datos.'}
      />
    );
  }

  return (
    <div className="min-h-screen bg-muted/40">
      {/* ── Cabecera ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-4">
          <div className="flex items-center gap-2 min-w-0">
            {config?.logoUrl ? (
              // eslint-disable-next-line
              <img src={config.logoUrl} alt={config.titulo} className="h-8 w-auto" />
            ) : (
              <Wifi className="w-6 h-6 text-primary flex-shrink-0" />
            )}
            <span className="font-semibold text-foreground truncate">
              {config?.titulo ?? 'Portal del Cliente'}
            </span>
          </div>

          <div className="flex-1" />

          <div className="hidden sm:flex items-center gap-2 min-w-0">
            <span
              className="text-sm text-foreground truncate max-w-[220px]"
              title={perfil?.nombreCompleto}
            >
              {perfil?.nombreCompleto}
            </span>
          </div>

          <button
            type="button"
            onClick={cerrarSesion}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-5 lg:flex lg:gap-6">
        {/* ── Navegación lateral (escritorio) ─────────────────── */}
        <nav className="hidden lg:block w-56 flex-shrink-0">
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Menú
          </p>
          <ul className="space-y-1">
            {nav.map((item) => (
              <li key={item.href}>
                <EnlaceNav item={item} activo={esActivo(pathname, item.href)} />
              </li>
            ))}
          </ul>
        </nav>

        {/* ── Contenido ───────────────────────────────────────── */}
        <main className="flex-1 min-w-0 space-y-4 pb-24 lg:pb-0">
          {servicios.length === 0 ? (
            <ErrorPantalla
              mensaje="No encontramos servicios activos asociados a tu cuenta. Comunícate con nosotros."
              embebido
            />
          ) : (
            <>
              <SelectorServicio
                servicios={servicios}
                seleccionado={servicio!}
                onSeleccionar={setContratoId}
              />
              {children}
            </>
          )}
        </main>
      </div>

      {/* ── Navegación inferior (móvil) ───────────────────────── */}
      {/* En móvil la lateral no se convierte en hamburguesa: esconder la navegación
          justo donde más se usa es el error clásico de portar un layout de escritorio. */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border">
        <ul className="flex">
          {nav.filter((i) => i.movil).map((item) => {
            const activo = esActivo(pathname, item.href);
            const Icono  = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className={cn(
                    'flex flex-col items-center gap-0.5 py-2.5 text-xs transition-colors',
                    activo ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  <Icono className="w-5 h-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Se monta en el shell, no por página: la deuda es la misma en toda la sesión y
          el abonado debe poder pagar desde donde esté. Solo aparece si debe algo. */}
      <BotonPagoFlotante />
    </div>
  );
}

function esActivo(pathname: string, href: string): boolean {
  if (href === '/portal') return pathname === '/portal';
  return pathname === href || pathname.startsWith(href + '/');
}

function EnlaceNav({ item, activo }: { item: ItemNav; activo: boolean }) {
  const Icono = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
        activo
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
      )}
    >
      <Icono className="w-4 h-4" />
      {item.label}
    </Link>
  );
}

// ─── Selector de servicio ─────────────────────────────────────
// Con más de un contrato, los datos del portal son ambiguos sin decir a cuál servicio
// corresponden. Se muestra dirección y plan porque el número de contrato no le dice
// nada al abonado: su casa y su velocidad, sí.
function SelectorServicio({
  servicios, seleccionado, onSeleccionar,
}: {
  servicios: PortalServicio[];
  seleccionado: PortalServicio;
  onSeleccionar: (id: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);

  if (servicios.length === 1) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <ResumenServicio servicio={seleccionado} />
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3 text-left hover:border-primary/50 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <ResumenServicio servicio={seleccionado} />
        </div>
        <ChevronDown
          className={cn('w-4 h-4 text-muted-foreground transition-transform', abierto && 'rotate-180')}
        />
      </button>

      {abierto && (
        <ul className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          {servicios.map((s) => (
            <li key={s.contratoId}>
              <button
                type="button"
                onClick={() => { onSeleccionar(s.contratoId); setAbierto(false); }}
                className={cn(
                  'w-full px-4 py-3 text-left hover:bg-muted transition-colors',
                  s.contratoId === seleccionado.contratoId && 'bg-primary/5',
                )}
              >
                <ResumenServicio servicio={s} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResumenServicio({ servicio }: { servicio: PortalServicio }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-foreground truncate">
        {servicio.planNombre} · {servicio.velocidadBajada} Mbps
      </p>
      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
        <MapPin className="w-3 h-3 flex-shrink-0" />
        {servicio.direccion ?? `Contrato ${servicio.numeroContrato}`}
      </p>
    </div>
  );
}

function ErrorPantalla({ mensaje, embebido }: { mensaje: string; embebido?: boolean }) {
  const contenido = (
    <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3 max-w-md mx-auto">
      <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
      <p className="text-sm text-foreground">{mensaje}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
      >
        Reintentar
      </button>
    </div>
  );

  if (embebido) return contenido;
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      {contenido}
    </div>
  );
}
