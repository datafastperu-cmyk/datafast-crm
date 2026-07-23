'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Loader2, GitCompareArrows, CheckCircle2, AlertTriangle, ArrowUpFromLine,
  HelpCircle, Clock, RefreshCw,
} from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const fmtRel = (iso: string | null): string => {
  if (!iso) return 'sin snapshot';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1)  return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
};

export function TabDrift({ oltId }: { oltId: string }) {
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['olt-drift', oltId],
    queryFn:  () => oltNativoApi.getDrift(oltId),
    enabled:  !!oltId,
  });

  const { mutate: reaplicar, isPending, variables } = useMutation({
    mutationFn: (contratoId: string) => oltNativoApi.reaplicarDrift(oltId, contratoId),
    onSuccess: () => toast('Re-aprovisionamiento encolado — se aplicará a la OLT (reintenta si está caída).', { type: 'success' }),
    onError:   () => toast('No se pudo encolar el re-aprovisionamiento', { type: 'error' }),
  });

  const { mutate: resincronizar, isPending: resincronizando, variables: resincVar } = useMutation({
    mutationFn: (p: { contratoId: string; accion: 'SUSPENDER_ONU' | 'REACTIVAR_ONU' }) =>
      oltNativoApi.resincronizarEstadoDrift(oltId, p.contratoId, p.accion),
    onSuccess: () => toast('Re-sincronización encolada — la ONU seguirá al estado del contrato.', { type: 'success' }),
    onError:   () => toast('No se pudo encolar la re-sincronización', { type: 'error' }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  const d = data ?? { enErpNoEnOlt: [], sinContrato: [], noAprovisionadas: [], estadoDivergente: [], snapshotAt: null };
  const divergentes = d.estadoDivergente ?? [];
  const sinDrift = !d.enErpNoEnOlt.length && !d.sinContrato.length && !d.noAprovisionadas.length && !divergentes.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <GitCompareArrows className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Drift ERP ↔ OLT</span>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="w-3 h-3" /> snapshot {fmtRel(d.snapshotAt)}
        </span>
        <button onClick={() => refetch()} className="ml-auto p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent" title="Recalcular">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {!d.snapshotAt && (
        <div className="flex items-center gap-2 text-xs text-amber-400 rounded-lg border border-amber-700/40 bg-amber-500/5 px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5" /> Aún no hay inventario. Ejecuta <strong>Sincronizar</strong> (tab ONUs) para calcular el drift real.
        </div>
      )}

      {sinDrift && d.snapshotAt && (
        <div className="flex items-center gap-2 text-sm text-emerald-400 rounded-lg border border-emerald-700/40 bg-emerald-500/5 px-3 py-3">
          <CheckCircle2 className="w-4 h-4" /> Sin discrepancias — el ERP y la OLT coinciden.
        </div>
      )}

      {/* Dos columnas responsive; apila en pantallas menores */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      {/* 0. Estado ONU ≠ estado contrato → re-sincronizar (la ONU sigue al contrato) */}
      {divergentes.length > 0 && (
        <section className="rounded-xl border border-amber-700/40 overflow-hidden">
          <header className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 text-amber-500 text-xs font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" />
            Estado ONU ≠ estado del contrato ({divergentes.length}) — re-sincronizar
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground">
                <th className="text-left px-3 py-2 font-semibold">Contrato / Cliente</th>
                <th className="text-left px-3 py-2 font-semibold">SN</th>
                <th className="text-left px-3 py-2 font-semibold">ONU</th>
                <th className="text-left px-3 py-2 font-semibold">Contrato</th>
                <th className="text-right px-3 py-2 font-semibold">Acción</th>
              </tr></thead>
              <tbody>
                {divergentes.map((r) => (
                  <tr key={r.contratoId} className="border-b border-border last:border-0 hover:bg-muted/10">
                    <td className="px-3 py-2 text-xs">{r.numeroContrato ? <><span className="font-mono">{r.numeroContrato}</span>{r.cliente ? ` · ${r.cliente}` : ''}</> : (r.cliente ?? '—')}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.sn}</td>
                    <td className="px-3 py-2 text-xs capitalize">{r.onuEstado}</td>
                    <td className="px-3 py-2 text-xs capitalize">{r.contratoEstado.replace('_', ' ')}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => resincronizar({ contratoId: r.contratoId, accion: r.accionSugerida })}
                        disabled={resincronizando && resincVar?.contratoId === r.contratoId}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-700/50 bg-amber-500/10 text-amber-500 text-xs font-semibold hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        {resincronizando && resincVar?.contratoId === r.contratoId
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <RefreshCw className="w-3.5 h-3.5" />}
                        {r.accionSugerida === 'REACTIVAR_ONU' ? 'Reactivar ONU' : 'Suspender ONU'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
            La ONU siempre sigue al contrato. Re-sincronizar encola el comando correcto por outbox
            (reintenta hasta aplicarlo aunque la OLT esté caída).
          </p>
        </section>
      )}
      {/* 1. En ERP, no en OLT → push (re-aprovisionar) */}
      {d.enErpNoEnOlt.length > 0 && (
        <section className="rounded-xl border border-red-700/40 overflow-hidden">
          <header className="flex items-center gap-2 px-3 py-2 bg-red-500/5 text-red-400 text-xs font-semibold">
            <ArrowUpFromLine className="w-3.5 h-3.5" />
            En el ERP, ausente en la OLT ({d.enErpNoEnOlt.length}) — falta aplicar
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground">
                <th className="text-left px-3 py-2 font-semibold">Contrato / Cliente</th>
                <th className="text-left px-3 py-2 font-semibold">SN</th>
                <th className="text-left px-3 py-2 font-semibold">F/S/P</th>
                <th className="text-right px-3 py-2 font-semibold">Acción</th>
              </tr></thead>
              <tbody>
                {d.enErpNoEnOlt.map((r) => (
                  <tr key={r.contratoId} className="border-b border-border last:border-0 hover:bg-muted/10">
                    <td className="px-3 py-2 text-xs">{r.numeroContrato ? <><span className="font-mono">{r.numeroContrato}</span>{r.cliente ? ` · ${r.cliente}` : ''}</> : (r.cliente ?? '—')}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.sn}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">0/{r.slot}/{r.port}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => reaplicar(r.contratoId)}
                        disabled={isPending && variables === r.contratoId}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-700/50 bg-emerald-500/10 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {isPending && variables === r.contratoId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpFromLine className="w-3.5 h-3.5" />}
                        Re-aprovisionar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 2. En OLT, sin contrato → informativo */}
      {d.sinContrato.length > 0 && (
        <section className="rounded-xl border border-fuchsia-700/40 overflow-hidden">
          <header className="flex items-center gap-2 px-3 py-2 bg-fuchsia-500/5 text-fuchsia-400 text-xs font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" />
            En la OLT, sin contrato en el ERP ({d.sinContrato.length})
          </header>
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur"><tr className="border-b border-border text-[11px] text-muted-foreground">
                <th className="text-left px-3 py-2 font-semibold">SN</th>
                <th className="text-left px-3 py-2 font-semibold">F/S/P</th>
                <th className="text-left px-3 py-2 font-semibold">Estado</th>
              </tr></thead>
              <tbody>
                {d.sinContrato.map((o, i) => (
                  <tr key={`${o.sn}-${i}`} className="border-b border-border last:border-0 hover:bg-muted/10">
                    <td className="px-3 py-2 font-mono text-xs">{o.sn}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">0/{o.slot}/{o.port}{o.onuId != null ? ` · ${o.onuId}` : ''}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground capitalize">{o.estadoOperativo.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
            Suelen pertenecer a otro sistema (SmartOLT/AdminOLT) o son ONUs que aún no se registran como contrato en el ERP.
          </p>
        </section>
      )}

      {/* 3. Autofind → no aprovisionadas */}
      {d.noAprovisionadas.length > 0 && (
        <section className="rounded-xl border border-violet-700/40 overflow-hidden">
          <header className="flex items-center gap-2 px-3 py-2 bg-violet-500/5 text-violet-400 text-xs font-semibold">
            <HelpCircle className="w-3.5 h-3.5" />
            Físicas sin aprovisionar — autofind ({d.noAprovisionadas.length})
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground">
                <th className="text-left px-3 py-2 font-semibold">SN</th>
                <th className="text-left px-3 py-2 font-semibold">F/S/P</th>
              </tr></thead>
              <tbody>
                {d.noAprovisionadas.map((o, i) => (
                  <tr key={`${o.sn}-${i}`} className={cn('border-b border-border last:border-0 hover:bg-muted/10')}>
                    <td className="px-3 py-2 font-mono text-xs">{o.sn}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">0/{o.slot}/{o.port}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
