'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Server, Shield, CheckCircle2, Eye, EyeOff,
  Loader2, AlertCircle, ChevronRight, Database,
  Wifi, Lock, ArrowRight, RefreshCw,
} from 'lucide-react';

// ── API base URL ─────────────────────────────────────────────
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API}/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Error ${res.status}`);
  return json.data ?? json;
}

// ── Tipos ─────────────────────────────────────────────────────
interface DbConfig { host: string; port: number; username: string; password: string; database: string; rawPassword?: string; }
interface StepState { step: number; dbConfig: DbConfig; testResult: { ok: boolean; message: string; details?: string } | null; licenseEmail: string; licenseKey: string; finalCredentials: { adminEmail: string; adminPassword: string } | null; isDev: boolean; }

const STEPS = [
  { id: 1, label: 'Base de Datos', icon: Database },
  { id: 2, label: 'Licencia',      icon: Shield },
  { id: 3, label: 'Completado',    icon: CheckCircle2 },
];

// ── Componentes helpers ──────────────────────────────────────
function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</label>
      {children}
      {hint  && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
    </div>
  );
}

function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3.5 py-2.5 text-sm rounded-xl border bg-white/5 text-white
                  placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50
                  focus:border-cyan-500/50 border-white/10 transition-all ${className}`}
    />
  );
}

function Btn({ loading, children, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: 'primary' | 'ghost' }) {
  const base = 'relative flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    primary: 'bg-cyan-500 text-[#0a0a0f] hover:bg-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)]',
    ghost:   'border border-white/10 text-slate-400 hover:text-white hover:border-white/30 bg-white/5 hover:bg-white/10',
  };
  return (
    <button {...props} disabled={loading || props.disabled} className={`${base} ${styles[variant]} ${className}`}>
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════
// PASO 1 — Configuración de Base de Datos
// ════════════════════════════════════════════════════════════
function StepDb({ config, onNext }: { config: DbConfig; onNext: (cfg: DbConfig, result: any) => void }) {
  const [form, setForm]       = useState<DbConfig>(config);
  const [showPw, setShowPw]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult]   = useState<{ ok: boolean; message: string; details?: string } | null>(null);
  const [errors, setErrors]   = useState<Partial<Record<keyof DbConfig, string>>>({});

  const set = (k: keyof DbConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: k === 'port' ? parseInt(e.target.value || '5432') : e.target.value }));

  const validate = () => {
    const errs: typeof errors = {};
    if (!form.host)     errs.host     = 'Requerido';
    if (!form.port)     errs.port     = 'Requerido';
    if (!form.username) errs.username = 'Requerido';
    if (!form.database) errs.database = 'Requerido';
    setErrors(errs);
    return !Object.keys(errs).length;
  };

  const handleTest = async () => {
    if (!validate()) return;
    setTesting(true); setResult(null);
    try {
      const res = await apiFetch('/install/test-db', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setResult(res);
    } catch (e: any) {
      setResult({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Servidor" error={errors.host}>
          <Input value={form.host} onChange={set('host')} placeholder="localhost" />
        </Field>
        <Field label="Puerto" error={errors.port as string}>
          <Input value={form.port} onChange={set('port')} type="number" placeholder="5432" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Usuario" error={errors.username}>
          <Input value={form.username} onChange={set('username')} placeholder="datafast_db_user" />
        </Field>
        <Field label="Contraseña">
          <div className="relative">
            <Input
              value={form.password}
              onChange={set('password')}
              type={showPw ? 'text' : 'password'}
              placeholder="contraseña"
              className="pr-10"
            />
            <button type="button" onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
      </div>
      <Field label="Base de datos" error={errors.database}>
        <Input value={form.database} onChange={set('database')} placeholder="datafast_db" />
      </Field>

      {result && (
        <div className={`flex items-start gap-3 p-3.5 rounded-xl text-sm border ${
          result.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>
          {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <div>
            <p className="font-medium">{result.message}</p>
            {result.details && <p className="text-xs mt-0.5 opacity-75">{result.details}</p>}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Btn loading={testing} onClick={handleTest} variant="ghost" className="flex-1">
          <RefreshCw className="w-4 h-4" />
          Validar Conexión
        </Btn>
        <Btn
          disabled={!result?.ok}
          onClick={() => result?.ok && onNext(form, result)}
          className="flex-1"
        >
          Continuar <ChevronRight className="w-4 h-4" />
        </Btn>
      </div>
      {!result?.ok && result !== null && (
        <p className="text-xs text-center text-slate-500">Debes validar la conexión antes de continuar</p>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// PASO 2 — Activación de Licencia
// ════════════════════════════════════════════════════════════
function StepLicense({ onNext, isDev }: { onNext: (creds: { adminEmail: string; adminPassword: string }) => void; isDev: boolean }) {
  const [email, setEmail]         = useState('');
  const [licenseKey, setLicense]  = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [progress, setProgress]   = useState('');

  const handleActivate = async () => {
    if (!email || (!isDev && !licenseKey)) { setError('Completa todos los campos'); return; }
    setLoading(true); setError(''); setProgress(isDev ? 'Configurando...' : 'Validando licencia...');

    try {
      setProgress('Ejecutando migraciones...');
      const res = await apiFetch('/install/activate', {
        method: 'POST',
        body: JSON.stringify({ email, licenseKey }),
      });
      setProgress('Creando usuario administrador...');
      await new Promise((r) => setTimeout(r, 800));
      onNext(res);
    } catch (e: any) {
      setError(e.message);
      setProgress('');
    } finally {
      setLoading(false);
    }
  };

  const steps = isDev
    ? ['Creación de tablas en la base de datos', 'Generación del usuario administrador']
    : ['Verificación de la clave de licencia', 'Creación de tablas en la base de datos', 'Generación del usuario administrador'];

  return (
    <div className="space-y-5">
      {isDev && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-300 flex items-center gap-2">
          <Lock className="w-4 h-4 flex-shrink-0" />
          Modo desarrollo — licencia no requerida
        </div>
      )}

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-400 space-y-1">
        <p className="text-white font-medium text-xs uppercase tracking-wider mb-2">¿Qué ocurre al activar?</p>
        <div className="space-y-1.5">
          {steps.map((t) => (
            <div key={t} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>

      <Field label="Correo Electrónico">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="contacto@tuisp.pe" />
      </Field>
      {!isDev && (
        <Field label="Código de Licencia" hint="Formato: XXXXX-XXXXX-XXXXX-XXXXX o JWT">
          <Input value={licenseKey} onChange={(e) => setLicense(e.target.value)} placeholder="Pega aquí tu clave de licencia" className="font-mono text-xs" />
        </Field>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && progress && (
        <div className="flex items-center gap-2 text-sm text-cyan-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{progress}</span>
        </div>
      )}

      <Btn loading={loading} onClick={handleActivate} className="w-full">
        Iniciar Instalación <ArrowRight className="w-4 h-4" />
      </Btn>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// PASO 3 — Instalación Completa
// ════════════════════════════════════════════════════════════
function StepComplete({ creds }: { creds: { adminEmail: string; adminPassword: string } }) {
  const [countdown, setCountdown] = useState(6);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(intervalRef.current!);
          window.location.href = '/login';
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-400" />
        </div>
      </div>

      <div>
        <h3 className="text-2xl font-bold text-white mb-2">INSTALACIÓN COMPLETA</h3>
        <p className="text-slate-400">Ahora puedes acceder al panel de administración</p>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3 text-left">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Credenciales de acceso</p>
        {[
          { label: 'Usuario', value: creds.adminEmail },
          { label: 'Contraseña', value: creds.adminPassword },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-sm text-slate-400">{label}</span>
            <span className="font-mono font-bold text-white bg-white/10 px-3 py-1 rounded-lg text-sm">{value}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => { window.location.href = '/login'; }}
        className="w-full flex items-center justify-center gap-2 py-3 px-5 text-sm font-semibold
                   rounded-xl bg-cyan-500 text-[#0a0a0f] hover:bg-cyan-400 transition-all
                   shadow-[0_0_30px_rgba(6,182,212,0.4)]"
      >
        Ir al Panel de Administración <ArrowRight className="w-4 h-4" />
      </button>

      <p className="text-xs text-slate-500">
        Redirigiendo automáticamente en <span className="text-cyan-400 font-bold">{countdown}</span> segundos
      </p>

      <div className="flex items-center gap-1.5 justify-center text-amber-400 text-xs">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>No olvides cambiar tus datos de acceso después del primer login</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════
export default function InstalllPage() {
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [state, setState] = useState<StepState>({
    step: 1,
    dbConfig: { host: 'localhost', port: 5432, username: 'datafast_db_user', password: '', database: 'datafast_db' },
    testResult: null,
    licenseEmail: '',
    licenseKey: '',
    finalCredentials: null,
    isDev: false,
  });

  // Verificar estado al cargar
  useEffect(() => {
    apiFetch('/install/status').then((status) => {
      if (status.webInstalled) {
        setBlocked(true);
        setTimeout(() => { window.location.href = '/login'; }, 4000);
      } else {
        setState((s) => ({ ...s, isDev: !!status.isDev }));
        // Pre-cargar config de BD
        apiFetch('/install/db-config').then((cfg) => {
          setState((s) => ({
            ...s,
            dbConfig: { ...s.dbConfig, ...cfg, password: cfg.rawPassword || '' },
          }));
        }).catch(() => {});
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-6">
        <CheckCircle2 className="w-16 h-16 text-emerald-400" />
        <h1 className="text-2xl font-bold text-white">Sistema ya instalado</h1>
        <p className="text-slate-400">Redirigiendo al panel de acceso...</p>
      </div>
    );
  }

  const currentStep = state.step;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-lg relative z-10">

        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl
                          bg-gradient-to-br from-cyan-500/20 to-violet-500/20
                          border border-cyan-500/30 mb-4">
            <Wifi className="w-7 h-7 text-cyan-400" />
          </div>
          <h1 className="text-xl font-bold text-white">CRM ISP DATAFAST</h1>
          <p className="text-sm text-slate-500 mt-1">Asistente de instalación</p>
        </div>

        {/* Progress steps */}
        {currentStep < 3 && (
          <div className="flex items-center justify-center gap-0 mb-8">
            {STEPS.map((s, idx) => {
              const done    = currentStep > s.id;
              const active  = currentStep === s.id;
              const Icon = s.icon;
              return (
                <div key={s.id} className="flex items-center">
                  <div className={`flex flex-col items-center gap-1.5 ${active ? 'opacity-100' : done ? 'opacity-100' : 'opacity-30'}`}>
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                      done   ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' :
                      active ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400' :
                               'bg-white/5 border-white/20 text-slate-500'
                    }`}>
                      {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </div>
                    <span className={`text-[10px] font-medium whitespace-nowrap ${active ? 'text-cyan-400' : 'text-slate-500'}`}>
                      {s.label}
                    </span>
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div className={`w-16 h-px mx-2 mb-4 transition-all ${currentStep > s.id ? 'bg-emerald-500/50' : 'bg-white/10'}`} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Card */}
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl backdrop-blur-sm shadow-2xl">
          <div className="px-6 py-5 border-b border-white/10">
            <h2 className="text-base font-semibold text-white">
              {currentStep === 1 && 'Configuración de Base de Datos'}
              {currentStep === 2 && 'Activación de Licencia'}
              {currentStep === 3 && 'Instalación Completa'}
            </h2>
            {currentStep < 3 && (
              <p className="text-xs text-slate-500 mt-0.5">
                {currentStep === 1 && 'Verifica que los datos de conexión sean correctos antes de continuar.'}
                {currentStep === 2 && 'Ingresa tus datos de contacto y la clave de licencia proporcionada.'}
              </p>
            )}
          </div>

          <div className="p-6">
            {currentStep === 1 && (
              <StepDb
                config={state.dbConfig}
                onNext={(cfg, res) => setState((s) => ({ ...s, step: 2, dbConfig: cfg, testResult: res }))}
              />
            )}
            {currentStep === 2 && (
              <StepLicense
                isDev={state.isDev}
                onNext={(creds) => setState((s) => ({ ...s, step: 3, finalCredentials: creds }))}
              />
            )}
            {currentStep === 3 && state.finalCredentials && (
              <StepComplete creds={state.finalCredentials} />
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          CRM ISP DATAFAST · Instalador Web v{process.env.NEXT_PUBLIC_VERSION || '1.0.0'}
        </p>
      </div>
    </div>
  );
}
