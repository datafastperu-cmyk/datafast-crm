'use client';

import { CreditCard, Activity, Gauge, CalendarClock } from 'lucide-react';

import { useServicioActual } from './useServicioActual';
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
  const conDeuda = servicio.deudaTotal > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Tarjeta
          etiqueta="Deuda actual"
          icono={CreditCard}
          colorIcono="bg-sky-500"
          valor={soles(servicio.deudaTotal)}
          valorClase={conDeuda ? 'text-red-600 dark:text-red-400' : undefined}
          pie={
            conDeuda
              ? `${servicio.mesesDeuda} ${servicio.mesesDeuda === 1 ? 'mes' : 'meses'} pendiente(s)`
              : 'Estás al día'
          }
        />

        <Tarjeta
          etiqueta="Estado del servicio"
          icono={Activity}
          colorIcono="bg-emerald-500"
          valor={estado.etiqueta}
          valorClase={estado.clase}
          pie={
            servicio.enProrroga && servicio.prorrogaHasta
              ? `Prórroga hasta ${fecha(servicio.prorrogaHasta)}`
              : servicio.planNombre
          }
        />

        <Tarjeta
          etiqueta="Próximo corte"
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
            reclamar y que no podríamos sustentar. */}
        <Tarjeta
          etiqueta="Consumo del mes"
          icono={Gauge}
          colorIcono="bg-slate-400"
          valor="Sin datos"
          valorClase="text-muted-foreground"
          pie="Aún no medimos el consumo de este servicio"
          atenuada
        />
      </div>

      {/* Resumen del plan */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tu plan
        </p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-lg font-semibold text-foreground">{servicio.planNombre}</span>
          <span className="text-sm text-muted-foreground">
            {servicio.velocidadBajada} Mbps de bajada · {servicio.velocidadSubida} Mbps de subida
          </span>
        </div>
        {servicio.planDescripcion && (
          <p className="text-sm text-muted-foreground">{servicio.planDescripcion}</p>
        )}
        <p className="text-sm text-foreground">
          Pago mensual: <span className="font-semibold">{soles(servicio.precioMensual)}</span>
        </p>
      </div>
    </div>
  );
}

function Tarjeta({
  etiqueta, valor, pie, icono: Icono, colorIcono, valorClase, atenuada,
}: {
  etiqueta: string;
  valor: string;
  pie?: string;
  icono: typeof CreditCard;
  colorIcono: string;
  valorClase?: string;
  atenuada?: boolean;
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
    </div>
  );
}
