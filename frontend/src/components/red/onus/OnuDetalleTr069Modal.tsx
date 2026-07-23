'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Radio, X, RefreshCcw, Power, RotateCcw, Wifi, Globe, Download,
  Loader2, Save, Eye, EyeOff, Signal, Clock, KeyRound, Monitor, Cable,
  Home, Network, Server, BarChart2, Shield, Phone, Settings, Search,
  ScrollText, Lock, ChevronDown, ChevronRight,
} from 'lucide-react';

// Cadencia del auto-refresco mientras el modal está abierto. Cada tick es una sesión TR-069
// real contra la ONU (refreshObject + connection-request); 30 s da "tiempo real" sin saturar
// el límite bajo de sesiones VTY concurrentes del MA5800.
const AUTO_REFRESH_MS = 30_000;
import { oltNativoApi, type OnuTr069Detalle, type OnuWifiBand, type OnuHost, type FtthOnuRegistro } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { SenalFtthValor } from './SenalFtthValor';

// ─────────────────────────────────────────────────────────────
// Modal "Ver detalle ONU" — layout de panel de gestión (sidebar + contenido).
//
// Navegación por sidebar: columna izquierda con todas las secciones (icono + estado),
// panel derecho con el contenido de la sección activa. Escala a las 19 secciones sin el
// scroll infinito del acordeón y se siente como una consola de gestión (SmartOLT/GenieACS).
//
// Convención innegociable: NUNCA se muestran datos inventados. Lo que hay se lee de la
// sesión TR-069 real (GenieACS), del registro FTTH o del inventario de la OLT. Lo que aún no
// tiene backend se marca de forma explícita como «Pendiente de integración» y se deja inerte.
// ─────────────────────────────────────────────────────────────

const BTN_OUTLINE = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-border text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const INPUT = 'w-full px-2.5 py-1.5 text-xs border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
const BTN_MAQUETA = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-dashed border-border/70 text-muted-foreground/70 cursor-not-allowed';

function Info({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-[11px] text-muted-foreground min-w-[120px] flex-shrink-0">{label}</span>
      <span className="text-[11px] text-foreground font-medium break-all">{value ?? <span className="text-muted-foreground/50">—</span>}</span>
    </div>
  );
}

function fmtUptime(s?: number | null): string {
  if (s == null) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const ESTADO_CLS: Record<string, string> = {
  online:           'text-emerald-400',
  apagada:          'text-zinc-400',
  ruptura_fibra:    'text-red-400',
  desactivada:      'text-amber-400',
  offline:          'text-zinc-400',
  no_aprovisionada: 'text-muted-foreground',
};
const ESTADO_DOT: Record<string, string> = {
  online:           'bg-emerald-400',
  apagada:          'bg-zinc-400',
  ruptura_fibra:    'bg-red-400',
  desactivada:      'bg-amber-400',
  offline:          'bg-zinc-400',
  no_aprovisionada: 'bg-muted-foreground',
};

// Chip de "vitals" — dato clave siempre visible bajo el header.
function Vital({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 flex-shrink-0 max-w-[220px]">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</span>
      <span className="text-[11px] font-medium text-foreground truncate">{children}</span>
    </div>
  );
}

// ── Aviso de sección sin backend ──────────────────────────────
function Maqueta({ nota }: { nota: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
        <Lock className="w-3 h-3" /> Pendiente de integración
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{nota}</p>
    </div>
  );
}

// ── Cabecera de sección en el panel de contenido ──────────────
function SeccionHeader({ icon: Icon, label, hint }: { icon: typeof Home; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/50">
      <Icon className="w-4 h-4 text-primary" />
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
      {hint && <span className="text-[10px] text-muted-foreground ml-auto">{hint}</span>}
    </div>
  );
}

// ── Editor de una banda WiFi ───────────────────────────────────
function WifiEditor({ sn, band, current, onSaved }: {
  sn: string; band: '2.4' | '5'; current?: OnuWifiBand; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [ssid, setSsid] = useState(current?.ssid ?? '');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);

  const mut = useMutation({
    mutationFn: () => oltNativoApi.onuTr069SetWifi(sn, { band, ssid: ssid || undefined, password: pass || undefined }),
    onSuccess: (r) => {
      if (r.ok) { toast(`WiFi ${band}GHz enviado — puede tardar 1-2 min en aplicarse`, { type: 'success' }); setPass(''); onSaved(); }
      else toast(`WiFi ${band}GHz: fallaron ${r.fallidas.join(', ')}`, { type: 'error' });
    },
    onError: () => toast(`No se pudo aplicar el WiFi ${band}GHz`, { type: 'error' }),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <Wifi className="w-3.5 h-3.5 text-primary" /> WiFi {band}GHz
        {current?.enabled === false && <span className="text-[10px] px-1.5 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-600/40">deshabilitado</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground">SSID</label>
          <input value={ssid} onChange={e => setSsid(e.target.value)} placeholder={current?.ssid ?? 'SSID'} className={INPUT} />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Nueva clave (dejar vacío = sin cambio)</label>
          <div className="relative">
            <input type={show ? 'text' : 'password'} value={pass} onChange={e => setPass(e.target.value)}
              placeholder="••••••••" className={cn(INPUT, 'pr-8')} />
            <button type="button" onClick={() => setShow(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
      <button onClick={() => mut.mutate()} disabled={mut.isPending || (!ssid && !pass)} className={cn(BTN_OUTLINE, 'ml-auto')}>
        {mut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Aplicar WiFi {band}GHz
      </button>
    </div>
  );
}

// ── Dispositivos conectados (Hosts) ────────────────────────────
const CONEXION_META: Record<OnuHost['conexion'], { label: string; cls: string; Icon: typeof Wifi }> = {
  '2.4': { label: 'WiFi 2.4GHz', cls: 'text-sky-400 border-sky-700/40 bg-sky-500/10',       Icon: Wifi },
  '5':   { label: 'WiFi 5GHz',   cls: 'text-violet-400 border-violet-700/40 bg-violet-500/10', Icon: Wifi },
  wifi:  { label: 'WiFi',        cls: 'text-emerald-400 border-emerald-700/40 bg-emerald-500/10', Icon: Wifi },
  lan:   { label: 'Cable',       cls: 'text-amber-400 border-amber-700/40 bg-amber-500/10',   Icon: Cable },
};

function HostsSection({ hosts }: { hosts: OnuHost[] }) {
  const activos = hosts.filter(h => h.active !== false);
  const cuenta = (c: OnuHost['conexion']) => activos.filter(h => h.conexion === c).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-normal text-muted-foreground">{activos.length} dispositivo(s)</span>
        <div className="flex-1" />
        {(['2.4', '5', 'lan'] as const).map(c => cuenta(c) > 0 && (
          <span key={c} className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', CONEXION_META[c].cls)}>
            {CONEXION_META[c].label}: {cuenta(c)}
          </span>
        ))}
      </div>
      {activos.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">
          Sin dispositivos reportados. Pulsa «Refresh interfaces» o activa LIVE (la ONU debe estar informando).
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left px-2.5 py-1.5 font-semibold">Dispositivo</th>
                <th className="text-left px-2.5 py-1.5 font-semibold">IP</th>
                <th className="text-left px-2.5 py-1.5 font-semibold">MAC</th>
                <th className="text-left px-2.5 py-1.5 font-semibold">Conexión</th>
              </tr>
            </thead>
            <tbody>
              {activos.map((h, i) => {
                const m = CONEXION_META[h.conexion];
                return (
                  <tr key={`${h.mac ?? i}`} className="border-t border-border/40">
                    <td className="px-2.5 py-1.5 text-foreground">{h.hostname ?? <span className="text-muted-foreground/60">sin nombre</span>}</td>
                    <td className="px-2.5 py-1.5 font-mono text-muted-foreground">{h.ip ?? '—'}</td>
                    <td className="px-2.5 py-1.5 font-mono text-muted-foreground">{h.mac ?? '—'}</td>
                    <td className="px-2.5 py-1.5">
                      <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border', m.cls)}>
                        <m.Icon className="w-3 h-3" /> {m.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────
export function OnuDetalleTr069Modal({
  sn, oltId, oltNombre, cliente, slot, port, onuId, estadoOperativo, rxPowerDbm, contratoId, onClose,
}: {
  sn: string;
  oltId?: string | null;
  oltNombre?: string;
  cliente?: string | null;
  slot?: number | null;
  port?: number | null;
  onuId?: number | null;
  estadoOperativo?: string | null;
  rxPowerDbm?: number | null;
  contratoId?: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [pppUser, setPppUser] = useState('');
  const [pppPass, setPppPass] = useState('');
  const [showPppPass, setShowPppPass] = useState(false);
  const [webAdminUser, setWebAdminUser] = useState('');
  const [webAdminPass, setWebAdminPass] = useState('');
  const [showWebPass, setShowWebPass] = useState(false);
  const [pending, setPending] = useState<'reboot' | 'factory' | 'olt_reset' | null>(null);
  const [active, setActive] = useState('general');
  const [fwFile, setFwFile] = useState('');
  const initRan = useRef(false);

  const { data, isLoading, refetch, isFetching } = useQuery<OnuTr069Detalle>({
    queryKey: ['onu-tr069', sn],
    queryFn:  () => oltNativoApi.onuTr069Detalle(sn),
    staleTime: 0,
  });

  const { data: registro, refetch: refetchRegistro } = useQuery<FtthOnuRegistro | null>({
    queryKey: ['ftth-estado', contratoId],
    queryFn:  () => oltNativoApi.ftthEstado(contratoId!),
    enabled:  Boolean(contratoId),
    staleTime: 30_000,
    refetchInterval: (q) => {
      const e = (q.state.data as FtthOnuRegistro | null | undefined)?.carrilEstado;
      return e === 'activando' || e === 'desactivando' ? 5_000 : false;
    },
  });

  // ── Carril TR-069 bajo demanda (toggle) ─────────────────────────────
  const carril = registro?.carrilEstado ?? 'inactivo';
  const carrilActivo    = carril === 'activo';
  const carrilTransitorio = carril === 'activando' || carril === 'desactivando';
  const carrilMut = useMutation({
    mutationFn: () => carrilActivo
      ? oltNativoApi.ftthDesactivarCarril(contratoId!)
      : oltNativoApi.ftthActivarCarril(contratoId!),
    onSuccess: (r) => { toast(r.mensaje, { type: 'success' }); refetchRegistro(); },
    onError: (e: unknown) => toast(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'No se pudo cambiar el carril TR-069',
      { type: 'error' },
    ),
  });

  // Posición EFECTIVA de la ONU para leer la señal (el registro FTTH es la fuente actual).
  const effSlot  = registro?.slot  ?? slot;
  const effPort  = registro?.port  ?? port;
  const effOnuId = registro?.onuId ?? onuId;

  const registroListo = !contratoId || registro !== undefined;
  const puedeLeerMetricas = Boolean(oltId && effSlot != null && effPort != null && effOnuId != null);
  const { data: metricas, isFetching: metricasFetching, refetch: refetchMetricas } = useQuery({
    queryKey: ['onu-metricas', oltId, effSlot, effPort, effOnuId],
    queryFn:  () => oltNativoApi.metricas(oltId!, { slot: effSlot!, port: effPort!, onuId: effOnuId!, sn }),
    enabled:  puedeLeerMetricas && registroListo,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    staleTime: 8_000,
  });
  const rxDbm = metricas?.rxPowerDbm ?? rxPowerDbm ?? null;
  const oltRxDbm = metricas?.oltRxPowerDbm ?? null;

  // Evita apilar refrescos si uno tarda más que el intervalo (el closure del setInterval no ve
  // el `isPending` fresco de la mutación, así que se sincroniza en un ref).
  const refrescandoRef = useRef(false);
  const refreshMut = useMutation({
    mutationFn: () => oltNativoApi.onuTr069Refresh(sn),
    onMutate:   () => { refrescandoRef.current = true; },
    onSuccess:  () => refetch(),
    onSettled:  () => { refrescandoRef.current = false; },
  });

  useEffect(() => {
    if (!initRan.current) {
      initRan.current = true;
      refreshMut.mutate();
      // Sella "uso" del carril: abrir el modal cuenta como interacción del operador y
      // suprime el barrido TTL por inactividad (Fase 3). Best-effort, no bloquea.
      if (contratoId) void oltNativoApi.ftthMarcarUsoCarril(contratoId);
    }
    // Auto-refresco mientras el modal está abierto: el operador ve los datos en tiempo real sin
    // pulsar nada. Solo si la pestaña está visible y no hay un refresco en curso, para no
    // martillear la ONU ni apilar sesiones.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && !refrescandoRef.current) {
        refreshMut.mutate();
      }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rebootMut = useMutation({
    mutationFn: () => oltNativoApi.onuTr069Reboot(sn),
    onSuccess: (r) => toast(r.mensaje, { type: 'success' }),
    onError: () => toast('No se pudo reiniciar la ONU', { type: 'error' }),
  });
  const factoryMut = useMutation({
    mutationFn: () => oltNativoApi.onuTr069FactoryReset(sn),
    onSuccess: (r) => toast(r.mensaje, { type: 'success' }),
    onError: () => toast('No se pudo resetear la ONU', { type: 'error' }),
  });
  // Reinicio por la OLT (`ont reset`) — funciona aunque la ONU NO esté informando a TR-069.
  const oltResetMut = useMutation({
    mutationFn: () => oltNativoApi.ftthResetOnu(oltId!, effSlot!, effPort!, effOnuId!),
    onSuccess: (r) => toast(r.mensaje ?? 'ONU reiniciada desde la OLT — vuelve online en ~1 min', { type: 'success' }),
    onError: () => toast('No se pudo reiniciar la ONU desde la OLT', { type: 'error' }),
  });
  const pppMut = useMutation({
    mutationFn: () => oltNativoApi.onuTr069SetPppoe(sn, { username: pppUser || undefined, password: pppPass || undefined }),
    onSuccess: (r) => { if (r.ok) { toast('PPPoE enviado — puede tardar 1-2 min en aplicarse', { type: 'success' }); setPppPass(''); refetch(); } else toast(`PPPoE: fallaron ${r.fallidas.join(', ')}`, { type: 'error' }); },
    onError: () => toast('No se pudo aplicar el PPPoE', { type: 'error' }),
  });
  const webMut = useMutation({
    mutationFn: () => oltNativoApi.onuTr069SetAccesoWeb(sn, { adminUser: webAdminUser || undefined, adminPassword: webAdminPass || undefined }),
    onSuccess: (r) => { if (r.ok) { toast('Acceso web enviado — puede tardar 1-2 min en aplicarse', { type: 'success' }); setWebAdminPass(''); } else toast(`Acceso web: fallaron ${r.fallidas.join(', ')}`, { type: 'error' }); },
    onError: () => toast('No se pudo cambiar el acceso web', { type: 'error' }),
  });

  const info = data?.info;
  const informing = data?.informing;

  // Secciones del sidebar. `real` marca las que ya tienen backend; el resto se maqueta.
  const SECCIONES: Array<{ key: string; label: string; icon: typeof Home; real: boolean; nota?: string }> = [
    { key: 'general',         label: 'General',                     icon: Home,       real: true  },
    { key: 'ppp',             label: 'PPP Interface',               icon: Globe,      real: true  },
    { key: 'wlan1',           label: 'Wireless LAN 2.4GHz',         icon: Wifi,       real: true  },
    { key: 'wlan5',           label: 'Wireless LAN 5GHz',           icon: Wifi,       real: true  },
    { key: 'hosts',           label: 'Hosts (dispositivos)',        icon: Monitor,    real: true  },
    { key: 'security',        label: 'Security (acceso web)',       icon: Shield,     real: true  },
    { key: 'portforward',     label: 'Port Forward',                icon: Network,    real: false, nota: 'Requiere exponer las reglas NAT del CPE por TR-069.' },
    { key: 'ipinterface',     label: 'IP Interface',                icon: Globe,      real: false, nota: 'Requiere leer las interfaces WAN/IP del CPE por TR-069.' },
    { key: 'landhcp',         label: 'LAN DHCP Server',             icon: Server,     real: false, nota: 'Requiere exponer el pool DHCP del CPE.' },
    { key: 'lanports',        label: 'LAN Ports',                   icon: Network,    real: false, nota: 'Requiere el estado de los puertos Ethernet del CPE.' },
    { key: 'lancounters',     label: 'LAN Counters',                icon: BarChart2,  real: false, nota: 'Requiere contadores de tráfico por interfaz.' },
    { key: 'wlancounters',    label: 'WLAN Counters',               icon: BarChart2,  real: false, nota: 'Requiere contadores de tráfico inalámbrico.' },
    { key: 'wifi24',          label: 'Wifi 2.4GHz Site Survey',     icon: Radio,      real: false, nota: 'Requiere escaneo de vecindad en el CPE.' },
    { key: 'wifi5',           label: 'Wifi 5GHz Site Survey',       icon: Radio,      real: false, nota: 'Requiere escaneo de vecindad en el CPE.' },
    { key: 'voicelines',      label: 'Voice lines',                 icon: Phone,      real: false, nota: 'Requiere el módulo de voz (VoIP) del CPE.' },
    { key: 'misc',            label: 'Miscellaneous',               icon: Settings,   real: false, nota: 'Parámetros varios del CPE aún no mapeados.' },
    { key: 'troubleshooting', label: 'Troubleshooting',             icon: Search,     real: false, nota: 'Diagnósticos remotos (ping/traceroute) por TR-069.' },
    { key: 'devicelogs',      label: 'Device Logs',                 icon: ScrollText, real: false, nota: 'Requiere descarga del log del CPE.' },
    { key: 'firmware',        label: 'File & Firmware management',  icon: Download,   real: false, nota: 'La actualización masiva ya existe en la pestaña Firmware de la OLT.' },
  ];

  const seccion = SECCIONES.find(s => s.key === active) ?? SECCIONES[0];
  const SecIcon = seccion.icon;

  // Extra "File Download" ligado a la sección de firmware (maqueta), reutilizado en el
  // acordeón móvil y en el panel de escritorio.
  const firmwareExtra = seccion.key === 'firmware' ? (
    <div className="mt-4 flex items-center gap-3 flex-wrap rounded-lg border border-dashed border-border/70 bg-muted/10 px-3 py-3">
      <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
        <Lock className="w-3 h-3" /> File Download (ACS → ONU)
      </span>
      <select value={fwFile} onChange={e => setFwFile(e.target.value)} disabled
        className="flex-1 min-w-[180px] max-w-xs px-3 py-1.5 text-xs border border-dashed border-border/70 rounded-lg bg-background text-muted-foreground/70 cursor-not-allowed">
        <option value="">— pendiente de integración —</option>
      </select>
      <button type="button" disabled className={BTN_MAQUETA}>
        <Download className="w-3.5 h-3.5" /> Start download
      </button>
    </div>
  ) : null;
  // 'general' vive de datos del ERP/OLT → disponible siempre. El resto necesita la sesión TR-069.
  const seccionBloqueada = seccion.real && seccion.key !== 'general' && !informing;

  const estadoTxt = estadoOperativo ?? '—';

  // ── Contenido del panel derecho según la sección activa ──
  const renderContenido = () => {
    if (!seccion.real) return <Maqueta nota={seccion.nota ?? 'Sección aún no integrada.'} />;

    if (seccion.key === 'general') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <div>
            <Info label="OLT"           value={oltNombre} />
            <Info label="Board / Port"  value={slot != null && port != null ? `${slot} / ${port}` : undefined} />
            <Info label="ONU ID"        value={onuId ?? undefined} />
            <Info label="Serial"        value={<span className="font-mono">{info?.serial ?? sn}</span>} />
            <Info label="ONU type"      value={info?.modelName ?? info?.productClass} />
            <Info label="Fabricante"    value={info?.manufacturer} />
            <Info label="Firmware"      value={info?.softwareVersion} />
            <Info label="Hardware"      value={info?.hardwareVersion} />
          </div>
          <div>
            <Info label="Cliente"           value={cliente ?? undefined} />
            <Info label="Attached VLAN"     value={registro?.vlan ?? undefined} />
            <Info label="ONU mode"          value={registro?.wanMode} />
            <Info label="Mgmt IP"           value={info?.mgmtIp ? <span className="font-mono">{info.mgmtIp}</span> : undefined} />
            <Info label="PPPoE username"    value={data?.ppp?.find(p => p.username)?.username
              ? <span className="font-mono">{data.ppp.find(p => p.username)!.username}</span> : undefined} />
            <Info label="Authorization date" value={registro?.createdAt ? new Date(registro.createdAt).toLocaleString('es-PE') : undefined} />
            <Info label="Último inform"     value={data?.lastInform ? new Date(data.lastInform).toLocaleString('es-PE') : undefined} />
            <Info label="Perfil soportado"  value={info?.profileMatched
              ? <span className="text-emerald-400">sí (edición habilitada)</span>
              : info ? <span className="text-amber-400">modelo sin perfil (solo lectura)</span> : undefined} />
          </div>
        </div>
      );
    }

    if (seccionBloqueada) {
      return (
        <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center space-y-1">
          <Signal className="w-6 h-6 mx-auto text-muted-foreground/40" />
          <p className="text-xs text-foreground font-medium">Requiere la sesión TR-069 activa</p>
          <p className="text-[11px] text-muted-foreground">La ONU no está informando a GenieACS. Activa el carril TR-069 y pulsa «Refresh interfaces».</p>
        </div>
      );
    }

    if (seccion.key === 'ppp') {
      return (
        <div className="space-y-2">
          {data?.ppp?.length ? data.ppp.map(p => (
            <div key={p.index} className="text-[11px] text-muted-foreground">
              WAN {p.index}: <span className="text-foreground font-mono">{p.username ?? '—'}</span>
              {p.connectionStatus && <span className={cn('ml-2 px-1.5 rounded border', p.connectionStatus === 'Connected' ? 'text-emerald-400 border-emerald-700/40 bg-emerald-500/10' : 'text-amber-400 border-amber-700/40 bg-amber-500/10')}>{p.connectionStatus}</span>}
              {p.externalIp && <span className="ml-2 font-mono">{p.externalIp}</span>}
            </div>
          )) : <p className="text-[11px] text-muted-foreground italic">Sin conexión PPPoE instanciada en la ONU.</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <div>
              <label className="text-[10px] text-muted-foreground">Usuario PPPoE</label>
              <input value={pppUser} onChange={e => setPppUser(e.target.value)} placeholder="usuario" className={INPUT} />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Clave PPPoE (vacío = sin cambio)</label>
              <div className="relative">
                <input type={showPppPass ? 'text' : 'password'} value={pppPass} onChange={e => setPppPass(e.target.value)}
                  placeholder="••••••••" className={cn(INPUT, 'pr-8')} />
                <button type="button" onClick={() => setShowPppPass(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPppPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
          <button onClick={() => pppMut.mutate()} disabled={pppMut.isPending || (!pppUser && !pppPass)} className={cn(BTN_OUTLINE, 'ml-auto')}>
            {pppMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Aplicar PPPoE
          </button>
        </div>
      );
    }
    if (seccion.key === 'wlan1') return <WifiEditor sn={sn} band="2.4" current={data?.wifi?.find(w => w.band === '2.4')} onSaved={() => refetch()} />;
    if (seccion.key === 'wlan5') return <WifiEditor sn={sn} band="5" current={data?.wifi?.find(w => w.band === '5')} onSaved={() => refetch()} />;
    if (seccion.key === 'hosts') return <HostsSection hosts={data?.hosts ?? []} />;
    if (seccion.key === 'security') {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <KeyRound className="w-3.5 h-3.5 text-primary" /> Credenciales de acceso web (admin de la ONU)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Usuario admin</label>
              <input value={webAdminUser} onChange={e => setWebAdminUser(e.target.value)} placeholder="telecomadmin" className={INPUT} />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Nueva clave admin (vacío = sin cambio)</label>
              <div className="relative">
                <input type={showWebPass ? 'text' : 'password'} value={webAdminPass} onChange={e => setWebAdminPass(e.target.value)}
                  placeholder="••••••••" className={cn(INPUT, 'pr-8')} />
                <button type="button" onClick={() => setShowWebPass(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showWebPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
          <button onClick={() => webMut.mutate()} disabled={webMut.isPending || (!webAdminUser && !webAdminPass)} className={cn(BTN_OUTLINE, 'ml-auto')}>
            {webMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Aplicar acceso web
          </button>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-card border border-border rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
          <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <Radio className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">ONU / Router</span>
              <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-border', ESTADO_CLS[estadoTxt] ?? 'text-foreground')}>
                <span className={cn('w-1.5 h-1.5 rounded-full', ESTADO_DOT[estadoTxt] ?? 'bg-muted-foreground')} /> {estadoTxt}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground truncate">
              <span className="font-mono">{sn}</span>
              {cliente && <><span className="text-border">·</span><span className="truncate">{cliente}</span></>}
            </div>
          </div>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent flex-shrink-0"><X className="w-4 h-4" /></button>
        </div>

        {/* ── Vitals: datos clave siempre visibles (ERP/OLT, no dependen de TR-069) ── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 md:gap-y-3 px-5 py-1.5 md:py-2.5 border-b border-border bg-muted/20 flex-shrink-0">
          <Vital label="OLT / Pos">{oltNombre ?? '—'} · 0/{slot ?? '–'}/{port ?? '–'}{onuId != null ? `·${onuId}` : ''}</Vital>
          <div className="hidden sm:block w-px self-stretch bg-border/60 flex-shrink-0" />
          <div className="flex flex-col gap-0.5 flex-shrink-0">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">Señal FTTH (Rx)</span>
            {/* Compacto en móvil, normal en escritorio */}
            <div className="md:hidden">
              <SenalFtthValor rxDbm={rxDbm} oltRxDbm={oltRxDbm} cargando={metricasFetching}
                puedeLeer={puedeLeerMetricas} onLeer={() => refetchMetricas()} compact />
            </div>
            <div className="hidden md:block">
              <SenalFtthValor rxDbm={rxDbm} oltRxDbm={oltRxDbm} cargando={metricasFetching}
                puedeLeer={puedeLeerMetricas} onLeer={() => refetchMetricas()} />
            </div>
          </div>
          <div className="hidden sm:block w-px self-stretch bg-border/60 flex-shrink-0" />
          <Vital label="TR-069">
            {informing
              ? <span className="inline-flex items-center gap-1 text-emerald-400"><Signal className="w-3 h-3" /> Online</span>
              : <span className="text-amber-400">sin informar</span>}
          </Vital>
          <div className="hidden sm:block w-px self-stretch bg-border/60 flex-shrink-0" />
          <Vital label="Uptime">
            {informing ? <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3 text-muted-foreground" /> {fmtUptime(info?.uptimeSeconds)}</span> : '—'}
          </Vital>
        </div>

        {/* ── Barra de acciones ── */}
        <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-border flex-shrink-0">
          <button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending || isFetching || !informing} className={BTN_OUTLINE}>
            {(refreshMut.isPending || isFetching) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Refresh interfaces
          </button>
          {informing && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className={cn('w-1.5 h-1.5 rounded-full', refreshMut.isPending ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-400/60')} />
              Auto-actualiza cada {AUTO_REFRESH_MS / 1000}s
            </span>
          )}

          {/* Toggle del carril TR-069 — solo para ONUs con registro FTTH (proveedor nativo) */}
          {contratoId && (
            <button
              onClick={() => carrilMut.mutate()}
              disabled={carrilMut.isPending || carrilTransitorio}
              title={carrilActivo
                ? 'Quitar la interface TR-069 de la ONU (conserva los datos ACS)'
                : 'Crear la interface TR-069 en la ONU y escribir los datos ACS'}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
                carrilActivo
                  ? 'border-emerald-700/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  : carril === 'activacion_fallida' || carril === 'desactivacion_fallida'
                    ? 'border-amber-700/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                    : 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/15',
              )}
            >
              {(carrilMut.isPending || carrilTransitorio)
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {carril === 'desactivando' ? 'Desactivando…' : 'Activando… (~1-5 min)'}</>
                : carrilActivo
                  ? <><Signal className="w-3.5 h-3.5" /> Desactivar TR-069</>
                  : carril === 'activacion_fallida' || carril === 'desactivacion_fallida'
                    ? <><Signal className="w-3.5 h-3.5" /> Reintentar TR-069</>
                    : <><Signal className="w-3.5 h-3.5" /> Activar TR-069</>
              }
            </button>
          )}

          <div className="flex-1" />

          <button onClick={() => setPending('olt_reset')} disabled={oltResetMut.isPending || !puedeLeerMetricas}
            title="Reinicia la ONU por la OLT (ont reset) — funciona aunque no esté informando a TR-069"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-orange-500/50 text-orange-500 hover:bg-orange-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {oltResetMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Reiniciar (OLT)
          </button>
          <button onClick={() => setPending('reboot')} disabled={rebootMut.isPending || !informing}
            title="Reinicia la ONU por TR-069 (requiere que esté informando a GenieACS)"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-orange-500 hover:bg-orange-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Power className="w-3.5 h-3.5" /> Reboot (TR-069)
          </button>
          <button onClick={() => setPending('factory')} disabled={factoryMut.isPending || !informing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-destructive hover:bg-destructive/90 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <RotateCcw className="w-3.5 h-3.5" /> Reset to factory
          </button>
        </div>

        {/* Confirmación de acciones destructivas */}
        {pending && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-destructive/5 flex-shrink-0">
            <span className="text-xs text-foreground flex-1">
              {pending === 'reboot'
                ? `¿Reiniciar la ONU ${sn} por TR-069? Perderá conexión ~1 min.`
                : pending === 'olt_reset'
                  ? `¿Reiniciar la ONU ${sn} desde la OLT (ont reset)? Perderá conexión ~1 min.`
                  : `¿RESET DE FÁBRICA de la ONU ${sn}? Se borrará TODA su configuración.`}
            </span>
            <button onClick={() => setPending(null)} className={BTN_OUTLINE}>Cancelar</button>
            <button
              onClick={() => { (pending === 'reboot' ? rebootMut : pending === 'olt_reset' ? oltResetMut : factoryMut).mutate(); setPending(null); }}
              className={cn('px-3 py-1.5 text-xs font-semibold rounded-md text-white',
                pending === 'factory' ? 'bg-destructive hover:bg-destructive/90' : 'bg-orange-500 hover:bg-orange-600')}
            >
              {pending === 'factory' ? 'Sí, resetear' : 'Sí, reiniciar'}
            </button>
          </div>
        )}

        {/* ── Cuerpo: nav de secciones + contenido ──
            Escritorio (≥md): nav lateral fija + panel de contenido a la derecha.
            Móvil (<md): ACORDEÓN — la nav ocupa el ancho y el contenido de la sección activa
            se despliega INLINE debajo de su opción; al elegir otra, la anterior se recoge. */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0">
          {/* Nav de secciones (acordeón en móvil, sidebar en escritorio) */}
          <nav className="flex flex-col md:w-56 md:flex-shrink-0 border-b md:border-b-0 md:border-r border-border overflow-y-auto bg-muted/10 md:py-1.5">
            {SECCIONES.map(({ key, label, icon: Icon, real }) => {
              const activo = key === active;
              return (
                <div key={key}>
                  <button onClick={() => setActive(key)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3.5 py-2.5 md:py-2 text-left transition-colors border-l-2',
                      activo
                        ? 'bg-primary/10 border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                    )}>
                    <Icon className={cn('w-4 h-4 flex-shrink-0', activo ? 'text-primary' : '')} />
                    <span className="flex-1 text-[11px] truncate">{label}</span>
                    {!real && (
                      <span className="text-[8px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded border border-dashed border-border/70 text-muted-foreground/60">
                        maq
                      </span>
                    )}
                    {/* Chevron de acordeón (solo móvil) */}
                    <span className="md:hidden text-muted-foreground flex-shrink-0">
                      {activo ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </span>
                  </button>

                  {/* Contenido desplegado INLINE — solo móvil */}
                  {activo && (
                    <div className="md:hidden px-4 py-3 bg-background border-b border-border/60">
                      {isLoading
                        ? <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                        : <>{renderContenido()}{firmwareExtra}</>}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Panel de contenido — solo escritorio */}
          <div className="hidden md:block flex-1 overflow-y-auto min-w-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="px-5 py-4">
                <SeccionHeader icon={SecIcon} label={seccion.label} hint={!seccion.real ? 'maqueta' : undefined} />
                {renderContenido()}
                {firmwareExtra}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
