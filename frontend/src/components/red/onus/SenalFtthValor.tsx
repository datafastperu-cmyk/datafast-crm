'use client';

import { Loader2 } from 'lucide-react';
import { clasificarSenalFtth } from '@/lib/senal-ftth';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// SenalFtthValor — muestra las DOS potencias Rx del enlace GPON, cada una clasificada
// (Muy Buena / Buena / Baja) con el color del estándar:
//   · ONU Rx : potencia que RECIBE la ONU (downstream, desde la OLT).
//   · OLT Rx : potencia que la OLT recibe DE esta ONU (upstream). Es la señal de esta ONU
//              "vista" en la OLT — la que pidió el operador en lugar del Tx.
// No se muestra el Tx de la ONU: su salud se juzga por cuánto llega a la OLT (OLT Rx), no
// por el valor emitido en sí.
// Componente ÚNICO para que el modal Ver detalle y el de Aprovisionar servicio sean idénticos.
// ─────────────────────────────────────────────────────────────
export function SenalFtthValor({
  rxDbm, oltRxDbm, cargando, onLeer, puedeLeer = true,
}: {
  rxDbm?: number | null;
  oltRxDbm?: number | null;
  cargando?: boolean;
  onLeer?: () => void;
  puedeLeer?: boolean;
}) {
  const onu = clasificarSenalFtth(rxDbm);
  const olt = clasificarSenalFtth(oltRxDbm);

  if (rxDbm != null) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <span className="inline-flex items-center gap-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase w-10 text-right">ONU Rx</span>
          <span className={cn('font-mono font-bold text-lg leading-none', onu.colorCls)}>
            {rxDbm.toFixed(2)} dBm
          </span>
          <span className={cn('text-[11px] font-bold px-1.5 py-0.5 rounded border', onu.badgeCls)}>
            {onu.label}
          </span>
          {cargando && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </span>
        {oltRxDbm != null && (
          <span className="inline-flex items-center gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase w-10 text-right">OLT Rx</span>
            <span className={cn('font-mono font-bold text-lg leading-none', olt.colorCls)}>
              {oltRxDbm.toFixed(2)} dBm
            </span>
            <span className={cn('text-[11px] font-bold px-1.5 py-0.5 rounded border', olt.badgeCls)}>
              {olt.label}
            </span>
          </span>
        )}
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
