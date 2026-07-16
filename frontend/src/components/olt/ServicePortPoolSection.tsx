'use client';

import { useQuery } from '@tanstack/react-query';
import { Hash, Info } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';

// Estado del pool de Service Port IDs — SOLO LECTURA.
// El rango canónico lo declara el Baseline Datafast Estándar y lo configura
// el plan de convergencia (operación configurar_pool_service_ports); el
// formulario manual de rango se eliminó para que el baseline sea la única
// fuente (directriz "inyectar desde cero"). Ampliaciones = nueva versión
// del baseline.
export function ServicePortPoolSection({ oltId }: { oltId: string }) {
  const { data: estado, isLoading } = useQuery({
    queryKey: ['service-port-pool', oltId],
    queryFn:  () => oltNativoApi.servicePortPoolEstado(oltId),
    enabled:  !!oltId,
  });

  const configurado = !!estado?.rango;

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Hash className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-semibold text-foreground">Pool de Service Port IDs</h4>
      </div>

      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        El ERP asigna automáticamente un Service Port ID libre de este pool a cada ONU
        aprovisionada (los IDs ya usados por otros sistemas quedan protegidos como ocupados).
        El rango lo define el <strong>Baseline Datafast Estándar</strong> y lo configura el plan
        de convergencia — para ampliarlo, crea una versión nueva del baseline en el tab Cumplimiento.
      </p>

      {isLoading ? (
        <div className="h-16 rounded-lg bg-muted/40 animate-pulse" />
      ) : configurado ? (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Rango',    value: `${estado!.rango!.min}–${estado!.rango!.max}` },
            { label: 'Total',    value: estado!.total },
            { label: 'Libres',   value: estado!.libres,   cls: 'text-green-600' },
            { label: 'Ocupados', value: estado!.ocupados, cls: 'text-amber-600' },
          ].map(s => (
            <div key={s.label} className="rounded-lg bg-muted/30 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className={`text-sm font-semibold ${s.cls ?? 'text-foreground'}`}>{s.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          Sin pool configurado — asigna el Baseline Datafast Estándar en el tab Cumplimiento y
          aplica el plan: el rango canónico (2000–3999) se configura automáticamente.
        </div>
      )}
    </div>
  );
}
