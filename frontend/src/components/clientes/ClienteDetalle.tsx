'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter }                   from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Search, Calendar, Monitor, MessageSquare,
  CreditCard, Wifi, Loader2, Radio, Cable, Shuffle,
  XCircle, ScrollText, FolderOpen, Wrench, Save,
  Receipt, BarChart2, Ticket,
} from 'lucide-react';

import { clientesApi }        from '@/lib/api/clientes';
import { ClienteEstadoBadge } from './ClienteEstadoBadge';
import { useToast }           from '@/components/ui/toaster';
import { formatDate, formatPEN, cn } from '@/lib/utils';
import type { Contrato } from '@/types';

// ── Tabs ──────────────────────────────────────────────────────
const TABS = [
  { key: 'resumen',      label: 'Resumen',      icon: Monitor      },
  { key: 'servicios',    label: 'Servicios',    icon: Wifi         },
  { key: 'facturacion',  label: 'Facturación',  icon: CreditCard   },
  { key: 'tickets',      label: 'Tickets',      icon: Ticket       },
  { key: 'email_sms',    label: 'Email & SMS',  icon: MessageSquare},
  { key: 'documentos',   label: 'Documentos',   icon: FolderOpen   },
  { key: 'estadisticas', label: 'Estadísticas', icon: BarChart2    },
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
  const [tab, setTab]         = useState<TabKey>('resumen');
  const [form, setForm]       = useState<Record<string, string>>({});
  const [formDirty, setDirty] = useState(false);
  const initialized           = useRef(false);

  const { data: cliente, isLoading } = useQuery({
    queryKey: ['cliente', id],
    queryFn:  () => clientesApi.getById(id),
  });

  const { data: contratos = [] } = useQuery({
    queryKey: ['cliente-contratos', id],
    queryFn:  () => clientesApi.getContratos(id),
    enabled:  tab === 'servicios' || tab === 'resumen',
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
                <span className="text-primary font-bold">&raquo;</span> Datos del cliente
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

              <FormRow label="Nº Identificación">
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <input
                      value={form.numeroDocumento ?? ''}
                      onChange={(e) => set('numeroDocumento', e.target.value)}
                      className={cn(INPUT, 'flex-1')}
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

              <FormRow label="Cliente">
                <input
                  value={cliente.nombreCompleto}
                  readOnly
                  className={cn(INPUT, 'bg-muted/50 cursor-default')}
                />
              </FormRow>

              <FormRow label="Dirección Principal">
                <input
                  value={form.direccion ?? ''}
                  onChange={(e) => set('direccion', e.target.value)}
                  className={INPUT}
                />
              </FormRow>

              <FormRow label="Teléfono fijo">
                <input
                  value={form.telefonoAlt ?? ''}
                  onChange={(e) => set('telefonoAlt', e.target.value)}
                  className={INPUT}
                />
              </FormRow>

              <FormRow label="Teléfono Movil">
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

              <FormRow label="Ubicación">
                <input
                  value={[form.departamento, form.provincia, form.distrito].filter(Boolean).join(', ')}
                  onChange={(e) => set('distrito', e.target.value)}
                  placeholder="Seleccionar..."
                  className={INPUT}
                />
              </FormRow>

              <FormRow label="Referencia">
                <input
                  value={form.referencia ?? ''}
                  onChange={(e) => set('referencia', e.target.value)}
                  className={INPUT}
                />
              </FormRow>

              <div className="pt-4">
                <button
                  onClick={() => guardar()}
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
          <div className="p-6 space-y-3">
            {(contratos as Contrato[]).length === 0 ? (
              <PlaceholderTab icon={Wifi} title="Sin contratos activos"
                desc="Este cliente no tiene contratos de servicio registrados."
                action={{ label: 'Crear contrato', href: `/contratos/nuevo?clienteId=${id}` }}
              />
            ) : (
              (contratos as Contrato[]).map((c) => (
                <button
                  key={c.id}
                  onClick={() => router.push(`/contratos/${c.id}`)}
                  className="w-full flex items-center justify-between gap-4 p-4 rounded-xl
                             border border-border hover:bg-accent/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Wifi className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{c.numeroContrato}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.planNombre} · {c.velocidadBajada}/{c.velocidadSubida} Mbps
                        {c.ipAsignada && <span className="font-mono"> · {c.ipAsignada}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-foreground">{formatPEN(c.precioFinal ?? 0)}/mes</p>
                    {c.deudaTotal > 0 && (
                      <p className="text-xs text-destructive font-semibold">Deuda: {formatPEN(c.deudaTotal)}</p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* Tabs placeholder */}
        {tab === 'facturacion'  && <div className="p-6"><PlaceholderTab icon={CreditCard}    title="Módulo de facturación"  desc="Facturas, cobros y estado de cuenta." badge="Próximamente" /></div>}
        {tab === 'tickets'      && <div className="p-6"><PlaceholderTab icon={Ticket}        title="Tickets de soporte"     desc="Tickets y reclamos del cliente."      badge="Próximamente" /></div>}
        {tab === 'email_sms'    && <div className="p-6"><PlaceholderTab icon={MessageSquare} title="Email & SMS"            desc="Notificaciones enviadas al cliente."   badge="Próximamente" /></div>}
        {tab === 'documentos'   && <div className="p-6"><PlaceholderTab icon={FolderOpen}    title="Documentos"             desc="Contratos, comprobantes y fotos."      badge="Próximamente" /></div>}
        {tab === 'estadisticas' && <div className="p-6"><PlaceholderTab icon={BarChart2}     title="Estadísticas"           desc="Consumo, pagos históricos y tendencias." badge="Próximamente" /></div>}
        {tab === 'logs'         && <div className="p-6"><PlaceholderTab icon={ScrollText}    title="Log de actividad"       desc="Registro detallado de acciones."       badge="Próximamente" /></div>}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3 py-2 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground pt-2.5 font-medium leading-none">{label}</span>
      <div>{children}</div>
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
