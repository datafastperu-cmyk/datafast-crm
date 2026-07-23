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
  rxDbm, oltRxDbm, cargando, onLeer, puedeLeer = true, compact = false,
}: {
  rxDbm?: number | null;
  oltRxDbm?: number | null;
  cargando?: boolean;
  onLeer?: () => void;
  puedeLeer?: boolean;
  /** Reduce tamaños y espaciados para no ocupar tanto vertical (p.ej. en móvil). */
  compact?: boolean;
}) {
  const onu = clasificarSenalFtth(rxDbm);
  const olt = clasificarSenalFtth(oltRxDbm);

  const valCls   = compact ? 'font-mono font-bold text-xs leading-none' : 'font-mono font-bold text-sm leading-none';
  const lblCls   = compact ? 'text-[9px] font-semibold text-muted-foreground uppercase w-9 text-right' : 'text-[10px] font-semibold text-muted-foreground uppercase w-10 text-right';
  const badgeBase = compact ? 'text-[9px] font-bold px-1 py-0 rounded border' : 'text-[10px] font-bold px-1.5 py-0.5 rounded border';
  const rowGap   = compact ? 'gap-1.5' : 'gap-2';
  const colGap   = compact ? 'gap-0.5' : 'gap-1';

  if (rxDbm != null) {
    return (
      <span className={cn('inline-flex flex-col items-end', colGap)}>
        <span className={cn('inline-flex items-center', rowGap)}>
          <span className={lblCls}>ONU Rx</span>
          <span className={cn(valCls, onu.colorCls)}>{rxDbm.toFixed(2)} dBm</span>
          <span className={cn(badgeBase, onu.badgeCls)}>{onu.label}</span>
          {cargando && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        </span>
        {oltRxDbm != null && (
          <span className={cn('inline-flex items-center', rowGap)}>
            <span className={lblCls}>OLT Rx</span>
            <span className={cn(valCls, olt.colorCls)}>{oltRxDbm.toFixed(2)} dBm</span>
            <span className={cn(badgeBase, olt.badgeCls)}>{olt.label}</span>
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
