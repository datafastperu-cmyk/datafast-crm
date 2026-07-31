'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, Activity, Gauge, CalendarClock } from 'lucide-react';

import { portalApi, type EstadoRouterOnu } from '@/lib/api/portal';

import { useServicioActual } from './useServicioActual';
import { PortalConsumoGrafico } from './PortalConsumoGrafico';
import { cn } from '@/lib/utils';

// Estados del contrato traducidos a lo que el abonado entiende. El color acompaña al
// texto, nunca lo sustituye: un daltónico debe poder leer su situación.
const ESTADO: Record<string, { etiqueta: string; clase: string }> = {
  activo:               { etiqueta: 'ACTIVO',      clase: 'text-emerald-600 dark:text-emerald-400' },
  pendiente_activacion: { etiqueta: 'EN INSTALACIÓN', clase: 'text-sky-600 dark:text-sky-400' },
  moroso:               { etiqueta: 'CON DEUDA',   clase: 'text-amber-600 dark:text-amber-400' },
  suspendido:           { etiqueta: 'SUSPENDIDO',  clase: 'text-red-600 dark:text-red-400' },
  cortado:              { etiqueta: 'CORTADO',     clase: 'text-red-600 dark:text-red-400' },
};

const soles = (n: number) =>
  `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fecha = (iso: string | null) => {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

export function PortalInicio() {
  const { servicio, cargando } = useServicioActual();

  if (cargando || !servicio) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-card border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  const estado = ESTADO[servicio.estado] ?? {
    etiqueta: servicio.estado.replace(/_/g, ' ').toUpperCase(),
    clase: 'text-foreground',
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <TarjetaDeuda />

        <Tarjeta
          etiqueta="Estado del servicio"
          icono={Activity}
          colorIcono="bg-emerald-500"
          valor={estado.etiqueta}
          valorClase={estado.clase}
          pie={
            servicio.enProrroga && servicio.prorrogaHasta
              ? `Prórroga hasta ${fecha(servicio.prorrogaHasta)}`
              : undefined
          }
          /* El estado del equipo va aquí y no en su propia tarjeta: es la respuesta a la
             misma pregunta ("¿tengo servicio?"), y separarlas invita a que se contradigan
             en pantalla. */
          extra={<EstadoRouter />}
        />

        <Tarjeta
          etiqueta="Próximo pago"
          icono={CalendarClock}
          colorIcono="bg-violet-500"
          valor={fecha(servicio.fechaCorte)}
          pie={
            servicio.fechaUltimoPago
              ? `Último pago: ${fecha(servicio.fechaUltimoPago)}`
              : 'Sin pagos registrados'
          }
        />

        {/* Consumo: la única tarjeta sin fuente medida todavía. Se muestra vacía a
            propósito — una cifra que nadie midió es una cifra que el abonado puede
            reclamar y que no podríamos sustentar. Enlaza al detalle, que es también la
            única vía para llegar a Consumo desde un móvil (no cabe en la barra inferior). */}
        <TarjetaConsumo />
      </div>

      <PortalConsumoGrafico />

      {/* Resumen del plan */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tu plan
        </p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-lg font-semibold text-foreground">{servicio.planNombre}</span>
          {/* Un plan sin velocidad cargada se calla: "0 Mbps" se lee como una avería. */}
          {(servicio.velocidadBajada > 0 || servicio.velocidadSubida > 0) && (
            <span className="text-sm text-muted-foreground">
              {servicio.velocidadBajada} Mbps de bajada · {servicio.velocidadSubida} Mbps de subida
            </span>
          )}
        </div>
        {servicio.planDescripcion && (
          <p className="text-sm text-muted-foreground">{servicio.planDescripcion}</p>
        )}
        <p className="text-sm text-foreground">
          Pago mensual: <span className="font-semibold">{soles(servicio.precioMensual)}</span>
        </p>
        <EnlacePlanes />
      </div>
    </div>
  );
}

// Enlace a «Mis servicios» — y única vía para llegar desde un móvil, donde la barra
// inferior se limita a 5 destinos. El texto cambia según el operador ofrezca o no el
// catálogo de cambio: prometer "otros planes" con la sección apagada llevaría a una
// pantalla que solo muestra el plan que el abonado ya tiene.
function EnlacePlanes() {
  const { data: config } = useQuery({
    queryKey: ['portal-config-publica'],
    queryFn:  portalApi.config,
    staleTime: 10 * 60_000,
  });

  return (
    <Link
      href="/portal/servicios"
      className="inline-block text-sm font-medium text-primary hover:underline"
    >
      {config?.secciones.planes
        ? 'Ver mi servicio y otros planes disponibles'
        : 'Ver el detalle de mi servicio'}
    </Link>
  );
}

// Lee el consumo real: si algún día hay colector, esta tarjeta muestra los GB sin tocar
// nada más. Mientras no lo haya, dice que no se mide — nunca "0 GB".
function TarjetaConsumo() {
  const { servicio } = useServicioActual();
  const { data } = useQuery({
    queryKey: ['portal-consumo', servicio?.contratoId],
    queryFn:  () => portalApi.consumo(servicio!.contratoId),
    enabled:  Boolean(servicio?.contratoId),
    // La sección puede estar apagada por el operador: el 404 es una respuesta, no un
    // fallo que valga la pena reintentar.
    retry: false,
  });

  const medido = data?.fuente === 'medido';
  const gb = (data?.totalRxBytes ?? 0) / 1e9;

  return (
    <Link href="/portal/consumo" className="block">
      <Tarjeta
        etiqueta="Consumo del mes"
        icono={Gauge}
        colorIcono={medido ? 'bg-sky-500' : 'bg-slate-400'}
        valor={medido ? `${gb.toFixed(1)} GB` : 'Sin datos'}
        valorClase={medido ? undefined : 'text-muted-foreground'}
        pie={medido ? 'Descarga acumulada del mes' : 'Aún no medimos el consumo de este servicio'}
        atenuada={!medido}
      />
    </Link>
  );
}

function Tarjeta({
  etiqueta, valor, pie, icono: Icono, colorIcono, valorClase, atenuada, extra,
}: {
  etiqueta: string;
  valor: string;
  pie?: string;
  icono: typeof CreditCard;
  colorIcono: string;
  valorClase?: string;
  atenuada?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-5', atenuada && 'opacity-70')}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {etiqueta}
        </p>
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', colorIcono)}>
          <Icono className="w-5 h-5 text-white" />
        </div>
      </div>
      <p className={cn('mt-2 text-2xl font-bold text-foreground', valorClase)}>{valor}</p>
      {pie && <p className="mt-2 pt-2 border-t border-border text-xs text-muted-foreground">{pie}</p>}
      {extra && <div className="mt-2 pt-2 border-t border-border">{extra}</div>}
    </div>
  );
}

// Deuda leída de los comprobantes pendientes, la MISMA fuente que «Recibos».
// `contratos.deuda_total` es un contador denormalizado que solo actualizan algunos
// flujos: mostraba S/ 0.00 con una factura de S/ 64 emitida y sin pagar.
function TarjetaDeuda() {
  const { servicio } = useServicioActual();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['portal-estado-cuenta', servicio?.contratoId],
    queryFn:  () => portalApi.estadoCuenta(servicio!.contratoId),
    enabled:  Boolean(servicio?.contratoId),
    retry: false,
  });

  // Sin dato NO se dice "S/ 0.00": afirmar que no debe nada cuando no pudimos
  // comprobarlo es la peor de las dos equivocaciones posibles.
  if (isLoading || isError || !data) {
    return (
      <Tarjeta
        etiqueta="Deuda actual"
        icono={CreditCard}
        colorIcono="bg-slate-400"
        valor={isLoading ? '—' : 'Sin datos'}
        valorClase="text-muted-foreground"
        pie={isLoading ? 'Consultando tus comprobantes…' : 'No pudimos consultar tus comprobantes'}
        atenuada
      />
    );
  }

  const conDeuda = data.totalPendiente > 0;

  return (
    <Link href="/portal/recibos" className="block">
      <Tarjeta
        etiqueta="Deuda actual"
        icono={CreditCard}
        colorIcono="bg-sky-500"
        valor={soles(data.totalPendiente)}
        valorClase={conDeuda ? 'text-red-600 dark:text-red-400' : undefined}
        pie={
          conDeuda
            ? `${data.cantidadPendiente} comprobante${data.cantidadPendiente === 1 ? '' : 's'} por pagar`
              + (data.cantidadVencida > 0 ? ` · ${data.cantidadVencida} vencido${data.cantidadVencida === 1 ? '' : 's'}` : '')
            : 'Estás al día'
        }
      />
    </Link>
  );
}

// Estado del equipo del abonado. El dato viene del último snapshot que el ERP tomó de
// la OLT, no de una consulta en vivo: por eso se dice cuándo se observó. Presentar una
// lectura de ayer como "ahora" es la mentira que esta línea existe para evitar.
const ROUTER: Record<EstadoRouterOnu, { etiqueta: string; punto: string; texto: string }> = {
  encendido:    { etiqueta: 'Encendido',    punto: 'bg-emerald-500', texto: 'text-emerald-600 dark:text-emerald-400' },
  sin_conexion: { etiqueta: 'Sin conexión', punto: 'bg-red-500',     texto: 'text-red-600 dark:text-red-400' },
  suspendido:   { etiqueta: 'Suspendido',   punto: 'bg-amber-500',   texto: 'text-amber-600 dark:text-amber-400' },
  sin_datos:    { etiqueta: 'Sin datos',    punto: 'bg-slate-400',   texto: 'text-muted-foreground' },
};

function EstadoRouter() {
  const { servicio } = useServicioActual();
  const { data, isLoading } = useQuery({
    queryKey: ['portal-estado-router', servicio?.contratoId],
    queryFn:  () => portalApi.estadoRouter(servicio!.contratoId),
    enabled:  Boolean(servicio?.contratoId),
    retry: false,
  });

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Consultando tu equipo…</p>;
  }

  const info = ROUTER[data?.estado ?? 'sin_datos'];

  return (
    <div className="space-y-1" title={data?.detalle}>
      <div className="flex items-center gap-1.5">
        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', info.punto)} />
        <span className="text-xs text-muted-foreground">Router:</span>
        <span className={cn('text-xs font-semibold', info.texto)}>{info.etiqueta}</span>
      </div>
      {data?.observadoEn && (
        <p className="text-[11px] text-muted-foreground">
          Última lectura {hace(data.observadoEn)}
        </p>
      )}
    </div>
  );
}

// Antigüedad en lenguaje llano. Sin librería: es la única fecha relativa del portal.
function hace(iso: string): string {
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutos < 2)    return 'hace un momento';
  if (minutos < 60)   return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24)     return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
}
