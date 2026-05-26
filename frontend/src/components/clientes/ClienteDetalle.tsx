'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm }                     from 'react-hook-form';
import { zodResolver }                 from '@hookform/resolvers/zod';
import { z }                           from 'zod';
import { useRouter }                   from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Search, Calendar, Monitor, MessageSquare,
  CreditCard, Wifi, WifiOff, Loader2, Radio, Cable, Shuffle,
  XCircle, ScrollText, FolderOpen, Wrench, Save, AlertCircle,
  Receipt, BarChart2, Ticket, Plus, FileText, ChevronDown,
  Trash2, X, Pencil, Copy, Download, AlignJustify,
  LayoutGrid, RefreshCcw, Maximize2, Minus, Phone, Package,
  Network, Lock, Navigation, Server, MapPin, User, ChevronRight,
  MoreVertical, CheckCircle2, Clock, AlertTriangle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

import { clientesApi }                          from '@/lib/api/clientes';
import { contratosApi, planesApi, redesApi }    from '@/lib/api/contratos';
import { zonasApi }                             from '@/lib/api/zonas';
import { TabOnuRouter }                        from './TabOnuRouter';
import { TabConfigFacturacion }                from './TabConfigFacturacion';
import { facturacionApi, pagosApi, METODOS_PAGO } from '@/lib/api/facturacion';
import type { CreateFacturaDto, UpdateFacturaDto } from '@/lib/api/facturacion';
import { ClienteEstadoBadge }        from './ClienteEstadoBadge';
import { useToast }                  from '@/components/ui/toaster';
import { formatDate, formatPEN, cn } from '@/lib/utils';
import type { Contrato, Factura, Pago } from '@/types';

// ── Tabs ──────────────────────────────────────────────────────
const TABS = [
  { key: 'resumen',      label: 'Resumen',      icon: Monitor      },
  { key: 'onu_router',   label: 'ONU/Router',   icon: Radio        },
  { key: 'servicios',    label: 'Servicios',    icon: Wifi         },
  { key: 'facturacion',  label: 'Facturación',  icon: CreditCard   },
  { key: 'estadisticas', label: 'Consumo',      icon: BarChart2    },
  { key: 'email_sms',    label: 'Mensajes',     icon: MessageSquare},
  { key: 'documentos',   label: 'Documentos',   icon: FolderOpen   },
  { key: 'tickets',      label: 'Tickets',      icon: Ticket       },
  { key: 'logs',         label: 'Log',          icon: ScrollText   },
] as const;
type TabKey = typeof TABS[number]['key'];

// ── Avatar ────────────────────────────────────────────────────
const AV_COLORS = [
  'from-blue-500 to-blue-700', 'from-violet-500 to-violet-700',
  'from-emerald-500 to-emerald-700', 'from-orange-500 to-orange-700',
  'from-pink-500 to-pink-700', 'from-teal-500 to-teal-700',
];
function avatarGradient(name: string) {
  const s = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AV_COLORS[s % AV_COLORS.length];
}
function initials(name: string) {
  const p = name.trim().split(' ');
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

// ── Service badge ─────────────────────────────────────────────
const SVC: Record<string, { icon: React.ElementType; label: string }> = {
  ftth:     { icon: Radio,   label: 'FTTH'     },
  wisp:     { icon: Wifi,    label: 'WISP'     },
  dedicado: { icon: Cable,   label: 'Dedicado' },
  mixto:    { icon: Shuffle, label: 'Mixto'    },
};

// ── Field input style ─────────────────────────────────────────
const INPUT = [
  'w-full px-3 py-2 text-sm bg-background border border-input rounded-lg',
  'text-foreground placeholder:text-muted-foreground',
  'focus:outline-none focus:ring-1 focus:ring-primary transition-colors',
].join(' ');

// ─────────────────────────────────────────────────────────────
export function ClienteDetalle({ id }: { id: string }) {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [tab, setTab]           = useState<TabKey>('resumen');
  const [form, setForm]         = useState<Record<string, string>>({});
  const [formDirty, setDirty]   = useState(false);
  const [formErrors, setErrors] = useState<Record<string, string>>({});
  const initialized             = useRef(false);

  const { data: cliente, isLoading } = useQuery({
    queryKey: ['cliente', id],
    queryFn:  () => clientesApi.getById(id),
  });

  const { data: contratos = [] } = useQuery({
    queryKey: ['cliente-contratos', id],
    queryFn:  () => clientesApi.getContratos(id),
    enabled:  tab === 'servicios' || tab === 'resumen',
  });

  const { data: zonas = [] } = useQuery({
    queryKey: ['zonas'],
    queryFn:  zonasApi.list,
  });

  // Inicializar formulario una sola vez
  useEffect(() => {
    if (cliente && !initialized.current) {
      initialized.current = true;
      setForm({
        nombres:         (cliente as any).nombres         ?? '',
        apellidoPaterno: (cliente as any).apellidoPaterno ?? '',
        apellidoMaterno: (cliente as any).apellidoMaterno ?? '',
        numeroDocumento: cliente.numeroDocumento          ?? '',
        telefono:        cliente.telefono                 ?? '',
        telefonoAlt:     (cliente as any).telefonoAlt     ?? '',
        whatsapp:        (cliente as any).whatsapp        ?? '',
        email:           (cliente as any).email           ?? '',
        direccion:       (cliente as any).direccion       ?? '',
        referencia:      (cliente as any).referencia      ?? '',
        departamento:    (cliente as any).departamento    ?? '',
        provincia:       (cliente as any).provincia       ?? '',
        distrito:        (cliente as any).distrito        ?? '',
        zonaId:          (cliente as any).zonaId          ?? '',
        usuarioPortal:   (cliente as any).usuarioPortal   ?? '',
        passwordPortal:  (cliente as any).passwordPortal  ?? '',
      });
    }
  }, [cliente]);

  const { mutate: guardar, isPending: guardando } = useMutation({
    mutationFn: () => clientesApi.update(id, form as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', id] });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      toast('Datos guardados correctamente', { type: 'success' });
      setDirty(false);
    },
    onError: () => toast('Error al guardar los datos', { type: 'error' }),
  });

  const { mutate: cambiarEstado } = useMutation({
    mutationFn: (estado: string) => clientesApi.cambiarEstado(id, estado),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', id] });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      toast('Estado actualizado', { type: 'success' });
    },
    onError: () => toast('No se pudo cambiar el estado', { type: 'error' }),
  });

  const set = (key: string, val: string) => {
    setForm((f) => ({ ...f, [key]: val }));
    setDirty(true);
    if (formErrors[key]) setErrors((e) => ({ ...e, [key]: '' }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.numeroDocumento?.trim()) e.numeroDocumento = 'Requerido';
    if (!form.nombres?.trim())         e.nombres         = 'Requerido';
    if (!form.direccion?.trim())       e.direccion       = 'Requerido';
    if (!form.whatsapp?.trim())        e.whatsapp        = 'Requerido';
    if (!form.usuarioPortal?.trim())   e.usuarioPortal   = 'Requerido';
    if (!form.passwordPortal?.trim())  e.passwordPortal  = 'Requerido';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Loading ───────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse max-w-6xl">
        <div className="skeleton h-14 rounded-xl" />
        <div className="skeleton h-12 rounded-xl" />
        <div className="skeleton h-96 rounded-2xl" />
      </div>
    );
  }
  if (!cliente) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <XCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-sm font-semibold text-foreground">Cliente no encontrado</p>
        <button onClick={() => router.back()} className="mt-4 text-sm text-primary hover:underline">
          Volver
        </button>
      </div>
    );
  }

  const grad         = avatarGradient(cliente.nombreCompleto);
  const ctrato       = (contratos as any[])[0];
  const diaPago      = ctrato?.diaPago ? `Día ${ctrato.diaPago} de cada mes` : '—';
  const deuda        = formatPEN(ctrato?.deudaTotal ?? 0);
  const proxCorte    = ctrato?.fechaProximaFacturacion ? formatDate(ctrato.fechaProximaFacturacion) : '—';
  const routerNombre = (contratos as any[]).map((c) => c.nodo ?? c.router ?? '').filter(Boolean).join(', ') || '—';

  return (
    <div className="max-w-6xl space-y-4">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/clientes')}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className={cn(
          'w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0',
          'text-sm font-bold text-white bg-gradient-to-br shadow',
          grad,
        )}>
          {initials(cliente.nombreCompleto)}
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-foreground truncate leading-tight">
            {cliente.nombreCompleto}
            {cliente.codigoCliente && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                (#{cliente.codigoCliente})
              </span>
            )}
          </h1>
          <nav className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
            <button onClick={() => router.push('/')} className="hover:text-foreground transition-colors">
              Inicio
            </button>
            <span>/</span>
            <button onClick={() => router.push('/clientes')} className="hover:text-foreground transition-colors">
              Lista abonados ({cliente.estado})
            </button>
            <span>/</span>
            <span className="text-foreground font-medium">Editar abonado</span>
          </nav>
        </div>
      </div>

      {/* ── Card principal ────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">

        {/* Tab bar */}
        <div className="flex items-center border-b border-border overflow-x-auto scrollbar-none bg-muted/20">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-3 text-xs font-medium whitespace-nowrap flex-shrink-0',
                  'border-b-2 transition-all duration-150',
                  active
                    ? 'border-primary text-primary bg-card'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-card/60',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
          <button className="ml-auto px-3 py-3 text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors">
            <Wrench className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── Resumen ──────────────────────────────────────── */}
        {tab === 'resumen' && (
          <div className="grid lg:grid-cols-[1fr_300px] divide-y lg:divide-y-0 lg:divide-x divide-border">

            {/* Izquierda: Datos del cliente */}
            <div className="p-6 space-y-1">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-4">
                <span className="text-primary font-bold">&raquo;</span> Datos del Abonado
              </h3>

              <FormRow label="Estado">
                <div className="flex items-center gap-2 flex-wrap">
                  <ClienteEstadoBadge estado={cliente.estado} />
                  <select
                    value={cliente.estado}
                    onChange={(e) => cambiarEstado(e.target.value)}
                    className="text-xs bg-muted border border-input rounded-lg px-2 py-1.5
                               text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="activo">Activo</option>
                    <option value="suspendido">Suspendido</option>
                    <option value="moroso">Moroso</option>
                    <option value="baja_temporal">Baja temporal</option>
                    <option value="baja_definitiva">Baja definitiva</option>
                  </select>
                </div>
              </FormRow>

              <FormRow label="Conectado al Router(s)">
                <span className="text-sm text-foreground">{routerNombre}</span>
              </FormRow>

              <FormRow label="ID">
                <input
                  value={cliente.codigoCliente ?? ''}
                  readOnly
                  className={cn(INPUT, 'bg-muted/50 cursor-default')}
                />
              </FormRow>

              <FormRow label="Nº Identificación" required error={formErrors.numeroDocumento}>
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <input
                      value={form.numeroDocumento ?? ''}
                      onChange={(e) => set('numeroDocumento', e.target.value)}
                      className={cn(INPUT, 'flex-1', formErrors.numeroDocumento && 'border-destructive')}
                    />
                    <button className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg
                                       border border-input hover:bg-accent transition-colors
                                       text-muted-foreground flex-shrink-0">
                      <Search className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    CEDULA, DNI, RUC, CUIT, NIT, SAT, RUT, RTN, ETC.
                  </p>
                </div>
              </FormRow>

              <FormRow label="Nombres Completos" required error={formErrors.nombres}>
                <input
                  value={form.nombres ?? ''}
                  onChange={(e) => set('nombres', e.target.value)}
                  placeholder="Piero Escobar Bautista"
                  className={cn(INPUT, formErrors.nombres && 'border-destructive')}
                />
              </FormRow>

              <FormRow label="Dirección Principal" required error={formErrors.direccion}>
                <input
                  value={form.direccion ?? ''}
                  onChange={(e) => set('direccion', e.target.value)}
                  className={cn(INPUT, formErrors.direccion && 'border-destructive')}
                />
              </FormRow>

              <FormRow label="Zona">
                <select
                  value={form.zonaId ?? ''}
                  onChange={(e) => set('zonaId', e.target.value)}
                  className={INPUT}
                >
                  <option value="">— Sin zona —</option>
                  {(zonas as any[]).filter((z: any) => z.activo).map((z: any) => (
                    <option key={z.id} value={z.id}>{z.nombre}</option>
                  ))}
                </select>
              </FormRow>

              <FormRow label="WhatsApp" required error={formErrors.whatsapp}>
                <input
                  value={form.whatsapp ?? ''}
                  onChange={(e) => set('whatsapp', e.target.value)}
                  placeholder="987654321"
                  className={cn(INPUT, formErrors.whatsapp && 'border-destructive')}
                />
              </FormRow>

              <FormRow label="Teléfono Móvil">
                <input
                  value={form.telefono ?? ''}
                  onChange={(e) => set('telefono', e.target.value)}
                  className={INPUT}
                />
              </FormRow>

              <FormRow label="E-mail">
                <input
                  value={form.email ?? ''}
                  onChange={(e) => set('email', e.target.value)}
                  type="email"
                  className={INPUT}
                />
              </FormRow>

              <FormRow label="Credenciales Portal" required>
                <div className="flex gap-3">
                  <div className="flex flex-col gap-1 flex-1">
                    <span className="text-xs text-muted-foreground">Usuario<span className="text-destructive ml-0.5">*</span></span>
                    <input
                      value={form.usuarioPortal ?? ''}
                      onChange={(e) => set('usuarioPortal', e.target.value)}
                      placeholder="cliente123"
                      maxLength={12}
                      className={cn(INPUT, formErrors.usuarioPortal && 'border-destructive')}
                    />
                    {formErrors.usuarioPortal && (
                      <p className="text-[11px] text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 flex-shrink-0" />{formErrors.usuarioPortal}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 flex-1">
                    <span className="text-xs text-muted-foreground">Contraseña<span className="text-destructive ml-0.5">*</span></span>
                    <input
                      value={form.passwordPortal ?? ''}
                      onChange={(e) => set('passwordPortal', e.target.value)}
                      placeholder="4243Tdp"
                      maxLength={12}
                      className={cn(INPUT, formErrors.passwordPortal && 'border-destructive')}
                    />
                    {formErrors.passwordPortal && (
                      <p className="text-[11px] text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 flex-shrink-0" />{formErrors.passwordPortal}
                      </p>
                    )}
                  </div>
                </div>
              </FormRow>

              <div className="pt-4">
                <button
                  onClick={() => { if (validate()) guardar(); }}
                  disabled={guardando || !formDirty}
                  className={cn(
                    'flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg font-medium',
                    'bg-primary text-primary-foreground hover:bg-primary/90',
                    'transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  {guardando
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Save className="w-4 h-4" />
                  }
                  Guardar datos
                </button>
              </div>
            </div>

            {/* Derecha: Resumen Notificaciones */}
            <div className="p-6 space-y-1">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-4">
                <span className="text-primary font-bold">&raquo;</span> Resumen Notificaciones
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <NotifCard color="blue"   icon={Calendar}       label="Día de Pago"           value={diaPago}   />
                <NotifCard color="orange" icon={Receipt}        label="Crear & Enviar Factura" value="—"         />
                <NotifCard color="teal"   icon={Monitor}        label="Aviso en pantalla"      value="Desactivado" />
                <NotifCard color="purple" icon={MessageSquare}  label="Aviso SMS"              value="—"         />
                <NotifCard color="red"    icon={XCircle}        label="Próximo Corte"          value={proxCorte} />
                <NotifCard color="indigo" icon={CreditCard}     label="Deuda Actual"           value={deuda}     />
                <NotifCard color="pink"   icon={BarChart2}      label="Saldos"                 value={formatPEN(0)} className="col-span-2" />
              </div>
            </div>
          </div>
        )}

        {/* ── Servicios ────────────────────────────────────── */}
        {tab === 'servicios' && (
          <TabServicios clienteId={id} contratos={contratos as Contrato[]} />
        )}

        {/* ── ONU/Router ───────────────────────────────────── */}
        {tab === 'onu_router' && <TabOnuRouter clienteId={id} />}

        {/* Tabs placeholder */}
        {tab === 'facturacion'  && <TabFacturacion clienteId={id} contratos={contratos as Contrato[]} />}
        {tab === 'tickets'      && <div className="p-6"><PlaceholderTab icon={Ticket}        title="Tickets de soporte"     desc="Tickets y reclamos del cliente."      badge="Próximamente" /></div>}
        {tab === 'email_sms'    && <div className="p-6"><PlaceholderTab icon={MessageSquare} title="Email & SMS"            desc="Notificaciones enviadas al cliente."   badge="Próximamente" /></div>}
        {tab === 'documentos'   && <div className="p-6"><PlaceholderTab icon={FolderOpen}    title="Documentos"             desc="Contratos, comprobantes y fotos."      badge="Próximamente" /></div>}
        {tab === 'estadisticas' && <TabEstadisticas clienteId={id} contratos={contratos as Contrato[]} />}
        {tab === 'logs'         && <div className="p-6"><PlaceholderTab icon={ScrollText}    title="Log de actividad"       desc="Registro detallado de acciones."       badge="Próximamente" /></div>}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function FormRow({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3 py-2 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground pt-2.5 font-medium leading-none">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      <div>
        {children}
        {error && (
          <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />{error}
          </p>
        )}
      </div>
    </div>
  );
}

const NOTIF_STYLES: Record<string, string> = {
  blue:   'bg-blue-500',
  orange: 'bg-orange-500',
  teal:   'bg-teal-500',
  purple: 'bg-purple-600',
  red:    'bg-red-500',
  indigo: 'bg-indigo-600',
  pink:   'bg-pink-500',
};

function NotifCard({
  color, icon: Icon, label, value, className,
}: {
  color: string; icon: React.ElementType; label: string; value: string; className?: string;
}) {
  return (
    <div className={cn(
      'rounded-xl p-3 text-white flex flex-col gap-1',
      NOTIF_STYLES[color] ?? 'bg-slate-500',
      className,
    )}>
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 opacity-80 flex-shrink-0" />
        <span className="text-[11px] font-semibold opacity-90 leading-tight">{label}</span>
      </div>
      <p className="text-sm font-bold truncate">{value}</p>
    </div>
  );
}

function PlaceholderTab({
  icon: Icon, title, desc, badge, action,
}: {
  icon: React.ElementType; title: string; desc: string;
  badge?: string; action?: { label: string; href: string };
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-muted-foreground" />
      </div>
      {badge && (
        <span className="mb-2 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
          {badge}
        </span>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">{desc}</p>
      {action && (
        <button
          onClick={() => router.push(action.href)}
          className="mt-5 px-5 py-2.5 text-sm rounded-lg font-medium
                     bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ── TabServicios ──────────────────────────────────────────────

function SvcSectionHeader({ title, icon: Icon }: { title: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-foreground">{title}</span>
      </div>
      <div className="flex items-center gap-0.5">
        <button className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"><Maximize2 className="w-3 h-3" /></button>
        <button className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"><RefreshCcw className="w-3 h-3" /></button>
        <button className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors"><Minus className="w-3 h-3" /></button>
      </div>
    </div>
  );
}

function SvcToolbar({
  count, onAdd, addLabel = '+ Nuevo', search, onSearch,
}: {
  count: number; onAdd?: () => void; addLabel?: string;
  search: string; onSearch: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background">
      <span className="text-[11px] font-bold text-muted-foreground border border-border rounded px-2 py-0.5 min-w-[2rem] text-center">
        {count}
      </span>
      <button className="p-1.5 rounded border border-border text-muted-foreground hover:bg-accent transition-colors">
        <AlignJustify className="w-3.5 h-3.5" />
      </button>
      <button className="p-1.5 rounded border border-border text-muted-foreground hover:bg-accent transition-colors">
        <Download className="w-3.5 h-3.5" />
      </button>
      {onAdd && (
        <button
          onClick={onAdd}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded
                     bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3 h-3" /> {addLabel}
        </button>
      )}
      <div className="ml-auto relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        <input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Buscar..."
          className="pl-7 pr-3 py-1.5 text-[11px] bg-muted border border-input rounded w-40
                     focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
        />
      </div>
    </div>
  );
}

function SvcTh({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-3 py-2 text-left text-[10px] font-bold text-muted-foreground whitespace-nowrap select-none', className)}>
      <span className="flex items-center gap-1">
        {children}
        <span className="text-muted-foreground/40 text-[8px]">↕</span>
      </span>
    </th>
  );
}

const CONTRATO_ESTADO_CFG: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
  pendiente_instalacion: { label: 'Pendiente',  icon: Clock,         cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  activo:               { label: 'Activo',     icon: Wifi,          cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  suspendido_mora:      { label: 'Mora',        icon: AlertTriangle, cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  suspendido_manual:    { label: 'Suspendido',  icon: WifiOff,       cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  prorroga:             { label: 'Prórroga',    icon: CheckCircle2,  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  baja_solicitada:      { label: 'Baja Sol.',   icon: XCircle,       cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  baja_definitiva:      { label: 'Baja Def.',   icon: XCircle,       cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  migrado:              { label: 'Migrado',     icon: Shuffle,       cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

function ContratoEstadoBadge({ estado }: { estado: string }) {
  const cfg = CONTRATO_ESTADO_CFG[estado] ?? { label: estado, icon: Wifi, cls: 'bg-muted text-muted-foreground' };
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold', cfg.cls)}>
      <Icon className="w-2.5 h-2.5" />
      {cfg.label.toUpperCase()}
    </span>
  );
}

function EmptyRow({ cols, icon: Icon, msg }: { cols: number; icon: React.ElementType; msg: string }) {
  return (
    <tr>
      <td colSpan={cols} className="py-10 text-center">
        <div className="flex flex-col items-center gap-2">
          <Icon className="w-8 h-8 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">{msg}</p>
        </div>
      </td>
    </tr>
  );
}

function SvcPagination({ total }: { total: number }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-t border-border text-[10px] text-muted-foreground">
      <span>Mostrando 1 al {total} de un total de {total}</span>
      <div className="flex items-center gap-1">
        <button className="px-2 py-0.5 border border-border rounded hover:bg-accent transition-colors">←</button>
        <button className="px-2.5 py-0.5 border border-primary bg-primary text-primary-foreground rounded text-[10px]">1</button>
        <button className="px-2 py-0.5 border border-border rounded hover:bg-accent transition-colors">→</button>
      </div>
    </div>
  );
}

// ── ServicioPanel schema ──────────────────────────────────────
const servicioSchema = z.object({
  planId:         z.string().min(1, 'Requerido'),
  routerId:       z.string().optional(),
  segmentoId:     z.string().optional(),
  ipManual:       z.string().optional(),
  usuarioPppoe:   z.string().optional(),
  passwordPppoe:  z.string().optional(),
  fechaInicio:    z.string().min(1, 'Requerido'),
  diaFacturacion: z.coerce.number().int().min(1).max(31).optional().or(z.literal('')),
  descuentoPct:   z.coerce.number().min(0).max(100).optional().or(z.literal('')),
  notasInternas:  z.string().optional(),
});
type ServicioForm = z.infer<typeof servicioSchema>;

function TabServicios({ clienteId, contratos }: { clienteId: string; contratos: Contrato[] }) {
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [q1, setQ1] = useState('');
  const [q2, setQ2] = useState('');
  const [q3, setQ3] = useState('');
  const [q4, setQ4] = useState('');
  const [showPanel,       setShowPanel]       = useState(false);
  const [editingContrato, setEditingContrato] = useState<Contrato | null>(null);

  const filtered = contratos.filter(c =>
    !q1 ||
    (c.planNombre ?? '').toLowerCase().includes(q1.toLowerCase()) ||
    (c.ipAsignada ?? '').includes(q1) ||
    (c.routerNombre ?? '').toLowerCase().includes(q1.toLowerCase()) ||
    c.numeroContrato.toLowerCase().includes(q1.toLowerCase()),
  );

  const { mutate: activar } = useMutation({
    mutationFn: (id: string) => contratosApi.activar(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente-contratos', clienteId] });
      toast('Servicio activado', { type: 'success' });
    },
    onError: () => toast('No se pudo activar el servicio', { type: 'error' }),
  });

  const { mutate: darBaja } = useMutation({
    mutationFn: (id: string) => contratosApi.cambiarEstado(id, { estado: 'baja_definitiva' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente-contratos', clienteId] });
      toast('Servicio dado de baja', { type: 'success' });
    },
    onError: () => toast('No se pudo dar de baja el servicio', { type: 'error' }),
  });

  const openCreate = () => { setEditingContrato(null); setShowPanel(true); };
  const openEdit   = (c: Contrato) => { setEditingContrato(c); setShowPanel(true); };
  const closePanel = () => { setShowPanel(false); setEditingContrato(null); };
  const onSaved    = () => {
    queryClient.invalidateQueries({ queryKey: ['cliente-contratos', clienteId] });
    closePanel();
  };

  return (
    <div className="p-4 space-y-4">

      {/* ── Servicios de Internet ─────────────────────────────── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <SvcSectionHeader title="Servicios de Internet" icon={Wifi} />
        <SvcToolbar
          count={filtered.length}
          search={q1}
          onSearch={setQ1}
          onAdd={openCreate}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <SvcTh>ID</SvcTh>
                <SvcTh>PLAN</SvcTh>
                <SvcTh>COSTO</SvcTh>
                <SvcTh>IP</SvcTh>
                <SvcTh>ROUTER</SvcTh>
                <SvcTh>INSTALADO</SvcTh>
                <SvcTh>ESTADO</SvcTh>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.length === 0 ? (
                <EmptyRow cols={8} icon={Wifi} msg="Ningún registro disponible" />
              ) : filtered.map(c => (
                <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5 font-mono text-muted-foreground">
                    {(c as any).codigoServicio ?? c.numeroContrato ?? c.id.slice(0, 6)}
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-foreground max-w-[200px] truncate">
                    {c.planNombre ?? '—'}
                    {(c.velocidadBajada || c.velocidadSubida) && (
                      <span className="ml-1 text-muted-foreground font-normal">
                        {c.velocidadBajada}/{c.velocidadSubida} Mbps
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-foreground font-semibold whitespace-nowrap">
                    S/. {(c.precioFinal ?? 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-primary whitespace-nowrap">
                    {c.ipAsignada ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                    {(c as any).routerNombre ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                    {c.fechaInicio ? formatDate(c.fechaInicio) : '—'}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <ContratoEstadoBadge estado={c.estado} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => navigator.clipboard?.writeText(c.id)}
                        title="Copiar ID"
                        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => openEdit(c)}
                        title="Editar"
                        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      {c.estado === 'pendiente_instalacion' && (
                        <button
                          onClick={() => activar(c.id)}
                          title="Activar servicio"
                          className="p-1.5 rounded hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-muted-foreground hover:text-emerald-600 transition-colors"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={() => darBaja(c.id)}
                        title="Dar de baja"
                        className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SvcPagination total={filtered.length} />
      </div>

      {/* ── Productos y otros Servicios Recurrentes ───────────── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <SvcSectionHeader
          title="Productos y otros Servicios Recurrentes (CUOTAS Y MENSUAL)"
          icon={Package}
        />
        <SvcToolbar count={0} search={q4} onSearch={setQ4} onAdd={() => {}} addLabel="+ Nuevo" />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <SvcTh>ID</SvcTh>
                <SvcTh>PRODUCTO</SvcTh>
                <SvcTh>MONTO</SvcTh>
                <SvcTh>N° SERIE</SvcTh>
                <SvcTh>N° MAC</SvcTh>
                <SvcTh>FECHA INICIO</SvcTh>
                <SvcTh>ESTADO</SvcTh>
              </tr>
            </thead>
            <tbody>
              <EmptyRow cols={7} icon={Package} msg="Ningún registro disponible" />
            </tbody>
          </table>
        </div>
        <SvcPagination total={0} />
      </div>

      {/* ── Equipos Asignados ─────────────────────────────────── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <SvcSectionHeader title="Equipos Asignados" icon={Radio} />
        <SvcToolbar count={0} search={q2} onSearch={setQ2} />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <SvcTh>ID</SvcTh>
                <SvcTh>N° SERIE</SvcTh>
                <SvcTh>N° MAC</SvcTh>
                <SvcTh>EQUIPO</SvcTh>
                <SvcTh>FECHA</SvcTh>
                <SvcTh>ESTADO</SvcTh>
              </tr>
            </thead>
            <tbody>
              <EmptyRow cols={6} icon={Radio} msg="Ningún registro disponible" />
            </tbody>
          </table>
        </div>
        <SvcPagination total={0} />
      </div>

      {/* ── Servicios Voip ────────────────────────────────────── */}
      <div className="border border-border rounded-xl overflow-hidden">
        <SvcSectionHeader title="Servicios Voip" icon={Phone} />
        <SvcToolbar count={0} search={q3} onSearch={setQ3} onAdd={() => {}} addLabel="+ Nuevo" />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <SvcTh>ID</SvcTh>
                <SvcTh>PLAN</SvcTh>
                <SvcTh>SIP SERVER</SvcTh>
                <SvcTh>SIP USER</SvcTh>
                <SvcTh>AUTHENTICATE ID</SvcTh>
                <SvcTh>N° TELÉFONO</SvcTh>
                <SvcTh>COSTO</SvcTh>
                <SvcTh>INSTALADO</SvcTh>
                <SvcTh>NOTAS</SvcTh>
              </tr>
            </thead>
            <tbody>
              <EmptyRow cols={9} icon={Phone} msg="Ningún registro disponible" />
            </tbody>
          </table>
        </div>
        <SvcPagination total={0} />
      </div>

      {/* ── Slide-over panel ─────────────────────────────────── */}
      {showPanel && (
        <ServicioPanel
          clienteId={clienteId}
          editing={editingContrato}
          onClose={closePanel}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function ServicioPanel({
  clienteId, editing, onClose, onSaved,
}: {
  clienteId: string;
  editing:   Contrato | null;
  onClose:   () => void;
  onSaved:   () => void;
}) {
  const { toast } = useToast();
  const {
    register, handleSubmit, watch, setValue,
    formState: { errors, isSubmitting },
  } = useForm<ServicioForm>({
    resolver: zodResolver(servicioSchema),
    defaultValues: {
      planId:         editing?.planId             ?? '',
      routerId:       editing?.routerId           ?? '',
      segmentoId:     '',
      ipManual:       editing?.ipAsignada         ?? '',
      usuarioPppoe:   editing?.usuarioPppoe       ?? '',
      passwordPppoe:  '',
      fechaInicio:    editing?.fechaInicio
        ? editing.fechaInicio.split('T')[0]
        : new Date().toISOString().split('T')[0],
      diaFacturacion: (editing as any)?.diaFacturacion ?? '',
      descuentoPct:   (editing as any)?.descuentoPct   ?? '',
      notasInternas:  (editing as any)?.notasInternas  ?? '',
    },
  });

  const routerId   = watch('routerId');
  const segmentoId = watch('segmentoId');
  const planId     = watch('planId');

  const { data: planes  = [] } = useQuery({ queryKey: ['planes'],        queryFn: planesApi.list });
  const { data: routers = [] } = useQuery({ queryKey: ['routers-list'], queryFn: redesApi.listRouters });
  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos-router', routerId],
    queryFn:  () => redesApi.listSegmentos(routerId!),
    enabled:  !!routerId,
  });
  const { data: nextIp, isFetching: fetchingIp } = useQuery({
    queryKey:  ['next-ip', segmentoId],
    queryFn:   () => redesApi.getNextIp(segmentoId!),
    enabled:   !!segmentoId && !editing,
    staleTime: 0,
  });

  useEffect(() => { setValue('segmentoId', ''); setValue('ipManual', ''); }, [routerId]);
  useEffect(() => {
    if (!segmentoId || editing) return;
    if (nextIp !== undefined) setValue('ipManual', nextIp ?? '');
  }, [segmentoId, nextIp]);

  const planSel = (planes as any[]).find((p: any) => p.id === planId);

  const onSubmit = async (data: ServicioForm) => {
    try {
      if (editing) {
        await contratosApi.update(editing.id, {
          planId:         data.planId,
          routerId:       data.routerId       || undefined,
          notasInternas:  data.notasInternas  || undefined,
          descuentoPct:   data.descuentoPct   ? Number(data.descuentoPct)   : undefined,
          diaFacturacion: data.diaFacturacion ? Number(data.diaFacturacion) : undefined,
        });
        toast('Servicio actualizado', { type: 'success' });
      } else {
        await contratosApi.create({
          clienteId,
          planId:         data.planId,
          routerId:       data.routerId       || undefined,
          segmentoId:     data.segmentoId     || undefined,
          ipManual:       data.ipManual       || undefined,
          usuarioPppoe:   data.usuarioPppoe   || undefined,
          passwordPppoe:  data.passwordPppoe  || undefined,
          fechaInicio:    data.fechaInicio,
          diaFacturacion: data.diaFacturacion ? Number(data.diaFacturacion) : undefined,
          descuentoPct:   data.descuentoPct   ? Number(data.descuentoPct)   : undefined,
          notasInternas:  data.notasInternas  || undefined,
        });
        toast('Servicio creado correctamente', { type: 'success' });
      }
      onSaved();
    } catch (err: any) {
      toast(err?.response?.data?.message ?? 'Error al guardar', { type: 'error' });
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-[520px] bg-background border-l border-border z-50 flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-foreground">
              {editing ? 'Editar Servicio' : 'Nuevo Servicio de Internet'}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {editing
                ? `Contrato ${editing.numeroContrato}`
                : 'Configurar nuevo contrato de internet'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-accent transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Plan */}
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Plan / Perfil *
            </label>
            <select {...register('planId')} className={INPUT}>
              <option value="">— Seleccionar plan —</option>
              {(planes as any[]).map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} — {p.velocidadBajada}/{p.velocidadSubida} Mbps — S/. {p.precio}
                </option>
              ))}
            </select>
            {errors.planId && (
              <p className="text-[10px] text-destructive mt-1">{errors.planId.message}</p>
            )}
            {planSel && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Precio base:{' '}
                <span className="font-semibold text-foreground">S/. {Number(planSel.precio ?? 0).toFixed(2)}</span>
                {planSel.velocidadBajada && (
                  <span className="ml-2 text-muted-foreground">
                    {planSel.velocidadBajada}/{planSel.velocidadSubida} Mbps
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Router + Segmento */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Router
              </label>
              <select {...register('routerId')} className={INPUT}>
                <option value="">— Sin router —</option>
                {(routers as any[]).map((r: any) => (
                  <option key={r.id} value={r.id}>{r.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Red IPv4
              </label>
              <select
                {...register('segmentoId')}
                disabled={!routerId}
                className={cn(INPUT, !routerId && 'opacity-50 cursor-not-allowed')}
              >
                <option value="">{routerId ? 'Seleccionar red…' : '— Elige router —'}</option>
                {(segmentos as any[]).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre} ({s.redCidr}) — {s.ipsDisponibles} libres
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* IPv4 */}
          {(segmentoId || editing?.ipAsignada) && (
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                IPv4 Asignada
              </label>
              <div className="relative">
                <input
                  {...register('ipManual')}
                  placeholder={fetchingIp ? 'Obteniendo IP…' : '0.0.0.0'}
                  readOnly={!!editing}
                  className={cn(INPUT, editing && 'opacity-60 cursor-not-allowed')}
                />
                {fetchingIp && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              {editing && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  La IP no puede modificarse tras la creación.
                </p>
              )}
            </div>
          )}

          {/* PPPoE (solo creación) */}
          {!editing && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Usuario PPPoE
                </label>
                <input
                  {...register('usuarioPppoe')}
                  placeholder="Auto-generar si vacío"
                  className={INPUT}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Contraseña PPPoE
                </label>
                <input
                  type="password"
                  {...register('passwordPppoe')}
                  placeholder="Auto-generar si vacío"
                  className={INPUT}
                />
              </div>
            </div>
          )}

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Fecha Instalación *
              </label>
              <input
                type="date"
                {...register('fechaInicio')}
                readOnly={!!editing}
                className={cn(INPUT, editing && 'opacity-60 cursor-not-allowed')}
              />
              {errors.fechaInicio && (
                <p className="text-[10px] text-destructive mt-1">{errors.fechaInicio.message}</p>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Día Facturación
              </label>
              <input
                type="number"
                min={1}
                max={31}
                {...register('diaFacturacion')}
                placeholder="1 – 31"
                className={INPUT}
              />
            </div>
          </div>

          {/* Descuento */}
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Descuento (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              {...register('descuentoPct')}
              placeholder="0"
              className={INPUT}
            />
          </div>

          {/* Notas */}
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Notas Internas
            </label>
            <textarea
              {...register('notasInternas')}
              rows={3}
              placeholder="Observaciones del contrato…"
              className={cn(INPUT, 'resize-none')}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Save className="w-3.5 h-3.5" />
            }
            {editing ? 'Guardar Cambios' : 'Crear Servicio'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── FacturaBadge ──────────────────────────────────────────────
const FBADGE: Record<string, string> = {
  borrador:       'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  emitida:        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pagada:         'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  pagada_parcial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  vencida:        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  anulada:        'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
  en_cobranza:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};
const FLABEL: Record<string, string> = {
  borrador: 'BORRADOR', emitida: 'EMITIDA', pagada: 'PAGADO',
  pagada_parcial: 'PARCIAL', vencida: 'VENCIDA', anulada: 'ANULADA', en_cobranza: 'COBRANZA',
};
function FacturaBadge({ estado }: { estado: string }) {
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', FBADGE[estado] ?? 'bg-gray-100 text-gray-600')}>
      {FLABEL[estado] ?? estado.toUpperCase()}
    </span>
  );
}

// ── TabFacturacion ────────────────────────────────────────────
type FSubTab = 'facturas' | 'transacciones' | 'saldos' | 'config';
const F_SUBTABS: { key: FSubTab; label: string }[] = [
  { key: 'facturas',       label: 'Facturas'       },
  { key: 'transacciones',  label: 'Transacciones'  },
  { key: 'saldos',         label: 'Saldos'         },
  { key: 'config',         label: 'Configuración'  },
];

function TabFacturacion({ clienteId, contratos }: { clienteId: string; contratos: Contrato[] }) {
  const { toast }   = useToast();
  const queryClient = useQueryClient();
  const [subTab, setSubTab]         = useState<FSubTab>('facturas');
  const [search, setSearch]         = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [editando, setEditando]     = useState<Factura | null>(null);

  const { data: facturas = [], isLoading: loadingF } = useQuery({
    queryKey: ['cliente-facturas', clienteId],
    queryFn:  () => facturacionApi.getByCliente(clienteId),
  });

  const { data: pagos = [], isLoading: loadingP } = useQuery({
    queryKey: ['cliente-pagos', clienteId],
    queryFn:  () => pagosApi.getPorCliente(clienteId),
    enabled:  subTab === 'transacciones',
  });

  const { mutate: anularFactura } = useMutation({
    mutationFn: (facturaId: string) =>
      facturacionApi.anular(facturaId, 'Anulado desde detalle de cliente'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente-facturas', clienteId] });
      toast('Factura anulada', { type: 'success' });
    },
    onError: () => toast('No se pudo anular la factura', { type: 'error' }),
  });

  const { mutate: eliminarFactura } = useMutation({
    mutationFn: (facturaId: string) => facturacionApi.eliminar(facturaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente-facturas', clienteId] });
      toast('Factura eliminada', { type: 'success' });
    },
    onError: () => toast('No se pudo eliminar la factura', { type: 'error' }),
  });

  const q         = search.toLowerCase();
  const filtradas = (facturas as Factura[]).filter(
    (f) => !q || f.numeroCompleto.toLowerCase().includes(q) || f.estado.toLowerCase().includes(q),
  );

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex border-b border-border bg-muted/10">
        {F_SUBTABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={cn(
              'px-4 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap',
              subTab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Facturas ─────────────────────────────────────────── */}
      {subTab === 'facturas' && (
        <div className="p-4 space-y-3">
          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-muted-foreground bg-muted px-2.5 py-1 rounded-lg min-w-[2rem] text-center">
              {filtradas.length}
            </span>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-accent transition-colors text-muted-foreground">
              <Plus className="w-3.5 h-3.5" /> Factura Libre
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-accent transition-colors text-muted-foreground"
            >
              <Plus className="w-3.5 h-3.5" /> Factura de servicios
            </button>
            <div className="ml-auto relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="pl-8 pr-3 py-1.5 text-xs bg-background border border-input rounded-lg w-44
                           focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
              />
            </div>
          </div>

          {/* Table / States */}
          {loadingF ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-muted" />)}
            </div>
          ) : filtradas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CreditCard className="w-10 h-10 text-muted-foreground mb-3" />
              <p className="text-sm font-semibold text-foreground">Sin facturas registradas</p>
              <p className="text-xs text-muted-foreground mt-1">
                Las facturas de este cliente aparecerán aquí
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {['N° FACTURA', 'EMITIDO', 'VENCIMIENTO', 'ESTADO', 'TOTAL', 'IGV', 'TIPO', 'PAGADO', 'FECHA PAGO', ''].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtradas.map((f) => (
                      <tr key={f.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2.5 font-mono font-semibold text-foreground whitespace-nowrap">
                          {f.numeroCompleto}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {formatDate(f.fechaEmision)}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {formatDate(f.fechaVencimiento)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <FacturaBadge estado={f.estado} />
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-foreground whitespace-nowrap">
                          {formatPEN(f.total)}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {formatPEN(f.igv)}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground uppercase whitespace-nowrap">
                          {f.tipoComprobante}
                        </td>
                        <td className={cn(
                          'px-3 py-2.5 font-semibold whitespace-nowrap',
                          f.montoPagado > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground',
                        )}>
                          {formatPEN(f.montoPagado)}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {f.fechaPago ? formatDate(f.fechaPago) : '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-0.5">
                            {f.pdfUrl && (
                              <a
                                href={f.pdfUrl}
                                target="_blank"
                                rel="noreferrer"
                                title="Ver PDF"
                                className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </a>
                            )}
                            {f.estado !== 'anulada' && (
                              <button
                                onClick={() => setEditando(f)}
                                title="Editar"
                                className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {f.estado !== 'anulada' && f.estado !== 'pagada' && (
                              <button
                                onClick={() => {
                                  if (window.confirm('¿Anular esta factura?')) anularFactura(f.id);
                                }}
                                title="Anular"
                                className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {f.estado !== 'pagada' && (
                              <button
                                onClick={() => {
                                  if (window.confirm('¿Eliminar esta factura? Esta acción no se puede deshacer.')) eliminarFactura(f.id);
                                }}
                                title="Eliminar"
                                className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
                Mostrando {filtradas.length} de {(facturas as Factura[]).length} registros
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Transacciones ─────────────────────────────────────── */}
      {subTab === 'transacciones' && (
        <div className="p-4">
          {loadingP ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-muted" />)}
            </div>
          ) : (pagos as Pago[]).length === 0 ? (
            <PlaceholderTab icon={Receipt} title="Sin transacciones" desc="Los pagos de este cliente aparecerán aquí." />
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {['FECHA', 'MONTO', 'MÉTODO', 'N° OPERACIÓN', 'ESTADO', 'NOTAS'].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(pagos as Pago[]).map((p) => (
                      <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {formatDate((p as any).fechaPago ?? (p as any).createdAt ?? '')}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-foreground">
                          {formatPEN(p.monto)}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground capitalize">
                          {(p as any).metodoPago?.replace(/_/g, ' ') ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground">
                          {(p as any).numeroOperacion ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={cn(
                            'px-2 py-0.5 rounded-full text-[10px] font-bold',
                            (p as any).estado === 'verificado'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : (p as any).estado === 'rechazado'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                          )}>
                            {(p as any).estado?.replace(/_/g, ' ')?.toUpperCase() ?? '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate">
                          {(p as any).notas ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Saldos / Config ───────────────────────────────────── */}
      {subTab === 'saldos' && (
        <div className="p-6">
          <PlaceholderTab icon={Receipt} title="Saldos" desc="Balance de cuenta y créditos disponibles del cliente." badge="Próximamente" />
        </div>
      )}
      {subTab === 'config' && (
        <TabConfigFacturacion clienteId={clienteId} />
      )}

      {/* ── Modal nueva factura ───────────────────────────────── */}
      {showModal && (
        <ModalFacturaServicio
          clienteId={clienteId}
          contratos={contratos}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            queryClient.invalidateQueries({ queryKey: ['cliente-facturas', clienteId] });
            queryClient.invalidateQueries({ queryKey: ['facturas-cliente-pago', clienteId] });
            toast('Factura creada correctamente', { type: 'success' });
          }}
        />
      )}

      {/* ── Modal editar factura ──────────────────────────────── */}
      {editando && (
        <ModalEditarFactura
          factura={editando}
          contratos={contratos}
          onClose={() => setEditando(null)}
          onSuccess={() => {
            setEditando(null);
            queryClient.invalidateQueries({ queryKey: ['cliente-facturas', clienteId] });
            toast('Factura actualizada', { type: 'success' });
          }}
        />
      )}
    </div>
  );
}

// ── ModalEditarFactura ────────────────────────────────────────
function ModalEditarFactura({
  factura, contratos, onClose, onSuccess,
}: {
  factura:   Factura;
  contratos: Contrato[];
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();

  type LineaEdit = { descripcion: string; cantidad: number; precioUnitario: number; descuento: number };

  const initItems = (): LineaEdit[] => {
    if (factura.items && factura.items.length > 0) {
      return factura.items.map(it => ({
        descripcion:    it.descripcion,
        cantidad:       it.cantidad,
        precioUnitario: it.precioUnitario,
        descuento:      0,
      }));
    }
    return [{ descripcion: factura.descripcion ?? '', cantidad: 1, precioUnitario: Number(factura.subtotal ?? 0), descuento: 0 }];
  };

  const [tipoComprobante, setTipoComprobante] = useState<'boleta' | 'factura' | 'recibo_interno'>(
    (factura.tipoComprobante as any) ?? 'boleta',
  );
  const [contratoId,      setContratoId]      = useState(factura.contratoId ?? '');
  const [periodoInicio,   setPeriodoInicio]   = useState(factura.periodoInicio ?? '');
  const [periodoFin,      setPeriodoFin]      = useState(factura.periodoFin ?? '');
  const [descripcion,     setDescripcion]     = useState(factura.descripcion ?? '');
  const [fechaVenc,       setFechaVenc]       = useState(factura.fechaVencimiento ?? '');
  const [aplicaIgv,       setAplicaIgv]       = useState(Number(factura.igv ?? 0) > 0);
  const [items,           setItems]           = useState<LineaEdit[]>(initItems);

  function addItem()  { setItems(p => [...p, { descripcion: '', cantidad: 1, precioUnitario: 0, descuento: 0 }]); }
  function removeItem(idx: number) { setItems(p => p.filter((_, i) => i !== idx)); }
  function updateItem(idx: number, field: keyof LineaEdit, value: string | number) {
    setItems(p => p.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  }

  const subtotalCalc = items.reduce((acc, it) => {
    const base = it.cantidad * it.precioUnitario;
    return acc + base - (base * (it.descuento / 100));
  }, 0);
  const igvCalc   = aplicaIgv ? subtotalCalc * 0.18 : 0;
  const totalCalc = subtotalCalc + igvCalc;

  const { mutate, isPending } = useMutation({
    mutationFn: () => facturacionApi.update(factura.id, {
      contratoId:       contratoId || undefined,
      tipoComprobante,
      periodoInicio,
      periodoFin,
      descripcion:      descripcion || undefined,
      fechaVencimiento: fechaVenc   || undefined,
      aplicaIgv,
      items: items.map(it => ({
        descripcion:    it.descripcion,
        cantidad:       it.cantidad,
        precioUnitario: it.precioUnitario,
        descuento:      it.descuento || undefined,
      })),
    }),
    onSuccess,
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Error al actualizar', { type: 'error' }),
  });

  const fmtS    = (n: any) => Number(n ?? 0).toFixed(2);
  const inputCls = `w-full px-3 py-2 text-sm border border-input rounded-lg bg-background
                    text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-colors`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold">Editar Factura</h2>
              <p className="text-xs text-muted-foreground font-mono">{factura.numeroCompleto}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Row 1: tipo + contrato */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Tipo comprobante</label>
              <select value={tipoComprobante} onChange={e => setTipoComprobante(e.target.value as typeof tipoComprobante)} className={inputCls}>
                {TIPO_COMPROBANTE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Contrato</label>
              <select value={contratoId} onChange={e => setContratoId(e.target.value)} className={inputCls}>
                <option value="">— Sin contrato —</option>
                {contratos.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.numeroContrato} {c.planNombre ? `· ${c.planNombre}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: período + vencimiento */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Período inicio</label>
              <input type="date" value={periodoInicio} onChange={e => setPeriodoInicio(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Período fin</label>
              <input type="date" value={periodoFin} onChange={e => setPeriodoFin(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Vencimiento</label>
              <input type="date" value={fechaVenc} onChange={e => setFechaVenc(e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Descripción (opcional)</label>
            <input
              type="text"
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Descripción general de la factura"
              className={inputCls}
            />
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conceptos</label>
              <button onClick={addItem} className="flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus className="w-3.5 h-3.5" /> Agregar línea
              </button>
            </div>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-[11px] font-semibold text-muted-foreground uppercase">
                    <th className="px-3 py-2 text-left w-[40%]">Descripción</th>
                    <th className="px-3 py-2 text-center w-[10%]">Cant.</th>
                    <th className="px-3 py-2 text-right w-[15%]">P. Unit.</th>
                    <th className="px-3 py-2 text-right w-[12%]">Desc. %</th>
                    <th className="px-3 py-2 text-right w-[15%]">Subtotal</th>
                    <th className="px-3 py-2 w-[8%]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((it, idx) => {
                    const base = it.cantidad * it.precioUnitario;
                    const sub  = base - (base * (it.descuento / 100));
                    return (
                      <tr key={idx} className="bg-background hover:bg-muted/20 transition-colors">
                        <td className="px-2 py-1.5">
                          <input type="text" value={it.descripcion}
                            onChange={e => updateItem(idx, 'descripcion', e.target.value)}
                            placeholder="Servicio / Concepto"
                            className="w-full px-2 py-1 text-xs bg-transparent border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" value={it.cantidad} min={0.001} step={0.001}
                            onChange={e => updateItem(idx, 'cantidad', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 text-xs text-center bg-transparent border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" value={it.precioUnitario} min={0} step={0.01}
                            onChange={e => updateItem(idx, 'precioUnitario', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 text-xs text-right bg-transparent border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" value={it.descuento} min={0} max={100} step={0.1}
                            onChange={e => updateItem(idx, 'descuento', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 text-xs text-right bg-transparent border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
                        </td>
                        <td className="px-3 py-1.5 text-right text-xs font-semibold text-foreground">
                          {fmtS(sub)}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {items.length > 1 && (
                            <button onClick={() => removeItem(idx)} className="text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totales + IGV */}
          <div className="flex items-end justify-between gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                onClick={() => setAplicaIgv(v => !v)}
                className={cn('relative w-9 h-5 rounded-full transition-colors', aplicaIgv ? 'bg-primary' : 'bg-muted')}
              >
                <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', aplicaIgv ? 'translate-x-4' : 'translate-x-0.5')} />
              </div>
              <span className="text-sm text-muted-foreground">Aplica IGV 18%</span>
            </label>
            <div className="text-right space-y-1 min-w-[200px]">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal</span><span>S/. {fmtS(subtotalCalc)}</span>
              </div>
              {aplicaIgv && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>IGV (18%)</span><span>S/. {fmtS(igvCalc)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-foreground border-t border-border pt-1">
                <span>Total</span><span className="text-primary">S/. {fmtS(totalCalc)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/20">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            disabled={isPending || items.some(it => !it.descripcion || it.precioUnitario <= 0)}
            onClick={() => mutate()}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg text-white
                       bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ModalFacturaServicio ──────────────────────────────────────
interface LineaItem {
  descripcion:    string;
  cantidad:       number;
  precioUnitario: number;
  descuento:      number;
}

const TIPO_COMPROBANTE_OPTS = [
  { value: 'boleta',         label: 'Boleta de venta' },
  { value: 'factura',        label: 'Factura' },
  { value: 'recibo_interno', label: 'Recibo interno' },
] as const;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function endOfMonthStr() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

function ModalFacturaServicio({
  clienteId, contratos, onClose, onSuccess,
}: {
  clienteId: string;
  contratos:  Contrato[];
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();

  const [tipoComprobante, setTipoComprobante] = useState<'boleta' | 'factura' | 'recibo_interno'>('boleta');
  const [contratoId,      setContratoId]      = useState(contratos[0]?.id ?? '');
  const [periodoInicio,   setPeriodoInicio]   = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [periodoFin,      setPeriodoFin]      = useState(endOfMonthStr);
  const [fechaVenc,       setFechaVenc]       = useState('');
  const [aplicaIgv,       setAplicaIgv]       = useState(true);
  const [descripcion,     setDescripcion]     = useState('');
  const [items,           setItems]           = useState<LineaItem[]>([
    { descripcion: 'Servicio de Internet', cantidad: 1, precioUnitario: 0, descuento: 0 },
  ]);

  // Totales
  const subtotalCalc = items.reduce((s, it) => {
    const base = it.cantidad * it.precioUnitario;
    return s + base - (base * (it.descuento / 100));
  }, 0);
  const igvCalc   = aplicaIgv ? subtotalCalc * 0.18 : 0;
  const totalCalc = subtotalCalc + igvCalc;

  function addItem() {
    setItems(prev => [...prev, { descripcion: '', cantidad: 1, precioUnitario: 0, descuento: 0 }]);
  }
  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }
  function updateItem(idx: number, field: keyof LineaItem, value: string | number) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  }

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const dto: CreateFacturaDto = {
        clienteId,
        contratoId:      contratoId || undefined,
        tipoComprobante,
        periodoInicio,
        periodoFin,
        descripcion:     descripcion || undefined,
        aplicaIgv,
        fechaVencimiento: fechaVenc || undefined,
        items: items.map(it => ({
          descripcion:    it.descripcion,
          cantidad:       it.cantidad,
          precioUnitario: it.precioUnitario,
          descuento:      it.descuento || undefined,
        })),
      };
      return facturacionApi.create(dto);
    },
    onSuccess,
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Error al crear factura', { type: 'error' }),
  });

  const fmtS = (n: number) => n.toFixed(2);
  const inputCls = `w-full px-3 py-2 text-sm border border-input rounded-lg bg-background
                    text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-colors`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-3xl bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">Nueva Factura de Servicios</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Row 1: tipo + contrato */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Tipo comprobante</label>
              <select value={tipoComprobante} onChange={e => setTipoComprobante(e.target.value as typeof tipoComprobante)} className={inputCls}>
                {TIPO_COMPROBANTE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Contrato</label>
              <select value={contratoId} onChange={e => setContratoId(e.target.value)} className={inputCls}>
                <option value="">— Sin contrato —</option>
                {contratos.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.numeroContrato} {c.planNombre ? `· ${c.planNombre}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: período + vencimiento */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Período inicio</label>
              <input type="date" value={periodoInicio} onChange={e => setPeriodoInicio(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Período fin</label>
              <input type="date" value={periodoFin} onChange={e => setPeriodoFin(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Vencimiento</label>
              <input type="date" value={fechaVenc} onChange={e => setFechaVenc(e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Descripción (opcional)</label>
            <input
              type="text"
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Descripción general de la factura"
              className={inputCls}
            />
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conceptos</label>
              <button onClick={addItem} className="flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus className="w-3.5 h-3.5" /> Agregar línea
              </button>
            </div>

            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-[11px] font-semibold text-muted-foreground uppercase">
                    <th className="px-3 py-2 text-left w-[40%]">Descripción</th>
                    <th className="px-3 py-2 text-center w-[10%]">Cant.</th>
                    <th className="px-3 py-2 text-right w-[15%]">P. Unit.</th>
                    <th className="px-3 py-2 text-right w-[12%]">Desc. %</th>
                    <th className="px-3 py-2 text-right w-[15%]">Subtotal</th>
                    <th className="px-3 py-2 w-[8%]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((it, idx) => {
                    const base = it.cantidad * it.precioUnitario;
                    const sub  = base - (base * (it.descuento / 100));
                    return (
                      <tr key={idx} className="bg-background hover:bg-muted/20 transition-colors">
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            value={it.descripcion}
                            onChange={e => updateItem(idx, 'descripcion', e.target.value)}
                            placeholder="Servicio / Concepto"
                            className="w-full px-2 py-1 text-xs bg-transparent border border-border rounded
                                       focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            value={it.cantidad}
                            min={0.001}
                            step={0.001}
                            onChange={e => updateItem(idx, 'cantidad', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 text-xs text-center bg-transparent border border-border rounded
                                       focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            value={it.precioUnitario}
                            min={0}
                            step={0.01}
                            onChange={e => updateItem(idx, 'precioUnitario', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 text-xs text-right bg-transparent border border-border rounded
                                       focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            value={it.descuento}
                            min={0}
                            max={100}
                            step={0.1}
                            onChange={e => updateItem(idx, 'descuento', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 text-xs text-right bg-transparent border border-border rounded
                                       focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right text-xs font-semibold text-foreground">
                          {fmtS(sub)}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {items.length > 1 && (
                            <button onClick={() => removeItem(idx)} className="text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totales + IGV */}
          <div className="flex items-end justify-between gap-6">
            {/* IGV toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                onClick={() => setAplicaIgv(v => !v)}
                className={cn(
                  'relative w-9 h-5 rounded-full transition-colors',
                  aplicaIgv ? 'bg-primary' : 'bg-muted',
                )}
              >
                <div className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                  aplicaIgv ? 'translate-x-4' : 'translate-x-0.5',
                )} />
              </div>
              <span className="text-sm text-muted-foreground">Aplica IGV 18%</span>
            </label>

            {/* Totals */}
            <div className="text-right space-y-1 min-w-[200px]">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>S/. {fmtS(subtotalCalc)}</span>
              </div>
              {aplicaIgv && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>IGV (18%)</span>
                  <span>S/. {fmtS(igvCalc)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-foreground border-t border-border pt-1">
                <span>Total</span>
                <span className="text-primary">S/. {fmtS(totalCalc)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/20">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg
                       hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            disabled={isPending || items.some(it => !it.descripcion || it.precioUnitario <= 0)}
            onClick={() => mutate()}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg text-white
                       bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <FileText className="w-4 h-4" />}
            Crear Factura
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TabEstadisticas ───────────────────────────────────────────
interface Sesion {
  num:          number;
  conectado:    string;
  desconectado: string;
  tiempo:       string;
  descarga:     string;
  subida:       string;
  ipv4:         string;
  mac:          string;
  ipRouter:     string;
}

function fmtBytes(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GiB`;
  return `${mb.toFixed(1)} MiB`;
}

function TabEstadisticas({
  clienteId, contratos,
}: { clienteId: string; contratos: Contrato[] }) {
  const [servicio,   setServicio]   = useState('todos');
  const [frecuencia, setFrecuencia] = useState('diario');

  const hoy   = new Date();
  const d15   = new Date(); d15.setDate(hoy.getDate() - 15);
  const [desde, setDesde] = useState(d15.toISOString().split('T')[0]);
  const [hasta, setHasta] = useState(hoy.toISOString().split('T')[0]);

  // Sin endpoint RADIUS aún — datos vacíos
  const sesiones: Sesion[] = [];
  const chartData: { fecha: string; descarga: number; subida: number }[] = [];
  const resumen = { sesiones: 0, tiempo: '00:00:00', descarga: '0 MiB', subida: '0 MiB' };

  const [buscar, setBuscar] = useState('');
  const filtradas = sesiones.filter(
    (s) => !buscar || s.ipv4.includes(buscar) || s.mac.toLowerCase().includes(buscar.toLowerCase()),
  );

  return (
    <div className="p-4 space-y-4">

      {/* ── Filtros ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Servicio</span>
          <div className="relative">
            <select
              value={servicio}
              onChange={(e) => setServicio(e.target.value)}
              className="appearance-none text-xs bg-background border border-input rounded-lg
                         pl-3 pr-8 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="todos">Todos los servicios</option>
              {contratos.map((c) => (
                <option key={c.id} value={c.id}>
                  {(c as any).numeroContrato ?? (c as any).planNombre ?? c.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <div className="relative">
          <select
            value={frecuencia}
            onChange={(e) => setFrecuencia(e.target.value)}
            className="appearance-none text-xs bg-background border border-input rounded-lg
                       pl-3 pr-8 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="diario">Gráfico diario</option>
            <option value="semanal">Gráfico semanal</option>
            <option value="mensual">Gráfico mensual</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <input
            type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
            className="text-xs bg-background border border-input rounded-lg px-3 py-1.5
                       focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground">al</span>
          <input
            type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
            className="text-xs bg-background border border-input rounded-lg px-3 py-1.5
                       focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* ── Resumen + Gráfico ────────────────────────────────── */}
      <div className="grid lg:grid-cols-[240px_1fr] gap-4">

        {/* Resumen */}
        <div className="border border-border rounded-xl p-4 flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <BarChart2 className="w-3.5 h-3.5 text-primary" /> Resumen
          </h3>
          <div className="flex-1 space-y-0">
            {[
              { label: 'Sesiones',  value: resumen.sesiones  },
              { label: 'Tiempo',    value: resumen.tiempo    },
              { label: 'Descarga',  value: resumen.descarga  },
              { label: 'Subida',    value: resumen.subida    },
            ].map(({ label, value }) => (
              <div key={label}
                className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-xs font-semibold text-foreground">{String(value)}</span>
              </div>
            ))}
          </div>
          <button className="w-full py-2 text-xs rounded-lg font-medium
                             bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
            + Sitios visitados Hoy
          </button>
        </div>

        {/* Gráfico */}
        <div className="border border-border rounded-xl p-4">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-3">
            <BarChart2 className="w-3.5 h-3.5 text-primary" /> Gráfico
          </h3>
          {chartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-center gap-2">
              <BarChart2 className="w-10 h-10 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium">Sin datos de tráfico</p>
              <p className="text-[11px] text-muted-foreground/60">Requiere integración con RADIUS/AAA</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barSize={10} barGap={1} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="fecha" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => v >= 1 ? `${v}GB` : `${(v * 1024).toFixed(0)}MB`}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  formatter={(v: number, name: string) => [
                    fmtBytes(v * 1024),
                    name === 'descarga' ? 'DOWN' : 'UP',
                  ]}
                />
                <Bar dataKey="descarga" fill="#3b82f6" radius={[2, 2, 0, 0]} name="DOWN" />
                <Bar dataKey="subida"   fill="#10b981" radius={[2, 2, 0, 0]} name="UP"   />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Tabla de sesiones ────────────────────────────────── */}
      <div className="border border-border rounded-xl overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/10">
          <span className="text-xs font-bold text-muted-foreground bg-muted px-2.5 py-1 rounded-lg min-w-[2rem] text-center">
            {filtradas.length}
          </span>
          <div className="ml-auto relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Buscar..."
              className="pl-8 pr-3 py-1.5 text-xs bg-background border border-input rounded-lg w-44
                         focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['#', 'CONECTADO', 'DESCONECTADO', 'TIEMPO', 'DESCARGA', 'SUBIDA', 'IPV4', 'MAC', 'IP ROUTER'].map((h) => (
                  <th key={h}
                    className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-14 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Monitor className="w-8 h-8 text-muted-foreground" />
                      <p className="text-xs font-semibold text-muted-foreground">
                        Sin sesiones registradas
                      </p>
                      <p className="text-[11px] text-muted-foreground/60">
                        Requiere integración con RADIUS/AAA
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtradas.map((s) => (
                  <tr key={s.num} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground">{s.num}</td>
                    <td className="px-3 py-2 font-mono text-foreground whitespace-nowrap">{s.conectado}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{s.desconectado || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.tiempo}</td>
                    <td className="px-3 py-2 text-blue-600 dark:text-blue-400 font-semibold">{s.descarga}</td>
                    <td className="px-3 py-2 text-emerald-600 dark:text-emerald-400 font-semibold">{s.subida}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{s.ipv4}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground text-[10px]">{s.mac}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{s.ipRouter}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
          Mostrando {filtradas.length} de {sesiones.length} registros
        </div>
      </div>
    </div>
  );
}
