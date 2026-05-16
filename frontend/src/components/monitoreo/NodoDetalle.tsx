'use client';

import { useState }              from 'react';
import { useRouter }             from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, RefreshCw, Wifi, WifiOff, Activity,
  Cpu, Thermometer, Network, MoreVertical, Loader2,
} from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

import { monitoreoApi }  from '@/lib/api/monitoreo';
import { useMonitoreo }  from '@/hooks/useMonitoreo';
import { useToast }      from '@/components/ui/toaster';
import { parseApiError, formatBps, formatPct, formatDateTime, cn } from '@/lib/utils';
import type { Nodo }     from '@/types';

const TABS = ['Métricas', 'Interfaces SNMP', 'Alertas', 'Configuración'] as const;
type Tab = typeof TABS[number];

export function NodoDetalle({ id }: { id: string }) {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [tab, setTab]     = useState<Tab>('Métricas');
  const [menuOpen, setMenu] = useState(false);

  // ── REST ─────────────────────────────────────────────────────
  const { data: nodo, isLoading } = useQuery<Nodo>({
    queryKey: ['nodo', id],
    queryFn:  () => monitoreoApi.getNodo(id),
  });

  const { data: mediciones = [], isFetching: cargandoMetricas } = useQuery({
    queryKey: ['mediciones', id, 24],
    queryFn:  () => monitoreoApi.getMediciones(id, 24),
    refetchInterval: 5 * 60_000,
    enabled:  tab === 'Métricas',
  });

  const { data: interfaces = [] } = useQuery({
    queryKey: ['snmp-interfaces', id],
    queryFn:  () => monitoreoApi.getSnmpInterfaces(id),
    enabled:  tab === 'Interfaces SNMP' && nodo?.snmpHabilitado,
  });

  const { data: alertasNodo = [] } = useQuery({
    queryKey: ['alertas-nodo', id],
    queryFn:  () => monitoreoApi.getHistorialAlertas({ nodoId: id, limit: 50 }),
    enabled:  tab === 'Alertas',
  });

  // ── WebSocket: live metrics ────────────────────────────────
  const { getMedicion, suscribir } = useMonitoreo();
  const liveMedicion = getMedicion(id);

  // Suscribirse al nodo específico
  useState(() => { suscribir(id); });

  // Datos combinados: BD + WS
  const nodoLive = nodo && liveMedicion ? {
    ...nodo,
    estado:        liveMedicion.estado as any,
    latenciaMs:    liveMedicion.latenciaMs ?? nodo.latenciaMs,
    perdidaPct:    liveMedicion.perdidaPct,
    cpuUsoPct:     liveMedicion.cpuPct     ?? nodo.cpuUsoPct,
    memoriaUsoPct: liveMedicion.memoriaPct ?? nodo.memoriaUsoPct,
    traficoRxBps:  liveMedicion.traficoRxBps ?? nodo.traficoRxBps,
    traficoTxBps:  liveMedicion.traficoTxBps ?? nodo.traficoTxBps,
    temperaturaC:  liveMedicion.temperatura  ?? nodo.temperaturaC,
  } : nodo;

  // ── Ping manual ────────────────────────────────────────────
  const { mutate: pingNodo, isPending: pingando, data: pingResult } = useMutation({
    mutationFn: () => monitoreoApi.pingNodo(id),
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  // ── Eliminar nodo ──────────────────────────────────────────
  const { mutate: eliminar, isPending: eliminando } = useMutation({
    mutationFn: () => monitoreoApi.deleteNodo(id),
    onSuccess: () => { router.push('/monitoreo'); toast('Nodo eliminado', { type: 'success' }); },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  // ── Preparar datos para gráficos ──────────────────────────
  const latenciaData = mediciones.slice(-48).map((m) => ({
    hora:     new Date(m.timestamp).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
    latencia: m.latenciaMs,
    perdida:  m.perdidaPct,
  }));

  const traficoData = mediciones.slice(-48).map((m) => ({
    hora: new Date(m.timestamp).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
    rx:   Math.round((m.traficoRxBps ?? 0) / 1_000_000 * 100) / 100,
    tx:   Math.round((m.traficoTxBps ?? 0) / 1_000_000 * 100) / 100,
  }));

  const cpuData = mediciones.slice(-48).map((m) => ({
    hora: new Date(m.timestamp).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
    cpu:  m.cpuPct,
    ram:  m.memoriaPct,
  }));

  if (isLoading) return <div className="skeleton h-96 rounded-xl animate-pulse" />;
  if (!nodo)     return <p className="text-muted-foreground text-center py-20">Nodo no encontrado.</p>;

  const isOnline  = nodoLive?.estado === 'online';
  const isOffline = nodoLive?.estado === 'offline';

  return (
    <div className="space-y-5 max-w-5xl">

      {/* Nav */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={() => router.push('/monitoreo')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Monitoreo
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => pingNodo()}
            disabled={pingando}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                       border border-input hover:bg-muted transition-colors"
          >
            {pingando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Ping manual
          </button>

          <div className="relative">
            <button onClick={() => setMenu(!menuOpen)}
              className="p-1.5 rounded-lg border border-input hover:bg-muted transition-colors">
              <MoreVertical className="w-4 h-4 text-muted-foreground" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-40 bg-popover border border-border
                                rounded-xl shadow-xl p-1 animate-fade-in">
                  <button
                    onClick={() => { eliminar(); setMenu(false); }}
                    disabled={eliminando}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive
                               hover:bg-destructive/10 rounded-lg transition-colors"
                  >
                    {eliminando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Eliminar nodo
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Header del nodo */}
      <div className={cn(
        'rounded-xl border p-5',
        isOffline ? 'bg-red-50/50 border-red-200 dark:bg-red-950/10 dark:border-red-900/60' : 'bg-card border-border',
      )}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className={cn(
              'w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0',
              isOnline  ? 'bg-green-100 dark:bg-green-950/30' :
              isOffline ? 'bg-red-100 dark:bg-red-950/30' :
              'bg-muted',
            )}>
              {isOnline ? '📡' : isOffline ? '❌' : '❓'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">{nodo.nombre}</h1>
                <span className={cn(
                  'text-[11px] font-bold px-2 py-0.5 rounded-full',
                  isOnline  ? 'badge-activo' :
                  isOffline ? 'badge-moroso' :
                  'badge-pendiente',
                )}>
                  {nodoLive?.estado?.toUpperCase()}
                </span>
              </div>
              <p className="text-sm text-muted-foreground font-mono">{nodo.ipMonitoreo}</p>
              {nodo.descripcion && <p className="text-xs text-muted-foreground mt-0.5">{nodo.descripcion}</p>}
            </div>
          </div>

          {/* Métricas rápidas actuales */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <QuickMetric label="Latencia"  value={nodoLive?.latenciaMs != null ? `${nodoLive.latenciaMs.toFixed(0)}ms` : '—'} />
            <QuickMetric label="Pérdida"   value={nodoLive?.perdidaPct  != null ? formatPct(nodoLive.perdidaPct) : '—'} />
            <QuickMetric label="CPU"       value={nodoLive?.cpuUsoPct   != null ? formatPct(nodoLive.cpuUsoPct) : '—'} />
            <QuickMetric label="Bajada"    value={formatBps(nodoLive?.traficoRxBps ?? 0)} />
          </div>
        </div>

        {/* Resultado del ping manual */}
        {pingResult && (
          <div className="mt-4 p-3 rounded-lg bg-muted/50 text-xs font-mono">
            Ping: avg={pingResult.avg}ms | min={pingResult.min}ms | max={pingResult.max}ms | pérdida={pingResult.loss}%
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex border-b border-border px-4 gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn(
                'px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}>
              {t}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-5">

          {/* ── Métricas ─────────────────────────────────── */}
          {tab === 'Métricas' && (
            <div className="space-y-5">
              {/* Latencia 24h */}
              {latenciaData.length > 0 && (
                <ChartSection title="Latencia de ping — 24h" loading={cargandoMetricas}>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={latenciaData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="hora" tick={{ fontSize: 10 }} stroke="transparent" interval={5} />
                      <YAxis tick={{ fontSize: 10 }} stroke="transparent" tickFormatter={(v) => `${v}ms`} />
                      <Tooltip
                        formatter={(v: number) => [`${v?.toFixed(1)}ms`, 'Latencia']}
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                      />
                      <Line type="monotone" dataKey="latencia" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartSection>
              )}

              {/* Tráfico 24h (solo si tiene SNMP) */}
              {traficoData.some((d) => d.rx > 0 || d.tx > 0) && (
                <ChartSection title="Tráfico de red — 24h">
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={traficoData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gRx" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gTx" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="hora" tick={{ fontSize: 10 }} stroke="transparent" interval={5} />
                      <YAxis tick={{ fontSize: 10 }} stroke="transparent" tickFormatter={(v) => `${v}M`} />
                      <Tooltip
                        formatter={(v: number, n: string) => [`${v?.toFixed(2)} Mbps`, n === 'rx' ? 'Bajada' : 'Subida']}
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                      />
                      <Area type="monotone" dataKey="rx" stroke="#3b82f6" fill="url(#gRx)" strokeWidth={2} dot={false} />
                      <Area type="monotone" dataKey="tx" stroke="#10b981" fill="url(#gTx)" strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartSection>
              )}

              {/* CPU y RAM 24h */}
              {cpuData.some((d) => d.cpu > 0) && (
                <ChartSection title="CPU y RAM — 24h">
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={cpuData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="hora" tick={{ fontSize: 10 }} stroke="transparent" interval={5} />
                      <YAxis tick={{ fontSize: 10 }} stroke="transparent" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <Tooltip
                        formatter={(v: number, n: string) => [`${v?.toFixed(1)}%`, n === 'cpu' ? 'CPU' : 'RAM']}
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                      />
                      <Line type="monotone" dataKey="cpu" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="ram" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartSection>
              )}

              {!latenciaData.length && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Sin mediciones históricas aún. Los datos aparecerán después del primer ciclo de monitoreo (60s).
                </p>
              )}
            </div>
          )}

          {/* ── Interfaces SNMP ──────────────────────────── */}
          {tab === 'Interfaces SNMP' && (
            <div>
              {!nodo.snmpHabilitado ? (
                <div className="text-center py-10">
                  <Network className="w-10 h-10 text-muted-foreground opacity-30 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">SNMP no habilitado</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Activa el polling SNMP en la configuración del nodo para ver las interfaces.
                  </p>
                </div>
              ) : interfaces.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No se pudo leer las interfaces. Verifica la community y versión SNMP.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Índice</th>
                        <th>Interfaz</th>
                        <th>Velocidad</th>
                        <th>Estado</th>
                        <th>RX</th>
                        <th>TX</th>
                      </tr>
                    </thead>
                    <tbody>
                      {interfaces.map((iface) => (
                        <tr key={iface.index}>
                          <td><span className="font-mono text-xs">{iface.index}</span></td>
                          <td><span className="text-sm font-medium">{iface.descripcion}</span></td>
                          <td><span className="text-xs">{formatBps(iface.velocidad)}</span></td>
                          <td>
                            <span className={cn(
                              'text-[10px] font-bold px-1.5 py-px rounded-full',
                              iface.operStatus === 1 ? 'badge-activo' : 'badge-moroso',
                            )}>
                              {iface.operStatus === 1 ? 'UP' : 'DOWN'}
                            </span>
                          </td>
                          <td><span className="text-xs font-mono">{formatBps(iface.rxBytes)}</span></td>
                          <td><span className="text-xs font-mono">{formatBps(iface.txBytes)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Alertas ──────────────────────────────────── */}
          {tab === 'Alertas' && (
            <div className="space-y-2">
              {alertasNodo.length === 0 ? (
                <div className="text-center py-10">
                  <Activity className="w-10 h-10 text-green-500 opacity-60 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">Sin alertas registradas</p>
                </div>
              ) : (
                alertasNodo.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 p-3.5 rounded-xl border border-border">
                    <span className={cn(
                      'text-[10px] font-bold px-1.5 py-px rounded-full flex-shrink-0 mt-0.5',
                      a.nivel === 'critical' ? 'bg-destructive text-destructive-foreground' :
                      a.nivel === 'warning'  ? 'bg-orange-500 text-white' :
                      a.nivel === 'recovery' ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground',
                    )}>
                      {a.nivel.toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{a.mensaje}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDateTime(a.createdAt)}
                        {a.resueltaEn && <span className="text-green-600 ml-2">· Resuelto {formatDateTime(a.resueltaEn)} ({a.duracionMinutos}min)</span>}
                      </p>
                    </div>
                    <span className={cn(
                      'text-[10px] font-medium px-1.5 py-px rounded-full flex-shrink-0',
                      a.estado === 'activa' ? 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' : 'bg-muted text-muted-foreground',
                    )}>
                      {a.estado}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Configuración ─────────────────────────────── */}
          {tab === 'Configuración' && (
            <div className="grid md:grid-cols-2 gap-5">
              <InfoSec title="Monitoreo">
                <IR label="IP"            value={nodo.ipMonitoreo} mono />
                <IR label="Tipo"          value={nodo.tipo} />
                <IR label="Ping"          value={nodo.pingHabilitado ? `Cada ${nodo.pingIntervaloSeg}s` : 'Deshabilitado'} />
                <IR label="SNMP"          value={nodo.snmpHabilitado ? `v${nodo.snmpVersion} · ${nodo.snmpCommunity}` : 'Deshabilitado'} />
                <IR label="Alertas"       value={nodo.alertasHabilitadas ? 'Habilitadas' : 'Deshabilitadas'} />
              </InfoSec>
              <InfoSec title="Estado actual">
                <IR label="Estado"        value={nodo.estado} />
                <IR label="Último ping"   value={nodo.ultimoPing ? formatDateTime(nodo.ultimoPing) : '—'} />
                <IR label="Latencia"      value={nodo.latenciaMs != null ? `${nodo.latenciaMs.toFixed(1)}ms` : '—'} />
                <IR label="Uptime 7d"     value={nodo.uptimePct7d != null ? formatPct(nodo.uptimePct7d) : '—'} />
              </InfoSec>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Micro-componentes ────────────────────────────────────────
function QuickMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 rounded-xl bg-muted/50">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-bold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function ChartSection({ title, children, loading }: {
  title: string; children: React.ReactNode; loading?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</p>
      {loading ? <div className="skeleton h-44 rounded-lg animate-pulse" /> : children}
    </div>
  );
}

function InfoSec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function IR({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-2 items-baseline">
      <span className="text-xs text-muted-foreground min-w-[100px]">{label}</span>
      <span className={cn('text-sm text-foreground', mono && 'font-mono')}>{value ?? '—'}</span>
    </div>
  );
}
