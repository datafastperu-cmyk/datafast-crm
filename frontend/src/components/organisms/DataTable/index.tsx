'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/atoms/Spinner';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/* ── Tipos ──────────────────────────────────────────────────────────────── */

export interface Column<TRow> {
  key:       string;
  header:    ReactNode;
  cell:      (row: TRow, index: number) => ReactNode;
  align?:    'left' | 'center' | 'right';
  width?:    string;
  sortable?: boolean;
}

export interface DataTableProps<TRow> {
  columns:      Column<TRow>[];
  data:         TRow[];
  keyExtractor: (row: TRow) => string | number;

  // estados
  loading?:     boolean;
  emptyTitle?:  string;
  emptyDesc?:   string;
  emptyAction?: ReactNode;

  // paginación
  page?:        number;
  pageSize?:    number;
  total?:       number;
  onPageChange?:(page: number) => void;

  // ordenamiento
  sortKey?:     string;
  sortDir?:     'asc' | 'desc';
  onSort?:      (key: string) => void;

  // selección múltiple
  selected?:    Set<string | number>;
  onSelect?:    (key: string | number) => void;
  onSelectAll?: (allKeys: (string | number)[]) => void;

  caption?:     string;
  className?:   string;
}

/* ── Componente ─────────────────────────────────────────────────────────── */

export function DataTable<TRow>({
  columns,
  data,
  keyExtractor,
  loading      = false,
  emptyTitle   = 'Sin resultados',
  emptyDesc    = 'No hay registros que mostrar.',
  emptyAction,
  page         = 1,
  pageSize     = 20,
  total        = 0,
  onPageChange,
  sortKey,
  sortDir,
  onSort,
  selected,
  onSelect,
  onSelectAll,
  caption,
  className,
}: DataTableProps<TRow>) {
  const totalPages  = Math.max(1, Math.ceil(total / pageSize));
  const hasSelect   = !!onSelect;
  const allKeys     = data.map(keyExtractor);
  const allSelected = hasSelect && allKeys.length > 0 && allKeys.every(k => selected?.has(k));

  return (
    <div className={cn('flex flex-col gap-0', className)}>

      {/* Scroll horizontal en mobile sin ocultar overflow */}
      <div
        className="w-full overflow-x-auto rounded-t-lg border border-border"
        role="region"
        aria-label={caption ?? 'Tabla de datos'}
        tabIndex={0}
      >
        <table
          className="data-table w-full border-collapse"
          aria-label={caption}
          aria-busy={loading}
          aria-rowcount={total}
        >
          {caption && <caption className="sr-only">{caption}</caption>}

          <thead>
            <tr>
              {hasSelect && (
                <th scope="col" className="w-10 px-4 py-3 bg-muted/40 border-b border-border">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => onSelectAll?.(allKeys)}
                    aria-label="Seleccionar todos"
                    className="rounded border-border"
                  />
                </th>
              )}
              {columns.map(col => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'px-4 py-3 bg-muted/40 border-b border-border',
                    'text-xs font-semibold text-muted-foreground uppercase tracking-widest',
                    col.align === 'right'  && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.sortable && 'cursor-pointer select-none hover:text-foreground transition-colors',
                    col.width,
                  )}
                  aria-sort={
                    col.sortable && sortKey === col.key
                      ? sortDir === 'asc' ? 'ascending' : 'descending'
                      : col.sortable ? 'none' : undefined
                  }
                  onClick={col.sortable ? () => onSort?.(col.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable && sortKey === col.key && (
                      <span aria-hidden="true" className="text-primary">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={columns.length + (hasSelect ? 1 : 0)}
                  className="text-center py-16"
                >
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Spinner size="md" />
                    <span className="text-sm">Cargando...</span>
                  </div>
                </td>
              </tr>
            )}

            {!loading && data.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (hasSelect ? 1 : 0)}
                  className="text-center py-16 px-6"
                >
                  <p className="text-sm font-medium text-foreground mb-1">{emptyTitle}</p>
                  <p className="text-xs text-muted-foreground mb-4">{emptyDesc}</p>
                  {emptyAction}
                </td>
              </tr>
            )}

            {!loading && data.map((row, index) => {
              const key        = keyExtractor(row);
              const isSelected = selected?.has(key) ?? false;

              return (
                <tr
                  key={key}
                  aria-selected={hasSelect ? isSelected : undefined}
                  className={cn(
                    'transition-colors duration-150',
                    isSelected ? 'bg-primary/5' : 'hover:bg-muted/25',
                  )}
                >
                  {hasSelect && (
                    <td className="px-4 py-3 border-b border-border/60">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onSelect?.(key)}
                        aria-label={`Seleccionar fila ${index + 1}`}
                        className="rounded border-border"
                      />
                    </td>
                  )}
                  {columns.map(col => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-4 py-3 border-b border-border/60 text-sm',
                        col.align === 'right'  && 'text-right tabular-nums',
                        col.align === 'center' && 'text-center',
                      )}
                    >
                      {col.cell(row, index)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {onPageChange && total > 0 && (
        <div
          className={cn(
            'flex items-center justify-between gap-4 px-4 py-3',
            'border border-t-0 border-border rounded-b-lg bg-card',
            'text-xs text-muted-foreground',
          )}
          aria-label="Paginación"
        >
          <span>
            Mostrando{' '}
            <strong className="text-foreground">
              {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)}
            </strong>{' '}
            de <strong className="text-foreground">{total.toLocaleString('es-PE')}</strong>
          </span>

          <div className="flex items-center gap-1" role="navigation" aria-label="Páginas">
            <PagBtn onClick={() => onPageChange(1)} disabled={page <= 1} aria-label="Primera página">
              <ChevronsLeft className="w-3.5 h-3.5" />
            </PagBtn>
            <PagBtn onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Página anterior">
              <ChevronLeft className="w-3.5 h-3.5" />
            </PagBtn>

            {getPageNumbers(page, totalPages).map((p, i) =>
              p === '...' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground">…</span>
              ) : (
                <PagBtn
                  key={p}
                  onClick={() => onPageChange(Number(p))}
                  active={p === page}
                  aria-label={`Página ${p}`}
                  aria-current={p === page ? 'page' : undefined}
                >
                  {p}
                </PagBtn>
              ),
            )}

            <PagBtn onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label="Página siguiente">
              <ChevronRight className="w-3.5 h-3.5" />
            </PagBtn>
            <PagBtn onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} aria-label="Última página">
              <ChevronsRight className="w-3.5 h-3.5" />
            </PagBtn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Helpers internos ───────────────────────────────────────────────────── */

interface PagBtnProps {
  onClick:        () => void;
  disabled?:      boolean;
  active?:        boolean;
  children:       ReactNode;
  'aria-label'?:  string;
  'aria-current'?: 'page' | undefined;
}

function PagBtn({ onClick, disabled, active, children, ...rest }: PagBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'min-w-[28px] h-7 px-2 rounded text-xs font-medium',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        active
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-muted text-muted-foreground hover:text-foreground',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | '...')[] = [1];
  if (current > 3)           pages.push('...');
  if (current > 2)           pages.push(current - 1);
  if (current !== 1 && current !== total) pages.push(current);
  if (current < total - 1)  pages.push(current + 1);
  if (current < total - 2)  pages.push('...');
  pages.push(total);
  return pages;
}
