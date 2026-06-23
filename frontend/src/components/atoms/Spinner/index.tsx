import { cn } from '@/lib/utils';

export interface SpinnerProps {
  size?:      'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes: Record<NonNullable<SpinnerProps['size']>, string> = {
  xs: 'w-3 h-3 border',
  sm: 'w-4 h-4 border',
  md: 'w-5 h-5 border-2',
  lg: 'w-6 h-6 border-2',
};

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={cn(
        'inline-block rounded-full border-current border-r-transparent animate-spin',
        sizes[size],
        className,
      )}
    />
  );
}
