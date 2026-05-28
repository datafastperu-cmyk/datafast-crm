'use client';

import { useState, useEffect }      from 'react';
import { useForm }                   from 'react-hook-form';
import { zodResolver }               from '@hookform/resolvers/zod';
import { z }                         from 'zod';
import { useMutation, useQuery }     from '@tanstack/react-query';
import {
  X, Wifi, WifiOff, Loader2,
  CheckCircle2, AlertCircle, Server, Eye, EyeOff,
} from 'lucide-react';
import { dispositivosApi as monitoreoApi } from '@/lib/api/monitoreo';
import { mikrotikApi }               from '@/lib/api/mikrotik';
import { useToast }                  from '@/components/ui/toaster';
import { cn, parseApiError }         from '@/lib/utils';

// ─── Constantes ────────────────────────────────────────────────
const TIPOS_EQUIPO = [
  { value: 'ANTENA_AP',           label: 'Antena AP'           },
  { value: 'ROUTER_BORDE',        label: 'Router Borde'        },
  { value: 'ROUTER_ACCESO',       label: 'Router Acceso'       },
  { value: 'CAMARA_IP',           label: 'Cámara IP'           },
  { value: 'DISPOSITIVO_CRITICO', label: 'Dispositivo Crítico' },
] as const;

const FABRICANTES = [
  { value: 'MIKROTIK', label: 'MikroTik' },
  { value: 'UBIQUITI', label: 'Ubiquiti' },
  { value: 'GENERICO', label: 'Genérico' },
] as const;

// ─── Zod schema ────────────────────────────────────────────────
const IPv4 = z
  .string()
  .min(7, 'IP requerida')
  .regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Formato IPv4 inválido')
  .refine(
    (ip) => ip.split('.').every((n) => +n >= 0 && +n <= 255),
    'IPv4 fuera de rango (0-255)',
  );

const schema = z
  .object({
    nombreEmisor:   z.string().min(2, 'Mínimo 2 caracteres').max(120),
    ipAddress:      IPv4,
    routerAccesoId: z.string().optional(),
    tipoEquipo:     z.enum([
      'ANTENA_AP', 'ROUTER_BORDE', 'ROUTER_ACCESO',
      'CAMARA_IP', 'DISPOSITIVO_CRITICO',
    ]),
    fabricante:     z.enum(['MIKROTIK', 'UBIQUITI', 'GENERICO']),
    modeloNombre:   z.string().max(100).optional(),
    usuario:        z.string().optional(),
    contrasena:     z.string().optional(),
    puertoApi:      z.coerce.number().int().min(1).max(65535),
    useSsl:         z.boolean(),
    monitoreoSnmp:  z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.fabricante === 'MIKROTIK') {
      if (!v.usuario?.trim())
        ctx.addIssue({ code: 'custom', path: ['usuario'],    message: 'Requerido para MikroTik' });
      if (!v.contrasena?.trim())
        ctx.addIssue({ code: 'custom', path: ['contrasena'], message: 'Requerido para MikroTik' });
    }
  });

type FormData = z.infer<typeof schema>;

// ─── Tipos de respuesta del test ───────────────────────────────
interface ProbarResult {
  conectado: boolean;
  info?: {
    identidad:    string;
    plataforma:   string;
    version:      string;
    arquitectura: string;
    cpuLoad:      number;
    uptime:       string;
    totalMemMb:   number;
  };
  error?: string;
}

interface Props {
  onClose:        () => void;
  onSuccess:      () => void;
  dispositivoId?: string;
}

// ─── Componente principal ──────────────────────────────────────
export function DispositivoFormModal({ onClose, onSuccess, dispositivoId }: Props) {
  const isEdit                      = !!dispositivoId;
  const { toast }                   = useToast();
  const [testResult, setTestResult] = useState<ProbarResult | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const { data: routers = [] } = useQuery({
    queryKey:  ['routers-lista'],
    queryFn:   mikrotikApi.listar,
    staleTime: 60_000,
  });

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey:  ['dispositivo', dispositivoId],
    queryFn:   () => monitoreoApi.getDispositivo(dispositivoId!),
    enabled:   isEdit,
    staleTime: 0,
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      nombreEmisor:   '',
      ipAddress:      '',
      routerAccesoId: '',
      tipoEquipo:     'ANTENA_AP',
      fabricante:     'MIKROTIK',
      modeloNombre:   '',
      usuario:        '',
      contrasena:     '',
      puertoApi:      8728,
      useSsl:         false,
      monitoreoSnmp:  false,
    },
  });

  // Populate form when existing device loads
  useEffect(() => {
    if (existing) {
      reset({
        nombreEmisor:   existing.nombreEmisor,
        ipAddress:      existing.ipAddress,
        routerAccesoId: existing.routerAccesoId ?? '',
        tipoEquipo:     existing.tipoEquipo as FormData['tipoEquipo'],
        fabricante:     existing.fabricante as FormData['fabricante'],
        modeloNombre:   existing.modeloNombre ?? '',
        usuario:        existing.usuario ?? '',
        contrasena:     '***stored***',
        puertoApi:      existing.puertoApi,
        useSsl:         existing.useSsl,
        monitoreoSnmp:  existing.monitoreoSnmp,
      });
    }
  }, [existing, reset]);

  const fabricante    = watch('fabricante');
  const useSsl        = watch('useSsl');
  const monitoreoSnmp = watch('monitoreoSnmp');
  const esMikrotik    = fabricante === 'MIKROTIK';

  // Ajustar puerto por defecto al cambiar SSL
  useEffect(() => {
    setValue('puertoApi', useSsl ? 8729 : 8728);
  }, [useSsl, setValue]);

  // Limpiar resultado al cambiar fabricante
  useEffect(() => { setTestResult(null); }, [fabricante]);

  // ── Mutación: probar conexión ───────────────────────────────
  const { mutate: probar, isPending: testando } = useMutation({
    mutationFn: () => {
      const v = getValues();
      if (!v.ipAddress?.match(/^(\d{1,3}\.){3}\d{1,3}$/)) {
        return Promise.reject(new Error('Completa el campo Dirección IP antes de probar la conexión'));
      }
      return monitoreoApi.probarConexion({
        ipAddress:      v.ipAddress,
        usuario:        v.usuario   ?? '',
        contrasena:     v.contrasena ?? '',
        puertoApi:      v.puertoApi,
        useSsl:         v.useSsl,
        routerAccesoId: v.routerAccesoId ? Number(v.routerAccesoId) : undefined,
      });
    },
    onSuccess: (r) => setTestResult(r as ProbarResult),
    onError:   (e) => setTestResult({ conectado: false, error: parseApiError(e) }),
  });

  // ── Mutación: crear / actualizar ───────────────────────────
  const { mutate: guardar, isPending: guardando } = useMutation({
    mutationFn: (data: FormData) => {
      const payload = {
        nombreEmisor:   data.nombreEmisor,
        ipAddress:      data.ipAddress,
        routerAccesoId: data.routerAccesoId || undefined,
        tipoEquipo:     data.tipoEquipo,
        fabricante:     data.fabricante,
        modeloNombre:   data.modeloNombre   || undefined,
        usuario:        data.usuario        || undefined,
        contrasena:     data.contrasena     || undefined,
        puertoApi:      data.puertoApi,
        useSsl:         data.useSsl,
        monitoreoSnmp:  data.monitoreoSnmp,
      };
      return isEdit
        ? monitoreoApi.updateDispositivo(dispositivoId!, payload)
        : monitoreoApi.createDispositivo(payload);
    },
    onSuccess: () => {
      toast(isEdit ? 'Dispositivo actualizado correctamente' : 'Dispositivo registrado correctamente', { type: 'success' });
      onSuccess();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const disabled = testando || guardando || (isEdit && loadingExisting);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          'relative bg-zinc-900 border border-zinc-700/60 rounded-2xl shadow-2xl shadow-black/70',
          'w-full max-w-lg ring-1 ring-white/5',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 ring-1 ring-blue-500/10">
              <Server className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white leading-none">{isEdit ? 'Editar dispositivo' : 'Nuevo dispositivo'}</h3>
              <p className="text-[11px] text-zinc-500 mt-0.5">Módulo de Monitoreo</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={disabled}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Cuerpo ─────────────────────────────────────────── */}
        <form onSubmit={handleSubmit((d) => guardar(d))}>
          <div className="px-6 py-5 space-y-4 max-h-[66vh] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">

            {/* Nombre Emisor */}
            <Field label="Nombre emisor" error={errors.nombreEmisor?.message} required>
              <input
                {...register('nombreEmisor')}
                type="text"
                placeholder="Antena Sector Norte"
                disabled={disabled}
                className={inputCx(!!errors.nombreEmisor)}
              />
            </Field>

            {/* Dirección IP */}
            <Field label="Dirección IP" error={errors.ipAddress?.message} required>
              <input
                {...register('ipAddress')}
                type="text"
                placeholder="192.168.100.1"
                disabled={disabled}
                className={inputCx(!!errors.ipAddress)}
              />
            </Field>

            {/* Router de acceso */}
            <Field label="Router de acceso">
              <select
                {...register('routerAccesoId')}
                disabled={disabled}
                className={inputCx(false)}
              >
                <option value="">Sin asignar</option>
                {routers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre} — {r.vpnIp || r.ipGestion}
                  </option>
                ))}
              </select>
            </Field>

            {/* Tipo de equipo */}
            <Field label="Tipo de equipo" error={errors.tipoEquipo?.message} required>
              <select
                {...register('tipoEquipo')}
                disabled={disabled}
                className={inputCx(!!errors.tipoEquipo)}
              >
                {TIPOS_EQUIPO.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>

            {/* Fabricante */}
            <Field label="Fabricante" required>
              <select
                {...register('fabricante')}
                disabled={disabled}
                className={inputCx(false)}
              >
                {FABRICANTES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </Field>

            {/* Modelo */}
            <Field label="Modelo / Nombre">
              <input
                {...register('modeloNombre')}
                type="text"
                placeholder="RB 750Gr3"
                disabled={disabled}
                className={inputCx(false)}
              />
            </Field>

            {/* Separador credenciales */}
            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-zinc-800" />
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Credenciales</span>
              <div className="h-px flex-1 bg-zinc-800" />
            </div>

            {/* Usuario */}
            <Field
              label="Usuario"
              error={errors.usuario?.message}
              required={esMikrotik}
            >
              <input
                {...register('usuario')}
                type="text"
                placeholder="admin"
                disabled={disabled}
                autoComplete="off"
                className={inputCx(!!errors.usuario)}
              />
            </Field>

            {/* Contraseña */}
            <Field
              label="Contraseña"
              error={errors.contrasena?.message}
              required={esMikrotik}
            >
              <div className="relative">
                <input
                  {...register('contrasena')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  disabled={disabled}
                  autoComplete="new-password"
                  className={inputCx(!!errors.contrasena) + ' pr-10'}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showPassword
                    ? <EyeOff className="h-4 w-4" />
                    : <Eye    className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {/* Puerto API + SSL toggle */}
            <Field label="Puerto API" error={errors.puertoApi?.message}>
              <div className="flex items-center gap-3">
                <input
                  {...register('puertoApi', { valueAsNumber: true })}
                  type="number"
                  min={1}
                  max={65535}
                  disabled={disabled}
                  className={cn(inputCx(!!errors.puertoApi), 'flex-1')}
                />
                {/* SSL switch */}
                <label className="flex items-center gap-2 cursor-pointer select-none group">
                  <div className="relative">
                    <input
                      {...register('useSsl')}
                      type="checkbox"
                      className="sr-only peer"
                      disabled={disabled}
                    />
                    <div className="w-9 h-5 rounded-full bg-zinc-700 peer-checked:bg-blue-600 transition-colors group-hover:bg-zinc-600 peer-checked:group-hover:bg-blue-500" />
                    <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                  </div>
                  <span className="text-xs text-zinc-400 whitespace-nowrap">SSL</span>
                </label>
              </div>
            </Field>

            {/* SNMP Toggle */}
            <Field label="Monitoreo SNMP">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={monitoreoSnmp}
                  disabled={disabled}
                  onClick={() => setValue('monitoreoSnmp', !monitoreoSnmp, { shouldValidate: false })}
                  className={cn(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-40',
                    monitoreoSnmp ? 'bg-blue-600' : 'bg-zinc-600',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
                      monitoreoSnmp ? 'translate-x-6' : 'translate-x-1',
                    )}
                  />
                </button>
                <span className={cn('text-xs', monitoreoSnmp ? 'text-blue-400' : 'text-zinc-500')}>
                  {monitoreoSnmp ? 'Activo' : 'Inactivo'}
                </span>
              </div>
            </Field>

            {/* ── Banner de resultado del test ─────────────────── */}
            {testResult && (
              <div
                className={cn(
                  'flex items-start gap-3 p-4 rounded-xl border text-sm',
                  testResult.conectado
                    ? 'bg-emerald-950/40 border-emerald-700/40 text-emerald-300'
                    : 'bg-red-950/40 border-red-700/40 text-red-300',
                )}
              >
                {testResult.conectado
                  ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
                  : <AlertCircle  className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />}
                <div className="min-w-0">
                  {testResult.conectado ? (
                    <>
                      <p className="font-semibold text-emerald-200">Conexión exitosa</p>
                      {testResult.info && (
                        <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-emerald-400/80">
                          <dt className="text-emerald-300/70">Identidad</dt>
                          <dd className="truncate">{testResult.info.identidad}</dd>
                          <dt className="text-emerald-300/70">Plataforma</dt>
                          <dd>{testResult.info.plataforma} {testResult.info.version}</dd>
                          <dt className="text-emerald-300/70">Arquitectura</dt>
                          <dd>{testResult.info.arquitectura}</dd>
                          <dt className="text-emerald-300/70">CPU actual</dt>
                          <dd>{testResult.info.cpuLoad}%</dd>
                          <dt className="text-emerald-300/70">Uptime</dt>
                          <dd>{testResult.info.uptime}</dd>
                          <dt className="text-emerald-300/70">Memoria total</dt>
                          <dd>{testResult.info.totalMemMb} MB</dd>
                        </dl>
                      )}
                    </>
                  ) : (
                    <p className="font-medium leading-snug">{testResult.error ?? 'Error de conexión desconocido'}</p>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* ── Footer ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-zinc-700/60 bg-zinc-900/80 rounded-b-2xl">
            {/* Probar conexión (solo si no es sentinel) */}
            <button
              type="button"
              onClick={() => probar()}
              disabled={disabled || (isEdit && watch('contrasena') === '***stored***')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-all',
                'border-zinc-600 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-500',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              {testando
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Probando…</>
                : testResult?.conectado
                  ? <><Wifi className="w-3.5 h-3.5 text-emerald-400" />Conectado</>
                  : <><Wifi className="w-3.5 h-3.5" />Probar conexión</>}
            </button>

            {/* Cerrar / Guardar */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={disabled}
                className="px-4 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-40"
              >
                Cerrar
              </button>
              <button
                type="submit"
                disabled={disabled}
                className={cn(
                  'flex items-center gap-2 px-5 py-2 text-sm rounded-lg font-medium transition-all',
                  'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/30',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                {guardando
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{isEdit ? 'Guardando…' : 'Registrando…'}</>
                  : isEdit ? 'Guardar cambios' : 'Registrar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────
function inputCx(hasError: boolean) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-zinc-800/80 text-white',
    'placeholder:text-zinc-600 transition-colors',
    'focus:outline-none focus:ring-2',
    hasError
      ? 'border-red-500/60 focus:ring-red-500/30 focus:border-red-500/60'
      : 'border-zinc-700 hover:border-zinc-600 focus:ring-blue-500/30 focus:border-blue-500/50',
  );
}

function Field({
  label,
  error,
  required = false,
  children,
}: {
  label:     string;
  error?:    string;
  required?: boolean;
  children:  React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[148px_1fr] items-start gap-4">
      <span className="text-sm text-zinc-400 text-right pt-2 leading-tight">
        {label}
        {required && <span className="text-blue-400 ml-0.5">*</span>}
      </span>
      <div>
        {children}
        {error && (
          <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3 inline shrink-0" />{error}
          </p>
        )}
      </div>
    </div>
  );
}
