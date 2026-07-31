'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BarChart3 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

import { portalApi, type ConsumoDia } from '@/lib/api/portal';
import { useServicioActual } from './useServicioActual';
import { cn } from '@/lib/utils';

// Gráfico de consumo del abonado. HOY NO HAY COLECTOR: `portal-consumo.service` devuelve
// `fuente: 'no_disponible'` mientras `consumo_datos` esté vacía. Este componente ya está
// cableado contra el endpoint real — cuando el colector empiece a escribir, la maqueta
// desaparece sola y estas mismas barras muestran datos medidos, sin tocar el archivo.
//
// La maqueta es DELIBERADAMENTE reconocible: barras atenuadas, totales en guiones y un
// rótulo "Ejemplo" que no se puede pasar por alto. Un gráfico de muestra que parezca real
// le atribuye al abonado un consumo que nadie midió, y es una cifra que puede reclamar.

type Rango = '7dias' | 'mes';

// Bytes → unidad de la industria (base 1000, la misma en la que se venden los planes).
function humano(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes >= 1e3)  return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

// Rango en fechas ISO. El backend acepta `desde`/`hasta` y ya valida el tope de 92 días.
function rangoFechas(rango: Rango): { desde: string; hasta: string } {
  const hoy = new Date();
  const hasta = hoy.toISOString().slice(0, 10);
  if (rango === 'mes') {
    const primero = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    return { desde: primero.toISOString().slice(0, 10), hasta };
  }
  const hace6 = new Date(hoy.getTime() - 6 * 86_400_000);
  return { desde: hace6.toISOString().slice(0, 10), hasta };
}

// Muestra fija, nunca aleatoria: un Math.random() aquí produciría distinto HTML en
// servidor y cliente, y Next lo reportaría como error de hidratación.
const MUESTRA_GB: Array<[number, number]> = [
  [7.1, 0.45], [9.0, 0.55], [5.1, 0.38], [2.6, 0.28],
  [2.9, 0.26], [1.8, 0.15], [4.7, 0.32],
];

function datosMaqueta(rango: Rango): ConsumoDia[] {
  const total = rango === 'mes' ? new Date().getUTCDate() : 7;
  const hoy = new Date();
  return Array.from({ length: total }, (_, i) => {
    const f = new Date(hoy.getTime() - (total - 1 - i) * 86_400_000);
    const [rx, tx] = MUESTRA_GB[i % MUESTRA_GB.length];
    return {
      fecha:   f.toISOString().slice(0, 10),
      rxBytes: rx * 1e9,
      txBytes: tx * 1e9,
    };
  });
}

export function PortalConsumoGrafico() {
  const { servicio } = useServicioActual();
  const contratoId = servicio?.contratoId;
  const [rango, setRango] = useState<Rango>('7dias');

  // La maqueta NO se le muestra al abonado si el operador tiene la sección apagada:
  // un gráfico de ejemplo en el panel de un cliente real es ruido que él no pidió.
  const { data: config } = useQuery({
    queryKey: ['portal-config-publica'],
    queryFn:  portalApi.config,
    staleTime: 10 * 60_000,
  });
  const habilitada = config?.secciones.consumo ?? false;

  const { desde, hasta } = rangoFechas(rango);

  const { data, isLoading } = useQuery({
    queryKey: ['portal-consumo-grafico', contratoId, rango],
    queryFn:  () => portalApi.consumo(contratoId!, { desde, hasta }),
    enabled:  Boolean(contratoId) && habilitada,
    // La sección puede estar apagada por el operador: el 404 es una respuesta, no un
    // fallo que valga la pena reintentar.
    retry: false,
  });

  // Maqueta mientras no haya medición: sin colector, sin sección habilitada o sin filas.
  const esMaqueta = !isLoading && data?.fuente !== 'medido';
  const dias      = esMaqueta ? datosMaqueta(rango) : (data?.dias ?? []);

  const { totalRx, totalTx } = useMemo(() => ({
    totalRx: dias.reduce((s, d) => s + d.rxBytes, 0),
    totalTx: dias.reduce((s, d) => s + d.txBytes, 0),
  }), [dias]);

  const puntos = useMemo(() => dias.map((d) => ({
    dia:    `${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)}`,
    bajada: Number((d.rxBytes / 1e9).toFixed(2)),
    subida: Number((d.txBytes / 1e9).toFixed(2)),
  })), [dias]);

  if (!habilitada) return null;

  if (isLoading) {
    return <div className="h-72 rounded-xl bg-card border border-border animate-pulse" />;
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Cabecera: pestañas de rango a la izquierda, totales a la derecha */}
      <div className="px-5 pt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-1">
          <Pestania activa={rango === '7dias'} onClick={() => setRango('7dias')}>
            Últimos 7 días
          </Pestania>
          <Pestania activa={rango === 'mes'} onClick={() => setRango('mes')}>
            Del mes
          </Pestania>
        </div>

        <div className="flex items-start gap-5">
          <Total
            icono={ArrowDown}
            etiqueta="Descarga"
            valor={esMaqueta ? '—' : humano(totalRx)}
            clase={esMaqueta ? 'text-muted-foreground' : 'text-sky-600 dark:text-sky-400'}
          />
          <Total
            icono={ArrowUp}
            etiqueta="Subida"
            valor={esMaqueta ? '—' : humano(totalTx)}
            clase={esMaqueta ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400'}
          />
        </div>
      </div>

      <div className="relative px-2 pb-2 pt-4">
        {/* Las barras de muestra se atenúan y no reciben puntero: no hay tooltip que
            invite a leerlas como si fueran una medición. */}
        <div className={cn('h-64', esMaqueta && 'opacity-25 pointer-events-none select-none')}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={puntos} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis
                dataKey="dia"
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-muted-foreground"
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-muted-foreground"
                width={52}
                tickFormatter={(v: number) => `${v} GB`}
              />
              {!esMaqueta && (
                <Tooltip
                  cursor={{ fill: 'currentColor', opacity: 0.06 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(v: number, n: string) => [`${v} GB`, n === 'bajada' ? 'Bajada' : 'Subida']}
                  labelFormatter={(l) => `Día ${l}`}
                />
              )}
              <Bar dataKey="bajada" fill="#0EA5E9" radius={[3, 3, 0, 0]} maxBarSize={38} />
              <Bar dataKey="subida" fill="#10B981" radius={[3, 3, 0, 0]} maxBarSize={38} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {esMaqueta && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="rounded-xl border border-border bg-card/95 px-5 py-4 text-center space-y-1 shadow-sm max-w-xs">
              <BarChart3 className="w-6 h-6 text-muted-foreground mx-auto" />
              <p className="text-sm font-semibold text-foreground">
                Ejemplo: aún no medimos tu consumo
              </p>
              <p className="text-xs text-muted-foreground">
                Las barras son de muestra, no son tu tráfico. Cuando la medición esté
                disponible verás aquí tu consumo real por día.
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="px-5 pb-4 text-xs text-muted-foreground">
        {/* Sin cuota no se habla de porcentajes ni de "te queda X": insinuaría un límite
            que el plan no tiene. */}
        Tu plan no tiene límite de datos. Esta información es solo referencial.
      </p>
    </div>
  );
}

function Pestania({
  activa, onClick, children,
}: {
  activa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
        activa
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

function Total({
  icono: Icono, etiqueta, valor, clase,
}: {
  icono: typeof ArrowDown;
  etiqueta: string;
  valor: string;
  clase: string;
}) {
  return (
    <div className="text-right">
      <p className={cn('text-lg font-bold flex items-center gap-1 justify-end', clase)}>
        <Icono className="w-4 h-4" />
        {valor}
      </p>
      <p className="text-[11px] text-muted-foreground">{etiqueta}</p>
    </div>
  );
}
