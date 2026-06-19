'use client';

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  field:      string;
  label:      string;
  sortField?: string;
  sortOrder?: 'ASC' | 'DESC';
  onSort:     (field: string) => void;
  className?: string;
}

export function SortableHeader({ field, label, sortField, sortOrder, onSort, className }: Props) {
  const active = sortField === field;
  return (
    <th
      onClick={() => onSort(field)}
      className={cn('cursor-pointer select-none group', className)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? sortOrder === 'ASC'
            ? <ChevronUp   className="w-3 h-3 text-primary flex-shrink-0" />
            : <ChevronDown className="w-3 h-3 text-primary flex-shrink-0" />
          : <ChevronsUpDown className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground flex-shrink-0" />
        }
      </span>
    </th>
  );
}
