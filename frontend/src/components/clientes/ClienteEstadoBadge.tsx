import { cn } from '@/lib/utils';

type EstadoCliente = 'pendiente_activacion' | 'activo' | 'suspendido' | 'baja_definitiva';

const ESTADOS: Record<string, { label: string; class: string }> = {
  pendiente_activacion: { label: 'Pend. Activación', class: 'badge-pendiente' },
  activo:                { label: 'Activo',             class: 'badge-activo' },
  suspendido:            { label: 'Suspendido',         class: 'badge-suspendido' },
  baja_definitiva:       { label: 'Baja',               class: 'badge-baja' },
};

export function ClienteEstadoBadge({ estado }: { estado: string }) {
  const cfg = ESTADOS[estado] ?? { label: estado, class: 'badge-pendiente' };
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold',
      cfg.class,
    )}>
      {cfg.label}
    </span>
  );
}
