'use client';

import { ChevronUp, ChevronDown, ChevronsUpDown, Phone, Wifi } from 'lucide-react';
import { ClienteEstadoBadge } from './ClienteEstadoBadge';
import { formatDate }          from '@/lib/utils';
import { cn }                  from '@/lib/utils';
import type { Cliente }        from '@/types';

interface Props {
  clientes:    Cliente[];
  loading:     boolean;
  onRowClick:  (c: Cliente) => void;
  sortBy?:     string;
  sortOrder?:  'ASC' | 'DESC';
  onSort:      (col: string, dir: 'ASC' | 'DESC') => void;
}

const COLUMNAS = [
  { key: 'nombreCompleto', label: 'Cliente',         sortable: true },
  { key: 'numeroDocumento', label: 'Documento',      sortable: true },
  { key: 'telefono',       label: 'Teléfono',        sortable: false },
  { key: 'tipoServicio',   label: 'Servicio',        sortable: true },
  { key: 'estado',         label: 'Estado',          sortable: true },
  { key: 'createdAt',      label: 'Registro',        sortable: true },
];

const SERVICIO_ICONS: Record<string, string> = {
  ftth:      '📡',
  wisp:      '📶',
  dedicado:  '🔌',
  mixto:     '🔀',
};

function SortIcon({ col, sortBy, sortOrder }: {
  col: string; sortBy?: string; sortOrder?: 'ASC' | 'DESC';
}) {
  if (sortBy !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
  return sortOrder === 'ASC'
    ? <ChevronUp   className="w-3 h-3 text-primary" />
    : <ChevronDown className="w-3 h-3 text-primary" />;
}

export function ClientesTable({ clientes, loading, onRowClick, sortBy, sortOrder, onSort }: Props) {
  const handleSort = (col: string) => {
    if (sortBy === col) {
      onSort(col, sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      onSort(col, 'ASC');
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-4 animate-pulse">
            <div className="skeleton h-10 w-10 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-48 rounded" />
              <div className="skeleton h-3 w-32 rounded" />
            </div>
            <div className="skeleton h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!clientes.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
          <Wifi className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">Sin clientes</p>
        <p className="text-xs text-muted-foreground mt-1">No se encontraron clientes con los filtros actuales.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {COLUMNAS.map((col) => (
              <th key={col.key}>
                {col.sortable ? (
                  <button
                    onClick={() => handleSort(col.key)}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {col.label}
                    <SortIcon col={col.key} sortBy={sortBy} sortOrder={sortOrder} />
                  </button>
                ) : col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clientes.map((cliente) => (
            <tr
              key={cliente.id}
              onClick={() => onRowClick(cliente)}
              className="cursor-pointer"
            >
              {/* Cliente */}
              <td>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                    'text-xs font-bold',
                    cliente.estado === 'activo'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground',
                  )}>
                    {cliente.nombreCompleto?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate max-w-[200px]">
                      {cliente.nombreCompleto}
                    </p>
                    {cliente.email && (
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {cliente.email}
                      </p>
                    )}
                  </div>
                </div>
              </td>

              {/* Documento */}
              <td>
                <span className="text-xs font-mono text-foreground">
                  {cliente.tipoDocumento?.toUpperCase()} {cliente.numeroDocumento}
                </span>
              </td>

              {/* Teléfono */}
              <td>
                <div className="flex items-center gap-1 text-sm">
                  <Phone className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <span>{cliente.telefono}</span>
                  {cliente.whatsapp && (
                    <span className="text-[10px] text-green-600 font-medium">WA</span>
                  )}
                </div>
              </td>

              {/* Servicio */}
              <td>
                <span className="text-sm">
                  {SERVICIO_ICONS[cliente.tipoServicio ?? ''] ?? ''}{' '}
                  {cliente.tipoServicio?.toUpperCase() ?? '—'}
                </span>
              </td>

              {/* Estado */}
              <td>
                <ClienteEstadoBadge estado={cliente.estado} />
              </td>

              {/* Fecha */}
              <td>
                <span className="text-xs text-muted-foreground">
                  {formatDate(cliente.createdAt)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
