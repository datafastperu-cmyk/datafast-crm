'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Network } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';

export function TabVlans({ oltId }: { oltId: string }) {
  const { data: vlans = [], isLoading } = useQuery({
    queryKey: ['olt-vlans', oltId],
    queryFn:  () => oltNativoApi.listarVlans(oltId),
    enabled:  !!oltId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (vlans.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Network className="w-8 h-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Sin VLANs sincronizadas — usa &quot;Sincronizar&quot; para cargar</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">VLAN ID</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Nombre</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">Descripción</th>
          </tr>
        </thead>
        <tbody>
          {vlans.map((v) => (
            <tr key={v.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-primary">{v.vlanId}</td>
              <td className="px-4 py-2.5 text-sm text-foreground">{v.nombre}</td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                {v.descripcion ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border bg-muted/20">
        {vlans.length} VLANs
      </p>
    </div>
  );
}
