'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Router, Plus, Pencil, Trash2, Wifi, WifiOff,
  RefreshCw, CheckCircle2, XCircle, Loader2, AlertTriangle,
  Lock, Shield, Network, Terminal, Radio,
  Key, Settings, ChevronRight, Activity, Cpu, MemoryStick,
  Copy, Check, Users, FileCode, Globe, Eye, EyeOff, Wrench,
} from 'lucide-react';

import { mikrotikApi } from '@/lib/api/mikrotik';
import { useToast }    from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import { Portal } from '@/components/ui/portal';
import type {
  Router as RouterType, CreateRouterDto,
  MetodoConexion, TestConexionResult, TipoControl, TipoControlVelocidad,
} from '@/lib/api/mikrotik';
import { AgregarRouterWizard } from './AgregarRouterWizard';
import { RouterDetailPanel }  from './RouterDetailPanel';
import { vpnApi, type VpnAlerta } from '@/lib/api/vpn';

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
  { val: 'pppoe_addresslist',  label: 'PPPoE'                       },
  { val: 'amarre_ip_mac',      label: 'Amarre IP/MAC'               },
  { val: 'amarre_ip_mac_dhcp', label: 'Amarre IP/MAC + DHCP Leases' },
];

const TIPO_VELOCIDAD_OPTS = [
  { val: 'colas_simples',     label: 'Colas Simples'                         },
  { val: 'pcq_addresslist',   label: 'PCQ + AddressList'                     },
  { val: 'dhcp_lease_queues', label: 'DHCP Leases (Colas Simples Dinámicas)' },
  { val: 'ninguno',           label: 'Ninguno'                               },
];

const ESTADO_COLORS: Record<string, string> = {
  online:        'text-green-600 dark:text-green-400',
  offline:       'text-red-600 dark:text-red-400',
  degradado:     'text-amber-600 dark:text-yellow-400',
  mantenimiento: 'text-orange-600 dark:text-orange-400',
  reverificando: 'text-blue-600 dark:text-blue-400',
  desconocido:   'text-muted-foreground',
};

const VERSION_ROS_OPTS = [
  { val: 'v6', label: 'RouterOS v6.x', sub: 'Legacy — CCR, RB, hAP (pre-2021)' },
  { val: 'v7', label: 'RouterOS v7.x', sub: 'Moderno — CHR, CCR2xxx, hEX S…'  },
];

// ─── Helpers ──────────────────────────────────────────────────────

const inputCls = 'w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors';
const labelCls = 'text-xs font-medium text-muted-foreground block mb-1';
const sectionHdr = 'text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2';

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
    <Portal>
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl flex flex-col shadow-2xl max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <FileCode className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground text-base">Script de configuración OpenVPN</h2>
              <p className="text-xs text-muted-foreground">{router.nombre} — {router.vpnIp || router.ipGestion}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
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

              <div className="bg-black/40 border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-white/3">
                  <span className="text-xs text-muted-foreground font-mono">RouterOS Terminal</span>
                  <button onClick={doCopy}
                    className={cn(
                      'flex items-center gap-1.5 text-xs px-3 py-1 rounded-md transition-colors',
                      copied ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-foreground hover:bg-white/15'
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

        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ─── Modal Agregar / Editar Router ────────────────────────────────

type ModalTab = 'ident' | 'conn' | 'config';

interface RouterModalProps {
  router?: RouterType | null;
  onClose: () => void;
  onSaved: () => void;
}

type MigrarState = 'idle' | 'confirming' | 'migrating' | 'done' | 'error';

interface MigrarResult {
  total: number;
  ok: number;
  errores: Array<{ contratoId: string; numero: string; error: string }>;
}

const LABEL_CONTROL: Record<string, string> = {
  ninguna:           'Sin autenticación',
  pppoe_addresslist: 'PPPoE',
  amarre_ip_mac:     'Amarre IP/MAC',
  amarre_ip_mac_dhcp:'Amarre IP/MAC + DHCP Leases',
};

const LABEL_VELOCIDAD: Record<string, string> = {
  ninguno:           'Sin control',
  colas_simples:     'Colas Simples',
  pcq_addresslist:   'PCQ + AddressList',
  dhcp_lease_queues: 'DHCP Leases (Colas Dinámicas)',
};

function RouterModal({ router, onClose, onSaved }: RouterModalProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<ModalTab>('ident');
  const [saving, setSaving] = useState(false);

  // ─── Estado migración ─────────────────────────────────────
  const [migrarState,  setMigrarState]  = useState<MigrarState>('idle');
  const [migrarResult, setMigrarResult] = useState<MigrarResult | null>(null);
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);

  // ─── Estado del test de conexión ──────────────────────────
  type TestStatus = 'idle' | 'testing' | 'ok' | 'error';
  const [testStatus, setTestStatus] = useState<TestStatus>(router ? 'ok' : 'idle');
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
    controlaAutenticacion:  router?.controlaAutenticacion  ?? true,
    autoConfigurarQueues:   router?.autoConfigurarQueues   ?? true,
    autoConfigurarPppoe:    router?.autoConfigurarPppoe    ?? true,
    autoConfigurarFirewall: router?.autoConfigurarFirewall ?? true,
    snmpCommunity:   router?.snmpCommunity ?? 'public',
  });

  const isDirty = !router || form.password !== '' || (
    ['nombre','descripcion','ubicacion','modelo','zona','ipGestion','vpnIp','usuario',
     'metodoConexion','versionRos','tipoControl','tipoControlVelocidad','snmpCommunity'] as const
  ).some((k) => (form as any)[k] !== ((router as any)[k] ?? '')) ||
  (['puertoApi','puertoApiSsl','puertoSsh','timeoutConexion','reintentos'] as const)
    .some((k) => Number(form[k]) !== Number(router[k])) ||
  (['usarSsl','controlaAutenticacion'] as const)
    .some((k) => Boolean(form[k]) !== Boolean(router[k]));

  const CONNECTION_FIELDS = new Set(['ipGestion','vpnIp','puertoApi','puertoApiSsl','puertoSsh','usuario','password','usarSsl','metodoConexion','versionRos','timeoutConexion']);
  const set = (key: keyof typeof form, val: any) => {
    setForm((f) => ({ ...f, [key]: val }));
    if (CONNECTION_FIELDS.has(key)) {
      setTestStatus('idle');
      setTestResult(null);
    }
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
        routerId:        router?.id,
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

    // Si es edición, detectar cambios en control/velocidad
    if (router) {
      const cambioControl   = form.tipoControl          !== router.tipoControl;
      const cambioVelocidad = form.tipoControlVelocidad !== router.tipoControlVelocidad;
      if (cambioControl || cambioVelocidad) {
        pendingSaveRef.current = () => doSave(router.tipoControl, cambioControl);
        setMigrarState('confirming');
        return;
      }
    }
    await doSave(null, false);
  };

  const doSave = async (oldTipoControl: string | null, needsMigration: boolean) => {
    setSaving(true);
    try {
      const dto = { ...form };
      if (router && !dto.password) delete (dto as any).password;

      if (router) {
        await mikrotikApi.actualizar(router.id, dto);
      } else {
        await mikrotikApi.crear(dto);
        toast('Router registrado correctamente', { type: 'success' });
        onSaved(); onClose(); return;
      }

      if (needsMigration && oldTipoControl) {
        setMigrarState('migrating');
        setSaving(false);
        try {
          const result = await mikrotikApi.migrarClientes(router!.id, oldTipoControl);
          setMigrarResult(result);
          setMigrarState(result.errores.length === 0 ? 'done' : 'error');
          onSaved();
        } catch (err) {
          setMigrarResult({ total: 0, ok: 0, errores: [{ contratoId: '', numero: '', error: parseApiError(err) }] });
          setMigrarState('error');
        }
      } else {
        toast('Router actualizado correctamente', { type: 'success' });
        onSaved(); onClose();
      }
    } catch (err) {
      toast(parseApiError(err), { type: 'error' });
      setMigrarState('idle');
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

  return (<Portal>
    <>
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Router className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground text-base">
                {router ? 'Editar Router' : 'Agregar Router MikroTik'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {router ? router.nombre : 'Configura la conexión al equipo'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
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
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30',
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
                            : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30',
                        )}
                      >
                        <input type="radio" name="versionRos" value={o.val}
                          checked={form.versionRos === o.val}
                          onChange={() => set('versionRos', o.val)}
                          className="mt-0.5 accent-primary" />
                        <div>
                          <div className={cn('text-sm font-medium', form.versionRos === o.val ? 'text-white' : 'text-foreground')}>
                            {o.label}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">{o.sub}</div>
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
              <p className="text-xs text-muted-foreground">
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
                          active ? 'border-primary/60 bg-primary/10' : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30',
                        )}
                      >
                        <input type="radio" name="metodo" value={o.val}
                          checked={active} onChange={() => handleMetodoChange(o.val)}
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
                  const isAvanzado = (['ssh', 'snmp', 'api_ssl'] as string[]).includes(form.metodoConexion);
                  return (
                    <div className={cn(
                      'rounded-lg border transition-colors',
                      isAvanzado ? 'border-primary/60 bg-primary/10' : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30',
                    )}>
                      <div className="flex items-center gap-3 p-3 cursor-pointer"
                        onClick={() => { if (!isAvanzado) handleMetodoChange('api_ssl'); }}>
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
                              { val: 'api_ssl' as MetodoConexion, label: 'API-SSL', desc: 'Puerto 8729' },
                              { val: 'ssh'     as MetodoConexion, label: 'SSH',     desc: 'Puerto 22'   },
                              { val: 'snmp'    as MetodoConexion, label: 'SNMP',    desc: 'Puerto 161'  },
                            ] as const).map((o) => (
                              <label key={o.val}
                                className={cn(
                                  'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-colors',
                                  form.metodoConexion === o.val
                                    ? 'border-primary/50 bg-primary/15 text-white'
                                    : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
                                )}
                              >
                                <input type="radio" name="metodo" value={o.val}
                                  checked={form.metodoConexion === o.val}
                                  onChange={() => handleMetodoChange(o.val)}
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

              {/* Script de conexión — solo VPN Tunnel */}
              {form.metodoConexion === 'vpn_tunnel' && router && (
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-blue-300">Script de configuración MikroTik</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Genera el script para configurar el túnel OpenVPN en este router.</p>
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
                    <p className="text-xs text-muted-foreground mt-1">Debe tener permisos completos (full).</p>
                  </div>
                  <div>
                    <label className={labelCls}>Contraseña {router ? '(vacío = no cambiar)' : '*'}</label>
                    <div className="relative">
                      <input type={showPassword ? 'text' : 'password'}
                        className={cn(inputCls, 'pr-9')} value={form.password}
                        onChange={(e) => set('password', e.target.value)}
                        placeholder={router ? '••••••••' : 'Contraseña del router'} />
                      <button type="button" onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}>
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {router && <p className="text-xs text-muted-foreground mt-1">Si cambiaste las credenciales en el router, escribe el nuevo usuario y contraseña.</p>}
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
                      <span className="text-xs text-muted-foreground">
                        Por defecto: 8728. Si lo cambiaste en el router, actualízalo aquí también.
                      </span>
                    </div>
                  </div>
                )}

                {/* Probar conexión */}
                <div className="rounded-xl border border-border p-4 bg-muted/20space-y-3">
                  <p className={cn(sectionHdr, 'mb-0')}>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Probar conexión
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {form.metodoConexion === 'vpn_tunnel'
                      ? 'Verifica el túnel VPN y la conexión API en un solo paso. Si el túnel conectó, la IP se rellena automáticamente.'
                      : 'Comprueba la conectividad antes de guardar. Detecta la versión RouterOS automáticamente.'}
                  </p>
                  <button onClick={handleTest} disabled={testStatus === 'testing'}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors border',
                      testStatus === 'ok'    ? 'bg-green-500/20 text-green-400 border-green-500/30'  :
                      testStatus === 'error' ? 'bg-red-500/20   text-red-400   border-red-500/30'    :
                                               'bg-muted text-foreground hover:bg-muted/70 border-border',
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

              {/* Toggle: controla autenticación */}
              <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-border bg-muted/10">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-primary" />
                    Permitir que el Router Controle la Autenticación de los Abonados
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {form.controlaAutenticacion
                      ? 'Todos los abonados usan el método definido abajo.'
                      : 'Cada abonado configura su propia autenticación al registrarse.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => set('controlaAutenticacion', !form.controlaAutenticacion)}
                  className={cn(
                    'relative flex-shrink-0 w-10 h-6 rounded-full transition-colors',
                    form.controlaAutenticacion ? 'bg-primary' : 'bg-muted-foreground/30',
                  )}
                >
                  <span className={cn(
                    'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                    form.controlaAutenticacion ? 'translate-x-4' : 'translate-x-0.5',
                  )} />
                </button>
              </div>

              {/* Control de Seguridad — solo si el router controla auth */}
              {form.controlaAutenticacion && (
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
              )}

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
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border flex-shrink-0">
          {/* Navegación entre tabs */}
          <div className="flex gap-1">
            {tabs.map((t, i) => (
              <div key={t.id}
                className={cn(
                  'w-2 h-2 rounded-full transition-colors',
                  tab === t.id ? 'bg-primary' : 'bg-muted/50',
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            {tab !== 'ident' && (
              <button
                onClick={() => setTab(tab === 'config' ? 'conn' : 'ident')}
                className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Anterior
              </button>
            )}
            {tab !== 'config' ? (
              <button
                onClick={() => setTab(tab === 'ident' ? 'conn' : 'config')}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-muted text-foreground rounded-lg hover:bg-muted/70 transition-colors"
              >
                Siguiente <ChevronRight className="w-4 h-4" />
              </button>
            ) : null}
            <button
              onClick={onClose}
              className="btn-ghost"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || testStatus !== 'ok' || !isDirty}
              className="btn-primary"
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

    {/* ─── Modal confirmación de migración ─────────────────── */}
    {migrarState === 'confirming' && router && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4">
        <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-base">Cambio de configuración detectado</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Este cambio se aplicará a <strong>todos los clientes activos</strong> conectados al router <strong>{router.nombre}</strong>.
              </p>
            </div>
          </div>

          <div className="bg-muted/40 rounded-lg p-4 space-y-2 text-sm">
            {form.tipoControl !== router.tipoControl && (
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">Autenticación:</span>
                <span className="font-medium line-through text-destructive/70">{LABEL_CONTROL[router.tipoControl] ?? router.tipoControl}</span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-medium text-primary">{LABEL_CONTROL[form.tipoControl] ?? form.tipoControl}</span>
              </div>
            )}
            {form.tipoControlVelocidad !== router.tipoControlVelocidad && (
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">Velocidad:</span>
                <span className="font-medium line-through text-destructive/70">{LABEL_VELOCIDAD[router.tipoControlVelocidad] ?? router.tipoControlVelocidad}</span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-medium text-primary">{LABEL_VELOCIDAD[form.tipoControlVelocidad] ?? form.tipoControlVelocidad}</span>
              </div>
            )}
          </div>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            Las reglas anteriores de cada cliente serán <strong>eliminadas</strong> del router y se crearán las nuevas según la configuración seleccionada. Este proceso puede tomar tiempo dependiendo de la cantidad de clientes.
          </div>

          <div className="flex gap-3 justify-end pt-1">
            <button
              onClick={() => { setMigrarState('idle'); }}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                setMigrarState('idle');
                if (pendingSaveRef.current) pendingSaveRef.current();
              }}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Aceptar y aplicar cambios
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ─── Overlay migración en progreso ───────────────────── */}
    {migrarState === 'migrating' && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4">
        <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl p-8 text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <h3 className="font-semibold text-foreground text-base">Aplicando nueva configuración…</h3>
          <p className="text-sm text-muted-foreground">
            Eliminando reglas anteriores e inyectando la nueva configuración en el router Mikrotik para todos los clientes activos.
            Te avisaremos cuando termine el proceso.
          </p>
        </div>
      </div>
    )}

    {/* ─── Resultado migración ──────────────────────────────── */}
    {(migrarState === 'done' || migrarState === 'error') && migrarResult && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4">
        <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${migrarState === 'done' ? 'bg-green-500/15' : 'bg-destructive/15'}`}>
              {migrarState === 'done'
                ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                : <XCircle      className="w-5 h-5 text-destructive" />}
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-base">
                {migrarState === 'done' ? 'Migración completada exitosamente' : 'Migración completada con errores'}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {migrarResult.ok}/{migrarResult.total} clientes actualizados correctamente.
                {migrarResult.errores.length > 0 && ` ${migrarResult.errores.length} con error.`}
              </p>
            </div>
          </div>

          {migrarResult.errores.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
              {migrarResult.errores.map((e, i) => (
                <div key={i} className="text-xs text-destructive">
                  <span className="font-medium">{e.numero || e.contratoId}:</span> {e.error}
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    )}
  </>
    </Portal>);
}

// ─── Componente principal ─────────────────────────────────────────

export function RoutersContent() {
  const { toast }   = useToast();
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard]   = useState(false);
  const [wizardKey,  setWizardKey]    = useState(0);
  const [showModal, setShowModal]     = useState(false);
  const [editRouter, setEditRouter]   = useState<RouterType | null>(null);
  const [testingId, setTestingId]     = useState<string | null>(null);
  const [syncingId, setSyncingId]     = useState<string | null>(null);
  const [repairingId, setRepairingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete]   = useState<RouterType | null>(null);
  const [pendingRepair, setPendingRepair]   = useState<RouterType | null>(null);
  const [detailRouter, setDetailRouter]     = useState<RouterType | null>(null);

  const { data: alertasVpn = [], refetch: refetchAlertas } = useQuery<VpnAlerta[]>({
    queryKey:        ['vpn-alertas'],
    queryFn:         vpnApi.listarAlertas,
    refetchInterval: 60_000,
  });

  const descartarAlertaMut = useMutation({
    mutationFn: (id: string) => vpnApi.descartarAlerta(id),
    onSuccess:  () => refetchAlertas(),
  });

  const { data: routers = [], isLoading } = useQuery<RouterType[]>({
    queryKey:        ['routers'],
    queryFn:         mikrotikApi.listar,
    refetchInterval: 60_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => mikrotikApi.eliminar(id),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ['routers'] }); toast('Router eliminado', { type: 'success' }); },
    onError:    (err) => { setPendingDelete(null); toast(parseApiError(err), { type: 'error' }); },
  });

  const repararMut = useMutation({
    mutationFn: (id: string) => mikrotikApi.reparar(id),
    onMutate:   (id) => { setRepairingId(id); setPendingRepair(null); },
    onSuccess:  (res) => {
      setRepairingId(null);
      toast(res.mensaje, { type: res.procesados > 0 ? 'success' : 'warning' });
      if (res.advertencias?.length) {
        res.advertencias.forEach((a) => toast(`⚠ ${a}`, { type: 'warning' }));
      }
    },
    onError:    (err) => { setRepairingId(null); toast(parseApiError(err), { type: 'error' }); },
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

  const openAdd  = () => { setWizardKey((k) => k + 1); setShowWizard(true); };
  const openEdit = (r: RouterType) => { setEditRouter(r); setShowModal(true); };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Router className="w-5 h-5 text-primary" />
            Routers MikroTik
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {routers.length} router{routers.length !== 1 ? 's' : ''} registrado{routers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={openAdd}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          Agregar router
        </button>
      </div>

      {/* Alertas VPN */}
      {alertasVpn.length > 0 && (
        <div className="space-y-2">
          {alertasVpn.map((alerta) => (
            <div
              key={alerta.id}
              className={cn(
                'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
                alerta.tipo === 'conexion_bloqueada'
                  ? 'border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
                  : 'border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10',
              )}
            >
              <AlertTriangle className={cn(
                'w-4 h-4 flex-shrink-0 mt-0.5',
                alerta.tipo === 'conexion_bloqueada' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400',
              )} />
              <div className="flex-1 min-w-0">
                <p className={cn(
                  'font-semibold text-xs uppercase tracking-wide',
                  alerta.tipo === 'conexion_bloqueada' ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400',
                )}>
                  {alerta.tipo === 'conexion_bloqueada' ? 'Conexión duplicada bloqueada' : 'Sesión VPN eliminada'}
                  {alerta.routerNombre && ` — ${alerta.routerNombre}`}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">{alerta.mensaje}</p>
                <p className="text-muted-foreground/60 text-[10px] mt-0.5">
                  {new Date(alerta.createdAt).toLocaleString('es-PE')}
                </p>
              </div>
              <button
                onClick={() => descartarAlertaMut.mutate(alerta.id)}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
                title="Descartar alerta"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : routers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
          <Router className="w-12 h-12 mb-3 opacity-20" />
          <p className="text-sm">No hay routers registrados</p>
          <button onClick={openAdd} className="mt-3 text-primary text-sm hover:underline">
            Agregar el primer router
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground/70 uppercase tracking-wider">
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
                const estadoColor = ESTADO_COLORS[r.estado] ?? 'text-muted-foreground';
                const metodoCfg   = METODO_CONFIG[r.metodoConexion as MetodoConexion];
                const MetodoIcon  = metodoCfg?.icon ?? Network;
                const isTesting   = testingId === r.id;
                const isSyncing   = syncingId === r.id;
                const isRepairing = repairingId === r.id;
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      'border-b border-border/40 hover:bg-muted/30 transition-colors cursor-pointer',
                      detailRouter?.id === r.id && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
                    )}
                    onClick={() => setDetailRouter(detailRouter?.id === r.id ? null : r)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{r.nombre}</div>
                      {r.zona && <div className="text-xs text-muted-foreground/70">{r.zona}</div>}
                      {r.modelo && <div className="text-xs text-muted-foreground/60">{r.modelo}</div>}
                      {r.identityRouteros && (
                        <div className="text-xs text-muted-foreground/60 font-mono">{r.identityRouteros}</div>
                      )}
                      {r.subnetsLocales?.length ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {r.subnetsLocales.map((s) => (
                            <span key={s} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-sky-100 text-sky-700 border border-sky-300 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20">
                              <Globe className="w-2.5 h-2.5" />{s}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground/50 mt-0.5 flex items-center gap-1">
                          <Globe className="w-2.5 h-2.5" />Sin redes sincronizadas
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-foreground text-xs">{r.ipGestion}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.vpnIp ? (
                        <span className="text-blue-700 dark:text-blue-400">{r.vpnIp}</span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MetodoIcon className="w-3.5 h-3.5" />
                        {metodoCfg?.label ?? r.metodoConexion}
                        {r.usarSsl && <Lock className="w-3 h-3 text-yellow-500 dark:text-yellow-400" />}
                      </span>
                      {r.versionRos && r.versionRos !== 'desconocida' && (
                        <span className="text-[10px] text-muted-foreground/60 font-mono">{r.versionRos.toUpperCase()}</span>
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
                      <div className="space-y-0.5">
                        {r.cpuUsoPct != null && (() => { const cpu = Number(r.cpuUsoPct); return (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Cpu className="w-3 h-3" />
                            <div className="flex items-center gap-1">
                              <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.min(cpu, 100)}%`,
                                    background: cpu > 80 ? '#ef4444' : cpu > 50 ? '#f59e0b' : '#22c55e',
                                  }}
                                />
                              </div>
                              <span>{cpu.toFixed(0)}%</span>
                            </div>
                          </div>
                        ); })()}
                        {r.memoriaUsoPct != null && (() => { const ram = Number(r.memoriaUsoPct); return (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <MemoryStick className="w-3 h-3" />
                            <div className="flex items-center gap-1">
                              <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.min(ram, 100)}%`,
                                    background: ram > 85 ? '#ef4444' : ram > 65 ? '#f59e0b' : '#22c55e',
                                  }}
                                />
                              </div>
                              <span>{ram.toFixed(0)}%</span>
                            </div>
                          </div>
                        ); })()}
                        <div className="flex items-center gap-1 text-muted-foreground" title="Clientes Activos en el Router">
                          <Users className="w-3 h-3" />
                          <span>{r.contratosCount ?? 0} Clientes Activos</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.latenciaMs != null ? `${r.latenciaMs}ms` : '—'}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => testConexion(r)} disabled={isTesting}
                          title="Probar conexión"
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground/60 hover:text-green-600 dark:hover:text-green-400 transition-colors disabled:opacity-50"
                        >
                          {isTesting
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <RefreshCw className="w-4 h-4" />
                          }
                        </button>
                        <button onClick={() => handleSyncSubnets(r)} disabled={isSyncing}
                          title="Sincronizar redes LAN"
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground/60 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-50"
                        >
                          {isSyncing
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Globe className="w-4 h-4" />
                          }
                        </button>
                        <button
                          onClick={() => setPendingRepair(r)}
                          disabled={isRepairing}
                          title="Reparar / Sincronizar router"
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground/60 hover:text-amber-600 dark:hover:text-amber-400 transition-colors disabled:opacity-50"
                        >
                          {isRepairing
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Wrench className="w-4 h-4" />}
                        </button>
                        <button onClick={() => openEdit(r)} title="Editar"
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground/60 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(r)}
                          title="Eliminar"
                          className="p-1.5 rounded-lg transition-colors hover:bg-muted text-muted-foreground/60 hover:text-red-600 dark:hover:text-red-400"
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
      <div className="bg-blue-50 border border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/20 rounded-xl p-4 text-sm">
        <div className="flex items-start gap-2.5 text-blue-800 dark:text-blue-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium mb-1">Routers con IP privada o detrás de NAT</p>
            <p className="text-blue-700/80 dark:text-blue-300/70 text-xs">
              Si el router no tiene IP pública, configúralo con una IP de la VPN del sistema
              (Panel → Red → OpenVPN → Certificados → Generar cliente). Luego usa esa IP en el campo
              <strong className="text-blue-900 dark:text-blue-200"> &ldquo;IP VPN&rdquo;</strong> y selecciona el tipo de conexión
              <strong className="text-blue-900 dark:text-blue-200"> &ldquo;VPN Tunnel&rdquo;</strong>.
            </p>
          </div>
        </div>
      </div>

      {showWizard && (
        <AgregarRouterWizard
          key={wizardKey}
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



      {detailRouter && (
        <RouterDetailPanel
          router={detailRouter}
          onClose={() => setDetailRouter(null)}
        />
      )}

      {pendingDelete && (
        <Portal>
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
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
        </Portal>
      )}

      {pendingRepair && (
        <Portal>
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setPendingRepair(null)}
        >
          <div
            className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <Wrench className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground leading-none">Reparar router</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">{pendingRepair.nombre} — {pendingRepair.vpnIp || pendingRepair.ipGestion}</p>
              </div>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300 mb-5 space-y-1">
              <p className="font-medium">¿Confirmas reparar este router?</p>
              <p className="text-amber-600/80 dark:text-amber-400/70">
                Esto inyectará y actualizará todas las reglas de planes, abonados, colas de velocidad
                y listas de morosos de Datafast en el MikroTik físico.
                Solo se tocan reglas con firma <code className="bg-black/10 dark:bg-black/30 px-1 rounded">datafast</code>.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingRepair(null)}
                className="px-4 py-2 text-sm rounded-lg border border-input text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => repararMut.mutate(pendingRepair.id)}
                className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors"
              >
                <Wrench className="w-3.5 h-3.5" />
                Reparar router
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}

    </div>
  );
}
