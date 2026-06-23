'use client';

import { useState, useCallback }  from 'react';
import { useRouter }              from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, AlertTriangle, CheckCircle2,
  RefreshCw, Filter, Clock,
} from 'lucide-react';

import { monitoreoApi }   from '@/lib/api/monitoreo';
import { useMonitoreo }   from '@/hooks/useMonitoreo';
import { useToast }       from '@/components/ui/toaster';
import { parseApiError, formatDateTime, cn } from '@/lib/utils';
import type { Alerta }    from '@/types';

const NIVEL_CFG: Record<string, { cls: string; label: string }> = {
  critical: { cls: 'bg-destructive/15 text-destructive border border-destructive/25',                                     label: 'CRÍTICA'  },
  warning:  { cls: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border border-orange-500/25',                   label: 'WARNING'  },
  recovery: { cls: 'bg-green-500/15  text-green-700  dark:text-green-400  border border-green-500/25',                    label: 'RECOVERY' },
  info:     { cls: 'bg-blue-500/15   text-blue-700   dark:text-blue-400   border border-blue-500/25',                     label: 'INFO'     },
};

const METRICA_LABELS: Record<string, string> = {
  ping_latencia:   'Latencia ping',
  ping_perdida:    'Pérdida paquetes',
  cpu:             'CPU',
  memoria:         'Memoria',
  trafico_bajada:  'Tráfico bajada',
  trafico_subida:  'Tráfico subida',
  temperatura:     'Temperatura',
  estado_nodo:     'Estado nodo',
  sesiones_pppoe:  'Sesiones PPPoE',
  senal_onu:       'Señal ONU',
};

export function AlertasHistorial() {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [filtroNivel, setFiltroNivel] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('activa');
  const [filtroNodo, setFiltroNodo]    = useState('');

  // ── WebSocket: alertas en tiempo real ─────────────────────
  const { alertas: wsAlertas, conectado } = useMonitoreo();

  // ── REST: alertas activas ─────────────────────────────────
  const { data: activas = [], refetch: refetchActivas, isFetching } = useQuery<Alerta[]>({
    queryKey: ['alertas-activas'],
    queryFn:  monitoreoApi.getAlertasActivas,
    refetchInterval: 30_000,
  });

  const { data: historial = [] } = useQuery<Alerta[]>({
    queryKey: ['alertas-historial', filtroNodo],
    queryFn:  () => monitoreoApi.getHistorialAlertas({ nodoId: filtroNodo || undefined, limit: 100 }),
    enabled:  filtroEstado !== 'activa',
    refetchInterval: 60_000,
  });

  // Lista a mostrar según el filtro de estado
  const alertasBase: Alerta[] = filtroEstado === 'activa' ? activas : historial;

  // Aplicar filtros de nivel y nodo
  const alertasFiltradas = alertasBase.filter((a) => {
    if (filtroNivel && a.nivel !== filtroNivel) return false;
    if (filtroNodo  && a.nodoId !== filtroNodo)  return false;
    return true;
  });

  // Nodos únicos para el select de filtro
  const nodosUnicos = [...new Map(alertasBase.map((a) => [a.nodoId, a.nodoNombre])).entries()]
    .filter(([id]) => !!id);

  // ── Resolver alerta ───────────────────────────────────────
  const { mutate: resolver } = useMutation({
    mutationFn: (id: string) => monitoreoApi.resolverAlerta(id, 'Resuelto manualmente desde historial'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertas-activas'] });
      toast('Alerta marcada como resuelta', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  // Estadísticas
  const criticas = activas.filter((a) => a.nivel === 'critical').length;
  const warnings  = activas.filter((a) => a.nivel === 'warning').length;

  return (
    <div className="max-w-4xl space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/monitoreo')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Monitoreo
          </button>
          <div>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              Alertas del sistema
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                conectado ? 'bg-green-500 animate-pulse-dot' : 'bg-muted-foreground',
              )} />
              <p className="text-xs text-muted-foreground">
                {conectado ? 'En tiempo real' : 'Reconectando'} ·
                {criticas > 0 && <span className="text-destructive font-medium ml-1">{criticas} críticas</span>}
                {warnings > 0  && <span className="text-orange-600 font-medium ml-1">{warnings} warnings</span>}
                {!criticas && !warnings && <span className="text-green-600 ml-1">Sin alertas activas ✓</span>}
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={() => refetchActivas()}
          disabled={isFetching}
          className="p-1.5 rounded-lg border border-input hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
        </button>
      </div>

      {/* Resumen visual */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Críticas activas', value: criticas, color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/20' },
          { label: 'Warnings activos', value: warnings,  color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800' },
          { label: 'Total activas',    value: activas.length, color: 'text-foreground', bg: 'bg-card border-border' },
        ].map((s) => (
          <div key={s.label} className={cn('px-4 py-3 rounded-xl border', s.bg)}>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-0.5', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Filter className="w-3.5 h-3.5" /> Filtros:
        </div>

        {/* Estado */}
        <div className="flex rounded-lg border border-input overflow-hidden text-xs">
          {[
            { key: 'activa',   label: 'Activas' },
            { key: 'todas',    label: 'Historial' },
            { key: 'resuelta', label: 'Resueltas' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFiltroEstado(key)}
              className={cn(
                'px-3 py-1.5 font-medium transition-colors',
                filtroEstado === key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Nivel */}
        <select
          value={filtroNivel}
          onChange={(e) => setFiltroNivel(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-lg border border-input bg-background
                     focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Todos los niveles</option>
          <option value="critical">🔴 Críticas</option>
          <option value="warning">🟠 Warnings</option>
          <option value="recovery">🟢 Recovery</option>
        </select>

        {/* Nodo */}
        {nodosUnicos.length > 0 && (
          <select
            value={filtroNodo}
            onChange={(e) => setFiltroNodo(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-input bg-background
                       focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Todos los nodos</option>
            {nodosUnicos.map(([id, nombre]) => (
              <option key={id} value={id!}>{nombre}</option>
            ))}
          </select>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {alertasFiltradas.length} resultado{alertasFiltradas.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Lista de alertas */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {alertasFiltradas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <CheckCircle2 className="w-10 h-10 text-green-500 mb-3" />
            <p className="text-sm font-medium text-foreground">Sin alertas</p>
            <p className="text-xs text-muted-foreground mt-1">
              {filtroEstado === 'activa' ? 'Todos los sistemas operando correctamente.' : 'No hay alertas en el historial.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {alertasFiltradas.map((a) => {
              const cfg = NIVEL_CFG[a.nivel] ?? NIVEL_CFG.info;
              const isActiva = a.estado === 'activa';

              return (
                <div
                  key={a.id}
                  className={cn(
                    'flex items-start gap-4 px-5 py-4 transition-colors',
                    isActiva && a.nivel === 'critical' && 'bg-red-50/30 dark:bg-red-950/5',
                    isActiva && a.nivel === 'warning'  && 'bg-orange-50/30 dark:bg-orange-950/5',
                  )}
                >
                  {/* Badge de nivel */}
                  <span className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5',
                    cfg.cls,
                  )}>
                    {cfg.label}
                  </span>

                  {/* Contenido */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">
                        {a.nodoNombre ?? 'Nodo desconocido'}
                      </p>
                      <span className="text-xs text-muted-foreground">·</span>
                      <p className="text-xs text-muted-foreground">
                        {METRICA_LABELS[a.metrica] ?? a.metrica}
                        {a.valorActual != null && (
                          <span className="font-mono ml-1">
                            = {a.valorActual.toFixed(1)}
                            {a.umbral != null && ` (umbral: ${a.umbral})`}
                          </span>
                        )}
                      </p>
                    </div>
                    <p className="text-xs text-foreground mt-0.5">{a.mensaje}</p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(a.createdAt)}
                      </span>
                      {a.resueltaEn && (
                        <span className="text-green-600">
                          Resuelto: {formatDateTime(a.resueltaEn)}
                          {a.duracionMinutos != null && ` (${a.duracionMinutos}min)`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex-shrink-0">
                    {isActiva ? (
                      <button
                        onClick={() => resolver(a.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg
                                   text-green-700 bg-green-100 hover:bg-green-200
                                   dark:bg-green-950/30 dark:text-green-400 dark:hover:bg-green-950/50
                                   transition-colors font-medium"
                      >
                        <CheckCircle2 className="w-3 h-3" /> Resolver
                      </button>
                    ) : (
                      <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-muted text-muted-foreground">
                        {a.estado}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
