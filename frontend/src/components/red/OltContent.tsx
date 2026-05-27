'use client';

import { useState }   from 'react';
import { useQuery }   from '@tanstack/react-query';
import {
  Radio, Activity, AlertTriangle, Wifi, WifiOff,
  RefreshCw, Server, Signal, ChevronRight,
} from 'lucide-react';

import { smartoltApi, type EstadoOnu } from '@/lib/api/smartolt';
import { cn } from '@/lib/utils';

const oltEstadoColors = {
  online:        'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  offline:       'bg-red-500/15 text-red-400 border-red-500/30',
  mantenimiento: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  desconocido:   'bg-muted/40 text-muted-foreground border-border',
};

const onuEstadoColors: Record<EstadoOnu, string> = {
  sin_aprovisionar: 'bg-slate-500/15 text-slate-400',
  aprovisionada:    'bg-blue-500/15 text-blue-400',
  online:           'bg-emerald-500/15 text-emerald-400',
  offline:          'bg-red-500/15 text-red-400',
  error:            'bg-red-600/20 text-red-500 font-semibold',
  reemplazada:      'bg-muted/40 text-muted-foreground',
};

const onuEstadoLabels: Record<EstadoOnu, string> = {
  sin_aprovisionar: 'Sin provisionar',
  aprovisionada:    'Aprovisionada',
  online:           'Online',
  offline:          'Offline',
  error:            'Error',
  reemplazada:      'Reemplazada',
};

type TabKey = 'olts' | 'onus';

export function OltContent() {
  const [tab, setTab]         = useState<TabKey>('olts');
  const [selectedOlt, setOlt] = useState<string>('');
  const [filtroEstado, setFiltroEstado] = useState<EstadoOnu | ''>('');

  const { data: olts = [], isLoading: loadingOlts, refetch: refetchOlts } = useQuery({
    queryKey:  ['smartolt-olts'],
    queryFn:   smartoltApi.listarOlts,
    staleTime: 30_000,
  });

  const { data: onusResp, isLoading: loadingOnus, refetch: refetchOnus } = useQuery({
    queryKey:  ['smartolt-onus', selectedOlt, filtroEstado],
    queryFn:   () => smartoltApi.listarOnus({
      oltId:  selectedOlt  || undefined,
      estado: (filtroEstado as EstadoOnu) || undefined,
      limit:  50,
    }),
    staleTime: 30_000,
    enabled:   tab === 'onus',
  });

  const onus = (onusResp as any)?.data ?? [];

  const onlineCount  = olts.filter(o => o.estado === 'online').length;
  const offlineCount = olts.filter(o => o.estado === 'offline').length;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Red FTTH — OLTs</h2>
          <p className="text-sm text-muted-foreground">
            {olts.length} OLTs · {onlineCount} online · {offlineCount} offline
          </p>
        </div>
        <button
          onClick={() => { refetchOlts(); refetchOnus(); }}
          className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total OLTs',   value: olts.length,   color: 'text-foreground' },
          { label: 'Online',       value: onlineCount,   color: onlineCount > 0 ? 'text-emerald-500' : 'text-muted-foreground' },
          { label: 'Offline',      value: offlineCount,  color: offlineCount > 0 ? 'text-red-500' : 'text-muted-foreground' },
          { label: 'Total ONUs',   value: (onusResp as any)?.meta?.total ?? '—', color: 'text-blue-500' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
            <p className={cn('text-2xl font-bold tabular-nums', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-0">
        {([['olts', 'OLTs', Server], ['onus', 'ONUs', Signal]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key as TabKey)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {/* OLTs Table */}
      {tab === 'olts' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {loadingOlts ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Cargando OLTs...
            </div>
          ) : olts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Radio className="w-10 h-10 opacity-30" />
              <p className="text-sm">No hay OLTs registrados</p>
              <p className="text-xs">Configura tus OLTs en Ajustes → Red FTTH</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">OLT</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Marca / Modelo</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">IP</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Estado</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">SmartOLT ID</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Último Ping</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {olts.map((olt) => (
                    <tr
                      key={olt.id}
                      onClick={() => { setTab('onus'); setOlt(olt.id); }}
                      className="hover:bg-accent/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{olt.nombre}</div>
                        {olt.descripcion && (
                          <div className="text-xs text-muted-foreground">{olt.descripcion}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {olt.marca}{olt.modelo ? ` · ${olt.modelo}` : ''}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{olt.ipGestion ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border',
                          oltEstadoColors[olt.estado] ?? oltEstadoColors.desconocido,
                        )}>
                          {olt.estado === 'online' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                          {olt.estado}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{olt.smartoltId ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {olt.ultimoPing ? new Date(olt.ultimoPing).toLocaleString('es-PE') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ONUs Table */}
      {tab === 'onus' && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={selectedOlt}
              onChange={(e) => setOlt(e.target.value)}
              className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Todas las OLTs</option>
              {olts.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
            <select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value as EstadoOnu | '')}
              className="px-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Todos los estados</option>
              {Object.entries(onuEstadoLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {loadingOnus ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Cargando ONUs...
              </div>
            ) : onus.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Signal className="w-10 h-10 opacity-30" />
                <p className="text-sm">No hay ONUs que coincidan</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Serial / Nombre</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">OLT · Puerto</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Cliente</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Rx Power</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {onus.map((onu: any) => (
                      <tr key={onu.id} className="hover:bg-accent/40 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs">{onu.serialNumber}</div>
                          {onu.nombre && <div className="text-xs text-muted-foreground mt-0.5">{onu.nombre}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {onu.oltNombre ?? '—'}
                          {onu.puertoOlt ? ` · ${onu.puertoOlt}` : ''}
                        </td>
                        <td className="px-4 py-3">
                          {onu.clienteNombre ? (
                            <div className="text-sm">{onu.clienteNombre}</div>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Sin contrato</span>
                          )}
                          {onu.contratoNumero && (
                            <div className="text-xs text-primary font-mono">{onu.contratoNumero}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {onu.rxPowerDbm != null ? (
                            <span className={cn(
                              'text-xs font-mono',
                              onu.rxPowerDbm < -27 ? 'text-red-400' : onu.rxPowerDbm < -24 ? 'text-amber-400' : 'text-emerald-400',
                            )}>
                              {Number(onu.rxPowerDbm).toFixed(1)} dBm
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs', onuEstadoColors[onu.estado as EstadoOnu] ?? 'text-muted-foreground')}>
                            {onuEstadoLabels[onu.estado as EstadoOnu] ?? onu.estado}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
