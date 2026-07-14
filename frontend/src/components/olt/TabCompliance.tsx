'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, ShieldCheck, ShieldAlert, ShieldX, RefreshCw, Info, AlertTriangle, Wrench,
} from 'lucide-react';
import { oltNativoApi, type ComplianceCheck } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const SEVERIDAD_ICON: Record<ComplianceCheck['severidad'], React.ElementType> = {
  critical: ShieldX,
  warning:  AlertTriangle,
  info:     Info,
};

const SEVERIDAD_OK_CLS   = 'border-emerald-700/40 bg-emerald-500/5 text-emerald-400';
const SEVERIDAD_FAIL_CLS: Record<ComplianceCheck['severidad'], string> = {
  critical: 'border-red-700/40 bg-red-500/5 text-red-400',
  warning:  'border-amber-700/40 bg-amber-500/5 text-amber-400',
  info:     'border-border bg-muted/20 text-muted-foreground',
};

const REGLA_LABEL: Record<string, string> = {
  boards_sincronizadas:      'Tarjetas sincronizadas',
  vlan_gestion_existe:       'VLAN de gestión coherente',
  tr069_vlan_coherente:      'VLAN TR-069 coherente',
  snapshot_fresco:           'Snapshot actualizado',
  boards_saludables:         'Tarjetas sin fallas',
  snmp_community_coherente:  'Community SNMP coherente',
  ntp_sincronizado:          'NTP sincronizado',
};

// ── Aplicar servidores NTP deseados — Incremento 5 (convergencia real) ──
function AplicarNtpPanel({ oltId, onAplicado }: { oltId: string; onAplicado: () => void }) {
  const { toast } = useToast();
  const [servers, setServers] = useState('');

  const aplicar = useMutation({
    mutationFn: () => oltNativoApi.aplicarNtpServers(
      oltId,
      servers.split(',').map(s => s.trim()).filter(Boolean),
    ),
    onSuccess: (res) => {
      if (res.aplicado) {
        toast('Servidores NTP aplicados en la OLT', { type: 'success' });
        onAplicado();
      } else {
        toast(`No se pudo aplicar: ${res.error ?? 'error desconocido'}`, { type: 'error' });
      }
    },
    onError: () => toast('Error al aplicar servidores NTP', { type: 'error' }),
  });

  return (
    <div className="mt-2.5 pt-2.5 border-t border-current/10 flex items-center gap-2">
      <input
        value={servers}
        onChange={(e) => setServers(e.target.value)}
        placeholder="IPs separadas por coma, ej: 10.8.1.1, 1.1.1.1"
        className="flex-1 bg-background/50 border border-current/20 rounded-lg px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
      />
      <button
        onClick={() => servers.trim() && aplicar.mutate()}
        disabled={aplicar.isPending || !servers.trim()}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 shrink-0"
      >
        {aplicar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
        Aplicar a la OLT
      </button>
    </div>
  );
}

export function TabCompliance({ oltId }: { oltId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['olt-compliance', oltId],
    queryFn:  () => oltNativoApi.getCompliance(oltId),
    enabled:  !!oltId,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No se pudo cargar el estado de cumplimiento.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {data.cumpleTodo ? (
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
        ) : (
          <ShieldAlert className="w-4 h-4 text-amber-400" />
        )}
        <span className="text-sm font-semibold">
          {data.cumpleTodo ? 'Cumple todas las reglas' : `${data.criticos} crítico(s) · ${data.advertencias} advertencia(s)`}
        </span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
          title="Reevaluar"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Lectura del estado ya sincronizado (sin SSH) — no refleja cambios hechos directamente
        en la OLT hasta el próximo sync.
      </p>

      <div className="space-y-2">
        {data.checks.map((check) => {
          const Icon = SEVERIDAD_ICON[check.severidad];
          return (
            <div
              key={check.regla}
              className={cn(
                'flex items-start gap-3 rounded-xl border px-3.5 py-3',
                check.cumple ? SEVERIDAD_OK_CLS : SEVERIDAD_FAIL_CLS[check.severidad],
              )}
            >
              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {REGLA_LABEL[check.regla] ?? check.regla}
                </p>
                <p className="text-xs opacity-90 mt-0.5">{check.mensaje}</p>

                {check.regla === 'ntp_sincronizado' && !check.cumple && (
                  <AplicarNtpPanel
                    oltId={oltId}
                    onAplicado={() => {
                      queryClient.invalidateQueries({ queryKey: ['olt-compliance', oltId] });
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
