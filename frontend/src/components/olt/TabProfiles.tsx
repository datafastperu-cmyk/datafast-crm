'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Server } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { TrafficTablesSection } from '@/components/red/TopologiaTab';
import { cn } from '@/lib/utils';

type SubTab = 'line' | 'service' | 'traffic';

export function TabProfiles({ oltId }: { oltId: string }) {
  const [sub, setSub] = useState<SubTab>('line');

  const { data: lineProfiles = [], isLoading: loadingLine } = useQuery({
    queryKey: ['olt-line-profiles', oltId],
    queryFn:  () => oltNativoApi.getLineProfiles(oltId),
    enabled:  !!oltId,
  });

  const { data: srvProfiles = [], isLoading: loadingSrv } = useQuery({
    queryKey: ['olt-service-profiles', oltId],
    queryFn:  () => oltNativoApi.getServiceProfiles(oltId),
    enabled:  !!oltId,
  });

  const { data: trafficTables = [], isLoading: loadingTraffic } = useQuery({
    queryKey: ['olt-traffic-tables', oltId],
    queryFn:  () => oltNativoApi.listarTrafficTables(oltId),
    enabled:  !!oltId,
  });

  const isLoading = loadingLine || loadingSrv || loadingTraffic;

  const subTabCls = (id: SubTab) => cn(
    'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
    sub === id
      ? 'bg-muted text-foreground'
      : 'text-muted-foreground hover:text-foreground',
  );

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-lg p-1 w-fit">
        <button className={subTabCls('line')}    onClick={() => setSub('line')}>    Line ({lineProfiles.length})</button>
        <button className={subTabCls('service')} onClick={() => setSub('service')}>Service ({srvProfiles.length})</button>
        <button className={subTabCls('traffic')} onClick={() => setSub('traffic')}>Traffic ({trafficTables.length})</button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {sub === 'line' && (
            lineProfiles.length === 0 ? <EmptyProfiles label="perfiles de línea" /> : (
              <ProfileTable
                headers={['Profile ID', 'Nombre']}
                rows={lineProfiles.map(p => [String(p.profileId), p.nombre])}
              />
            )
          )}
          {sub === 'service' && (
            srvProfiles.length === 0 ? <EmptyProfiles label="perfiles de servicio" /> : (
              <ProfileTable
                headers={['Profile ID', 'Nombre']}
                rows={srvProfiles.map(p => [String(p.profileId), p.nombre])}
              />
            )
          )}
          {/* Gestión completa (sincronizar/crear/editar/eliminar) — antes tab standalone */}
          {sub === 'traffic' && <TrafficTablesSection oltId={oltId} />}
        </>
      )}
    </div>
  );
}

function EmptyProfiles({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <Server className="w-8 h-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">Sin {label} — usa &quot;Sincronizar&quot; para cargar</p>
    </div>
  );
}

function ProfileTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {headers.map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className={cn('px-4 py-2.5 text-sm', j === 0 ? 'font-mono font-semibold text-primary' : 'text-foreground')}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border bg-muted/20">
        {rows.length} entradas
      </p>
    </div>
  );
}
