'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Router, Plus, Pencil, Trash2, Wifi, WifiOff,
  RefreshCw, CheckCircle2, XCircle, Loader2, AlertTriangle,
  Lock, Shield, Network, Terminal, Radio,
  Key, Settings, ChevronRight, Activity, Cpu, MemoryStick,
  Copy, Check, Users, FileCode, Globe, Eye, EyeOff,
} from 'lucide-react';

import { mikrotikApi } from '@/lib/api/mikrotik';
import { useToast }    from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import type {
  Router as RouterType, CreateRouterDto,
  MetodoConexion, TestConexionResult, TipoControl, TipoControlVelocidad,
} from '@/lib/api/mikrotik';
import { AgregarRouterWizard } from './AgregarRouterWizard';
import { vpnApi } from '@/lib/api/vpn';

// ─── Constantes de UI ─────────────────────────────────────────────

const METODO_CONFIG: Record<MetodoConexion, {
  label: string; icon: any; desc: string;
  defaultPort: number; defaultSsl: boolean;
}> = {
  api:        { label: 'API',        icon: Network,  desc: 'RouterOS API estándar (puerto 8728)',         defaultPort: 8728, defaultSsl: false },
  api_ssl:    { label: 'API-SSL',    icon: Lock,     desc: 'API cifrada con TLS (puerto 8729)',            defaultPort: 8729, defaultSsl: true  },
  ssh:        { label: 'SSH',        icon: Terminal, desc: 'Acceso por SSH — verificación TCP',            defaultPort: 22,   defaultSsl: false },
  snmp:       { label: 'SNMP',       icon: Radio,    desc: 'Solo monitoreo SNMP — verificación TCP',       defaultPort: 161,  defaultSsl: false },
  vpn_tunnel: { label: 'VPN Tunnel', icon: Shield,   desc: 'Conecta a través de VPN usando IP VPN + API', defaultPort: 8728, defaultSsl: false },
};

const TIPO_CONTROL_OPTS = [
  { val: 'pppoe_addresslist',  label: 'PPPoE/AddressList'           },
  { val: 'amarre_ip_mac',      label: 'Amarre IP/MAC'               },
  { val: 'amarre_ip_mac_dhcp', label: 'Amarre IP/MAC + DHCP Leases' },
  { val: 'ninguna',            label: 'Ninguno'                     },
];

const TIPO_VELOCIDAD_OPTS = [
  { val: 'colas_simples',     label: 'Colas Simples'                         },
  { val: 'pcq_addresslist',   label: 'PCQ + AddressList'                     },
  { val: 'dhcp_lease_queues', label: 'DHCP Leases (Colas Simples Dinámicas)' },
  { val: 'ninguno',           label: 'Ninguno'                               },
];

const ESTADO_COLORS: Record<string, string> = {
  online:        'text-green-400',
  offline:       'text-red-400',
  degradado:     'text-yellow-400',
  mantenimiento: 'text-orange-400',
  desconocido:   'text-gray-500',
};

const VERSION_ROS_OPTS = [
  { val: 'v6', label: 'RouterOS v6.x', sub: 'Legacy — CCR, RB, hAP (pre-2021)' },
  { val: 'v7', label: 'RouterOS v7.x', sub: 'Moderno — CHR, CCR2xxx, hEX S…'  },
];

// ─── Helpers ──────────────────────────────────────────────────────

const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-primary/50 transition-colors';
const labelCls = 'text-xs text-gray-400 mb-1 block';
const sectionHdr = 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2';

// ─── Script de Conexión Dialog ────────────────────────────────────

function ScriptConexionDialog({ router, onClose }: { router: RouterType; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const { data: script, isLoading, isError } = useQuery({
    queryKey: ['vpn-script', router.id],
    queryFn:  () => vpnApi.getScriptByRouterId(router.id),
    retry: false,
  });

  const doCopy = async () => {
    if (!script) return;
    try { await navigator.clipboard.writeText(script); }
    catch { const t = document.createElement('textarea'); t.value = script; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[hsl(var(--sidebar-bg))] border border-white/10 rounded-xl w-full max-w-2xl flex flex-col shadow-2xl max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <FileCode className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-base">Script de configuración OpenVPN</h2>
              <p className="text-xs text-gray-500">{router.nombre} — {router.vpnIp || router.ipGestion}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {isLoading && (
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Cargando script…
            </div>
          )}

          {isError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2">
              <XCircle className="w-4 h-4 flex-shrink-0" />
              No se encontró el script VPN para este router. Es posible que el cliente VPN haya sido revocado.
            </div>
          )}

          {script && (
            <>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300 flex gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p>
                  Copia el script y pégalo en <strong>WinBox → New Terminal</strong> del router.
                  Descargará los certificados y creará la interfaz <code className="bg-black/30 px-1 rounded">vpndatafast</code> automáticamente.
                </p>
              </div>

              <div className="bg-black/40 border border-white/10 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/3">
                  <span className="text-xs text-gray-400 font-mono">RouterOS Terminal</span>
                  <button onClick={doCopy}
                    className={cn(
                      'flex items-center gap-1.5 text-xs px-3 py-1 rounded-md transition-colors',
                      copied ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-gray-300 hover:bg-white/15'
                    )}
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copiado' : 'Copiar script'}
                  </button>
                </div>
                <pre className="text-[10px] text-green-300 font-mono p-4 overflow-x-auto max-h-64 leading-relaxed whitespace-pre-wrap break-all">
                  {script}
                </pre>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sincronizar Morosos Dialog ───────────────────────────────────

function MorososDialog({ router, onClose }: { router: RouterType; onClose: () => void }) {
  const { data: morosos = [], isLoading } = useQuery({
    queryKey: ['morosos', router.id],
    queryFn:  () => mikrotikApi.getMorosos(router.id),
    staleTime: 30_000,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[hsl(var(--sidebar-bg))] border border-white/10 rounded-xl w-full max-w-lg flex flex-col shadow-2xl max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center">
              <Users className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-base">Morosos en MikroTik</h2>
              <p className="text-xs text-gray-500">{router.nombre} — address-list <code className="text-gray-400">morosos_datafast</code></p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : morosos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-center">
              <CheckCircle2 className="w-8 h-8 mb-2 text-emerald-400 opacity-60" />
              <p className="text-sm">Sin IPs en address-list morosos</p>
              <p className="text-xs mt-1 opacity-60">Todos los abonados tienen acceso libre en este router</p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-gray-500 px-2 mb-2">
                <span>{morosos.length} IP{morosos.length !== 1 ? 's' : ''} bloqueada{morosos.length !== 1 ? 's' : ''}</span>
                <span className="text-red-400 font-medium">morosos_datafast</span>
              </div>
              {morosos.map((m, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/3 border border-white/8 hover:bg-white/5 transition-colors">
                  <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono text-white">{m.ip}</p>
                    {m.comment && <p className="text-xs text-gray-500 truncate">{m.comment}</p>}
                  </div>
                  {m.addedAt && (
                    <p className="text-xs text-gray-600 flex-shrink-0">{m.addedAt}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Agregar / Editar Router ────────────────────────────────

type ModalTab = 'ident' | 'conn' | 'config';

interface RouterModalProps {
  router?: RouterType | null;
  onClose: () => void;
  onSaved: () => void;
}

function RouterModal({ router, onClose, onSaved }: RouterModalProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<ModalTab>('ident');
  const [saving, setSaving] = useState(false);

  // ─── Estado del test de conexión ──────────────────────────
  type TestStatus = 'idle' | 'testing' | 'ok' | 'error';
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testResult, setTestResult] = useState<TestConexionResult | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showScript,   setShowScript]   = useState(false);

  // ─── Formulario ───────────────────────────────────────────
  const [form, setForm] = useState<CreateRouterDto & { password: string }>({
    nombre:          router?.nombre          ?? '',
    descripcion:     router?.descripcion     ?? '',
    ubicacion:       router?.ubicacion       ?? '',
    modelo:          router?.modelo          ?? '',
    zona:            router?.zona            ?? '',
    ipGestion:       router?.ipGestion       ?? '',
    vpnIp:           router?.vpnIp           ?? '',
    puertoApi:       router?.puertoApi       ?? 8728,
    puertoApiSsl:    router?.puertoApiSsl    ?? 8729,
    puertoSsh:       router?.puertoSsh       ?? 22,
    usuario:         router?.usuario         ?? 'admin',
    password:        '',
    metodoConexion:  (router?.metodoConexion as MetodoConexion) ?? 'api',
    usarSsl:         router?.usarSsl         ?? false,
    timeoutConexion: router?.timeoutConexion  ?? 10,
    reintentos:      router?.reintentos       ?? 3,
    versionRos:      router?.versionRos      ?? 'desconocida',
    tipoControl:            router?.tipoControl            ?? 'ninguna',
    tipoControlVelocidad:   router?.tipoControlVelocidad   ?? 'ninguno',
    autoConfigurarQueues:   router?.autoConfigurarQueues   ?? true,
    autoConfigurarPppoe:    router?.autoConfigurarPppoe    ?? true,
    autoConfigurarFirewall: router?.autoConfigurarFirewall ?? true,
    snmpCommunity:   router?.snmpCommunity ?? 'public',
  });

  const set = (key: keyof typeof form, val: any) => {
    setForm((f) => ({ ...f, [key]: val }));
    setTestStatus('idle');
    setTestResult(null);
  };

  // Cambiar tipo de conexión → sugerir puerto y SSL
  const handleMetodoChange = (metodo: MetodoConexion) => {
    const cfg = METODO_CONFIG[metodo];
    setForm((f) => ({
      ...f,
      metodoConexion: metodo,
      usarSsl:        cfg.defaultSsl,
      puertoApi:      metodo === 'api'     ? cfg.defaultPort : f.puertoApi,
      puertoApiSsl:   metodo === 'api_ssl' ? cfg.defaultPort : f.puertoApiSsl,
      puertoSsh:      metodo === 'ssh'     ? cfg.defaultPort : f.puertoSsh,
    }));
    setTestStatus('idle');
    setTestResult(null);
  };

  // ─── Test de conexión pre-guardado ────────────────────────
  const handleTest = async () => {
    const isVpn   = form.metodoConexion === 'vpn_tunnel';
    const testIp  = isVpn ? form.vpnIp : form.ipGestion;
    const testPort =
      form.metodoConexion === 'api_ssl' ? (form.puertoApiSsl ?? 8729) :
      form.metodoConexion === 'ssh'     ? (form.puertoSsh    ?? 22)   :
      form.metodoConexion === 'snmp'    ? 161                          :
      (form.puertoApi ?? 8728);

    if (!testIp) {
      toast(isVpn ? 'Ingresa la IP VPN para probar' : 'Ingresa la IP de gestión para probar', { type: 'error' });
      return;
    }
    if (!form.usuario) {
      toast('Ingresa el usuario para probar la conexión', { type: 'error' });
      return;
    }
    if (!form.password && !router) {
      toast('Ingresa la contraseña para probar la conexión', { type: 'error' });
      return;
    }

    setTestStatus('testing');
    setTestResult(null);

    try {
      const result = await mikrotikApi.testConexionDirecta({
        ip:              testIp!,
        puerto:          testPort,
        usuario:         form.usuario,
        password:        form.password || '***stored***',
        usarSsl:         form.usarSsl ?? false,
        timeoutConexion: form.timeoutConexion ?? 10,
        metodoConexion:  form.metodoConexion,
        versionRos:      form.versionRos,
      });
      setTestResult(result);
      setTestStatus(result.exitoso ? 'ok' : 'error');
      // Auto-rellenar versión detectada
      if (result.exitoso && result.rosVersion && result.rosVersion !== 'desconocida') {
        setForm((f) => ({ ...f, versionRos: result.rosVersion as any }));
      }
    } catch (err) {
      setTestResult({ exitoso: false, mensaje: parseApiError(err) });
      setTestStatus('error');
    }
  };

  // ─── Guardar ──────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.nombre.trim()) { setTab('ident'); toast('El nombre es obligatorio', { type: 'error' }); return; }
    if (!form.ipGestion.trim()) { setTab('conn'); toast('La IP de gestión es obligatoria', { type: 'error' }); return; }
    if (!form.usuario.trim()) { setTab('conn'); toast('El usuario es obligatorio', { type: 'error' }); return; }
    if (!router && !form.password) { setTab('conn'); toast('La contraseña es obligatoria al crear un router', { type: 'error' }); return; }

    setSaving(true);
    try {
      const dto = { ...form };
      if (router && !dto.password) delete (dto as any).password;

      if (router) {
        await mikrotikApi.actualizar(router.id, dto);
        toast('Router actualizado correctamente', { type: 'success' });
      } else {
        await mikrotikApi.crear(dto);
        toast('Router registrado correctamente', { type: 'success' });
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(parseApiError(err), { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // ─── Render por pestaña ───────────────────────────────────
  const tabs: { id: ModalTab; label: string; icon: any }[] = [
    { id: 'ident', label: 'Identificación', icon: Settings },
    { id: 'conn',  label: 'Conexión',        icon: Network  },
    { id: 'config', label: 'Configuración',  icon: Cpu      },
  ];

  return (<>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-[hsl(var(--sidebar-bg))] border border-white/10 rounded-xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Router className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-base">
                {router ? 'Editar Router' : 'Agregar Router MikroTik'}
              </h2>
              <p className="text-xs text-gray-500">
                {router ? router.nombre : 'Configura la conexión al equipo'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 flex-shrink-0">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors',
                  tab === t.id
                    ? 'bg-primary/15 text-primary'
                    : 'text-gray-400 hover:text-white hover:bg-white/5',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── TAB: Identificación ─────────────────────────── */}
          {tab === 'ident' && (
            <div className="space-y-4">
              <p className={sectionHdr}>
                <Settings className="w-3.5 h-3.5" />
                Datos del equipo
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>Nombre del router *</label>
                  <input className={inputCls} value={form.nombre}
                    onChange={(e) => set('nombre', e.target.value)}
                    placeholder="Ej: Router Castilla Norte" />
                </div>
                <div>
                  <label className={labelCls}>Modelo</label>
                  <input className={inputCls} value={form.modelo ?? ''}
                    onChange={(e) => set('modelo', e.target.value)}
                    placeholder="CCR1036, hAP ac3, RB4011…" />
                </div>
                <div>
                  <label className={labelCls}>Zona / Sector</label>
                  <input className={inputCls} value={form.zona ?? ''}
                    onChange={(e) => set('zona', e.target.value)}
                    placeholder="Norte, Sur, Sector A…" />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Ubicación física</label>
                  <input className={inputCls} value={form.ubicacion ?? ''}
                    onChange={(e) => set('ubicacion', e.target.value)}
                    placeholder="Av. Sánchez Cerro 1234, Piura" />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Descripción</label>
                  <textarea
                    className={cn(inputCls, 'resize-none h-20')}
                    value={form.descripcion ?? ''}
                    onChange={(e) => set('descripcion', e.target.value)}
                    placeholder="Descripción, notas técnicas, observaciones…"
                  />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Versión RouterOS</label>
                  <div className="grid grid-cols-2 gap-2">
                    {VERSION_ROS_OPTS.map((o) => (
                      <label key={o.val}
                        className={cn(
                          'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                          form.versionRos === o.val
                            ? 'border-primary/60 bg-primary/10'
                            : 'border-white/10 hover:border-white/20 hover:bg-white/3',
                        )}
                      >
                        <input type="radio" name="versionRos" value={o.val}
                          checked={form.versionRos === o.val}
                          onChange={() => set('versionRos', o.val)}
                          className="mt-0.5 accent-primary" />
                        <div>
                          <div className={cn('text-sm font-medium', form.versionRos === o.val ? 'text-white' : 'text-gray-300')}>
                            {o.label}
                          </div>
                          <div className="text-xs text-gray-600 mt-0.5">{o.sub}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: Conexión ───────────────────────────────── */}
          {tab === 'conn' && (
            <div className="space-y-5">
              <p className="text-xs text-gray-500">
                Configura cómo el sistema se conectará al router MikroTik.
              </p>

              {/* Tipo de conexión */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { val: 'api'        as MetodoConexion, label: 'API directa',     sub: 'IP local o pública + puerto API',             icon: Network },
                    { val: 'vpn_tunnel' as MetodoConexion, label: 'Túnel VPN + API', sub: 'Router sin IP pública — conecta via OpenVPN', icon: Shield  },
                  ] as const).map((o) => {
                    const Icon   = o.icon;
                    const active = form.metodoConexion === o.val;
                    return (
                      <label key={o.val}
                        className={cn(
                          'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                          active ? 'border-primary/60 bg-primary/10' : 'border-white/10 hover:border-white/20 hover:bg-white/3',
                        )}
                      >
                        <input type="radio" name="metodo" value={o.val}
                          checked={active} onChange={() => handleMetodoChange(o.val)}
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

                {/* Card Avanzado: SSH / SNMP / API-SSL */}
                {(() => {
                  const isAvanzado = (['ssh', 'snmp', 'api_ssl'] as string[]).includes(form.metodoConexion);
                  return (
                    <div className={cn(
                      'rounded-lg border transition-colors',
                      isAvanzado ? 'border-primary/60 bg-primary/10' : 'border-white/10 hover:border-white/20 hover:bg-white/3',
                    )}>
                      <div className="flex items-center gap-3 p-3 cursor-pointer"
                        onClick={() => { if (!isAvanzado) handleMetodoChange('api_ssl'); }}>
                        <div className={cn(
                          'w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors',
                          isAvanzado ? 'border-primary bg-primary' : 'border-white/30',
                        )} />
                        <div className="flex-1">
                          <div className={cn('text-sm font-medium flex items-center gap-1.5', isAvanzado ? 'text-white' : 'text-gray-300')}>
                            <Settings className="w-3.5 h-3.5" />
                            Avanzado
                          </div>
                          <div className="text-xs text-gray-600 mt-0.5">SSH · SNMP · API-SSL</div>
                        </div>
                      </div>

                      {isAvanzado && (
                        <div className="px-3 pb-3 space-y-3">
                          <div className="grid grid-cols-3 gap-2">
                            {([
                              { val: 'api_ssl' as MetodoConexion, label: 'API-SSL', desc: 'Puerto 8729' },
                              { val: 'ssh'     as MetodoConexion, label: 'SSH',     desc: 'Puerto 22'   },
                              { val: 'snmp'    as MetodoConexion, label: 'SNMP',    desc: 'Puerto 161'  },
                            ] as const).map((o) => (
                              <label key={o.val}
                                className={cn(
                                  'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-colors',
                                  form.metodoConexion === o.val
                                    ? 'border-primary/50 bg-primary/15 text-white'
                                    : 'border-white/10 text-gray-400 hover:border-white/20 hover:text-white',
                                )}
                              >
                                <input type="radio" name="metodo" value={o.val}
                                  checked={form.metodoConexion === o.val}
                                  onChange={() => handleMetodoChange(o.val)}
                                  className="accent-primary" />
                                <div>
                                  <div className="font-medium">{o.label}</div>
                                  <div className="text-gray-600 mt-0.5">{o.desc}</div>
                                </div>
                              </label>
                            ))}
                          </div>
                          <div className="flex items-end gap-3">
                            <div>
                              <label className={labelCls}>
                                {form.metodoConexion === 'api_ssl' ? 'Puerto API-SSL' :
                                 form.metodoConexion === 'ssh'     ? 'Puerto SSH'     : 'Puerto SNMP'}
                              </label>
                              <input type="number" min={1} max={65535}
                                className={cn(inputCls, 'w-36')}
                                value={
                                  form.metodoConexion === 'api_ssl' ? (form.puertoApiSsl ?? 8729) :
                                  form.metodoConexion === 'ssh'     ? (form.puertoSsh    ?? 22)   : 161
                                }
                                onChange={(e) => {
                                  const v = parseInt(e.target.value);
                                  if (form.metodoConexion === 'api_ssl') set('puertoApiSsl', v || 8729);
                                  else if (form.metodoConexion === 'ssh') set('puertoSsh', v || 22);
                                }}
                              />
                            </div>
                            {form.metodoConexion === 'api_ssl' && (
                              <label className="flex items-center gap-1.5 cursor-pointer select-none pb-2">
                                <input type="checkbox" checked={form.usarSsl ?? false}
                                  onChange={(e) => set('usarSsl', e.target.checked)}
                                  className="accent-primary w-4 h-4" />
                                <span className="text-sm text-gray-300">Usar TLS / SSL</span>
                              </label>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Script de conexión — solo VPN Tunnel */}
              {form.metodoConexion === 'vpn_tunnel' && router && (
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-blue-300">Script de configuración MikroTik</p>
                    <p className="text-xs text-gray-500 mt-0.5">Genera el script para configurar el túnel OpenVPN en este router.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowScript(true)}
                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30 transition-colors whitespace-nowrap"
                  >
                    <Terminal className="w-4 h-4" />
                    Ver script
                  </button>
                </div>
              )}

              {/* Acceso al router */}
              <div className="space-y-3">
                <p className={sectionHdr}>
                  <Key className="w-3.5 h-3.5" />
                  Acceso al router
                </p>

                <div>
                  <label className={labelCls}>
                    {form.metodoConexion === 'vpn_tunnel' ? 'IP de la interfaz OVPN Client' : 'IP de gestión *'}
                  </label>
                  <input
                    className={cn(inputCls, form.metodoConexion === 'vpn_tunnel' && 'border-blue-400/30')}
                    value={form.metodoConexion === 'vpn_tunnel' ? (form.vpnIp || form.ipGestion) : form.ipGestion}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (form.metodoConexion === 'vpn_tunnel') {
                        setForm((f) => ({ ...f, vpnIp: val, ipGestion: val }));
                        setTestStatus('idle'); setTestResult(null);
                      } else {
                        set('ipGestion', val);
                      }
                    }}
                    placeholder={form.metodoConexion === 'vpn_tunnel' ? '10.8.0.X  (se rellena al probar)' : '192.168.100.1 o IP pública'}
                  />
                  {form.metodoConexion === 'vpn_tunnel' && (
                    <p className="text-xs text-blue-400/70 mt-1 flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      En modo VPN Tunnel se usa la IP VPN para conectar mediante API
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Usuario *</label>
                    <input className={inputCls} value={form.usuario}
                      onChange={(e) => set('usuario', e.target.value)}
                      placeholder="admin" />
                    <p className="text-xs text-gray-600 mt-1">Debe tener permisos completos (full).</p>
                  </div>
                  <div>
                    <label className={labelCls}>Contraseña {router ? '(vacío = no cambiar)' : '*'}</label>
                    <div className="relative">
                      <input type={showPassword ? 'text' : 'password'}
                        className={cn(inputCls, 'pr-9')} value={form.password}
                        onChange={(e) => set('password', e.target.value)}
                        placeholder={router ? '••••••••' : 'Contraseña del router'} />
                      <button type="button" onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                        tabIndex={-1}>
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {router && <p className="text-xs text-gray-600 mt-1">Si cambiaste las credenciales en el router, escribe el nuevo usuario y contraseña.</p>}
                  </div>
                </div>

                {!(['ssh', 'snmp', 'api_ssl'] as string[]).includes(form.metodoConexion) && (
                  <div>
                    <label className={labelCls}>Puerto API</label>
                    <div className="flex items-center gap-3">
                      <input type="number" min={1} max={65535}
                        className={cn(inputCls, 'w-36')}
                        value={form.puertoApi ?? 8728}
                        onChange={(e) => set('puertoApi', parseInt(e.target.value) || 8728)} />
                      <span className="text-xs text-gray-600">
                        Por defecto: 8728. Si lo cambiaste en el router, actualízalo aquí también.
                      </span>
                    </div>
                  </div>
                )}

                {/* Probar conexión */}
                <div className="rounded-xl border border-white/10 p-4 bg-white/3 space-y-3">
                  <p className={cn(sectionHdr, 'mb-0')}>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Probar conexión
                  </p>
                  <p className="text-xs text-gray-600">
                    {form.metodoConexion === 'vpn_tunnel'
                      ? 'Verifica el túnel VPN y la conexión API en un solo paso. Si el túnel conectó, la IP se rellena automáticamente.'
                      : 'Comprueba la conectividad antes de guardar. Detecta la versión RouterOS automáticamente.'}
                  </p>
                  <button onClick={handleTest} disabled={testStatus === 'testing'}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors border',
                      testStatus === 'ok'    ? 'bg-green-500/20 text-green-400 border-green-500/30'  :
                      testStatus === 'error' ? 'bg-red-500/20   text-red-400   border-red-500/30'    :
                                               'bg-white/10 text-white hover:bg-white/15 border-white/10',
                      testStatus === 'testing' && 'opacity-70 cursor-not-allowed',
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
                          {testResult.identityDetectada && (
                            <span>Identity: <strong className="text-green-300">{testResult.identityDetectada}</strong></span>
                          )}
                          {testResult.versionDetectada && (
                            <span>RouterOS: <strong className="text-green-300">{testResult.versionDetectada}</strong></span>
                          )}
                          {testResult.latenciaMs != null && (
                            <span>Latencia: <strong className="text-green-300">{testResult.latenciaMs}ms</strong></span>
                          )}
                          {testResult.rosVersion && (
                            <span className="bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full font-medium">
                              {testResult.rosVersion.toUpperCase()}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: Configuración ──────────────────────────── */}
          {tab === 'config' && (
            <div className="space-y-5">

              {/* Control de Seguridad */}
              <div>
                <p className={sectionHdr}>
                  <Shield className="w-3.5 h-3.5" />
                  Autenticación y Control Abonado
                </p>
                <select className={cn(inputCls, 'cursor-pointer')}
                  value={form.tipoControl ?? 'ninguna'}
                  onChange={(e) => set('tipoControl', e.target.value)}
                >
                  {TIPO_CONTROL_OPTS.map((o) => (
                    <option key={o.val} value={o.val} className="bg-gray-900">{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Control de velocidad */}
              <div>
                <p className={sectionHdr}>
                  <Network className="w-3.5 h-3.5" />
                  Control de velocidad
                </p>
                <select className={cn(inputCls, 'cursor-pointer')}
                  value={form.tipoControlVelocidad ?? 'ninguno'}
                  onChange={(e) => set('tipoControlVelocidad', e.target.value)}
                >
                  {TIPO_VELOCIDAD_OPTS.map((o) => (
                    <option key={o.val} value={o.val} className="bg-gray-900">{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Auto-configuración */}
              <div>
                <p className={sectionHdr}>
                  <Cpu className="w-3.5 h-3.5" />
                  Auto-configuración al provisionar
                </p>
                <div className="space-y-2">
                  {[
                    { key: 'autoConfigurarQueues',   label: 'Crear/actualizar Queues automáticamente' },
                    { key: 'autoConfigurarPppoe',    label: 'Crear/actualizar PPPoE automáticamente'  },
                    { key: 'autoConfigurarFirewall', label: 'Configurar reglas de Firewall automáticamente' },
                  ].map((opt) => (
                    <label key={opt.key} className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox"
                        checked={!!(form as any)[opt.key]}
                        onChange={(e) => set(opt.key as any, e.target.checked)}
                        className="accent-primary w-4 h-4 rounded" />
                      <span className="text-sm text-gray-300">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 flex-shrink-0">
          {/* Navegación entre tabs */}
          <div className="flex gap-1">
            {tabs.map((t, i) => (
              <div key={t.id}
                className={cn(
                  'w-2 h-2 rounded-full transition-colors',
                  tab === t.id ? 'bg-primary' : 'bg-white/20',
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            {tab !== 'ident' && (
              <button
                onClick={() => setTab(tab === 'config' ? 'conn' : 'ident')}
                className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                ← Anterior
              </button>
            )}
            {tab !== 'config' ? (
              <button
                onClick={() => setTab(tab === 'ident' ? 'conn' : 'config')}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-white/10 text-white rounded-lg hover:bg-white/15 transition-colors"
              >
                Siguiente <ChevronRight className="w-4 h-4" />
              </button>
            ) : null}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {router ? 'Guardar cambios' : 'Registrar router'}
            </button>
          </div>
        </div>
      </div>
    </div>

    {showScript && router && (
      <ScriptConexionDialog router={router} onClose={() => setShowScript(false)} />
    )}
  </>);
}

// ─── Componente principal ─────────────────────────────────────────

export function RoutersContent() {
  const { toast }   = useToast();
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard]   = useState(false);
  const [showModal, setShowModal]     = useState(false);
  const [editRouter, setEditRouter]   = useState<RouterType | null>(null);
  const [testingId, setTestingId]     = useState<string | null>(null);
  const [syncingId, setSyncingId]     = useState<string | null>(null);
  const [morososRouter, setMorososRouter] = useState<RouterType | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RouterType | null>(null);

  const { data: routers = [], isLoading } = useQuery<RouterType[]>({
    queryKey:        ['routers'],
    queryFn:         mikrotikApi.listar,
    refetchInterval: 60_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => mikrotikApi.eliminar(id),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ['routers'] }); toast('Router eliminado', { type: 'success' }); },
    onError:    (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const handleSyncSubnets = async (router: RouterType) => {
    setSyncingId(router.id);
    try {
      const { subnets } = await mikrotikApi.syncSubnets(router.id);
      toast(`${subnets.length} subnet${subnets.length !== 1 ? 's' : ''} sincronizado${subnets.length !== 1 ? 's' : ''}: ${subnets.join(', ')}`, { type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['routers'] });
    } catch (err) {
      toast(parseApiError(err), { type: 'error' });
    } finally {
      setSyncingId(null);
    }
  };

  const testConexion = async (router: RouterType) => {
    setTestingId(router.id);
    try {
      const result = await mikrotikApi.testConexion(router.id);
      if (result.exitoso) {
        toast(`Conectado en ${result.latenciaMs}ms — ${result.mensaje}`, { type: 'success' });
      } else {
        toast(result.mensaje, { type: 'error' });
      }
      queryClient.invalidateQueries({ queryKey: ['routers'] });
    } catch (err) {
      toast(parseApiError(err), { type: 'error' });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = (router: RouterType) => setPendingDelete(router);

  const onSaved = () => queryClient.invalidateQueries({ queryKey: ['routers'] });

  const openAdd  = () => setShowWizard(true);
  const openEdit = (r: RouterType) => { setEditRouter(r); setShowModal(true); };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Router className="w-5 h-5 text-primary" />
            Routers MikroTik
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            {routers.length} router{routers.length !== 1 ? 's' : ''} registrado{routers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Agregar router
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : routers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-500">
          <Router className="w-12 h-12 mb-3 opacity-20" />
          <p className="text-sm">No hay routers registrados</p>
          <button onClick={openAdd} className="mt-3 text-primary text-sm hover:underline">
            Agregar el primer router
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-gray-500 uppercase tracking-wider">
                <th className="text-left px-4 py-3">Router</th>
                <th className="text-left px-4 py-3">IP Gestión</th>
                <th className="text-left px-4 py-3">IP VPN</th>
                <th className="text-left px-4 py-3">Método</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">CPU / RAM</th>
                <th className="text-left px-4 py-3">Latencia</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {routers.map((r) => {
                const estadoColor = ESTADO_COLORS[r.estado] ?? 'text-gray-500';
                const metodoCfg   = METODO_CONFIG[r.metodoConexion as MetodoConexion];
                const MetodoIcon  = metodoCfg?.icon ?? Network;
                const isTesting   = testingId === r.id;
                const isSyncing   = syncingId === r.id;

                return (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{r.nombre}</div>
                      {r.zona && <div className="text-xs text-gray-500">{r.zona}</div>}
                      {r.modelo && <div className="text-xs text-gray-600">{r.modelo}</div>}
                      {r.identityRouteros && (
                        <div className="text-xs text-gray-600 font-mono">{r.identityRouteros}</div>
                      )}
                      {r.subnetsLocales?.length ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {r.subnetsLocales.map((s) => (
                            <span key={s} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              <Globe className="w-2.5 h-2.5" />{s}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[10px] text-gray-700 mt-0.5 flex items-center gap-1">
                          <Globe className="w-2.5 h-2.5" />Sin redes sincronizadas
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-300 text-xs">{r.ipGestion}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.vpnIp ? (
                        <span className="text-blue-400">{r.vpnIp}</span>
                      ) : (
                        <span className="text-gray-700">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs text-gray-400">
                        <MetodoIcon className="w-3.5 h-3.5" />
                        {metodoCfg?.label ?? r.metodoConexion}
                        {r.usarSsl && <Lock className="w-3 h-3 text-yellow-400" />}
                      </span>
                      {r.versionRos && r.versionRos !== 'desconocida' && (
                        <span className="text-[10px] text-gray-600 font-mono">{r.versionRos.toUpperCase()}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('flex items-center gap-1.5 capitalize text-xs', estadoColor)}>
                        {r.estado === 'online'
                          ? <Wifi className="w-3.5 h-3.5" />
                          : <WifiOff className="w-3.5 h-3.5" />
                        }
                        {r.estado}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.cpuUsoPct != null || r.memoriaUsoPct != null ? (
                        <div className="space-y-0.5">
                          {r.cpuUsoPct != null && (
                            <div className="flex items-center gap-1 text-gray-400">
                              <Cpu className="w-3 h-3" />
                              <span>{r.cpuUsoPct.toFixed(0)}%</span>
                            </div>
                          )}
                          {r.memoriaUsoPct != null && (
                            <div className="flex items-center gap-1 text-gray-400">
                              <MemoryStick className="w-3 h-3" />
                              <span>{r.memoriaUsoPct.toFixed(0)}%</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-700">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {r.latenciaMs != null ? `${r.latenciaMs}ms` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => testConexion(r)} disabled={isTesting}
                          title="Probar conexión"
                          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-green-400 transition-colors disabled:opacity-50"
                        >
                          {isTesting
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <RefreshCw className="w-4 h-4" />
                          }
                        </button>
                        <button onClick={() => handleSyncSubnets(r)} disabled={isSyncing}
                          title="Sincronizar redes LAN"
                          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-blue-400 transition-colors disabled:opacity-50"
                        >
                          {isSyncing
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Globe className="w-4 h-4" />
                          }
                        </button>
                        <button onClick={() => setMorososRouter(r)} title="Ver morosos en MikroTik"
                          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-red-400 transition-colors"
                        >
                          <Users className="w-4 h-4" />
                        </button>
                        <button onClick={() => openEdit(r)} title="Editar"
                          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-blue-400 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(r)} title="Eliminar"
                          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Info VPN */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-sm">
        <div className="flex items-start gap-2.5 text-blue-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium mb-1">Routers con IP privada o detrás de NAT</p>
            <p className="text-blue-300/70 text-xs">
              Si el router no tiene IP pública, configúralo con una IP de la VPN del sistema
              (Panel → Red → OpenVPN → Certificados → Generar cliente). Luego usa esa IP en el campo
              <strong className="text-blue-200"> &ldquo;IP VPN&rdquo;</strong> y selecciona el tipo de conexión
              <strong className="text-blue-200"> &ldquo;VPN Tunnel&rdquo;</strong>.
            </p>
          </div>
        </div>
      </div>

      {showWizard && (
        <AgregarRouterWizard
          onClose={() => setShowWizard(false)}
          onSaved={onSaved}
        />
      )}

      {showModal && (
        <RouterModal
          router={editRouter}
          onClose={() => setShowModal(false)}
          onSaved={onSaved}
        />
      )}



      {morososRouter && (
        <MorososDialog
          router={morososRouter}
          onClose={() => setMorososRouter(null)}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <p className="font-semibold text-foreground">Eliminar router</p>
            <p className="text-sm text-muted-foreground">
              ¿Eliminar <strong>{pendingDelete.nombre}</strong>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleteMut.isPending}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => { deleteMut.mutate(pendingDelete.id); setPendingDelete(null); }}
                disabled={deleteMut.isPending}
                className="flex-1 py-2 text-sm rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-60"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
