'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, AlertCircle, RefreshCw, Unplug,
  Calendar, Users, HardDrive, MapPin, Clock,
  ArrowRight, Check, Loader2, Zap, Shield, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toaster';
import {
  googleApi,
  type GoogleStatus,
  type GoogleSyncLog,
  type UpdateServicesDto,
} from '@/lib/api/google';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(b: string): string {
  const n = Number(b);
  if (!n) return '0 B';
  if (n < 1_048_576)     return `${(n / 1_024).toFixed(1)} KB`;
  if (n < 1_073_741_824) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${(n / 1_073_741_824).toFixed(1)} GB`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'Nunca';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1)  return 'Hace un momento';
  if (min < 60) return `Hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `Hace ${h}h`;
  return `Hace ${Math.floor(h / 24)}d`;
}

function humanError(msg: string | null): string {
  if (!msg) return '';
  if (msg.includes('invalid_grant') || msg.includes('token expired'))
    return 'La sesión con Google expiró. Reconecta tu cuenta para continuar.';
  if (msg.includes('insufficient_scope') || msg.includes('scope'))
    return 'Faltan permisos de Google. Desconecta y vuelve a conectar la cuenta.';
  if (msg.includes('rate_limit') || msg.includes('quota'))
    return 'Google pausó la sincronización temporalmente. Se reintentará automáticamente.';
  if (msg.includes('network') || msg.includes('ECONNREFUSED') || msg.includes('timeout'))
    return 'El servicio no respondió a tiempo. Se reintentará automáticamente.';
  if (msg.includes('not_found') || msg.includes('404'))
    return 'El recurso ya no existe en Google. Se omitió automáticamente.';
  return 'Ocurrió un problema temporal. El sistema reintentará automáticamente.';
}

function humanActivity(service: string, operation: string): string {
  const map: Record<string, string> = {
    'contacts.sync_contact':  'Contacto sincronizado con Google',
    'contacts.sync_bulk':     'Sincronización masiva de contactos completada',
    'contacts.create':        'Nuevo contacto creado en Google Contacts',
    'contacts.update':        'Contacto actualizado en Google Contacts',
    'calendar.create_event':  'Evento creado en Google Calendar',
    'calendar.update_event':  'Evento de calendario actualizado',
    'calendar.delete_event':  'Evento eliminado del calendario',
    'drive.upload':           'Archivo subido a Google Drive',
    'drive.backup':           'Copia de seguridad guardada en Drive',
    'maps.geocode':           'Dirección ubicada en el mapa',
    'maps.geocode_queue':     'Direcciones enviadas a geolocalizar',
    'oauth.connect':          'Cuenta de Google conectada',
    'oauth.refresh':          'Sesión renovada automáticamente',
    'oauth.disconnect':       'Cuenta desconectada',
  };
  return map[`${service}.${operation}`] ?? operation.replace(/_/g, ' ');
}

// ─── Service definitions ──────────────────────────────────────────────────────

const SERVICES = [
  {
    key:         'calendarEnabled' as const,
    statusKey:   'calendar' as const,
    icon:        Calendar,
    color:       'text-blue-500',
    bg:          'bg-blue-500/10',
    name:        'Google Calendar',
    desc:        'Crea eventos automáticos al programar instalaciones, visitas y cobros.',
    recommended: true,
  },
  {
    key:         'contactsEnabled' as const,
    statusKey:   'contacts' as const,
    icon:        Users,
    color:       'text-green-500',
    bg:          'bg-green-500/10',
    name:        'Google Contacts',
    desc:        'Sincroniza tus clientes con la libreta de contactos de Google.',
    recommended: true,
  },
  {
    key:         'driveEnabled' as const,
    statusKey:   'drive' as const,
    icon:        HardDrive,
    color:       'text-purple-500',
    bg:          'bg-purple-500/10',
    name:        'Google Drive',
    desc:        'Guarda copias de seguridad y documentos en la nube.',
    recommended: false,
  },
  {
    key:         'mapsEnabled' as const,
    statusKey:   'maps' as const,
    icon:        MapPin,
    color:       'text-orange-500',
    bg:          'bg-orange-500/10',
    name:        'Google Maps',
    desc:        'Ubica automáticamente las direcciones de tus clientes.',
    recommended: false,
  },
] as const;

// ─── Wizard ───────────────────────────────────────────────────────────────────

const WIZARD_LABELS = ['Conocer', 'Autorizar', 'Configurar', 'Listo'] as const;
type WizardStep = 'welcome' | 'authorizing' | 'services' | 'done';

function stepIndex(s: WizardStep): number {
  return { welcome: 0, authorizing: 1, services: 2, done: 3 }[s];
}

function WizardStepBar({ step }: { step: WizardStep }) {
  const current = stepIndex(step);
  return (
    <div className="flex items-center">
      {WIZARD_LABELS.map((label, i) => {
        const done   = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all',
                done   ? 'bg-emerald-500 text-white' :
                active ? 'bg-primary text-primary-foreground' :
                         'bg-muted text-muted-foreground',
              )}>
                {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={cn(
                'text-[10px] font-medium whitespace-nowrap',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}>{label}</span>
            </div>
            {i < WIZARD_LABELS.length - 1 && (
              <div className={cn(
                'flex-1 h-px mx-2 mb-4 transition-colors',
                i < current ? 'bg-emerald-500' : 'bg-border',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConnectWizard({
  empresaId,
  onConnected,
}: {
  empresaId:   string;
  onConnected: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState<WizardStep>('welcome');
  const [polling, setPolling] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [services, setServices] = useState<Record<string, boolean>>({
    calendarEnabled: true,
    contactsEnabled: true,
    driveEnabled:    false,
    mapsEnabled:     false,
  });

  const { data: pollStatus } = useQuery<GoogleStatus>({
    queryKey:        ['google-status', empresaId],
    queryFn:         () => googleApi.getStatus(empresaId),
    refetchInterval: polling ? 3_000 : false,
    enabled:         polling,
  });

  useEffect(() => {
    if (polling && pollStatus?.connected) {
      setPolling(false);
      setStep('services');
    }
  }, [polling, pollStatus?.connected]);

  const connectMutation = useMutation({
    mutationFn: async () => {
      setConnectError(null);
      const url = await googleApi.getAuthUrl(empresaId);
      window.open(url, 'google_oauth', 'width=600,height=700,noopener');
      setStep('authorizing');
      setPolling(true);
    },
    onError: () => {
      setConnectError('No se pudo iniciar la conexión. Verifica tu conexión a internet e inténtalo de nuevo.');
      setStep('welcome');
    },
  });

  const activateMutation = useMutation({
    mutationFn: () => googleApi.updateServices(empresaId, services),
    onSuccess: () => {
      setStep('done');
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['google-status', empresaId] });
        onConnected();
      }, 2_000);
    },
    onError: () => toast('Error al guardar configuración', { type: 'error' }),
  });

  return (
    <div className="space-y-5">
      <WizardStepBar step={step} />

      {/* ── Step 1: Welcome ─────────────────────────────────────── */}
      {step === 'welcome' && (
        <div className="rounded-2xl border border-border bg-card p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl font-bold bg-gradient-to-br from-blue-600 to-purple-600 bg-clip-text text-transparent">
                G
              </span>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Conecta Google Workspace
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Automatiza tu operación sincronizando clientes, eventos, documentos y ubicaciones con los servicios de Google.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-8">
            {SERVICES.map(({ icon: Icon, color, bg, name, desc }) => (
              <div key={name} className="p-3.5 rounded-xl border border-border bg-muted/20 flex gap-3">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', bg)}>
                  <Icon className={cn('w-4 h-4', color)} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">{name}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 mb-6">
            <Shield className="w-4 h-4 text-blue-500 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Solo pedimos los permisos estrictamente necesarios. Tus datos se sincronizan de forma segura y privada.
            </p>
          </div>

          {connectError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/8 border border-destructive/20 mb-4">
              <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive">{connectError}</p>
            </div>
          )}

          <button
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {connectMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <ArrowRight className="w-4 h-4" />
            }
            Conectar con Google
          </button>
        </div>
      )}

      {/* ── Step 2: Authorizing ──────────────────────────────────── */}
      {step === 'authorizing' && (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-2">
            Esperando que autorices el acceso
          </h3>
          <p className="text-sm text-muted-foreground mb-8 max-w-xs mx-auto">
            Se abrió una ventana de Google. Inicia sesión y acepta los permisos para continuar.
          </p>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>¿No se abrió la ventana?</p>
            <button
              onClick={() => connectMutation.mutate()}
              className="text-primary underline underline-offset-2 hover:no-underline"
            >
              Volver a intentar
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Service selection ────────────────────────────── */}
      {step === 'services' && (
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <h3 className="text-base font-semibold text-foreground">¡Cuenta conectada!</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Elige qué servicios activar. Puedes cambiarlos en cualquier momento.
            </p>
          </div>

          <div className="space-y-2.5 mb-6">
            {SERVICES.map(({ key, icon: Icon, color, bg, name, desc, recommended }) => {
              const enabled = services[key];
              return (
                <button
                  key={key}
                  onClick={() => setServices(prev => ({ ...prev, [key]: !prev[key] }))}
                  className={cn(
                    'w-full flex items-center gap-3.5 p-4 rounded-xl border text-left transition-all',
                    enabled
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border bg-muted/10 hover:border-border/80',
                  )}
                >
                  <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', bg)}>
                    <Icon className={cn('w-4 h-4', color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{name}</span>
                      {recommended && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-semibold">
                          Recomendado
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                  <div className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                    enabled ? 'bg-primary border-primary' : 'border-border',
                  )}>
                    {enabled && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                </button>
              );
            })}
          </div>

          <button
            onClick={() => activateMutation.mutate()}
            disabled={activateMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {activateMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Zap className="w-4 h-4" />
            }
            Activar integración
          </button>
        </div>
      )}

      {/* ── Step 4: Done ─────────────────────────────────────────── */}
      {step === 'done' && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-14 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">¡Todo listo!</h3>
          <p className="text-sm text-muted-foreground">
            Google Workspace está activo. La sincronización comenzará automáticamente.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Service card (connected dashboard) ──────────────────────────────────────

function ServiceCard({
  icon: Icon, color, bg, name, desc, enabled, onToggle, loading,
}: {
  icon:     React.ElementType;
  color:    string;
  bg:       string;
  name:     string;
  desc:     string;
  enabled:  boolean;
  onToggle: () => void;
  loading:  boolean;
}) {
  return (
    <div className={cn(
      'rounded-xl border p-4 transition-colors',
      enabled ? 'border-border bg-card' : 'border-border/40 bg-muted/10',
    )}>
      <div className="flex items-start justify-between mb-3">
        <div className={cn(
          'w-9 h-9 rounded-lg flex items-center justify-center',
          enabled ? bg : 'bg-muted/30',
        )}>
          <Icon className={cn('w-4 h-4 transition-colors', enabled ? color : 'text-muted-foreground/40')} />
        </div>
        <button
          onClick={onToggle}
          disabled={loading}
          className={cn(
            'relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0',
            enabled ? 'bg-primary' : 'bg-muted-foreground/25',
            loading && 'opacity-50 cursor-not-allowed',
          )}
        >
          <span className={cn(
            'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-4' : 'translate-x-1',
          )} />
        </button>
      </div>
      <p className={cn(
        'text-xs font-semibold mb-1 transition-colors',
        enabled ? 'text-foreground' : 'text-muted-foreground',
      )}>
        {name}
      </p>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

// ─── Activity item (connected dashboard) ─────────────────────────────────────

const SERVICE_ICON: Record<string, React.ElementType> = {
  contacts: Users,
  calendar: Calendar,
  drive:    HardDrive,
  maps:     MapPin,
  oauth:    Shield,
};

function ActivityItem({ log }: { log: GoogleSyncLog }) {
  const Icon = SERVICE_ICON[log.service] ?? Zap;
  const isError = log.result === 'failed';
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/40 last:border-0">
      <div className={cn(
        'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
        isError             ? 'bg-red-500/10' :
        log.result === 'partial' ? 'bg-amber-500/10' :
        log.result === 'success' ? 'bg-emerald-500/10' : 'bg-muted/40',
      )}>
        <Icon className={cn(
          'w-3.5 h-3.5',
          isError             ? 'text-red-400' :
          log.result === 'partial' ? 'text-amber-500' :
          log.result === 'success' ? 'text-emerald-500' : 'text-muted-foreground',
        )} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground leading-snug">
          {humanActivity(log.service, log.operation)}
        </p>
        {isError && log.errorMessage && (
          <p className="text-xs text-muted-foreground mt-0.5">{humanError(log.errorMessage)}</p>
        )}
        {!isError && log.recordsProcessed > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {log.recordsProcessed} registro{log.recordsProcessed !== 1 ? 's' : ''}
            {log.durationMs != null
              ? ` · ${log.durationMs < 1_000 ? `${log.durationMs}ms` : `${(log.durationMs / 1_000).toFixed(1)}s`}`
              : ''}
          </p>
        )}
      </div>
      <span className="text-[10px] text-muted-foreground/50 shrink-0 mt-0.5">
        {fmtRelative(log.createdAt)}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GoogleIntegrationDashboard({ empresaId }: { empresaId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const { data: status, isLoading } = useQuery<GoogleStatus>({
    queryKey:        ['google-status', empresaId],
    queryFn:         () => googleApi.getStatus(empresaId),
    refetchInterval: 30_000,
  });

  const { data: logs } = useQuery<GoogleSyncLog[]>({
    queryKey:        ['google-logs', empresaId],
    queryFn:         () => googleApi.getLogs(empresaId, 20),
    enabled:         !!status?.connected,
    refetchInterval: 60_000,
  });

  const disconnectMutation = useMutation({
    mutationFn: () => googleApi.disconnect(empresaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['google-status', empresaId] });
      setConfirmDisconnect(false);
      toast('Cuenta de Google desconectada', { type: 'success' });
    },
  });

  const servicesMutation = useMutation({
    mutationFn: (dto: UpdateServicesDto) => googleApi.updateServices(empresaId, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-status', empresaId] }),
    onError: () => toast('No se pudo actualizar la configuración', { type: 'error' }),
  });

  const syncBulkMutation = useMutation({
    mutationFn: () => googleApi.syncContactsBulk(empresaId),
    onSuccess: () => toast('Sincronización iniciada. Puede tardar unos minutos.', { type: 'success' }),
    onError: () => toast('No se pudo iniciar la sincronización', { type: 'error' }),
  });

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className={cn('rounded-xl bg-muted/40 animate-pulse', i === 1 ? 'h-24' : 'h-16')} />
        ))}
      </div>
    );
  }

  // ── Not connected: show wizard ───────────────────────────────────────────
  if (!status?.connected) {
    return (
      <ConnectWizard
        empresaId={empresaId}
        onConnected={() => qc.invalidateQueries({ queryKey: ['google-status', empresaId] })}
      />
    );
  }

  // ── Connected dashboard ──────────────────────────────────────────────────
  const storageUsedPct = Number(status.driveStorageTotal) > 0
    ? Math.min(100, (Number(status.driveStorageUsed) / Number(status.driveStorageTotal)) * 100)
    : 0;

  return (
    <div className="space-y-5">

      {/* ── Connection header ──────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center shrink-0">
            <span className="text-base font-bold bg-gradient-to-br from-blue-600 to-purple-600 bg-clip-text text-transparent">
              G
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground truncate">
                {status.name || status.email}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Conectado
              </span>
            </div>
            {status.name && (
              <p className="text-xs text-muted-foreground truncate">{status.email}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['google-status', empresaId] })}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Actualizar estado"
            >
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
            </button>
            {confirmDisconnect ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">¿Desconectar?</span>
                <button
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  className="px-2.5 py-1 rounded-lg text-xs bg-destructive text-destructive-foreground font-medium disabled:opacity-50"
                >
                  {disconnectMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Sí'}
                </button>
                <button
                  onClick={() => setConfirmDisconnect(false)}
                  className="px-2.5 py-1 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDisconnect(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
              >
                <Unplug className="w-3.5 h-3.5" />
                Desconectar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Error banner ───────────────────────────────────────── */}
      {(status.errorCount ?? 0) > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/8 border border-amber-500/20">
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-amber-600">
              {status.errorCount === 1 ? 'Hubo un problema reciente' : `${status.errorCount} problemas recientes`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{humanError(status.lastError)}</p>
          </div>
        </div>
      )}

      {/* ── Services ───────────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Servicios activos
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {SERVICES.map(({ key, statusKey, icon, color, bg, name, desc }) => (
            <ServiceCard
              key={key}
              icon={icon} color={color} bg={bg}
              name={name} desc={desc}
              enabled={status.services[statusKey]}
              onToggle={() => servicesMutation.mutate({ [key]: !status.services[statusKey] })}
              loading={servicesMutation.isPending}
            />
          ))}
        </div>
      </div>

      {/* ── Drive storage ──────────────────────────────────────── */}
      {status.services.drive && Number(status.driveStorageTotal) > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-purple-500" />
              <span className="text-xs font-medium text-foreground">Almacenamiento en Drive</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {fmtBytes(status.driveStorageUsed)} de {fmtBytes(status.driveStorageTotal)}
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                storageUsedPct > 80 ? 'bg-amber-500' : 'bg-purple-500',
              )}
              style={{ width: `${storageUsedPct}%` }}
            />
          </div>
          {storageUsedPct > 80 && (
            <p className="text-xs text-amber-500 mt-1.5">
              Almacenamiento casi lleno. Considera eliminar archivos antiguos.
            </p>
          )}
        </div>
      )}

      {/* ── Quick actions ──────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Acciones
        </h3>
        <button
          onClick={() => syncBulkMutation.mutate()}
          disabled={syncBulkMutation.isPending || !status.services.contacts}
          className="w-full flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-muted/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
            {syncBulkMutation.isPending
              ? <Loader2 className="w-4 h-4 text-green-500 animate-spin" />
              : <Users className="w-4 h-4 text-green-500" />
            }
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-xs font-medium text-foreground">Sincronizar todos los clientes</p>
            <p className="text-xs text-muted-foreground">
              {status.services.contacts
                ? 'Envía todos los clientes activos a Google Contacts'
                : 'Activa Google Contacts para usar esta función'}
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      </div>

      {/* ── Recent activity ────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Actividad reciente
          </h3>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['google-logs', empresaId] })}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          {!logs?.length ? (
            <div className="text-center py-8">
              <Clock className="w-8 h-8 text-muted-foreground/25 mx-auto mb-2" />
              <p className="text-xs font-medium text-muted-foreground">Sin actividad aún</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Aquí verás la actividad cuando comience la sincronización
              </p>
            </div>
          ) : (
            logs.map(log => <ActivityItem key={log.id} log={log} />)
          )}
        </div>
      </div>

    </div>
  );
}
