'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Radio, X, Zap, RefreshCcw, Power, RotateCcw, Wifi, Globe,
  Loader2, Save, Eye, EyeOff, Signal, Clock, KeyRound, Monitor, Cable,
} from 'lucide-react';
import { oltNativoApi, type OnuTr069Detalle, type OnuWifiBand, type OnuHost } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const BTN_OUTLINE = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-border text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const INPUT = 'w-full px-2.5 py-1.5 text-xs border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

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
      if (r.ok) { toast(`WiFi ${band}GHz aplicado (${r.applied}/${r.total})`, { type: 'success' }); setPass(''); onSaved(); }
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
    <div className="px-5 py-4 space-y-2 border-t border-border">
      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <Monitor className="w-3.5 h-3.5 text-primary" /> Dispositivos conectados
        <span className="text-[10px] font-normal text-muted-foreground">({activos.length})</span>
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
                  <tr key={`${h.mac ?? i}`} className="border-t border-border/50">
                    <td className="px-2.5 py-1.5 text-foreground">{h.hostname || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2.5 py-1.5 font-mono text-muted-foreground">{h.ip || '—'}</td>
                    <td className="px-2.5 py-1.5 font-mono text-muted-foreground">{h.mac || '—'}</td>
                    <td className="px-2.5 py-1.5">
                      <span className={cn('inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded border', m.cls)}>
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

// ── Componente principal ───────────────────────────────────────
export function OnuDetalleTr069Modal({ sn, oltNombre, cliente, onClose }: {
  sn: string; oltNombre?: string; cliente?: string | null; onClose: () => void;
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
  const initRan = useRef(false);

  const { data, isLoading, refetch, isFetching } = useQuery<OnuTr069Detalle>({
    queryKey: ['onu-tr069', sn],
    queryFn:  () => oltNativoApi.onuTr069Detalle(sn),
    staleTime: 0,
  });

  const refreshMut = useMutation({
    mutationFn: () => oltNativoApi.onuTr069Refresh(sn),
    onSuccess: () => refetch(),
  });

  // Al abrir: dispara un ConnectionRequest para traer datos frescos (activar la sesión LIVE).
  useEffect(() => {
    if (!initRan.current) { initRan.current = true; refreshMut.mutate(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sesión LIVE: mientras esté activa, refresca cada 8s. Al cerrar el panel / apagar LIVE se detiene.
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
    onSuccess: (r) => { if (r.ok) { toast(`PPPoE aplicado (${r.applied}/${r.total})`, { type: 'success' }); setPppPass(''); refetch(); } else toast(`PPPoE: fallaron ${r.fallidas.join(', ')}`, { type: 'error' }); },
    onError: () => toast('No se pudo aplicar el PPPoE', { type: 'error' }),
  });
  const webMut = useMutation({
    mutationFn: () => oltNativoApi.onuTr069SetAccesoWeb(sn, { adminUser: webAdminUser || undefined, adminPassword: webAdminPass || undefined }),
    onSuccess: (r) => { if (r.ok) { toast(`Acceso web aplicado (${r.applied}/${r.total})`, { type: 'success' }); setWebAdminPass(''); } else toast(`Acceso web: fallaron ${r.fallidas.join(', ')}`, { type: 'error' }); },
    onError: () => toast('No se pudo cambiar el acceso web', { type: 'error' }),
  });

  const info = data?.info;
  const informing = data?.informing;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-3xl my-4 bg-card border border-border rounded-xl shadow-xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">ONU / Router</span>
            <span className="text-xs font-mono text-muted-foreground">{sn}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !informing ? (
          <div className="px-5 py-10 text-center space-y-2">
            <Radio className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-foreground font-medium">La ONU no está informando a GenieACS</p>
            <p className="text-xs text-muted-foreground">Requiere el carril de gestión TR-069 activo (bootstrap DHCP Option 43) para observarla/gestionarla en vivo.</p>
            <button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending} className={cn(BTN_OUTLINE, 'mx-auto mt-2')}>
              {refreshMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Reintentar
            </button>
          </div>
        ) : (
          <>
            {/* Panel de info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-b border-border">
              <div className="px-5 py-3 border-b md:border-b-0 md:border-r border-border/60">
                <Info label="Cliente" value={cliente ?? undefined} />
                <Info label="OLT" value={oltNombre} />
                <Info label="SN" value={<span className="font-mono">{info?.serial ?? sn}</span>} />
                <Info label="Fabricante" value={info?.manufacturer} />
                <Info label="Modelo" value={info?.modelName ?? info?.productClass} />
                <Info label="Firmware" value={info?.softwareVersion} />
                <Info label="Hardware" value={info?.hardwareVersion} />
              </div>
              <div className="px-5 py-3">
                <Info label="TR069" value={<span className="inline-flex items-center gap-1 text-emerald-400 font-semibold"><Signal className="w-3 h-3" /> Online</span>} />
                <Info label="Mgmt IP" value={info?.mgmtIp ? <span className="font-mono">{info.mgmtIp}</span> : undefined} />
                <Info label="Uptime" value={<span className="inline-flex items-center gap-1"><Clock className="w-3 h-3 text-muted-foreground" /> {fmtUptime(info?.uptimeSeconds)}</span>} />
                <Info label="Último inform" value={data?.lastInform ? new Date(data.lastInform).toLocaleString('es-PE') : undefined} />
                <Info label="Perfil soportado" value={info?.profileMatched
                  ? <span className="text-emerald-400">sí (edición habilitada)</span>
                  : <span className="text-amber-400">modelo sin perfil (solo lectura)</span>} />
              </div>
            </div>

            {/* Acciones */}
            <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-border bg-muted/20">
              <button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending || isFetching} className={BTN_OUTLINE}>
                {(refreshMut.isPending || isFetching) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />} Refresh interfaces
              </button>
              <button onClick={() => setLive(v => !v)} className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded transition-colors',
                live ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-muted text-muted-foreground hover:bg-accent border border-border',
              )}>
                <Zap className="w-3.5 h-3.5" /> LIVE{live ? '!' : ''}
              </button>
              <div className="flex-1" />
              <button onClick={() => setPending('reboot')} disabled={rebootMut.isPending}
                className={cn(BTN_OUTLINE, 'border-orange-500/40 text-orange-400 hover:bg-orange-500/10')}>
                {rebootMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />} Reboot
              </button>
              <button onClick={() => setPending('factory')} disabled={factoryMut.isPending}
                className={cn(BTN_OUTLINE, 'border-destructive/50 text-destructive hover:bg-destructive/10')}>
                {factoryMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Reset de fábrica
              </button>
            </div>

            {/* Confirmación de acciones destructivas (modal por estado — sin window.confirm) */}
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

            {/* WiFi */}
            <div className="px-5 py-4 space-y-5 border-b border-border">
              {(['2.4', '5'] as const).map(band => (
                <WifiEditor key={band} sn={sn} band={band}
                  current={data?.wifi?.find(w => w.band === band)}
                  onSaved={() => refetch()} />
              ))}
            </div>

            {/* PPP / PPPoE */}
            <div className="px-5 py-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Globe className="w-3.5 h-3.5 text-primary" /> PPP / PPPoE
              </div>
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

            {/* Credenciales de acceso web de la ONU */}
            <div className="px-5 py-4 space-y-2 border-t border-border">
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

            {/* Dispositivos conectados */}
            <HostsSection hosts={data?.hosts ?? []} />

            <div className="px-5 py-3 border-t border-border bg-muted/10">
              <p className="text-[10px] text-muted-foreground italic">
                Más secciones (LAN, Hosts, Voz, Site Survey, Logs, Firmware) se agregarán en próximas fases.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
