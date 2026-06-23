'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  X, Loader2, CheckCircle2, AlertCircle, ArrowRight, SkipForward,
  Wifi, Cable, Server, Network, RotateCcw, ScanLine, ChevronLeft,
  Radio,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { migracionApi, type MigracionResultado, type PasoMigracion } from '@/lib/api/migracion';
import { redesApi } from '@/lib/api/contratos';
import { smartoltApi } from '@/lib/api/smartolt';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { parseApiError, cn } from '@/lib/utils';

// ── Schema ────────────────────────────────────────────────────
const schema = z.object({
  tipoOlt:       z.enum(['smartolt', 'nativo']),
  oltId:         z.string().optional(),
  oltNativoId:   z.string().optional(),
  ponPort:       z.string().min(1, 'Requerido (ej: 0/1/3)'),
  serialNumber:  z.string().optional(),
  perfilOlt:     z.string().min(1, 'Requerido'),
  vlanId:        z.coerce.number().int().min(1).max(4094),
  vlanModo:      z.enum(['access', 'trunk']).default('access'),
  routerFtthId:  z.string().min(1, 'Selecciona un router FTTH'),
  segmentoFtthId: z.string().min(1, 'Selecciona un segmento FTTH'),
  ipManual:      z.string().optional(),
  omitirQueue:   z.boolean().default(false),
  rollbackEnError: z.boolean().default(true),
});

type FormData = z.infer<typeof schema>;

const INPUT_CLS =
  'w-full px-3 py-2.5 text-sm rounded-lg border border-input bg-background ' +
  'text-foreground placeholder:text-muted-foreground ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors';

// ── Helpers ───────────────────────────────────────────────────
function Field({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function PasoRow({ paso }: { paso: PasoMigracion }) {
  const icons = {
    ok:        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />,
    error:     <AlertCircle  className="w-4 h-4 text-destructive  flex-shrink-0" />,
    omitido:   <SkipForward  className="w-4 h-4 text-muted-foreground flex-shrink-0" />,
    revertido: <RotateCcw    className="w-4 h-4 text-amber-500   flex-shrink-0" />,
  };
  const colors = {
    ok:        'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20',
    error:     'border-destructive/30 bg-destructive/5',
    omitido:   'border-border bg-muted/30',
    revertido: 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20',
  };

  return (
    <div className={cn('flex items-start gap-3 p-3 rounded-lg border', colors[paso.estado])}>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-xs font-mono text-muted-foreground w-5 text-right">{paso.paso}.</span>
        {icons[paso.estado]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground leading-tight">{paso.nombre}</p>
        <p className="text-xs text-muted-foreground mt-0.5 break-words">{paso.detalle}</p>
        {paso.duracionMs != null && (
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">{paso.duracionMs} ms</p>
        )}
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────
interface Props {
  contratoId: string;
  clienteId:  string;
  onClose:    () => void;
  onSuccess?: () => void;
}

export function MigracionWizardModal({ contratoId, clienteId, onClose, onSuccess }: Props) {
  const [fase, setFase] = useState<'scan' | 'form' | 'result'>('scan');
  const [resultado, setResultado] = useState<MigracionResultado | null>(null);

  // ── Estado del paso scan ──────────────────────────────────────
  const [scanTipoOlt, setScanTipoOlt]     = useState<'smartolt' | 'nativo'>('nativo');
  const [scanOltId,   setScanOltId]       = useState('');
  const [scanSlot,    setScanSlot]        = useState('');
  const [scanPort,    setScanPort]        = useState('');
  const [scanEnabled, setScanEnabled]     = useState(false);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver:      zodResolver(schema),
    defaultValues: {
      tipoOlt:         'smartolt',
      vlanModo:        'access',
      vlanId:          100,
      omitirQueue:     false,
      rollbackEnError: true,
    },
  });

  const tipoOlt       = watch('tipoOlt');
  const routerFtthId  = watch('routerFtthId');

  // OLT data
  const { data: oltsSmartolt = [] } = useQuery({
    queryKey: ['olts-smartolt'],
    queryFn:  () => smartoltApi.listarOlts(),
  });
  const { data: oltsNativos = [] } = useQuery({
    queryKey: ['olts-nativo'],
    queryFn:  () => oltNativoApi.listar(),
  });

  // Routers
  const { data: routers = [] } = useQuery({
    queryKey: ['routers-list'],
    queryFn:  () => redesApi.listRouters(),
  });

  // Segmentos FTTH del router seleccionado
  const { data: segmentosRaw = [] } = useQuery({
    queryKey: ['segmentos-router', routerFtthId],
    queryFn:  () => redesApi.listSegmentos(routerFtthId!),
    enabled:  !!routerFtthId,
  });
  const segmentosFtth = (segmentosRaw as any[]).filter(
    (s: any) => !s.tipoServicio || s.tipoServicio === 'ftth',
  );

  // ── Discover ONUs (nativo SSH) ────────────────────────────────
  const {
    data:      discoverData,
    isFetching: scanning,
    refetch:   doScan,
    error:     scanError,
  } = useQuery({
    queryKey:  ['discover-onus-migration', scanOltId, scanSlot, scanPort],
    queryFn:   () => oltNativoApi.discoverOnus(
      scanOltId,
      scanSlot ? Number(scanSlot) : undefined,
      scanPort ? Number(scanPort) : undefined,
    ),
    enabled:   scanEnabled && scanTipoOlt === 'nativo' && !!scanOltId,
    staleTime: 0,
  });
  const onusDescubiertas = discoverData?.onus ?? [];

  const handleSelectOnu = (onu: { sn: string; slot: number; port: number }) => {
    setValue('tipoOlt',      scanTipoOlt);
    setValue('oltNativoId',  scanOltId);
    setValue('ponPort',      `0/${onu.slot}/${onu.port}`);
    setValue('serialNumber', onu.sn);
    setFase('form');
  };

  const { mutate, isPending } = useMutation({
    mutationFn: (data: FormData) => migracionApi.migrarWispAFtth({
      contratoId,
      clienteId,
      oltId:           tipoOlt === 'smartolt' ? data.oltId  : undefined,
      oltDispositivoId: tipoOlt === 'nativo'  ? data.oltNativoId : undefined,
      ponPort:         data.ponPort,
      serialNumber:    data.serialNumber || undefined,
      perfilOlt:       data.perfilOlt,
      vlanId:          data.vlanId,
      vlanModo:        data.vlanModo,
      routerFtthId:    data.routerFtthId,
      segmentoFtthId:  data.segmentoFtthId,
      ipManual:        data.ipManual || undefined,
      omitirQueue:     data.omitirQueue,
      rollbackEnError: data.rollbackEnError,
    }),
    onSuccess: (res) => {
      setResultado(res);
      setFase('result');
      if (res.exitoso) onSuccess?.();
    },
    onError: (err) => {
      setResultado({
        pasos: [],
        exitoso: false,
        contratoId,
        mensajeFinal: parseApiError(err),
        rollbackEjecutado: false,
      });
      setFase('result');
    },
  });

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label="Migración de contrato" className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Cable className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Migrar WISP → FTTH</h2>
              {fase !== 'result' && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={cn('text-[11px] font-medium', fase === 'scan' ? 'text-primary' : 'text-muted-foreground')}>
                    1. Escanear ONU
                  </span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground/50" />
                  <span className={cn('text-[11px] font-medium', fase === 'form' ? 'text-primary' : 'text-muted-foreground')}>
                    2. Configurar migración
                  </span>
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── PASO 1: ESCANEAR ONU ── */}
          {fase === 'scan' && (
            <div className="space-y-4">
              {/* Tipo OLT */}
              <Field label="Tipo de OLT">
                <div className="flex gap-2">
                  {([['nativo', 'Nativo SSH', Network], ['smartolt', 'SmartOLT API', Server]] as const).map(
                    ([val, lbl, Icon]) => (
                      <button key={val} type="button"
                        onClick={() => { setScanTipoOlt(val); setScanOltId(''); setScanEnabled(false); }}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm rounded-lg border transition-all',
                          scanTipoOlt === val
                            ? 'border-primary bg-primary/10 text-primary font-medium'
                            : 'border-input bg-background text-foreground hover:bg-accent',
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" /> {lbl}
                      </button>
                    ),
                  )}
                </div>
              </Field>

              {/* OLT */}
              <Field label={scanTipoOlt === 'nativo' ? 'OLT (SSH)' : 'OLT (SmartOLT)'}>
                <select
                  value={scanOltId}
                  onChange={e => { setScanOltId(e.target.value); setScanEnabled(false); }}
                  className={INPUT_CLS}
                >
                  <option value="">— Seleccionar OLT —</option>
                  {(scanTipoOlt === 'nativo' ? oltsNativos : oltsSmartolt as any[]).map((o: any) => (
                    <option key={o.id} value={o.id}>
                      {o.nombre}{o.ipGestion ? ` — ${o.ipGestion}` : ''}{o.modelo ? ` (${o.modelo})` : ''}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Filtro slot/port opcional (solo nativo) */}
              {scanTipoOlt === 'nativo' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Slot (opcional)">
                    <input value={scanSlot} onChange={e => setScanSlot(e.target.value)}
                      placeholder="1" type="number" min={0} className={INPUT_CLS} />
                  </Field>
                  <Field label="Puerto PON (opcional)">
                    <input value={scanPort} onChange={e => setScanPort(e.target.value)}
                      placeholder="3" type="number" min={0} className={INPUT_CLS} />
                  </Field>
                </div>
              )}

              {/* Botón escanear */}
              {scanTipoOlt === 'nativo' ? (
                <button
                  type="button"
                  disabled={!scanOltId || scanning}
                  onClick={() => { setScanEnabled(true); doScan(); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-sm rounded-lg
                             bg-primary text-primary-foreground font-medium hover:bg-primary/90
                             transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {scanning
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Escaneando…</>
                    : <><ScanLine className="w-4 h-4" /> Escanear ONUs</>
                  }
                </button>
              ) : (
                <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  El escaneo automático no está disponible para SmartOLT API. Selecciona la OLT y continúa manualmente.
                </div>
              )}

              {/* Error escaneo */}
              {scanError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" /> Error al escanear: {(scanError as any)?.message}
                </p>
              )}

              {/* Lista de ONUs descubiertas */}
              {!scanning && onusDescubiertas.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{onusDescubiertas.length} ONU(s) detectadas — selecciona una:</p>
                  {onusDescubiertas.map((onu) => (
                    <button
                      key={onu.sn}
                      type="button"
                      onClick={() => handleSelectOnu(onu)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-border
                                 hover:border-primary hover:bg-primary/5 transition-all text-left group"
                    >
                      <div className="flex items-center gap-3">
                        <Radio className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                        <div>
                          <p className="text-sm font-mono font-medium text-foreground">{onu.sn}</p>
                          <p className="text-[11px] text-muted-foreground">Puerto: 0/{onu.slot}/{onu.port}</p>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </button>
                  ))}
                </div>
              )}

              {/* Sin ONUs */}
              {!scanning && scanEnabled && onusDescubiertas.length === 0 && !scanError && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  No se encontraron ONUs sin aprovisionar en esta OLT.
                </p>
              )}
            </div>
          )}

          {/* ── RESULTADO ── */}
          {fase === 'result' && resultado && (
            <div className="space-y-4">
              {/* Resumen */}
              <div className={cn(
                'flex items-start gap-3 p-4 rounded-xl border',
                resultado.exitoso
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30'
                  : 'border-destructive/30 bg-destructive/5',
              )}>
                {resultado.exitoso
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  : <AlertCircle  className="w-5 h-5 text-destructive   flex-shrink-0 mt-0.5" />
                }
                <div>
                  <p className="text-sm font-semibold text-foreground">{resultado.mensajeFinal}</p>
                  {resultado.exitoso && resultado.ipFtth && (
                    <p className="text-xs text-muted-foreground mt-1">
                      IP FTTH: <span className="font-mono font-medium text-foreground">{resultado.ipFtth}</span>
                      {resultado.serialNumber && (
                        <> · ONU: <span className="font-mono font-medium text-foreground">{resultado.serialNumber}</span></>
                      )}
                    </p>
                  )}
                  {resultado.rollbackEjecutado && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" /> Rollback ejecutado — servicio restaurado
                    </p>
                  )}
                  {resultado.duracionTotalMs != null && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Duración total: {(resultado.duracionTotalMs / 1000).toFixed(1)} s
                    </p>
                  )}
                </div>
              </div>

              {/* Pasos */}
              {resultado.pasos.length > 0 && (
                <div className="space-y-2">
                  {resultado.pasos.map((p) => <PasoRow key={p.paso} paso={p} />)}
                </div>
              )}
            </div>
          )}

          {/* ── PASO 2: FORMULARIO ── */}
          {fase === 'form' && (
            <form id="migracion-form" onSubmit={handleSubmit((d) => mutate(d))} className="space-y-4">

              {/* Tipo OLT */}
              <Field label="Tipo de OLT">
                <div className="flex gap-2">
                  {([['smartolt', 'SmartOLT API', Server], ['nativo', 'Nativo SSH', Network]] as const).map(
                    ([val, lbl, Icon]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setValue('tipoOlt', val)}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm rounded-lg border transition-all',
                          tipoOlt === val
                            ? 'border-primary bg-primary/10 text-primary font-medium'
                            : 'border-input bg-background text-foreground hover:bg-accent',
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" /> {lbl}
                      </button>
                    ),
                  )}
                </div>
              </Field>

              {/* OLT SmartOLT */}
              {tipoOlt === 'smartolt' && (
                <Field label="OLT (SmartOLT)" error={errors.oltId?.message}>
                  <select {...register('oltId')} className={INPUT_CLS}>
                    <option value="">— Seleccionar OLT —</option>
                    {(oltsSmartolt as any[]).map((o: any) => (
                      <option key={o.id} value={o.id}>
                        {o.nombre}{o.marca ? ` — ${o.marca}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {/* OLT Nativo */}
              {tipoOlt === 'nativo' && (
                <Field label="OLT Dispositivo (SSH)" error={errors.oltNativoId?.message}>
                  <select {...register('oltNativoId')} className={INPUT_CLS}>
                    <option value="">— Seleccionar OLT —</option>
                    {(oltsNativos as any[]).map((o: any) => (
                      <option key={o.id} value={o.id}>
                        {o.nombre} — {o.ipGestion}{o.modelo ? ` (${o.modelo})` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {/* Puerto PON */}
              <Field label="Puerto PON *" hint="Formato: frame/slot/port — ej: 0/1/3" error={errors.ponPort?.message}>
                <input {...register('ponPort')} placeholder="0/1/3" className={INPUT_CLS} />
              </Field>

              {/* Serial ONU */}
              <Field label="Serial ONU" hint="Opcional — se auto-detecta si se omite">
                <input {...register('serialNumber')} placeholder="48575443ABCD1234" className={INPUT_CLS} />
              </Field>

              {/* Perfil OLT */}
              <Field label="Perfil de servicio OLT *" hint="Nombre exacto del perfil en la OLT" error={errors.perfilOlt?.message}>
                <input {...register('perfilOlt')} placeholder="HSI-100M" className={INPUT_CLS} />
              </Field>

              {/* VLAN */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="VLAN ID *" error={errors.vlanId?.message}>
                  <input {...register('vlanId')} type="number" min={1} max={4094} className={INPUT_CLS} />
                </Field>
                <Field label="Modo VLAN">
                  <select {...register('vlanModo')} className={INPUT_CLS}>
                    <option value="access">Access</option>
                    <option value="trunk">Trunk</option>
                  </select>
                </Field>
              </div>

              {/* Router FTTH */}
              <Field label="Router MikroTik FTTH *" error={errors.routerFtthId?.message}>
                <select {...register('routerFtthId')} className={INPUT_CLS}>
                  <option value="">— Seleccionar router —</option>
                  {(routers as any[]).map((r: any) => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
                </select>
              </Field>

              {/* Segmento FTTH */}
              <Field
                label="Pool IPv4 FTTH *"
                hint={!routerFtthId ? '* Selecciona un router primero' : undefined}
                error={errors.segmentoFtthId?.message}
              >
                <select
                  {...register('segmentoFtthId')}
                  disabled={!routerFtthId}
                  className={cn(INPUT_CLS, !routerFtthId && 'opacity-50 cursor-not-allowed')}
                >
                  <option value="">
                    {routerFtthId ? 'Seleccionar segmento FTTH…' : '— Elige un router primero —'}
                  </option>
                  {segmentosFtth.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}{s.redCidr ? ` — ${s.redCidr}` : ''}
                      {s.ipsDisponibles != null ? ` (${s.ipsDisponibles} disp.)` : ''}
                    </option>
                  ))}
                </select>
              </Field>

              {/* IP Manual */}
              <Field label="IP Manual FTTH" hint="Opcional — sobreescribe la asignación automática">
                <input {...register('ipManual')} placeholder="192.168.10.50" className={INPUT_CLS} />
              </Field>

              {/* Opciones */}
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...register('omitirQueue')}
                    className="rounded border-input w-3.5 h-3.5" />
                  <span className="text-xs text-foreground">Omitir configuración de cola (Queue)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...register('rollbackEnError')}
                    className="rounded border-input w-3.5 h-3.5" />
                  <span className="text-xs text-foreground">Rollback automático si hay error</span>
                </label>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex-shrink-0">
          {fase === 'result' ? (
            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 py-2.5 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cerrar
              </button>
              {resultado && !resultado.exitoso && (
                <button onClick={() => { setResultado(null); setFase('form'); }}
                  className="flex-1 py-2.5 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                  Reintentar
                </button>
              )}
            </div>
          ) : fase === 'scan' ? (
            <div className="flex gap-3">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cancelar
              </button>
              {scanTipoOlt === 'smartolt' && scanOltId && (
                <button type="button" onClick={() => { setValue('tipoOlt', 'smartolt'); setValue('oltId', scanOltId); setFase('form'); }}
                  className="flex-1 py-2.5 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
                  <ArrowRight className="w-4 h-4" /> Continuar manual
                </button>
              )}
            </div>
          ) : (
            <div className="flex gap-3">
              <button type="button" onClick={() => setFase('scan')}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                <ChevronLeft className="w-4 h-4" /> Volver
              </button>
              <button
                type="submit"
                form="migracion-form"
                disabled={isPending}
                className="flex-1 py-2.5 text-sm rounded-lg bg-primary text-primary-foreground
                           font-medium hover:bg-primary/90 transition-colors
                           disabled:opacity-60 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
              >
                {isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Migrando…</>
                  : <><ArrowRight className="w-4 h-4" /> Iniciar migración</>
                }
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
