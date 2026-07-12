'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Radio, X, Zap, RefreshCcw, Power, RotateCcw, Wifi, Globe,
  Loader2, Save, Eye, EyeOff, Signal, Clock,
} from 'lucide-react';
import { oltNativoApi, type OnuTr069Detalle, type OnuWifiBand } from '@/lib/api/olt-nativo';
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

// ── Componente principal ───────────────────────────────────────
export function OnuDetalleTr069Modal({ sn, oltNombre, cliente, onClose }: {
  sn: string; oltNombre?: string; cliente?: string | null; onClose: () => void;
}) {
  const { toast } = useToast();
  const [live, setLive] = useState(false);
  const [pppUser, setPppUser] = useState('');
  const [pppPass, setPppPass] = useState('');
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
              <button onClick={() => { if (confirm(`¿Reiniciar la ONU ${sn}?`)) rebootMut.mutate(); }} disabled={rebootMut.isPending}
                className={cn(BTN_OUTLINE, 'border-orange-500/40 text-orange-400 hover:bg-orange-500/10')}>
                {rebootMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />} Reboot
              </button>
              <button onClick={() => { if (confirm(`¿RESET DE FÁBRICA de la ONU ${sn}? Se perderá toda su configuración.`)) factoryMut.mutate(); }} disabled={factoryMut.isPending}
                className={cn(BTN_OUTLINE, 'border-destructive/50 text-destructive hover:bg-destructive/10')}>
                {factoryMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Reset de fábrica
              </button>
            </div>

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
                  <input type="password" value={pppPass} onChange={e => setPppPass(e.target.value)} placeholder="••••••••" className={INPUT} />
                </div>
              </div>
              <button onClick={() => pppMut.mutate()} disabled={pppMut.isPending || (!pppUser && !pppPass)} className={cn(BTN_OUTLINE, 'ml-auto')}>
                {pppMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Aplicar PPPoE
              </button>
            </div>

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
