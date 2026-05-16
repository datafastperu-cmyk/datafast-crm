'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Breadcrumb { label: string; href?: string; }

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  badge?: { label: string; color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'gray'; };
  className?: string;
}

const BADGE_COLORS = {
  blue:   'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20',
  green:  'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20',
  yellow: 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20',
  red:    'bg-red-500/10 text-red-400 ring-1 ring-red-500/20',
  purple: 'bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20',
  gray:   'bg-muted text-muted-foreground ring-1 ring-border',
};

export function PageHeader({
  title, description, actions, breadcrumbs, badge, className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 mb-6', className)}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
            {breadcrumbs.map((bc, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-50" />}
                {bc.href ? (
                  <Link href={bc.href} className="hover:text-foreground transition-colors">
                    {bc.label}
                  </Link>
                ) : (
                  <span className={i === breadcrumbs.length - 1 ? 'text-foreground font-medium' : ''}>
                    {bc.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {title}
          </h1>
          {badge && (
            <span className={cn('text-[11px] font-medium px-2.5 py-0.5 rounded-full', BADGE_COLORS[badge.color ?? 'gray'])}>
              {badge.label}
            </span>
          )}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
