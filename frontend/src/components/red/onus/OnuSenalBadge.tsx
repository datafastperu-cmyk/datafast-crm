'use client';
import type { CalidadSenal } from '@/lib/api/red-onus';

const CONFIG: Record<CalidadSenal, { label: string; cls: string }> = {
  buena:     { label: 'Buena',    cls: 'bg-green-100  text-green-800  border-green-200'  },
  marginal:  { label: 'Marginal', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  critica:   { label: 'Crítica',  cls: 'bg-red-100    text-red-800    border-red-200'    },
  sin_datos: { label: 'Sin datos',cls: 'bg-gray-100   text-gray-500   border-gray-200'  },
};

interface Props {
  calidad: CalidadSenal;
  rx?: number | null;
}

export function OnuSenalBadge({ calidad, rx }: Props) {
  const { label, cls } = CONFIG[calidad];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>
      {label}
      {rx != null && <span className="opacity-70">({rx} dBm)</span>}
    </span>
  );
}
