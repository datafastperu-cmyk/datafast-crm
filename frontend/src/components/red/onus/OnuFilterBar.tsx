'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery }     from '@tanstack/react-query';
import { Search, Download, X } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { zonasApi }     from '@/lib/api/zonas';
import type { OnuFilters, CalidadSenal } from '@/lib/api/red-onus';
import { redOnusApi }   from '@/lib/api/red-onus';

const ESTADOS  = ['online', 'offline', 'suspendido', 'rogue'];
const CALIDADES: { value: CalidadSenal; label: string }[] = [
  { value: 'buena',     label: 'Buena (≥ −23 dBm)'      },
  { value: 'marginal',  label: 'Marginal (−27 a −23 dBm)' },
  { value: 'critica',   label: 'Crítica (< −27 dBm)'      },
  { value: 'sin_datos', label: 'Sin datos'                 },
];

interface Props {
  filters:   OnuFilters;
  onChange:  (f: OnuFilters) => void;
  totalOnus: number;
}

export function OnuFilterBar({ filters, onChange, totalOnus }: Props) {
  const [search, setSearch] = useState(filters.q ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const { data: olts  } = useQuery({ queryKey: ['olts-lista'], queryFn: () => oltNativoApi.listar() });
  const { data: zonas } = useQuery({ queryKey: ['zonas-lista'], queryFn: zonasApi.list });

  const set = useCallback((patch: Partial<OnuFilters>) => {
    onChange({ ...filters, ...patch, page: 1 });
  }, [filters, onChange]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (search !== filters.q) set({ q: search || undefined });
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilters = !!(filters.oltId || filters.estado || filters.zonaId || filters.calidad || filters.q);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white">
      {/* Buscador */}
      <div className="relative flex-1 min-w-48">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar SN, cliente..."
          className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {/* Filtro OLT */}
      <select
        value={filters.oltId ?? ''}
        onChange={e => set({ oltId: e.target.value || undefined })}
        className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:outline-none"
      >
        <option value="">Todas las OLTs</option>
        {(olts ?? []).map(o => (
          <option key={o.id} value={o.id}>{o.nombre}</option>
        ))}
      </select>

      {/* Filtro Estado */}
      <select
        value={filters.estado ?? ''}
        onChange={e => set({ estado: e.target.value || undefined })}
        className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:outline-none"
      >
        <option value="">Todos los estados</option>
        {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
      </select>

      {/* Filtro Zona */}
      <select
        value={filters.zonaId ?? ''}
        onChange={e => set({ zonaId: e.target.value || undefined })}
        className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:outline-none"
      >
        <option value="">Todas las zonas</option>
        {(zonas ?? []).map(z => <option key={z.id} value={z.id}>{z.nombre}</option>)}
      </select>

      {/* Filtro Calidad */}
      <select
        value={filters.calidad ?? ''}
        onChange={e => set({ calidad: (e.target.value as CalidadSenal) || undefined })}
        className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:ring-1 focus:ring-blue-500 focus:outline-none"
      >
        <option value="">Calidad señal</option>
        {CALIDADES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>

      {/* Limpiar filtros */}
      {hasFilters && (
        <button
          onClick={() => { setSearch(''); onChange({ page: 1, limit: filters.limit }); }}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded border border-gray-200 hover:bg-gray-50"
        >
          <X size={12} /> Limpiar
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-gray-400">{totalOnus} ONUs</span>
        {/* CSV Export */}
        <a
          href={redOnusApi.exportUrl(filters)}
          download
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700"
        >
          <Download size={12} /> CSV
        </a>
      </div>
    </div>
  );
}
