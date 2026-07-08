'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, Users, ChevronLeft, ChevronRight, Radio, Wifi, WifiOff, PowerOff, Unplug, Ban, HelpCircle, AlertCircle, Database, RefreshCw, Clock } from 'lucide-react';
import { oltNativoApi, type OnuClasificada } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const fmtRel = (iso: string | null): string => {
  if (!iso) return 'nunca';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1)  return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
};

const ESTADO_COLOR: Record<string, string> = {
  activo:      'bg-emerald-500/10 text-emerald-400',
  suspendido:  'bg-yellow-500/10 text-yellow-400',
  pendiente:   'bg-blue-500/10 text-blue-400',
  error:       'bg-red-500/10 text-red-400',
};

// Estados operativos en vivo (leídos de la OLT)
const ESTADO_VIVO: Record<OnuClasificada['estadoOperativo'], { label: string; cls: string; Icon: typeof Wifi }> = {
  online:          { label: 'Online',            cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-700/40', Icon: Wifi },
  apagada:         { label: 'ONU Apagada',       cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-600/40',        Icon: PowerOff },
  ruptura_fibra:   { label: 'Ruptura de Fibra',  cls: 'bg-red-500/10 text-red-400 border-red-700/40',           Icon: Unplug },
  desactivada:     { label: 'Desactivada',       cls: 'bg-amber-500/10 text-amber-400 border-amber-700/40',     Icon: Ban },
  offline:         { label: 'Offline',           cls: 'bg-orange-500/10 text-orange-400 border-orange-700/40',  Icon: WifiOff },
  no_aprovisionada:{ label: 'No Aprovisionada',  cls: 'bg-violet-500/10 text-violet-400 border-violet-700/40',  Icon: HelpCircle },
};

const PAGE_SIZE = 50;

const fmtUptime = (secs: number | null) => {
  if (!secs) return null;
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3_600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
};

// ── Inventario (snapshot read-model, lectura instantánea de BD) ─────
function InventarioSnapshot({ oltId }: { oltId: string }) {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);

  const inv = useQuery({
    queryKey: ['olt-inventario', oltId],
    queryFn:  () => oltNativoApi.getInventario(oltId),
    enabled:  !!oltId,
  });

  // Mientras hay un sync en curso, sondeamos su estado; al completarse refrescamos
  // el snapshot. El sync es asíncrono (job en 2do plano) — no bloquea la UI.
  const syncStatus = useQuery({
    queryKey:       ['olt-sync-status', oltId],
    queryFn:        () => oltNativoApi.getSyncStatus(oltId),
    enabled:        syncing,
    refetchInterval: syncing ? 3000 : false,
  });
  useEffect(() => {
    if (!syncing) return;
    const st = syncStatus.data;
    if (st && st.estado !== 'running' && st.estado !== 'pending') {
      setSyncing(false);
      inv.refetch();
      toast(st.estado === 'completed' ? 'Inventario actualizado desde la OLT' : 'La sincronización terminó con errores',
        { type: st.estado === 'completed' ? 'success' : 'error' });
    }
  }, [syncStatus.data, syncing]); // eslint-disable-line

  const startSync = async () => {
    try {
      await oltNativoApi.iniciarSync(oltId);
      setSyncing(true);
      toast('Sincronización iniciada — inventariando ONUs y perfiles (~1-2 min)…', { type: 'success' });
    } catch {
      toast('Error al iniciar la sincronización', { type: 'error' });
    }
  };

  const onus  = inv.data?.onus ?? [];
  const drift = inv.data?.drift ?? {};
  const resumen = onus.reduce<Record<string, number>>((acc, o) => {
    acc[o.estadoOperativo] = (acc[o.estadoOperativo] ?? 0) + 1; return acc;
  }, {});
  const progreso = syncStatus.data?.progreso ?? 0;

  return (
    <div className="rounded-xl border border-border p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Database className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Inventario de ONUs (snapshot)</span>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="w-3 h-3" /> {fmtRel(inv.data?.snapshotAt ?? null)}
        </span>
        <button
          onClick={startSync}
          disabled={syncing}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-60"
        >
          {syncing
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sincronizando… {progreso}%</>
            : <><RefreshCw className="w-3.5 h-3.5" /> Sincronizar ahora</>}
        </button>
      </div>

      {/* Resumen de drift */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="px-1.5 py-0.5 rounded border border-border bg-muted/40 font-semibold">
          {(drift.onusInventario as number) ?? onus.length} ONUs
        </span>
        {(Object.keys(ESTADO_VIVO) as OnuClasificada['estadoOperativo'][])
          .filter(k => resumen[k])
          .map(k => (
            <span key={k} className={cn('px-1.5 py-0.5 rounded border font-semibold', ESTADO_VIVO[k].cls)}>
              {ESTADO_VIVO[k].label}: {resumen[k]}
            </span>
          ))}
        {!!drift.onusSinContrato && (
          <span className="px-1.5 py-0.5 rounded border border-fuchsia-700/40 bg-fuchsia-500/10 text-fuchsia-400 font-semibold">
            Sin contrato: {drift.onusSinContrato as number}
          </span>
        )}
        {!!drift.onusEnErpNoEnOlt && (
          <span className="px-1.5 py-0.5 rounded border border-red-700/40 bg-red-500/10 text-red-400 font-semibold">
            Solo en ERP: {drift.onusEnErpNoEnOlt as number}
          </span>
        )}
      </div>

      {inv.isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando inventario…
        </div>
      ) : onus.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          Sin inventario aún. Pulsa <strong>Sincronizar ahora</strong> para leer las ONUs de la OLT.
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="border-b border-border text-[11px] text-muted-foreground">
                <th className="text-left px-3 py-2 font-semibold">F/S/P</th>
                <th className="text-left px-3 py-2 font-semibold">SN</th>
                <th className="text-left px-3 py-2 font-semibold">Estado</th>
                <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">RxPower</th>
                <th className="text-left px-3 py-2 font-semibold">Contrato / Cliente</th>
              </tr>
            </thead>
            <tbody>
              {onus.map((o, i) => {
                const est = ESTADO_VIVO[o.estadoOperativo] ?? ESTADO_VIVO.offline;
                return (
                  <tr key={`${o.sn}-${i}`} className="border-b border-border last:border-0 hover:bg-muted/10">
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">0/{o.slot}/{o.port}{o.onuId != null ? ` · ${o.onuId}` : ''}</td>
                    <td className="px-3 py-2 font-mono text-xs">{o.sn}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border', est.cls)}>
                          <est.Icon className="w-3 h-3" /> {est.label}
                        </span>
                        {o.sinContrato && o.estadoOperativo !== 'no_aprovisionada' && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-fuchsia-700/40 bg-fuchsia-500/10 text-fuchsia-400">
                            Sin contrato
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">
                      {o.rxPowerDbm != null ? `${o.rxPowerDbm} dBm` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {o.numeroContrato ? (
                        <span><span className="font-mono">{o.numeroContrato}</span>{o.cliente ? ` · ${o.cliente}` : ''}</span>
                      ) : (o.cliente ?? '—')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Estado en vivo por puerto (consulta directa a la OLT) ─────
function EstadoVivoPorPuerto({ oltId }: { oltId: string }) {
  const [slot, setSlot] = useState('1');
  const [port, setPort] = useState('');

  const { mutate, data, isPending, error } = useMutation({
    mutationFn: () => oltNativoApi.clasificarOnus(oltId, parseInt(slot), parseInt(port)),
  });

  const onus = data?.onus ?? [];
  const resumen = onus.reduce<Record<string, number>>((acc, o) => {
    acc[o.estadoOperativo] = (acc[o.estadoOperativo] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="rounded-xl border border-border p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Radio className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold">Estado en vivo por puerto</span>
        <div className="flex items-center gap-1.5 ml-auto">
          <input value={slot} onChange={e => setSlot(e.target.value.replace(/\D/g, ''))}
            placeholder="slot" className="w-16 bg-background border border-input rounded-lg px-2 py-1.5 text-xs" />
          <span className="text-muted-foreground">/</span>
          <input value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))}
            placeholder="port" className="w-16 bg-background border border-input rounded-lg px-2 py-1.5 text-xs" />
          <button
            onClick={() => mutate()}
            disabled={isPending || slot === '' || port === ''}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-700/40 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
            Consultar
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5" /> {(error as Error).message}
        </div>
      )}
      {data && !data.success && (
        <div className="flex items-center gap-2 text-xs text-amber-400">
          <AlertCircle className="w-3.5 h-3.5" /> {data.error ?? 'No se pudo consultar la OLT'}
        </div>
      )}

      {data?.success && (
        <>
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            {(Object.keys(ESTADO_VIVO) as OnuClasificada['estadoOperativo'][])
              .filter(k => resumen[k])
              .map(k => (
                <span key={k} className={cn('px-1.5 py-0.5 rounded border font-semibold', ESTADO_VIVO[k].cls)}>
                  {ESTADO_VIVO[k].label}: {resumen[k]}
                </span>
              ))}
            <span className="text-muted-foreground ml-auto">{onus.length} ONUs en 0/{data.slot}/{data.port}</span>
          </div>

          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-[11px] text-muted-foreground">
                  <th className="text-left px-3 py-2 font-semibold">ONU</th>
                  <th className="text-left px-3 py-2 font-semibold">SN</th>
                  <th className="text-left px-3 py-2 font-semibold">Estado</th>
                  <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">RxPower</th>
                  <th className="text-left px-3 py-2 font-semibold">Contrato / Cliente</th>
                </tr>
              </thead>
              <tbody>
                {onus.map((o, i) => {
                  const est = ESTADO_VIVO[o.estadoOperativo] ?? ESTADO_VIVO.offline;
                  return (
                    <tr key={`${o.sn}-${i}`} className="border-b border-border last:border-0 hover:bg-muted/10">
                      <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{o.onuId ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{o.sn ?? '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border', est.cls)}>
                            <est.Icon className="w-3 h-3" /> {est.label}
                          </span>
                          {o.sinContrato && o.estadoOperativo !== 'no_aprovisionada' && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-fuchsia-700/40 bg-fuchsia-500/10 text-fuchsia-400">
                              Sin contrato
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">
                        {o.rxPowerDbm != null ? `${o.rxPowerDbm} dBm` : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {o.numeroContrato ? (
                          <span><span className="font-mono">{o.numeroContrato}</span>{o.cliente ? ` · ${o.cliente}` : ''}</span>
                        ) : (o.cliente ?? '—')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function TabOnus({ oltId }: { oltId: string }) {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['olt-ftth-registros', oltId, page],
    queryFn:  () => oltNativoApi.getFtthRegistros(oltId, page, PAGE_SIZE),
    enabled:  !!oltId,
    placeholderData: (prev) => prev,
  });

  const total      = data?.total ?? 0;
  const items      = data?.data  ?? [];
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <InventarioSnapshot oltId={oltId} />
      <EstadoVivoPorPuerto oltId={oltId} />

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Users className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Sin ONUs aprovisionadas (registradas) en esta OLT</p>
        </div>
      ) : (
      <div className="space-y-3">
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">SN</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Slot/Port</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden sm:table-cell">ONU ID</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">VLAN</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Estado</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden xl:table-cell">Run State</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden xl:table-cell">Uptime</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden lg:table-cell">Contrato ID</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                <td className="px-4 py-2.5 font-mono text-xs text-foreground">{r.sn}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                  {r.slot}/{r.port}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">{r.onuId}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{r.vlan}</td>
                <td className="px-4 py-2.5">
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize',
                    ESTADO_COLOR[r.estado] ?? 'bg-muted text-muted-foreground',
                  )}>
                    {r.estado}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden xl:table-cell">
                  {r.runState ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground hidden xl:table-cell">
                  {fmtUptime(r.uptimeSeconds) ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground hidden lg:table-cell">
                  {r.contratoId ? `…${r.contratoId.slice(-8)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{total} ONUs</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1 rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>Página {page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  );
}
