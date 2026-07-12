'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Loader2, Wifi, WifiOff, PowerOff, Unplug, Ban, HelpCircle, Search,
  Eye, RotateCcw, ArrowUpFromLine,
} from 'lucide-react';
import { oltNativoApi, type OnuClasificada, type OnuInventarioGlobalItem } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { OnuDetalleTr069Modal } from './OnuDetalleTr069Modal';

const EST: Record<OnuClasificada['estadoOperativo'], { label: string; cls: string; Icon: typeof Wifi }> = {
  online:           { label: 'Online',           cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-700/40', Icon: Wifi },
  apagada:          { label: 'ONU Apagada',      cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-600/40',          Icon: PowerOff },
  ruptura_fibra:    { label: 'Ruptura de Fibra', cls: 'bg-red-500/10 text-red-400 border-red-700/40',             Icon: Unplug },
  desactivada:      { label: 'Desactivada',      cls: 'bg-amber-500/10 text-amber-400 border-amber-700/40',       Icon: Ban },
  offline:          { label: 'Offline',          cls: 'bg-orange-500/10 text-orange-400 border-orange-700/40',    Icon: WifiOff },
  no_aprovisionada: { label: 'No Aprovisionada', cls: 'bg-violet-500/10 text-violet-400 border-violet-700/40',    Icon: HelpCircle },
};
const ESTADOS = Object.keys(EST) as OnuClasificada['estadoOperativo'][];

// Señal FTTH (RxPower óptico en la ONU) → calidad por umbrales GPON.
function senalFtth(rx: number | null): { txt: string; cls: string } {
  if (rx == null) return { txt: '— sin datos', cls: 'text-muted-foreground' };
  if (rx >= -23)  return { txt: `${rx} dBm`, cls: 'text-emerald-400' };   // buena
  if (rx >= -27)  return { txt: `${rx} dBm`, cls: 'text-amber-400' };     // marginal
  return { txt: `${rx} dBm`, cls: 'text-red-400' };                      // crítica
}

export function OnuInventarioUnificado() {
  const { toast } = useToast();
  const { data = [], isLoading } = useQuery({
    queryKey: ['olt-inventario-global'],
    queryFn:  oltNativoApi.getInventarioGlobal,
    staleTime: 30_000,
  });

  // Reiniciar ONU (reset físico vía OLT). Requiere onuId (ONU configurada).
  const resetMut = useMutation({
    mutationFn: (o: OnuInventarioGlobalItem) => oltNativoApi.ftthResetOnu(o.oltId, o.slot, o.port, o.onuId as number),
    onSuccess: () => toast('ONU reiniciada — puede tardar ~1 min en volver online', { type: 'success' }),
    onError:   () => toast('No se pudo reiniciar la ONU', { type: 'error' }),
  });

  // Resincronizar: re-aplica los datos del ERP hacia la ONU (GPON + service-port + WAN)
  // de forma resiliente vía outbox. Requiere contrato vinculado.
  const resyncMut = useMutation({
    mutationFn: (o: OnuInventarioGlobalItem) => oltNativoApi.reaplicarDrift(o.oltId, o.contratoId as string),
    onSuccess: () => toast('Resincronización encolada — se re-aplicará la configuración a la ONU.', { type: 'success' }),
    onError:   () => toast('No se pudo encolar la resincronización', { type: 'error' }),
  });

  const [q, setQ]     = useState('');
  const [olt, setOlt] = useState('');
  const [est, setEst] = useState('');
  const [detalle, setDetalle] = useState<OnuInventarioGlobalItem | null>(null);

  const olts = useMemo(() => [...new Set(data.map(d => d.oltNombre))].sort(), [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.filter(d =>
      (!olt || d.oltNombre === olt) &&
      (!est || d.estadoOperativo === est) &&
      (!needle || [d.sn, d.cliente, d.numeroContrato].some(x => (x ?? '').toLowerCase().includes(needle))),
    );
  }, [data, q, olt, est]);

  const resumen = useMemo(() => filtered.reduce<Record<string, number>>((a, d) => {
    a[d.estadoOperativo] = (a[d.estadoOperativo] ?? 0) + 1; return a;
  }, {}), [filtered]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Buscar SN, cliente, contrato…"
            className="w-full bg-background border border-input rounded-lg pl-8 pr-3 py-2 text-xs"
          />
        </div>
        <select value={olt} onChange={e => setOlt(e.target.value)} className="bg-background border border-input rounded-lg px-2.5 py-2 text-xs">
          <option value="">Todas las OLTs</option>
          {olts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={est} onChange={e => setEst(e.target.value)} className="bg-background border border-input rounded-lg px-2.5 py-2 text-xs">
          <option value="">Todos los estados</option>
          {ESTADOS.map(k => <option key={k} value={k}>{EST[k].label}</option>)}
        </select>
      </div>

      {/* Resumen */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="px-1.5 py-0.5 rounded border border-border bg-muted/40 font-semibold">{filtered.length} ONUs</span>
        {ESTADOS.filter(k => resumen[k]).map(k => (
          <span key={k} className={cn('px-1.5 py-0.5 rounded border font-semibold', EST[k].cls)}>
            {EST[k].label}: {resumen[k]}
          </span>
        ))}
      </div>

      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center">
          Sin inventario. Sincroniza las OLTs (tab OLTs → Sincronizar, o detalle → ONUs → Sincronizar) para poblar el inventario de todas las ONUs.
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="border-b border-border text-[11px] text-muted-foreground">
                <th className="text-left px-3 py-2 font-semibold">Cliente</th>
                <th className="text-left px-3 py-2 font-semibold">SN</th>
                <th className="text-left px-3 py-2 font-semibold">F/S/P</th>
                <th className="text-left px-3 py-2 font-semibold">Estado</th>
                <th className="text-left px-3 py-2 font-semibold">OLT</th>
                <th className="text-left px-3 py-2 font-semibold">Señal FTTH</th>
                <th className="text-right px-3 py-2 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => {
                const e = EST[o.estadoOperativo] ?? EST.offline;
                const s = senalFtth(o.rxPowerDbm);
                return (
                  <tr key={`${o.oltId}-${o.sn}-${i}`} className="border-b border-border last:border-0 hover:bg-muted/10">
                    <td className="px-3 py-2 text-xs">
                      {o.cliente ?? <span className="text-muted-foreground">—</span>}
                      {o.numeroContrato && <div className="text-[10px] text-muted-foreground font-mono">{o.numeroContrato}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{o.sn}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">0/{o.slot}/{o.port}{o.onuId != null ? ` · ${o.onuId}` : ''}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border', e.cls)}>
                          <e.Icon className="w-3 h-3" /> {e.label}
                        </span>
                        {o.sinContrato && o.estadoOperativo !== 'no_aprovisionada' && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-fuchsia-700/40 bg-fuchsia-500/10 text-fuchsia-400">Sin contrato</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{o.oltNombre}</td>
                    <td className={cn('px-3 py-2 text-xs font-medium', s.cls)}>{s.txt}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDetalle(o)}
                          disabled={!o.sn}
                          title={o.sn ? 'Ver detalle (TR-069 en vivo)' : 'ONU sin SN'}
                          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => resetMut.mutate(o)}
                          disabled={o.onuId == null || (resetMut.isPending && resetMut.variables === o)}
                          title={o.onuId == null ? 'ONU sin aprovisionar (no reiniciable)' : 'Reiniciar ONU (reset)'}
                          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-sky-400 hover:border-sky-700/50 hover:bg-sky-500/10 transition-colors disabled:opacity-40"
                        >
                          {resetMut.isPending && resetMut.variables === o
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <RotateCcw className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => resyncMut.mutate(o)}
                          disabled={!o.contratoId || (resyncMut.isPending && resyncMut.variables === o)}
                          title={!o.contratoId ? 'Sin contrato en el ERP (nada que resincronizar)' : 'Resincronizar datos ERP → ONU'}
                          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-emerald-400 hover:border-emerald-700/50 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                        >
                          {resyncMut.isPending && resyncMut.variables === o
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <ArrowUpFromLine className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detalle && (
        <OnuDetalleTr069Modal
          sn={detalle.sn}
          oltNombre={detalle.oltNombre}
          cliente={detalle.cliente}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}
