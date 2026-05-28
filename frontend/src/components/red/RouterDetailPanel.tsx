'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X, Cpu, Clock, Users, Radio, Network,
  Wifi, WifiOff, Loader2, Globe, MemoryStick,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Router as RouterType } from '@/lib/api/mikrotik';
import { redesApi } from '@/lib/api/contratos';

type PanelTab = 'hardware' | 'equipos' | 'segmentos';

interface Props {
  router: RouterType;
  onClose: () => void;
}

function MetricCard({
  label, icon: Icon, value, unit, color, barPct, barColor,
}: {
  label: string; icon: any; value: string | number | null | undefined;
  unit?: string; color: string; barPct?: number; barColor?: string;
}) {
  return (
    <div className="bg-white/3 border border-white/8 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <Icon className="w-3.5 h-3.5" />{label}
        </span>
        <span className={cn('text-xl font-bold', color)}>
          {value != null ? `${value}${unit ?? ''}` : '—'}
        </span>
      </div>
      {barPct != null ? (
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(barPct, 100)}%`, background: barColor ?? '#22c55e' }}
          />
        </div>
      ) : (
        <div className="h-2 bg-white/5 rounded-full" />
      )}
    </div>
  );
}

function pctColor(v: number, warnAt: number, critAt: number): string {
  return v >= critAt ? '#ef4444' : v >= warnAt ? '#f59e0b' : '#22c55e';
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const ESTADO_DOT: Record<string, string> = {
  online:        'bg-green-400',
  offline:       'bg-red-400',
  degradado:     'bg-yellow-400',
  mantenimiento: 'bg-orange-400',
  reverificando: 'bg-blue-400',
  desconocido:   'bg-gray-500',
};

export function RouterDetailPanel({ router, onClose }: Props) {
  const [tab, setTab] = useState<PanelTab>('hardware');

  const { data: antenas = [], isLoading: loadingAntenas } = useQuery({
    queryKey:  ['router-antenas', router.id],
    queryFn:   () => redesApi.listAntenasAP(router.id),
    staleTime: 60_000,
    enabled:   tab === 'equipos',
  });

  const { data: segmentos = [], isLoading: loadingSegmentos } = useQuery({
    queryKey:  ['router-segmentos', router.id],
    queryFn:   () => redesApi.listSegmentos(router.id),
    staleTime: 60_000,
    enabled:   tab === 'segmentos',
  });

  const uptimeDisplay =
    router.uptimeStr ??
    (router.uptimeSegundos ? formatUptime(router.uptimeSegundos) : null);

  const tabs = [
    { id: 'hardware'  as PanelTab, label: 'Hardware'          },
    { id: 'equipos'   as PanelTab, label: 'Equipos'           },
    { id: 'segmentos' as PanelTab, label: 'Segmentos IPv4'    },
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />

      <div
        className="relative w-full max-w-lg bg-zinc-900 border-l border-white/10 flex flex-col h-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', ESTADO_DOT[router.estado] ?? 'bg-gray-500')} />
            <div className="min-w-0">
              <h2 className="font-semibold text-white text-base truncate">{router.nombre}</h2>
              <p className="text-xs text-gray-500 font-mono truncate">
                {router.ipGestion}
                {router.vpnIp ? ` · VPN ${router.vpnIp}` : ''}
                {router.modelo ? ` · ${router.modelo}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-3 flex-shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Tabs ────────────────────────────────────────── */}
        <div className="flex border-b border-white/10 flex-shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-5 py-3 text-xs font-medium transition-colors border-b-2 -mb-px',
                tab === t.id
                  ? 'text-primary border-primary'
                  : 'text-gray-500 border-transparent hover:text-gray-300',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Body ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── Hardware ──────────────────────────────────── */}
          {tab === 'hardware' && (
            <div className="space-y-4">

              {/* Estado + firmware */}
              <div className="flex items-center justify-between">
                <span className={cn(
                  'flex items-center gap-1.5 text-sm font-medium capitalize',
                  router.estado === 'online' ? 'text-green-400' :
                  router.estado === 'offline' ? 'text-red-400' :
                  router.estado === 'degradado' ? 'text-yellow-400' : 'text-gray-400',
                )}>
                  {router.estado === 'online'
                    ? <Wifi className="w-4 h-4" />
                    : <WifiOff className="w-4 h-4" />}
                  {router.estado}
                </span>
                {router.versionFirmware && (
                  <span className="text-xs text-gray-600 font-mono">ROS {router.versionFirmware}</span>
                )}
              </div>

              {/* CPU + RAM */}
              <div className="grid grid-cols-2 gap-3">
                <MetricCard
                  label="CPU"
                  icon={Cpu}
                  value={router.cpuUsoPct != null ? router.cpuUsoPct.toFixed(0) : null}
                  unit="%"
                  color={router.cpuUsoPct == null ? 'text-gray-600' :
                    router.cpuUsoPct > 80 ? 'text-red-400' :
                    router.cpuUsoPct > 50 ? 'text-yellow-400' : 'text-green-400'}
                  barPct={router.cpuUsoPct ?? undefined}
                  barColor={router.cpuUsoPct != null ? pctColor(router.cpuUsoPct, 50, 80) : undefined}
                />
                <MetricCard
                  label="RAM"
                  icon={MemoryStick}
                  value={router.memoriaUsoPct != null ? router.memoriaUsoPct.toFixed(0) : null}
                  unit="%"
                  color={router.memoriaUsoPct == null ? 'text-gray-600' :
                    router.memoriaUsoPct > 85 ? 'text-red-400' :
                    router.memoriaUsoPct > 65 ? 'text-yellow-400' : 'text-green-400'}
                  barPct={router.memoriaUsoPct ?? undefined}
                  barColor={router.memoriaUsoPct != null ? pctColor(router.memoriaUsoPct, 65, 85) : undefined}
                />
              </div>

              {/* Uptime + PPPoE */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/3 border border-white/8 rounded-xl p-4">
                  <p className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
                    <Clock className="w-3.5 h-3.5" />Uptime
                  </p>
                  <p className="text-base font-semibold text-white">
                    {uptimeDisplay ?? <span className="text-gray-600">—</span>}
                  </p>
                </div>

                <div className="bg-white/3 border border-white/8 rounded-xl p-4">
                  <p className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
                    <Users className="w-3.5 h-3.5" />Sesiones PPPoE
                  </p>
                  <p className={cn(
                    'text-2xl font-bold',
                    router.totalSesionesPppoe == null ? 'text-gray-600' :
                    router.totalSesionesPppoe > 0 ? 'text-primary' : 'text-gray-500',
                  )}>
                    {router.totalSesionesPppoe ?? '—'}
                  </p>
                </div>
              </div>

              {/* Info adicional */}
              <div className="bg-white/3 border border-white/8 rounded-xl p-4 space-y-2">
                {[
                  { label: 'Identity',   value: router.identityRouteros, mono: true  },
                  { label: 'Latencia',   value: router.latenciaMs != null ? `${router.latenciaMs}ms` : null },
                  { label: 'Zona',       value: router.zona },
                  { label: 'Ubicación',  value: router.ubicacion },
                  { label: 'Tipo ctrl',  value: router.tipoControl !== 'ninguna' ? router.tipoControl : null },
                ].filter((r) => r.value).map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-2 text-xs">
                    <span className="text-gray-500 flex-shrink-0">{row.label}</span>
                    <span className={cn('text-white text-right', row.mono && 'font-mono')}>
                      {row.value}
                    </span>
                  </div>
                ))}
                {!router.identityRouteros && !router.zona && !router.ubicacion && !router.latenciaMs && (
                  <p className="text-xs text-gray-600 text-center py-2">Sin datos adicionales aún</p>
                )}
              </div>

            </div>
          )}

          {/* ── Equipos vinculados ─────────────────────────── */}
          {tab === 'equipos' && (
            <div className="space-y-3">
              {loadingAntenas ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : antenas.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-center">
                  <Radio className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-sm">Sin equipos vinculados</p>
                  <p className="text-xs mt-1 text-gray-600">
                    Asocia antenas AP desde Monitoreo → Dispositivos
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-gray-500">
                    {antenas.length} equipo{antenas.length !== 1 ? 's' : ''} vinculado{antenas.length !== 1 ? 's' : ''}
                  </p>
                  <div className="overflow-hidden rounded-xl border border-white/10">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wider">
                          <th className="text-left px-3 py-2.5">Equipo</th>
                          <th className="text-left px-3 py-2.5">IP</th>
                          <th className="text-left px-3 py-2.5">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {antenas.map((a) => (
                          <tr key={a.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-white">{a.nombreEmisor}</div>
                              <div className="text-gray-600 capitalize">{a.tipoEquipo}</div>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-gray-300">{a.ipAddress}</td>
                            <td className="px-3 py-2.5">
                              <span className={cn(
                                'flex items-center gap-1 capitalize',
                                a.status === 'online'  ? 'text-green-400' :
                                a.status === 'offline' ? 'text-red-400'   : 'text-gray-500',
                              )}>
                                {a.status === 'online'
                                  ? <Wifi className="w-3 h-3" />
                                  : <WifiOff className="w-3 h-3" />}
                                {a.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Segmentos IPv4 ─────────────────────────────── */}
          {tab === 'segmentos' && (
            <div className="space-y-3">
              {loadingSegmentos ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : segmentos.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-center">
                  <Network className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-sm">Sin segmentos asignados</p>
                  <p className="text-xs mt-1 text-gray-600">
                    Asigna subredes desde Red → Segmentos
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-gray-500">
                    {segmentos.length} segmento{segmentos.length !== 1 ? 's' : ''} asignado{segmentos.length !== 1 ? 's' : ''}
                  </p>
                  <div className="space-y-3">
                    {segmentos.map((s) => {
                      const pctUsado  = s.totalIps > 0 ? Math.round((s.ipsUsadas / s.totalIps) * 100) : 0;
                      const pctLibre  = 100 - pctUsado;
                      return (
                        <div key={s.id} className="bg-white/3 border border-white/8 rounded-xl p-4 space-y-3">
                          {/* Nombre + estado */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white truncate">{s.nombre}</p>
                              <p className="text-xs font-mono text-blue-400 mt-0.5">{s.redCidr}</p>
                            </div>
                            <span className={cn(
                              'flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full border',
                              s.activo
                                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                                : 'bg-gray-500/10 border-gray-500/20 text-gray-500',
                            )}>
                              {s.activo ? 'Activo' : 'Inactivo'}
                            </span>
                          </div>

                          {/* Barra de uso */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-[10px] text-gray-500">
                              <span>{s.ipsUsadas} ocupadas</span>
                              <span>{s.ipsDisponibles} disponibles · {s.totalIps} total</span>
                            </div>
                            <div className="h-2.5 bg-white/10 rounded-full overflow-hidden flex">
                              <div
                                className="h-full bg-primary/80 transition-all duration-500"
                                style={{ width: `${pctUsado}%` }}
                                title={`${pctUsado}% ocupadas`}
                              />
                              <div
                                className="h-full bg-emerald-500/30 transition-all duration-500"
                                style={{ width: `${pctLibre}%` }}
                                title={`${pctLibre}% disponibles`}
                              />
                            </div>
                            <div className="flex gap-3 text-[10px] text-gray-600">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-sm bg-primary/80 inline-block" />
                                Ocupadas {pctUsado}%
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-sm bg-emerald-500/30 inline-block" />
                                Disponibles {pctLibre}%
                              </span>
                            </div>
                          </div>

                          {/* Gateway + VLAN */}
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-600">
                              GW <span className="font-mono text-gray-400">{s.gateway}</span>
                            </span>
                            {s.vlanId && (
                              <span className="text-gray-600">VLAN <span className="text-gray-400">{s.vlanId}</span></span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

        </div>

        {/* ── Footer ──────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2 text-[10px] text-gray-600">
            <Globe className="w-3 h-3" />
            {router.subnetsLocales?.length
              ? router.subnetsLocales.join(', ')
              : 'Sin redes LAN sincronizadas'}
          </div>
        </div>
      </div>
    </div>
  );
}
