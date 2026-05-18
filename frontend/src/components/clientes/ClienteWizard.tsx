'use client';

import { useState } from 'react';
import { useRouter }         from 'next/navigation';
import { useForm }           from 'react-hook-form';
import { zodResolver }       from '@hookform/resolvers/zod';
import { z }                 from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Loader2, Search, CheckCircle2, AlertCircle, ChevronRight, ChevronLeft,
  User, Wifi, CreditCard, Bell, Trash2,
  MapPin, Lock, Calendar, Navigation, Server, Radio,
  Check, Building2,
} from 'lucide-react';

import { clientesApi }                       from '@/lib/api/clientes';
import { contratosApi, redesApi, planesApi } from '@/lib/api/contratos';
import { useToast }                          from '@/components/ui/toaster';
import { parseApiError, cn }                 from '@/lib/utils';
import { MOCK_PLANES, MOCK_ROUTERS }         from '@/data/clientes.mock';

// ── Schemas ───────────────────────────────────────────────────
const step1Schema = z.object({
  idCliente:       z.string().optional(),
  passwordPortal:  z.string().optional(),
  tipoDocumento:   z.string().optional(),
  numeroDocumento: z.string().min(6, 'Identificación requerida'),
  nombres:         z.string().min(2, 'Nombres requeridos'),
  apellidoPaterno: z.string().min(2, 'Apellido paterno requerido'),
  apellidoMaterno: z.string().optional(),
  direccion:       z.string().optional(),
  ubicacionId:     z.string().optional(),
  departamento:    z.string().optional(),
  provincia:       z.string().optional(),
  distrito:        z.string().optional(),
  telefonoFijo:    z.string().optional(),
  telefono:        z.string().min(7, 'Teléfono requerido'),
  whatsapp:        z.string().optional(),
  email:           z.string().email('Email inválido').optional().or(z.literal('')),
});

const step2Schema = z.object({
  plantillaId:        z.string().optional(),
  tipoFacturacion:    z.string().optional(),
  diaPago:            z.string().optional(),
  crearFactura:       z.string().optional(),
  tipoImpuesto:       z.string().optional(),
  diasGracia:         z.string().optional(),
  aplicarCorte:       z.string().optional(),
  fechaFija:          z.string().optional(),
  aplicarMora:        z.boolean().optional(),
  aplicarReconexion:  z.boolean().optional(),
  impuesto1:          z.coerce.number().min(0).max(100).optional(),
  impuesto2:          z.coerce.number().min(0).max(100).optional(),
  impuesto3:          z.coerce.number().min(0).max(100).optional(),
  avisosNuevaFactura: z.string().optional(),
  avisoPantalla:      z.string().optional(),
  canalRecordatorio:  z.string().optional(),
  recordatorio1:      z.string().optional(),
  recordatorio2:      z.string().optional(),
  recordatorio3:      z.string().optional(),
});

const step3Schema = z.object({
  // Configuración de servicio
  routerId:         z.string().optional(),
  excluirFirewall:  z.boolean().optional(),
  perfilId:         z.string().optional(),
  descripcion:      z.string().optional(),
  costo:            z.coerce.number().optional(),
  tipoIpv4:         z.string().optional(),
  mac:              z.string().optional(),
  userPppHs:        z.string().optional(),
  passwordPppHs:    z.string().optional(),
  routes:           z.string().optional(),
  cajaNapId:        z.string().optional(),
  puertoNapId:      z.string().optional(),
  // Instalación
  direccion:        z.string().optional(),
  coordenadas:      z.string().optional(),
  fechaInstalacion: z.string().optional(),
  // Equipo receptor
  conectadoAId:     z.string().optional(),
  ipAdministracion: z.string().optional(),
  tipoAntena:       z.string().optional(),
});

type S1 = z.infer<typeof step1Schema>;
type S2 = z.infer<typeof step2Schema>;
type S3 = z.infer<typeof step3Schema>;

// ── Mock data ─────────────────────────────────────────────────
const MOCK_UBICACIONES = [
  { id: 'loc-1', nombre: 'Piura — Piura — Piura' },
  { id: 'loc-2', nombre: 'Piura — Piura — Castilla' },
  { id: 'loc-3', nombre: 'Piura — Piura — 26 de Octubre' },
  { id: 'loc-4', nombre: 'Piura — Sullana — Sullana' },
  { id: 'loc-5', nombre: 'Piura — Sullana — Bellavista' },
  { id: 'loc-6', nombre: 'Piura — Talara — Pariñas' },
  { id: 'loc-7', nombre: 'Piura — Morropón — Chulucanas' },
  { id: 'loc-8', nombre: 'Piura — Paita — Paita' },
];

const MOCK_PLANTILLAS = [
  { id: 'p1', nombre: 'Residencial Básico' },
  { id: 'p2', nombre: 'Residencial Premium' },
  { id: 'p3', nombre: 'Empresarial' },
];

const MOCK_PERFILES = [
  { id: 'prf-1', nombre: '10 Mbps — Básico' },
  { id: 'prf-2', nombre: '20 Mbps — Estándar' },
  { id: 'prf-3', nombre: '30 Mbps — Plus' },
  { id: 'prf-4', nombre: '50 Mbps — Premium' },
  { id: 'prf-5', nombre: '100 Mbps — Ultra' },
  { id: 'prf-6', nombre: '200 Mbps — Fibra' },
  { id: 'prf-7', nombre: '300 Mbps — Fibra Plus' },
];

const MOCK_CAJAS_NAP = [
  { id: '',      nombre: 'Ninguno' },
  { id: 'nap-1', nombre: 'NAP-01 Malvinas' },
  { id: 'nap-2', nombre: 'NAP-02 Loreto' },
  { id: 'nap-3', nombre: 'NAP-03 Castilla' },
  { id: 'nap-4', nombre: 'NAP-04 Norte' },
];

const MOCK_TIPO_ANTENA = [
  { value: 'otro',     label: 'Otro' },
  { value: 'ubiquiti', label: 'Ubiquiti' },
  { value: 'mikrotik', label: 'MikroTik' },
  { value: 'tplink',   label: 'TP-Link' },
  { value: 'cambium',  label: 'Cambium Networks' },
  { value: 'mimosa',   label: 'Mimosa' },
];

// ── Steps ─────────────────────────────────────────────────────
const STEPS = [
  { label: 'Datos Personales',            short: 'Personal',    icon: User },
  { label: 'Facturación y Recordatorios', short: 'Facturación', icon: CreditCard },
  { label: 'Servicios',                   short: 'Servicios',   icon: Wifi },
];

// ── UI helpers ────────────────────────────────────────────────
function Section({ title, subtitle, icon: Icon, children }: {
  title: string; subtitle?: string; icon?: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden h-fit">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        )}
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, error, hint, children }: {
  label: string; error?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint  && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />{error}
        </p>
      )}
    </div>
  );
}

function inputCls(err = false) {
  return cn(
    'w-full px-3 py-2.5 text-sm rounded-lg border bg-background transition-all duration-150',
    'placeholder:text-muted-foreground/60',
    'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
    err ? 'border-destructive bg-destructive/5' : 'border-input hover:border-muted-foreground/40',
  );
}

function Grid({ cols = 2, children }: { cols?: 2 | 3; children: React.ReactNode }) {
  return (
    <div className={cn('grid gap-4', cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
      {children}
    </div>
  );
}

function FormRow({ label, required, hint, hintColor = 'amber', children }: {
  label: string; required?: boolean; hint?: string;
  hintColor?: 'amber' | 'gray'; children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-6 px-8 py-3">
      <span className="w-44 text-right text-sm text-foreground pt-2.5 flex-shrink-0 leading-tight">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      <div className="flex-1 min-w-0">
        {children}
        {hint && (
          <p className={cn('text-xs mt-1', hintColor === 'amber' ? 'text-amber-500' : 'text-muted-foreground')}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent',
        'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        checked ? 'bg-primary' : 'bg-border',
      )}
    >
      <span className={cn(
        'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200',
        checked ? 'translate-x-5' : 'translate-x-0',
      )} />
    </button>
  );
}

// ── Stepper ───────────────────────────────────────────────────
function StepperHeader({ step }: { step: number }) {
  const progress = Math.round((step / (STEPS.length - 1)) * 100);
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between max-w-xs mx-auto sm:max-w-none">
        {STEPS.map((s, i) => {
          const Icon   = s.icon;
          const done   = i < step;
          const active = i === step;
          return (
            <div key={i} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <div className={cn(
                  'w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300',
                  done   ? 'bg-primary border-primary text-primary-foreground' :
                  active ? 'border-primary text-primary bg-primary/5 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]' :
                           'border-border text-muted-foreground',
                )}>
                  {done ? <Check className="w-4 h-4" strokeWidth={3} /> : <Icon className="w-4 h-4" />}
                </div>
                <span className={cn(
                  'text-[10px] font-semibold hidden sm:block',
                  active ? 'text-primary' : done ? 'text-foreground' : 'text-muted-foreground',
                )}>
                  {s.short}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 mx-2 mb-5 h-0.5 rounded-full overflow-hidden bg-border">
                  <div
                    className="h-full bg-primary transition-all duration-500 ease-out"
                    style={{ width: i < step ? '100%' : '0%' }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Paso {step + 1} de {STEPS.length} — {STEPS[step].label}</span>
          <span className="font-semibold text-primary">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function NavButtons({ onBack, submitLabel = 'Siguiente', isFirst }: {
  onBack?: () => void; submitLabel?: string; isFirst?: boolean;
}) {
  return (
    <div className="flex justify-between pt-2">
      <button
        type="button"
        onClick={onBack}
        disabled={isFirst}
        className={cn(
          'flex items-center gap-2 px-4 py-2.5 text-sm rounded-lg border border-input',
          'text-muted-foreground hover:text-foreground hover:bg-accent',
          'transition-all duration-150 disabled:opacity-0 disabled:pointer-events-none',
        )}
      >
        <ChevronLeft className="w-4 h-4" /> Atrás
      </button>
      <button
        type="submit"
        className="flex items-center gap-2 px-6 py-2.5 text-sm rounded-lg font-medium
                   bg-primary text-primary-foreground hover:bg-primary/90
                   transition-all duration-150 shadow-sm"
      >
        {submitLabel} <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────
export function ClienteWizard() {
  const router    = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [s1, setS1] = useState<S1 | null>(null);
  const [s2, setS2] = useState<S2 | null>(null);
  const [s3, setS3] = useState<S3 | null>(null);

  const { mutateAsync: crearCliente  } = useMutation({ mutationFn: clientesApi.create });
  const { mutateAsync: crearContrato } = useMutation({ mutationFn: contratosApi.create });

  const handleRegistrar = async (data: S3) => {
    if (!s1) return;
    const cliente = await crearCliente({
      tipoDocumento:   (s1.tipoDocumento as any) || 'dni',
      numeroDocumento: s1.numeroDocumento,
      nombres:         s1.nombres,
      apellidoPaterno: s1.apellidoPaterno,
      apellidoMaterno: s1.apellidoMaterno || undefined,
      telefono:        s1.telefono,
      whatsapp:        (s1 as any).whatsapp || undefined,
      email:           s1.email || undefined,
      direccion:       s1.direccion || '',
      tipoServicio:    'ftth',
    });
    await crearContrato({
      clienteId:      cliente.id,
      planId:         data.perfilId        || undefined,
      routerId:       data.routerId        || undefined,
      fechaInicio:    data.fechaInstalacion || new Date().toISOString().split('T')[0],
      diaFacturacion: s2?.diaPago ? parseInt(s2.diaPago) : undefined,
      usuarioPppoe:   data.userPppHs       || undefined,
      passwordPppoe:  data.passwordPppHs   || undefined,
    });
    toast('Cliente registrado', { type: 'success' });
    router.push(`/clientes/${cliente.id}`);
  };

  return (
    <div className="w-full space-y-5">
      <StepperHeader step={step} />

      {step === 0 && (
        <Step1Form initial={s1} onNext={(d) => { setS1(d); setStep(1); }} />
      )}
      {step === 1 && (
        <Step2Form initial={s2} onBack={() => setStep(0)} onNext={(d) => { setS2(d); setStep(2); }} />
      )}
      {step === 2 && (
        <Step3Form
          initial={s3}
          direccionDefault={s1?.direccion}
          onBack={() => setStep(1)}
          onSubmit={async (d) => { setS3(d); await handleRegistrar(d); }}
        />
      )}
    </div>
  );
}

// ── Step 1: Datos Personales ──────────────────────────────────
function Step1Form({ initial, onNext }: { initial: S1 | null; onNext: (d: S1) => void }) {
  const { toast } = useToast();
  const [reniecStatus, setReniecStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [reniecMsg,    setReniecMsg]    = useState('');

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<S1>({
    resolver:      zodResolver(step1Schema),
    defaultValues: initial ?? {},
  });

  const consultarReniec = async () => {
    const doc = watch('numeroDocumento')?.trim();
    if (!doc || doc.length < 6) { toast('Ingresa un número de identificación válido', { type: 'warning' }); return; }
    setReniecStatus('loading');
    try {
      const datos = await clientesApi.consultarReniec(doc);
      setValue('nombres',         datos.nombres         || '', { shouldDirty: true });
      setValue('apellidoPaterno', datos.apellidoPaterno || '', { shouldDirty: true });
      setValue('apellidoMaterno', datos.apellidoMaterno || '', { shouldDirty: true });
      const nombre = [datos.nombres, datos.apellidoPaterno, datos.apellidoMaterno].filter(Boolean).join(' ');
      setReniecStatus('ok');
      setReniecMsg(nombre);
    } catch (err) {
      setReniecStatus('error');
      setReniecMsg(parseApiError(err));
    }
  };

  return (
    <form onSubmit={handleSubmit(onNext)}>
      <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border/50">

        {/* ID cliente */}
        <FormRow label="ID cliente" hint="Dejar en blanco para que sea automático.">
          <input {...register('idCliente')} placeholder="100" className={inputCls()} />
        </FormRow>

        {/* Contraseña Portal */}
        <FormRow label="Contraseña Portal" hint="Dejar en blanco para que sea automático.">
          <input {...register('passwordPortal')} placeholder="4243Tdp" className={inputCls()} />
        </FormRow>

        {/* Nº Identificación */}
        <FormRow label="Nº Identificación" hint="CEDULA, DNI, RUC, CUIT, NIT, SAT, RUT, RTN, ETC.">
          <div className="flex gap-2">
            <input
              {...register('numeroDocumento')}
              placeholder="223456634"
              className={inputCls(!!errors.numeroDocumento)}
            />
            <button
              type="button"
              onClick={consultarReniec}
              disabled={reniecStatus === 'loading'}
              title="Consultar RENIEC"
              className="flex-shrink-0 px-3 rounded-lg border border-input bg-muted
                         hover:bg-muted/70 transition-colors disabled:opacity-50"
            >
              {reniecStatus === 'loading'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Search  className="w-4 h-4" />}
            </button>
          </div>
          {errors.numeroDocumento && (
            <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.numeroDocumento.message}
            </p>
          )}
          {reniecStatus !== 'idle' && (
            <div className={cn(
              'flex items-center gap-1.5 mt-2 text-xs rounded-lg px-3 py-2',
              reniecStatus === 'ok'
                ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400',
            )}>
              {reniecStatus === 'ok'
                ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                : <AlertCircle  className="w-3.5 h-3.5 flex-shrink-0" />}
              {reniecMsg}
            </div>
          )}
        </FormRow>

        {/* Nombres */}
        <FormRow label="Nombres" required hintColor="gray">
          <input
            {...register('nombres')}
            placeholder="Juan Carlos"
            className={inputCls(!!errors.nombres)}
          />
          {errors.nombres && (
            <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.nombres.message}
            </p>
          )}
        </FormRow>

        {/* Apellido Paterno */}
        <FormRow label="Apellido Paterno" required hintColor="gray">
          <input
            {...register('apellidoPaterno')}
            placeholder="Pérez"
            className={inputCls(!!errors.apellidoPaterno)}
          />
          {errors.apellidoPaterno && (
            <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.apellidoPaterno.message}
            </p>
          )}
        </FormRow>

        {/* Apellido Materno */}
        <FormRow label="Apellido Materno" hintColor="gray">
          <input
            {...register('apellidoMaterno')}
            placeholder="García"
            className={inputCls()}
          />
        </FormRow>

        {/* Dirección principal */}
        <FormRow label="Dirección principal" hintColor="gray">
          <input {...register('direccion')} placeholder="Av. Unios 4453" className={inputCls()} />
        </FormRow>

        {/* Teléfono Móvil */}
        <FormRow label="Teléfono Móvil" required hintColor="gray">
          <input
            {...register('telefono')}
            placeholder="987654321"
            className={inputCls(!!errors.telefono)}
          />
          {errors.telefono && (
            <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.telefono.message}
            </p>
          )}
        </FormRow>

        {/* WhatsApp */}
        <FormRow label="WhatsApp" hintColor="gray">
          <input {...register('whatsapp')} placeholder="987654321" className={inputCls()} />
        </FormRow>

        {/* E-mail */}
        <FormRow label="E-mail" hintColor="gray">
          <input
            {...register('email')}
            type="email"
            placeholder="jorge@correo.com"
            className={inputCls(!!errors.email)}
          />
          {errors.email && (
            <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.email.message}
            </p>
          )}
        </FormRow>

      </div>

      <div className="mt-4">
        <NavButtons isFirst submitLabel="Siguiente" />
      </div>
    </form>
  );
}

// ── Step 2: Facturación y Recordatorios ───────────────────────
function Step2Form({ initial, onBack, onNext }: {
  initial: S2 | null; onBack: () => void; onNext: (d: S2) => void;
}) {
  const { register, handleSubmit, watch, setValue } = useForm<S2>({
    resolver:      zodResolver(step2Schema),
    defaultValues: initial ?? {
      tipoFacturacion:    'prepago',
      diaPago:            '01',
      crearFactura:       '5_antes',
      tipoImpuesto:       'incluido',
      diasGracia:         '5',
      aplicarCorte:       '1_mes',
      aplicarMora:        false,
      aplicarReconexion:  false,
      avisosNuevaFactura: 'desactivado',
      avisoPantalla:      'desactivado',
      canalRecordatorio:  'correo',
      recordatorio1:      '2_antes',
      recordatorio2:      'desactivado',
      recordatorio3:      'desactivado',
    },
  });

  const mora       = watch('aplicarMora')       ?? false;
  const reconexion = watch('aplicarReconexion') ?? false;
  const fechaFija  = watch('fechaFija');
  const DIAS_MES   = Array.from({ length: 28 }, (_, i) => String(i + 1).padStart(2, '0'));

  const RECORDATORIO_OPT = [
    { value: 'desactivado', label: 'Desactivado' },
    { value: '7_antes',     label: '7 Días Antes' },
    { value: '5_antes',     label: '5 Días Antes' },
    { value: '3_antes',     label: '3 Días Antes' },
    { value: '2_antes',     label: '2 Días Antes' },
    { value: '1_antes',     label: '1 Día Antes' },
    { value: 'mismo_dia',   label: 'El mismo día' },
    { value: '1_despues',   label: '1 Día Después' },
    { value: '2_despues',   label: '2 Días Después' },
    { value: '3_despues',   label: '3 Días Después' },
  ];

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-4">
      {/* Plantilla */}
      <div className="bg-card border border-border rounded-xl px-5 py-4 flex items-center gap-4">
        <span className="text-sm font-medium text-foreground whitespace-nowrap">
          Cargar desde plantilla
        </span>
        <select {...register('plantillaId')} className={cn(inputCls(), 'max-w-xs')}>
          <option value="">Seleccionar plantilla</option>
          {MOCK_PLANTILLAS.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Facturación */}
        <Section title="Facturación" icon={CreditCard}>
          <Field label="Tipo">
            <select {...register('tipoFacturacion')} className={inputCls()}>
              <option value="prepago">Prepago (Adelantado)</option>
              <option value="postpago">Postpago (Vencido)</option>
            </select>
          </Field>
          <Field label="Día pago">
            <select {...register('diaPago')} className={inputCls()}>
              {DIAS_MES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Crear Factura">
            <select {...register('crearFactura')} className={inputCls()}>
              <option value="1_antes">1 Día antes</option>
              <option value="2_antes">2 Días antes</option>
              <option value="3_antes">3 Días antes</option>
              <option value="5_antes">5 Días antes</option>
              <option value="7_antes">7 Días antes</option>
              <option value="10_antes">10 Días antes</option>
              <option value="mismo_dia">El mismo día</option>
            </select>
          </Field>
          <Field label="Tipo impuesto">
            <select {...register('tipoImpuesto')} className={inputCls()}>
              <option value="incluido">Impuestos incluido</option>
              <option value="excluido">Impuestos excluido</option>
              <option value="sin">Sin impuesto</option>
            </select>
          </Field>
          <Field label="Días de gracia">
            <select {...register('diasGracia')} className={inputCls()}>
              <option value="1">1 Día</option>
              <option value="2">2 Días</option>
              <option value="3">3 Días</option>
              <option value="5">5 Días</option>
              <option value="7">7 Días</option>
              <option value="10">10 Días</option>
              <option value="15">15 Días</option>
            </select>
          </Field>
          <Field label="Aplicar Corte">
            <select {...register('aplicarCorte')} className={inputCls()}>
              <option value="desactivado">Desactivado</option>
              <option value="1_mes">1 Mes vencido</option>
              <option value="2_meses">2 Meses vencidos</option>
              <option value="3_meses">3 Meses vencidos</option>
            </select>
          </Field>
          <Field label="Fecha Fija" hint="Dejar vacío para fecha automática">
            <div className="flex gap-2">
              <input {...register('fechaFija')} type="date" className={inputCls()} />
              {fechaFija && (
                <button type="button" onClick={() => setValue('fechaFija', '')}
                  className="flex-shrink-0 p-2.5 rounded-lg border border-input bg-muted hover:bg-muted/70 transition-colors">
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </Field>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-foreground">Aplicar Mora</span>
            <ToggleSwitch checked={mora} onChange={(v) => setValue('aplicarMora', v)} />
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-foreground">Aplicar Reconexión</span>
            <ToggleSwitch checked={reconexion} onChange={(v) => setValue('aplicarReconexion', v)} />
          </div>
          <div className="pt-3 border-t border-border space-y-3">
            <p className="text-sm font-semibold text-foreground">Otros Impuestos</p>
            <p className="text-xs text-muted-foreground -mt-2">
              Estos impuestos serán agregados al total de la factura
            </p>
            {([1, 2, 3] as const).map((n) => (
              <Field key={n} label={`Impuesto #${n} (%)`}
                hint="* Dejar en 0 (cero) para quedar deshabilitado">
                <input {...register(`impuesto${n}` as any)} type="number"
                  min={0} max={100} placeholder="0" className={inputCls()} />
              </Field>
            ))}
          </div>
        </Section>

        {/* Notificaciones */}
        <Section title="Notificaciones" icon={Bell}>
          <Field label="Aviso nueva factura">
            <select {...register('avisosNuevaFactura')} className={inputCls()}>
              <option value="desactivado">Desactivado</option>
              <option value="correo">Correo</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="todos">Todos</option>
            </select>
          </Field>
          <Field label="Aviso en Pantalla" hint="* Aviso solo en páginas HTTP">
            <select {...register('avisoPantalla')} className={inputCls()}>
              <option value="desactivado">Desactivado</option>
              <option value="activado">Activado</option>
            </select>
          </Field>
          <Field label="Recordatorios de pago">
            <select {...register('canalRecordatorio')} className={inputCls()}>
              <option value="desactivado">Desactivado</option>
              <option value="correo">Correo</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="todos">Todos</option>
            </select>
          </Field>
          <Field label="Recordatorio #1">
            <select {...register('recordatorio1')} className={inputCls()}>
              {RECORDATORIO_OPT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Recordatorio #2">
            <select {...register('recordatorio2')} className={inputCls()}>
              {RECORDATORIO_OPT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Recordatorio #3"
            hint="* Días antes/después del vencimiento de una factura">
            <select {...register('recordatorio3')} className={inputCls()}>
              {RECORDATORIO_OPT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </Section>
      </div>

      <NavButtons onBack={onBack} submitLabel="Continuar" />
    </form>
  );
}

// ── Step 3: Servicios ─────────────────────────────────────────
function Step3Form({ initial, direccionDefault, onBack, onSubmit }: {
  initial:           S3 | null;
  direccionDefault?: string;
  onBack:            () => void;
  onSubmit:          (d: S3) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  const pppUser = String(Date.now()).slice(-10).padStart(10, '0');
  const pppPass = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

  const { register, handleSubmit, watch, setValue } = useForm<S3>({
    resolver:      zodResolver(step3Schema),
    defaultValues: initial ?? {
      excluirFirewall:  false,
      tipoIpv4:         'dinamica',
      cajaNapId:        '',
      puertoNapId:      '',
      userPppHs:        pppUser,
      passwordPppHs:    pppPass,
      direccion:        direccionDefault ?? '',
      fechaInstalacion: new Date().toISOString().split('T')[0],
      tipoAntena:       'otro',
    },
  });

  const excluirFirewall = watch('excluirFirewall') ?? false;
  const cajaNap         = watch('cajaNapId');

  const { data: routersRaw = [] } = useQuery({ queryKey: ['routers-list'], queryFn: redesApi.listRouters });
  const routers = (routersRaw as typeof MOCK_ROUTERS).length ? (routersRaw as typeof MOCK_ROUTERS) : MOCK_ROUTERS;

  const PUERTOS_NAP = cajaNap
    ? Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, nombre: `Puerto ${i + 1}` }))
    : [];

  const onFormSubmit = async (data: S3) => {
    setSubmitting(true);
    try   { await onSubmit(data); }
    catch { setSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* ── Izquierda: Configuración ── */}
        <Section title="Configuración de servicio" icon={Wifi}>
          {/* Router */}
          <Field label="Router">
            <select {...register('routerId')} className={inputCls()}>
              <option value="">— Seleccionar router —</option>
              {(routers as any[]).map((r) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
          </Field>

          {/* Excluir Firewall */}
          <div className="flex items-center justify-between py-0.5">
            <span className="text-sm text-foreground">Excluir Firewall</span>
            <ToggleSwitch
              checked={excluirFirewall}
              onChange={(v) => setValue('excluirFirewall', v)}
            />
          </div>

          {/* Perfil Internet */}
          <Field label="Perfil Internet">
            <select {...register('perfilId')} className={inputCls()}>
              <option value="">Seleccionar perfil</option>
              {MOCK_PERFILES.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </Field>

          {/* Descripción */}
          <Field label="Descripción" hint="* Texto para facturación">
            <textarea
              {...register('descripcion')}
              rows={2}
              className={cn(inputCls(), 'resize-none')}
            />
          </Field>

          {/* Costo */}
          <Field label="Costo">
            <input
              {...register('costo')}
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              className={inputCls()}
            />
          </Field>

          {/* Tipo IPv4 */}
          <Field label="Tipo IPv4">
            <select {...register('tipoIpv4')} className={inputCls()}>
              <option value="">Seleccionar tipo de IP</option>
              <option value="dinamica">IP Dinámica (DHCP)</option>
              <option value="estatica">IP Estática</option>
              <option value="pool">IP Pool</option>
            </select>
          </Field>

          {/* Mac */}
          <Field label="Mac" hint="Dirección MAC del equipo cliente">
            <input
              {...register('mac')}
              placeholder="AA:BB:CC:DD:EE:FF"
              className={inputCls()}
            />
          </Field>

          {/* User PPP/HS */}
          <Field label="User PPP/HS">
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                {...register('userPppHs')}
                className={cn(inputCls(), 'pl-9')}
              />
            </div>
          </Field>

          {/* Password PPP/HS */}
          <Field label="Password PPP/HS">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                {...register('passwordPppHs')}
                className={cn(inputCls(), 'pl-9')}
              />
            </div>
          </Field>

          {/* Routes */}
          <Field label="Routes" hint="* Dato Opcional">
            <input
              {...register('routes')}
              placeholder="Ejm: 192.168.10.0/24"
              className={inputCls()}
            />
          </Field>

          {/* Caja Nap */}
          <Field label="Caja Nap">
            <select {...register('cajaNapId')} className={inputCls()}>
              {MOCK_CAJAS_NAP.map((n) => (
                <option key={n.id} value={n.id}>{n.nombre}</option>
              ))}
            </select>
          </Field>

          {/* Puerto Nap */}
          <Field label="Puerto Nap">
            <select {...register('puertoNapId')} className={inputCls()} disabled={!cajaNap}>
              <option value="">Ninguno</option>
              {PUERTOS_NAP.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </Field>
        </Section>

        {/* ── Derecha: Instalación + Equipo ── */}
        <div className="space-y-4">
          <Section title="Datos de instalación" icon={MapPin}>
            {/* Dirección */}
            <Field label="Dirección">
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  {...register('direccion')}
                  placeholder="Av. Los Héroes 302"
                  className={cn(inputCls(), 'pl-9')}
                />
              </div>
            </Field>

            {/* Coordenadas */}
            <Field label="Coordenadas" hint="* Latitud,longitud">
              <div className="relative">
                <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  {...register('coordenadas')}
                  placeholder="-5.1944, -80.6328"
                  className={cn(inputCls(), 'pl-9')}
                />
              </div>
            </Field>

            {/* Fecha Instalación */}
            <Field label="Fecha Instalación">
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  {...register('fechaInstalacion')}
                  type="date"
                  className={cn(inputCls(), 'pl-9')}
                />
              </div>
            </Field>
          </Section>

          {/* Equipo receptor */}
          <Section title="Equipo receptor" icon={Radio}>
            {/* Conectado A */}
            <Field label="Conectado A">
              <select {...register('conectadoAId')} className={inputCls()}>
                <option value="">Seleccionar...</option>
                {(routers as any[]).map((r) => (
                  <option key={r.id} value={r.id}>{r.nombre}</option>
                ))}
              </select>
            </Field>

            {/* IP administración */}
            <Field label="IP administración" hint="* IP antena del cliente">
              <div className="relative">
                <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  {...register('ipAdministracion')}
                  placeholder="192.168.1.1"
                  className={cn(inputCls(), 'pl-9')}
                />
              </div>
            </Field>

            {/* Tipo antena */}
            <Field label="Tipo antena">
              <select {...register('tipoAntena')} className={inputCls()}>
                {MOCK_TIPO_ANTENA.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
          </Section>
        </div>
      </div>

      {/* ── Botones finales ── */}
      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-lg border border-input
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
        >
          <ChevronLeft className="w-4 h-4" /> Atrás
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-2 px-8 py-2.5 text-sm rounded-lg font-semibold
                     bg-green-600 hover:bg-green-700 text-white shadow-sm
                     transition-all duration-150 disabled:opacity-60"
        >
          {submitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</>
            : <><CheckCircle2 className="w-4 h-4" /> Registrar cliente</>
          }
        </button>
      </div>
    </form>
  );
}
