'use client';

import { useState, useEffect } from 'react';
import { useQuery }            from '@tanstack/react-query';
import {
  Users, CreditCard, Wifi, AlertTriangle, Ticket,
  TrendingUp, Activity, ArrowUpRight, ArrowDownRight,
  Zap, BarChart3, RefreshCcw,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar,
} from 'recharts';

import { useMonitoreo }    from '@/hooks/useMonitoreo';
import { cn }              from '@/lib/utils';
import {
  mockDashboardStats, mockTrafico24h, mockTrafico7d,
  mockNodos, mockPagos, mockAlertas, mockTickets, formatBps,
} from '@/mock-data';
import type { WsEventDashboard } from '@/types';

// ─── StatCard premium ──────────────────────────────────────────
const COLORS = {
  blue:    { bg: 'bg-blue-500/10',    icon: 'text-blue-400',    glow: 'shadow-[0_0_20px_-4px_rgba(59,130,246,0.35)]' },
  green:   { bg: 'bg-emerald-500/10', icon: 'text-emerald-400', glow: 'shadow-[0_0_20px_-4px_rgba(16,185,129,0.35)]' },
  amber:   { bg: 'bg-amber-500/10',   icon: 'text-amber-400',   glow: '' },
  red:     { bg: 'bg-red-500/10',     icon: 'text-red-400',     glow: 'shadow-[0_0_20px_-4px_rgba(239,68,68,0.3)]' },
  purple:  { bg: 'bg-violet-500/10',  icon: 'text-violet-400',  glow: '' },
  cyan:    { bg: 'bg-cyan-500/10',    icon: 'text-cyan-400',    glow: '' },
} as const;

type CardColor = keyof typeof COLORS;

function StatCard({
  label, value, sub, icon: Icon, color, trend, live, highlight,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: CardColor;
  trend?: { value: number; label: string; up: boolean };
  live?: boolean; highlight?: boolean;
}) {
  const c = COLORS[color];
  return (
    <div className={cn(
      'bg-card border border-border rounded-xl p-5 hover:border-border/80 transition-all duration-200 group',
      highlight && c.glow,
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1.5 tabular-nums">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <div className={cn('p-2.5 rounded-xl flex-shrink-0 transition-transform duration-200 group-hover:scale-110', c.bg)}>
          <Icon className={cn('w-5 h-5', c.icon)} />
        </div>
      </div>
      {(trend || live) && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/60">
          {trend && (
            <span className={cn(
              'flex items-center gap-1 text-xs font-semibold',
              trend.up ? 'text-emerald-500' : 'text-red-500',
            )}>
              {trend.up
                ? <ArrowUpRight className="w-3.5 h-3.5" />
                : <ArrowDownRight className="w-3.5 h-3.5" />}
              {trend.up ? '+' : ''}{trend.value} {trend.label}
            </span>
          )}
          {live && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-auto">
              <span className="status-dot-online" />
              En vivo
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tooltip personalizado para recharts ─────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-xl shadow-xl px-3 py-2.5 text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-mono font-medium text-foreground">{p.value.toFixed(0)} Mbps</span>
        </div>
      ))}
    </div>
  );
}

// ─── Badge de nivel de alerta ─────────────────────────────────
const NIVEL_STYLE = {
  critical: 'text-red-400 bg-red-500/10 ring-1 ring-red-500/20',
  warning:  'text-amber-400 bg-amber-500/10 ring-1 ring-amber-500/20',
  info:     'text-blue-400 bg-blue-500/10 ring-1 ring-blue-500/20',
  recovery: 'text-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-500/20',
};

const ESTADO_DOT: Record<string, string> = {
  online:        'status-dot-online',
  offline:       'status-dot-offline',
  degradado:     'status-dot-warning',
  mantenimiento: 'status-dot-info',
};

// ─── COMPONENT ───────────────────────────────────────────────
export function DashboardContent() {
  const [wsStats, setWsStats] = useState<WsEventDashboard | null>(null);
  const [traficoView, setTraficoView] = useState<'24h' | '7d'>('24h');

  const { conectado, alertas } = useMonitoreo({ onDashboard: setWsStats });

  const stats   = mockDashboardStats;
  const trafico = traficoView === '24h' ? mockTrafico24h : mockTrafico7d;
  const xKey    = traficoView === '24h' ? 'hora' : 'dia';

  const nodesOnline  = wsStats?.online  ?? stats.nodos.online;
  const nodesOffline = wsStats?.offline ?? stats.nodos.offline;
  const nodesTotal   = wsStats?.total   ?? stats.nodos.total;

  const metaPct = Math.round((stats.facturacion.cobradoMes / stats.facturacion.meta) * 100);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Panel Principal</h2>
          <p className="text-sm text-muted-foreground">Operaciones en tiempo real · {new Date().toLocaleDateString('es-PE', { weekday:'long', day:'2-digit', month:'long' })}</p>
        </div>
        <div className={cn(
          'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border',
          conectado
            ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/8'
            : 'text-muted-foreground border-border bg-muted',
        )}>
          <span className={cn('w-1.5 h-1.5 rounded-full', conectado ? 'bg-emerald-500 animate-pulse-dot' : 'bg-muted-foreground')} />
          {conectado ? 'Conectado' : 'Reconectando...'}
        </div>
      </div>

      {/* ── Row 1: KPI Cards ──────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard
          label="Clientes activos"
          value={stats.clientes.activos.toLocaleString()}
          sub={`${stats.clientes.morosos} en mora · ${stats.clientes.total.toLocaleString()} totales`}
          icon={Users} color="blue" highlight
          trend={{ value: stats.clientes.nuevosHoy, label: 'nuevos hoy', up: true }}
        />
        <StatCard
          label="Cobrado hoy"
          value={`S/ ${stats.facturacion.cobradoHoy.toLocaleString('es-PE')}`}
          sub={`${mockPagos.length} pagos registrados`}
          icon={CreditCard} color="green" highlight
          trend={{ value: 12, label: 'vs ayer', up: true }}
        />
        <StatCard
          label="Cobrado este mes"
          value={`S/ ${(stats.facturacion.cobradoMes / 1000).toFixed(1)}K`}
          sub={`Meta: S/ ${(stats.facturacion.meta / 1000).toFixed(0)}K · ${metaPct}% cumplido`}
          icon={TrendingUp} color="cyan"
          trend={{ value: metaPct, label: '% de meta', up: metaPct >= 80 }}
        />
        <StatCard
          label="Nodos en línea"
          value={`${nodesOnline} / ${nodesTotal}`}
          sub={nodesOffline > 0 ? `${nodesOffline} offline · ${stats.nodos.degradado} degradado` : 'Todo operando ✓'}
          icon={Wifi} color={nodesOffline > 0 ? 'red' : 'green'}
          live highlight={nodesOffline > 0}
        />
        <StatCard
          label="Alertas activas"
          value={stats.alertas.activas}
          sub={`${stats.alertas.criticas} críticas · ${stats.alertas.warnings} warnings`}
          icon={AlertTriangle} color={stats.alertas.criticas > 0 ? 'red' : 'amber'}
          highlight={stats.alertas.criticas > 0}
        />
        <StatCard
          label="Tickets abiertos"
          value={stats.tickets.abiertos}
          sub={`${stats.tickets.urgentes} urgentes · ${stats.tickets.resueltosMes} resueltos el mes`}
          icon={Ticket} color="purple"
        />
      </div>

      {/* ── Row 2: Tráfico + Nodos ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Gráfico de tráfico */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Tráfico de Red</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pico: {formatBps(wsStats?.totalRxBps ?? 2_840_000_000)} bajada
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded bg-blue-400" />Bajada</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded bg-emerald-400" />Subida</span>
              </div>
              <div className="flex gap-1 bg-muted rounded-lg p-0.5">
                {(['24h','7d'] as const).map((v) => (
                  <button key={v} onClick={() => setTraficoView(v)}
                    className={cn('text-xs px-2.5 py-1 rounded-md transition-colors',
                      traficoView === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={trafico} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gRx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#60a5fa" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gTx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#34d399" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
              <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="transparent" />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="transparent"
                     tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}G` : `${v}M`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="rx" stroke="#60a5fa" fill="url(#gRx)" strokeWidth={2} dot={false} name="Bajada" />
              <Area type="monotone" dataKey="tx" stroke="#34d399" fill="url(#gTx)" strokeWidth={2} dot={false} name="Subida" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Estado de nodos */}
        <div className="bg-card border border-border rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Nodos</h3>
            <div className="flex gap-2 text-[11px] font-medium">
              <span className="pill-online">{nodesOnline} online</span>
              {nodesOffline > 0 && <span className="pill-offline">{nodesOffline} offline</span>}
            </div>
          </div>

          {/* Barra de utilización */}
          <div className="mb-4 p-3 bg-muted/40 rounded-lg">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-muted-foreground">Capacidad de red</span>
              <span className="font-semibold text-foreground">
                {formatBps(wsStats?.totalRxBps ?? 2_840_000_000)} / {formatBps(4_000_000_000)}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all"
                   style={{ width: `${Math.round((2840 / 4000) * 100)}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">71% utilización</p>
          </div>

          <div className="flex-1 space-y-1.5 overflow-y-auto max-h-60 pr-1">
            {(mockNodos as any[]).slice(0, 10).map((nodo) => {
              const estado = nodo.estado as string;
              return (
                <div key={nodo.id}
                     className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/50 transition-colors">
                  <span className={ESTADO_DOT[estado] ?? 'status-dot-offline'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-foreground truncate">{nodo.nombre}</p>
                    <p className="text-[10px] text-muted-foreground">{nodo.ipMonitoreo}</p>
                  </div>
                  {nodo.latenciaMs != null && (
                    <span className={cn('text-[10px] font-mono', nodo.latenciaMs < 10 ? 'text-emerald-400' : nodo.latenciaMs < 30 ? 'text-amber-400' : 'text-red-400')}>
                      {nodo.latenciaMs}ms
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Row 3: Pagos + Alertas ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Últimos pagos */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Pagos de hoy</h3>
            <span className="text-xs font-medium text-emerald-400">
              S/ {mockPagos.reduce((s, p) => s + p.monto, 0).toLocaleString('es-PE')}
            </span>
          </div>
          <div className="space-y-1">
            {mockPagos.slice(0, 6).map((p) => (
              <div key={p.id}
                   className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
                    {p.clienteNombre[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{p.clienteNombre}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">
                      {p.metodoPago.replace(/_/g,' ')} · {new Date(p.fechaPago).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-foreground">S/ {p.monto.toFixed(2)}</p>
                  <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                    p.estado === 'verificado' ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'
                  )}>
                    {p.estado === 'verificado' ? 'Verificado' : 'Pendiente'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alertas activas */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Alertas activas</h3>
            {mockAlertas.length > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 ring-1 ring-red-500/20">
                {mockAlertas.length}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {mockAlertas.map((a) => (
              <div key={a.id}
                   className="flex items-start gap-3 p-3 rounded-lg border border-border/60 hover:bg-muted/30 transition-colors">
                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded uppercase flex-shrink-0 mt-0.5',
                  NIVEL_STYLE[a.nivel as keyof typeof NIVEL_STYLE] ?? NIVEL_STYLE.info
                )}>
                  {a.nivel}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{a.nodoNombre}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{a.mensaje}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">{a.duracionMinutos} min activa</p>
                </div>
              </div>
            ))}
            {mockAlertas.length === 0 && (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-3">
                  <Activity className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="text-sm font-medium text-foreground">Sin alertas activas</p>
                <p className="text-xs text-muted-foreground mt-0.5">Todos los sistemas operando normalmente</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 4: Tickets recientes ─────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Tickets recientes</h3>
          <a href="/tickets/nuevos" className="text-xs text-primary hover:underline">Ver todos →</a>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Asunto</th>
                <th>Cliente</th>
                <th>Categoría</th>
                <th>Prioridad</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {mockTickets.slice(0,5).map((t) => (
                <tr key={t.id}>
                  <td className="font-medium text-foreground truncate max-w-[220px]">{t.asunto}</td>
                  <td className="text-muted-foreground">{t.clienteNombre}</td>
                  <td className="capitalize text-muted-foreground">{t.categoria.replace(/_/g,' ')}</td>
                  <td>
                    <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full', {
                      'bg-red-500/10 text-red-400':    t.prioridad === 'urgente',
                      'bg-orange-500/10 text-orange-400': t.prioridad === 'alta',
                      'bg-blue-500/10 text-blue-400':  t.prioridad === 'media',
                      'bg-muted text-muted-foreground':t.prioridad === 'baja',
                    })}>
                      {t.prioridad}
                    </span>
                  </td>
                  <td>
                    <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full', {
                      'bg-amber-500/10 text-amber-400':    t.estado === 'nuevo',
                      'bg-blue-500/10 text-blue-400':      t.estado === 'en_progreso',
                      'bg-emerald-500/10 text-emerald-400':t.estado === 'contestado',
                    })}>
                      {t.estado.replace(/_/g,' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
