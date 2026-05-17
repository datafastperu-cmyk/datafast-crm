'use client';

import { useState }  from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Edit, Phone, Mail, MapPin, Wifi,
  FileText, CreditCard, Clock, MoreVertical, Loader2,
  Monitor, Ticket, ScrollText, FolderOpen,
  CheckCircle2, XCircle, AlertTriangle, Radio,
  Building2, MessageCircle, Hash, User, Activity,
  Cable, Shuffle, TrendingUp,
} from 'lucide-react';

import { clientesApi }        from '@/lib/api/clientes';
import { ClienteForm }        from './ClienteForm';
import { ClienteEstadoBadge } from './ClienteEstadoBadge';
import { useToast }           from '@/components/ui/toaster';
import {
  formatDate, formatDateTime, formatPEN, cn,
  labelContrato, badgeContrato,
} from '@/lib/utils';
import type { Contrato, HistorialEntry } from '@/types';

// ── Tabs config ───────────────────────────────────────────────
const TABS = [
  { key: 'info',        label: 'Información',  icon: User        },
  { key: 'servicios',   label: 'Servicios',    icon: Wifi        },
  { key: 'facturacion', label: 'Facturación',  icon: CreditCard  },
  { key: 'equipos',     label: 'Equipos',      icon: Monitor     },
  { key: 'historial',   label: 'Historial',    icon: Clock       },
  { key: 'tickets',     label: 'Tickets',      icon: Ticket      },
  { key: 'logs',        label: 'Logs',         icon: ScrollText  },
  { key: 'documentos',  label: 'Documentos',   icon: FolderOpen  },
] as const;

type TabKey = typeof TABS[number]['key'];

// ── Avatar color helper ───────────────────────────────────────
const AV_COLORS = [
  'from-blue-500 to-blue-700',
  'from-violet-500 to-violet-700',
  'from-emerald-500 to-emerald-700',
  'from-orange-500 to-orange-700',
  'from-pink-500 to-pink-700',
  'from-teal-500 to-teal-700',
];

function avatarGradient(name: string) {
  const sum = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AV_COLORS[sum % AV_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ── Service type badge ────────────────────────────────────────
const SVC_CFG: Record<string, { icon: React.ElementType; bg: string; text: string; label: string }> = {
  ftth:     { icon: Radio,   label: 'FTTH',    bg: 'bg-blue-100 dark:bg-blue-950/40',    text: 'text-blue-700 dark:text-blue-400' },
  wisp:     { icon: Wifi,    label: 'WISP',    bg: 'bg-purple-100 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-400' },
  dedicado: { icon: Cable,   label: 'Dedicado', bg: 'bg-emerald-100 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400' },
  mixto:    { icon: Shuffle, label: 'Mixto',   bg: 'bg-orange-100 dark:bg-orange-950/40', text: 'text-orange-700 dark:text-orange-400' },
};

// ── Main component ────────────────────────────────────────────
export function ClienteDetalle({ id }: { id: string }) {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [tab, setTab]       = useState<TabKey>('info');
  const [editMode, setEdit] = useState(false);
  const [menuOpen, setMenu] = useState(false);

  const { data: cliente, isLoading } = useQuery({
    queryKey: ['cliente', id],
    queryFn:  () => clientesApi.getById(id),
  });

  const { data: contratos = [] } = useQuery({
    queryKey: ['cliente-contratos', id],
    queryFn:  () => clientesApi.getContratos(id),
    enabled:  tab === 'servicios',
  });

  const { data: historial = [] } = useQuery({
    queryKey: ['cliente-historial', id],
    queryFn:  () => clientesApi.getHistorial(id),
    enabled:  tab === 'historial',
  });

  const { mutate: cambiarEstado, isPending: cambiandoEstado } = useMutation({
    mutationFn: ({ estado, motivo }: { estado: string; motivo?: string }) =>
      clientesApi.cambiarEstado(id, estado, motivo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', id] });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      toast('Estado actualizado', { type: 'success' });
      setMenu(false);
    },
    onError: () => toast('No se pudo cambiar el estado', { type: 'error' }),
  });

  // ── Loading skeleton ──────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse max-w-5xl">
        <div className="skeleton h-10 w-48 rounded-lg" />
        <div className="skeleton h-48 rounded-2xl" />
        <div className="skeleton h-12 rounded-xl" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <XCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-sm font-semibold text-foreground">Cliente no encontrado</p>
        <button onClick={() => router.back()} className="mt-4 text-sm text-primary hover:underline">
          Volver al listado
        </button>
      </div>
    );
  }

  if (editMode) {
    return (
      <div className="max-w-3xl">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setEdit(false)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" /> Cancelar edición
          </button>
          <h2 className="text-lg font-semibold text-foreground">Editar cliente</h2>
        </div>
        <ClienteForm
          clienteId={id}
          initialValues={cliente as any}
          onSuccess={() => {
            setEdit(false);
            queryClient.invalidateQueries({ queryKey: ['cliente', id] });
          }}
        />
      </div>
    );
  }

  const grad   = avatarGradient(cliente.nombreCompleto);
  const svcCfg = SVC_CFG[cliente.tipoServicio ?? ''];

  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Breadcrumb nav ─────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          onClick={() => router.push('/clientes')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Clientes
        </button>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => router.push(`/contratos/nuevo?clienteId=${id}`)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-input
                       text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            <FileText className="w-3.5 h-3.5" /> Nuevo contrato
          </button>
          <button
            onClick={() => setEdit(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium
                       bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm"
          >
            <Edit className="w-3.5 h-3.5" /> Editar
          </button>

          {/* Dropdown */}
          <div className="relative">
            <button
              onClick={() => setMenu(!menuOpen)}
              className="p-2 rounded-lg border border-input text-muted-foreground hover:bg-accent transition-all"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-popover border border-border
                                rounded-xl shadow-xl overflow-hidden animate-fade-in">
                  <div className="p-1 space-y-0.5">
                    {cliente.estado !== 'suspendido' && cliente.estado !== 'baja_definitiva' && (
                      <button
                        onClick={() => cambiarEstado({ estado: 'suspendido', motivo: 'Suspensión manual' })}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm
                                   text-yellow-700 hover:bg-yellow-50 dark:hover:bg-yellow-950/20 rounded-lg transition-colors"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Suspender
                      </button>
                    )}
                    {cliente.estado === 'suspendido' && (
                      <button
                        onClick={() => cambiarEstado({ estado: 'activo' })}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm
                                   text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20 rounded-lg transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Reactivar
                      </button>
                    )}
                    {cliente.estado !== 'baja_definitiva' && (
                      <button
                        onClick={() => cambiarEstado({ estado: 'baja_definitiva', motivo: 'Baja solicitada' })}
                        disabled={cambiandoEstado}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm
                                   text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {cambiandoEstado
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <XCircle className="w-3.5 h-3.5" />
                        }
                        Dar de baja
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Hero card ──────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        {/* Gradient banner */}
        <div className={cn('h-20 bg-gradient-to-r opacity-80', grad)} />

        <div className="px-6 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-8">
            {/* Avatar + name */}
            <div className="flex items-end gap-4">
              <div className={cn(
                'w-20 h-20 rounded-2xl border-4 border-card flex items-center justify-center',
                'text-2xl font-bold text-white bg-gradient-to-br flex-shrink-0 shadow-lg',
                grad,
              )}>
                {initials(cliente.nombreCompleto)}
              </div>
              <div className="pb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-foreground">{cliente.nombreCompleto}</h1>
                  <ClienteEstadoBadge estado={cliente.estado} />
                  {svcCfg && (
                    <span className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold',
                      svcCfg.bg, svcCfg.text,
                    )}>
                      <svcCfg.icon className="w-3 h-3" />
                      {svcCfg.label}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground font-mono mt-0.5">
                  {cliente.tipoDocumento?.toUpperCase()} {cliente.numeroDocumento}
                  {cliente.codigoCliente && (
                    <span className="ml-2 font-sans font-medium text-foreground/70">
                      · Cód. {cliente.codigoCliente}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Quick info chips */}
            <div className="hidden md:flex items-center gap-3 pb-1">
              <Chip icon={Phone}    text={cliente.telefono} />
              {cliente.whatsapp && <Chip icon={MessageCircle} text="WhatsApp" className="text-green-600 dark:text-green-400" />}
              {cliente.email    && <Chip icon={Mail}   text={cliente.email} />}
              {cliente.direccion && <Chip icon={MapPin} text={cliente.distrito ?? cliente.direccion} />}
            </div>
          </div>

          {/* Mobile chips */}
          <div className="flex flex-wrap gap-2 mt-3 md:hidden">
            <Chip icon={Phone} text={cliente.telefono} />
            {cliente.email && <Chip icon={Mail} text={cliente.email} />}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border">
            <MiniStat label="Cliente desde" value={formatDate(cliente.createdAt)} icon={User} />
            <MiniStat label="Estado desde"  value={cliente.fechaEstado ? formatDate(cliente.fechaEstado) : '—'} icon={Activity} />
            <MiniStat label="Tipo servicio" value={svcCfg?.label ?? 'Sin servicio'} icon={Wifi} />
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-border overflow-x-auto scrollbar-none">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-3.5 text-xs font-medium whitespace-nowrap',
                  'border-b-2 transition-all duration-150 flex-shrink-0',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="p-6">

          {/* ── Información ─────────────────────────────── */}
          {tab === 'info' && (
            <div className="grid md:grid-cols-2 gap-6">
              <InfoGroup title="Datos personales" icon={User}>
                <InfoRow label="Nombre completo" value={cliente.nombreCompleto} />
                <InfoRow label="Tipo documento"  value={cliente.tipoDocumento?.toUpperCase()} />
                <InfoRow label="N° documento"    value={cliente.numeroDocumento} mono />
                {cliente.esEmpresa && (
                  <>
                    <InfoRow label="RUC"          value={cliente.rucEmpresa} mono />
                    <InfoRow label="Razón social" value={cliente.razonSocial} />
                  </>
                )}
              </InfoGroup>

              <InfoGroup title="Contacto" icon={Phone}>
                <InfoRow label="Teléfono"    value={cliente.telefono} />
                <InfoRow label="Alternativo" value={cliente.telefonoAlt} />
                <InfoRow label="WhatsApp"    value={cliente.whatsapp} />
                <InfoRow label="Email"       value={cliente.email} />
              </InfoGroup>

              <div className="md:col-span-2">
                <InfoGroup title="Dirección de instalación" icon={MapPin}>
                  <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
                    <InfoRow label="Dirección"    value={cliente.direccion} />
                    <InfoRow label="Referencia"   value={cliente.referencia} />
                    <InfoRow label="Departamento" value={cliente.departamento} />
                    <InfoRow label="Provincia"    value={cliente.provincia} />
                    <InfoRow label="Distrito"     value={cliente.distrito} />
                  </div>
                </InfoGroup>
              </div>

              {cliente.notasInternas && (
                <div className="md:col-span-2">
                  <InfoGroup title="Notas internas" icon={ScrollText}>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {cliente.notasInternas}
                    </p>
                  </InfoGroup>
                </div>
              )}
            </div>
          )}

          {/* ── Servicios ───────────────────────────────── */}
          {tab === 'servicios' && (
            <div className="space-y-3">
              {contratos.length === 0 ? (
                <PlaceholderTab
                  icon={Wifi}
                  title="Sin contratos activos"
                  desc="Este cliente no tiene contratos de servicio registrados."
                  action={{ label: 'Crear contrato', href: `/contratos/nuevo?clienteId=${id}` }}
                />
              ) : (
                (contratos as Contrato[]).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/contratos/${c.id}`)}
                    className="w-full flex items-center justify-between gap-4 p-4 rounded-xl
                               border border-border hover:bg-accent/50 transition-colors text-left group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Wifi className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-foreground">{c.numeroContrato}</p>
                          <span className={cn(
                            'text-[11px] font-semibold px-2 py-0.5 rounded-full',
                            badgeContrato(c.estado),
                          )}>
                            {labelContrato(c.estado)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {c.planNombre} · {c.velocidadBajada}/{c.velocidadSubida} Mbps
                          {c.ipAsignada && <span className="font-mono"> · {c.ipAsignada}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-foreground">
                        {formatPEN(c.precioFinal ?? 0)}/mes
                      </p>
                      {c.deudaTotal > 0 && (
                        <p className="text-xs text-destructive font-semibold">
                          Deuda: {formatPEN(c.deudaTotal)}
                        </p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* ── Facturación ─────────────────────────────── */}
          {tab === 'facturacion' && (
            <PlaceholderTab
              icon={CreditCard}
              title="Módulo de facturación"
              desc="Aquí se mostrarán las facturas, cobros y estado de cuenta del cliente."
              badge="Próximamente"
            />
          )}

          {/* ── Equipos ─────────────────────────────────── */}
          {tab === 'equipos' && (
            <PlaceholderTab
              icon={Monitor}
              title="Equipos del cliente"
              desc="ONU, antenas, routers CPE y otros equipos asociados aparecerán aquí."
              badge="Próximamente"
            />
          )}

          {/* ── Historial ───────────────────────────────── */}
          {tab === 'historial' && (
            <div>
              {historial.length === 0 ? (
                <PlaceholderTab
                  icon={Clock}
                  title="Sin historial registrado"
                  desc="Los cambios de estado, pagos y eventos del cliente aparecerán aquí."
                />
              ) : (
                <div className="space-y-0">
                  {(historial as HistorialEntry[]).map((h, i) => (
                    <div key={i} className="flex items-start gap-4 pb-4 last:pb-0">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Activity className="w-3.5 h-3.5 text-primary" />
                        </div>
                        {i < historial.length - 1 && (
                          <div className="w-px flex-1 bg-border mt-2" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pb-4">
                        <p className="text-sm text-foreground font-medium">
                          {h.descripcion ?? h.accion}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDateTime(h.createdAt ?? h.timestamp ?? '')} · {h.usuarioEmail ?? 'Sistema'}
                        </p>
                        {h.estadoNuevo && (
                          <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5
                                           bg-muted rounded-full text-muted-foreground">
                            → {h.estadoNuevo}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Tickets ─────────────────────────────────── */}
          {tab === 'tickets' && (
            <PlaceholderTab
              icon={Ticket}
              title="Tickets de soporte"
              desc="Los tickets de soporte técnico y reclamos del cliente aparecerán aquí."
              badge="Próximamente"
            />
          )}

          {/* ── Logs ────────────────────────────────────── */}
          {tab === 'logs' && (
            <PlaceholderTab
              icon={ScrollText}
              title="Logs de actividad"
              desc="Registro detallado de acciones del sistema para este cliente."
              badge="Próximamente"
            />
          )}

          {/* ── Documentos ──────────────────────────────── */}
          {tab === 'documentos' && (
            <PlaceholderTab
              icon={FolderOpen}
              title="Documentos del cliente"
              desc="Contratos firmados, comprobantes, fotos de instalación y más."
              badge="Próximamente"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function Chip({
  icon: Icon, text, className,
}: { icon: React.ElementType; text: string; className?: string }) {
  return (
    <span className={cn(
      'flex items-center gap-1.5 text-xs text-muted-foreground',
      'bg-muted/60 px-2.5 py-1 rounded-full',
      className,
    )}>
      <Icon className="w-3 h-3 flex-shrink-0" />
      <span className="truncate max-w-[140px]">{text}</span>
    </span>
  );
}

function MiniStat({ label, value, icon: Icon }: {
  label: string; value: string; icon: React.ElementType;
}) {
  return (
    <div className="flex flex-col items-center text-center sm:items-start sm:text-left gap-0.5">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function InfoGroup({
  title, icon: Icon, children,
}: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h4>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, mono }: {
  label: string; value?: string | null; mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground min-w-[110px] flex-shrink-0">{label}</span>
      <span className={cn(
        'text-sm text-foreground flex-1 break-words',
        mono && 'font-mono',
        !value && 'text-muted-foreground italic',
      )}>
        {value ?? '—'}
      </span>
    </div>
  );
}

function PlaceholderTab({
  icon: Icon, title, desc, badge, action,
}: {
  icon: React.ElementType; title: string; desc: string;
  badge?: string;
  action?: { label: string; href: string };
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-muted-foreground" />
      </div>
      {badge && (
        <span className="mb-2 text-[11px] font-semibold px-2.5 py-1 rounded-full
                         bg-primary/10 text-primary">
          {badge}
        </span>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">{desc}</p>
      {action && (
        <button
          onClick={() => router.push(action.href)}
          className="mt-5 px-5 py-2.5 text-sm rounded-lg font-medium
                     bg-primary text-primary-foreground hover:bg-primary/90
                     transition-all shadow-sm"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
