'use client';

import { Loader2 } from 'lucide-react';
import { clasificarSenalFtth } from '@/lib/senal-ftth';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// SenalFtthValor — muestra la potencia Rx (dBm) y su clasificación (Muy Buena / Buena /
// Baja) con el color del estándar GPON. Componente ÚNICO para que el modal Ver detalle y el
// de Aprovisionar servicio se vean idénticos.
// ─────────────────────────────────────────────────────────────
export function SenalFtthValor({
  rxDbm, cargando, onLeer, puedeLeer = true,
}: {
  rxDbm?: number | null;
  cargando?: boolean;
  onLeer?: () => void;
  puedeLeer?: boolean;
}) {
  const senal = clasificarSenalFtth(rxDbm);

  if (rxDbm != null) {
    return (
      <span className="inline-flex items-center gap-2.5">
        <span className={cn('font-mono font-bold text-lg leading-none', senal.colorCls)}>
          {rxDbm.toFixed(2)} dBm
        </span>
        <span className={cn('text-xs font-bold px-2 py-0.5 rounded border', senal.badgeCls)}>
          {senal.label}
        </span>
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
