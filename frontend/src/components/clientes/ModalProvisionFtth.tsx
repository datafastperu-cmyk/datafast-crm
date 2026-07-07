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
  type OltVlan,
  type OltTrafficTable,
} from '@/lib/api/olt-nativo';
import type { Contrato } from '@/types';
import { Portal } from '@/components/ui/portal';

// ─── Estado badge ─────────────────────────────────────────────

const ESTADO_META: Record<FtthOnuEstado, { label: string; cls: string }> = {
  pendiente:             { label: 'Pendiente',            cls: 'text-muted-foreground border-border' },
  gpon_registrado:       { label: 'GPON registrada',      cls: 'text-blue-600 dark:text-blue-400 border-blue-700 bg-blue-500/10' },
  wan_inyectado:         { label: 'WAN inyectada',        cls: 'text-cyan-600 dark:text-cyan-400 border-cyan-700 bg-cyan-500/10' },
  activo:                { label: 'Activo',                cls: 'text-emerald-600 dark:text-emerald-400 border-emerald-700 bg-emerald-500/10' },
  fallido_gpon:          { label: 'Fallido GPON',         cls: 'text-red-600 dark:text-red-400 border-red-800 bg-red-500/10' },
  fallido_wan:           { label: 'Fallido WAN',          cls: 'text-amber-600 dark:text-amber-400 border-amber-700 bg-amber-500/10' },
  desaprovisionando:     { label: 'Desaprovisionando',    cls: 'text-muted-foreground border-border' },
  timeout_online:        { label: 'Timeout online',       cls: 'text-orange-600 dark:text-orange-400 border-orange-700 bg-orange-500/10' },
  fallido_service_port:  { label: 'Sin service port',     cls: 'text-red-600 dark:text-red-400 border-red-800 bg-red-500/10' },
  suspendido:            { label: 'Suspendido',           cls: 'text-yellow-600 dark:text-yellow-400 border-yellow-700 bg-yellow-500/10' },
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

function EstadoPanel({ registro, onDesaprovisionar, isDesaprovisionandoPending, onSuspender, isSuspendiendo, onRehabiliitar, isRehabilitando, onReset, isReiniciando }: {
  registro: FtthOnuRegistro;
  onDesaprovisionar: () => void;
  isDesaprovisionandoPending: boolean;
  onSuspender: () => void;
  isSuspendiendo: boolean;
  onRehabiliitar: () => void;
  isRehabilitando: boolean;
  onReset: () => void;
  isReiniciando: boolean;
}) {
  const btnCls = 'flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50';
  const canDesaprov = registro.estado === 'activo' || registro.estado === 'gpon_registrado' || registro.estado === 'wan_inyectado' || registro.estado === 'suspendido';
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado ONU FTTH</span>
        <EstadoBadge estado={registro.estado} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">Serial Number</span>
        <span className="font-mono font-semibold">{registro.sn}</span>
        <span className="text-muted-foreground">Posición</span>
        <span className="font-mono">f{registro.frame} · s{registro.slot} · p{registro.port} · ONU {registro.onuId}</span>
        <span className="text-muted-foreground">VLAN</span>
        <span className="font-mono">{registro.vlan}</span>
        <span className="text-muted-foreground">Intentos GPON / WAN</span>
        <span>{registro.intentosGpon} / {registro.intentosWan}</span>
      </div>
      {registro.ultimoError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{registro.ultimoError}</span>
        </div>
      )}
      <div className="flex gap-2">
        {registro.estado === 'activo' && (
          <button onClick={onReset} disabled={isReiniciando}
            className={cn(btnCls, 'border-sky-700/50 bg-sky-500/5 text-sky-700 dark:text-sky-400 hover:bg-sky-500/15')}>
            {isReiniciando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Reiniciar
          </button>
        )}
        {registro.estado === 'activo' && (
          <button onClick={onSuspender} disabled={isSuspendiendo}
            className={cn(btnCls, 'border-amber-700/50 bg-amber-500/5 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15')}>
            {isSuspendiendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <WifiOff className="w-3.5 h-3.5" />}
            Suspender
          </button>
        )}
        {registro.estado === 'suspendido' && (
          <button onClick={onRehabiliitar} disabled={isRehabilitando}
            className={cn(btnCls, 'border-emerald-700/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15')}>
            {isRehabilitando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Rehabilitar
          </button>
        )}
        {canDesaprov && (
          <button onClick={onDesaprovisionar} disabled={isDesaprovisionandoPending}
            className={cn(btnCls, 'border-red-700/50 bg-red-500/5 text-red-700 dark:text-red-400 hover:bg-red-500/15')}>
            {isDesaprovisionandoPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Desaprovisionar
          </button>
        )}
      </div>
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
  const [trafficIndexDown, setTrafficIndexDown] = useState('');  // '' = Indefinida
  const [trafficIndexUp,   setTrafficIndexUp]   = useState('');  // '' = Indefinida
  const [description,   setDescription]  = useState('');
  const [servicePortId, setServicePortId] = useState('');  // '' = usar pool automático
  const [wanMode,       setWanMode]      = useState<'bridge' | 'routing'>('bridge');

  // Perfiles OLT (Phase 4)
  const { data: perfiles } = useQuery<OltPerfilesResult>({
    queryKey:  ['olt-perfiles', selectedOltId],
    queryFn:   () => oltNativoApi.listarPerfiles(selectedOltId),
    enabled:   !!selectedOltId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // VLANs configuradas para la OLT (Phase 2)
  const { data: vlans = [] } = useQuery<OltVlan[]>({
    queryKey:  ['olt-vlans', selectedOltId],
    queryFn:   () => oltNativoApi.listarVlans(selectedOltId),
    enabled:   !!selectedOltId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Traffic tables para cambio de velocidad en caliente (Phase 5)
  const oltIdParaTraffic = selectedOltId || estadoExistente?.oltId || '';
  const { data: trafficTables = [] } = useQuery<OltTrafficTable[]>({
    queryKey:  ['olt-traffic-tables', oltIdParaTraffic],
    queryFn:   () => oltNativoApi.listarTrafficTables(oltIdParaTraffic),
    enabled:   !!oltIdParaTraffic,
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
    if (r.servicePortId != null) setServicePortId(String(r.servicePortId));
    if (r.lineprofileId) setLineprofileId(String(r.lineprofileId));
    if (r.srvprofileId)  setSrvprofileId(String(r.srvprofileId));
    if (r.wanMode)       setWanMode(r.wanMode);
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

  // Suspender mutation
  const { mutate: suspender, isPending: suspendiendo } = useMutation({
    mutationFn: () => oltNativoApi.ftthSuspender(selectedOltId || (estadoExistente?.oltId ?? ''), contrato.id),
    onSuccess: (res) => {
      if (res.exitoso) {
        toast('ONU suspendida correctamente', { type: 'success' });
        qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
      } else {
        toast(res.error ?? res.mensaje ?? 'No se pudo suspender la ONU', { type: 'error' });
        qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'Error al suspender la ONU', { type: 'error' });
    },
  });

  // Rehabilitar mutation
  const { mutate: rehabilitar, isPending: rehabilitando } = useMutation({
    mutationFn: () => oltNativoApi.ftthRehabilirar(selectedOltId || (estadoExistente?.oltId ?? ''), contrato.id),
    onSuccess: (res) => {
      if (res.exitoso) {
        toast('ONU rehabilitada correctamente', { type: 'success' });
        qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
      } else {
        toast(res.error ?? res.mensaje ?? 'No se pudo rehabilitar la ONU', { type: 'error' });
        qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'Error al rehabilitar la ONU', { type: 'error' });
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
      trafficIndexDown: trafficIndexDown !== '' ? parseInt(trafficIndexDown) : undefined,
      trafficIndexUp:   trafficIndexUp   !== '' ? parseInt(trafficIndexUp)   : undefined,
      servicePortId:    servicePortId    !== '' ? parseInt(servicePortId)    : undefined,
      description:      description.trim() || undefined,
      wanMode,
    }),
    onSuccess: (res) => {
      if (res.estado === 'activo') {
        // Éxito. res.mensaje informa el detalle: "GPON + WAN OK" o, si la WAN no se
        // pudo inyectar por incompatibilidad, la instrucción de configurarla manual.
        toast('ONU FTTH aprovisionada correctamente', {
          type: 'success',
          description: res.mensaje,
        });
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
    onError: async (err: unknown) => {
      // El aprovisionamiento es un proceso largo (~40s). Si el cliente pierde la
      // respuesta (red/navegador) aunque el backend SÍ concluya, verificamos el estado
      // REAL antes de mostrar error — evita el falso "Error al aprovisionar".
      try {
        const est = await oltNativoApi.ftthEstado(contrato.id);
        if (est?.estado === 'activo') {
          toast('ONU FTTH aprovisionada correctamente', {
            type: 'success',
            description: 'La ONU quedó activa (la respuesta se perdió en el cliente).',
          });
          qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
          qc.invalidateQueries({ queryKey: ['cliente-contratos'] });
          onClose();
          return;
        }
      } catch { /* si la verificación falla, se muestra el error normal */ }
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'Error al aprovisionar la ONU FTTH', { type: 'error' });
      qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
    },
  });

  // Reiniciar (reset) ONU
  const { mutate: resetOnu, isPending: reiniciandoOnu } = useMutation({
    mutationFn: () => oltNativoApi.ftthResetOnu(
      estadoExistente!.oltId, estadoExistente!.slot, estadoExistente!.port, estadoExistente!.onuId,
    ),
    onSuccess: () => toast('ONU reiniciada — puede tardar ~1 min en volver online', { type: 'success' }),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'Error al reiniciar la ONU', { type: 'error' });
    },
  });


  // Cierre del wizard: si el aprovisionamiento NO concluyó, se limpia todo (OLT + BD)
  // vía ftthCancelar (el backend ignora ONUs ya activas/suspendidas). Fire-and-forget.
  const handleClose = () => {
    const est = estadoExistente?.estado;
    const enProceso = !!est && est !== 'activo' && est !== 'suspendido';
    if (enProceso || provIsPending) {
      oltNativoApi.ftthCancelar(contrato.id)
        .then(() => {
          qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
          qc.invalidateQueries({ queryKey: ['cliente-contratos'] });
        })
        .catch(() => { /* best-effort — el recovery/reconciliador es la red de seguridad */ });
    }
    onClose();
  };

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
            <button onClick={handleClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            {/* Estado existente */}
            {estadoLoading ? (
              <div className="h-20 bg-muted/30 rounded-xl animate-pulse" />
            ) : estadoExistente ? (
              <div>
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Estado Actual</h3>
                <EstadoPanel
                  registro={estadoExistente}
                  onDesaprovisionar={() => desaprovisionar()}
                  isDesaprovisionandoPending={desaprovisionandoPending}
                  onSuspender={() => suspender()}
                  isSuspendiendo={suspendiendo}
                  onRehabiliitar={() => rehabilitar()}
                  isRehabilitando={rehabilitando}
                  onReset={() => resetOnu()}
                  isReiniciando={reiniciandoOnu}
                />
                {yaActivo && (
                  <div className="flex items-start gap-2 mt-2.5 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-700/30">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      ONU aprovisionada. Los campos de abajo muestran su configuración actual — edítalos y usa
                      <strong> Re-Aprovisionar</strong> para re-aplicar TODO (GPON + service-port + WAN).
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            {/* Selector OLT */}
            {(
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
            {selectedOlt && (
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
                    {vlans.length > 0 ? (
                      <div className="relative">
                        <select value={vlan} onChange={e => setVlan(e.target.value)}
                          className={cn(inputCls, 'appearance-none pr-8')}>
                          <option value="">— Seleccionar VLAN —</option>
                          {vlans.map(v => (
                            <option key={v.id} value={v.vlanId}>{v.vlanId} — {v.nombre}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      </div>
                    ) : (
                      <input type="number" value={vlan} onChange={e => setVlan(e.target.value)} min={1} max={4094} placeholder="201" className={inputCls} />
                    )}
                  </Field>
                  <Field label="Modo ONU" span2>
                    <div className="relative">
                      <select value={wanMode} onChange={e => setWanMode(e.target.value as 'bridge' | 'routing')}
                        className={cn(inputCls, 'appearance-none pr-8')}>
                        <option value="bridge">Bridge — PPPoE en el router del cliente (sin inyección WAN)</option>
                        <option value="routing">Routing — PPPoE inyectado en la ONU (OMCI)</option>
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
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
                  {(lineprofileId === '0' || srvprofileId === '0') && (
                    <div className="col-span-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <span className="text-amber-600 text-sm leading-none mt-0.5">⚠</span>
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Estás usando un perfil por defecto (índice <strong>0</strong>). Suelen estar vacíos (sin T-CONT/GEM),
                        por lo que la ONU se registra en la OLT pero <strong>no llega a “online”</strong> y el aprovisionamiento
                        hace rollback. Elige un perfil real (ej. uno que coincida con tu VLAN o el modelo de la ONT).
                      </p>
                    </div>
                  )}
                  <Field label="Velocidad Bajada">
                    <div className="relative">
                      <select
                        value={trafficIndexDown}
                        onChange={e => setTrafficIndexDown(e.target.value)}
                        className={cn(inputCls, 'appearance-none pr-8')}
                      >
                        <option value="">Indefinida</option>
                        {trafficTables
                          .filter(t => t.tipo === 'downstream' || t.tipo === 'combinado')
                          .map(t => (
                            <option key={t.id} value={t.trafficId}>
                              {t.trafficId} — {t.nombre}
                            </option>
                          ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </Field>
                  <Field label="Velocidad Subida">
                    <div className="relative">
                      <select
                        value={trafficIndexUp}
                        onChange={e => setTrafficIndexUp(e.target.value)}
                        className={cn(inputCls, 'appearance-none pr-8')}
                      >
                        <option value="">Indefinida</option>
                        {trafficTables
                          .filter(t => t.tipo === 'upstream' || t.tipo === 'combinado')
                          .map(t => (
                            <option key={t.id} value={t.trafficId}>
                              {t.trafficId} — {t.nombre}
                            </option>
                          ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </Field>
                  <Field label="Descripción (opcional)" span2>
                    <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                      maxLength={64} placeholder="Cliente Residencial FTTH" className={inputCls} />
                  </Field>
                </div>

                <div className="mt-1 space-y-1.5">
                  <div className="flex items-center gap-2 rounded-lg border border-violet-700/30 bg-violet-500/5 px-3 py-2 text-[11px] text-violet-700 dark:text-violet-300">
                    <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                    <div className="flex flex-1 items-center gap-2 flex-wrap">
                      <span className="flex-1">
                        Service Port ID — si hay pool configurado en la OLT se asigna automáticamente.
                        Si no, ingresa el ID manualmente:
                      </span>
                      <input
                        type="number"
                        value={servicePortId}
                        onChange={e => setServicePortId(e.target.value)}
                        min={1}
                        placeholder="Ej: 1501"
                        className="w-28 rounded-md border border-violet-700/40 bg-background px-2 py-1 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-violet-700/30 bg-violet-500/5 px-3 py-2 text-[11px] text-violet-700 dark:text-violet-300">
                    <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>ONU ID se asigna automáticamente del pool por puerto PON (1–128).</span>
                  </div>
                </div>

                <div className="mt-2 flex items-start gap-2 rounded-lg border border-blue-700/30 bg-blue-500/5 px-3 py-2 text-[11px] text-blue-700 dark:text-blue-300">
                  <Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    {wanMode === 'routing' ? (
                      <>Registra la ONU en la OLT (GPON), espera que esté online, luego inyecta las
                        credenciales PPPoE <strong>{(contrato as any).usuarioPppoe ?? '—'}</strong> en
                        la ONU vía OMCI (modo routing).</>
                    ) : (
                      <>Registra la ONU en la OLT (GPON + service-port) en <strong>modo bridge</strong>:
                        la ONU va transparente y el PPPoE lo maneja el router del cliente contra el BRAS.
                        No se inyecta WAN en la ONU.</>
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-3 flex-shrink-0">
            <button type="button" onClick={handleClose}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors text-foreground/80">
              {yaActivo ? 'Cerrar' : 'Cancelar'}
            </button>
            <button type="button" onClick={() => provisionar()}
              disabled={!formValid || provIsPending || !selectedOltId}
              className="btn-primary px-5 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
              {provIsPending
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {yaActivo ? 'Re-Aprovisionando…' : 'Aprovisionando…'}</>
                : <><Zap className="w-3.5 h-3.5" /> {yaActivo ? 'Re-Aprovisionar' : 'Aprovisionar FTTH'}</>
              }
            </button>
          </div>
        </div>
      </div>
    </>
    </Portal>
  );
}
