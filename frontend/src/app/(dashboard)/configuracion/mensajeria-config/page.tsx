'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Save, Loader2, RefreshCw,
  ChevronLeft, ChevronRight, Eye, EyeOff,
  CheckCircle2, AlertCircle, Clock, Zap,
} from 'lucide-react';

import { sistemaApi, type NotifLog, type ProveedorActivo } from '@/lib/api/sistema';
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

// ─── Labels y metadatos por proveedor ────────────────────────
type ProviderMeta = {
  display:  string;
  color:    string;        // Tailwind color token (sin bg-/text-)
  f1Label:  string; f1Ph: string; f1Hint: string;
  f2Label:  string; f2Ph: string; f2Hint: string;
  f3Label:  string; f3Ph: string; f3Hint: string;
};

const PROVIDER_META: Record<ProveedorActivo, ProviderMeta> = {
  META_GRAPH: {
    display: 'Meta Graph API — WhatsApp Business',
    color:   'emerald',
    f1Label: 'Phone ID',             f1Ph: '123456789012345',             f1Hint: 'ID del número en Meta Business',
    f2Label: 'Business Account ID',  f2Ph: '987654321098765',             f2Hint: 'ID de la cuenta WhatsApp Business (opcional)',
    f3Label: 'Access Token',         f3Ph: 'EAABwzLixnjY...',             f3Hint: 'Token permanente — se cifra con AES-256 antes de guardarse',
  },
  TWILIO: {
    display: 'Twilio',
    color:   'red',
    f1Label: 'Account SID (API Key)',   f1Ph: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', f1Hint: 'Account SID de tu consola Twilio — cifrado AES-256',
    f2Label: 'Auth Token (API Secret)', f2Ph: SENTINEL,                            f2Hint: 'Auth Token de Twilio — cifrado AES-256',
    f3Label: 'From Number (Client ID)', f3Ph: '+14155238886',                      f3Hint: 'Número de origen habilitado en Twilio',
  },
  VONAGE: {
    display: 'Vonage (Nexmo)',
    color:   'violet',
    f1Label: 'API Key',                 f1Ph: 'a1b2c3d4',   f1Hint: 'API Key de tu cuenta Vonage — cifrado AES-256',
    f2Label: 'API Secret',              f2Ph: SENTINEL,      f2Hint: 'API Secret de Vonage — cifrado AES-256',
    f3Label: 'Sender Name (Client ID)', f3Ph: 'DataFast',    f3Hint: 'Nombre alfanumérico o número de remitente',
  },
  CUSTOM_API: {
    display: 'API Personalizada',
    color:   'amber',
    f1Label: 'X-API-Key Header',         f1Ph: 'sk_live_...',                    f1Hint: 'Llave principal enviada como X-API-Key — cifrado AES-256',
    f2Label: 'X-API-Secret Header',      f2Ph: SENTINEL,                         f2Hint: 'Secreto enviado como X-API-Secret — cifrado AES-256',
    f3Label: 'Endpoint URL (Client ID)', f3Ph: 'https://api.proveedor.com/send', f3Hint: 'URL del endpoint POST que recibe el payload de mensajería',
  },
};

interface FormValues {
  proveedor:  ProveedorActivo;
  // META_GRAPH (whatsapp-config endpoint)
  phoneId:    string;
  businessId: string;
  token:      string;
  // Non-META_GRAPH (gateway-config endpoint)
  apiKey:     string;
  apiSecret:  string;
  clientId:   string;
}

// ─── Sección A: Configuración de gateway de mensajería ───────
function GatewayConfigForm() {
  const qc         = useQueryClient();
  const { toast }  = useToast();
  const [showF1,   setShowF1]   = useState(false);
  const [showF2,   setShowF2]   = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { data: gwData, isLoading: gwLoading } = useQuery({
    queryKey: ['gw-config'],
    queryFn:  sistemaApi.getGatewayConfig,
    staleTime: 60_000,
  });

  const { data: waData, isLoading: waLoading } = useQuery({
    queryKey: ['wa-config'],
    queryFn:  sistemaApi.getWhatsAppConfig,
    staleTime: 60_000,
  });

  const isLoading = gwLoading || waLoading;

  const { register, watch, reset, handleSubmit } = useForm<FormValues>({
    defaultValues: {
      proveedor: 'META_GRAPH',
      phoneId: '', businessId: '', token: '',
      apiKey: '', apiSecret: '', clientId: '',
    },
  });

  // Sincronizar cuando lleguen datos del servidor
  useEffect(() => {
    if (gwData) {
      reset({
        proveedor:  gwData.proveedorActivo,
        apiKey:     gwData.apiKey    ?? '',
        apiSecret:  gwData.apiSecret ?? '',
        clientId:   gwData.clientId  ?? '',
        phoneId:    waData?.phoneId    ?? '',
        businessId: waData?.businessId ?? '',
        token:      waData?.token      ?? '',
      });
    }
  }, [gwData, waData, reset]);

  const proveedor = watch('proveedor');
  const meta      = PROVIDER_META[proveedor];
  const isMeta    = proveedor === 'META_GRAPH';

  const isConfigured = isMeta
    ? waData?.token    === SENTINEL
    : gwData?.apiKey   === SENTINEL;

  const onSave = handleSubmit(async (values) => {
    setIsSaving(true);
    try {
      if (values.proveedor === 'META_GRAPH') {
        await sistemaApi.updateGatewayConfig({ proveedorActivo: 'META_GRAPH' });
        await sistemaApi.updateWhatsAppConfig({
          phoneId:    values.phoneId    || undefined,
          businessId: values.businessId || undefined,
          token:      values.token !== SENTINEL ? values.token : SENTINEL,
        });
      } else {
        await sistemaApi.updateGatewayConfig({
          proveedorActivo: values.proveedor,
          apiKey:    values.apiKey    !== SENTINEL ? values.apiKey    : SENTINEL,
          apiSecret: values.apiSecret !== SENTINEL ? values.apiSecret : SENTINEL,
          clientId:  values.clientId  || undefined,
        });
      }
      qc.invalidateQueries({ queryKey: ['gw-config'] });
      qc.invalidateQueries({ queryKey: ['wa-config'] });
      toast('Configuración de mensajería guardada', { type: 'success' });
    } catch (e) {
      toast(parseApiError(e), { type: 'error' });
    } finally {
      setIsSaving(false);
    }
  });

  // Colores por proveedor
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    red:     'bg-red-500/10 text-red-400 border-red-500/20',
    violet:  'bg-violet-500/10 text-violet-400 border-violet-500/20',
    amber:   'bg-amber-500/10 text-amber-500 border-amber-500/20',
  };
  const iconColor: Record<string, string> = {
    emerald: 'text-emerald-500',
    red:     'text-red-400',
    violet:  'text-violet-400',
    amber:   'text-amber-500',
  };
  const cardColor  = colorMap[meta.color]  ?? colorMap.emerald;
  const iconCls    = iconColor[meta.color] ?? iconColor.emerald;
  const iconBgCls  = `bg-${meta.color}-500/10`;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', iconBgCls)}>
          {isMeta
            ? <MessageSquare className={cn('w-4 h-4', iconCls)} />
            : <Zap           className={cn('w-4 h-4', iconCls)} />}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{meta.display}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Credenciales para el envío de notificaciones automáticas
          </p>
        </div>
        {isConfigured && (
          <span className={cn(
            'ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full',
            'text-xs font-medium border', cardColor,
          )}>
            <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse',
              meta.color === 'emerald' ? 'bg-emerald-500'
              : meta.color === 'red'    ? 'bg-red-400'
              : meta.color === 'violet' ? 'bg-violet-400'
              : 'bg-amber-500',
            )} />
            Configurado
          </span>
        )}
      </div>

      <div className="px-6 py-5 space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={onSave} className="space-y-5">
            {/* Dropdown proveedor */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Proveedor de mensajería
              </label>
              <select
                {...register('proveedor')}
                className={cn(INPUT, 'cursor-pointer')}
              >
                <option value="META_GRAPH">Meta Graph API (WhatsApp Business)</option>
                <option value="TWILIO">Twilio</option>
                <option value="VONAGE">Vonage (Nexmo)</option>
                <option value="CUSTOM_API">API Personalizada</option>
              </select>
              <p className="text-[10px] text-muted-foreground">
                Las notificaciones automáticas usarán este proveedor para todos los envíos.
              </p>
            </div>

            {/* ─── Campos META_GRAPH ─────────────────────────── */}
            {isMeta && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Phone ID */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      {meta.f1Label} <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder={meta.f1Ph}
                      {...register('phoneId')}
                      className={INPUT}
                    />
                    <p className="text-[10px] text-muted-foreground">{meta.f1Hint}</p>
                  </div>

                  {/* Business Account ID */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      {meta.f2Label}{' '}
                      <span className="text-muted-foreground font-normal">(opcional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder={meta.f2Ph}
                      {...register('businessId')}
                      className={INPUT}
                    />
                    <p className="text-[10px] text-muted-foreground">{meta.f2Hint}</p>
                  </div>
                </div>

                {/* Access Token */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">{meta.f3Label}</label>
                  <div className="relative">
                    <input
                      type={showF1 ? 'text' : 'password'}
                      placeholder={meta.f3Ph}
                      {...register('token')}
                      className={cn(INPUT, 'pr-10 font-mono text-xs')}
                    />
                    <button type="button" onClick={() => setShowF1(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showF1 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{meta.f3Hint}</p>
                </div>
              </>
            )}

            {/* ─── Campos no-META_GRAPH ──────────────────────── */}
            {!isMeta && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* f1: apiKey */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      {meta.f1Label} <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showF1 ? 'text' : 'password'}
                        placeholder={meta.f1Ph}
                        {...register('apiKey')}
                        className={cn(INPUT, 'pr-10 font-mono text-xs')}
                      />
                      <button type="button" onClick={() => setShowF1(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showF1 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{meta.f1Hint}</p>
                  </div>

                  {/* f2: apiSecret */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      {meta.f2Label} <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showF2 ? 'text' : 'password'}
                        placeholder={meta.f2Ph}
                        {...register('apiSecret')}
                        className={cn(INPUT, 'pr-10 font-mono text-xs')}
                      />
                      <button type="button" onClick={() => setShowF2(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showF2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{meta.f2Hint}</p>
                  </div>
                </div>

                {/* f3: clientId (plaintext) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">{meta.f3Label}</label>
                  <input
                    type="text"
                    placeholder={meta.f3Ph}
                    {...register('clientId')}
                    className={INPUT}
                  />
                  <p className="text-[10px] text-muted-foreground">{meta.f3Hint}</p>
                </div>
              </>
            )}

            {/* Nota sentinel */}
            {isConfigured && (
              <p className="text-[10px] text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
                Las llaves cifradas muestran <code className="font-mono">{SENTINEL}</code>.
                Déjalas así para conservarlas, o escribe valores nuevos para reemplazarlas.
              </p>
            )}

            {/* Submit */}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isSaving}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50',
                )}
              >
                {isSaving
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando…</>
                  : <><Save    className="w-3.5 h-3.5" /> Guardar configuración</>}
              </button>
            </div>
          </form>
        )}
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
          Selecciona el proveedor activo y configura sus credenciales. Consulta el historial de envíos.
        </p>
      </div>

      <GatewayConfigForm />
      <NotifLogsTable />
    </div>
  );
}
