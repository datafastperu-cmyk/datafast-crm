'use client';

import { useState }   from 'react';
import { useRouter }  from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Edit, Phone, Mail, MapPin, Wifi,
  FileText, CreditCard, Clock, MoreVertical, Loader2,
} from 'lucide-react';

import { clientesApi } from '@/lib/api/clientes';
import { ClienteForm }     from './ClienteForm';
import { ClienteEstadoBadge } from './ClienteEstadoBadge';
import { useToast }        from '@/components/ui/toaster';
import { formatDate, formatDateTime, formatPEN, cn, labelContrato, badgeContrato } from '@/lib/utils';
import type { Contrato, HistorialEntry } from '@/types';

const TABS = ['Información', 'Contratos', 'Historial'] as const;
type Tab = typeof TABS[number];

export function ClienteDetalle({ id }: { id: string }) {
  const router       = useRouter();
  const queryClient  = useQueryClient();
  const { toast }    = useToast();
  const [tab, setTab]       = useState<Tab>('Información');
  const [editMode, setEdit] = useState(false);
  const [menuOpen, setMenu] = useState(false);

  // ── Datos del cliente ───────────────────────────────────────
  const { data: cliente, isLoading } = useQuery({
    queryKey: ['cliente', id],
    queryFn:  () => clientesApi.getById(id),
  });

  const { data: contratos = [] } = useQuery({
    queryKey: ['cliente-contratos', id],
    queryFn:  () => clientesApi.getContratos(id),
    enabled:  tab === 'Contratos',
  });

  const { data: historial = [] } = useQuery({
    queryKey: ['cliente-historial', id],
    queryFn:  () => clientesApi.getHistorial(id),
    enabled:  tab === 'Historial',
  });

  // ── Cambiar estado ──────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="skeleton h-32 rounded-xl" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Cliente no encontrado.</p>
        <button onClick={() => router.back()} className="mt-4 text-sm text-primary hover:underline">
          Volver
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
            <ArrowLeft className="w-4 h-4" />
            Cancelar edición
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

  // ─── Vista de detalle ─────────────────────────────────────
  return (
    <div className="space-y-5 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/clientes')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Clientes
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/contratos/nuevo?clienteId=${id}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                       border border-input hover:bg-muted transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Nuevo contrato
          </button>
          <button
            onClick={() => setEdit(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                       bg-primary text-primary-foreground font-medium
                       hover:bg-primary/90 transition-colors"
          >
            <Edit className="w-3.5 h-3.5" /> Editar
          </button>

          {/* Menú de acciones */}
          <div className="relative">
            <button
              onClick={() => setMenu(!menuOpen)}
              className="p-1.5 rounded-lg border border-input hover:bg-muted transition-colors"
            >
              <MoreVertical className="w-4 h-4 text-muted-foreground" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-popover border border-border
                                rounded-xl shadow-xl overflow-hidden animate-fade-in">
                  <div className="p-1">
                    {cliente.estado !== 'baja_definitiva' && (
                      <button
                        onClick={() => cambiarEstado({ estado: 'baja_definitiva', motivo: 'Baja solicitada' })}
                        disabled={cambiandoEstado}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm
                                   text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                      >
                        {cambiandoEstado
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : null}
                        Dar de baja
                      </button>
                    )}
                    {cliente.estado === 'baja_definitiva' && (
                      <button
                        onClick={() => cambiarEstado({ estado: 'activo' })}
                        className="w-full text-left px-3 py-2 text-sm text-foreground
                                   hover:bg-muted rounded-lg transition-colors"
                      >
                        Reactivar
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tarjeta de perfil */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center
                          text-2xl font-bold text-primary flex-shrink-0">
            {cliente.nombreCompleto[0]?.toUpperCase()}
          </div>

          {/* Info principal */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-foreground">{cliente.nombreCompleto}</h1>
              <ClienteEstadoBadge estado={cliente.estado} />
              {cliente.tipoServicio && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full
                                 bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                  {cliente.tipoServicio.toUpperCase()}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {cliente.tipoDocumento.toUpperCase()} {cliente.numeroDocumento}
              {cliente.codigoCliente && ` · Cód. ${cliente.codigoCliente}`}
            </p>

            {/* Datos de contacto rápidos */}
            <div className="flex flex-wrap gap-4 mt-3">
              <InfoChip icon={Phone} text={cliente.telefono} />
              {cliente.email && <InfoChip icon={Mail} text={cliente.email} />}
              {cliente.direccion && (
                <InfoChip icon={MapPin} text={cliente.direccion} truncate />
              )}
            </div>
          </div>

          {/* Fechas */}
          <div className="text-right text-xs text-muted-foreground flex-shrink-0 hidden md:block">
            <p>Cliente desde</p>
            <p className="font-medium text-foreground">{formatDate(cliente.createdAt)}</p>
            {cliente.fechaEstado && (
              <>
                <p className="mt-2">Estado desde</p>
                <p className="font-medium text-foreground">{formatDate(cliente.fechaEstado)}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex border-b border-border px-4 gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="p-5">
          {/* ── TAB: Información ──────────────────────────── */}
          {tab === 'Información' && (
            <div className="grid md:grid-cols-2 gap-6">
              <InfoSection title="Datos personales">
                <InfoRow label="Nombre completo" value={cliente.nombreCompleto} />
                <InfoRow label="Tipo documento"  value={cliente.tipoDocumento?.toUpperCase()} />
                <InfoRow label="N° documento"    value={cliente.numeroDocumento} mono />
                {cliente.esEmpresa && (
                  <>
                    <InfoRow label="RUC"          value={cliente.rucEmpresa} mono />
                    <InfoRow label="Razón social" value={cliente.razonSocial} />
                  </>
                )}
              </InfoSection>

              <InfoSection title="Contacto">
                <InfoRow label="Teléfono"    value={cliente.telefono} />
                <InfoRow label="Alternativo" value={cliente.telefonoAlt} />
                <InfoRow label="WhatsApp"    value={cliente.whatsapp} />
                <InfoRow label="Email"       value={cliente.email} />
              </InfoSection>

              <InfoSection title="Dirección" className="md:col-span-2">
                <InfoRow label="Dirección"      value={cliente.direccion} fullWidth />
                <InfoRow label="Referencia"     value={cliente.referencia} fullWidth />
                <div className="grid grid-cols-3 gap-4 mt-2">
                  <InfoRow label="Departamento" value={cliente.departamento} />
                  <InfoRow label="Provincia"    value={cliente.provincia} />
                  <InfoRow label="Distrito"     value={cliente.distrito} />
                </div>
              </InfoSection>

              {cliente.notasInternas && (
                <InfoSection title="Notas internas" className="md:col-span-2">
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {cliente.notasInternas}
                  </p>
                </InfoSection>
              )}
            </div>
          )}

          {/* ── TAB: Contratos ────────────────────────────── */}
          {tab === 'Contratos' && (
            <div className="space-y-3">
              {contratos.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="Sin contratos"
                  desc="Este cliente no tiene contratos registrados."
                  action={{ label: 'Crear contrato', href: `/contratos/nuevo?clienteId=${id}` }}
                />
              ) : (
                (contratos as Contrato[]).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/contratos/${c.id}`)}
                    className="w-full flex items-center justify-between gap-4 p-4 rounded-xl
                               border border-border hover:bg-muted/50 transition-colors text-left"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
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
                        {c.ipAsignada && ` · IP: ${c.ipAsignada}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-foreground">
                        {formatPEN(c.precioFinal ?? 0)}/mes
                      </p>
                      {c.deudaTotal > 0 && (
                        <p className="text-xs text-destructive font-medium">
                          Deuda: {formatPEN(c.deudaTotal)}
                        </p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* ── TAB: Historial ────────────────────────────── */}
          {tab === 'Historial' && (
            <div className="space-y-2">
              {historial.length === 0 ? (
                <EmptyState icon={Clock} title="Sin historial" desc="No hay eventos registrados." />
              ) : (
                (historial as HistorialEntry[]).map((h, i) => (
                  <div key={i} className="flex items-start gap-3 pb-3 border-b border-border last:border-0">
                    <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm text-foreground">{h.descripcion ?? h.accion}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDateTime(h.createdAt ?? h.timestamp)} · {h.usuarioEmail ?? 'Sistema'}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────
function InfoChip({ icon: Icon, text, truncate }: {
  icon: React.ElementType; text?: string; truncate?: boolean;
}) {
  if (!text) return null;
  return (
    <span className={cn(
      'flex items-center gap-1.5 text-xs text-muted-foreground',
      truncate && 'max-w-[200px] truncate',
    )}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className={truncate ? 'truncate' : ''}>{text}</span>
    </span>
  );
}

function InfoSection({ title, children, className }: {
  title: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}

function InfoRow({ label, value, mono, fullWidth }: {
  label: string; value?: string | null; mono?: boolean; fullWidth?: boolean;
}) {
  return (
    <div className={cn('flex gap-2', fullWidth ? 'flex-col' : 'items-baseline')}>
      <span className="text-xs text-muted-foreground flex-shrink-0 min-w-[120px]">{label}</span>
      <span className={cn(
        'text-sm text-foreground',
        mono && 'font-mono',
        !value && 'text-muted-foreground italic',
      )}>
        {value ?? '—'}
      </span>
    </div>
  );
}

function EmptyState({ icon: Icon, title, desc, action }: {
  icon: React.ElementType; title: string; desc: string;
  action?: { label: string; href: string };
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
      {action && (
        <button
          onClick={() => router.push(action.href)}
          className="mt-4 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground
                     hover:bg-primary/90 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
