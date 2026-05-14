import { cn } from '@/lib/utils';

type EstadoCliente =
  | 'activo' | 'suspendido' | 'moroso' | 'suspendido_mora'
  | 'baja_temporal' | 'baja_definitiva' | 'prospecto';

const ESTADOS: Record<string, { label: string; class: string }> = {
  activo:               { label: 'Activo',        class: 'badge-activo' },
  moroso:               { label: 'Moroso',        class: 'badge-moroso' },
  suspendido_mora:      { label: 'Mora',          class: 'badge-moroso' },
  suspendido:           { label: 'Suspendido',    class: 'badge-suspendido' },
  suspendido_manual:    { label: 'Suspendido',    class: 'badge-suspendido' },
  prorroga:             { label: 'Prórroga',      class: 'badge-prorroga' },
  baja_temporal:        { label: 'Baja temp.',    class: 'badge-baja' },
  baja_definitiva:      { label: 'Baja',          class: 'badge-baja' },
  prospecto:            { label: 'Prospecto',     class: 'badge-pendiente' },
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
