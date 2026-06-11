'use client';

import { Wifi, WifiOff, Cpu, Thermometer, Activity, Users, Wrench } from 'lucide-react';
import { cn, formatBps, formatPct }                          from '@/lib/utils';
import type { Nodo }                                          from '@/types';

const ESTADO_CONFIG = {
  online:        { color: 'text-green-600',  bg: 'bg-green-500', ring: 'ring-green-200 dark:ring-green-900', label: 'Online' },
  offline:       { color: 'text-red-600',    bg: 'bg-red-500',   ring: 'ring-red-200 dark:ring-red-900',    label: 'Offline' },
  degradado:     { color: 'text-orange-600', bg: 'bg-orange-500',ring: 'ring-orange-200 dark:ring-orange-900', label: 'Degradado' },
  mantenimiento: { color: 'text-blue-600',   bg: 'bg-blue-500',  ring: 'ring-blue-200 dark:ring-blue-900',  label: 'Mantenimiento' },
  desconocido:   { color: 'text-gray-500',   bg: 'bg-gray-400',  ring: 'ring-gray-200 dark:ring-gray-800',  label: 'Desconocido' },
};

const TIPO_ICON: Record<string, string> = {
  router:       '📡',
  switch:       '🔀',
  olt:          '🔷',
  antena:       '📶',
  servidor:     '🖥',
  enlace_uplink:'🔗',
  cliente:      '👤',
};

interface Props {
  nodo:       Nodo;
  onClick:    () => void;
  onReparar?: (e: React.MouseEvent) => void;
  reparando?: boolean;
}

export function NodoCard({ nodo, onClick, onReparar, reparando }: Props) {
  const cfg = ESTADO_CONFIG[nodo.estado as keyof typeof ESTADO_CONFIG]
    ?? ESTADO_CONFIG.desconocido;

  const isOffline   = nodo.estado === 'offline';
  const isDegraded  = nodo.estado === 'degradado';
  const isUnknown   = nodo.estado === 'desconocido';

  // Porcentaje de uptime visual (para la barra de progreso)
  const uptimePct   = nodo.uptimePct7d ?? (nodo.estado === 'online' ? 100 : 0);
  const latenciaOk  = (nodo.latenciaMs ?? 0) > 0 && (nodo.latenciaMs ?? 0) < 100;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={cn(
        'group relative flex flex-col gap-3 p-4 rounded-2xl border text-left transition-all cursor-pointer',
        'hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99]',
        isOffline
          ? 'border-red-200 bg-red-50/50 dark:bg-red-950/10 dark:border-red-900/60'
          : isDegraded
          ? 'border-orange-200 bg-orange-50/50 dark:bg-orange-950/10 dark:border-orange-900/60'
          : 'border-border bg-card',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Ícono de tipo */}
          <span className="text-xl flex-shrink-0">{TIPO_ICON[nodo.tipo] ?? '📡'}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{nodo.nombre}</p>
            <p className="text-xs text-muted-foreground font-mono">{nodo.ipMonitoreo}</p>
          </div>
        </div>

        {/* Badge de estado con punto parpadeante */}
        <div className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold flex-shrink-0',
          cfg.color,
          isOffline  ? 'bg-red-100 dark:bg-red-950/30'    :
          isDegraded ? 'bg-orange-100 dark:bg-orange-950/30' :
          isUnknown  ? 'bg-muted' :
          'bg-green-100 dark:bg-green-950/30',
        )}>
          <span className={cn(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            cfg.bg,
            nodo.estado === 'online' && 'animate-pulse-dot',
          )} />
          {cfg.label}
        </div>
      </div>

      {/* Métricas principales */}
      {nodo.estado !== 'offline' && (
        <div className="grid grid-cols-2 gap-2">
          {/* Latencia */}
          <Metric
            label="Latencia"
            value={nodo.latenciaMs != null ? `${nodo.latenciaMs.toFixed(0)}ms` : '—'}
            ok={latenciaOk}
            warn={(nodo.latenciaMs ?? 0) > 100}
          />

          {/* Pérdida de paquetes */}
          <Metric
            label="Pérdida"
            value={nodo.perdidaPct != null ? formatPct(nodo.perdidaPct) : '—'}
            ok={(nodo.perdidaPct ?? 0) === 0}
            warn={(nodo.perdidaPct ?? 0) > 5}
          />

          {/* CPU (si tiene SNMP) */}
          {nodo.cpuUsoPct != null && (
            <Metric
              label="CPU"
              value={formatPct(nodo.cpuUsoPct)}
              ok={nodo.cpuUsoPct < 70}
              warn={nodo.cpuUsoPct >= 70}
              critical={nodo.cpuUsoPct >= 90}
              icon={<Cpu className="w-3 h-3" />}
            />
          )}

          {/* Memoria */}
          {nodo.memoriaUsoPct != null && (
            <Metric
              label="RAM"
              value={formatPct(nodo.memoriaUsoPct)}
              ok={nodo.memoriaUsoPct < 80}
              warn={nodo.memoriaUsoPct >= 80}
              critical={nodo.memoriaUsoPct >= 95}
            />
          )}

          {/* Temperatura */}
          {nodo.temperaturaC != null && nodo.temperaturaC > 0 && (
            <Metric
              label="Temp"
              value={`${nodo.temperaturaC.toFixed(0)}°C`}
              ok={nodo.temperaturaC < 65}
              warn={nodo.temperaturaC >= 65}
              critical={nodo.temperaturaC >= 80}
              icon={<Thermometer className="w-3 h-3" />}
            />
          )}

          {/* Sesiones PPPoE */}
          {nodo.sesionesPppoe != null && (
            <Metric
              label="Sesiones"
              value={String(nodo.sesionesPppoe)}
              ok
              icon={<Users className="w-3 h-3" />}
            />
          )}
        </div>
      )}

      {/* Offline: mostrar mensaje */}
      {nodo.estado === 'offline' && (
        <div className="flex items-center gap-2 py-1">
          <WifiOff className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-600 dark:text-red-400 font-medium">
            Sin respuesta
            {nodo.ultimoPing && (
              <span className="font-normal text-muted-foreground ml-1">
                · último ping {new Date(nodo.ultimoPing).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Tráfico */}
      {(nodo.traficoRxBps != null || nodo.traficoTxBps != null) && nodo.estado !== 'offline' && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground border-t border-border pt-2.5 mt-0.5">
          <Activity className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span>
            ↓ {formatBps(nodo.traficoRxBps ?? 0)}
            <span className="mx-1.5 text-border">|</span>
            ↑ {formatBps(nodo.traficoTxBps ?? 0)}
          </span>
        </div>
      )}

      {/* Barra de uptime 7d */}
      {nodo.estado !== 'desconocido' && (
        <div className="mt-auto pt-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Uptime 7d</span>
            <span className={cn(
              'text-[10px] font-medium',
              uptimePct >= 99 ? 'text-green-600' : uptimePct >= 95 ? 'text-orange-600' : 'text-red-600',
            )}>
              {uptimePct.toFixed(1)}%
            </span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                uptimePct >= 99 ? 'bg-green-500' : uptimePct >= 95 ? 'bg-orange-500' : 'bg-red-500',
              )}
              style={{ width: `${Math.max(uptimePct, 2)}%` }}
            />
          </div>
        </div>
      )}

      {/* Botón Reparar — solo para ANTENA_AP online */}
      {onReparar && (
        <button
          onClick={onReparar}
          disabled={reparando}
          className={cn(
            'w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
            'border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors',
            'dark:border-blue-700/50 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <Wrench className={cn('w-3.5 h-3.5', reparando && 'animate-spin')} />
          {reparando ? 'Reparando...' : 'Reparar antena'}
        </button>
      )}
    </div>
  );
}

function Metric({
  label, value, ok, warn, critical, icon,
}: {
  label: string; value: string; ok?: boolean; warn?: boolean; critical?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className={cn(
      'flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs',
      critical ? 'bg-red-100 dark:bg-red-950/30'    :
      warn     ? 'bg-orange-100 dark:bg-orange-950/30' :
      ok       ? 'bg-muted/50' : 'bg-muted/30',
    )}>
      <span className="flex items-center gap-1 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={cn(
        'font-semibold tabular-nums',
        critical ? 'text-red-700 dark:text-red-400'     :
        warn     ? 'text-orange-700 dark:text-orange-400' :
        'text-foreground',
      )}>
        {value}
      </span>
    </div>
  );
}
