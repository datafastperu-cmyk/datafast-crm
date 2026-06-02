'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Router, X, ChevronRight, ChevronLeft, Network, Shield, CheckCircle2,
  XCircle, Loader2, Copy, Check, RefreshCw, Wifi, Key, Gauge, Eye, EyeOff, Settings,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { mikrotikApi }              from '@/lib/api/mikrotik';
import { vpnApi }                   from '@/lib/api/vpn';
import { getAccessToken }           from '@/lib/api';
import { useToast }     from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import type { TestConexionResult } from '@/lib/api/mikrotik';
import type { VpnCliente, VersionRos } from '@/lib/api/vpn';

// ─── Opciones ─────────────────────────────────────────────────────────────────

const SECURITY_OPTS = [
  { val: 'pppoe_addresslist',  label: 'PPPoE/AddressList'           },
  { val: 'amarre_ip_mac',      label: 'Amarre IP/MAC'               },
  { val: 'amarre_ip_mac_dhcp', label: 'Amarre IP/MAC + DHCP Leases' },
  { val: 'ninguna',            label: 'Ninguno'                     },
] as const;

const SPEED_OPTS = [
  { val: 'colas_simples',     label: 'Colas Simples'                          },
  { val: 'pcq_addresslist',   label: 'PCQ + AddressList'                      },
  { val: 'dhcp_lease_queues', label: 'DHCP Leases (Colas Simples Dinámicas)'  },
  { val: 'ninguno',           label: 'Ninguno'                                },
] as const;

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Step         = 1 | 2 | 3;
type TipoConexion = 'api' | 'vpn_tunnel' | 'api_ssl' | 'ssh' | 'snmp';
type VpnSubStep   = 'init' | 'generating' | 'script_ready';
type TestStatus   = 'idle' | 'testing' | 'ok' | 'error';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const inputCls   = 'w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors';
const labelCls   = 'text-xs font-medium text-muted-foreground block mb-1';
const sectionHdr = 'text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-3';

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

  // Paso 2 — avanzado
  const [puertoApiSsl, setPuertoApiSsl] = useState(8729);
  const [puertoSsh,    setPuertoSsh]    = useState(22);
  const [usarSsl,      setUsarSsl]      = useState(false);

  // Test de conexión
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testResult, setTestResult] = useState<TestConexionResult | null>(null);

  // Paso 3
  const [tipoControl,          setTipoControl]          = useState('amarre_ip_mac');
  const [tipoControlVelocidad, setTipoControlVelocidad] = useState('colas_simples');

  const [saving,         setSaving]         = useState(false);
  const [routerGuardado, setRouterGuardado] = useState(false);

  // Refs para cleanup en navegación / cierre de ventana
  const vpnClienteRef    = useRef<VpnCliente | null>(null);
  const tokenDescargaRef = useRef<string | null>(null);
  const routerGuardadoRef = useRef(false);
  const revokedRef       = useRef(false);
  const vpnConnectedRef  = useRef(false);  // true una vez que el túnel está activo — no revocar en cleanup
  useEffect(() => { vpnClienteRef.current = vpnCliente; }, [vpnCliente]);
  useEffect(() => { routerGuardadoRef.current = routerGuardado; }, [routerGuardado]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const resetTest = () => { setTestStatus('idle'); setTestResult(null); };

  // Revocación fire-and-forget compatible con cierre de pestaña (keepalive).
  // Si no hay JWT activo, usa tokenDescarga (endpoint público revoke-by-token).
  const fireRevoke = (id: string) => {
    if (revokedRef.current) return;
    if (vpnConnectedRef.current) return;  // túnel activo — el cron de cleanup lo gestionará si el wizard se abandona
    revokedRef.current = true;
    sessionStorage.removeItem('vpn_pending_token');
    const base  = process.env.NEXT_PUBLIC_API_URL ?? '';
    const jwt   = getAccessToken();
    if (jwt) {
      fetch(`${base}/api/v1/openvpn/mikrotik-clients/${id}`, {
        method:    'DELETE',
        headers:   { Authorization: `Bearer ${jwt}` },
        keepalive: true,
      }).catch(() => {});
    } else {
      // Sesión expirada — usar tokenDescarga sin JWT
      const td = tokenDescargaRef.current;
      if (td) {
        fetch(`${base}/api/v1/openvpn/mikrotik-clients/revoke-by-token`, {
          method:    'POST',
          headers:   { 'Content-Type': 'application/json' },
          body:      JSON.stringify({ tokenDescarga: td }),
          keepalive: true,
        }).catch(() => {});
      }
    }
  };

  // Revocar al navegar a otra sección (unmount del componente)
  useEffect(() => {
    return () => {
      if (vpnClienteRef.current && !routerGuardadoRef.current) {
        fireRevoke(vpnClienteRef.current.id);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Advertir antes de cerrar/actualizar si hay VPN pendiente (no revocar aquí).
  // No bloqueamos si el interceptor de auth está redirigiendo al login.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if ((window as any).__authRedirecting) return;
      if (vpnClienteRef.current && !routerGuardadoRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Revocar cuando el usuario confirma que se va (pagehide ocurre después de la confirmación)
  useEffect(() => {
    const onPageHide = () => {
      if (vpnClienteRef.current && !routerGuardadoRef.current) {
        fireRevoke(vpnClienteRef.current.id);
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    if (vpnCliente && !routerGuardado) {
      fireRevoke(vpnCliente.id);
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
      tokenDescargaRef.current = result.cliente.tokenDescarga;
      sessionStorage.setItem('vpn_pending_token', result.cliente.tokenDescarga);
      setVpnSubStep('script_ready');
    } catch (err) {
      toast(parseApiError(err), { type: 'error' });
      setVpnSubStep('init');
    }
  };

  // ── Test de conexión — maneja API directa y Túnel VPN ─────────────────────

  const handleTest = async () => {
    const necesitaCredenciales = tipoConexion !== 'snmp';
    if (necesitaCredenciales && !usuario)  { toast('Ingresa el usuario del router',    { type: 'error' }); return; }
    if (necesitaCredenciales && !password) { toast('Ingresa la contraseña del router', { type: 'error' }); return; }

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
        vpnConnectedRef.current = true;
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

    // API directa / Avanzado
    if (!ipGestion) { toast('Ingresa la IP de gestión del router', { type: 'error' }); setTestStatus('idle'); return; }
    const testPort =
      tipoConexion === 'api_ssl' ? puertoApiSsl :
      tipoConexion === 'ssh'     ? puertoSsh    :
      tipoConexion === 'snmp'    ? 161          : puertoApi;
    try {
      const result = await mikrotikApi.testConexionDirecta({
        ip:             ipGestion,
        puerto:         testPort,
        usuario,
        password,
        metodoConexion: tipoConexion,
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
        puertoApi:            tipoConexion === 'api_ssl' ? puertoApiSsl : tipoConexion === 'ssh' ? puertoSsh : puertoApi,
        puertoApiSsl,
        puertoSsh,
        usarSsl:              tipoConexion === 'api_ssl' ? usarSsl : false,
        metodoConexion:       tipoConexion,
        tipoControl:          tipoControl          as any,
        tipoControlVelocidad: tipoControlVelocidad as any,
        vpnClienteId:         tipoConexion === 'vpn_tunnel' ? vpnCliente?.id : undefined,
      });
      toast('Router registrado correctamente', { type: 'success' });
      sessionStorage.removeItem('vpn_pending_token');
      setRouterGuardado(true);
      routerGuardadoRef.current = true;
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
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Router className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground text-base">Agregar Router MikroTik</h2>
              <p className="text-xs text-muted-foreground">Paso {step} de 3 — {STEPS[step - 1].label}</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
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
                               'border-muted-foreground/30 text-muted-foreground',
              )}>
                {step > s.n ? <Check className="w-3.5 h-3.5" /> : s.n}
              </div>
              <span className={cn(
                'text-xs ml-1.5 hidden sm:block flex-shrink-0',
                step === s.n ? 'text-foreground' : 'text-muted-foreground',
              )}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={cn(
                  'flex-1 h-px mx-3 transition-colors',
                  step > s.n ? 'bg-primary/50' : 'bg-muted',
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
              <p className="text-xs text-muted-foreground mb-2">
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
                <p className="text-xs text-muted-foreground mb-2">
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
                          : 'border-border hover:border-muted-foreground/30 hover:bg-muted/20',
                      )}
                    >
                      <input type="radio" name="versionRos" value={o.val}
                        checked={versionRos === o.val}
                        onChange={() => setVersionRos(o.val)}
                        className="mt-0.5 accent-primary" />
                      <div>
                        <div className={cn('text-sm font-medium', versionRos === o.val ? 'text-foreground' : 'text-foreground')}>
                          {o.label}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{o.sub}</div>
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
              <p className="text-xs text-muted-foreground">
                Configura cómo el sistema se conectará al router MikroTik.
              </p>

              {/* Tipo de conexión */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { val: 'api'        as TipoConexion, label: 'API directa',     sub: 'IP local o pública + puerto API',             icon: Network },
                    { val: 'vpn_tunnel' as TipoConexion, label: 'Túnel VPN + API', sub: 'Router sin IP pública — conecta via OpenVPN', icon: Shield  },
                  ]).map((o) => {
                    const Icon   = o.icon;
                    const active = tipoConexion === o.val;
                    return (
                      <label key={o.val}
                        className={cn(
                          'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                          active ? 'border-primary/60 bg-primary/10' : 'border-border hover:border-muted-foreground/30 hover:bg-muted/20',
                        )}
                      >
                        <input type="radio" name="tipoConexion" value={o.val}
                          checked={active}
                          onChange={() => { setTipoConexion(o.val); resetTest(); }}
                          className="mt-0.5 accent-primary" />
                        <div>
                          <div className={cn('text-sm font-medium flex items-center gap-1.5', active ? 'text-foreground' : 'text-foreground')}>
                            <Icon className="w-3.5 h-3.5" />
                            {o.label}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">{o.sub}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Card Avanzado: SSH / SNMP / API-SSL */}
                {(() => {
                  const isAvanzado = (['api_ssl', 'ssh', 'snmp'] as TipoConexion[]).includes(tipoConexion);
                  return (
                    <div className={cn(
                      'rounded-lg border transition-colors',
                      isAvanzado ? 'border-primary/60 bg-primary/10' : 'border-border hover:border-muted-foreground/30 hover:bg-muted/20',
                    )}>
                      <div className="flex items-center gap-3 p-3 cursor-pointer"
                        onClick={() => { if (!isAvanzado) { setTipoConexion('api_ssl'); resetTest(); } }}>
                        <div className={cn(
                          'w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors',
                          isAvanzado ? 'border-primary bg-primary' : 'border-muted-foreground/30',
                        )} />
                        <div className="flex-1">
                          <div className={cn('text-sm font-medium flex items-center gap-1.5', isAvanzado ? 'text-foreground' : 'text-foreground')}>
                            <Settings className="w-3.5 h-3.5" />
                            Avanzado
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">SSH · SNMP · API-SSL</div>
                        </div>
                      </div>

                      {isAvanzado && (
                        <div className="px-3 pb-3 space-y-3">
                          <div className="grid grid-cols-3 gap-2">
                            {([
                              { val: 'api_ssl' as TipoConexion, label: 'API-SSL', desc: 'Puerto 8729' },
                              { val: 'ssh'     as TipoConexion, label: 'SSH',     desc: 'Puerto 22'   },
                              { val: 'snmp'    as TipoConexion, label: 'SNMP',    desc: 'Puerto 161'  },
                            ]).map((o) => (
                              <label key={o.val}
                                className={cn(
                                  'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-colors',
                                  tipoConexion === o.val
                                    ? 'border-primary/50 bg-primary/15 text-foreground'
                                    : 'border-border text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
                                )}
                              >
                                <input type="radio" name="tipoConexion" value={o.val}
                                  checked={tipoConexion === o.val}
                                  onChange={() => { setTipoConexion(o.val); resetTest(); }}
                                  className="accent-primary" />
                                <div>
                                  <div className="font-medium">{o.label}</div>
                                  <div className="text-muted-foreground mt-0.5">{o.desc}</div>
                                </div>
                              </label>
                            ))}
                          </div>
                          <div className="flex items-end gap-3">
                            <div>
                              <label className={labelCls}>
                                {tipoConexion === 'api_ssl' ? 'Puerto API-SSL' :
                                 tipoConexion === 'ssh'     ? 'Puerto SSH'     : 'Puerto SNMP'}
                              </label>
                              <input type="number" min={1} max={65535}
                                className={cn(inputCls, 'w-36')}
                                value={
                                  tipoConexion === 'api_ssl' ? puertoApiSsl :
                                  tipoConexion === 'ssh'     ? puertoSsh    : 161
                                }
                                onChange={(e) => {
                                  const v = parseInt(e.target.value);
                                  if (tipoConexion === 'api_ssl') { setPuertoApiSsl(v || 8729); resetTest(); }
                                  else if (tipoConexion === 'ssh') { setPuertoSsh(v || 22); resetTest(); }
                                }}
                              />
                            </div>
                            {tipoConexion === 'api_ssl' && (
                              <label className="flex items-center gap-1.5 cursor-pointer select-none pb-2">
                                <input type="checkbox" checked={usarSsl}
                                  onChange={(e) => { setUsarSsl(e.target.checked); resetTest(); }}
                                  className="accent-primary w-4 h-4" />
                                <span className="text-sm text-foreground">Usar TLS / SSL</span>
                              </label>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
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
                        <pre className="text-[10px] font-mono text-green-700 dark:text-green-300 bg-muted/50 dark:bg-black/40 rounded-lg p-3 overflow-x-auto max-h-40 leading-relaxed whitespace-pre-wrap break-all">
                          {vpnScript}
                        </pre>
                        <button onClick={copyScript}
                          className="absolute top-2 right-2 p-1.5 rounded-md bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors"
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
                    <p className="text-xs text-muted-foreground mt-1">
                      Encuéntrala en tu router: <strong className="text-muted-foreground">IP › Addresses</strong> o en el status de la interfaz <strong className="text-muted-foreground">ovpn-client</strong>.
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
                    <p className="text-xs text-muted-foreground mt-1">Debe tener permisos completos (full).</p>
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
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showPassword
                          ? <EyeOff className="w-4 h-4" />
                          : <Eye    className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {!(['api_ssl', 'ssh', 'snmp'] as TipoConexion[]).includes(tipoConexion) && (
                  <div>
                    <label className={labelCls}>Puerto API</label>
                    <div className="flex items-center gap-3">
                      <input type="number" min={1} max={65535}
                        className={cn(inputCls, 'w-36')}
                        value={puertoApi}
                        onChange={(e) => { setPuertoApi(parseInt(e.target.value) || 8728); resetTest(); }} />
                      <span className="text-xs text-muted-foreground">
                        Por defecto: 8728. Si lo cambiaste en el router, actualízalo aquí también.
                      </span>
                    </div>
                  </div>
                )}

                {/* Probar conexión */}
                <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-3">
                  <p className={sectionHdr}>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Probar conexión
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tipoConexion === 'vpn_tunnel'
                      ? 'Verifica el túnel VPN y la conexión API en un solo paso. Si el túnel conectó, la IP se rellena automáticamente.'
                      : (['api_ssl', 'ssh', 'snmp'] as TipoConexion[]).includes(tipoConexion)
                      ? 'Comprueba la conectividad con el método seleccionado antes de continuar.'
                      : 'Comprueba la conectividad antes de continuar. Detecta la versión RouterOS automáticamente.'}
                  </p>

                  <button onClick={handleTest}
                    disabled={testStatus === 'testing'}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors border',
                      testStatus === 'ok'    ? 'bg-green-500/20 text-green-400 border-green-500/30'  :
                      testStatus === 'error' ? 'bg-red-500/20   text-red-400   border-red-500/30'    :
                                               'bg-muted text-foreground hover:bg-muted/70 border-border',
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
              <p className="text-xs text-muted-foreground">
                Define qué controles se aplicarán al provisionar clientes en este router.
                No tienen efecto inmediato — se activan al agregar un cliente nuevo.
              </p>

              {/* Control de seguridad */}
              <div>
                <label className={labelCls}>
                  <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Autenticación y Control Abonado</span>
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
              <div className="bg-muted/20 rounded-xl border border-border p-4 space-y-1.5 text-xs text-muted-foreground">
                <p className="text-foreground font-medium text-sm mb-2">{nombre}</p>
                {ubicacion && <p><span className="text-muted-foreground">Ubicación: </span>{ubicacion}</p>}
                <p><span className="text-muted-foreground">RouterOS: </span>{versionRos.toUpperCase()}</p>
                <p>
                  <span className="text-muted-foreground">Conexión: </span>
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
        <div className="flex items-center justify-between px-6 py-4 border-t border-border flex-shrink-0">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep((s) => (s - 1) as Step)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Anterior
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
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
