'use client';

import { Loader2 } from 'lucide-react';
import { clasificarSenalFtth } from '@/lib/senal-ftth';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// SenalFtthValor — muestra la potencia óptica de la ONU:
//   · Rx (recibida por la ONU): se CLASIFICA en Muy Buena/Buena/Baja con el color del
//     estándar GPON — es la que dice si el enlace del cliente está sano.
//   · Tx (emitida por la ONU): valor informativo, sin clasificación de color (la salud del
//     enlace la determina la Rx en el otro extremo, no la Tx propia).
// Componente ÚNICO para que el modal Ver detalle y el de Aprovisionar servicio sean idénticos.
// ─────────────────────────────────────────────────────────────
export function SenalFtthValor({
  rxDbm, txDbm, cargando, onLeer, puedeLeer = true,
}: {
  rxDbm?: number | null;
  txDbm?: number | null;
  cargando?: boolean;
  onLeer?: () => void;
  puedeLeer?: boolean;
}) {
  const senal = clasificarSenalFtth(rxDbm);

  if (rxDbm != null) {
    return (
      <span className="inline-flex items-center gap-2.5 flex-wrap justify-end">
        <span className="inline-flex items-baseline gap-1">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase">Rx</span>
          <span className={cn('font-mono font-bold text-lg leading-none', senal.colorCls)}>
            {rxDbm.toFixed(2)} dBm
          </span>
        </span>
        <span className={cn('text-xs font-bold px-2 py-0.5 rounded border', senal.badgeCls)}>
          {senal.label}
        </span>
        {txDbm != null && (
          <span className="inline-flex items-baseline gap-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">Tx</span>
            <span className="font-mono font-semibold text-sm text-foreground/80 leading-none">
              {txDbm.toFixed(2)} dBm
            </span>
          </span>
        )}
        {cargando && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </span>
    );
  }
  if (cargando) {
    return <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> leyendo…</span>;
  }
  if (puedeLeer && onLeer) {
    return <button onClick={onLeer} className="text-sm text-primary hover:underline">Leer señal</button>;
  }
  return <span className="text-muted-foreground/50">—</span>;
}
