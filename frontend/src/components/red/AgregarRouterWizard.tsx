'use client';

import { useState } from 'react';
import {
  Router, X, ChevronRight, ChevronLeft, Network, Shield, CheckCircle2,
  XCircle, Loader2, Copy, Check, RefreshCw, Wifi, Key, Gauge, Eye, EyeOff,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { mikrotikApi }  from '@/lib/api/mikrotik';
import { vpnApi }       from '@/lib/api/vpn';
import { useToast }     from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import type { TestConexionResult } from '@/lib/api/mikrotik';
import type { VpnCliente, VersionRos } from '@/lib/api/vpn';

// ─── Opciones ─────────────────────────────────────────────────────────────────

const SECURITY_OPTS = [
  { val: 'amarre_ip_mac',      label: 'Amarre IP/MAC'             },
  { val: 'amarre_ip_mac_dhcp', label: 'Amarre IP/MAC + DHCP Leases' },
  { val: 'ninguna',            label: 'Ninguno'                   },
] as const;

const SPEED_OPTS = [
  { val: 'colas_simples',     label: 'Colas Simples'                          },
  { val: 'pcq_addresslist',   label: 'PCQ + AddressList'                      },
  { val: 'dhcp_lease_queues', label: 'DHCP Leases (Colas Simples Dinámicas)'  },
  { val: 'ninguno',           label: 'Ninguno'                                },
] as const;

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Step         = 1 | 2 | 3;
type TipoConexion = 'api' | 'vpn_tunnel';
type VpnSubStep   = 'init' | 'generating' | 'script_ready';
type TestStatus   = 'idle' | 'testing' | 'ok' | 'error';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const inputCls   = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-primary/50 transition-colors';
const labelCls   = 'text-xs text-gray-400 mb-1 block';
const sectionHdr = 'text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-3';

const STEPS = [
  { n: 1 as Step, label: 'Identificación' },
  { n: 2 as Step, label: 'Conexión'       },
  { n: 3 as Step, label: 'Control'        },
];

// ─── Componente ───────────────────────────────────────────────────────────────

export function AgregarRouterWizard({ onClose, onSaved }: Props) {
  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>(1);

  // Paso 1
  const [nombre,      setNombre]      = useState('');
  const [ubicacion,   setUbicacion]   = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [versionRos,  setVersionRos]  = useState<'v6' | 'v7' | ''>('');

  // Paso 2 — conexión
  const [tipoConexion, setTipoConexion] = useState<TipoConexion>('api');
  const [ipGestion,    setIpGestion]    = useState('');
  const [usuario,      setUsuario]      = useState('admin');
  const [password,     setPassword]     = useState('');
  const [puertoApi,    setPuertoApi]    = useState(8728);

  // Paso 2 — script VPN
  const [vpnSubStep, setVpnSubStep] = useState<VpnSubStep>('init');
  const [vpnCliente, setVpnCliente] = useState<VpnCliente | null>(null);
  const [vpnScript,  setVpnScript]  = useState('');
  const [vpnIp,      setVpnIp]      = useState('');
  const [copied,     setCopied]     = useState(false);

  const [showPassword, setShowPassword] = useState(false);

  // Test de conexión
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testResult, setTestResult] = useState<TestConexionResult | null>(null);

  // Paso 3
  const [tipoControl,          setTipoControl]          = useState('amarre_ip_mac');
  const [tipoControlVelocidad, setTipoControlVelocidad] = useState('colas_simples');

  const [saving,         setSaving]         = useState(false);
  const [routerGuardado, setRouterGuardado] = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const resetTest = () => { setTestStatus('idle'); setTestResult(null); };

  const handleClose = async () => {
    if (vpnCliente && !routerGuardado) {
      try { await vpnApi.revocar(vpnCliente.id); } catch { /* silent */ }
    }
    onClose();
  };

  const copyScript = () => {
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(vpnScript).catch(() => copyFallback(vpnScript));
      } else {
        copyFallback(vpnScript);
      }
    } catch {
      copyFallback(vpnScript);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyFallback = (text: string) => {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  };

  // ── VPN: generar script ────────────────────────────────────────────────────

  const handleGenerarVpn = async () => {
    if (!versionRos) {
      toast('Selecciona la versión RouterOS en el paso 1', { type: 'error' });
      return;
    }
    setVpnSubStep('generating');
    try {
      const result = await vpnApi.crear({
        nombre,
        ubicacion:        ubicacion   || undefined,
        descripcion:      descripcion || undefined,
        versionRos:       versionRos as VersionRos,
        usarCertificados: true,
      });
      setVpnCliente(result.cliente);
      setVpnScript(result.script);
      setVpnSubStep('script_ready');
    } catch (err) {
      toast(parseApiError(err), { type: 'error' });
      setVpnSubStep('init');
    }
  };

  // ── Test de conexión — maneja API directa y Túnel VPN ─────────────────────

  const handleTest = async () => {
    if (!usuario)  { toast('Ingresa el usuario del router',     { type: 'error' }); return; }
    if (!password) { toast('Ingresa la contraseña del router',  { type: 'error' }); return; }

    setTestStatus('testing');
    setTestResult(null);

    if (tipoConexion === 'vpn_tunnel') {
      // Para VPN: primero verificar túnel, luego probar API con la IP asignada
      if (!vpnCliente) {
        setTestResult({ exitoso: false, mensaje: 'Genera el script VPN primero y pégalo en el terminal del router.' });
        setTestStatus('error');
        return;
      }
      try {
        // 1. Verificar que el túnel esté establecido
        const vpnRes = await vpnApi.validarTunel(vpnCliente.id);
        if (!vpnRes.conectado) {
          setTestResult({
            exitoso: false,
            mensaje: 'Túnel VPN no establecido — el router no ha conectado al servidor VPN todavía. Pega el script en el terminal del MikroTik y espera unos segundos.',
          });
          setTestStatus('error');
          return;
        }

        // 2. Auto-rellenar IP VPN desde el túnel
        const ip = vpnRes.vpnIp || ipGestion;
        if (vpnRes.vpnIp) {
          setVpnIp(vpnRes.vpnIp);
          setIpGestion(vpnRes.vpnIp);
          queryClient.invalidateQueries({ queryKey: ['vpn-clientes'] });
        }
        if (!ip) {
          setTestResult({ exitoso: false, mensaje: 'El túnel conectó pero no se pudo obtener la IP asignada.' });
          setTestStatus('error');
          return;
        }

        // 3. Probar conexión API a través del túnel
        const result = await mikrotikApi.testConexionDirecta({
          ip,
          puerto:         puertoApi,
          usuario,
          password,
          metodoConexion: 'vpn_tunnel',
          versionRos:     (versionRos as any) || 'desconocida',
        });
        setTestResult(result);
        setTestStatus(result.exitoso ? 'ok' : 'error');
      } catch (err) {
        setTestResult({ exitoso: false, mensaje: parseApiError(err) });
        setTestStatus('error');
      }
      return;
    }

    // API directa
    if (!ipGestion) { toast('Ingresa la IP de gestión del router', { type: 'error' }); setTestStatus('idle'); return; }
    try {
      const result = await mikrotikApi.testConexionDirecta({
        ip:             ipGestion,
        puerto:         puertoApi,
        usuario,
        password,
        metodoConexion: 'api',
        versionRos:     (versionRos as any) || 'desconocida',
      });
      setTestResult(result);
      setTestStatus(result.exitoso ? 'ok' : 'error');
    } catch (err) {
      setTestResult({ exitoso: false, mensaje: parseApiError(err) });
      setTestStatus('error');
    }
  };

  // ── Navegación ─────────────────────────────────────────────────────────────

  const canProceedStep1 = nombre.trim().length > 0 && versionRos !== '';
  const canProceedStep2 = testStatus === 'ok';

  const goStep2 = () => {
    if (!nombre.trim()) { toast('El nombre del router es obligatorio', { type: 'error' }); return; }
    if (!versionRos)    { toast('Selecciona la versión de RouterOS',   { type: 'error' }); return; }
    setStep(2);
  };

  const goStep3 = () => {
    if (!canProceedStep2) {
      toast('Debes probar la conexión exitosamente antes de continuar', { type: 'error' });
      return;
    }
    setStep(3);
  };

  // ── Guardar ────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      const ip = tipoConexion === 'vpn_tunnel' ? vpnIp : ipGestion;
      await mikrotikApi.crear({
        nombre,
        ubicacion:            ubicacion   || undefined,
        descripcion:          descripcion || undefined,
        versionRos:           (versionRos as any) || 'desconocida',
        ipGestion:            ip,
        vpnIp:                tipoConexion === 'vpn_tunnel' ? vpnIp : undefined,
        usuario,
        password,
        puertoApi,
        metodoConexion:       tipoConexion === 'vpn_tunnel' ? 'vpn_tunnel' : 'api',
        tipoControl:          tipoControl          as any,
        tipoControlVelocidad: tipoControlVelocidad as any,
      });
      toast('Router registrado correctamente', { type: 'success' });
      setRouterGuardado(true);
      onSaved();
      onClose();
    } catch (err) {
      toast(parseApiError(err), { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[hsl(var(--sidebar-bg))] border border-white/10 rounded-xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Router className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-base">Agregar Router MikroTik</h2>
              <p className="text-xs text-gray-500">Paso {step} de 3 — {STEPS[step - 1].label}</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-gray-500 hover:text-white transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Indicadores de paso */}
        <div className="flex items-center px-6 pt-4 pb-1 flex-shrink-0">
          {STEPS.map((s, i) => (
            <div key={s.n} className="flex items-center flex-1">
              <div className={cn(
                'flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border-2 transition-colors flex-shrink-0',
                step > s.n   ? 'bg-primary border-primary text-white'      :
                step === s.n ? 'border-primary text-primary bg-primary/10' :
                               'border-white/20 text-gray-600',
              )}>
                {step > s.n ? <Check className="w-3.5 h-3.5" /> : s.n}
              </div>
              <span className={cn(
                'text-xs ml-1.5 hidden sm:block flex-shrink-0',
                step === s.n ? 'text-white' : 'text-gray-600',
              )}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={cn(
                  'flex-1 h-px mx-3 transition-colors',
                  step > s.n ? 'bg-primary/50' : 'bg-white/10',
                )} />
              )}
            </div>
          ))}
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Paso 1: Identificación ───────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 mb-2">
                Información básica del equipo y versión de RouterOS instalada.
              </p>

              <div>
                <label className={labelCls}>Nombre del router *</label>
                <input className={inputCls} value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej: Router Castilla Norte"
                  autoFocus />
              </div>

              <div>
                <label className={labelCls}>Ubicación física</label>
                <input className={inputCls} value={ubicacion}
                  onChange={(e) => setUbicacion(e.target.value)}
                  placeholder="Av. Sánchez Cerro 1234, Piura" />
              </div>

              <div>
                <label className={labelCls}>Descripción / notas</label>
                <textarea className={cn(inputCls, 'resize-none h-20')} value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Notas técnicas, observaciones…" />
              </div>

              <div>
                <label className={labelCls}>Versión de RouterOS *</label>
                <p className="text-xs text-gray-600 mb-2">
                  Necesaria para generar el script de configuración VPN correcto.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { val: 'v6' as const, label: 'RouterOS v6.x', sub: 'Legacy — CCR, RB, hAP (pre-2021)' },
                    { val: 'v7' as const, label: 'RouterOS v7.x', sub: 'Moderno — CHR, CCR2xxx, hEX S…'  },
                  ].map((o) => (
                    <label key={o.val}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                        versionRos === o.val
                          ? 'border-primary/60 bg-primary/10'
                          : 'border-white/10 hover:border-white/20 hover:bg-white/3',
                      )}
                    >
                      <input type="radio" name="versionRos" value={o.val}
                        checked={versionRos === o.val}
                        onChange={() => setVersionRos(o.val)}
                        className="mt-0.5 accent-primary" />
                      <div>
                        <div className={cn('text-sm font-medium', versionRos === o.val ? 'text-white' : 'text-gray-300')}>
                          {o.label}
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">{o.sub}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Paso 2: Conexión ─────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-5">
              <p className="text-xs text-gray-500">
                Configura cómo el sistema se conectará al router MikroTik.
              </p>

              {/* Tipo de conexión */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { val: 'api'        as const, label: 'API directa',     sub: 'IP local o pública + puerto API',             icon: Network },
                  { val: 'vpn_tunnel' as const, label: 'Túnel VPN + API', sub: 'Router sin IP pública — conecta via OpenVPN', icon: Shield  },
                ].map((o) => {
                  const Icon   = o.icon;
                  const active = tipoConexion === o.val;
                  return (
                    <label key={o.val}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                        active ? 'border-primary/60 bg-primary/10' : 'border-white/10 hover:border-white/20 hover:bg-white/3',
                      )}
                    >
                      <input type="radio" name="tipoConexion" value={o.val}
                        checked={active}
                        onChange={() => { setTipoConexion(o.val); resetTest(); }}
                        className="mt-0.5 accent-primary" />
                      <div>
                        <div className={cn('text-sm font-medium flex items-center gap-1.5', active ? 'text-white' : 'text-gray-300')}>
                          <Icon className="w-3.5 h-3.5" />
                          {o.label}
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">{o.sub}</div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Panel VPN: generar y mostrar script */}
              {tipoConexion === 'vpn_tunnel' && (
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
                  <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" />
                    Script de configuración OpenVPN
                  </p>

                  {vpnSubStep === 'init' && (
                    <>
                      <p className="text-xs text-blue-300/70">
                        El sistema generará un certificado y script único para este router.
                        Pégalo en <strong className="text-blue-200">New Terminal</strong> del MikroTik.
                      </p>
                      <button onClick={handleGenerarVpn}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600/80 hover:bg-blue-600 text-white rounded-lg transition-colors"
                      >
                        <Wifi className="w-4 h-4" />
                        Generar script VPN
                      </button>
                    </>
                  )}

                  {vpnSubStep === 'generating' && (
                    <div className="flex items-center gap-2 text-blue-300 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generando certificado y script…
                    </div>
                  )}

                  {vpnSubStep === 'script_ready' && vpnScript && (
                    <>
                      <p className="text-xs text-blue-300/70">
                        Copia el script y pégalo en <strong className="text-blue-200">New Terminal</strong> de tu MikroTik.
                        Descargará los certificados y creará la interfaz <code className="text-blue-100">vpndatafast</code> automáticamente.
                      </p>
                      <div className="relative">
                        <pre className="text-[10px] font-mono text-green-300 bg-black/40 rounded-lg p-3 overflow-x-auto max-h-40 leading-relaxed whitespace-pre-wrap break-all">
                          {vpnScript}
                        </pre>
                        <button onClick={copyScript}
                          className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-gray-400 hover:text-white transition-colors"
                          title="Copiar script"
                        >
                          {copied
                            ? <Check className="w-3.5 h-3.5 text-green-400" />
                            : <Copy className="w-3.5 h-3.5" />
                          }
                        </button>
                      </div>
                      <p className="text-xs text-blue-300/60">
                        Una vez pegado el script, verifica la conexión en el router ({'>'}
                        <strong className="text-blue-200"> IP › Addresses</strong>) y anota la IP de la interfaz
                        <strong className="text-blue-200"> ovpn-client</strong>.
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* Acceso al router — visible para ambos tipos de conexión */}
              <div className="space-y-3">
                <p className={sectionHdr}>
                  <Key className="w-3.5 h-3.5" />
                  Acceso al router
                </p>

                <div>
                  <label className={labelCls}>
                    {tipoConexion === 'vpn_tunnel'
                      ? 'IP de la interfaz OVPN Client'
                      : 'IP de gestión *'}
                  </label>
                  <input className={cn(inputCls, vpnIp && 'border-blue-400/30')}
                    value={ipGestion}
                    onChange={(e) => { setIpGestion(e.target.value); resetTest(); }}
                    placeholder={tipoConexion === 'vpn_tunnel' ? '10.8.1.X  (se rellena al probar)' : '192.168.100.1 o IP pública'}
                  />
                  {tipoConexion === 'vpn_tunnel' && (
                    <p className="text-xs text-gray-600 mt-1">
                      Encuéntrala en tu router: <strong className="text-gray-500">IP › Addresses</strong> o en el status de la interfaz <strong className="text-gray-500">ovpn-client</strong>.
                      Si no la conoces, déjala en blanco — se rellenará automáticamente al probar la conexión.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Usuario *</label>
                    <input className={inputCls} value={usuario}
                      onChange={(e) => { setUsuario(e.target.value); resetTest(); }}
                      placeholder="admin" />
                    <p className="text-xs text-gray-600 mt-1">Debe tener permisos completos (full).</p>
                  </div>
                  <div>
                    <label className={labelCls}>Contraseña *</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className={cn(inputCls, 'pr-9')}
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); resetTest(); }}
                        placeholder="Contraseña del router"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                        tabIndex={-1}
                      >
                        {showPassword
                          ? <EyeOff className="w-4 h-4" />
                          : <Eye    className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Puerto API</label>
                  <div className="flex items-center gap-3">
                    <input type="number" min={1} max={65535}
                      className={cn(inputCls, 'w-36')}
                      value={puertoApi}
                      onChange={(e) => { setPuertoApi(parseInt(e.target.value) || 8728); resetTest(); }} />
                    <span className="text-xs text-gray-600">
                      Por defecto: 8728. Si lo cambiaste en el router, actualízalo aquí también.
                    </span>
                  </div>
                </div>

                {/* Probar conexión */}
                <div className="rounded-xl border border-white/10 p-4 bg-white/3 space-y-3">
                  <p className={sectionHdr}>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Probar conexión
                  </p>
                  <p className="text-xs text-gray-600">
                    {tipoConexion === 'vpn_tunnel'
                      ? 'Verifica el túnel VPN y la conexión API en un solo paso. Si el túnel conectó, la IP se rellena automáticamente.'
                      : 'Comprueba la conectividad antes de continuar. Detecta la versión RouterOS automáticamente.'}
                  </p>

                  <button onClick={handleTest}
                    disabled={testStatus === 'testing'}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors border',
                      testStatus === 'ok'    ? 'bg-green-500/20 text-green-400 border-green-500/30'  :
                      testStatus === 'error' ? 'bg-red-500/20   text-red-400   border-red-500/30'    :
                                               'bg-white/10 text-white hover:bg-white/15 border-white/10',
                      testStatus === 'testing' && 'opacity-60 cursor-not-allowed',
                    )}
                  >
                    {testStatus === 'testing' ? <><Loader2      className="w-4 h-4 animate-spin" /> Probando…</>        :
                     testStatus === 'ok'       ? <><CheckCircle2 className="w-4 h-4" />             Conexión exitosa</> :
                     testStatus === 'error'    ? <><XCircle      className="w-4 h-4" />             Reintentar</>       :
                                                 <><RefreshCw    className="w-4 h-4" />             Probar conexión</>}
                  </button>

                  {testResult && (
                    <div className={cn(
                      'rounded-lg px-4 py-3 text-sm border',
                      testResult.exitoso
                        ? 'bg-green-500/10 border-green-500/20 text-green-300'
                        : 'bg-red-500/10   border-red-500/20   text-red-300',
                    )}>
                      <p className="font-medium">{testResult.mensaje}</p>
                      {testResult.exitoso && (
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-green-400/70">
                          {tipoConexion === 'vpn_tunnel' && vpnIp && (
                            <span className="flex items-center gap-1">
                              <Shield className="w-3 h-3 text-blue-400" />
                              IP VPN: <strong className="font-mono text-blue-300 ml-0.5">{vpnIp}</strong>
                            </span>
                          )}
                          {testResult.identityDetectada && (
                            <span>Identity: <strong className="text-green-300">{testResult.identityDetectada}</strong></span>
                          )}
                          {testResult.versionDetectada && (
                            <span>RouterOS: <strong className="text-green-300">{testResult.versionDetectada}</strong></span>
                          )}
                          {testResult.latenciaMs != null && (
                            <span>Latencia: <strong className="text-green-300">{testResult.latenciaMs}ms</strong></span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Paso 3: Control ──────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-6">
              <p className="text-xs text-gray-500">
                Define qué controles se aplicarán al provisionar clientes en este router.
                No tienen efecto inmediato — se activan al agregar un cliente nuevo.
              </p>

              {/* Control de seguridad */}
              <div>
                <label className={labelCls}>
                  <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Control de seguridad IP-MAC</span>
                </label>
                <select
                  value={tipoControl}
                  onChange={(e) => setTipoControl(e.target.value)}
                  className={inputCls}
                >
                  {SECURITY_OPTS.map((o) => (
                    <option key={o.val} value={o.val}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Control de velocidad */}
              <div>
                <label className={labelCls}>
                  <span className="flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" /> Control de velocidad</span>
                </label>
                <select
                  value={tipoControlVelocidad}
                  onChange={(e) => setTipoControlVelocidad(e.target.value)}
                  className={inputCls}
                >
                  {SPEED_OPTS.map((o) => (
                    <option key={o.val} value={o.val}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Resumen */}
              <div className="bg-white/3 rounded-xl border border-white/10 p-4 space-y-1.5 text-xs text-gray-400">
                <p className="text-white font-medium text-sm mb-2">{nombre}</p>
                {ubicacion && <p><span className="text-gray-600">Ubicación: </span>{ubicacion}</p>}
                <p><span className="text-gray-600">RouterOS: </span>{versionRos.toUpperCase()}</p>
                <p>
                  <span className="text-gray-600">Conexión: </span>
                  {tipoConexion === 'vpn_tunnel'
                    ? <span>Túnel VPN — <span className="font-mono text-blue-300">{vpnIp || ipGestion}</span></span>
                    : <span>API directa — <span className="font-mono">{ipGestion}</span></span>
                  }
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 flex-shrink-0">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep((s) => (s - 1) as Step)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Anterior
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
              Cancelar
            </button>
            {step === 1 && (
              <button onClick={goStep2} disabled={!canProceedStep1}
                className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-40 transition-colors"
              >
                Siguiente <ChevronRight className="w-4 h-4" />
              </button>
            )}
            {step === 2 && (
              <button onClick={goStep3} disabled={!canProceedStep2}
                className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-40 transition-colors"
              >
                Siguiente <ChevronRight className="w-4 h-4" />
              </button>
            )}
            {step === 3 && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Registrar router
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
