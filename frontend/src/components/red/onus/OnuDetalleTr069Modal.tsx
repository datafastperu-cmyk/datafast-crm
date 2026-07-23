'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Radio, X, Zap, RefreshCcw, Power, RotateCcw, Wifi, Globe, Download,
  Loader2, Save, Eye, EyeOff, Signal, Clock, KeyRound, Monitor, Cable,
  ChevronRight, ChevronDown, Home, Network, Server, BarChart2, Shield,
  Phone, Settings, Search, ScrollText, Lock,
} from 'lucide-react';
import { oltNativoApi, type OnuTr069Detalle, type OnuWifiBand, type OnuHost, type FtthOnuRegistro } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { clasificarSenalFtth } from '@/lib/senal-ftth';

// ─────────────────────────────────────────────────────────────
// Modal "Ver detalle ONU" — layout unificado con la vista ONU/Router.
//
// Convención innegociable de esta pantalla: NUNCA se muestran datos inventados. Lo que hay
// se lee de la sesión TR-069 real (GenieACS), del registro FTTH o del inventario de la OLT.
// Lo que todavía no tiene backend se marca de forma explícita como «Pendiente de integración»
// y se deja inerte — un operador no debe poder confundir una maqueta con el estado real de
// la ONU de un cliente.
// ─────────────────────────────────────────────────────────────

const BTN_OUTLINE = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-border text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const INPUT = 'w-full px-2.5 py-1.5 text-xs border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

// Botón presente en el diseño pero sin backend todavía. Inerte y visiblemente marcado.
const BTN_MAQUETA = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-dashed border-border/70 text-muted-foreground/70 cursor-not-allowed';

function Info({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-[11px] text-muted-foreground min-w-[128px] flex-shrink-0">{label}</span>
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
  const [live, setLive] = useState(false);
  const [pppUser, setPppUser] = useState('');
  const [pppPass, setPppPass] = useState('');
  const [showPppPass, setShowPppPass] = useState(false);
  const [webAdminUser, setWebAdminUser] = useState('');
  const [webAdminPass, setWebAdminPass] = useState('');
  const [showWebPass, setShowWebPass] = useState(false);
  const [pending, setPending] = useState<'reboot' | 'factory' | null>(null);
  const [expanded, setExpanded] = useState<string | null>('general');
  const [fwFile, setFwFile] = useState('');
  const initRan = useRef(false);

  const { data, isLoading, refetch, isFetching } = useQuery<OnuTr069Detalle>({
    queryKey: ['onu-tr069', sn],
    queryFn:  () => oltNativoApi.onuTr069Detalle(sn),
    staleTime: 0,
  });

  // Registro FTTH del ERP: aporta lo que TR-069 no sabe (VLAN de servicio, modo WAN,
  // fecha de autorización, service-ports). Solo si la ONU está ligada a un contrato.
  const { data: registro } = useQuery<FtthOnuRegistro | null>({
    queryKey: ['ftth-estado', contratoId],
    queryFn:  () => oltNativoApi.ftthEstado(contratoId!),
    enabled:  Boolean(contratoId),
    staleTime: 30_000,
  });

  // Posición EFECTIVA de la ONU para leer la señal. El registro FTTH es la fuente
  // autoritativa y ACTUAL: al re-aprovisionar, el `onu_id` cambia (p.ej. 43→44) pero el
  // inventario (read-model del último sync) puede seguir mostrando el viejo. Leer la óptica
  // con un onu_id que ya no existe devuelve vacío. Por eso, si hay registro, mandan sus
  // slot/port/onuId; el inventario queda de respaldo para ONUs sin registro (p.ej. SmartOLT).
  const effSlot  = registro?.slot  ?? slot;
  const effPort  = registro?.port  ?? port;
  const effOnuId = registro?.onuId ?? onuId;

  // Señal óptica EN VIVO (display ont optical-info). El inventario no la guarda, así que se
  // lee directo de la OLT al abrir el modal. Independiente de TR-069: la potencia Rx la mide
  // la OLT en el puerto GPON, así que hay lectura aunque la ONU no informe a GenieACS.
  // Si la ONU tiene contrato, se espera a que el registro resuelva (undefined → cargando)
  // antes de leer, para no gastar una lectura óptica con el onu_id viejo del inventario.
  const registroListo = !contratoId || registro !== undefined;
  const puedeLeerMetricas = Boolean(oltId && effSlot != null && effPort != null && effOnuId != null);
  const { data: metricas, isFetching: metricasFetching, refetch: refetchMetricas } = useQuery({
    queryKey: ['onu-metricas', oltId, effSlot, effPort, effOnuId],
    queryFn:  () => oltNativoApi.metricas(oltId!, { slot: effSlot!, port: effPort!, onuId: effOnuId!, sn }),
    enabled:  puedeLeerMetricas && registroListo,
    // Refresco cada 10 s mientras el modal está abierto. `refetchIntervalInBackground:false`
    // detiene el sondeo si la pestaña pasa a segundo plano — cada lectura es una sesión SSH
    // real contra la OLT (VTY concurrentes limitadas), así que no se martillea en vano.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    staleTime: 8_000,
  });
  // La señal en vivo manda; el valor del inventario (si lo hubiera) queda de respaldo.
  const rxDbm = metricas?.rxPowerDbm ?? rxPowerDbm ?? null;
  const senal = clasificarSenalFtth(rxDbm);

  const refreshMut = useMutation({
    mutationFn: () => oltNativoApi.onuTr069Refresh(sn),
    onSuccess: () => refetch(),
  });

  useEffect(() => {
    if (!initRan.current) { initRan.current = true; refreshMut.mutate(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => refreshMut.mutate(), 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

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
  const toggle = (k: string) => setExpanded(p => (p === k ? null : k));

  // Secciones del acordeón. `real` marca las que ya tienen backend; el resto se maqueta.
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-4xl my-4 bg-card border border-border rounded-xl shadow-xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">ONU / Router</span>
            <span className="text-xs font-mono text-muted-foreground">{sn}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>

        {/* ── Panel de info (siempre visible: sale del ERP/OLT, no depende de TR-069) ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-b border-border">
          <div className="px-5 py-4 border-b md:border-b-0 md:border-r border-border/60">
            <Info label="OLT"                value={oltNombre} />
            <Info label="Board"              value={slot ?? undefined} />
            <Info label="Port"               value={port ?? undefined} />
            <Info label="ONU"                value={onuId ?? undefined} />
            <Info label="SN"                 value={<span className="font-mono">{info?.serial ?? sn}</span>} />
            <Info label="ONU type"           value={info?.modelName ?? info?.productClass} />
            <Info label="Fabricante"         value={info?.manufacturer} />
            <Info label="Firmware"           value={info?.softwareVersion} />
            <Info label="Hardware"           value={info?.hardwareVersion} />
            <Info label="Name"               value={cliente ?? undefined} />
            <Info label="Authorization date" value={registro?.createdAt ? new Date(registro.createdAt).toLocaleString('es-PE') : undefined} />
          </div>

          <div className="px-5 py-4">
            <div className="flex justify-center mb-3">
              <div className="w-44 h-16 rounded-lg bg-muted/40 border border-border/60 flex items-center justify-center">
                <Radio className="w-8 h-8 text-muted-foreground/30" />
              </div>
            </div>
            <Info label="Status" value={estadoOperativo
              ? <span className={cn('font-semibold', ESTADO_CLS[estadoOperativo] ?? 'text-foreground')}>{estadoOperativo}</span>
              : undefined} />
            <Info label="Señal FTTH (Rx)" value={
              rxDbm != null ? (
                <span className="inline-flex items-center gap-2">
                  <span className={cn('font-mono font-semibold', senal.colorCls)}>{rxDbm.toFixed(2)} dBm</span>
                  <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', senal.badgeCls)}>
                    {senal.label}
                  </span>
                  {metricasFetching && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                </span>
              ) : metricasFetching ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> leyendo…</span>
              ) : puedeLeerMetricas ? (
                <button onClick={() => refetchMetricas()} className="text-[11px] text-primary hover:underline">Leer señal</button>
              ) : undefined
            } />
            <Info label="Attached VLANs" value={registro?.vlan ?? undefined} />
            <Info label="ONU mode" value={registro?.wanMode} />
            <Info label="TR069" value={informing
              ? <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold"><Signal className="w-3 h-3" /> Online</span>
              : <span className="text-amber-400">sin informar</span>} />
            <Info label="Mgmt IP" value={info?.mgmtIp ? <span className="font-mono">{info.mgmtIp}</span> : undefined} />
            <Info label="Uptime" value={informing ? <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3 text-muted-foreground" /> {fmtUptime(info?.uptimeSeconds)}</span> : undefined} />
            <Info label="Último inform" value={data?.lastInform ? new Date(data.lastInform).toLocaleString('es-PE') : undefined} />
            <Info label="PPPoE username" value={data?.ppp?.find(p => p.username)?.username
              ? <span className="font-mono">{data.ppp.find(p => p.username)!.username}</span> : undefined} />
          </div>
        </div>

        {/* ── Barra de acciones ── */}
        <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-border bg-muted/20">
          <button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending || isFetching || !informing} className={BTN_OUTLINE}>
            {(refreshMut.isPending || isFetching) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Refresh interfaces
          </button>
          <button type="button" disabled title="Pendiente de integración" className={BTN_MAQUETA}>Show running-config</button>
          <button type="button" disabled title="Pendiente de integración" className={BTN_MAQUETA}>SW info</button>
          <button type="button" disabled title="Pendiente de integración" className={BTN_MAQUETA}>TR069 Stat</button>
          <button onClick={() => setLive(v => !v)} disabled={!informing} className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
            live ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-muted text-muted-foreground hover:bg-accent border border-border',
          )}>
            <Zap className="w-3.5 h-3.5" /> LIVE{live ? '!' : ''}
          </button>
        </div>

        {/* Confirmación de acciones destructivas */}
        {pending && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-destructive/5">
            <span className="text-xs text-foreground flex-1">
              {pending === 'reboot'
                ? `¿Reiniciar la ONU ${sn}? Perderá conexión ~1 min.`
                : `¿RESET DE FÁBRICA de la ONU ${sn}? Se borrará TODA su configuración.`}
            </span>
            <button onClick={() => setPending(null)} className={BTN_OUTLINE}>Cancelar</button>
            <button
              onClick={() => { (pending === 'reboot' ? rebootMut : factoryMut).mutate(); setPending(null); }}
              className={cn('px-3 py-1.5 text-xs font-semibold rounded text-white',
                pending === 'reboot' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-destructive hover:bg-destructive/90')}
            >
              {pending === 'reboot' ? 'Sí, reiniciar' : 'Sí, resetear'}
            </button>
          </div>
        )}

        {/* ── Aviso cuando la ONU no informa: el acordeón vive de TR-069 ── */}
        {!isLoading && !informing && (
          <div className="px-5 py-6 text-center space-y-2 border-b border-border">
            <Radio className="w-7 h-7 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-foreground font-medium">La ONU no está informando a GenieACS</p>
            <p className="text-xs text-muted-foreground">
              Los datos de arriba salen del ERP y de la OLT. Para ver y editar su configuración en vivo
              hace falta el carril de gestión TR-069 activo (bootstrap DHCP Option 43).
            </p>
            <button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending} className={cn(BTN_OUTLINE, 'mx-auto mt-1')}>
              {refreshMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Reintentar
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        )}

        {/* ── Acordeón de secciones ── */}
        {!isLoading && (
          <div className="divide-y divide-border/60">
            {SECCIONES.map(({ key, label, icon: Icon, real, nota }) => {
              const open = expanded === key;
              const bloqueada = real && !informing;
              return (
                <div key={key}>
                  <button onClick={() => toggle(key)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors">
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 text-xs text-foreground">{label}</span>
                    {!real && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-dashed border-border/70 text-muted-foreground/70">
                        maqueta
                      </span>
                    )}
                    {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  {open && (
                    <div className="px-5 py-4 bg-muted/10 border-t border-border/40">
                      {!real ? (
                        <Maqueta nota={nota ?? 'Sección aún no integrada.'} />
                      ) : bloqueada ? (
                        <p className="text-[11px] text-muted-foreground italic">
                          Requiere que la ONU esté informando a GenieACS.
                        </p>
                      ) : key === 'general' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                          <div>
                            <Info label="Serial" value={<span className="font-mono">{info?.serial ?? sn}</span>} />
                            <Info label="Fabricante" value={info?.manufacturer} />
                            <Info label="Modelo" value={info?.modelName ?? info?.productClass} />
                          </div>
                          <div>
                            <Info label="Firmware" value={info?.softwareVersion} />
                            <Info label="Hardware" value={info?.hardwareVersion} />
                            <Info label="Perfil soportado" value={info?.profileMatched
                              ? <span className="text-emerald-400">sí (edición habilitada)</span>
                              : <span className="text-amber-400">modelo sin perfil (solo lectura)</span>} />
                          </div>
                        </div>
                      ) : key === 'ppp' ? (
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
                      ) : key === 'wlan1' ? (
                        <WifiEditor sn={sn} band="2.4" current={data?.wifi?.find(w => w.band === '2.4')} onSaved={() => refetch()} />
                      ) : key === 'wlan5' ? (
                        <WifiEditor sn={sn} band="5" current={data?.wifi?.find(w => w.band === '5')} onSaved={() => refetch()} />
                      ) : key === 'hosts' ? (
                        <HostsSection hosts={data?.hosts ?? []} />
                      ) : key === 'security' ? (
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
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── File Download (maqueta) ── */}
        <div className="flex items-center gap-3 px-4 py-3 border-t border-border bg-muted/10 flex-wrap">
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

        {/* ── Acciones finales ── */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-muted/10 flex-wrap">
          <button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending || isFetching || !informing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <RefreshCcw className="w-3.5 h-3.5" /> Refresh interfaces
          </button>
          <button onClick={() => setPending('reboot')} disabled={rebootMut.isPending || !informing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-orange-500 hover:bg-orange-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Power className="w-3.5 h-3.5" /> Reboot
          </button>
          <button onClick={() => setPending('factory')} disabled={factoryMut.isPending || !informing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-destructive hover:bg-destructive/90 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <RotateCcw className="w-3.5 h-3.5" /> Reset to factory
          </button>
        </div>
      </div>
    </div>
  );
}
