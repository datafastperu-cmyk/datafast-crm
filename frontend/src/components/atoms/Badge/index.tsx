import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant =
  | 'activo'
  | 'suspendido'
  | 'moroso'
  | 'prorroga'
  | 'pendiente'
  | 'baja'
  | 'instalacion'
  | 'info'
  | 'neutral';

export interface BadgeProps {
  variant?:   BadgeVariant;
  dot?:       boolean;
  children:   ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  activo:      'bg-success/12 text-success border-success/22',
  suspendido:  'bg-destructive/12 text-destructive border-destructive/22',
  moroso:      'bg-warning/12 text-warning border-warning/22',
  prorroga:    'bg-info/12 text-info border-info/22',
  pendiente:   'bg-warning/10 text-warning border-warning/20',
  baja:        'bg-muted text-muted-foreground border-border',
  instalacion: 'bg-primary/12 text-primary border-primary/22',
  info:        'bg-info/12 text-info border-info/22',
  neutral:     'bg-muted text-muted-foreground border-border',
};

const dotClasses: Record<BadgeVariant, string> = {
  activo:      'bg-success animate-[pulse-dot_2s_ease-in-out_infinite]',
  suspendido:  'bg-destructive',
  moroso:      'bg-warning animate-[pulse-dot_1.5s_ease-in-out_infinite]',
  prorroga:    'bg-info',
  pendiente:   'bg-warning animate-[pulse-dot_1.5s_ease-in-out_infinite]',
  baja:        'bg-muted-foreground',
  instalacion: 'bg-primary animate-[pulse-dot_2s_ease-in-out_infinite]',
  info:        'bg-info',
  neutral:     'bg-muted-foreground',
};

export function Badge({ variant = 'neutral', dot = false, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        'text-xs font-medium px-2 py-0.5 rounded-md border',
        variantClasses[variant],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotClasses[variant])}
        />
      )}
      {children}
    </span>
  );
}
