'use client';

import { useState }    from 'react';
import { useRouter }   from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
import {
  ArrowLeft, Zap, CheckCircle2, XCircle,
  Loader2, SkipForward, AlertTriangle, RefreshCw,
} from 'lucide-react';

import { contratosApi, redesApi, type AprovisionarDto, type ResultadoPasoFtth, type ResultadoAprovisionamiento } from '@/lib/api/contratos';
import { useToast }   from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

// ─── Schema del formulario ────────────────────────────────────
const schema = z.object({
  oltId:          z.string().uuid('Selecciona el OLT'),
  ponPort:        z.string().min(3, 'Ej: 0/1/3'),
  serialNumber:   z.string().optional(),
  perfilSmartolt: z.string().min(1, 'Selecciona el perfil'),
  vlanId:         z.coerce.number().int().min(1).max(4094),
  vlanModo:       z.enum(['access', 'trunk']).default('access'),
  routerId:       z.string().uuid('Selecciona el router'),
  segmentoId:     z.string().optional(),
  ipManual:       z.string().optional(),
  notificarWhatsApp: z.boolean().default(true),
  rollbackEnError:   z.boolean().default(true),
  omitirQueue:       z.boolean().default(false),
});
type FormValues = z.infer<typeof schema>;

// ─── Nombres de pasos ─────────────────────────────────────────
const PASO_NOMBRES = [
  'Validar contrato y recursos',
  'Asignar IP del pool',
  'Crear usuario PPPoE',
  'Configurar velocidad (Queue)',
  'Verificar firewall',
  'Detectar y aprovisionar ONU',
  'Registrar ONU en BD',
  'Activar contrato y notificar',
];

export function AprovisionarFtth({ contratoId }: { contratoId: string }) {
  const router    = useRouter();
  const { toast } = useToast();

  const [resultado, setResultado] = useState<ResultadoAprovisionamiento | null>(null);

  // ── Datos del contrato ──────────────────────────────────────
  const { data: contrato, isLoading: cargandoContrato } = useQuery({
    queryKey: ['contrato', contratoId],
    queryFn:  () => contratosApi.getById(contratoId),
  });

  // ── Recursos de red ─────────────────────────────────────────
  const { data: olts = [] }         = useQuery({ queryKey: ['olts'],      queryFn: redesApi.listOlts });
  const { data: routers = [] }      = useQuery({ queryKey: ['routers'],   queryFn: redesApi.listRouters });
  const { data: segmentos = [] }    = useQuery({ queryKey: ['segmentos'], queryFn: () => redesApi.listSegmentos() });
  const { data: perfiles = [] }     = useQuery({ queryKey: ['perfiles-smartolt'], queryFn: redesApi.listPerfilesSmartolt });

  const {
    register, handleSubmit, watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: {
      vlanModo:          'access',
      vlanId:            100,
      notificarWhatsApp: true,
      rollbackEnError:   true,
      omitirQueue:       false,
      routerId:          contrato?.routerId ?? '',
    },
  });

  const oltId = watch('oltId');

  // ── ONUs sin aprovisionar del OLT seleccionado ──────────────
  const { data: onusSinAprovi } = useQuery({
    queryKey: ['onus-sin-aprovi', oltId],
    queryFn:  () => redesApi.onusNoAprovisionadas(oltId),
    enabled:  !!oltId,
  });

  // ── Mutation de aprovisionamiento ───────────────────────────
  const { mutate: aprovisionar, isPending } = useMutation({
    mutationFn: (values: FormValues) => {
      const dto: AprovisionarDto = {
        contratoId,
        clienteId:     contrato!.clienteId,
        oltId:         values.oltId,
        ponPort:       values.ponPort,
        serialNumber:  values.serialNumber || undefined,
        perfilSmartolt: values.perfilSmartolt,
        vlanId:        values.vlanId,
        vlanModo:      values.vlanModo,
        routerId:      values.routerId,
        segmentoId:    values.segmentoId || undefined,
        ipManual:      values.ipManual   || undefined,
        notificarWhatsApp: values.notificarWhatsApp,
        rollbackEnError:   values.rollbackEnError,
        omitirQueue:       values.omitirQueue,
      };
      return contratosApi.aprovisionar(dto);
    },
    onSuccess: (res) => {
      setResultado(res);
      if (res.exitoso) {
        toast('¡Aprovisionamiento completado!', {
          type:        'success',
          description: `IP: ${res.ipAsignada} | SN: ${res.serialNumber}`,
        });
      } else {
        toast('Aprovisionamiento con errores', { type: 'error' });
      }
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  if (cargandoContrato) {
    return <div className="skeleton h-64 rounded-xl" />;
  }

  // ── PANTALLA DE RESULTADO ───────────────────────────────────
  if (resultado) {
    return (
      <ResultadoView
        resultado={resultado}
        contratoId={contratoId}
        onVolver={() => setResultado(null)}
        onVerContrato={() => router.push(`/contratos/${contratoId}`)}
        onReintentar={() => setResultado(null)}
      />
    );
  }

  // ── FORMULARIO ──────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Aprovisionamiento FTTH
          </h2>
          <p className="text-sm text-muted-foreground">
            Contrato: <strong>{contrato?.numeroContrato}</strong>
            {' · '}{contrato?.clienteNombre}
          </p>
        </div>
      </div>

      {/* Diagrama de pasos */}
      <div className="bg-card border border-border rounded-xl p-5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Los 8 pasos se ejecutarán automáticamente
        </p>
        <div className="grid grid-cols-4 gap-2">
          {PASO_NOMBRES.map((nombre, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold
                               flex items-center justify-center flex-shrink-0 mt-px text-[10px]">
                {i + 1}
              </span>
              <span className="text-muted-foreground leading-tight">{nombre}</span>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit((v) => aprovisionar(v))} className="space-y-5">

        {/* ── OLT y ONU ─────────────────────────────────────── */}
        <Section title="OLT y ONU">
          <div className="grid grid-cols-2 gap-4">
            <Field label="OLT *" error={errors.oltId?.message}>
              <select {...register('oltId')} className={inp(!!errors.oltId)}>
                <option value="">— Selecciona el OLT —</option>
                {olts.map((o) => (
                  <option key={o.id} value={o.id}>{o.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Puerto PON *" error={errors.ponPort?.message}>
              <input
                {...register('ponPort')}
                placeholder="0/1/3"
                className={inp(!!errors.ponPort)}
              />
            </Field>
          </div>

          {/* ONUs detectadas en el OLT */}
          {onusSinAprovi?.smartolt?.length > 0 && (
            <div className="p-3 bg-muted/50 rounded-lg text-xs">
              <p className="font-medium text-foreground mb-2">
                ONUs detectadas en este OLT ({onusSinAprovi.smartolt.length}):
              </p>
              <div className="flex flex-wrap gap-2">
                {onusSinAprovi.smartolt.slice(0, 8).map((o) => (
                  <button
                    type="button"
                    key={o.serial}
                    onClick={() => {
                      // Autocompletar el serial y el puerto
                      (document.querySelector('[name="serialNumber"]') as HTMLInputElement)!.value = o.serial;
                      (document.querySelector('[name="ponPort"]') as HTMLInputElement)!.value = o.pon_port;
                    }}
                    className="px-2 py-1 rounded border border-border bg-card hover:bg-muted
                               font-mono cursor-pointer transition-colors"
                  >
                    {o.serial} ({o.pon_port})
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Serial Number (SN) — dejar vacío para detectar auto">
              <input
                {...register('serialNumber')}
                placeholder="48575443ABCD1234 (opcional)"
                className={cn(inp(), 'font-mono text-xs uppercase')}
              />
            </Field>
            <Field label="Perfil SmartOLT *" error={errors.perfilSmartolt?.message}>
              <select {...register('perfilSmartolt')} className={inp(!!errors.perfilSmartolt)}>
                <option value="">— Selecciona perfil —</option>
                {perfiles.map((p) => (
                  <option key={p.id ?? p.name} value={p.name}>{p.name}</option>
                ))}
                {/* Opciones manuales como fallback */}
                {!perfiles.length && (
                  <>
                    <option value="HSI-BRIDGE-100M">HSI-BRIDGE-100M</option>
                    <option value="HSI-BRIDGE-50M">HSI-BRIDGE-50M</option>
                    <option value="HSI-BRIDGE-30M">HSI-BRIDGE-30M</option>
                    <option value="HSI-ROUTE-100M">HSI-ROUTE-100M</option>
                  </>
                )}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="VLAN ID *" error={errors.vlanId?.message}>
              <input type="number" {...register('vlanId')} className={inp(!!errors.vlanId)} />
            </Field>
            <Field label="Modo VLAN">
              <select {...register('vlanModo')} className={inp()}>
                <option value="access">Access</option>
                <option value="trunk">Trunk</option>
              </select>
            </Field>
          </div>
        </Section>

        {/* ── Red Mikrotik ──────────────────────────────────── */}
        <Section title="Mikrotik y pool IPv4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Router *" error={errors.routerId?.message}>
              <select {...register('routerId')} className={inp(!!errors.routerId)}>
                <option value="">— Selecciona router —</option>
                {routers.map((r) => (
                  <option key={r.id} value={r.id}>{r.nombre} ({r.ipGestion})</option>
                ))}
              </select>
            </Field>
            <Field label="Segmento IPv4">
              <select {...register('segmentoId')} className={inp()}>
                <option value="">— Usar IP del contrato —</option>
                {segmentos.map((s) => (
                  <option key={s.id} value={s.id}>{s.redCidr} · {s.nombre}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="IP manual (sobreescribe el pool si se especifica)">
            <input
              {...register('ipManual')}
              placeholder="192.168.1.50 (dejar vacío para usar el pool)"
              className={cn(inp(), 'font-mono text-xs')}
            />
          </Field>
        </Section>

        {/* ── Opciones avanzadas ────────────────────────────── */}
        <Section title="Opciones">
          <div className="space-y-3">
            {[
              { name: 'notificarWhatsApp', label: 'Notificar al cliente por WhatsApp al activar',
                desc: 'Envía el mensaje de bienvenida con usuario PPPoE y velocidades' },
              { name: 'rollbackEnError', label: 'Revertir automáticamente si hay error',
                desc: 'Elimina PPPoE, provisión SmartOLT y libera IP si algún paso falla' },
              { name: 'omitirQueue', label: 'Omitir configuración de Queue (debug)',
                desc: 'No configura Simple Queue ni Queue Tree en el router' },
            ].map(({ name, label, desc }) => (
              <label key={name} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  {...register(name as any)}
                  className="mt-0.5 rounded"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        </Section>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => router.back()}
            className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-2 px-6 py-2.5 text-sm rounded-lg
                       bg-primary text-primary-foreground font-semibold
                       hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Ejecutando 8 pasos...</>
              : <><Zap className="w-4 h-4" /> Iniciar aprovisionamiento</>}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Vista de resultado ───────────────────────────────────────
function ResultadoView({
  resultado, contratoId, onVolver, onVerContrato, onReintentar,
}: {
  resultado: ResultadoAprovisionamiento;
  contratoId: string;
  onVolver: () => void;
  onVerContrato: () => void;
  onReintentar: () => void;
}) {
  const { toast } = useToast();
  const { mutate: rollback, isPending: revirtiendo } = useMutation({
    mutationFn: () => contratosApi.rollback(contratoId, 'Rollback manual post-aprovisionamiento'),
    onSuccess: () => toast('Rollback ejecutado', { type: 'success' }),
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <div className="max-w-2xl space-y-5">

      {/* Resultado global */}
      <div className={cn(
        'p-5 rounded-xl border',
        resultado.exitoso
          ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'
          : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800',
      )}>
        <div className="flex items-center gap-3 mb-3">
          {resultado.exitoso
            ? <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
            : <XCircle      className="w-6 h-6 text-red-600    flex-shrink-0" />}
          <p className="font-semibold text-foreground">{resultado.mensajeFinal}</p>
        </div>

        {resultado.exitoso && (
          <div className="grid grid-cols-3 gap-3 mt-3">
            {resultado.ipAsignada && <InfoChip label="IP" value={resultado.ipAsignada} />}
            {resultado.usuarioPppoe && <InfoChip label="PPPoE" value={resultado.usuarioPppoe} />}
            {resultado.serialNumber && <InfoChip label="SN ONU" value={resultado.serialNumber} />}
          </div>
        )}

        {resultado.duracionTotalMs && (
          <p className="text-xs text-muted-foreground mt-2">
            Duración total: {(resultado.duracionTotalMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      {/* Pasos */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Detalle de los 8 pasos</p>
        </div>
        <div className="divide-y divide-border">
          {(resultado.pasos as ResultadoPasoFtth[]).map((paso) => (
            <div key={paso.paso}
                 className={cn(
                   'flex items-start gap-3 px-5 py-3.5',
                   paso.estado === 'error' && 'bg-red-50/50 dark:bg-red-950/10',
                 )}>
              {/* Icono de estado */}
              <div className="flex-shrink-0 mt-0.5">
                {paso.estado === 'ok'      && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                {paso.estado === 'error'   && <XCircle      className="w-4 h-4 text-red-600" />}
                {paso.estado === 'omitido' && <SkipForward  className="w-4 h-4 text-muted-foreground" />}
                {paso.estado === 'revertido' && <RefreshCw  className="w-4 h-4 text-orange-500" />}
              </div>

              {/* Contenido */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground">#{paso.paso}</span>
                  <p className={cn(
                    'text-sm font-medium',
                    paso.estado === 'error' ? 'text-red-700 dark:text-red-400' : 'text-foreground',
                  )}>
                    {paso.nombre}
                  </p>
                  {paso.duracionMs != null && (
                    <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                      {paso.duracionMs}ms
                    </span>
                  )}
                </div>
                <p className={cn(
                  'text-xs mt-0.5 leading-relaxed',
                  paso.estado === 'error'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-muted-foreground',
                )}>
                  {paso.detalle}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap gap-3 justify-end">
        {!resultado.exitoso && !resultado.rollbackEjecutado && (
          <button
            onClick={() => rollback()}
            disabled={revirtiendo}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg
                       border border-destructive text-destructive
                       hover:bg-destructive/10 transition-colors disabled:opacity-50"
          >
            {revirtiendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Hacer rollback manual
          </button>
        )}
        {!resultado.exitoso && (
          <button onClick={onReintentar}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg
                       border border-input hover:bg-muted transition-colors">
            <AlertTriangle className="w-3.5 h-3.5" /> Reintentar
          </button>
        )}
        <button onClick={onVerContrato}
          className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg
                     bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors">
          Ver contrato
        </button>
      </div>
    </div>
  );
}

// ─── Micro-componentes ────────────────────────────────────────
function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-mono font-bold text-foreground">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground pb-2 border-b border-border">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, error, children }: {
  label: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function inp(hasError = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
