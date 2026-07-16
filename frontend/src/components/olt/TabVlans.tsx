'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Network } from 'lucide-react';
import { oltNativoApi, type OltVlan } from '@/lib/api/olt-nativo';
import { cn } from '@/lib/utils';

// VLANs de la OLT — SOLO INFORMATIVO (directriz: el ERP no es un gestor de
// configuración de OLTs). Las VLANs del ERP se declaran en el Baseline y las
// crea el plan de convergencia; las preexistentes solo se observan.
export function TabVlans({ oltId }: { oltId: string }) {
  const { data: vlans = [], isLoading } = useQuery<OltVlan[]>({
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
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Network className="w-8 h-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">
          Sin VLANs sincronizadas — usa &quot;Sincronizar&quot; para cargar el estado de la OLT.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {['VLAN', 'Nombre', 'Tipo', 'Service-ports en uso', 'Origen'].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vlans.map(v => (
              <tr key={v.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                <td className="px-4 py-2.5 font-mono font-semibold text-primary">{v.vlanId}</td>
                <td className="px-4 py-2.5 font-mono">{v.nombre}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{v.tipo ?? '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{v.servPorts ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={cn(
                    'inline-flex rounded-full border px-2 py-0.5 text-[11px]',
                    v.origen === 'erp'
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground',
                  )}>
                    {v.origen === 'erp' ? 'ERP (DataFast)' : 'Preexistente'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border bg-muted/20">
          {vlans.length} VLAN(s) — estado sincronizado de la OLT
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Vista informativa. Las VLANs del ERP se declaran en el Baseline y se crean desde el plan
        de convergencia (tab Cumplimiento); las preexistentes nunca se modifican.
      </p>
    </div>
  );
}
