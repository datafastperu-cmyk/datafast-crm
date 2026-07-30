'use client';

import { useQuery } from '@tanstack/react-query';
import { Gauge, ArrowDown, ArrowUp, AlertTriangle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

import { portalApi, PortalError } from '@/lib/api/portal';
import { useServicioActual } from './useServicioActual';

// Bytes a la unidad que el abonado entiende. Base 1000 (no 1024) porque es la que usa la
// industria para hablar de tráfico y de velocidad de plan.
function humano(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes >= 1e3)  return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

const diaCorto = (iso: string) => iso.slice(8, 10);

export function PortalConsumo() {
  const { servicio } = useServicioActual();
  const contratoId = servicio?.contratoId;

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-consumo', contratoId],
    queryFn:  () => portalApi.consumo(contratoId!),
    enabled:  Boolean(contratoId),
  });

  if (isLoading || !servicio) {
    return <div className="h-64 rounded-xl bg-card border border-border animate-pulse" />;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
        <p className="text-sm text-foreground">
          {error instanceof PortalError ? error.message : 'No pudimos cargar tu consumo.'}
        </p>
      </div>
    );
  }

  // Sin colector de datos todavía. Se dice tal cual: mostrar "0 GB" sería atribuirle al
  // abonado un consumo que nadie midió, y es un número que puede reclamar.
  if (data?.fuente === 'no_disponible') {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3">
        <Gauge className="w-10 h-10 text-muted-foreground mx-auto" />
        <p className="text-base font-semibold text-foreground">
          Aún no medimos el consumo de este servicio
        </p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Tu plan no tiene límite de datos, así que tu servicio no se ve afectado. Cuando
          la medición esté disponible verás aquí tu consumo del mes y por día.
        </p>
      </div>
    );
  }

  const datos = (data?.dias ?? []).map((d) => ({
    dia:      diaCorto(d.fecha),
    bajada:   Number((d.rxBytes / 1e9).toFixed(2)),
    subida:   Number((d.txBytes / 1e9).toFixed(2)),
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Bajada del mes
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground flex items-center gap-2">
            <ArrowDown className="w-5 h-5 text-sky-500" />
            {humano(data?.totalRxBytes ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Subida del mes
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground flex items-center gap-2">
            <ArrowUp className="w-5 h-5 text-emerald-500" />
            {humano(data?.totalTxBytes ?? 0)}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Consumo por día (GB)
        </p>
        <div className="h-64 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={datos}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(v: number, n: string) => [`${v} GB`, n === 'bajada' ? 'Bajada' : 'Subida']}
                labelFormatter={(l) => `Día ${l}`}
              />
              <Bar dataKey="bajada" fill="#0EA5E9" radius={[3, 3, 0, 0]} />
              <Bar dataKey="subida" fill="#10B981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Plan sin cuota: el consumo es informativo. Nada de porcentajes ni "te queda X",
            que insinuarían un límite que no existe. */}
        <p className="mt-3 text-xs text-muted-foreground">
          Tu plan no tiene límite de datos. Esta información es solo referencial.
        </p>
      </div>
    </div>
  );
}
