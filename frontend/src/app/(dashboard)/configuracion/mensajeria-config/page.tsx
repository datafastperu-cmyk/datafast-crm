'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Save, Loader2, RefreshCw,
  ChevronLeft, ChevronRight, Eye, EyeOff,
  CheckCircle2, AlertCircle, Clock,
} from 'lucide-react';

import { sistemaApi, type NotifLog } from '@/lib/api/sistema';
import { useToast }  from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

// ─── Constantes ───────────────────────────────────────────────
const SENTINEL = '***stored***';
const LIMIT    = 20;

const TIPOS = [
  'pago_vence_hoy', 'pago_vencido', 'servicio_suspendido',
  'servicio_reactivado', 'servicio_activado', 'factura_emitida',
  'pago_recibido', 'prorroga_concedida', 'bienvenida',
  'onu_offline', 'mantenimiento',
];

const INPUT = [
  'w-full px-3 py-2 text-sm rounded-lg border border-input',
  'bg-background text-foreground placeholder:text-muted-foreground',
  'focus:outline-none focus:ring-2 focus:ring-ring transition-colors',
].join(' ');

// ─── Badge de estado ──────────────────────────────────────────
function EstadoBadge({ estado, error }: { estado: NotifLog['estado_entrega']; error?: string | null }) {
  const map = {
    ENCOLADO:     { cls: 'bg-amber-500/10 text-amber-500',   icon: <Clock     className="w-3 h-3" />, label: 'Encolado'     },
    ENVIADO_META: { cls: 'bg-emerald-500/10 text-emerald-500', icon: <CheckCircle2 className="w-3 h-3" />, label: 'Enviado'   },
    FALLIDO:      { cls: 'bg-rose-500/10 text-rose-500',     icon: <AlertCircle className="w-3 h-3" />, label: 'Fallido'    },
  } as const;

  const cfg = map[estado];

  if (estado === 'FALLIDO' && error) {
    return (
      <span className="relative group inline-flex">
        <span className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-help',
          cfg.cls,
        )}>
          {cfg.icon} {cfg.label}
        </span>
        {/* Tooltip */}
        <span className={cn(
          'pointer-events-none absolute bottom-full left-0 mb-1.5 z-50',
          'w-64 rounded-lg border border-border bg-popover p-2.5 shadow-lg',
          'text-xs text-popover-foreground leading-relaxed',
          'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
        )}>
          <span className="font-semibold text-rose-400 block mb-1">Detalle del error</span>
          {error}
        </span>
      </span>
    );
  }

  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      cfg.cls,
    )}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── Sección A: Credenciales WhatsApp ────────────────────────
function WhatsAppConfigForm() {
  const qc     = useQueryClient();
  const { toast } = useToast();
  const [showToken, setShowToken] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['wa-config'],
    queryFn:  sistemaApi.getWhatsAppConfig,
    staleTime: 60_000,
  });

  const [form, setForm] = useState({ phoneId: '', businessId: '', token: '' });

  // Sync form cuando llegan datos del servidor
  useEffect(() => {
    if (data) {
      setForm({
        phoneId:    data.phoneId    ?? '',
        businessId: data.businessId ?? '',
        token:      data.token      ?? '',  // '***stored***' o ''
      });
    }
  }, [data]);

  const { mutate, isPending } = useMutation({
    mutationFn: sistemaApi.updateWhatsAppConfig,
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['wa-config'] });
      setForm(f => ({ ...f, token: updated.token ?? '' }));
      toast('Configuración de WhatsApp guardada', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const handleSave = () => {
    mutate({
      phoneId:    form.phoneId    || undefined,
      businessId: form.businessId || undefined,
      // Si el token no cambió del sentinel, no lo enviamos → backend no lo sobreescribe
      token: form.token !== SENTINEL ? form.token : SENTINEL,
    });
  };

  const tokenConfigured = data?.token === SENTINEL;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
          <MessageSquare className="w-4 h-4 text-emerald-500" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Meta Graph API — WhatsApp Business</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Credenciales para el envío de notificaciones automáticas
          </p>
        </div>
        {tokenConfigured && (
          <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Configurado
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-6 py-5 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Phone ID */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Phone ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="123456789012345"
                  value={form.phoneId}
                  onChange={e => setForm(f => ({ ...f, phoneId: e.target.value }))}
                  className={INPUT}
                />
                <p className="text-[10px] text-muted-foreground">
                  ID del número de teléfono en Meta Business
                </p>
              </div>

              {/* Business Account ID */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Business Account ID <span className="text-muted-foreground">(opcional)</span>
                </label>
                <input
                  type="text"
                  placeholder="987654321098765"
                  value={form.businessId}
                  onChange={e => setForm(f => ({ ...f, businessId: e.target.value }))}
                  className={INPUT}
                />
                <p className="text-[10px] text-muted-foreground">
                  ID de la cuenta de WhatsApp Business
                </p>
              </div>
            </div>

            {/* Access Token */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Access Token (Meta Graph API)
              </label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  placeholder={tokenConfigured ? SENTINEL : 'EAABwzLixnjY...'}
                  value={form.token}
                  onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
                  className={cn(INPUT, 'pr-10 font-mono text-xs')}
                />
                <button
                  type="button"
                  onClick={() => setShowToken(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {tokenConfigured
                  ? 'Token almacenado y cifrado. Deja el campo como está para no modificarlo, o escribe uno nuevo para reemplazarlo.'
                  : 'Token de acceso permanente de la Meta Graph API v18.0. Se cifra con AES-256 antes de guardarse.'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end px-6 py-4 border-t border-border">
        <button
          onClick={handleSave}
          disabled={isPending || isLoading}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50',
          )}
        >
          {isPending
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando…</>
            : <><Save className="w-3.5 h-3.5" /> Guardar configuración</>}
        </button>
      </div>
    </div>
  );
}

// ─── Sección B: Historial de logs ─────────────────────────────
function NotifLogsTable() {
  const [page,   setPage]   = useState(1);
  const [estado, setEstado] = useState('');
  const [tipo,   setTipo]   = useState('');

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['notif-logs', page, estado, tipo],
    queryFn:  () => sistemaApi.getNotifLogs({ page, limit: LIMIT, estado: estado || undefined, tipo: tipo || undefined }),
    staleTime: 30_000,
  });

  const items      = data?.items ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const handleFilter = (field: 'estado' | 'tipo', val: string) => {
    if (field === 'estado') setEstado(val);
    else                    setTipo(val);
    setPage(1);
  };

  const formatFecha = (iso: string) =>
    new Date(iso).toLocaleString('es-PE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Historial de notificaciones</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total > 0 ? `${total} registros en total` : 'Sin registros aún'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtro estado */}
          <select
            value={estado}
            onChange={e => handleFilter('estado', e.target.value)}
            className={cn(INPUT, 'w-36 py-1.5 text-xs')}
          >
            <option value="">Todos los estados</option>
            <option value="ENCOLADO">Encolado</option>
            <option value="ENVIADO_META">Enviado</option>
            <option value="FALLIDO">Fallido</option>
          </select>

          {/* Filtro tipo */}
          <select
            value={tipo}
            onChange={e => handleFilter('tipo', e.target.value)}
            className={cn(INPUT, 'w-44 py-1.5 text-xs')}
          >
            <option value="">Todos los tipos</option>
            {TIPOS.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50"
            title="Actualizar"
          >
            <RefreshCw className={cn('w-3.5 h-3.5 text-muted-foreground', isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <MessageSquare className="w-10 h-10 text-muted-foreground opacity-20 mb-3" />
          <p className="text-sm font-medium text-foreground">Sin registros</p>
          <p className="text-xs text-muted-foreground mt-1">
            Los logs aparecerán aquí en cuanto se encolen notificaciones.
          </p>
        </div>
      ) : (
        <>
          {/* Header de columnas */}
          <div className="hidden md:grid grid-cols-[1fr_130px_160px_140px_110px] gap-3 px-6 py-2.5 border-b border-border text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            <span>Cliente / Contrato</span>
            <span>Teléfono</span>
            <span>Tipo de alerta</span>
            <span>Fecha</span>
            <span>Estado</span>
          </div>

          <div className="divide-y divide-border">
            {items.map((log) => (
              <div
                key={log.id}
                className="grid grid-cols-1 md:grid-cols-[1fr_130px_160px_140px_110px] gap-x-3 gap-y-1 px-6 py-3 hover:bg-muted/30 transition-colors items-center"
              >
                {/* Cliente */}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {log.cliente_nombre ?? <span className="text-muted-foreground italic">Sin cliente</span>}
                  </p>
                  {log.numero_contrato && (
                    <p className="text-xs text-muted-foreground font-mono">{log.numero_contrato}</p>
                  )}
                </div>

                {/* Teléfono */}
                <p className="text-xs font-mono text-muted-foreground">
                  {log.telefono}
                </p>

                {/* Tipo */}
                <p className="text-xs text-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded inline-block">
                  {log.tipo_template}
                </p>

                {/* Fecha */}
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatFecha(log.created_at)}
                </p>

                {/* Estado */}
                <div>
                  <EstadoBadge estado={log.estado_entrega} error={log.error_detalle} />
                </div>
              </div>
            ))}
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Página {page} de {totalPages} · {total} registros
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1 || isFetching}
                  className="p-1.5 rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || isFetching}
                  className="p-1.5 rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-40"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────
export default function MensajeriaConfigPage() {
  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          Mensajería
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configura las credenciales de Meta Graph API y consulta el historial de envíos.
        </p>
      </div>

      <WhatsAppConfigForm />
      <NotifLogsTable />
    </div>
  );
}
