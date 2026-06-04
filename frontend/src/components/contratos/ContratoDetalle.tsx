'use client';

import { useState }       from 'react';
import { useRouter }      from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Zap, WifiOff, Wifi, Clock,
  MoreVertical, Loader2, FileText, CreditCard,
} from 'lucide-react';

import { contratosApi }      from '@/lib/api/contratos';
import { ContratoEstadoBadge } from './ContratosTable';
import { useToast }          from '@/components/ui/toaster';
import { formatDate, formatDateTime, formatPEN, cn, parseApiError } from '@/lib/utils';
import type { Factura, HistorialEntry } from '@/types';

const TABS = ['Información', 'Facturas', 'Historial'] as const;
type Tab = typeof TABS[number];

export function ContratoDetalle({ id }: { id: string }) {
  const router       = useRouter();
  const queryClient  = useQueryClient();
  const { toast }    = useToast();
  const [tab, setTab]           = useState<Tab>('Información');
  const [menuOpen, setMenu]     = useState(false);
  const [prorrogaDias, setPD]   = useState(7);
  const [showProrroga, setShowP] = useState(false);

  const { data: contrato, isLoading } = useQuery({
    queryKey: ['contrato', id],
    queryFn:  () => contratosApi.getById(id),
  });

  const { data: facturas = [] } = useQuery({
    queryKey: ['contrato-facturas', id],
    queryFn:  () => contratosApi.getFacturas(id),
    enabled:  tab === 'Facturas',
  });

  const { data: historial = [] } = useQuery({
    queryKey: ['contrato-historial', id],
    queryFn:  () => contratosApi.getHistorial(id),
    enabled:  tab === 'Historial',
  });

  const invalida = () => {
    queryClient.invalidateQueries({ queryKey: ['contrato', id] });
    queryClient.invalidateQueries({ queryKey: ['contratos'] });
  };

  const { mutate: cambiarEstado, isPending: cambiando } = useMutation({
    mutationFn: (dto: { estado: string; motivo?: string }) =>
      contratosApi.cambiarEstado(id, dto),
    onSuccess: () => { invalida(); toast('Estado actualizado', { type: 'success' }); setMenu(false); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: aplicarProrroga, isPending: prorrogando } = useMutation({
    mutationFn: () => contratosApi.aplicarProrroga(id, { dias: prorrogaDias }),
    onSuccess: () => {
      invalida();
      setShowP(false);
      toast(`Prórroga de ${prorrogaDias} días aplicada`, { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: rollback, isPending: revirtiendo } = useMutation({
    mutationFn: () => contratosApi.rollback(id, 'Rollback manual desde detalle'),
    onSuccess: () => { invalida(); toast('Aprovisionamiento revertido', { type: 'success' }); setMenu(false); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  if (isLoading) return <div className="space-y-4 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-28 rounded-xl"/>)}</div>;
  if (!contrato) return <p className="text-muted-foreground text-center py-20">Contrato no encontrado.</p>;

  const esActivo    = contrato.estado === 'activo';
  const esSuspendido = ['suspendido_mora','suspendido_manual'].includes(contrato.estado);
  const esPendiente = contrato.estado === 'pendiente_instalacion';

  return (
    <div className="space-y-5 max-w-5xl">

      {/* Nav */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button onClick={() => router.push('/contratos')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Contratos
        </button>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Aprovisionar FTTH */}
          {(esPendiente || !contrato.aprovisionado) && (
            <button
              onClick={() => router.push(`/contratos/${id}/aprovisionar`)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                         bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
            >
              <Zap className="w-3.5 h-3.5" /> Aprovisionar FTTH
            </button>
          )}

          {/* Renotificar */}
          {contrato.aprovisionado && (
            <button
              onClick={() => contratosApi.renotificar(id).then(() => toast('WhatsApp enviado', { type: 'success' }))}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                         border border-input hover:bg-muted transition-colors"
            >
              Renotificar WA
            </button>
          )}

          {/* Prórroga */}
          {(esActivo || esSuspendido) && (
            <button
              onClick={() => setShowP(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                         border border-input hover:bg-muted transition-colors"
            >
              <Clock className="w-3.5 h-3.5" /> Prórroga
            </button>
          )}

          {/* Menú más acciones */}
          <div className="relative">
            <button onClick={() => setMenu(!menuOpen)}
              className="p-1.5 rounded-lg border border-input hover:bg-muted transition-colors">
              <MoreVertical className="w-4 h-4 text-muted-foreground" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-popover border border-border
                                rounded-xl shadow-xl overflow-hidden animate-fade-in">
                  <div className="p-1 space-y-0.5">
                    {esSuspendido && (
                      <ActionBtn
                        icon={Wifi}
                        label="Reactivar"
                        loading={cambiando}
                        onClick={() => cambiarEstado({ estado: 'activo', motivo: 'Reactivación manual' })}
                      />
                    )}
                    {esActivo && (
                      <ActionBtn
                        icon={WifiOff}
                        label="Suspender"
                        loading={cambiando}
                        onClick={() => cambiarEstado({ estado: 'suspendido_manual', motivo: 'Suspensión manual' })}
                      />
                    )}
                    {contrato.aprovisionado && (
                      <ActionBtn
                        icon={ArrowLeft}
                        label="Rollback aprovisionam."
                        danger
                        loading={revirtiendo}
                        onClick={() => rollback()}
                      />
                    )}
                    {!['baja_definitiva'].includes(contrato.estado) && (
                      <ActionBtn
                        icon={ArrowLeft}
                        label="Dar de baja"
                        danger
                        loading={cambiando}
                        onClick={() => cambiarEstado({ estado: 'baja_definitiva', motivo: 'Baja solicitada' })}
                      />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Header card */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-xl font-bold font-mono text-foreground">
                {contrato.numeroContrato}
              </h1>
              <ContratoEstadoBadge estado={contrato.estado} />
              {contrato.aprovisionado && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full
                                 bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400">
                  APROVISIONADO ✓
                </span>
              )}
              {contrato.enProrroga && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full
                                 bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                  EN PRÓRROGA hasta {formatDate(contrato.prorrogaHasta!)}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Cliente: <span className="text-foreground font-medium">{contrato.clienteNombre}</span>
              {contrato.routerNombre && ` · Router: ${contrato.routerNombre}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-foreground">{formatPEN(contrato.precioFinal ?? 0)}</p>
            <p className="text-xs text-muted-foreground">por mes</p>
            {(contrato.deudaTotal ?? 0) > 0 && (
              <p className="text-sm font-bold text-destructive mt-1">
                Deuda: {formatPEN(contrato.deudaTotal)} ({contrato.mesesDeuda} mes)
              </p>
            )}
          </div>
        </div>

        {/* Chips de red */}
        <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-border">
          {contrato.ipAsignada && <NetChip label="IP" value={contrato.ipAsignada} mono />}
          {contrato.usuarioPppoe && <NetChip label="PPPoE" value={contrato.usuarioPppoe} mono />}
          {contrato.planNombre && <NetChip label="Plan" value={`${contrato.planNombre} · ${contrato.velocidadBajada}/${contrato.velocidadSubida} Mbps`} />}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex border-b border-border px-4 gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn(
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}>
              {t}
            </button>
          ))}
        </div>

        <div className="p-5">

          {/* ── Información ─────────────────────────────── */}
          {tab === 'Información' && (
            <div className="grid md:grid-cols-2 gap-6">
              <InfoSec title="Contrato">
                <IR label="N° contrato"   value={contrato.numeroContrato} mono />
                <IR label="Estado"        value={contrato.estado} />
                <IR label="Inicio"        value={formatDate(contrato.fechaInicio)} />
                {contrato.fechaInstalacion && <IR label="Instalación" value={formatDate(contrato.fechaInstalacion)} />}
                {contrato.fechaVencimiento && <IR label="Vencimiento" value={formatDate(contrato.fechaVencimiento)} />}
              </InfoSec>
              <InfoSec title="Facturación">
                <IR label="Precio base"   value={formatPEN(contrato.precioMensual ?? 0)} />
                <IR label="Descuento"     value={`${contrato.descuentoPct ?? 0}%`} />
                <IR label="Precio final"  value={formatPEN(contrato.precioFinal ?? 0)} />
                <IR label="Deuda total"   value={formatPEN(contrato.deudaTotal ?? 0)} />
                <IR label="Meses deuda"   value={String(contrato.mesesDeuda ?? 0)} />
              </InfoSec>
            </div>
          )}

          {/* ── Facturas ─────────────────────────────────── */}
          {tab === 'Facturas' && (
            <div className="space-y-2">
              {(facturas as Factura[]).length === 0 ? (
                <Empty icon={FileText} title="Sin facturas" desc="No hay facturas generadas para este contrato." />
              ) : (
                (facturas as Factura[]).map((f) => (
                  <div key={f.id}
                       className="flex items-center justify-between gap-4 p-3.5 rounded-xl
                                  border border-border hover:bg-muted/50 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-mono font-semibold text-foreground">{f.numeroCompleto}</p>
                        <FacturaBadge estado={f.estado} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {f.descripcion} · Vence: {formatDate(f.fechaVencimiento)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-foreground">{formatPEN(f.total)}</p>
                      {(f.saldo ?? 0) > 0 && (
                        <p className="text-xs text-destructive">Saldo: {formatPEN(f.saldo)}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Historial ────────────────────────────────── */}
          {tab === 'Historial' && (
            <div className="space-y-2">
              {(historial as HistorialEntry[]).length === 0 ? (
                <Empty icon={FileText} title="Sin historial" desc="No hay eventos registrados." />
              ) : (
                (historial as HistorialEntry[]).map((h, i) => (
                  <div key={i} className="flex items-start gap-3 pb-3 border-b border-border last:border-0">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-foreground">{h.estadoNuevo
                        ? `→ ${h.estadoNuevo}: ${h.motivo || ''}`
                        : h.descripcion}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(h.createdAt)} · {h.automatico ? 'Automático' : h.usuarioEmail}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal Prórroga */}
      {showProrroga && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-foreground mb-4">Aplicar Prórroga</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Se extenderá el plazo sin suspender el servicio.
            </p>
            <div className="space-y-2 mb-6">
              <label className="text-xs font-medium text-foreground">Días de prórroga</label>
              <input
                type="number"
                min={1} max={30}
                value={prorrogaDias}
                onChange={(e) => setPD(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background
                           focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowP(false)}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => aplicarProrroga()}
                disabled={prorrogando}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                           bg-primary text-primary-foreground font-medium hover:bg-primary/90
                           disabled:opacity-60 transition-colors"
              >
                {prorrogando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Aplicar {prorrogaDias}d
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────
function NetChip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-muted">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn('text-foreground font-medium', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function InfoSec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function IR({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-2 items-baseline">
      <span className="text-xs text-muted-foreground min-w-[120px]">{label}</span>
      <span className={cn('text-sm text-foreground', mono && 'font-mono')}>{value ?? '—'}</span>
    </div>
  );
}

const FACTURA_BADGES: Record<string, string> = {
  pagada:         'badge-activo',
  emitida:        'badge-pendiente',
  pagada_parcial: 'badge-prorroga',
  vencida:        'badge-moroso',
  anulada:        'badge-baja',
  en_cobranza:    'badge-moroso',
};

function FacturaBadge({ estado }: { estado: string }) {
  return (
    <span className={cn(
      'text-[10px] font-bold px-1.5 py-px rounded-full capitalize',
      FACTURA_BADGES[estado] ?? 'badge-pendiente',
    )}>
      {estado}
    </span>
  );
}

function ActionBtn({ icon: Icon, label, onClick, loading, danger }: {
  icon: React.ElementType; label: string; onClick: () => void; loading?: boolean; danger?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={loading}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors disabled:opacity-50',
        danger
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-muted',
      )}>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}

function Empty({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <Icon className="w-10 h-10 text-muted-foreground mb-3 opacity-30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}
