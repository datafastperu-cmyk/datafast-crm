'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery }          from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, ChevronRight,
  FileUp, Loader2, RefreshCw, Shield,
  Signal, UploadCloud, XCircle,
} from 'lucide-react';

import { cn }           from '@/lib/utils';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import type {
  FirmwareJobProgress, FirmwareJobResult, OltDispositivo, OnuActivaInfo,
} from '@/lib/api/olt-nativo';

// ── constantes ────────────────────────────────────────────────────
const MAX_FILE_MB   = 64;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const SLOTS  = Array.from({ length: 8 },  (_, i) => i);
const PORTS  = Array.from({ length: 16 }, (_, i) => i);

const ESTADO_COLORS: Record<string, string> = {
  pendiente:     'text-muted-foreground',
  transfiriendo: 'text-amber-400',
  exitoso:       'text-emerald-400',
  parcial:       'text-amber-400',
  fallido:       'text-red-400',
};

const ESTADO_LABELS: Record<string, string> = {
  pendiente:     'Pendiente',
  transfiriendo: 'Transfiriendo…',
  exitoso:       'Completado',
  parcial:       'Parcial',
  fallido:       'Fallido',
};

const ONU_STATUS_ICON = {
  pending:      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />,
  transferring: <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />,
  success:      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  failed:       <XCircle className="w-3.5 h-3.5 text-red-400" />,
} as const;

// ── tipos locales ─────────────────────────────────────────────────
type Step = 1 | 2 | 3;

interface Props {
  olt: OltDispositivo;
}

// ═════════════════════════════════════════════════════════════════
// FirmwareUpgradeTab
// ═════════════════════════════════════════════════════════════════
export function FirmwareUpgradeTab({ olt }: Props) {
  // Estado del wizard
  const [step, setStep]               = useState<Step>(1);
  const [selectedFile, setFile]       = useState<File | null>(null);
  const [fileError, setFileError]     = useState<string>('');
  const [slot, setSlot]               = useState(0);
  const [port, setPort]               = useState(0);
  const [selectedIds, setSelected]    = useState<number[]>([]);
  const [historialId, setHistorialId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── step 2: listar ONUs ──────────────────────────────────────
  const { data: onus = [], isFetching: loadingOnus, refetch: refetchOnus } = useQuery({
    queryKey:  ['olt-onus', olt.id, slot, port],
    queryFn:   () => oltNativoApi.listarOnusActivas(olt.id, slot, port),
    enabled:   step === 2,
    staleTime: 15_000,
  });

  // ── polling del job ──────────────────────────────────────────
  const { data: jobStatus } = useQuery<FirmwareJobResult>({
    queryKey:       ['firmware-job', olt.id, historialId],
    queryFn:        () => oltNativoApi.getFirmwareJobStatus(olt.id, historialId!),
    enabled:        !!historialId,
    refetchInterval: (query) => {
      const est = query.state.data?.estado;
      return (est === 'transfiriendo' || est === 'pendiente') ? 10_000 : false;
    },
    staleTime: 0,
  });

  // ── mutation iniciar upgrade ──────────────────────────────────
  const upgradeMutation = useMutation({
    mutationFn: () =>
      oltNativoApi.iniciarFirmwareUpgrade(olt.id, selectedFile!, slot, port, selectedIds),
    onSuccess: (data) => {
      setHistorialId(data.historialId);
      setStep(3);
    },
  });

  // ── handlers ─────────────────────────────────────────────────
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFileError('');
    if (!f) { setFile(null); return; }
    if (!f.name.toLowerCase().endsWith('.bin')) {
      setFileError('Solo se permiten archivos .bin');
      setFile(null); return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError(`Archivo demasiado grande (${(f.size / 1024 / 1024).toFixed(1)} MB). Máximo ${MAX_FILE_MB} MB.`);
      setFile(null); return;
    }
    if (f.size === 0) {
      setFileError('El archivo está vacío.');
      setFile(null); return;
    }
    setFile(f);
  }, []);

  const toggleOnu = (id: number) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const selectAll = () => setSelected(onus.map(o => o.onuId));
  const clearAll  = () => setSelected([]);

  const reset = () => {
    setStep(1); setFile(null); setFileError(''); setHistorialId(null);
    setSelected([]); setSlot(0); setPort(0);
    if (fileRef.current) fileRef.current.value = '';
  };

  // ── indicador de pasos ────────────────────────────────────────
  const StepIndicator = () => (
    <div className="flex items-center gap-2 mb-6">
      {([1, 2, 3] as Step[]).map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={cn(
            'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border',
            step === s
              ? 'bg-primary text-primary-foreground border-primary'
              : step > s
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                : 'bg-muted/30 text-muted-foreground border-border',
          )}>
            {step > s ? <CheckCircle2 className="w-4 h-4" /> : s}
          </div>
          <span className={cn(
            'text-xs font-medium hidden sm:block',
            step === s ? 'text-foreground' : 'text-muted-foreground',
          )}>
            {['Archivo', 'ONUs', 'Ejecutar'][i]}
          </span>
          {i < 2 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />}
        </div>
      ))}
    </div>
  );

  // ══════════════════════════════════════════════════════════════
  // PASO 1 — Seleccionar archivo
  // ══════════════════════════════════════════════════════════════
  if (step === 1) return (
    <div className="space-y-5">
      <StepIndicator />

      <div
        className={cn(
          'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
          selectedFile
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : 'border-border hover:border-primary/40 hover:bg-accent/30',
        )}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".bin"
          className="hidden"
          onChange={handleFileChange}
        />
        {selectedFile ? (
          <div className="space-y-1.5">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <p className="font-medium text-sm text-foreground">{selectedFile.name}</p>
            <p className="text-xs text-muted-foreground">
              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB · Haz clic para cambiar
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <UploadCloud className="w-10 h-10 text-muted-foreground/50 mx-auto" />
            <p className="text-sm font-medium text-foreground">Arrastra o haz clic para seleccionar</p>
            <p className="text-xs text-muted-foreground">Archivos .bin · Máximo {MAX_FILE_MB} MB</p>
          </div>
        )}
      </div>

      {fileError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <XCircle className="w-4 h-4 shrink-0" />
          {fileError}
        </div>
      )}

      <button
        disabled={!selectedFile}
        onClick={() => setStep(2)}
        className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
      >
        Continuar
      </button>
    </div>
  );

  // ══════════════════════════════════════════════════════════════
  // PASO 2 — Seleccionar ONUs
  // ══════════════════════════════════════════════════════════════
  if (step === 2) return (
    <div className="space-y-4">
      <StepIndicator />

      {/* Filtro slot / port */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-muted-foreground mb-1">Slot</label>
          <select
            value={slot}
            onChange={(e) => { setSlot(+e.target.value); setSelected([]); }}
            className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-muted-foreground mb-1">Puerto PON</label>
          <select
            value={port}
            onChange={(e) => { setPort(+e.target.value); setSelected([]); }}
            className="w-full px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {PORTS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={() => refetchOnus()}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <RefreshCw className={cn('w-4 h-4', loadingOnus && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Acciones de selección */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {onus.length} ONUs en 0/{slot}/{port} · {selectedIds.length} seleccionadas
        </span>
        <div className="flex gap-2">
          <button onClick={selectAll} className="text-xs text-primary hover:underline">
            Seleccionar todas
          </button>
          {selectedIds.length > 0 && (
            <button onClick={clearAll} className="text-xs text-muted-foreground hover:underline">
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Lista de ONUs */}
      <div className="border border-border rounded-xl overflow-hidden max-h-64 overflow-y-auto">
        {loadingOnus ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando ONUs…
          </div>
        ) : onus.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
            <Signal className="w-8 h-8 opacity-30" />
            <p className="text-sm">No hay ONUs aprovisionadas en 0/{slot}/{port}</p>
          </div>
        ) : (
          onus.map((onu: OnuActivaInfo) => (
            <label
              key={onu.id}
              className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-accent/30 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(onu.onuId)}
                onChange={() => toggleOnu(onu.onuId)}
                className="rounded border-border accent-primary"
              />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-xs text-foreground">{onu.serialNumber}</p>
                <p className="text-xs text-muted-foreground">ONU-ID: {onu.onuId}</p>
              </div>
              <span className={cn(
                'text-xs px-1.5 py-0.5 rounded',
                onu.estado === 'online'  ? 'bg-emerald-500/15 text-emerald-400' :
                onu.estado === 'offline' ? 'bg-red-500/15 text-red-400' :
                'bg-muted/40 text-muted-foreground',
              )}>
                {onu.estado}
              </span>
            </label>
          ))
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setStep(1)}
          className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-accent"
        >
          Atrás
        </button>
        <button
          disabled={selectedIds.length === 0}
          onClick={() => setStep(3)}
          className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
        >
          Continuar ({selectedIds.length})
        </button>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════
  // PASO 3 — Confirmación + Progreso
  // ══════════════════════════════════════════════════════════════
  const isRunning   = jobStatus?.estado === 'transfiriendo' || jobStatus?.estado === 'pendiente';
  const isDone      = !!historialId && !isRunning;
  const hasStarted  = !!historialId;

  return (
    <div className="space-y-4">
      <StepIndicator />

      {/* Resumen */}
      <div className="bg-muted/20 border border-border rounded-xl p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Archivo</span>
          <span className="font-medium truncate max-w-[200px]">{selectedFile?.name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Puerto PON</span>
          <span className="font-medium">0/{slot}/{port}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">ONUs seleccionadas</span>
          <span className="font-medium">{selectedIds.join(', ')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tamaño</span>
          <span className="font-medium">
            {selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB` : '—'}
          </span>
        </div>
      </div>

      {/* Advertencia de seguridad */}
      {!hasStarted && (
        <div className="flex gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-300 mb-1">Atención — Operación crítica</p>
            <p className="text-amber-400/80 leading-relaxed">
              Este proceso reiniciará las ONUs seleccionadas y tomará entre 2 y 5 minutos por ONU.
              <strong className="text-amber-300"> No interrumpas la energía de los equipos</strong>{' '}
              durante la transferencia OMCI. Una actualización interrumpida puede dejar la ONU en estado irrecuperable.
            </p>
          </div>
        </div>
      )}

      {/* Error del mutation */}
      {upgradeMutation.isError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <XCircle className="w-4 h-4 shrink-0" />
          {(upgradeMutation.error as Error).message}
        </div>
      )}

      {/* Estado del job */}
      {hasStarted && jobStatus && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-muted/20 border-b border-border">
            <div className="flex items-center gap-2">
              {isRunning
                ? <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                : jobStatus.estado === 'exitoso'
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  : <XCircle className="w-4 h-4 text-red-400" />
              }
              <span className={cn('text-sm font-medium', ESTADO_COLORS[jobStatus.estado])}>
                {ESTADO_LABELS[jobStatus.estado]}
              </span>
            </div>
            {isRunning && (
              <span className="text-xs text-muted-foreground">Actualizando cada 10 s…</span>
            )}
          </div>

          {/* Progreso por ONU */}
          <div className="divide-y divide-border">
            {(jobStatus.resultado ?? jobStatus.onuIds.map(id => ({
              onu_id: id, status: 'pending' as const, message: null,
            }))).map((p: FirmwareJobProgress) => (
              <div key={p.onu_id} className="flex items-center gap-3 px-4 py-2.5">
                {ONU_STATUS_ICON[p.status] ?? ONU_STATUS_ICON.pending}
                <span className="text-sm">ONU-ID: <strong>{p.onu_id}</strong></span>
                {p.message && (
                  <span className="ml-auto text-xs text-muted-foreground truncate max-w-[200px]">
                    {p.message}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Barra de progreso estimada */}
      {isRunning && jobStatus && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Transferencia OMCI en curso…</span>
            <span>
              {(jobStatus.resultado ?? []).filter((p: FirmwareJobProgress) => p.status === 'success').length}
              /{jobStatus.onuIds.length} completadas
            </span>
          </div>
          <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-500"
              style={{
                width: `${
                  jobStatus.resultado
                    ? Math.round(
                        (jobStatus.resultado.filter((p: FirmwareJobProgress) =>
                          ['success','failed'].includes(p.status)).length /
                          jobStatus.onuIds.length) * 100,
                      )
                    : 5
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Botones */}
      <div className="flex gap-3">
        {!hasStarted && (
          <>
            <button
              onClick={() => setStep(2)}
              disabled={upgradeMutation.isPending}
              className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-40"
            >
              Atrás
            </button>
            <button
              onClick={() => upgradeMutation.mutate()}
              disabled={upgradeMutation.isPending}
              className="flex-1 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {upgradeMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Iniciando…</>
              ) : (
                <><FileUp className="w-4 h-4" /> Iniciar Actualización</>
              )}
            </button>
          </>
        )}
        {isDone && (
          <button
            onClick={reset}
            className="w-full py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            Nueva actualización
          </button>
        )}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════
// FirmwareHistorialRow — fila compacta para el historial
// ══════════════════════════════════════════════════════════════════
function FirmwareHistorialRow({ job }: { job: FirmwareJobResult }) {
  const ok  = (job.resultado ?? []).filter(p => p.status === 'success').length;
  const tot = job.onuIds.length;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 text-sm">
      <div className={cn('w-2 h-2 rounded-full shrink-0', {
        'bg-amber-400 animate-pulse': job.estado === 'transfiriendo',
        'bg-emerald-400': job.estado === 'exitoso',
        'bg-red-400':     job.estado === 'fallido',
        'bg-amber-400':   job.estado === 'parcial',
        'bg-muted-foreground': job.estado === 'pendiente',
      })} />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{job.firmwareFilename}</p>
        <p className="text-xs text-muted-foreground">
          0/{job.slot}/{job.port} · {new Date(job.createdAt).toLocaleString('es-PE')}
        </p>
      </div>
      <div className="text-right">
        <span className={cn('text-xs font-medium', ESTADO_COLORS[job.estado])}>
          {ESTADO_LABELS[job.estado]}
        </span>
        <p className="text-xs text-muted-foreground">{ok}/{tot} ONUs</p>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════
// FirmwarePanel — wrapper completo con tabs upgrade / historial
// ══════════════════════════════════════════════════════════════════
export function FirmwarePanel({ olt }: { olt: OltDispositivo }) {
  const [tab, setTab] = useState<'upgrade' | 'historial'>('upgrade');

  const { data: historial = [], isLoading: loadingHist } = useQuery({
    queryKey:  ['firmware-historial', olt.id],
    queryFn:   () => oltNativoApi.historialFirmware(olt.id),
    enabled:   tab === 'historial',
    staleTime: 30_000,
  });

  const isSsh = olt.metodoConexion === 'nativo_ssh';

  if (!isSsh) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
        <Shield className="w-10 h-10 opacity-30" />
        <p className="text-sm">Firmware OMCI solo disponible para OLTs con conexión NATIVO_SSH.</p>
        <p className="text-xs">Esta OLT usa {olt.metodoConexion}.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['upgrade', 'historial'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'upgrade' ? 'Actualizar Firmware' : 'Historial'}
          </button>
        ))}
      </div>

      {tab === 'upgrade' && <FirmwareUpgradeTab olt={olt} />}

      {tab === 'historial' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loadingHist ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando historial…
            </div>
          ) : historial.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <Signal className="w-8 h-8 opacity-30" />
              <p className="text-sm">Sin historial de actualizaciones</p>
            </div>
          ) : (
            historial.map((job: FirmwareJobResult) => (
              <FirmwareHistorialRow key={job.historialId} job={job} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
