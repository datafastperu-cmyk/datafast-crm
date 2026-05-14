'use client';

import { useQuery }      from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Users, FileText, CreditCard, Wifi,
  TrendingUp, AlertTriangle, Activity,
  ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

import api               from '@/lib/api';
import { useMonitoreo }  from '@/hooks/useMonitoreo';
import { StatCard }      from './StatCard';
import { NodoGridLive }  from './NodoGridLive';
import { AlertasFeed }   from './AlertasFeed';
import { UltimosPagos }  from './UltimosPagos';
import { cn }            from '@/lib/utils';
import type { DashboardStats, WsEventDashboard } from '@/types';

// ─── Datos de ejemplo para el gráfico mientras carga ─────────
const traficoVacio = Array.from({ length: 12 }, (_, i) => ({
  hora:  `${String(i * 2).padStart(2, '0')}:00`,
  rx:    0,
  tx:    0,
}));

export function DashboardContent() {
  const [wsStats, setWsStats] = useState<WsEventDashboard | null>(null);

  // ── Stats REST ────────────────────────────────────────────
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn:  async () => {
      const res = await api.get('/dashboard/stats');
      return res.data.data;
    },
    refetchInterval: 60_000,
  });

  // ── Historial de tráfico ──────────────────────────────────
  const { data: trafico = traficoVacio } = useQuery({
    queryKey: ['dashboard-trafico'],
    queryFn:  async () => {
      const res = await api.get('/monitoreo/dashboard/trafico');
      return res.data.data || traficoVacio;
    },
    refetchInterval: 5 * 60_000,
  });

  // ── WebSocket: actualizaciones en tiempo real ─────────────
  const { conectado, alertas, ultimaAlerta } = useMonitoreo({
    onDashboard: (data) => setWsStats(data),
  });

  // Combinar stats REST con override del WS
  const nodos = wsStats ?? stats?.nodos;
  const nodesOnline  = nodos?.online  ?? 0;
  const nodesOffline = nodos?.offline ?? 0;
  const nodesTotal   = nodos?.total   ?? 0;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Resumen operacional en tiempo real
          </p>
        </div>
        {/* Indicador WebSocket */}
        <div className={cn(
          'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border',
          conectado
            ? 'text-green-600 border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900'
            : 'text-muted-foreground border-border bg-muted',
        )}>
          <span className={cn(
            'w-1.5 h-1.5 rounded-full',
            conectado ? 'bg-green-500 animate-pulse-dot' : 'bg-muted-foreground',
          )} />
          {conectado ? 'En vivo' : 'Reconectando...'}
        </div>
      </div>

      {/* ── Fila 1: Stat Cards ──────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Clientes activos"
          value={stats?.clientes.activos ?? 0}
          sub={`${stats?.clientes.morosos ?? 0} con mora`}
          icon={Users}
          color="blue"
          loading={isLoading}
          trend={stats?.clientes.nuevosHoy
            ? { valor: stats.clientes.nuevosHoy, label: 'hoy', up: true }
            : undefined}
        />
        <StatCard
          label="Contratos activos"
          value={stats?.contratos.activos ?? 0}
          sub={`${stats?.contratos.suspendidos ?? 0} suspendidos`}
          icon={FileText}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Cobrado hoy"
          value={`S/ ${(stats?.facturacion.cobradoHoy ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`}
          sub={`Meta: S/ ${((stats?.facturacion.cobradoMes ?? 0) / 30 * 30).toLocaleString('es-PE', { maximumFractionDigits: 0 })}/mes`}
          icon={CreditCard}
          color="emerald"
          loading={isLoading}
        />
        <StatCard
          label="Nodos online"
          value={`${nodesOnline} / ${nodesTotal}`}
          sub={nodesOffline > 0 ? `${nodesOffline} offline` : 'Todo en línea ✓'}
          icon={Wifi}
          color={nodesOffline > 0 ? 'red' : 'green'}
          loading={isLoading}
          live
        />
      </div>

      {/* ── Fila 2: Gráfico + Alertas ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Gráfico de tráfico (ocupa 2 columnas) */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Tráfico de red</h3>
              <p className="text-xs text-muted-foreground">Últimas 24 horas</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-primary" />
                Bajada
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Subida
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trafico} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradRx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradTx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="hora" tick={{ fontSize: 11 }} stroke="transparent" />
              <YAxis tick={{ fontSize: 11 }} stroke="transparent"
                     tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}G` : `${v}M`} />
              <Tooltip
                formatter={(v: number) => [`${v.toFixed(1)} Mbps`]}
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border:     '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize:   '12px',
                }}
              />
              <Area type="monotone" dataKey="rx" stroke="#3b82f6" fill="url(#gradRx)"
                    strokeWidth={2} dot={false} name="Bajada" />
              <Area type="monotone" dataKey="tx" stroke="#10b981" fill="url(#gradTx)"
                    strokeWidth={2} dot={false} name="Subida" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Feed de alertas activas */}
        <AlertasFeed alertas={alertas} />
      </div>

      {/* ── Fila 3: Nodos en vivo + Últimos pagos ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <NodoGridLive />
        </div>
        <div>
          <UltimosPagos />
        </div>
      </div>

    </div>
  );
}
