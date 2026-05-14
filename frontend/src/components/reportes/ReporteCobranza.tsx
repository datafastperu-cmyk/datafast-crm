'use client';

import { useQuery }  from '@tanstack/react-query';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';

import { reportesApi, type FiltrosReporte } from '@/lib/api/configuracion';
import { formatPEN, formatDate, cn } from '@/lib/utils';

const METODO_COLORS: Record<string, string> = {
  efectivo:              '#22c55e',
  yape:                  '#7c3aed',
  plin:                  '#2563eb',
  transferencia_bancaria:'#0891b2',
  deposito_bancario:     '#0e7490',
  mercadopago:           '#3b82f6',
  tarjeta_credito:       '#8b5cf6',
  otro:                  '#94a3b8',
};

interface Props { filtros: FiltrosReporte }

export function ReporteCobranza({ filtros }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reporte-cobranza', filtros],
    queryFn:  () => reportesApi.getCobranza(filtros),
    retry:    1,
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <Skeleton />;

  if (error || !data) {
    return <ErrorState msg="No se pudieron cargar los datos de cobranza." />;
  }

  // Calcular tasa de cobranza
  const tasaCobranza = data.totalFacturado > 0
    ? (data.totalCobrado / data.totalFacturado) * 100
    : 0;

  // Datos del donut de métodos de pago
  const metodoData = Object.entries(data.porMetodo ?? {}).map(([metodo, monto]) => ({
    name:  metodo.replace(/_/g, ' '),
    value: Number(monto),
    fill:  METODO_COLORS[metodo] ?? '#94a3b8',
  }));

  return (
    <div className="space-y-6">

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Total facturado"
          value={formatPEN(data.totalFacturado)}
          color="text-foreground"
        />
        <KpiCard
          label="Total cobrado"
          value={formatPEN(data.totalCobrado)}
          color="text-green-600"
        />
        <KpiCard
          label="Por cobrar"
          value={formatPEN(data.totalPendiente)}
          color="text-orange-600"
        />
        <KpiCard
          label="Tasa de cobranza"
          value={`${tasaCobranza.toFixed(1)}%`}
          color={tasaCobranza >= 85 ? 'text-green-600' : tasaCobranza >= 70 ? 'text-orange-600' : 'text-destructive'}
        />
      </div>

      {/* Barra de progreso de cobranza */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Progreso de cobranza del período</span>
          <span className="font-medium text-foreground">{tasaCobranza.toFixed(1)}%</span>
        </div>
        <div className="h-3 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700',
              tasaCobranza >= 85 ? 'bg-green-500' : tasaCobranza >= 70 ? 'bg-orange-500' : 'bg-destructive',
            )}
            style={{ width: `${Math.min(tasaCobranza, 100)}%` }}
          />
        </div>
      </div>

      {/* Gráficos en 2 columnas */}
      <div className="grid md:grid-cols-2 gap-6">

        {/* Evolución diaria */}
        {(data.evolucionDiaria?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Cobros diarios del período
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.evolucionDiaria} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="fecha"
                       tickFormatter={(v) => v?.split('-')[2] ?? v}
                       tick={{ fontSize: 10 }} stroke="transparent" />
                <YAxis tick={{ fontSize: 10 }} stroke="transparent"
                       tickFormatter={(v) => `S/${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(v: number) => [formatPEN(v), 'Cobrado']}
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                />
                <Bar dataKey="cobrado" radius={[4, 4, 0, 0]} fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Distribución por método */}
        {metodoData.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Distribución por método de pago
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={metodoData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                  nameKey="name"
                >
                  {metodoData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => [formatPEN(v), '']}
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                />
                <Legend
                  formatter={(value) => <span className="text-xs capitalize">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top clientes */}
      {(data.topClientes?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Top clientes por monto cobrado
          </p>
          <div className="space-y-2">
            {data.topClientes.slice(0, 10).map((c, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted-foreground w-5 flex-shrink-0 text-right">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{c.nombre}</p>
                  <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full"
                      style={{
                        width: `${(c.monto / (data.topClientes[0]?.monto || 1)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="text-sm font-bold text-foreground flex-shrink-0">
                  {formatPEN(c.monto)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
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
      <div className="skeleton h-4 rounded animate-pulse" />
      <div className="grid md:grid-cols-2 gap-6">
        <div className="skeleton h-52 rounded-xl animate-pulse" />
        <div className="skeleton h-52 rounded-xl animate-pulse" />
      </div>
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
