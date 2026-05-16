import { cn } from '@/lib/utils';

interface SkeletonTableProps {
  rows?: number;
  cols?: number;
  className?: string;
}

export function SkeletonTable({ rows = 6, cols = 5, className }: SkeletonTableProps) {
  return (
    <div className={cn('w-full', className)}>
      <div className="flex gap-3 px-4 py-3 border-b border-border bg-muted/30">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className={cn('skeleton h-3 rounded', i === 0 ? 'w-32' : 'flex-1')} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 items-center px-4 py-3.5 border-b border-border/60">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className={cn(
              'skeleton h-3.5 rounded',
              c === 0 ? 'w-36' : c === cols - 1 ? 'w-20' : 'flex-1',
            )} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('bg-card border border-border rounded-xl p-5 space-y-3', className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="skeleton h-3 w-28 rounded" />
          <div className="skeleton h-7 w-20 rounded" />
          <div className="skeleton h-3 w-36 rounded" />
        </div>
        <div className="skeleton w-10 h-10 rounded-xl" />
      </div>
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-${count} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
