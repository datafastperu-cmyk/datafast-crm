'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, Upload, Tv, Database, Shield, Wifi } from 'lucide-react';

import { portalApi, type PortalServicio } from '@/lib/api/portal';
import { useServicioActual } from './useServicioActual';
import { PortalPlanes } from './PortalPlanes';
import { cn } from '@/lib/utils';

const soles = (n: number) =>
  `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fecha = (iso: string | null) => {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

const ESTADOS: Record<string, { etiqueta: string; clase: string }> = {
  activo:      { etiqueta: 'Activo',      clase: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  suspendido:  { etiqueta: 'Suspendido',  clase: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30' },
  cortado:     { etiqueta: 'Cortado',     clase: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30' },
  pendiente:   { etiqueta: 'En instalación', clase: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' },
};

export function PortalMisServicios() {
  const { servicio, cargando } = useServicioActual();

  const { data: config } = useQuery({
    queryKey: ['portal-config-publica'],
    queryFn:  portalApi.config,
    staleTime: 10 * 60_000,
  });

  if (cargando || !servicio) {
    return (
      <div className="space-y-3">
        <div className="h-56 rounded-xl bg-card border border-border animate-pulse" />
        <div className="h-32 rounded-xl bg-card border border-border animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FichaServicio servicio={servicio} />

      {/* El catálogo vive aquí y no en una pestaña aparte: el abonado compara contra su
          plan actual, que está justo arriba. Solo aparece si el operador lo habilitó. */}
      {config?.secciones.planes && (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Otros planes disponibles</h2>
            <p className="text-sm text-muted-foreground">
              Puedes pedir el cambio desde aquí. Lo revisamos y te confirmamos.
            </p>
          </div>
          <PortalPlanes />
        </section>
      )}
    </div>
  );
}

function FichaServicio({ servicio }: { servicio: PortalServicio }) {
  const estado = ESTADOS[servicio.estado] ?? {
    etiqueta: servicio.estado,
    clase: 'bg-muted text-muted-foreground border-border',
  };

  // Un plan sin velocidad cargada en el ERP se calla en vez de anunciar "0 Mbps", que
  // el abonado leería como una avería de su servicio.
  const conVelocidad = servicio.velocidadBajada > 0 || servicio.velocidadSubida > 0;

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-foreground">{servicio.planNombre}</p>
          <p className="text-sm text-muted-foreground truncate">
            {servicio.direccion ?? 'Sin dirección registrada'}
          </p>
        </div>
        <span className={cn(
          'inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-medium flex-shrink-0',
          estado.clase,
        )}>
          {estado.etiqueta}
        </span>
      </div>

      {/* Lo que el abonado compró, en tarjetas: es la parte que mira antes de llamar a
          preguntar "¿qué velocidad tengo contratada?". */}
      {/* A una sola columna por debajo de 400 px: con `grid-cols-2` fijo, una tarjeta
          suelta quedaba a media anchura y su texto se partía en cuatro renglones. */}
      <div className="p-4 sm:p-5 grid grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-4 gap-3">
        {conVelocidad ? (
          <>
            <Caracteristica
              icono={Download}
              etiqueta="Velocidad de bajada"
              valor={`${servicio.velocidadBajada} Mbps`}
            />
            <Caracteristica
              icono={Upload}
              etiqueta="Velocidad de subida"
              valor={`${servicio.velocidadSubida} Mbps`}
            />
          </>
        ) : (
          <Caracteristica
            icono={Wifi}
            etiqueta="Velocidad"
            valor="Consulta con soporte"
            nota="No está registrada en tu plan"
          />
        )}

        {/* Un porcentaje garantizado sobre una velocidad que no está cargada no dice
            nada: "10% de 0 Mbps" es ruido, no información. */}
        {conVelocidad && servicio.velocidadGarantizada != null && (
          <Caracteristica
            icono={Shield}
            etiqueta="Velocidad mínima garantizada"
            valor={`${servicio.velocidadGarantizada}%`}
            nota="De la velocidad contratada"
          />
        )}

        {servicio.incluyeTv && (
          <Caracteristica
            icono={Tv}
            etiqueta="Televisión incluida"
            valor={
              servicio.dispositivosTv && servicio.dispositivosTv > 1
                ? `${servicio.dispositivosTv} dispositivos`
                : '1 dispositivo'
            }
            nota="A la vez"
          />
        )}

        {servicio.limiteDatosGb != null && (
          <Caracteristica
            icono={Database}
            etiqueta="Datos incluidos"
            valor={`${servicio.limiteDatosGb} GB`}
            nota={
              servicio.accionAlLimite === 'cortar_servicio'
                ? 'Al superarlos, el servicio se suspende'
                : 'Al superarlos, la velocidad se reduce'
            }
          />
        )}
      </div>

      {servicio.planDescripcion && (
        <p className="px-5 pb-4 -mt-1 text-sm text-muted-foreground">
          {servicio.planDescripcion}
        </p>
      )}

      <dl className="border-t border-border divide-y divide-border">
        <Dato label="Contrato" valor={servicio.numeroContrato} />
        {/* Precio del CONTRATO, con su descuento aplicado — nunca el de la lista. */}
        <Dato label="Pago mensual" valor={soles(servicio.precioMensual)} />
        <Dato
          label="Día de pago"
          valor={servicio.diaFacturacion ? `Cada día ${servicio.diaFacturacion}` : '—'}
        />
        <Dato label="Próximo pago" valor={fecha(servicio.fechaCorte)} />
        {servicio.enProrroga && (
          <Dato label="Prórroga vigente hasta" valor={fecha(servicio.prorrogaHasta)} />
        )}
      </dl>
    </section>
  );
}

function Caracteristica({
  icono: Icono, etiqueta, valor, nota,
}: {
  icono: typeof Download;
  etiqueta: string;
  valor: string;
  nota?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icono className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-[11px] font-medium leading-tight">{etiqueta}</span>
      </div>
      <p className="text-base font-semibold text-foreground leading-tight">{valor}</p>
      {nota && <p className="text-[11px] text-muted-foreground leading-tight">{nota}</p>}
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="px-5 py-3 sm:flex sm:items-baseline sm:gap-4">
      <dt className="text-xs text-muted-foreground sm:w-52 sm:flex-shrink-0">{label}</dt>
      <dd className="text-sm text-foreground break-words">{valor}</dd>
    </div>
  );
}
