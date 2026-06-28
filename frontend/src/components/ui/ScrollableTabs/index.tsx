'use client';
import { type ReactNode, useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface ScrollableTabsProps {
  children: ReactNode;
  className?: string;
}

export function ScrollableTabs({ children, className }: ScrollableTabsProps) {
  const ref           = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    check();
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check, { passive: true });
    return () => {
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  return (
    <div className="relative flex-1 min-w-0">
      <div
        ref={ref}
        className={cn('overflow-x-auto scrollbar-none flex', className)}
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-8',
          'bg-gradient-to-l from-background to-transparent',
          'transition-opacity duration-200',
          atEnd ? 'opacity-0' : 'opacity-100',
        )}
      />
    </div>
  );
}
