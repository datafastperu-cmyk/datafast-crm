'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Server, RefreshCw, Download, AlertTriangle,
  CheckCircle2, Circle, Cpu, HardDrive, Clock, GitBranch,
} from 'lucide-react';

import { sistemaApi } from '@/lib/api/sistema';
import { useToast }   from '@/components/ui/toaster';
import { cn }         from '@/lib/utils';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatPm2Uptime(ms: number): string {
  return formatUptime(Math.floor((Date.now() - ms) / 1000));
}

function StatusDot({ status }: { status: string }) {
  const online = status === 'online';
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full',
      online ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400',
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', online ? 'bg-emerald-400' : 'bg-red-400')} />
      {online ? 'Online' : status}
    </span>
  );
}

export function ServidorTab() {
  const { toast }      = useToast();
  const queryClient    = useQueryClient();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const { data: info, isLoading, refetch } = useQuery({
    queryKey:  ['sistema-info'],
    queryFn:   sistemaApi.getInfo,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: log, refetch: refetchLog } = useQuery({
    queryKey: ['sistema-update-log'],
    queryFn:  sistemaApi.getUpdateLog,
    enabled:  showLog,
  });

  const restartMutation = useMutation({
    mutationFn: sistemaApi.restart,
    onSuccess: () => {
      toast('Reinicio iniciado — El servidor se reiniciará en unos segundos.', { type: 'success' });
      setConfirmRestart(false);
    },
    onError: () => toast('No se pudo iniciar el reinicio.', { type: 'error' }),
  });

  const updateMutation = useMutation({
    mutationFn: sistemaApi.update,
    onSuccess: () => {
      toast('Actualización iniciada — El servidor se reiniciará al terminar. Puede tardar varios minutos.', { type: 'success' });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['sistema-info'] }), 5000);
    },
    onError: () => toast('No se pudo iniciar la actualización.', { type: 'error' }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!info) return null;

  const { version, update, system, processes } = info;

  if (!version || !update || !system) return null;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-foreground">Estado del Servidor</h3>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </button>
      </div>

      {/* Versión y actualizaciones */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Versión instalada</p>
            <p className="text-2xl font-bold text-foreground">v{version.current}</p>
            {version.remote && (
              <p className="text-xs text-muted-foreground mt-1">
                Última disponible: <span className="text-foreground font-medium">v{version.remote}</span>
              </p>
            )}
          </div>

          {version.updateAvailable ? (
            <div className="flex flex-col items-end gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Download className="w-3 h-3" />
                Nueva versión disponible
              </span>
              <button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {updateMutation.isPending
                  ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Actualizando...</>
                  : <><Download className="w-3.5 h-3.5" /> Actualizar a v{version.remote}</>
                }
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Al día
            </span>
          )}
        </div>

        {/* Fuente de actualización */}
        <div className="pt-3 border-t border-border flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5" />
            Fuente: <span className="text-foreground font-mono">{update.sourceType}</span>
          </span>
          <span>Rama: <span className="text-foreground font-mono">{update.branch}</span></span>
          <span>{update.sourceUrl}</span>
        </div>
      </div>

      {/* Recursos del sistema */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Uptime</span>
          </div>
          <p className="text-lg font-semibold text-foreground">{formatUptime(system.uptime)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">RAM usada</span>
          </div>
          <p className="text-lg font-semibold text-foreground">{system.memoryMb} MB</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Disco</span>
          </div>
          {system.disk
            ? <p className="text-lg font-semibold text-foreground">{system.disk.usage} <span className="text-sm font-normal text-muted-foreground">de {system.disk.total}</span></p>
            : <p className="text-sm text-muted-foreground">—</p>
          }
        </div>
      </div>

      {/* Procesos PM2 */}
      {processes && processes.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-medium text-foreground">Procesos PM2</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left px-4 py-2 font-medium">Proceso</th>
                <th className="text-left px-4 py-2 font-medium">Estado</th>
                <th className="text-left px-4 py-2 font-medium">Uptime</th>
                <th className="text-right px-4 py-2 font-medium">RAM</th>
                <th className="text-right px-4 py-2 font-medium">Reinicios</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((p) => (
                <tr key={p.name} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{p.name}</td>
                  <td className="px-4 py-3"><StatusDot status={p.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{p.uptime ? formatPm2Uptime(p.uptime) : '—'}</td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">{p.memoryMb} MB</td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">{p.restarts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Acciones */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">Acciones</p>

        {/* Reiniciar */}
        {!confirmRestart ? (
          <button
            onClick={() => setConfirmRestart(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reiniciar servidor
          </button>
        ) : (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-sm text-amber-300 flex-1">El sistema estará inaccesible por unos segundos. ¿Confirmar reinicio?</p>
            <button
              onClick={() => restartMutation.mutate()}
              disabled={restartMutation.isPending}
              className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {restartMutation.isPending ? 'Reiniciando...' : 'Confirmar'}
            </button>
            <button
              onClick={() => setConfirmRestart(false)}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
          </div>
        )}

        {/* Log de actualización */}
        <button
          onClick={() => { setShowLog(!showLog); if (!showLog) refetchLog(); }}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Circle className="w-3 h-3" />
          {showLog ? 'Ocultar log de actualización' : 'Ver log de última actualización'}
        </button>

        {showLog && (
          <pre className="mt-2 p-3 rounded-lg bg-black/40 border border-border text-xs text-green-400 font-mono overflow-auto max-h-48 whitespace-pre-wrap">
            {log || '(sin logs disponibles)'}
          </pre>
        )}
      </div>

    </div>
  );
}
