'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, Download, CheckCircle2, GitBranch, AlertTriangle, Circle,
} from 'lucide-react';

import { sistemaApi } from '@/lib/api/sistema';
import { useToast }   from '@/components/ui/toaster';
import { cn }         from '@/lib/utils';

// Versión del ERP Datafast, actualizaciones disponibles y ventana de
// observación post-update. (Los recursos de la VPS viven en Ajustes → Servidor.)
export function VersionSistemaCard() {
  const { toast }   = useToast();
  const queryClient = useQueryClient();
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

  const updateMutation = useMutation({
    mutationFn: sistemaApi.update,
    onSuccess: () => {
      toast('Actualización iniciada — el sistema se reiniciará al terminar. Puede tardar varios minutos.', { type: 'success' });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['sistema-info'] }), 5000);
    },
    onError: () => toast('No se pudo iniciar la actualización.', { type: 'error' }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!info?.version) return null;
  const { version, update, observacion } = info;

  return (
    <div className="space-y-4">

      {/* Ventana de observación post-update */}
      {observacion?.activa && (
        <div className={cn(
          'flex items-start gap-3 p-3 rounded-xl border',
          observacion.inestable
            ? 'bg-red-500/10 border-red-500/30'
            : 'bg-blue-500/10 border-blue-500/20',
        )}>
          <AlertTriangle className={cn('w-4 h-4 shrink-0 mt-0.5', observacion.inestable ? 'text-red-400' : 'text-blue-400')} />
          <div className="text-sm">
            {observacion.inestable ? (
              <p className="text-red-300 font-medium">
                Versión INESTABLE — {observacion.errores} errores desde la actualización
                (línea base previa: {observacion.baseline}). Revisa el registro de eventos y evalúa un rollback.
              </p>
            ) : (
              <p className="text-blue-300">
                Período de observación post-actualización activo ({observacion.horasRestantes}h restantes) —
                {' '}{observacion.errores} errores registrados (línea base previa: {observacion.baseline}).
              </p>
            )}
          </div>
        </div>
      )}

      {/* Versión y actualizaciones */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Versión de ERP Datafast instalada</p>
            <p className="text-2xl font-bold text-foreground">v{version.current}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Schema BD: <span className="text-foreground font-medium">{version.schema}</span>
              {version.ultimaMigracion && (
                <span className="font-mono ml-1.5 opacity-70" title={version.ultimaMigracion}>
                  ({version.ultimaMigracion.length > 40 ? version.ultimaMigracion.slice(0, 40) + '…' : version.ultimaMigracion})
                </span>
              )}
            </p>
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
        <div className="pt-3 border-t border-border flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5" />
            Fuente: <span className="text-foreground font-mono">{update.sourceType}</span>
          </span>
          <span>Rama: <span className="text-foreground font-mono">{update.branch}</span></span>
          <span>{update.sourceUrl}</span>
          <button
            onClick={() => { setShowLog(!showLog); if (!showLog) refetchLog(); }}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors ml-auto"
          >
            <Circle className="w-3 h-3" />
            {showLog ? 'Ocultar log de actualización' : 'Ver log de última actualización'}
          </button>
        </div>

        {showLog && (
          <pre className="p-3 rounded-lg bg-black/40 border border-border text-xs text-green-400 font-mono overflow-auto max-h-48 whitespace-pre-wrap">
            {log || '(sin logs disponibles)'}
          </pre>
        )}
      </div>
    </div>
  );
}
