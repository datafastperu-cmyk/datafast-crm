'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Zap, Loader2, AlertTriangle, Search, CheckCircle2,
  RefreshCw, WifiOff, Hash, Trash2, ChevronDown, Eye,
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
import { useProcedimientoWizard } from '@/hooks/useProcedimientoWizard';
import { SenalFtthValor } from '@/components/red/onus/SenalFtthValor';
import { OnuDetalleTr069Modal } from '@/components/red/onus/OnuDetalleTr069Modal';

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

function EstadoPanel({ registro, onDesaprovisionar, isDesaprovisionandoPending, onSuspender, isSuspendiendo, onRehabiliitar, isRehabilitando, onReset, isReiniciando, onVerDetalle }: {
  registro: FtthOnuRegistro;
  onDesaprovisionar: () => void;
  isDesaprovisionandoPending: boolean;
  onSuspender: () => void;
  isSuspendiendo: boolean;
  onRehabiliitar: () => void;
  isRehabilitando: boolean;
  onReset: () => void;
  isReiniciando: boolean;
  onVerDetalle: () => void;
}) {
  const btnCls = 'flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50';
  const canDesaprov = registro.estado === 'activo' || registro.estado === 'gpon_registrado' || registro.estado === 'wan_inyectado' || registro.estado === 'suspendido';

  // Señal óptica en vivo, igual que en el modal Ver detalle de /red/olt: refresco cada 10 s
  // mientras el panel está montado; detenido en segundo plano (cada lectura es SSH a la OLT).
  const puedeLeerSenal = Boolean(registro.oltId && registro.slot != null && registro.port != null && registro.onuId != null);
  const { data: metricasSenal, isFetching: senalFetching, refetch: refetchSenal } = useQuery({
    queryKey: ['onu-metricas', registro.oltId, registro.slot, registro.port, registro.onuId],
    queryFn:  () => oltNativoApi.metricas(registro.oltId, { slot: registro.slot, port: registro.port, onuId: registro.onuId, sn: registro.sn }),
    enabled:  puedeLeerSenal,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    staleTime: 8_000,
  });
  const rxSenal = metricasSenal?.rxPowerDbm ?? null;
  const oltRxSenal = metricasSenal?.oltRxPowerDbm ?? null;

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

      {/* Señal FTTH — mismo formato y tamaño que el modal Ver detalle */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Señal FTTH</span>
        <SenalFtthValor rxDbm={rxSenal} oltRxDbm={oltRxSenal} cargando={senalFetching}
          puedeLeer={puedeLeerSenal} onLeer={() => refetchSenal()} />
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
        <button onClick={onVerDetalle}
          className={cn(btnCls, 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/15')}>
          <Eye className="w-3.5 h-3.5" />
          Ver detalle
        </button>
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

// PIR en kbps → etiqueta legible en Mbps (velocidad tope real de la traffic-table)
const fmtVel = (pirKbps: number | null): string =>
  pirKbps == null ? 'sin límite' : `${(pirKbps / 1024).toFixed(pirKbps >= 10240 ? 0 : 1)} Mbps`;

// ─── Main Modal ────────────────────────────────────────────────

export function ModalProvisionFtth({ contrato, onClose }: { contrato: Contrato; onClose: () => void }) {
  const qc = useQueryClient();

  // Procedimiento operativo: heartbeat mientras el operador está a cargo; lo NO confirmado
  // se anula al cerrar. Ver CLAUDE.md § Wizards y Modales.
  const wizard = useProcedimientoWizard('ftth_provision', contrato.id);
  const [verDetalle, setVerDetalle] = useState(false);
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

  // Mientras corre una provisión se sondea el estado para poder mostrar la FASE en curso.
  // Una provisión ronda los 40 s —la mitad es la ONU arrancando su stack GPON, tiempo
  // irreducible— y un spinner opaco durante ese rato se percibe como que el sistema se colgó.
  // No hace falta instrumentar nada nuevo: la máquina de estados del registro YA es el
  // progreso real.
  const [provisionando, setProvisionando] = useState(false);

  // Estado existente
  const { data: estadoExistente, isLoading: estadoLoading } = useQuery({
    queryKey:  ['ftth-estado', contrato.id],
    queryFn:   () => oltNativoApi.ftthEstado(contrato.id),
    staleTime: 0,
    refetchInterval: provisionando ? 2000 : false,
  });

  // Fase legible. Deliberadamente honesta: `gpon_registrado` cubre tanto la espera a que la
  // ONU levante como la inyección de la WAN, así que se anuncian juntas en vez de fingir un
  // detalle que el backend no reporta.
  const faseProvision = !provisionando ? null
    : !estadoExistente                                ? 'Reservando recursos y preparando la OLT…'
    : estadoExistente.estado === 'pendiente'          ? 'Registrando la ONU en la OLT (GPON)…'
    : estadoExistente.estado === 'gpon_registrado'    ? 'Esperando que la ONU levante e inyectando la WAN…'
    : estadoExistente.estado === 'activo'             ? 'Finalizando…'
    : `Estado: ${estadoExistente.estado}`;

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
  // Routing preseleccionado: es el modo habitual de la operación. Si la ONU ya existe, el
  // efecto de auto-relleno lo pisa con el modo REAL del registro, así que esto solo aplica
  // a provisiones nuevas.
  const [wanMode,       setWanMode]      = useState<'bridge' | 'routing'>('routing');

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

  // Pool de Service Port IDs (Inc.7): si la OLT tiene pool configurado, el backend
  // SIEMPRE asigna el ID desde ahí (provision-ftth.service.ts: poolSvcPortId ?? dto.servicePortId)
  // e ignora cualquier valor manual — el input solo aplica como fallback cuando no
  // hay pool configurado para esa OLT.
  const { data: servicePortPool } = useQuery({
    queryKey:  ['olt-service-port-pool', selectedOltId],
    queryFn:   () => oltNativoApi.servicePortPoolEstado(selectedOltId),
    enabled:   !!selectedOltId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const poolConfigurado = (servicePortPool?.total ?? 0) > 0;

  // ── Directriz "inyectar desde cero": la provisión del ERP consume SOLO
  // recursos declarados en el baseline asignado a la OLT (los preexistentes
  // se respetan pero no se usan). Sin baseline → se muestran todos, con aviso.
  const { data: oltDetalle } = useQuery({
    queryKey: ['olt-detalle', selectedOltId],
    queryFn:  () => oltNativoApi.findOne(selectedOltId),
    enabled:  !!selectedOltId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const { data: baselinesList = [] } = useQuery({
    queryKey: ['olt-baselines'],
    queryFn:  () => oltNativoApi.getBaselines(),
    enabled:  !!selectedOltId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const baselineAsignado = baselinesList.find(b => b.id === oltDetalle?.baselineId) ?? null;
  const vlansPermitidas = baselineAsignado
    ? vlans.filter(v => baselineAsignado.spec.vlans.some(bv => bv.vlanId === v.vlanId))
    : vlans;
  const ttPermitidas = baselineAsignado
    ? trafficTables.filter(t => baselineAsignado.spec.trafficTables.some(bt => bt.nombre === t.nombre))
    : trafficTables;

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
    if (r.trafficIndexDown != null) setTrafficIndexDown(String(r.trafficIndexDown));
    if (r.trafficIndexUp   != null) setTrafficIndexUp(String(r.trafficIndexUp));
    if (r.lineprofileId) setLineprofileId(String(r.lineprofileId));
    if (r.srvprofileId)  setSrvprofileId(String(r.srvprofileId));
    if (r.wanMode)       setWanMode(r.wanMode);
  }, [estadoExistente]);

  // Preferencia: line-profile canónico DATAFAST si existe y no hay selección previa
  useEffect(() => {
    if (lineprofileId || !perfiles?.lineprofiles?.length) return;
    const canonico = perfiles.lineprofiles.find(p => (p.name ?? '').toUpperCase().startsWith('DATAFAST'));
    if (canonico) setLineprofileId(String(canonico.profile_id));
  }, [perfiles]); // eslint-disable-line

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

  // Sincroniza slot/port con el SN seleccionado en modo lista. La opción por defecto de
  // un <select> NO dispara onChange, así que sin esto slot/port quedaban vacíos (formValid
  // falla y el botón Aprovisionar no se habilita) hasta re-seleccionar manualmente el SN.
  useEffect(() => {
    if (!snSelectMode || !scanData?.onus.length || !sn) return;
    const o = (scanData.onus as OntFoundInfo[]).find(x => x.sn === sn);
    if (o) { setSlot(String(o.slot)); setPort(String(o.port)); }
  }, [snSelectMode, scanData, sn]);

  useEffect(() => {
    setSnSelectMode(false);
    setScanNoResults(false);
  }, [selectedOltId]);

  // ── Tipo de ONU: detección de modelo nuevo (propuesta del usuario) ──
  // El escaneo reporta el modelo (ont_model). Si ningún ont-srvprofile de la
  // OLT corresponde a ese modelo, se sugiere crearlo con sello DATAFAST y se
  // reanuda el aprovisionamiento con el perfil recién creado seleccionado.
  const modeloDetectado = scanData?.onus.find(o => o.sn === sn)?.ont_model?.trim() || null;
  const perfilDelModelo = modeloDetectado
    ? perfiles?.srvprofiles?.find(p => p.name.toUpperCase().includes(modeloDetectado.toUpperCase()))
    : undefined;

  const crearTipoOnu = useMutation({
    mutationFn: () => oltNativoApi.agregarSrvProfile(selectedOltId, {
      modelo: modeloDetectado!.toUpperCase(), eth: 4, pots: 2, catv: 0,
    }),
    onSuccess: (p) => {
      toast(`Tipo de ONU "${p.nombre}" creado (profile-id ${p.profileId}) — aprovisionamiento reanudado`, { type: 'success' });
      setSrvprofileId(String(p.profileId));
      qc.invalidateQueries({ queryKey: ["olt-perfiles", selectedOltId] });
      qc.invalidateQueries({ queryKey: ["olt-service-profiles", selectedOltId] });
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Error al crear el tipo de ONU', { type: 'error' }),
  });

  // Form validation
  // Velocidad Bajada/Subida OBLIGATORIAS: dejarlas vacías aplicaba traffic-table
  // index 0, que en OLTs ya provisionadas por SmartOLT puede ser una tabla con tope
  // (ej. 1024/2048 kbps) → la ONU quedaba capada a ~2 Mbps de forma silenciosa.
  const formValid = (
    !!selectedOltId && !!sn.trim() && slot !== '' && port !== '' &&
    !!vlan && !!lineprofileId && !!srvprofileId &&
    trafficIndexDown !== '' && trafficIndexUp !== '' &&
    poolConfigurado
  );

  // Desaprovisionar mutation
  const { mutate: desaprovisionar, isPending: desaprovisionandoPending } = useMutation({
    // La llamada HTTP es el DISPARADOR; la verdad es el estado real. Se corre en paralelo un
    // sondeo del registro y gana el primero que resuelva.
    //
    // Motivo (2026-07-22): el backend completaba en ~19 s y respondía 200, pero la respuesta
    // no llegaba al navegador; axios agotaba su timeout y el operador esperaba MINUTOS con el
    // botón bloqueado por una operación ya terminada. Subir el timeout solo alargaba la
    // espera. Atar la UI al transporte es el error de fondo: en una operación de hardware
    // larga, que la respuesta se pierda no dice nada sobre si la operación ocurrió.
    mutationFn: async () => {
      const oltId = selectedOltId || (estadoExistente?.oltId ?? '');
      let postFallo: unknown = null;
      const post = oltNativoApi.ftthDesaprovisionar(oltId, contrato.id)
        .catch((e: unknown): undefined => { postFallo = e; return undefined; });

      const sondeo = (async (): Promise<{ exitoso: boolean; mensaje: string; error?: string } | undefined> => {
        for (let i = 0; i < 60; i++) {                 // ~3 min de red de seguridad
          await new Promise(r => setTimeout(r, 3000));
          const est = await oltNativoApi.ftthEstado(contrato.id).catch((): undefined => undefined);
          if (est === null) {                          // sin registro ⇒ ya se desaprovisionó
            return { exitoso: true, mensaje: 'ONU desaprovisionada (verificado en el sistema).' };
          }
        }
        return undefined;
      })();

      const ganador = await Promise.race([post, sondeo]);
      if (ganador) return ganador;
      // El POST resolvió primero pero vacío (falló): se propaga para que lo trate onError.
      throw postFallo ?? new Error('No se pudo confirmar la desaprovisión.');
    },
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
    onError: async (err: unknown) => {
      // Un error de TRANSPORTE no prueba que la operación fallara. La desaprovisión hace
      // varios round-trips SSH y puede pasar del minuto; si el cliente pierde la respuesta
      // (timeout, corte, pestaña en segundo plano) el backend sigue y termina bien. Mostrar
      // "error" sin más entrena al operador a desconfiar de la UI — y hoy se vio dos veces
      // un toast de error sobre desaprovisiones que respondieron HTTP 200 (2026-07-22).
      //
      // Mismo principio VIO que aplicamos al hardware, aquí en la UI: se consulta el ESTADO
      // REAL antes de declarar el fallo. Si el registro ya no está, la operación ocurrió.
      // El sondeo del mutationFn ya cubrió la verificación del estado real; si llegamos aquí
      // es que la operación falló de verdad o no se pudo confirmar en la ventana.
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast(msg ?? 'Error al desaprovisionar la ONU', { type: 'error' });
      qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
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
    onMutate:   () => { setProvisionando(true); },
    onSettled:  () => { setProvisionando(false); },
    // Se abre el procedimiento JUSTO antes del primer paso mutante, no al montar el modal:
    // abrir el modal solo para mirar no debe crear nada que luego haya que anular.
    mutationFn: async () => {
      const opId = await wizard.abrir();
      return oltNativoApi.ftthProvision(selectedOltId, {
      operacionId:   opId ?? undefined,
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
      // Sin input manual: el Service Port ID SIEMPRE lo asigna el pool de la OLT
      // (backend rechaza el submit si no hay pool — ver aviso poolConfigurado abajo).
      description:      description.trim() || undefined,
      wanMode,
      });
    },
    onSuccess: async (res) => {
      if (res.estado === 'activo') {
        // FRONTERA DE CONFIRMACIÓN: solo aquí, con el estado terminal verificado por el
        // backend. A partir de este punto cerrar el modal ya NO anula nada.
        await wizard.confirmar();
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
      // El aprovisionamiento es largo (~70s). Si el cliente pierde la respuesta, o si
      // este request colisionó con otro en curso (ConflictException "aprovisionamiento
      // en curso"), el backend puede seguir trabajando. Sondeamos el estado REAL hasta
      // que resuelva a 'activo' (éxito) o 'fallido_*' (error real) — evita el falso
      // "Error al aprovisionar" cuando la ONU en realidad sí quedó activa.
      const enProceso = (e?: string) =>
        e === 'pendiente' || e === 'gpon_registrado' || e === 'wan_inyectado' || e === 'desaprovisionando';
      for (let i = 0; i < 30; i++) {  // ~90s máx (30 × 3s)
        let est: { estado?: string } | null = null;
        try { est = await oltNativoApi.ftthEstado(contrato.id); } catch { /* reintenta */ }
        if (est?.estado === 'activo') {
          // Mismo criterio que en onSuccess: el estado terminal lo dicta el backend, no el
          // hecho de que el request HTTP haya fallado. Confirmar aquí evita que un timeout
          // de red acabe anulando una ONU que quedó perfectamente activa.
          await wizard.confirmar();
          toast('ONU FTTH aprovisionada correctamente', {
            type: 'success',
            description: 'La ONU quedó activa.',
          });
          qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
          qc.invalidateQueries({ queryKey: ['cliente-contratos'] });
          onClose();
          return;
        }
        if (est && !enProceso(est.estado)) break;  // fallido / suspendido → error real
        await new Promise(r => setTimeout(r, 3000));
      }
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
  // Cierre del wizard. Nunca se cierra por accidente: ni ESC ni clic fuera lo cierran, y si
  // hay trabajo SIN CONFIRMAR se pide confirmación explícita porque ese trabajo se va a
  // deshacer. Si el procedimiento ya se confirmó (ONU activa y verificada), cierra sin
  // fricción — lo confirmado no se anula por un cierre.
  const handleClose = () => {
    const est = estadoExistente?.estado;
    const enProceso = !!est && est !== 'activo' && est !== 'suspendido';
    const hayQueAnular = wizard.hayTrabajoSinConfirmar || enProceso || provIsPending;

    if (hayQueAnular) {
      const ok = window.confirm(
        'Este procedimiento no ha terminado.\n\n' +
        'Al cerrar se deshará TODO lo que se ejecutó en esta sesión: la ONU se quitará de la ' +
        'OLT y se liberarán los recursos reservados. Tendrás que empezar el proceso desde cero.\n\n' +
        '¿Cerrar de todos modos?',
      );
      if (!ok) return;

      // Anulación por saga (bitácora de compensación). `ftthCancelar` queda como respaldo
      // para el trabajo iniciado ANTES de que existiera el procedimiento (registros que no
      // tienen operacionId). Ambas son idempotentes.
      void wizard.cerrar('Cerrado por el operador sin confirmar');
      oltNativoApi.ftthCancelar(contrato.id)
        .then(() => {
          qc.invalidateQueries({ queryKey: ['ftth-estado', contrato.id] });
          qc.invalidateQueries({ queryKey: ['cliente-contratos'] });
        })
        .catch(() => { /* best-effort — el barrido del servidor es la red de seguridad real */ });
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
                  onVerDetalle={() => setVerDetalle(true)}
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
                    {vlansPermitidas.length > 0 ? (
                      <div className="relative">
                        <select value={vlan} onChange={e => setVlan(e.target.value)}
                          className={cn(inputCls, 'appearance-none pr-8')}>
                          <option value="">— Seleccionar VLAN —</option>
                          {vlansPermitidas.map(v => (
                            <option key={v.id} value={v.vlanId}>{v.vlanId} — {v.nombre}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      </div>
                    ) : (
                      <input type="number" value={vlan} onChange={e => setVlan(e.target.value)} min={1} max={4094} placeholder="200" className={inputCls} />
                    )}
                    {!baselineAsignado && !!selectedOltId && (
                      <p className="text-[10px] text-amber-500 mt-0.5">
                        OLT sin baseline del ERP — se muestran recursos preexistentes. Aplica el
                        Baseline Datafast Estándar (tab Cumplimiento) para provisionar solo con recursos propios.
                      </p>
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
                  {/* Modelo nuevo detectado en el escaneo sin tipo de ONU → sugerir crear */}
                  {modeloDetectado && !perfilDelModelo && (
                    <div className="col-span-2 flex items-center gap-2 flex-wrap rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2">
                      <p className="text-xs text-sky-700 dark:text-sky-400 flex-1 min-w-48">
                        La ONU escaneada es modelo <strong className="font-mono">{modeloDetectado}</strong> y la OLT
                        no tiene un tipo de ONU para ese modelo. Créalo y el aprovisionamiento continúa.
                      </p>
                      <button
                        type="button"
                        onClick={() => crearTipoOnu.mutate()}
                        disabled={crearTipoOnu.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-medium hover:bg-sky-700 disabled:opacity-50"
                      >
                        {crearTipoOnu.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                        Crear DATAFAST_{modeloDetectado.toUpperCase()} (4 ETH, 2 POTS)
                      </button>
                    </div>
                  )}
                  {modeloDetectado && perfilDelModelo && srvprofileId === '' && (
                    <div className="col-span-2">
                      <button
                        type="button"
                        onClick={() => setSrvprofileId(String(perfilDelModelo.profile_id))}
                        className="text-xs text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        Modelo {modeloDetectado} detectado → usar perfil {perfilDelModelo.profile_id} — {perfilDelModelo.name}
                      </button>
                    </div>
                  )}
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
                        <option value="">— Elegir (obligatorio) —</option>
                        {ttPermitidas
                          .filter(t => t.tipo === 'downstream' || t.tipo === 'combinado')
                          .map(t => (
                            <option key={t.id} value={t.trafficId}>
                              {t.trafficId} — {fmtVel(t.pirKbps)}
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
                        <option value="">— Elegir (obligatorio) —</option>
                        {ttPermitidas
                          .filter(t => t.tipo === 'upstream' || t.tipo === 'combinado')
                          .map(t => (
                            <option key={t.id} value={t.trafficId}>
                              {t.trafficId} — {fmtVel(t.pirKbps)}
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
                  {poolConfigurado ? (
                    // Pool configurado en la OLT: el backend SIEMPRE asigna el Service Port ID
                    // desde ahí (provision-ftth.service.ts). Puramente informativo — nunca editable,
                    // para eliminar el riesgo de colisión/errores por ID manual incorrecto.
                    <div className="flex items-center gap-2 rounded-lg border border-violet-700/30 bg-violet-500/5 px-3 py-2 text-[11px] text-violet-700 dark:text-violet-300">
                      <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="flex-1">
                        Service Port ID — se asigna automáticamente del pool de la OLT
                        ({servicePortPool?.libres ?? 0} libres de {servicePortPool?.total ?? 0}).
                      </span>
                    </div>
                  ) : selectedOltId ? (
                    <div className="flex items-center gap-2 rounded-lg border border-red-700/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-700 dark:text-red-400">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="flex-1">
                        Esta OLT no tiene pool de Service Port IDs configurado — no se puede aprovisionar
                        sin asignación automática. Configúralo en Detalles de la OLT → Pool de Service Port IDs.
                      </span>
                    </div>
                  ) : null}
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
            {faseProvision && (
              <span className="mr-auto flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                <span>
                  {faseProvision}
                  <span className="block text-[10px] opacity-70">
                    Puede tardar ~40 s: la ONU necesita arrancar su enlace GPON.
                  </span>
                </span>
              </span>
            )}
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

      {/* Modal de gestión TR-069 en vivo, sobre el de aprovisionar. Solo con ONU registrada. */}
      {verDetalle && estadoExistente && (
        <OnuDetalleTr069Modal
          sn={estadoExistente.sn}
          oltId={estadoExistente.oltId}
          cliente={contrato.clienteNombre ?? undefined}
          slot={estadoExistente.slot}
          port={estadoExistente.port}
          onuId={estadoExistente.onuId}
          contratoId={contrato.id}
          onClose={() => setVerDetalle(false)}
        />
      )}
    </>
    </Portal>
  );
}
