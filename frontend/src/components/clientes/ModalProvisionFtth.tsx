'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Zap, Loader2, AlertTriangle, Search, CheckCircle2,
  RefreshCw, WifiOff, Hash, Trash2, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toaster';
import {
  oltNativoApi,
  type OltDispositivo,
  type OntFoundInfo,
  type FtthOnuRegistro,
  type FtthOnuEstado,
  type OltPerfilesResult,
} from '@/lib/api/olt-nativo';
import type { Contrato } from '@/types';
import { Portal } from '@/components/ui/portal';

// ─── Estado badge ─────────────────────────────────────────────

const ESTADO_META: Record<FtthOnuEstado, { label: string; cls: string }> = {
  pendiente:         { label: 'Pendiente',          cls: 'text-muted-foreground border-border' },
  gpon_registrado:   { label: 'GPON registrada',    cls: 'text-blue-600 dark:text-blue-400 border-blue-700 bg-blue-500/10' },
  wan_inyectado:     { label: 'WAN inyectada',      cls: 'text-cyan-600 dark:text-cyan-400 border-cyan-700 bg-cyan-500/10' },
  activo:            { label: 'Activo',              cls: 'text-emerald-600 dark:text-emerald-400 border-emerald-700 bg-emerald-500/10' },
  fallido_gpon:      { label: 'Fallido GPON',       cls: 'text-red-600 dark:text-red-400 border-red-800 bg-red-500/10' },
  fallido_wan:       { label: 'Fallido WAN',        cls: 'text-amber-600 dark:text-amber-400 border-amber-700 bg-amber-500/10' },
  desaprovisionando: { label: 'Desaprovisionando',  cls: 'text-muted-foreground border-border' },
};

function EstadoBadge({ estado }: { estado: FtthOnuEstado }) {
  const m = ESTADO_META[estado] ?? { label: estado, cls: 'text-muted-foreground border-border' };
  return (
    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', m.cls)}>
      {m.label}
    </span>
  );
}

// ─── Estado panel ─────────────────────────────────────────────

function EstadoPanel({ registro, onReinject, isReinjectPending, onDesaprovisionar, isDesaprovisionandoPending }: {
  registro: FtthOnuRegistro;
  onReinject: () => void;
  isReinjectPending: boolean;
  onDesaprovisionar: () => void;
  isDesaprovisionandoPending: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado ONU FTTH</span>
        <EstadoBadge estado={registro.estado} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Serial Number</span>
        <span className="font-mono font-semibold">{registro.sn}</span>
        <span className="text-muted-foreground">Posición</span>
        <span className="font-mono">frame {registro.frame} · slot {registro.slot} · port {registro.port} · ONU {registro.onuId}</span>
        <span className="text-muted-foreground">VLAN</span>
        <span className="font-mono">{registro.vlan}</span>
        <span className="text-muted-foreground">Intentos GPON</span>
        <span>{registro.intentosGpon}</span>
        <span className="text-muted-foreground">Intentos WAN</span>
        <span>{registro.intentosWan}</span>
      </div>
      {registro.ultimoError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{registro.ultimoError}</span>
        </div>
      )}
      {registro.estado === 'fallido_wan' && (
        <button
          onClick={onReinject}
          disabled={isReinjectPending}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-cyan-700/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 text-xs font-semibold hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
        >
          {isReinjectPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Re-inyectar WAN PPPoE
        </button>
      )}
      {(registro.estado === 'activo' || registro.estado === 'gpon_registrado' || registro.estado === 'wan_inyectado') && (
        <button
          onClick={onDesaprovisionar}
          disabled={isDesaprovisionandoPending}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-red-700/50 bg-red-500/5 text-red-700 dark:text-red-400 text-xs font-semibold hover:bg-red-500/15 transition-colors disabled:opacity-50"
        >
          {isDesaprovisionandoPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          {isDesaprovisionandoPending ? 'Desaprovisionando…' : 'Desaprovisionar ONU'}
        </button>
      )}
    </div>
  );
}

// ─── Field ────────────────────────────────────────────────────

function Field({ label, children, span2 }: { label: string; children: ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? 'col-span-2' : undefined}>
      <label className="block text-[11px] text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors';

// ─── Main Modal ────────────────────────────────────────────────

export function ModalProvisionFtth({ contrato, onClose }: { contrato: Contrato; onClose: () => void }) {
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

  // Estado existente
  const { data: estadoExistente, isLoading: estadoLoading } = useQuery({
    queryKey:  ['ftth-estado', contrato.id],
    queryFn:   () => oltNativoApi.ftthEstado(contrato.id),
    staleTime: 0,
  });

  // Form state
  const [sn,            setSn]            = useState('');
  const [frame,         setFrame]         = useState('0');
  const [slot,          setSlot]          = useState('');
  const [port,          setPort]          = useState('');
  const [vlan,          setVlan]          = useState('');
  const [lineprofileId, setLineprofileId] = useState('');
  const [srvprofileId,  setSrvprofileId]  = useState('');
  const [description,   setDescription]  = useState('');

  // Perfiles OLT (Phase 4)
  const { data: perfiles } = useQuery<OltPerfilesResult>({
    queryKey:  ['olt-perfiles', selectedOltId],
    queryFn:   () => oltNativoApi.listarPerfiles(selectedOltId),
    enabled:   !!selectedOltId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const slotNum  = parseInt(slot);
  const portNum  = parseInt(port);

  // Auto-rellenar desde estado existente si se quiere re-provisionar
  useEffect(() => {
    const r = estadoExistente;
    if (!r) return;
    setSn(r.sn);
    setFrame(String(r.frame));
    setSlot(String(r.slot));
    setPort(String(r.port));
    setVlan(String(r.vlan));
    if (r.lineprofileId) setLineprofileId(String(r.lineprofileId));
    if (r.srvprofileId)  setSrvprofileId(String(r.srvprofileId));
  }, [estadoExistente]);

  // Scan ONUs
  const [snSelectMode,  setSnSelectMode]  = useState(false);
  const [scanNoResults, setScanNoResults] = useState(false);
  const scanEnabled = !!selectedOltId;

  const { data: scanData, isFetching: scanning, refetch: triggerScan } = useQuery({
    queryKey:  ['discover-onus-ftth', selectedOltId],
    queryFn:   () => oltNativoApi.discoverOnus(selectedOltId),
    enabled:              false,
    staleTime:            0,
    gcTime:               0,
    retry:                false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!scanData) return;
    if (scanData.onus.length > 0) {
      setSnSelectMode(true);
      setScanNoResults(false);
      const first = scanData.onus[0];
      setSn(first.sn);
      setSlot(String(first.slot));
      setPort(String(first.port));
    } else {
      setScanNoResults(true);
    }
  }, [scanData]);

  useEffect(() => {
    if (!scanNoResults) return undefined;
    const t = setTimeout(() => setScanNoResults(false), 3000);
    return () => clearTimeout(t);
  }, [scanNoResults]);

  useEffect(() => {
    setSnSelectMode(false);
    setScanNoResults(false);
  }, [selectedOltId]);

  // Form validation
  const formValid = (
    !!selectedOltId && !!sn.trim() && slot !== '' && port !== '' &&
    !!vlan && !!lineprofileId && !!srvprofileId
  );

  // Re-inyectar WAN mutation — declarado antes de usarlo en desaprovisionar callback
  const { mutate: reinjectWan, isPending: reinjectPending } = useMutation({
    mutationFn: () => oltNativoApi.ftthReinjectWan(selectedOltId, contrato.id),
    onSuccess: (res) => {
      if (res.estado === 'activo') {
        toast('WAN PPPoE re-inyectada correctamente', { type: 'success' });
        qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
        qc.invalidateQueries({ queryKey: ['cliente-contratos'] });
        onClose();
      } else {
        toast(res.error ?? 'Re-inyección falló', { type: 'error' });
        qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'Error al re-inyectar WAN', { type: 'error' });
    },
  });

  // Desaprovisionar mutation
  const { mutate: desaprovisionar, isPending: desaprovisionandoPending } = useMutation({
    mutationFn: () => oltNativoApi.ftthDesaprovisionar(selectedOltId || (estadoExistente?.oltId ?? ''), contrato.id),
    onSuccess: (res) => {
      if (res.exitoso) {
        toast('ONU desaprovisionada correctamente', { type: 'success' });
        qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
        qc.invalidateQueries({ queryKey: ['cliente-contratos'] });
        onClose();
      } else {
        toast(res.error ?? res.mensaje ?? 'No se pudo desaprovisionar la ONU', { type: 'error' });
        qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'Error al desaprovisionar la ONU', { type: 'error' });
    },
  });

  // Provision mutation
  const { mutate: provisionar, isPending: provIsPending } = useMutation({
    mutationFn: () => oltNativoApi.ftthProvision(selectedOltId, {
      contratoId:    contrato.id,
      frame:         parseInt(frame) || 0,
      slot:          slotNum,
      port:          portNum,
      sn:            sn.trim().toUpperCase(),
      vlan:          parseInt(vlan),
      lineprofileId: parseInt(lineprofileId),
      srvprofileId:  parseInt(srvprofileId),
      description:   description.trim() || undefined,
    }),
    onSuccess: (res) => {
      if (res.estado === 'activo') {
        toast('ONU FTTH aprovisionada correctamente — GPON + WAN OK', { type: 'success' });
        qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
        qc.invalidateQueries({ queryKey: ['cliente-contratos'] });
        onClose();
      } else {
        toast(res.mensaje ?? `Estado: ${res.estado}`, {
          type: res.estado.startsWith('fallido') ? 'error' : 'warning',
        });
        qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'Error al aprovisionar la ONU FTTH', { type: 'error' });
    },
  });


  const yaActivo = estadoExistente?.estado === 'activo';

  return (
    <Portal>
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Zap className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground">Aprovisionar ONU FTTH</h2>
                <p className="text-[11px] text-muted-foreground">Contrato {contrato.numeroContrato}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">

            {/* Estado existente */}
            {estadoLoading ? (
              <div className="h-20 bg-muted/30 rounded-xl animate-pulse" />
            ) : estadoExistente ? (
              <div>
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Estado Actual</h3>
                <EstadoPanel
                  registro={estadoExistente}
                  onReinject={() => reinjectWan()}
                  isReinjectPending={reinjectPending}
                  onDesaprovisionar={() => desaprovisionar()}
                  isDesaprovisionandoPending={desaprovisionandoPending}
                />
                {yaActivo && (
                  <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-700/30">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      La ONU ya está aprovisionada y activa. Para reaprovisionar, primero ejecuta un rollback desde el panel de OLT.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            {/* Selector OLT */}
            {!yaActivo && (
              <div>
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">OLT de Destino</h3>
                {oltsLoading ? (
                  <div className="space-y-2 animate-pulse">{[0, 1].map(i => <div key={i} className="h-12 bg-muted/40 rounded-xl" />)}</div>
                ) : olts.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <WifiOff className="w-4 h-4" />
                    No hay OLTs configuradas.
                  </div>
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
                            ? 'border-emerald-500/50 bg-emerald-500/10'
                            : 'border-border hover:border-input hover:bg-muted/40',
                        )}
                      >
                        <div className={cn(
                          'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                          selectedOltId === olt.id ? 'border-emerald-500 bg-emerald-500' : 'border-muted-foreground/30',
                        )}>
                          {selectedOltId === olt.id && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">{olt.nombre}</p>
                          <p className="text-[11px] text-muted-foreground">{olt.ipGestion} — {olt.marca.toUpperCase()}</p>
                        </div>
                        <span className={cn(
                          'text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0',
                          olt.estado === 'online'
                            ? 'text-emerald-600 dark:text-emerald-400 border-emerald-700 bg-emerald-500/10'
                            : 'text-red-600 dark:text-red-400 border-red-800 bg-red-500/10',
                        )}>
                          {olt.estado}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Formulario FTTH */}
            {selectedOlt && !yaActivo && (
              <div>
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Parámetros GPON
                </h3>
                <div className="grid grid-cols-2 gap-3">

                  {/* SN con scan */}
                  <div className="col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] text-muted-foreground">Serial Number (S/N)</label>
                      {snSelectMode && (
                        <button type="button" onClick={() => { setSnSelectMode(false); setSn(''); }}
                          className="text-[10px] text-muted-foreground hover:text-foreground">
                          ⌨ Ingresar manual
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {snSelectMode && scanData?.onus.length ? (
                        <select value={sn} onChange={e => {
                          const o = (scanData.onus as OntFoundInfo[]).find(x => x.sn === e.target.value);
                          if (o) { setSn(o.sn); setSlot(String(o.slot)); setPort(String(o.port)); setSnSelectMode(true); }
                        }} className={cn(inputCls, 'flex-1')}>
                          {(scanData.onus as OntFoundInfo[]).map(o => (
                            <option key={o.sn} value={o.sn}>{o.sn} — slot {o.slot} · port {o.port}</option>
                          ))}
                        </select>
                      ) : (
                        <input type="text" value={sn} onChange={e => setSn(e.target.value.toUpperCase())}
                          placeholder="HWTC1A2B3C4D5E6F" maxLength={16} disabled={scanning}
                          className={cn(inputCls, 'flex-1 font-mono uppercase')} />
                      )}
                      <button type="button" onClick={() => triggerScan()} disabled={!scanEnabled || scanning}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors flex-shrink-0',
                          'border-input hover:border-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400',
                          'text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed',
                        )}>
                        {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                        {scanning ? 'Escaneando…' : 'Escanear'}
                      </button>
                    </div>
                    {scanNoResults && (
                      <p className="text-[10px] text-muted-foreground mt-1.5 animate-pulse">
                        No se encontraron ONUs pendientes en este puerto.
                      </p>
                    )}
                  </div>

                  <Field label="Frame">
                    <input type="number" value={frame} onChange={e => setFrame(e.target.value)} min={0} max={7} className={inputCls} />
                  </Field>
                  <Field label="Slot">
                    <input type="number" value={slot} onChange={e => setSlot(e.target.value)} min={0} max={15} placeholder="1"
                      readOnly={snSelectMode} className={cn(inputCls, snSelectMode && 'opacity-60 cursor-not-allowed bg-muted')} />
                  </Field>
                  <Field label="Puerto PON">
                    <input type="number" value={port} onChange={e => setPort(e.target.value)} min={0} max={15} placeholder="3"
                      readOnly={snSelectMode} className={cn(inputCls, snSelectMode && 'opacity-60 cursor-not-allowed bg-muted')} />
                  </Field>
                  <Field label="VLAN Servicio">
                    <input type="number" value={vlan} onChange={e => setVlan(e.target.value)} min={1} max={4094} placeholder="201" className={inputCls} />
                  </Field>
                  <Field label="Lineprofile ID">
                    {perfiles?.lineprofiles?.length ? (
                      <div className="relative">
                        <select value={lineprofileId} onChange={e => setLineprofileId(e.target.value)}
                          className={cn(inputCls, 'appearance-none pr-8')}>
                          <option value="">— Seleccionar —</option>
                          {perfiles.lineprofiles.map(p => (
                            <option key={p.profile_id} value={p.profile_id}>{p.profile_id} — {p.name}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      </div>
                    ) : (
                      <input type="number" value={lineprofileId} onChange={e => setLineprofileId(e.target.value)} min={1} placeholder="2" className={inputCls} />
                    )}
                  </Field>
                  <Field label="Srvprofile ID">
                    {perfiles?.srvprofiles?.length ? (
                      <div className="relative">
                        <select value={srvprofileId} onChange={e => setSrvprofileId(e.target.value)}
                          className={cn(inputCls, 'appearance-none pr-8')}>
                          <option value="">— Seleccionar —</option>
                          {perfiles.srvprofiles.map(p => (
                            <option key={p.profile_id} value={p.profile_id}>{p.profile_id} — {p.name}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      </div>
                    ) : (
                      <input type="number" value={srvprofileId} onChange={e => setSrvprofileId(e.target.value)} min={1} placeholder="1" className={inputCls} />
                    )}
                  </Field>
                  <Field label="Descripción (opcional)" span2>
                    <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                      maxLength={64} placeholder="Cliente Residencial FTTH" className={inputCls} />
                  </Field>
                </div>

                <div className="mt-1 space-y-1.5">
                  <div className="flex items-center gap-2 rounded-lg border border-violet-700/30 bg-violet-500/5 px-3 py-2 text-[11px] text-violet-700 dark:text-violet-300">
                    <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Service Port ID se asigna automáticamente del pool configurado en la OLT.</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-violet-700/30 bg-violet-500/5 px-3 py-2 text-[11px] text-violet-700 dark:text-violet-300">
                    <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>ONU ID se asigna automáticamente del pool por puerto PON (1–128).</span>
                  </div>
                </div>

                <div className="mt-2 flex items-start gap-2 rounded-lg border border-blue-700/30 bg-blue-500/5 px-3 py-2 text-[11px] text-blue-700 dark:text-blue-300">
                  <Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    Este proceso tarda ~2 min: registra la ONU en la OLT (GPON), espera que esté online,
                    luego inyecta las credenciales PPPoE <strong>{(contrato as any).usuarioPppoe ?? '—'}</strong> vía OMCI.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {!yaActivo && (
            <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-3 flex-shrink-0">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors text-foreground/80">
                Cancelar
              </button>
              <button type="button" onClick={() => provisionar()}
                disabled={!formValid || provIsPending || !selectedOltId}
                className="btn-primary px-5 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
                {provIsPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Aprovisionando…</>
                  : <><Zap className="w-3.5 h-3.5" /> Aprovisionar FTTH</>
                }
              </button>
            </div>
          )}
          {yaActivo && (
            <div className="px-5 py-4 border-t border-border flex justify-end flex-shrink-0">
              <button onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors text-foreground/80">
                Cerrar
              </button>
            </div>
          )}
        </div>
      </div>
    </>
    </Portal>
  );
}
