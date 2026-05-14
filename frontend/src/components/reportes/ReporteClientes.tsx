'use client';

import { useQuery }   from '@tanstack/react-query';
import {
  PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line,
} from 'recharts';

import { reportesApi, type FiltrosReporte } from '@/lib/api/configuracion';
import { formatPct, cn } from '@/lib/utils';

// ─── Colores ──────────────────────────────────────────────────
const ESTADO_COLORS = ['#22c55e','#ef4444','#94a3b8','#f59e0b'];
const SERVICIO_COLORS = ['#3b82f6','#8b5cf6','#06b6d4','#10b981'];

// ─────────────────────────────────────────────────────────────
// ReporteClientes
// ─────────────────────────────────────────────────────────────
interface Props { filtros: FiltrosReporte }

export function ReporteClientes({ filtros }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reporte-clientes', filtros],
    queryFn:  () => reportesApi.getClientes(filtros),
    retry: 1,
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <Skeleton />;
  if (error || !data) return <ErrorState msg="No se pudieron cargar los datos de clientes." />;

  // Datos para gráfico de distribución por estado
  const estadoData = [
    { name: 'Activos',     value: data.totalActivos },
    { name: 'Suspendidos', value: data.totalSuspendidos },
    { name: 'Baja',        value: data.totalBaja },
  ].filter((d) => d.value > 0);

  // Datos por tipo de servicio
  const servicioData = Object.entries(data.porServicio ?? {}).map(([k, v]) => ({
    name: k.toUpperCase(), value: Number(v),
  }));

  return (
    <div className="space-y-6">

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Activos"        value={data.totalActivos}    color="text-green-600" />
        <KpiCard label="Suspendidos"    value={data.totalSuspendidos} color="text-red-600" />
        <KpiCard label="Nuevos este mes" value={`+${data.nuevosMes}`} color="text-blue-600" />
        <KpiCard
          label="Churn rate"
          value={`${data.churRate?.toFixed(2) ?? 0}%`}
          color={data.churRate > 3 ? 'text-destructive' : 'text-green-600'}
        />
      </div>

      {/* Flujo neto */}
      <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/30 border border-border text-sm">
        <div className="flex items-center gap-2 text-green-600">
          <span className="text-lg font-bold">+{data.nuevosMes}</span>
          <span className="text-xs">altas</span>
        </div>
        <div className="flex-1 h-px bg-border" />
        <div className="flex items-center gap-2 text-destructive">
          <span className="text-lg font-bold">-{data.bajasMes ?? 0}</span>
          <span className="text-xs">bajas</span>
        </div>
        <div className="flex-1 h-px bg-border" />
        <div className={cn('flex items-center gap-2 font-bold text-lg', (data.nuevosMes - (data.bajasMes ?? 0)) >= 0 ? 'text-green-600' : 'text-destructive')}>
          {(data.nuevosMes - (data.bajasMes ?? 0)) >= 0 ? '+' : ''}
          {data.nuevosMes - (data.bajasMes ?? 0)}
          <span className="text-xs font-normal text-muted-foreground">neto</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">

        {/* Por estado */}
        {estadoData.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Distribución por estado
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={estadoData} cx="50%" cy="50%" outerRadius={75} dataKey="value" nameKey="name">
                  {estadoData.map((_, i) => <Cell key={i} fill={ESTADO_COLORS[i % ESTADO_COLORS.length]} />)}
                </Pie>
                <Tooltip
                  formatter={(v: number, n: string) => [v, n]}
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                />
                <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Por tipo de servicio */}
        {servicioData.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Por tipo de servicio
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={servicioData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="transparent" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="transparent" width={60} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {servicioData.map((_, i) => <Cell key={i} fill={SERVICIO_COLORS[i % SERVICIO_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top zonas/distritos */}
      {(data.porZona?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Clientes por zona
          </p>
          <div className="space-y-2">
            {data.porZona.slice(0, 8).map((z, i) => (
              <div key={i} className="flex items-center gap-3">
                <p className="text-xs font-medium text-foreground w-40 flex-shrink-0 truncate">{z.zona || 'Sin zona'}</p>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${(z.total / (data.porZona[0]?.total || 1)) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-foreground w-8 text-right flex-shrink-0">{z.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ReporteRed
// ─────────────────────────────────────────────────────────────
export function ReporteRed({ filtros }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reporte-red', filtros],
    queryFn:  () => reportesApi.getRed(filtros),
    retry: 1,
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <Skeleton />;
  if (error || !data) return <ErrorState msg="No se pudieron cargar los datos de red." />;

  const disponibilidadData = (data.disponibilidad ?? []).map((d) => ({
    fecha:  d.fecha?.split('-').slice(1).join('/') ?? d.fecha,
    uptime: d.pct,
  }));

  return (
    <div className="space-y-6">

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total nodos"      value={data.totalNodos} color="text-foreground" />
        <KpiCard
          label="Uptime promedio"
          value={`${data.uptimePromedio?.toFixed(1) ?? 0}%`}
          color={data.uptimePromedio >= 99 ? 'text-green-600' : data.uptimePromedio >= 95 ? 'text-orange-600' : 'text-destructive'}
        />
        <KpiCard label="Alertas críticas"  value={data.alertasCriticas} color="text-destructive" />
        <KpiCard label="Incidentes"        value={data.incidentes}       color="text-orange-600" />
      </div>

      {/* Gráfico de disponibilidad */}
      {disponibilidadData.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Disponibilidad de la red — histórico del período
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={disponibilidadData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="fecha" tick={{ fontSize: 10 }} stroke="transparent" interval={Math.floor(disponibilidadData.length / 10)} />
              <YAxis tick={{ fontSize: 10 }} stroke="transparent" domain={[90, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                formatter={(v: number) => [`${v?.toFixed(2)}%`, 'Uptime']}
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
              />
              {/* Línea de 99% de SLA */}
              <Line type="monotone" dataKey="uptime" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
            <div className="w-4 h-px bg-green-500" />
            <span>Disponibilidad promedio: {data.uptimePromedio?.toFixed(2)}%</span>
          </div>
        </div>
      )}

      {/* Top nodos por latencia */}
      {(data.topNodosLatencia?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Nodos con mayor latencia promedio
          </p>
          <div className="space-y-2">
            {data.topNodosLatencia.slice(0, 8).map((n, i) => (
              <div key={i} className="flex items-center gap-3">
                <p className="text-xs font-medium text-foreground w-48 flex-shrink-0 truncate">{n.nombre}</p>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      n.latenciaAvg > 200 ? 'bg-destructive' : n.latenciaAvg > 100 ? 'bg-orange-500' : 'bg-green-500',
                    )}
                    style={{ width: `${Math.min((n.latenciaAvg / 300) * 100, 100)}%` }}
                  />
                </div>
                <span className={cn(
                  'text-xs font-bold flex-shrink-0 w-14 text-right',
                  n.latenciaAvg > 200 ? 'text-destructive' : n.latenciaAvg > 100 ? 'text-orange-600' : 'text-green-600',
                )}>
                  {n.latenciaAvg?.toFixed(0)}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Micro-componentes compartidos ────────────────────────────
function KpiCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-muted/30 border border-border rounded-xl px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-bold mt-0.5', color)}>{value}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-16 rounded-xl animate-pulse" />
        ))}
      </div>
      <div className="skeleton h-52 rounded-xl animate-pulse" />
    </div>
  );
}

function ErrorState({ msg }: { msg: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-sm text-muted-foreground">{msg}</p>
      <p className="text-xs text-muted-foreground mt-1">
        Verifica que el período seleccionado tenga datos o que el servidor esté disponible.
      </p>
    </div>
  );
}
