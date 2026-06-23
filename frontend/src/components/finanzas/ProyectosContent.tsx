'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';
import { Plus, RefreshCw, TrendingUp, TrendingDown, X, Loader2 } from 'lucide-react';

import {
  proyectosInversionApi,
  type CreateProyectoInversionDto,
  type RatiosFinancieros,
} from '@/lib/api/proyectos-inversion';
import { zonasApi } from '@/lib/api/zonas';
import { useToast } from '@/components/ui/toaster';
import { cn, formatPEN, parseApiError } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────

function fmtPct(v: number) {
  return `${v.toFixed(2)} %`;
}

const FORM_EMPTY: CreateProyectoInversionDto = {
  nombreProyecto:   '',
  sectorId:         '',
  inversionInicial: 0,
  tasaDescuento:    0.10,
  fechaInicio:      new Date().toISOString().split('T')[0],
};

// ─── Tarjeta de ratios ────────────────────────────────────────

function RatiosCard({ proyectoId }: { proyectoId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ratios', proyectoId],
    queryFn:  () => proyectosInversionApi.getRatios(proyectoId),
    staleTime: 2 * 60_000,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-40">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );

  if (isError || !data) return (
    <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">
      Sin datos de flujo aún
    </div>
  );

  return <RatiosBody r={data} />;
}

function RatiosBody({ r }: { r: RatiosFinancieros }) {
  const chartData = (r.flujosMensuales ?? []).map((v, i) => ({ mes: i + 1, flujo: v }));

  const vanPositivo = r.van > 0;
  const tirSuperaTasa = r.tir > r.tasaDescuento * 100;

  return (
    <div className="space-y-4 pt-2">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        {/* Inversión */}
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground mb-0.5">Inversión inicial</p>
          <p className="text-sm font-bold text-foreground">{formatPEN(r.inversionInicial)}</p>
        </div>

        {/* VAN */}
        <div className={cn(
          'rounded-lg p-3 border',
          vanPositivo
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : 'bg-rose-500/10    border-rose-500/30',
        )}>
          <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
            VAN
            {vanPositivo
              ? <TrendingUp  className="w-3 h-3 text-emerald-400" />
              : <TrendingDown className="w-3 h-3 text-rose-400"   />}
          </p>
          <p className={cn(
            'text-sm font-bold',
            vanPositivo ? 'text-emerald-400' : 'text-rose-400',
          )}>
            {formatPEN(r.van)}
          </p>
          <span className={cn(
            'inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
            vanPositivo
              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/20    text-rose-700    dark:text-rose-300',
          )}>
            {vanPositivo ? 'Proyecto Viable' : 'Inversión en Riesgo'}
          </span>
        </div>

        {/* TIR */}
        <div className={cn(
          'rounded-lg p-3 border',
          tirSuperaTasa
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : 'bg-amber-500/10   border-amber-500/30',
        )}>
          <p className="text-xs text-muted-foreground mb-0.5">TIR anual</p>
          <p className={cn(
            'text-sm font-bold',
            tirSuperaTasa ? 'text-emerald-400' : 'text-amber-400',
          )}>
            {r.tir > 0 ? fmtPct(r.tir) : 'N/D'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Tasa desc.: {fmtPct(r.tasaDescuento * 100)}
          </p>
        </div>
      </div>

      {/* Payback */}
      {r.paybackMeses !== null && (
        <p className="text-xs text-muted-foreground">
          Payback: <span className="text-foreground font-medium">{r.paybackMeses} mes{r.paybackMeses !== 1 ? 'es' : ''}</span>
          {' '}· {r.mesesEvaluados} meses evaluados
        </p>
      )}

      {/* Gráfico de flujos */}
      {chartData.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">Flujos mensuales netos (S/.)</p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="mes"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: 'hsl(var(--foreground))',
                }}
                formatter={(v: number) => [formatPEN(v), 'Flujo']}
                labelFormatter={(l) => `Mes ${l}`}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="flujo" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.flujo >= 0 ? 'hsl(142 76% 36%)' : 'hsl(0 72% 51%)'}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────

export function ProyectosContent() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [showModal, setShowModal] = useState(false);
  const [form,      setForm]      = useState<CreateProyectoInversionDto>(FORM_EMPTY);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['proyectos-list'],
    queryFn:  () => proyectosInversionApi.list({ limit: 50 }),
    placeholderData: (p) => p,
  });

  const { data: zonas = [] } = useQuery({
    queryKey: ['zonas-list'],
    queryFn:  zonasApi.list,
    staleTime: 5 * 60_000,
  });

  const crearMut = useMutation({
    mutationFn: proyectosInversionApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proyectos-list'] });
      toast('Proyecto creado', { type: 'success' });
      setShowModal(false);
      setForm(FORM_EMPTY);
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const proyectos = data?.data ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Proyectos de Expansión</h2>
          <p className="text-sm text-muted-foreground">Análisis de inversión por sector — VAN, TIR y Payback</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg border border-border hover:bg-muted transition-colors"
          >
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Nuevo proyecto
          </button>
        </div>
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : proyectos.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center">
          <p className="text-sm text-muted-foreground">Sin proyectos registrados.</p>
          <p className="text-xs text-muted-foreground mt-1">Crea el primer proyecto para calcular VAN y TIR.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {proyectos.map((p) => {
            const zona = zonas.find((z) => z.id === p.sectorId);
            return (
              <div key={p.id} className="bg-card border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground leading-tight">{p.nombreProyecto}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {zona?.nombre ?? p.sectorId} · desde {p.fechaInicio}
                    </p>
                  </div>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium shrink-0',
                    p.estado === 'activo'     && 'bg-emerald-500/15 text-emerald-400',
                    p.estado === 'completado' && 'bg-sky-500/15 text-sky-400',
                    p.estado === 'cancelado'  && 'bg-rose-500/15 text-rose-400',
                  )}>
                    {p.estado}
                  </span>
                </div>
                <RatiosCard proyectoId={p.id} />
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-label="Confirmar acción" className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-foreground">Nuevo proyecto de expansión</h3>
              <button
                onClick={() => { setShowModal(false); setForm(FORM_EMPTY); }}
                className="p-1.5 rounded hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Nombre del proyecto</label>
                <input
                  type="text"
                  value={form.nombreProyecto}
                  onChange={(e) => setForm((f) => ({ ...f, nombreProyecto: e.target.value }))}
                  placeholder="Ej. Expansión Zona Norte – Fibra FTTH"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Sector / Zona</label>
                <select
                  value={form.sectorId}
                  onChange={(e) => setForm((f) => ({ ...f, sectorId: e.target.value }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">— Seleccionar —</option>
                  {zonas.map((z) => (
                    <option key={z.id} value={z.id}>{z.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Inversión inicial (S/.)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={form.inversionInicial || ''}
                    onChange={(e) => setForm((f) => ({ ...f, inversionInicial: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Tasa descuento anual</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0.1"
                      max="99"
                      step="0.1"
                      value={parseFloat((form.tasaDescuento * 100).toFixed(2))}
                      onChange={(e) => setForm((f) => ({ ...f, tasaDescuento: (parseFloat(e.target.value) || 10) / 100 }))}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 pr-7 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Fecha de inicio</label>
                <input
                  type="date"
                  value={form.fechaInicio}
                  onChange={(e) => setForm((f) => ({ ...f, fechaInicio: e.target.value }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Descripción (opcional)</label>
                <textarea
                  value={form.descripcion ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                  rows={2}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => { setShowModal(false); setForm(FORM_EMPTY); }}
                className="flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => crearMut.mutate(form)}
                disabled={crearMut.isPending || !form.nombreProyecto || !form.sectorId || form.inversionInicial <= 0}
                className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {crearMut.isPending ? 'Creando...' : 'Crear proyecto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
