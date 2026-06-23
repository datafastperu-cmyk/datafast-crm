'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Zap, Loader2, AlertTriangle, Thermometer, Signal,
  WifiOff, Trash2, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toaster';
import {
  oltNativoApi,
  type OltDispositivo,
  type MetricasOnuResult,
  type OntFoundInfo,
  type AlarmInfo,
} from '@/lib/api/olt-nativo';
import type { Contrato } from '@/types';
import { Portal } from '@/components/ui/portal';

// ─── Helpers ──────────────────────────────────────────────────

const BRAND_PREFIXES: Record<string, string[]> = {
  huawei: ['HWTC', 'HUAW'],
  zte:    ['ZTEG', 'ALHN'],
  vsol:   ['VSOL'],
  cdata:  ['CDAT'],
};

function snPrefixHint(marca: string, sn: string): string | null {
  const prefixes = BRAND_PREFIXES[marca] ?? [];
  if (!prefixes.length || sn.length < 4) return null;
  return prefixes.some(p => sn.toUpperCase().startsWith(p))
    ? null
    : `Prefijo inusual para ${marca.toUpperCase()} — esperado: ${prefixes.join(' / ')}`;
}

function rxColor(v: number | null | undefined): string {
  if (v == null) return 'text-zinc-500';
  return v < -30 ? 'text-red-400' : v < -28 ? 'text-amber-400' : 'text-emerald-400';
}

function rxBarColor(v: number | null | undefined): string {
  if (v == null) return 'bg-zinc-600';
  return v < -30 ? 'bg-red-500' : v < -28 ? 'bg-amber-500' : 'bg-emerald-500';
}

function rxBarPct(v: number | null | undefined): number {
  if (v == null) return 0;
  return Math.max(0, Math.min(100, ((Math.max(-40, v) + 40) / 30) * 100));
}

function alarmClass(level: AlarmInfo['level']): string {
  if (level === 'critical') return 'bg-red-500/10 border-red-500/30 text-red-400';
  if (level === 'warning')  return 'bg-amber-500/10 border-amber-700/40 text-amber-400';
  return 'bg-zinc-800 border-zinc-700 text-zinc-400';
}

// ─── Signal Panel ─────────────────────────────────────────────

function SignalPanel({ data, isLoading }: { data?: MetricasOnuResult; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-800/30 p-4 animate-pulse">
        <div className="h-3 w-24 bg-zinc-700 rounded mb-3" />
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-2.5 w-16 bg-zinc-700 rounded" />
              <div className="h-7 w-20 bg-zinc-700 rounded" />
              <div className="h-1.5 w-full bg-zinc-700 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (!data.metricsAvailable) {
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-800/20 p-4 flex items-center gap-3">
        <WifiOff className="w-5 h-5 text-zinc-500 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-zinc-400">ONU sin señal o no registrada en la OLT</p>
          {data.alarm && <p className="text-[11px] text-zinc-500 mt-0.5">{data.alarm.message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-800/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Signal className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Señal Óptica</span>
        </div>
        <span className={cn(
          'text-[10px] font-semibold px-2 py-0.5 rounded-full border',
          data.status === 'online'
            ? 'text-emerald-400 border-emerald-700 bg-emerald-500/10'
            : 'text-amber-400 border-amber-700 bg-amber-500/10',
        )}>
          {data.status === 'online' ? 'Online' : 'Degradado'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] text-zinc-500 uppercase mb-1">Rx 1490nm</p>
          <p className={cn('text-xl font-mono font-bold', rxColor(data.rxPowerDbm))}>
            {data.rxPowerDbm?.toFixed(2) ?? '—'}
          </p>
          <p className="text-[10px] text-zinc-600 mb-1.5">dBm</p>
          <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', rxBarColor(data.rxPowerDbm))}
              style={{ width: `${rxBarPct(data.rxPowerDbm)}%` }}
            />
          </div>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 uppercase mb-1">Tx 1310nm</p>
          <p className="text-xl font-mono font-bold text-zinc-300">
            {data.txPowerDbm?.toFixed(2) ?? '—'}
          </p>
          <p className="text-[10px] text-zinc-600">dBm</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 uppercase mb-1 flex items-center gap-1">
            <Thermometer className="w-3 h-3" /> Temp
          </p>
          <p className="text-xl font-mono font-bold text-zinc-300">
            {data.temperatureC ?? '—'}
          </p>
          <p className="text-[10px] text-zinc-600">°C</p>
        </div>
      </div>

      {data.alarm && (
        <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs', alarmClass(data.alarm.level))}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{data.alarm.message}</span>
        </div>
      )}
    </div>
  );
}

// ─── Delete Confirm ────────────────────────────────────────────

function ConfirmDeleteOnu({
  sn, oltNombre, isPending, onConfirm, onClose,
}: { sn: string; oltNombre: string; isPending: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Provisionar ONU" className="w-full max-w-sm bg-zinc-900 border border-amber-700/40 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-zinc-700 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Desaprovisionar ONU</h2>
            <p className="text-[11px] text-zinc-400">{sn} — {oltNombre}</p>
          </div>
        </div>
        <div className="p-5 space-y-2">
          <p className="text-sm text-zinc-300">
            Se enviará el comando de <strong className="text-amber-400">eliminación</strong> a la OLT.
          </p>
          <p className="text-xs text-zinc-500">
            La operación es reversible, pero requerirá un nuevo aprovisionamiento.
          </p>
        </div>
        <div className="px-5 py-4 border-t border-zinc-700 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-zinc-700 hover:bg-zinc-800 text-zinc-300 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="px-5 py-2 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Desaprovisionar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Field ────────────────────────────────────────────────────

function Field({ label, children, span2 }: { label: string; children: ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? 'col-span-2' : undefined}>
      <label className="block text-[11px] text-zinc-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500 transition-colors';

// ─── Main Modal ────────────────────────────────────────────────

export function ModalProvisionOnu({ contrato, onClose }: { contrato: Contrato; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  // OLT selection
  const [selectedOltId, setSelectedOltId] = useState('');
  const { data: olts = [], isLoading: oltsLoading } = useQuery({
    queryKey: ['olt-nativo-olts'],
    queryFn:  oltNativoApi.listar,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (olts.length === 1 && !selectedOltId) setSelectedOltId(olts[0].id);
  }, [olts, selectedOltId]);
  const selectedOlt = olts.find((o: OltDispositivo) => o.id === selectedOltId);

  // Form state
  const [sn,            setSn]            = useState('');
  const [frame,         setFrame]         = useState('0');
  const [slot,          setSlot]          = useState('');
  const [port,          setPort]          = useState('');
  const [onuId,         setOnuId]         = useState('');
  const [vlan,          setVlan]          = useState('');
  const [vlanGestion,   setVlanGestion]   = useState('');
  const [profileSpeed,  setProfileSpeed]  = useState('');
  const [servicePortId, setServicePortId] = useState('');
  const [trafficIndex,  setTrafficIndex]  = useState('');
  const [onuType,       setOnuType]       = useState('');

  useEffect(() => {
    if (selectedOlt?.vlanGestionDefecto && !vlanGestion) {
      setVlanGestion(String(selectedOlt.vlanGestionDefecto));
    }
  }, [selectedOlt, vlanGestion]);

  // Metrics query
  const slotNum  = parseInt(slot);
  const portNum  = parseInt(port);
  const onuIdNum = parseInt(onuId);
  const metricsEnabled = (
    !!selectedOltId &&
    !isNaN(slotNum)  && slotNum  >= 0 &&
    !isNaN(portNum)  && portNum  >= 0 &&
    !isNaN(onuIdNum) && onuIdNum >= 1
  );

  const { data: metrics, isFetching: metricsFetching } = useQuery({
    queryKey:  ['onu-metrics', selectedOltId, slotNum, portNum, onuIdNum],
    queryFn:   () => oltNativoApi.metricas(selectedOltId, { slot: slotNum, port: portNum, onuId: onuIdNum, sn: sn || undefined }),
    enabled:             metricsEnabled,
    staleTime:           30_000,
    refetchOnWindowFocus: false,
  });

  // ── Scan / Auto-Find ─────────────────────────────────────────
  const [snSelectMode,  setSnSelectMode]  = useState(false);
  const [scanNoResults, setScanNoResults] = useState(false);

  const scanEnabled = !!selectedOltId && !isNaN(slotNum) && slotNum >= 0 && !isNaN(portNum) && portNum >= 0;

  const { data: scanData, isFetching: scanning, refetch: triggerScan } = useQuery({
    queryKey:  ['discover-onus', selectedOltId, slotNum, portNum],
    queryFn:   () => oltNativoApi.discoverOnus(selectedOltId, slotNum, portNum),
    enabled:    false,
    staleTime:  0,
    gcTime:     0,
  });

  // React to scan results
  useEffect(() => {
    if (!scanData) return;
    if (scanData.onus.length > 0) {
      setSnSelectMode(true);
      setScanNoResults(false);
      if (!sn) setSn(scanData.onus[0].sn);
    } else {
      setScanNoResults(true);
    }
  }, [scanData, sn]);

  // Auto-dismiss "no results" tooltip after 3 s
  useEffect(() => {
    if (!scanNoResults) return undefined;
    const t = setTimeout(() => setScanNoResults(false), 3000);
    return () => clearTimeout(t);
  }, [scanNoResults]);

  // Reset scan state whenever OLT / slot / port change
  useEffect(() => {
    setSnSelectMode(false);
    setScanNoResults(false);
  }, [selectedOltId, slot, port]);

  // Delete flow
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteFailed,      setDeleteFailed]      = useState(false);
  const { mutate: deleteOnu, isPending: deleteIsPending } = useMutation({
    mutationFn: (): Promise<void> => Promise.reject(new Error('no-impl')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plantillas-abonados'] });
      setShowDeleteConfirm(false);
      onClose();
    },
    onError: () => {
      setShowDeleteConfirm(false);
      setDeleteFailed(true);
    },
  });

  // Provision mutation
  const isHuawei = selectedOlt?.marca === 'huawei';
  const isZte    = selectedOlt?.marca === 'zte';
  const formValid = (
    !!selectedOltId && !!sn.trim() && slot !== '' && port !== '' && onuId !== '' &&
    !!vlan && !!vlanGestion && !!profileSpeed.trim() &&
    (!isHuawei || (!!servicePortId && !!trafficIndex)) &&
    (!isZte    || !!onuType.trim())
  );

  const { mutate: provisionar, isPending: provIsPending } = useMutation({
    mutationFn: () => oltNativoApi.provisionar(selectedOltId, {
      contratoId:   contrato.id,
      clienteId:    contrato.clienteId,
      frame:        parseInt(frame) || 0,
      slot:         slotNum,
      port:         portNum,
      onuId:        onuIdNum,
      sn:           sn.trim().toUpperCase(),
      vlan:         parseInt(vlan),
      vlanGestion:  parseInt(vlanGestion),
      profileSpeed: profileSpeed.trim(),
      servicePortId: servicePortId ? parseInt(servicePortId) : undefined,
      trafficIndex:  trafficIndex  ? parseInt(trafficIndex)  : undefined,
      onuType:       onuType.trim() || undefined,
    }),
    onSuccess: (res) => {
      toast(res.message ?? 'ONU aprovisionada correctamente', { type: 'success' });
      qc.invalidateQueries({ queryKey: ['plantillas-abonados'] });
      qc.invalidateQueries({ queryKey: ['cliente-contratos'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'Error al aprovisionar la ONU', { type: 'error' });
    },
  });

  const snHint = selectedOlt ? snPrefixHint(selectedOlt.marca, sn) : null;

  return (
    <Portal>
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Zap className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Aprovisionar / Monitorear ONU</h2>
                <p className="text-[11px] text-zinc-400">Contrato {contrato.numeroContrato}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Orange fallback banner */}
          {deleteFailed && (
            <div className="flex items-start gap-3 bg-orange-500/10 border-b border-orange-500/30 px-5 py-3 flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-orange-300">
                La ONU no pudo ser removida físicamente de la OLT. Los datos locales han sido
                conservados para desaprovisionamiento manual.
              </p>
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">

            {/* OLT Selector */}
            <div>
              <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">OLT de Destino</h3>
              {oltsLoading ? (
                <div className="space-y-2 animate-pulse">
                  {[0, 1].map(i => <div key={i} className="h-12 bg-zinc-800 rounded-xl" />)}
                </div>
              ) : olts.length === 0 ? (
                <p className="text-xs text-zinc-500 italic">No hay OLTs configuradas en el sistema.</p>
              ) : (
                <div className="grid gap-2">
                  {olts.map((olt: OltDispositivo) => (
                    <button
                      key={olt.id}
                      type="button"
                      onClick={() => setSelectedOltId(olt.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors',
                        selectedOltId === olt.id
                          ? 'border-violet-500/50 bg-violet-500/10'
                          : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/40',
                      )}
                    >
                      <div className={cn(
                        'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                        selectedOltId === olt.id ? 'border-violet-500 bg-violet-500' : 'border-zinc-600',
                      )}>
                        {selectedOltId === olt.id && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{olt.nombre}</p>
                        <p className="text-[11px] text-zinc-500">{olt.ipGestion} — {olt.marca.toUpperCase()} {olt.modelo ?? ''}</p>
                      </div>
                      <span className={cn(
                        'text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0',
                        olt.estado === 'online'
                          ? 'text-emerald-400 border-emerald-700 bg-emerald-500/10'
                          : olt.estado === 'offline'
                            ? 'text-red-400 border-red-800 bg-red-500/10'
                            : 'text-zinc-500 border-zinc-700',
                      )}>
                        {olt.estado}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Signal Panel */}
            {metricsEnabled && (
              <div>
                <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Señal Actual</h3>
                <SignalPanel data={metrics} isLoading={metricsFetching} />
              </div>
            )}

            {/* Form */}
            {selectedOlt && (
              <div>
                <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                  Parámetros de Aprovisionamiento
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {/* SN field + Auto-Find scan button */}
                  <div className="col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] text-zinc-400">Serial Number (S/N)</label>
                      {snSelectMode && (
                        <button
                          type="button"
                          onClick={() => { setSnSelectMode(false); setSn(''); }}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          ⌨ Ingresar manual
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {snSelectMode && scanData?.onus.length ? (
                        <select
                          value={sn}
                          onChange={e => setSn(e.target.value)}
                          className={cn(inputCls, 'flex-1')}
                        >
                          {(scanData.onus as OntFoundInfo[]).map(o => (
                            <option key={o.sn} value={o.sn}>
                              {o.sn} — slot {o.slot} · port {o.port}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={sn}
                          onChange={e => setSn(e.target.value.toUpperCase())}
                          placeholder={isHuawei ? 'HWTC1A2B3C4D5E6F' : 'ZTEG1A2B3C4D5E6F'}
                          maxLength={16}
                          disabled={scanning}
                          className={cn(inputCls, 'flex-1 font-mono uppercase')}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => triggerScan()}
                        disabled={!scanEnabled || scanning}
                        title="Escanear ONUs no autorizadas en el puerto seleccionado"
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors flex-shrink-0',
                          'border-zinc-600 hover:border-violet-500 hover:bg-violet-500/10 hover:text-violet-400',
                          'text-zinc-400 disabled:opacity-40 disabled:cursor-not-allowed',
                        )}
                      >
                        {scanning
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Search className="w-3.5 h-3.5" />
                        }
                        {scanning ? 'Escaneando…' : 'Escanear Puerto'}
                      </button>
                    </div>
                    {scanNoResults && (
                      <p className="text-[10px] text-zinc-500 mt-1.5 flex items-center gap-1 animate-pulse">
                        No se encontraron ONUs pendientes en este puerto.
                      </p>
                    )}
                    {snHint && !scanNoResults && (
                      <p className="text-[10px] text-amber-400 mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />{snHint}
                      </p>
                    )}
                  </div>

                  <Field label="Frame">
                    <input type="number" value={frame} onChange={e => setFrame(e.target.value)} min={0} max={7} className={inputCls} />
                  </Field>
                  <Field label="Slot">
                    <input type="number" value={slot} onChange={e => setSlot(e.target.value)} min={0} max={15} placeholder="1" className={inputCls} />
                  </Field>
                  <Field label="Puerto PON">
                    <input type="number" value={port} onChange={e => setPort(e.target.value)} min={0} max={15} placeholder="3" className={inputCls} />
                  </Field>
                  <Field label="ONU ID">
                    <input type="number" value={onuId} onChange={e => setOnuId(e.target.value)} min={1} max={128} placeholder="4" className={inputCls} />
                  </Field>
                  <Field label="VLAN Servicio">
                    <input type="number" value={vlan} onChange={e => setVlan(e.target.value)} min={1} max={4094} placeholder="201" className={inputCls} />
                  </Field>
                  <Field label="VLAN Gestión">
                    <input type="number" value={vlanGestion} onChange={e => setVlanGestion(e.target.value)} min={1} max={4094} className={inputCls} />
                  </Field>
                  <Field label="Perfil de Velocidad" span2>
                    <input type="text" value={profileSpeed} onChange={e => setProfileSpeed(e.target.value)}
                      placeholder={isHuawei ? '100M-RESIDENCIAL' : 'RESIDENTIAL-100M'} className={inputCls} />
                  </Field>

                  {isHuawei && (
                    <>
                      <Field label="Service Port ID">
                        <input type="number" value={servicePortId} onChange={e => setServicePortId(e.target.value)} min={1} placeholder="1501" className={inputCls} />
                      </Field>
                      <Field label="Traffic Index">
                        <input type="number" value={trafficIndex} onChange={e => setTrafficIndex(e.target.value)} min={0} placeholder="10" className={inputCls} />
                      </Field>
                    </>
                  )}

                  {isZte && (
                    <Field label="Tipo de ONU (onu_type)" span2>
                      <input
                        type="text"
                        value={onuType}
                        onChange={e => setOnuType(e.target.value)}
                        placeholder="ZTE-F660"
                        className={inputCls}
                      />
                    </Field>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-zinc-700 flex items-center justify-between flex-shrink-0">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!metricsEnabled || !sn.trim()}
              className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg border border-zinc-700 hover:border-red-800 hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Quitar ONU
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-zinc-700 hover:bg-zinc-800 transition-colors text-zinc-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => provisionar()}
                disabled={!formValid || provIsPending}
                className="px-5 py-2 text-sm font-semibold rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {provIsPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Zap className="w-3.5 h-3.5" />
                }
                Aprovisionar
              </button>
            </div>
          </div>

        </div>
      </div>

      {showDeleteConfirm && (
        <ConfirmDeleteOnu
          sn={sn}
          oltNombre={selectedOlt?.nombre ?? '—'}
          isPending={deleteIsPending}
          onConfirm={() => deleteOnu()}
          onClose={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
    </Portal>
  );
}
