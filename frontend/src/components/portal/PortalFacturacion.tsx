'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

import { portalApi, PortalError, type EstadoFacturaVisible } from '@/lib/api/portal';
import { useServicioActual } from './useServicioActual';
import { cn } from '@/lib/utils';

const soles = (n: number) =>
  `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fecha = (iso: string | null) => {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

const FILTROS: Array<{ id: 'todas' | EstadoFacturaVisible; label: string }> = [
  { id: 'todas',     label: 'Todas' },
  { id: 'vencida',   label: 'Vencidas' },
  { id: 'pendiente', label: 'Pendientes' },
  { id: 'pagada',    label: 'Pagadas' },
];

const SELLO: Record<EstadoFacturaVisible, { label: string; clase: string; icono: typeof Clock }> = {
  pagada:    { label: 'Pagada',    clase: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30', icono: CheckCircle2 },
  pendiente: { label: 'Pendiente', clase: 'text-amber-700 bg-amber-500/10 border-amber-500/30',       icono: Clock },
  vencida:   { label: 'Vencida',   clase: 'text-red-700 bg-red-500/10 border-red-500/30',             icono: AlertTriangle },
};

export function PortalFacturacion() {
  const { servicio } = useServicioActual();
  const [filtro, setFiltro] = useState<'todas' | EstadoFacturaVisible>('todas');

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-estado-cuenta', servicio?.contratoId],
    queryFn:  () => portalApi.estadoCuenta(servicio!.contratoId),
    enabled:  Boolean(servicio?.contratoId),
  });

  if (isLoading || !servicio) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-card border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3">
        <AlertTriangle className="w-7 h-7 text-amber-500 mx-auto" />
        <p className="text-sm text-foreground">
          {error instanceof PortalError ? error.message : 'No pudimos cargar tus recibos.'}
        </p>
      </div>
    );
  }

  const facturas = (data?.facturas ?? []).filter(
    (f) => filtro === 'todas' || f.estado === filtro,
  );

  return (
    <div className="space-y-4">
      {/* Estado de cuenta */}
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Estado de cuenta
        </p>
        <p
          className={cn(
            'mt-2 text-3xl font-bold',
            (data?.totalPendiente ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground',
          )}
        >
          {soles(data?.totalPendiente ?? 0)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {data?.cantidadPendiente
            ? `${data.cantidadPendiente} recibo(s) por pagar${
                data.cantidadVencida ? ` · ${data.cantidadVencida} vencido(s)` : ''
              }`
            : 'No tienes deudas pendientes'}
        </p>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-colors',
              filtro === f.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Listado */}
      {facturas.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No hay recibos en esta vista.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {facturas.map((f) => {
            const sello = SELLO[f.estado];
            const Icono = sello.icono;
            return (
              <li key={f.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{f.concepto}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {f.numero} · Vence {fecha(f.fechaVencimiento)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium flex-shrink-0',
                      sello.clase,
                    )}
                  >
                    <Icono className="w-3.5 h-3.5" />
                    {sello.label}
                  </span>
                </div>

                <div className="mt-3 pt-3 border-t border-border flex items-baseline justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {f.estado === 'pagada'
                      ? `Pagado el ${fecha(f.fechaPago)}`
                      : f.montoPagado > 0
                        ? `Abonado ${soles(f.montoPagado)} de ${soles(f.total)}`
                        : `Periodo ${fecha(f.periodoInicio)} — ${fecha(f.periodoFin)}`}
                  </span>
                  <span className="text-base font-semibold text-foreground">
                    {soles(f.estado === 'pagada' ? f.total : f.saldo)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Sin descargas: el portal no entrega comprobantes en PDF (decisión de negocio).
          Se dice explícitamente para que el abonado sepa a dónde ir, en vez de buscar
          un botón que no existe. */}
      <p className="text-xs text-muted-foreground px-1">
        ¿Necesitas tu recibo impreso? Solicítalo por soporte y te lo hacemos llegar.
      </p>
    </div>
  );
}

// Botón flotante de pago. Aparece solo con deuda: un botón de pago permanente en la
// pantalla de quien está al día es ruido.
export function BotonPagoFlotante() {
  const { servicio } = useServicioActual();
  const [abierto, setAbierto] = useState(false);

  const { data: config } = useQuery({
    queryKey: ['portal-config-publica'],
    queryFn:  portalApi.config,
    staleTime: 10 * 60_000,
  });

  if (!servicio || servicio.deudaTotal <= 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={cn(
          'fixed right-4 bottom-20 lg:bottom-6 z-40 inline-flex items-center gap-2',
          'px-5 py-3 rounded-full shadow-lg text-sm font-semibold',
          'bg-primary text-primary-foreground hover:opacity-90 transition-opacity',
        )}
      >
        Pagar {soles(servicio.deudaTotal)}
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setAbierto(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card border border-border p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Formas de pago"
          >
            <div>
              <p className="text-lg font-semibold text-foreground">Pagar mi servicio</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Total pendiente: <span className="font-semibold">{soles(servicio.deudaTotal)}</span>
              </p>
            </div>

            {/* El pago en línea todavía no existe. Se dice tal cual y se ofrece lo que
                SÍ funciona hoy, en vez de un botón que no cobra nada. */}
            <div className="rounded-lg border border-border bg-muted/50 p-3">
              <p className="text-sm text-foreground">
                El pago en línea estará disponible próximamente.
              </p>
            </div>

            {config?.reportePagoMedios ? (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Formas de pago
                </p>
                <p className="text-sm text-foreground whitespace-pre-line">
                  {config.reportePagoMedios}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Comunícate con nosotros para conocer las formas de pago disponibles.
              </p>
            )}

            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-muted text-foreground hover:opacity-90 transition-opacity"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
