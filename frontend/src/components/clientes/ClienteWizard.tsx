'use client';

import { useState, useEffect } from 'react';
import { useRouter }         from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver }       from '@hookform/resolvers/zod';
import { z }                 from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Loader2, Search, CheckCircle2, AlertCircle, ChevronRight, ChevronLeft,
  User, Wifi, CreditCard, Bell, Trash2,
  MapPin, Lock, Calendar, Navigation, Server, Radio,
  Check, Building2, Network,
} from 'lucide-react';

import { clientesApi }                       from '@/lib/api/clientes';
import { redesApi, planesApi } from '@/lib/api/contratos';
import type { Router as RouterType } from '@/lib/api/mikrotik';
import { facturacionApi }                    from '@/lib/api/facturacion';
import { plantillasAbonadosApi }             from '@/lib/api/plantillas-abonados';
import { plantillasApi }                     from '@/lib/api/plantillas';
import { zonasApi }                          from '@/lib/api/zonas';
import type { FacturacionConfig, NotificacionesConfig } from '@/lib/api/plantillas-abonados';
import { useToast }                          from '@/components/ui/toaster';
import { parseApiError, cn }                 from '@/lib/utils';

// ── Schemas ───────────────────────────────────────────────────
const step1Schema = z.object({
  usuarioPortal:    z.string().optional(),
  passwordPortal:   z.string().optional(),
  tipoDocumento:    z.string().optional(),
  numeroDocumento:  z.string().min(6, 'Identificación requerida').max(13),
  nombresCompletos: z.string().min(2, 'Nombres requeridos'),
  zonaId:           z.string().optional(),
  direccion:       z.string().min(1, 'Dirección requerida'),
  ubicacionId:     z.string().optional(),
  departamento:    z.string().optional(),
  provincia:       z.string().optional(),
  distrito:        z.string().optional(),
  telefonoFijo:    z.string().optional(),
  telefono:        z.string().optional(),
  whatsapp:        z.string().min(7, 'WhatsApp requerido'),
  email:           z.string().email('Email inválido').optional().or(z.literal('')),
});

const step2Schema = z.object({ _placeholder: z.string().optional() });

const SECURITY_OPTS_ABONADO = [
  { val: 'pppoe_addresslist',  label: 'PPPoE'                       },
  { val: 'amarre_ip_mac',      label: 'Amarre IP/MAC'               },
  { val: 'amarre_ip_mac_dhcp', label: 'Amarre IP/MAC + DHCP Leases' },
  { val: 'ninguna',            label: 'Ninguna'                     },
] as const;

const step3Schema = z.object({
  // Configuración de servicio
  routerId:         z.string().optional(),
  tipoControl:      z.string().optional(),
  excluirFirewall:  z.boolean().optional(),
  perfilId:         z.string().optional(),
  descripcion:      z.string().optional(),
  costo:            z.coerce.number().optional(),
  tipoIpv4:         z.string().optional(),
  segmentoId:       z.string().optional(),
  ipv4:             z.string().optional(),
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
type S2 = { facturacion: FacturacionConfig; notificaciones: NotificacionesConfig };
type S3 = z.infer<typeof step3Schema>;

// Convención peruana: últimas 2 palabras = apellidos, el resto = nombres
function parsearNombresCompletos(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { nombres: parts[0] ?? full, apellidoPaterno: '', apellidoMaterno: undefined as string | undefined };
  if (parts.length === 2) return { nombres: parts[0], apellidoPaterno: parts[1], apellidoMaterno: undefined as string | undefined };
  if (parts.length === 3) return { nombres: parts[0], apellidoPaterno: parts[1], apellidoMaterno: parts[2] };
  return {
    nombres:         parts.slice(0, parts.length - 2).join(' '),
    apellidoPaterno: parts[parts.length - 2],
    apellidoMaterno: parts[parts.length - 1],
  };
}

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
      <label className="text-xs font-medium text-foreground block">
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

const INPUT_CLS = 'w-full px-3 py-2.5 text-sm rounded-lg border bg-background transition-all duration-150 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary border-primary/25 hover:border-primary/50';
const INPUT_ERR = 'border-destructive bg-destructive/5 focus:ring-destructive/30 focus:border-destructive';

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
    <div className="space-y-1.5 px-4 sm:px-6 py-2">
      <label className="text-xs font-medium text-foreground block">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="min-w-0">
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

function DecimalInput2({ value, onChange, className, placeholder }: {
  value: number; onChange: (v: number) => void; className?: string; placeholder?: string;
}) {
  const [display, setDisplay] = useState(value.toFixed(2));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDisplay(value.toFixed(2)); }, [value, focused]);
  return (
    <input type="text" inputMode="decimal" className={className} placeholder={placeholder}
      value={display}
      onChange={e => setDisplay(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const parsed = Math.max(0, parseFloat(display) || 0);
        const formatted = parsed.toFixed(2);
        setDisplay(formatted);
        onChange(parseFloat(formatted));
      }}
    />
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
        className="btn-secondary disabled:opacity-0 disabled:pointer-events-none"
      >
        <ChevronLeft className="w-4 h-4" /> Atrás
      </button>
      <button
        type="submit"
        className="btn-primary"
      >
        {submitLabel} <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────
export function ClienteWizard({ onClose }: { onClose?: () => void } = {}) {
  const router    = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [s1, setS1] = useState<S1 | null>(null);
  const [s2, setS2] = useState<S2 | null>(null);
  const [s3, setS3] = useState<S3 | null>(null);
  const [resultado, setResultado] = useState<{ clienteId: string; contratoId?: string; clienteNombre?: string } | null>(null);

  const { mutateAsync: registrar } = useMutation({ mutationFn: clientesApi.onboarding });

  const handleRegistrar = async (data: S3 & { _costoInstalacion?: boolean; _montoCostoInstalacion?: number }) => {
    if (!s1) return;

    // Parsear coordenadas de instalación "lat,lng"
    let latitudInstalacion: number | undefined;
    let longitudInstalacion: number | undefined;
    if (data.coordenadas?.trim()) {
      const [latStr, lngStr] = data.coordenadas.split(',');
      const lat = parseFloat(latStr?.trim());
      const lng = parseFloat(lngStr?.trim());
      if (!isNaN(lat) && !isNaN(lng)) { latitudInstalacion = lat; longitudInstalacion = lng; }
    }

    let resultado: { cliente: any; contrato: any | null };
    try {
      const { nombres, apellidoPaterno, apellidoMaterno } = parsearNombresCompletos(s1.nombresCompletos);
      resultado = await registrar({
        cliente: {
          tipoDocumento:   s1.tipoDocumento || 'dni',
          numeroDocumento: s1.numeroDocumento,
          nombres,
          apellidoPaterno,
          apellidoMaterno,
          telefono:        s1.telefono?.trim() || s1.whatsapp || undefined,
          whatsapp:        s1.whatsapp         || undefined,
          email:           s1.email            || undefined,
          direccion:       s1.direccion        || undefined,
          zonaId:          s1.zonaId           || undefined,
          distrito:        s1.distrito         || undefined,
          provincia:       s1.provincia        || undefined,
          departamento:    s1.departamento     || undefined,
          usuarioPortal:   s1.usuarioPortal    || undefined,
          passwordPortal:  s1.passwordPortal   || undefined,
        },
        ...(data.perfilId && {
          contrato: {
            planId:              data.perfilId                || undefined,
            routerId:            data.routerId                || undefined,
            segmentoId:          data.segmentoId              || undefined,
            nodoId:              undefined,
            antenaApId:          data.conectadoAId            || undefined,
            ipManual:            data.ipv4                    || undefined,
            usuarioPppoe:        data.userPppHs               || undefined,
            passwordPppoePlain:  data.passwordPppHs           || undefined,
            fechaInicio:         data.fechaInstalacion        || new Date().toISOString().split('T')[0],
            diaFacturacion:      (() => {
              const dp = parseInt(s2?.facturacion?.diaPago ?? '0', 10);
              if (!dp) return undefined;
              const cf = parseInt(s2?.facturacion?.crearFactura ?? '0', 10);
              return isNaN(cf) || cf <= 0 ? dp : Math.max(1, dp - cf);
            })(),
            macAddress:          data.mac                     || undefined,
            excluirFirewall:     data.excluirFirewall         ?? false,
            routes:              data.routes                  || undefined,
            ipAdministracion:    data.ipAdministracion        || undefined,
            tipoAntena:          data.tipoAntena              || undefined,
            cajaNap:             data.cajaNapId               || undefined,
            puertoNap:           data.puertoNapId             || undefined,
            direccionInstalacion: data.direccion              || undefined,
            latitudInstalacion,
            longitudInstalacion,
            tipoAuth:            data.tipoControl             || undefined,
          },
        }),
        ...(s2 && { facturacion: s2.facturacion, notificaciones: s2.notificaciones }),
      });
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Error al registrar abonado';
      toast(msg, { type: 'error' });
      throw err;
    }

    const { cliente, contrato } = resultado;

    // Factura inicial (prepago o costo de instalación)
    const esPrepago      = s2?.facturacion?.tipo === 'prepago';
    const conInstalacion = data._costoInstalacion && (data._montoCostoInstalacion ?? 0) > 0;
    if (contrato && (esPrepago || conInstalacion)) {
      try {
        const hoy    = new Date();
        const fin    = new Date(hoy);
        fin.setMonth(fin.getMonth() + 1);
        const inicio = hoy.toISOString().split('T')[0];
        const finStr = fin.toISOString().split('T')[0];
        const items: { descripcion: string; cantidad: number; precioUnitario: number }[] = [];
        if (esPrepago) {
          items.push({
            descripcion:    data.descripcion || 'Servicio de internet',
            cantidad:       1,
            precioUnitario: data.costo ?? 0,
          });
        }
        if (conInstalacion) {
          items.push({
            descripcion:    'Costo de instalación',
            cantidad:       1,
            precioUnitario: data._montoCostoInstalacion!,
          });
        }
        await facturacionApi.create({
          clienteId:     cliente.id,
          periodoInicio: inicio,
          periodoFin:    finStr,
          items,
        });
      } catch { /* no bloquea el flujo principal */ }
    }
    toast('Abonado registrado correctamente', { type: 'success' });
    setResultado({ clienteId: cliente.id, contratoId: contrato?.id, clienteNombre: cliente.nombreCompleto });
  };

  if (resultado) {
    return (
      <div className="w-full max-w-lg mx-auto space-y-6 py-8 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-950/30 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">¡Abonado registrado!</h2>
          {resultado.clienteNombre && (
            <p className="text-muted-foreground mt-1">{resultado.clienteNombre}</p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => { onClose?.(); router.push(`/clientes/${resultado.clienteId}`); }}
            className="flex items-center justify-center gap-2 px-6 py-2.5 text-sm rounded-lg
                       border border-input hover:bg-accent transition-all"
          >
            <User className="w-4 h-4" /> Ver perfil del abonado
          </button>
          {resultado.contratoId && (
            <button
              onClick={() => { onClose?.(); router.push(`/contratos/${resultado.contratoId}/aprovisionar`); }}
              className="btn-primary"
            >
              <Wifi className="w-4 h-4" /> Aprovisionar en MikroTik
            </button>
          )}
        </div>
        <button
          onClick={() => { setResultado(null); setStep(0); setS1(null); setS2(null); setS3(null); }}
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          Registrar otro abonado
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Cerrar
          </button>
        )}
      </div>
    );
  }

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

  const { data: zonas = [] } = useQuery({ queryKey: ['zonas'], queryFn: zonasApi.list });

  const { register, handleSubmit, getValues, setValue, formState: { errors } } = useForm<S1>({
    resolver:      zodResolver(step1Schema),
    defaultValues: initial ?? {},
  });

  const consultarReniec = async () => {
    const doc = getValues('numeroDocumento')?.trim();
    if (!doc || doc.length < 6) { toast('Ingresa un número de identificación válido', { type: 'warning' }); return; }
    setReniecStatus('loading');
    try {
      const datos = await clientesApi.consultarReniec(doc);
      const nombreCompleto = [datos.nombres, datos.apellidoPaterno, datos.apellidoMaterno].filter(Boolean).join(' ');
      setValue('nombresCompletos', nombreCompleto, { shouldDirty: true });
      setReniecStatus('ok');
      setReniecMsg(nombreCompleto);
    } catch (err) {
      setReniecStatus('error');
      setReniecMsg(parseApiError(err));
    }
  };

  return (
    <form onSubmit={handleSubmit(onNext)}>
      <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border/50">

        {/* Tipo Documento */}
        <FormRow label="Tipo Documento" hintColor="gray">
          <select {...register('tipoDocumento')} className={INPUT_CLS}>
            <option value="dni">DNI</option>
            <option value="ruc">RUC</option>
            <option value="cedula">Cédula</option>
            <option value="pasaporte">Pasaporte</option>
            <option value="cuit">CUIT</option>
            <option value="nit">NIT</option>
            <option value="otro">Otro</option>
          </select>
        </FormRow>

        {/* Nº Identificación */}
        <FormRow label="Nº Identificación" required>
          <div className="flex gap-2">
            <input
              {...register('numeroDocumento')}
              placeholder="12345678"
              maxLength={13}
              className={cn(INPUT_CLS, !!errors.numeroDocumento && INPUT_ERR)}
            />
            <button
              type="button"
              onClick={consultarReniec}
              disabled={reniecStatus === 'loading'}
              title="Consultar RENIEC / padrón"
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

        {/* Nombres Completos */}
        <FormRow label="Nombres Completos" required hintColor="gray">
          <input
            {...register('nombresCompletos')}
            placeholder="Jean Piero Escobar Bautista"
            className={cn(INPUT_CLS, !!errors.nombresCompletos && INPUT_ERR)}
          />
          {errors.nombresCompletos && (
            <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.nombresCompletos.message}
            </p>
          )}
        </FormRow>

        {/* Dirección principal */}
        <FormRow label="Dirección principal" required hintColor="gray">
          <input {...register('direccion')} placeholder="Av. Unios 4453" className={cn(INPUT_CLS, !!errors.direccion && INPUT_ERR)} />
          {errors.direccion && (
            <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.direccion.message}
            </p>
          )}
        </FormRow>

        {/* Zona */}
        <FormRow label="Zona" hintColor="gray">
          <select {...register('zonaId')} className={INPUT_CLS}>
            <option value="">— Sin zona —</option>
            {zonas.filter(z => z.activo).map(z => (
              <option key={z.id} value={z.id}>{z.nombre}</option>
            ))}
          </select>
        </FormRow>

        {/* WhatsApp */}
        <FormRow label="WhatsApp" required hintColor="gray">
          <input {...register('whatsapp')} placeholder="987654321" className={cn(INPUT_CLS, !!errors.whatsapp && INPUT_ERR)} />
          {errors.whatsapp && (
            <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.whatsapp.message}
            </p>
          )}
        </FormRow>

        {/* Teléfono Móvil */}
        <FormRow label="Teléfono Móvil" hintColor="gray">
          <input {...register('telefono')} placeholder="987654321" className={INPUT_CLS} />
        </FormRow>

        {/* E-mail */}
        <FormRow label="E-mail" hintColor="gray">
          <input
            {...register('email')}
            type="email"
            placeholder="jorge@correo.com"
            className={cn(INPUT_CLS, !!errors.email && INPUT_ERR)}
          />
          {errors.email && (
            <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />{errors.email.message}
            </p>
          )}
        </FormRow>

        {/* Credenciales Portal */}
        <FormRow label="Credenciales Portal" hint="Dejar vacío para auto-generar" hintColor="gray">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex flex-col gap-1 flex-1">
              <span className="text-xs text-muted-foreground">Usuario</span>
              <input {...register('usuarioPortal')} placeholder="Auto-generar" maxLength={12} className={INPUT_CLS} />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <span className="text-xs text-muted-foreground">Contraseña</span>
              <input {...register('passwordPortal')} placeholder="Auto-generar" maxLength={12} className={INPUT_CLS} />
            </div>
          </div>
        </FormRow>

      </div>

      <div className="mt-4">
        <NavButtons isFirst submitLabel="Siguiente" />
      </div>
    </form>
  );
}

// ── Step 2 options (iguales a plantillas-config) ───────────────
const S2_DIAS_MES = Array.from({ length: 28 }, (_, i) => String(i + 1).padStart(2, '0'));
const S2_CREAR_FACTURA_OPTS = [
  { value: 'desactivado', label: 'Desactivado' },
  ...Array.from({ length: 25 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? '1 día antes' : `${i + 1} días antes` })),
];
const S2_DIAS_GRACIA_OPTS = [
  { value: '0', label: '0 Días' },
  ...Array.from({ length: 25 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? '1 Día' : `${i + 1} Días` })),
];
const S2_APLICAR_CORTE_OPTS = [
  { value: 'desactivado', label: 'Desactivado' },
  ...Array.from({ length: 5 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? '1 mes vencido' : `${i + 1} meses vencidos` })),
];
const S2_BAJAR_VEL_OPTS = [
  { value: 'desactivado', label: 'Desactivado' },
  { value: '512k', label: '512 Kbps' },
  { value: '1m',   label: '1 Mbps'   },
  { value: '2m',   label: '2 Mbps'   },
];
const S2_RECORDATORIO_ANTES = Array.from({ length: 10 }, (_, i) => ({
  value: String(-(i + 1)), label: i === 0 ? '1 Día Antes' : `${i + 1} Días Antes`,
}));
const S2_RECORDATORIO_DESPUES = Array.from({ length: 25 }, (_, i) => ({
  value: String(i + 1), label: i === 0 ? '1 Día Después' : `${i + 1} Días Después`,
}));
const DEF_FACT: FacturacionConfig = {
  tipo: 'prepago', diaPago: '01', crearFactura: 'desactivado',
  plantillaAvisoFactura: '',
  tipoImpuesto: 'incluido', diasGracia: '0', aplicarCorte: 'desactivado',
  aplicarMora: false, montoMora: 0, aplicarReconexion: false, montoReconexion: 0,
  impuesto1: 0,
};
const DEF_NOTIF: NotificacionesConfig = {
  avisoNuevaFactura: 'desactivado', avisoPantalla: 'desactivado',
  recordatoriosPago: 'desactivado', recordatorio1: 'desactivado',
  recordatorio2: 'desactivado', recordatorio3: 'desactivado',
  plantillaRecordatorio1: '', plantillaRecordatorio2: '', plantillaRecordatorio3: '',
};

// ── Step 2: Facturación y Recordatorios ───────────────────────
function Step2Form({ initial, onBack, onNext }: {
  initial: S2 | null; onBack: () => void; onNext: (d: S2) => void;
}) {
  const [fact, setFact]   = useState<FacturacionConfig>(initial?.facturacion ?? { ...DEF_FACT });
  const [notif, setNotif] = useState<NotificacionesConfig>(initial?.notificaciones ?? { ...DEF_NOTIF });
  const [bajarVel, setBajarVel]   = useState((initial?.facturacion as any)?.bajarVelocidad ?? 'desactivado');
  const [fechaFija, setFechaFija] = useState((initial?.facturacion as any)?.fechaFija ?? '');
  const [corteFijo, setCorteFijo] = useState((initial?.facturacion as any)?.corteFijoProgramado ?? '');

  const { data: plantillas = [] } = useQuery({
    queryKey: ['plantillas-abonados'],
    queryFn: plantillasAbonadosApi.list,
  });
  const { data: plantillasMsg = [] } = useQuery({
    queryKey: ['plantillas', 'whatsapp'],
    queryFn: () => plantillasApi.listar('whatsapp'),
  });

  function cargarPlantilla(id: string) {
    const p = plantillas.find(x => x.id === id);
    if (!p) return;
    setFact({ ...DEF_FACT, ...p.facturacion });
    setNotif({ ...DEF_NOTIF, ...p.notificaciones });
  }
  function updateF<K extends keyof FacturacionConfig>(k: K, v: FacturacionConfig[K]) {
    setFact(prev => ({ ...prev, [k]: v }));
  }
  function updateN<K extends keyof NotificacionesConfig>(k: K, v: NotificacionesConfig[K]) {
    setNotif(prev => ({ ...prev, [k]: v }));
  }
  function handleContinuar() {
    onNext({ facturacion: { ...fact, bajarVelocidad: bajarVel, fechaFija: fechaFija || null, corteFijoProgramado: corteFijo || null } as any, notificaciones: notif });
  }

  return (
    <form onSubmit={e => { e.preventDefault(); handleContinuar(); }} className="space-y-4">
      {/* Plantilla */}
      <div className="bg-card border border-border rounded-xl px-5 py-4 flex items-center gap-4">
        <span className="text-sm font-medium text-foreground whitespace-nowrap">Cargar desde plantilla</span>
        <select className={cn(INPUT_CLS, 'max-w-xs')} defaultValue=""
          onChange={e => { if (e.target.value) cargarPlantilla(e.target.value); }}>
          <option value="">Seleccionar plantilla</option>
          {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Facturación */}
        <Section title="Facturación" icon={CreditCard}>
          <Field label="Tipo">
            <select className={INPUT_CLS} value={fact.tipo} onChange={e => updateF('tipo', e.target.value)}>
              <option value="prepago">Prepago (Adelantado)</option>
              <option value="postpago">Postpago (Mes vencido)</option>
            </select>
          </Field>
          <Field label="Día pago">
            <select className={INPUT_CLS} value={fact.diaPago} onChange={e => updateF('diaPago', e.target.value)}>
              {S2_DIAS_MES.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Crear Factura">
            <select className={INPUT_CLS} value={fact.crearFactura} onChange={e => updateF('crearFactura', e.target.value)}>
              {S2_CREAR_FACTURA_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Aviso de factura disponible">
            <select className={INPUT_CLS} value={fact.plantillaAvisoFactura ?? ''} onChange={e => updateF('plantillaAvisoFactura', e.target.value)}>
              <option value="">— Sin plantilla específica —</option>
              {plantillasMsg.map(p => <option key={p.id ?? p.codigo} value={p.id ?? p.codigo}>{p.nombre}</option>)}
            </select>
          </Field>
          <Field label="Tipo impuesto">
            <select className={INPUT_CLS} value={fact.tipoImpuesto} onChange={e => updateF('tipoImpuesto', e.target.value)}>
              <option value="ninguno">Ninguno</option>
              <option value="incluido">Impuestos incluidos</option>
              <option value="mas_impuestos">Más impuestos</option>
            </select>
          </Field>
          <Field label="Días de gracia" hint="*días tolerancia para aplicar corte">
            <select className={INPUT_CLS} value={fact.diasGracia} onChange={e => updateF('diasGracia', e.target.value)}>
              {S2_DIAS_GRACIA_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Aplicar Corte">
            <select className={INPUT_CLS} value={fact.aplicarCorte} onChange={e => updateF('aplicarCorte', e.target.value)}>
              {S2_APLICAR_CORTE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Bajar Velocidad">
            <select className={INPUT_CLS} value={bajarVel} onChange={e => setBajarVel(e.target.value)}>
              {S2_BAJAR_VEL_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Fecha Fija" hint="Dejar vacío para fecha automática">
            <div className="flex gap-2">
              <input type="date" className={INPUT_CLS} value={fechaFija} onChange={e => setFechaFija(e.target.value)} />
              {fechaFija && (
                <button type="button" onClick={() => setFechaFija('')}
                  className="flex-shrink-0 p-2.5 rounded-lg border border-input bg-muted hover:bg-muted/70 transition-colors">
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </Field>
          <Field label="Corte Fijo Programado">
            <div className="flex gap-2">
              <input type="date" className={INPUT_CLS} value={corteFijo} onChange={e => setCorteFijo(e.target.value)} />
              {corteFijo && (
                <button type="button" onClick={() => setCorteFijo('')}
                  className="flex-shrink-0 p-2.5 rounded-lg border border-input bg-muted hover:bg-muted/70 transition-colors">
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </Field>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-foreground">Aplicar Mora</span>
            <div className="flex items-center gap-3">
              <ToggleSwitch checked={fact.aplicarMora} onChange={v => updateF('aplicarMora', v)} />
              {fact.aplicarMora && (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">S/</span>
                  <DecimalInput2 className={INPUT_CLS} placeholder="Monto mora"
                    value={fact.montoMora} onChange={v => updateF('montoMora', v)} />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-foreground">Aplicar Reconexión</span>
            <div className="flex items-center gap-3">
              <ToggleSwitch checked={fact.aplicarReconexion} onChange={v => updateF('aplicarReconexion', v)} />
              {fact.aplicarReconexion && (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">S/</span>
                  <DecimalInput2 className={INPUT_CLS} placeholder="Monto reconexión"
                    value={fact.montoReconexion} onChange={v => updateF('montoReconexion', v)} />
                </div>
              )}
            </div>
          </div>
          <div className="pt-3 border-t border-border space-y-3">
            <p className="text-sm font-semibold text-foreground">Otros Impuestos</p>
            <p className="text-xs text-muted-foreground -mt-2">Estos impuestos serán agregados al total de la factura</p>
            <Field label="Impuesto #1 (%)" hint="* Dejar en 0 (cero) para quedar deshabilitado">
              <DecimalInput2 className={INPUT_CLS} value={fact.impuesto1} onChange={v => updateF('impuesto1', v)} />
            </Field>
          </div>
        </Section>

        {/* Notificaciones */}
        <Section title="Notificaciones" icon={Bell}>
          <Field label="Aviso nueva factura">
            <select className={INPUT_CLS} value={notif.avisoNuevaFactura} onChange={e => updateN('avisoNuevaFactura', e.target.value)}>
              <option value="desactivado">Desactivado</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="ambos">WhatsApp + SMS</option>
            </select>
          </Field>
          <Field label="Aviso en Pantalla" hint="* Aviso sólo en páginas HTTP">
            <select className={INPUT_CLS} value={notif.avisoPantalla} onChange={e => updateN('avisoPantalla', e.target.value)}>
              <option value="desactivado">Desactivado</option>
              <option value="activado">Activado</option>
            </select>
          </Field>
          <Field label="Recordatorios de pago">
            <select className={INPUT_CLS} value={notif.recordatoriosPago} onChange={e => updateN('recordatoriosPago', e.target.value)}>
              <option value="desactivado">Desactivado</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="ambos">WhatsApp + SMS</option>
            </select>
          </Field>
          {(['recordatorio1', 'recordatorio2', 'recordatorio3'] as const).map((key, i) => {
            const plantillaKey = `plantillaRecordatorio${i + 1}` as keyof NotificacionesConfig;
            return (
              <Field key={key} label={`Recordatorio #${i + 1}`}>
                <select className={INPUT_CLS} value={notif[key]} onChange={e => updateN(key, e.target.value)}>
                  <option value="desactivado">Desactivado</option>
                  <optgroup label="Antes del vencimiento">
                    {S2_RECORDATORIO_ANTES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </optgroup>
                  <optgroup label="Después del vencimiento">
                    {S2_RECORDATORIO_DESPUES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </optgroup>
                </select>
                <select className={INPUT_CLS} value={(notif[plantillaKey] as string) ?? ''} onChange={e => updateN(plantillaKey, e.target.value)}>
                  <option value="">— Sin plantilla específica —</option>
                  {plantillasMsg.map(p => <option key={p.id ?? p.codigo} value={p.id ?? p.codigo}>{p.nombre}</option>)}
                </select>
              </Field>
            );
          })}
          <p className="text-xs text-orange-500 mt-1">* Días antes/después del vencimiento de una factura</p>
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
  const [costoInstalacion, setCostoInstalacion]           = useState(false);
  const [montoCostoInstalacion, setMontoCostoInstalacion] = useState(0);

  const pppUser = String(Date.now()).slice(-10).padStart(10, '0');
  const pppPass = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

  const { register, handleSubmit, watch, setValue, setError, formState: { errors: s3Errors } } = useForm<S3>({
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

  const excluirFirewall  = watch('excluirFirewall') ?? false;
  const cajaNap          = watch('cajaNapId');
  const perfilId         = watch('perfilId');
  const conectadoAIdVal  = watch('conectadoAId');

  const { data: routers = [] } = useQuery({ queryKey: ['routers-list'], queryFn: redesApi.listRouters });

  const { data: planesRaw = [] } = useQuery({ queryKey: ['planes-list'], queryFn: planesApi.list });
  const planes = (planesRaw as any[]).filter((p: any) => p.activo !== false);

  const planSeleccionado = planes.find((p: any) => p.id === perfilId) as any | undefined;

  const routerId   = watch('routerId');
  const segmentoId = watch('segmentoId');

  // Router seleccionado — para derivar comportamiento de auth
  const routerSel      = (routers as RouterType[]).find(r => r.id === routerId);
  const authPorAbonado = routerSel ? routerSel.controlaAutenticacion === false : false;
  const tipoControlVal = watch('tipoControl');
  const authEfectiva   = authPorAbonado ? (tipoControlVal ?? 'ninguna') : (routerSel?.tipoControl ?? 'ninguna');
  const mostrarPppoe   = authEfectiva === 'pppoe_addresslist';
  const requiereMac    = authEfectiva === 'amarre_ip_mac' || authEfectiva === 'amarre_ip_mac_dhcp';
  const macRequerida   = requiereMac || !!conectadoAIdVal;

  const { data: segmentosRaw = [] } = useQuery({
    queryKey: ['segmentos-router', routerId],
    queryFn:  () => redesApi.listSegmentos(routerId!),
    enabled:  !!routerId,
  });
  const segmentos = segmentosRaw as any[];

  // Antenas AP vinculadas al router seleccionado
  const { data: antenasAP = [] } = useQuery({
    queryKey: ['antenas-ap', routerId],
    queryFn:  () => redesApi.listAntenasAP(routerId!),
    enabled:  !!routerId,
  });

  // Al cambiar de router: limpiar segmento, IP y antena
  useEffect(() => {
    setValue('segmentoId', '');
    setValue('ipv4', '');
    setValue('conectadoAId', '');
  }, [routerId]);

  const { data: nextIpData, isFetching: fetchingIp } = useQuery({
    queryKey:  ['next-ip', segmentoId],
    queryFn:   () => redesApi.getNextIp(segmentoId!),
    enabled:   !!segmentoId,
    staleTime: 0,
  });

  // Auto-completar IPv4 cuando llega la sugerencia
  useEffect(() => {
    if (!segmentoId) { setValue('ipv4', ''); return; }
    if (nextIpData !== undefined) setValue('ipv4', nextIpData ?? '');
  }, [segmentoId, nextIpData]);

  useEffect(() => {
    if (planSeleccionado?.precio != null) {
      setValue('costo', Number(planSeleccionado.precio).toFixed(2) as any);
    }
  }, [perfilId]);

  const PUERTOS_NAP = cajaNap
    ? Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, nombre: `Puerto ${i + 1}` }))
    : [];

  const onFormSubmit = async (data: S3) => {
    if (data.perfilId && !data.routerId?.trim()) {
      setError('routerId', { message: 'Debes seleccionar un router cuando se elige un plan de servicio' });
      return;
    }
    if ((requiereMac || !!data.conectadoAId) && !data.mac?.trim()) {
      const motivo = requiereMac
        ? 'MAC obligatorio para Amarre IP/MAC'
        : 'MAC obligatorio al seleccionar una antena';
      setError('mac', { message: motivo });
      return;
    }
    if (mostrarPppoe && !data.userPppHs?.trim()) {
      setError('userPppHs', { message: 'Usuario PPPoE requerido' });
      return;
    }
    if (mostrarPppoe && !data.passwordPppHs?.trim()) {
      setError('passwordPppHs', { message: 'Contraseña PPPoE requerida' });
      return;
    }
    setSubmitting(true);
    try   { await onSubmit({ ...data, _costoInstalacion: costoInstalacion, _montoCostoInstalacion: montoCostoInstalacion } as any); }
    catch { setSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* ── Izquierda: Configuración ── */}
        <Section title="Configuración de servicio" icon={Wifi}>
          {/* Router */}
          <Field label="Router" error={s3Errors.routerId?.message}>
            <select {...register('routerId')} className={INPUT_CLS}>
              <option value="">— Seleccionar router —</option>
              {(routers as any[]).map((r: any) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
          </Field>

          {/* Autenticación por abonado — visible solo si el router NO controla auth */}
          {authPorAbonado && (
            <Field label="Tipo de Autenticación">
              <select {...register('tipoControl')} className={INPUT_CLS}>
                {SECURITY_OPTS_ABONADO.map((o) => (
                  <option key={o.val} value={o.val}>{o.label}</option>
                ))}
              </select>
            </Field>
          )}

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
            <select {...register('perfilId')} className={INPUT_CLS}>
              <option value="">— Seleccionar plan —</option>
              {planes.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}{p.precio ? ` — S/. ${Number(p.precio).toFixed(2)}` : ''}
                </option>
              ))}
            </select>
          </Field>

          {/* Descripción */}
          <Field label="Descripción" hint="* Texto para facturación">
            <textarea
              value={planSeleccionado?.descripcion ?? ''}
              readOnly
              rows={2}
              className={cn(INPUT_CLS, 'resize-none bg-muted/50 cursor-default')}
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
              className={INPUT_CLS}
            />
          </Field>

          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-foreground">Añadir costo de instalación</span>
            <div className="flex items-center gap-3">
              <ToggleSwitch checked={costoInstalacion} onChange={v => setCostoInstalacion(v)} />
              {costoInstalacion && (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">S/</span>
                  <DecimalInput2 className={INPUT_CLS} placeholder="Monto instalación"
                    value={montoCostoInstalacion} onChange={v => setMontoCostoInstalacion(v)} />
                </div>
              )}
            </div>
          </div>

          {/* Redes IPv4 — solo las vinculadas al router seleccionado */}
          <Field
            label="Redes IPv4"
            hint={!routerId ? '* Selecciona un router primero' : undefined}
          >
            <select
              {...register('segmentoId')}
              disabled={!routerId}
              className={cn(INPUT_CLS, !routerId && 'opacity-50 cursor-not-allowed')}
            >
              <option value="">{routerId ? 'Seleccionar red…' : '— Elige un router primero —'}</option>
              {segmentos.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}{s.redCidr ? ` — ${s.redCidr}` : ''}{s.ipsDisponibles != null ? ` (${s.ipsDisponibles} disponibles)` : ''}
                </option>
              ))}
            </select>
          </Field>

          {/* IPv4 — auto-sugerida al elegir segmento */}
          {segmentoId && (
            <Field label="IPv4">
              <div className="relative">
                <Network className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  {...register('ipv4')}
                  placeholder="—"
                  className={cn(INPUT_CLS, 'pl-9 pr-28')}
                  readOnly={fetchingIp}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  {fetchingIp ? (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" /> Buscando…
                    </span>
                  ) : nextIpData ? (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
                      <CheckCircle2 className="w-3 h-3" /> Disponible
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] text-amber-500 font-medium">
                      <AlertCircle className="w-3 h-3" /> Pool lleno
                    </span>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Primera IP libre del segmento. Puedes editarla manualmente.
              </p>
            </Field>
          )}

          {/* Mac */}
          <Field
            label={macRequerida ? 'Mac *' : 'Mac'}
            hint={
              requiereMac
                ? 'Obligatorio — router configurado con Amarre IP/MAC'
                : conectadoAIdVal
                ? 'Obligatorio — requerido al seleccionar una antena'
                : 'Dirección MAC del equipo cliente'
            }
            error={s3Errors.mac?.message}
          >
            <input
              {...register('mac')}
              placeholder="AA:BB:CC:DD:EE:FF"
              className={INPUT_CLS}
            />
          </Field>

          {/* PPPoE — solo cuando el router tiene tipoControl = pppoe_addresslist */}
          {mostrarPppoe && (
            <>
              <div className="px-0 py-1">
                <div className="flex items-center gap-2 text-[11px] text-primary font-semibold bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
                  <Lock className="w-3 h-3 flex-shrink-0" />
                  Router configurado con PPPoE + Address List
                </div>
              </div>
              <Field label="User PPP/HS *" error={s3Errors.userPppHs?.message}>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    {...register('userPppHs')}
                    className={cn(INPUT_CLS, !!s3Errors.userPppHs && INPUT_ERR, 'pl-9')}
                  />
                </div>
              </Field>
              <Field label="Password PPP/HS *" error={s3Errors.passwordPppHs?.message}>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    {...register('passwordPppHs')}
                    className={cn(INPUT_CLS, !!s3Errors.passwordPppHs && INPUT_ERR, 'pl-9')}
                  />
                </div>
              </Field>
            </>
          )}

          {/* Routes */}
          <Field label="Routes" hint="* Dato Opcional">
            <input
              {...register('routes')}
              placeholder="Ejm: 192.168.10.0/24"
              className={INPUT_CLS}
            />
          </Field>

          {/* Caja Nap */}
          <Field label="Caja Nap">
            <select {...register('cajaNapId')} className={INPUT_CLS}>
              <option value="">Ninguno</option>
              {MOCK_CAJAS_NAP.filter(n => n.id).map((n) => (
                <option key={n.id} value={n.nombre}>{n.nombre}</option>
              ))}
            </select>
          </Field>

          {/* Puerto Nap */}
          <Field label="Puerto Nap">
            <select {...register('puertoNapId')} className={INPUT_CLS} disabled={!cajaNap}>
              <option value="">Ninguno</option>
              {PUERTOS_NAP.map((p) => (
                <option key={p.id} value={p.nombre}>{p.nombre}</option>
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
                  className={cn(INPUT_CLS, 'pl-9')}
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
                  className={cn(INPUT_CLS, 'pl-9')}
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
                  className={cn(INPUT_CLS, 'pl-9')}
                />
              </div>
            </Field>
          </Section>

          {/* Equipo receptor */}
          <Section title="Equipo receptor" icon={Radio}>
            {/* Conectado A — Antenas AP vinculadas al router seleccionado */}
            <Field
              label="Conectado A"
              hint={!routerId ? '* Selecciona un router primero' : undefined}
            >
              <select
                {...register('conectadoAId')}
                disabled={!routerId}
                className={cn(INPUT_CLS, !routerId && 'opacity-50 cursor-not-allowed')}
              >
                <option value="">{routerId ? '— Seleccionar antena AP —' : '— Elige un router primero —'}</option>
                {(antenasAP as any[]).map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.nombreEmisor}{a.ipAddress ? ` — ${a.ipAddress}` : ''}
                  </option>
                ))}
              </select>
              {routerId && (antenasAP as any[]).length === 0 && (
                <p className="text-[11px] text-amber-500 mt-1">
                  Sin antenas AP registradas para este router.
                </p>
              )}
            </Field>

            {/* IP administración */}
            <Field label="IP administración" hint="* IP antena del cliente">
              <div className="relative">
                <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  {...register('ipAdministracion')}
                  placeholder="192.168.1.1"
                  className={cn(INPUT_CLS, 'pl-9')}
                />
              </div>
            </Field>

            {/* Tipo antena */}
            <Field label="Tipo antena">
              <select {...register('tipoAntena')} className={INPUT_CLS}>
                {MOCK_TIPO_ANTENA.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
          </Section>
        </div>
      </div>

      {/* Advertencia si no hay plan */}
      {!perfilId && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Sin plan seleccionado, el abonado quedará en <strong>PENDIENTE DE INSTALACIÓN</strong> sin contrato activo.
        </div>
      )}

      {/* ── Botones finales ── */}
      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary"
        >
          <ChevronLeft className="w-4 h-4" /> Atrás
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary"
        >
          {submitting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</>
            : <><CheckCircle2 className="w-4 h-4" /> Registrar Abonado</>
          }
        </button>
      </div>
    </form>
  );
}
