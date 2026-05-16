'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Loader2, Search, CheckCircle2, AlertCircle, ArrowLeft,
  User, Phone, MapPin, Wifi, ChevronRight, ChevronLeft,
} from 'lucide-react';

import { clientesApi } from '@/lib/api/clientes';
import { contratosApi, redesApi, planesApi } from '@/lib/api/contratos';
import { useToast } from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

// ─── Schemas ──────────────────────────────────────────────────
const step1Schema = z.object({
  tipoDocumento:   z.enum(['dni', 'ruc', 'ce', 'pasaporte']),
  numeroDocumento: z.string().min(7, 'Mínimo 7 caracteres').max(12),
  nombres:         z.string().min(2, 'Nombre requerido'),
  apellidoPaterno: z.string().min(2, 'Apellido paterno requerido'),
  apellidoMaterno: z.string().optional(),
  esEmpresa:       z.boolean().optional(),
  rucEmpresa:      z.string().optional(),
  razonSocial:     z.string().optional(),
});

const step2Schema = z.object({
  telefono:    z.string().min(7, 'Teléfono requerido'),
  telefonoAlt: z.string().optional(),
  whatsapp:    z.string().optional(),
  email:       z.string().email('Email inválido').optional().or(z.literal('')),
  direccion:   z.string().min(5, 'Dirección requerida'),
  referencia:  z.string().optional(),
  departamento: z.string().optional(),
  provincia:   z.string().optional(),
  distrito:    z.string().optional(),
  notasInternas: z.string().optional(),
});

const step3Schema = z.object({
  tipoServicio: z.enum(['ftth', 'wisp', 'dedicado', 'mixto']).optional(),
  planId:       z.string().optional(),
  routerId:     z.string().optional(),
  nodoId:       z.string().optional(),
  segmentoId:   z.string().optional(),
  usuarioPppoe: z.string().optional(),
  passwordPppoe: z.string().optional(),
  fechaInicio:  z.string().optional(),
  diaFacturacion: z.coerce.number().min(1).max(31).optional(),
  crearContrato: z.boolean().optional(),
});

type Step1 = z.infer<typeof step1Schema>;
type Step2 = z.infer<typeof step2Schema>;
type Step3 = z.infer<typeof step3Schema>;

// ─── Steps config ─────────────────────────────────────────────
const STEPS = [
  { label: 'Identificación', icon: User },
  { label: 'Contacto',       icon: Phone },
  { label: 'Servicio',       icon: Wifi },
];

// ─── Main Wizard ──────────────────────────────────────────────
export function ClienteWizard() {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [s1, setS1] = useState<Step1 | null>(null);
  const [s2, setS2] = useState<Step2 | null>(null);

  const handleS1 = (data: Step1) => { setS1(data); setStep(1); };
  const handleS2 = (data: Step2) => { setS2(data); setStep(2); };

  const { mutateAsync: crearCliente } = useMutation({
    mutationFn: clientesApi.create,
  });
  const { mutateAsync: crearContrato } = useMutation({
    mutationFn: contratosApi.create,
  });

  const handleS3 = async (data: Step3) => {
    if (!s1 || !s2) return;
    try {
      const cliente = await crearCliente({
        ...s1,
        ...s2,
        email: s2.email || undefined,
        tipoServicio: (data.tipoServicio as any) || 'ftth',
      });

      if (data.crearContrato && data.planId) {
        await crearContrato({
          clienteId:      cliente.id,
          planId:         data.planId,
          routerId:       data.routerId || undefined,
          segmentoId:     data.segmentoId || undefined,
          fechaInicio:    data.fechaInicio || new Date().toISOString().split('T')[0],
          diaFacturacion: data.diaFacturacion,
          usuarioPppoe:   data.usuarioPppoe || undefined,
          passwordPppoe:  data.passwordPppoe || undefined,
        });
        toast('Cliente y contrato creados', { type: 'success', description: cliente.nombreCompleto });
      } else {
        toast('Cliente registrado', { type: 'success', description: cliente.nombreCompleto });
      }

      router.push(`/clientes/${cliente.id}`);
    } catch (err) {
      toast(parseApiError(err), { type: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Step indicators */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = i < step;
          const active = i === step;
          return (
            <div key={i} className="flex items-center">
              <div className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                active ? 'bg-primary text-primary-foreground' :
                done   ? 'text-primary' : 'text-muted-foreground',
              )}>
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <ChevronRight className={cn('w-4 h-4 mx-1', done ? 'text-primary' : 'text-muted-foreground/40')} />
              )}
            </div>
          );
        })}
      </div>

      {/* Steps */}
      {step === 0 && <Step1Form initial={s1} onNext={handleS1} />}
      {step === 1 && <Step2Form initial={s2} onBack={() => setStep(0)} onNext={handleS2} />}
      {step === 2 && <Step3Form onBack={() => setStep(1)} onSubmit={handleS3} />}
    </div>
  );
}

// ─── Step 1: Identificación ───────────────────────────────────
function Step1Form({ initial, onNext }: { initial: Step1 | null; onNext: (d: Step1) => void }) {
  const { toast } = useToast();
  const [reniecStatus, setReniecStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [reniecMsg, setReniecMsg] = useState('');

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<Step1>({
    resolver: zodResolver(step1Schema),
    defaultValues: initial ?? { tipoDocumento: 'dni', esEmpresa: false },
  });

  const tipoDoc = watch('tipoDocumento');
  const esEmpresa = watch('esEmpresa');

  const consultarReniec = async () => {
    const dni = watch('numeroDocumento')?.trim();
    if (!dni || dni.length !== 8) { toast('El DNI debe tener 8 dígitos', { type: 'warning' }); return; }
    setReniecStatus('loading');
    try {
      const datos = await clientesApi.consultarReniec(dni);
      setValue('nombres',         datos.nombres,         { shouldDirty: true });
      setValue('apellidoPaterno', datos.apellidoPaterno, { shouldDirty: true });
      setValue('apellidoMaterno', datos.apellidoMaterno, { shouldDirty: true });
      setReniecStatus('ok');
      setReniecMsg(`${datos.nombres} ${datos.apellidoPaterno}`);
    } catch (err) {
      setReniecStatus('error');
      setReniecMsg(parseApiError(err));
    }
  };

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-5">
      <Section title="Tipo e identificación">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tipo de documento" error={errors.tipoDocumento?.message}>
            <select {...register('tipoDocumento')} className={inputCls()}>
              <option value="dni">DNI</option>
              <option value="ruc">RUC</option>
              <option value="ce">Carné de extranjería</option>
              <option value="pasaporte">Pasaporte</option>
            </select>
          </Field>
          <Field label="Número de documento *" error={errors.numeroDocumento?.message}>
            <div className="flex gap-2">
              <input {...register('numeroDocumento')} placeholder={tipoDoc === 'dni' ? '12345678' : '20123456789'} className={inputCls(!!errors.numeroDocumento)} />
              {tipoDoc === 'dni' && (
                <button type="button" onClick={consultarReniec} disabled={reniecStatus === 'loading'}
                  className="flex-shrink-0 px-3 rounded-lg border border-input bg-muted text-sm hover:bg-muted/70 transition-colors disabled:opacity-50"
                  title="Consultar RENIEC">
                  {reniecStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              )}
            </div>
            {reniecStatus !== 'idle' && (
              <div className={cn('flex items-center gap-1.5 mt-1.5 text-xs rounded-lg px-2.5 py-1.5',
                reniecStatus === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400' :
                reniecStatus === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400' : 'bg-muted text-muted-foreground',
              )}>
                {reniecStatus === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                {reniecMsg}
              </div>
            )}
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Nombres *" error={errors.nombres?.message}>
            <input {...register('nombres')} placeholder="Juan Carlos" className={inputCls(!!errors.nombres)} />
          </Field>
          <Field label="Apellido paterno *" error={errors.apellidoPaterno?.message}>
            <input {...register('apellidoPaterno')} placeholder="Pérez" className={inputCls(!!errors.apellidoPaterno)} />
          </Field>
          <Field label="Apellido materno">
            <input {...register('apellidoMaterno')} placeholder="García" className={inputCls()} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" {...register('esEmpresa')} className="rounded" />
          <span>Es empresa / persona jurídica</span>
        </label>

        {esEmpresa && (
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg border border-border">
            <Field label="RUC"><input {...register('rucEmpresa')} placeholder="20123456789" className={inputCls()} /></Field>
            <Field label="Razón social"><input {...register('razonSocial')} placeholder="Mi Empresa S.A.C." className={inputCls()} /></Field>
          </div>
        )}
      </Section>

      <div className="flex justify-end">
        <button type="submit" className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors">
          Siguiente <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </form>
  );
}

// ─── Step 2: Contacto y Dirección ─────────────────────────────
function Step2Form({ initial, onBack, onNext }: { initial: Step2 | null; onBack: () => void; onNext: (d: Step2) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<Step2>({
    resolver: zodResolver(step2Schema),
    defaultValues: initial ?? {},
  });

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-5">
      <Section title="Datos de contacto">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Teléfono principal *" error={errors.telefono?.message}>
            <input {...register('telefono')} placeholder="987654321" className={inputCls(!!errors.telefono)} />
          </Field>
          <Field label="Teléfono alternativo">
            <input {...register('telefonoAlt')} placeholder="987654322" className={inputCls()} />
          </Field>
          <Field label="WhatsApp">
            <input {...register('whatsapp')} placeholder="987654321" className={inputCls()} />
          </Field>
          <Field label="Correo electrónico" error={errors.email?.message}>
            <input {...register('email')} type="email" placeholder="juan@correo.pe" className={inputCls(!!errors.email)} />
          </Field>
        </div>
      </Section>

      <Section title="Dirección de instalación">
        <Field label="Dirección completa *" error={errors.direccion?.message}>
          <input {...register('direccion')} placeholder="Av. Sánchez Cerro 1234, Piura" className={inputCls(!!errors.direccion)} />
        </Field>
        <Field label="Referencia">
          <input {...register('referencia')} placeholder="A media cuadra del parque" className={inputCls()} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Departamento"><input {...register('departamento')} placeholder="Piura" className={inputCls()} /></Field>
          <Field label="Provincia"><input {...register('provincia')} placeholder="Piura" className={inputCls()} /></Field>
          <Field label="Distrito"><input {...register('distrito')} placeholder="Piura" className={inputCls()} /></Field>
        </div>
        <Field label="Notas internas">
          <textarea {...register('notasInternas')} rows={2} placeholder="Observaciones del técnico..." className={cn(inputCls(), 'resize-none')} />
        </Field>
      </Section>

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
          <ChevronLeft className="w-4 h-4" /> Atrás
        </button>
        <button type="submit" className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors">
          Siguiente <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </form>
  );
}

// ─── Step 3: Servicio / Contrato ───────────────────────────────
function Step3Form({ onBack, onSubmit }: { onBack: () => void; onSubmit: (d: Step3) => Promise<void> }) {
  const { register, handleSubmit, watch, formState: { isSubmitting } } = useForm<Step3>({
    resolver: zodResolver(step3Schema),
    defaultValues: {
      tipoServicio: 'ftth',
      crearContrato: true,
      fechaInicio: new Date().toISOString().split('T')[0],
      diaFacturacion: 1,
    },
  });

  const crearContrato = watch('crearContrato');
  const routerIdSel = watch('routerId');

  const { data: planes = [] } = useQuery({ queryKey: ['planes'], queryFn: planesApi.list });
  const { data: routers = [] } = useQuery({ queryKey: ['mikrotik-routers'], queryFn: redesApi.listRouters });
  const { data: nodos = [] } = useQuery({ queryKey: ['nodos'], queryFn: redesApi.listNodos });
  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos-ipv4', routerIdSel],
    queryFn: () => redesApi.listSegmentos(routerIdSel || undefined),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Section title="Tipo de servicio">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tipo de servicio">
            <select {...register('tipoServicio')} className={inputCls()}>
              <option value="ftth">FTTH (fibra hasta el hogar)</option>
              <option value="wisp">WISP (inalámbrico)</option>
              <option value="dedicado">Dedicado</option>
              <option value="mixto">Mixto</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Contrato de servicio">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" {...register('crearContrato')} className="rounded" />
          <span>Crear contrato ahora (plan, router, IP)</span>
        </label>

        {crearContrato && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Plan de internet *">
                <select {...register('planId')} className={inputCls()}>
                  <option value="">Seleccionar plan...</option>
                  {planes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} — S/. {p.precioMensual}/mes
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Día de facturación">
                <input {...register('diaFacturacion')} type="number" min={1} max={31} placeholder="1" className={inputCls()} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Router MikroTik">
                <select {...register('routerId')} className={inputCls()}>
                  <option value="">Sin asignar</option>
                  {routers.map((r) => (
                    <option key={r.id} value={r.id}>{r.nombre} — {r.host}</option>
                  ))}
                </select>
              </Field>
              <Field label="Nodo / Antena">
                <select {...register('nodoId')} className={inputCls()}>
                  <option value="">Sin asignar</option>
                  {nodos.map((n) => (
                    <option key={n.id} value={n.id}>{n.nombre}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Segmento IPv4 (pool de IPs)">
              <select {...register('segmentoId')} className={inputCls()}>
                <option value="">Sin asignar / asignar manual</option>
                {segmentos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre} ({s.redCidr}) — {s.ipsDisponibles} IPs libres
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Usuario PPPoE (opcional)">
                <input {...register('usuarioPppoe')} placeholder="cliente01" className={inputCls()} />
              </Field>
              <Field label="Contraseña PPPoE (opcional)">
                <input {...register('passwordPppoe')} type="password" placeholder="Auto-generado si vacío" className={inputCls()} />
              </Field>
            </div>

            <Field label="Fecha de inicio">
              <input {...register('fechaInicio')} type="date" className={inputCls()} />
            </Field>
          </div>
        )}
      </Section>

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
          <ChevronLeft className="w-4 h-4" /> Atrás
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {crearContrato ? 'Registrar cliente y contrato' : 'Registrar cliente'}
        </button>
      </div>
    </form>
  );
}

// ─── UI helpers ───────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground pb-2 border-b border-border">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function inputCls(hasError = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
