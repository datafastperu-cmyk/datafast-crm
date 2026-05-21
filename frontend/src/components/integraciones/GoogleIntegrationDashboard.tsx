'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, AlertCircle, RefreshCw, Unplug,
  Calendar, Users, HardDrive, MapPin, Clock,
  ArrowRight, Check, Loader2, Zap, Shield, ChevronRight,
  Copy, Eye, EyeOff, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toaster';
import {
  googleApi,
  type GoogleStatus,
  type GoogleSyncLog,
  type UpdateServicesDto,
  type SaveAppConfigDto,
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

type WizardStep = 'setup' | 'welcome' | 'authorizing' | 'services' | 'done';

function WizardStepBar({ step, needsSetup }: { step: WizardStep; needsSetup: boolean }) {
  const labels = needsSetup
    ? ['Credenciales', 'Conocer', 'Autorizar', 'Servicios', 'Listo'] as const
    : ['Conocer', 'Autorizar', 'Servicios', 'Listo'] as const;

  const indexMap: Record<WizardStep, number> = needsSetup
    ? { setup: 0, welcome: 1, authorizing: 2, services: 3, done: 4 }
    : { setup: -1, welcome: 0, authorizing: 1, services: 2, done: 3 };

  const current = indexMap[step] ?? 0;

  return (
    <div className="flex items-center">
      {labels.map((label, i) => {
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
            {i < labels.length - 1 && (
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

// ── CopyField: shows a value with a copy button ──────────────────────────────
function CopyField({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 border border-border">
        <code className="flex-1 text-xs text-foreground font-mono truncate">{value}</code>
        <button
          onClick={copy}
          className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
          title="Copiar"
        >
          {copied
            ? <Check className="w-3.5 h-3.5 text-emerald-500" />
            : <Copy className="w-3.5 h-3.5 text-muted-foreground" />
          }
        </button>
      </div>
    </div>
  );
}

// ── CredentialInput ───────────────────────────────────────────────────────────
function CredentialInput({
  label, value, onChange, placeholder, secret = false, hint,
}: {
  label:       string;
  value:       string;
  onChange:    (v: string) => void;
  placeholder: string;
  secret?:     boolean;
  hint?:       string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-foreground">{label}</label>
      <div className="relative">
        <input
          type={secret && !show ? 'password' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="w-full px-3 py-2.5 pr-10 rounded-xl border border-border bg-muted/20 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShow(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ConnectWizard({
  empresaId,
  initialStep,
  redirectUri,
  onConnected,
}: {
  empresaId:   string;
  initialStep: WizardStep;
  redirectUri: string;
  onConnected: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  // needsSetup se recalcula con el step actual para que la barra refleje correctamente
  // el caso en que el usuario retrocede a Credenciales desde Conocer
  const needsSetup = initialStep === 'setup' || step === 'setup';
  const [step, setStep]       = useState<WizardStep>(initialStep);
  const [polling, setPolling] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  // Setup form state
  const [clientId,     setClientId]     = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [mapsApiKey,   setMapsApiKey]   = useState('');
  const [setupError,   setSetupError]   = useState<string | null>(null);

  const resetWizard = () => {
    popupRef.current?.close();
    popupRef.current = null;
    setPolling(false);
    setConnectError(null);
    setSetupError(null);
    setClientId('');
    setClientSecret('');
    setMapsApiKey('');
    setStep(initialStep);
    googleApi.cancelarSetup(empresaId);
  };

  // Cerrar popup y limpiar fila huérfana de BD cuando el componente se desmonta
  // (navegación, cambio de key por el padre, cierre de sesión, etc.)
  useEffect(() => {
    return () => {
      popupRef.current?.close();
      popupRef.current = null;
      googleApi.cancelarSetup(empresaId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Services selection
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

  // Detectar cierre del popup sin haber conectado (el usuario lo cerró manualmente
  // o Google mostró un error y el usuario cerró la ventana)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (polling) {
      timer = setInterval(() => {
        if (popupRef.current?.closed && !pollStatus?.connected) {
          if (timer) clearInterval(timer);
          setPolling(false);
          setConnectError(
            'La ventana de Google se cerró sin completar la autorización. ' +
            'Verifica que la URI de redirección de abajo esté registrada en Google Cloud Console → OAuth 2.0 → URIs de redirección autorizadas.'
          );
          setStep(initialStep);
        }
      }, 1_000);
    }
    return () => { if (timer) clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling]);

  const saveConfigMutation = useMutation({
    mutationFn: () => googleApi.saveAppConfig(empresaId, {
      clientId:    clientId.trim(),
      clientSecret: clientSecret.trim(),
      mapsApiKey:  mapsApiKey.trim() || undefined,
    } as SaveAppConfigDto),
    onSuccess: () => {
      setSetupError(null);
      setStep('welcome');
      qc.invalidateQueries({ queryKey: ['google-status', empresaId] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      setSetupError(msg || 'No se pudo guardar la configuración. Verifica los datos e inténtalo de nuevo.');
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      setConnectError(null);
      const url = await googleApi.getAuthUrl(empresaId);
      const popup = window.open(url, 'google_oauth', 'width=600,height=700,noopener');
      popupRef.current = popup;
      setStep('authorizing');
      setPolling(true);
    },
    onError: (err: any) => {
      const status = err?.response?.status;
      if (status === 503) {
        setConnectError('Las credenciales de Google no están configuradas. Vuelve al paso anterior y verifica el Client ID y Client Secret.');
      } else if (status === 403) {
        setConnectError('No tienes permisos para conectar Google. Contacta al administrador del sistema.');
      } else {
        setConnectError('No se pudo iniciar la conexión. Verifica tu conexión a internet e inténtalo de nuevo.');
      }
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

  const canSaveConfig = clientId.trim().length > 10 && clientSecret.trim().length > 5;

  return (
    <div className="space-y-5">
      <WizardStepBar step={step} needsSetup={needsSetup} />

      {/* ── Step: Credenciales (solo si no están configuradas) ── */}
      {step === 'setup' && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground mb-1">
              Configurar credenciales de Google
            </h3>
            <p className="text-sm text-muted-foreground">
              Necesitas crear una aplicación en Google Cloud Console. Sigue estos pasos:
            </p>
          </div>

          {/* Instructions */}
          <div className="space-y-2.5">
            {[
              {
                n: 1,
                title: 'Crear un proyecto en Google Cloud',
                body:  'Ve a Google Cloud Console → Nuevo proyecto → Nómbralo "DataFast CRM".',
                link:  'https://console.cloud.google.com/projectcreate',
              },
              {
                n: 2,
                title: 'Habilitar APIs',
                body:  'APIs y Servicios → Biblioteca → Busca y habilita: Google Calendar API, People API, Google Drive API.',
                link:  'https://console.cloud.google.com/apis/library',
              },
              {
                n: 3,
                title: 'Crear credenciales OAuth 2.0',
                body:  'Credenciales → Crear credenciales → ID de cliente OAuth 2.0 → Tipo: Aplicación web. Agrega exactamente esta URI de redirección:',
                link:  null,
              },
            ].map(({ n, title, body, link }) => (
              <div key={n} className="flex gap-3 p-3.5 rounded-xl bg-muted/30 border border-border/50">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                  {n}
                </span>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-foreground">{title}</p>
                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0"
                      >
                        <ExternalLink className="w-3 h-3 text-primary" />
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
                  {n === 3 && (
                    <CopyField
                      label="URI de redirección autorizada"
                      value={redirectUri}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Domain warning — Google rejects raw IPs */}
          {/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(redirectUri) && (
            <div className="flex gap-2.5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                <p className="font-semibold">Google no acepta direcciones IP como URI de redirección</p>
                <p>
                  La URI de arriba contiene una IP. Antes de obtener las credenciales, configura un dominio en{' '}
                  <a href="/configuracion/general" className="underline font-medium hover:text-amber-900">
                    Configuración → General → Dominio del servidor
                  </a>.
                  Una vez guardado el dominio, la URI se actualizará automáticamente.
                </p>
              </div>
            </div>
          )}

          {/* Credential inputs */}
          <div className="space-y-3 pt-1">
            <CredentialInput
              label="Client ID"
              value={clientId}
              onChange={setClientId}
              placeholder="xxxxxxxxxxxx-xxxxxxxx.apps.googleusercontent.com"
              hint="Lo encuentras en Credenciales → tu app OAuth 2.0 → Client ID"
            />
            <CredentialInput
              label="Client Secret"
              value={clientSecret}
              onChange={setClientSecret}
              placeholder="GOCSPX-..."
              secret
              hint="Está junto al Client ID en la misma pantalla"
            />
            <CredentialInput
              label="Maps API Key (opcional — para geolocalizar direcciones)"
              value={mapsApiKey}
              onChange={setMapsApiKey}
              placeholder="AIzaSy..."
              hint="Credenciales → Crear credenciales → Clave de API → restringe a Geocoding API"
            />
          </div>

          {setupError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/8 border border-destructive/20">
              <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-xs text-destructive">{setupError}</p>
            </div>
          )}

          <button
            onClick={() => saveConfigMutation.mutate()}
            disabled={!canSaveConfig || saveConfigMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saveConfigMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Check className="w-4 h-4" />
            }
            Guardar y continuar
          </button>
        </div>
      )}

      {/* ── Step: Welcome ───────────────────────────────────────── */}
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
            <div className="space-y-3 mb-4">
              <div className="flex items-start gap-2 p-3.5 rounded-xl bg-destructive/8 border border-destructive/20">
                <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-xs text-destructive leading-relaxed">{connectError}</p>
              </div>
              <CopyField value={redirectUri} label="URI de redirección — cópiala y agrégala en Google Cloud Console" />
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary underline underline-offset-2"
              >
                <ExternalLink className="w-3 h-3" />
                Abrir Google Cloud Console → Credenciales
              </a>
            </div>
          )}

          <div className="space-y-2.5">
            <button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {connectMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ArrowRight className="w-4 h-4" />
              }
              {connectError ? 'Reintentar autorización' : 'Iniciar sesión con Google'}
            </button>
            <button
              onClick={() => setStep('setup')}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
            >
              Cambiar credenciales (Client ID / Secret)
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Authorizing ───────────────────────────────────── */}
      {step === 'authorizing' && (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-6">
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-7 h-7 text-primary animate-spin" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">
              Esperando autorización de Google
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Inicia sesión en la ventana que se abrió y acepta los permisos solicitados.
            </p>
          </div>

          {/* URI de redirección visible para que el usuario pueda verificar */}
          <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/15 space-y-2.5">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <p className="text-xs font-semibold text-amber-600">
                Si Google muestra un error de redirección
              </p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Agrega exactamente esta URI en Google Cloud Console → Credenciales → tu app OAuth 2.0 → <strong>URIs de redirección autorizadas</strong>:
            </p>
            <CopyField value={redirectUri} label="URI de redirección" />
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary underline underline-offset-2"
            >
              <ExternalLink className="w-3 h-3" />
              Abrir Google Cloud Console
            </a>
          </div>

          <div className="space-y-2 text-center">
            <p className="text-xs text-muted-foreground">¿No se abrió la ventana?</p>
            <div className="flex gap-2">
              <button
                onClick={() => connectMutation.mutate()}
                className="flex-1 py-2 rounded-xl border border-primary/30 text-xs text-primary font-medium hover:bg-primary/5 transition-colors"
              >
                Volver a abrir
              </button>
              <button
                onClick={resetWizard}
                className="flex-1 py-2 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Services ──────────────────────────────────────── */}
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
                    enabled ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/10 hover:border-border/80',
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

      {/* ── Step: Done ──────────────────────────────────────────── */}
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

  // ── Wizard reset via key ─────────────────────────────────────────────────
  // El wizard se desmonta y remonta limpio cada vez que el usuario navega a
  // una sección diferente y regresa (sin importar si el layout de Next.js
  // mantiene el componente vivo en background).
  const [wizardKey, setWizardKey] = useState(0);
  const pathname = usePathname();
  const wizardPrevPath = useRef<string | null>(null);

  useEffect(() => {
    if (wizardPrevPath.current !== null && wizardPrevPath.current !== pathname) {
      setWizardKey(k => k + 1);
    }
    wizardPrevPath.current = pathname;
  }, [pathname]);

  const { data: status, isLoading } = useQuery<GoogleStatus>({
    queryKey:        ['google-status', empresaId],
    queryFn:         () => googleApi.getStatus(empresaId),
    refetchInterval: 30_000,
    staleTime:       30_000,  // evita parpadeos por datos obsoletos en caché
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
        key={wizardKey}
        empresaId={empresaId}
        initialStep={status?.appConfigured ? 'welcome' : 'setup'}
        redirectUri={status?.redirectUri ?? ''}
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
