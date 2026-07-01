'use client';
import { useQuery }              from '@tanstack/react-query';
import { useEffect }             from 'react';
import { redOnusApi, OnuFilters, OnuRow } from '@/lib/api/red-onus';
import { OnuSenalBadge }     from './OnuSenalBadge';
import { OnuAccionMenu }     from './OnuAccionMenu';

export type LiveSenalMap = Map<string, { rxPower: number|null; txPower: number|null; temperatura: number|null; calidadSenal: import('@/lib/api/red-onus').CalidadSenal }>;

interface Props {
  filters:       OnuFilters;
  selected:      Set<string>;
  onToggle:      (sn: string) => void;
  onSelectAll:   (sns: string[]) => void;
  onClearAll:    () => void;
  onSenalUpdate: (sn: string, rx: number | null, tx: number | null, temp: number | null) => void;
  liveSenales?:  LiveSenalMap;
  onTotalChange?:(n: number) => void;
}

export function OnuTable({ filters, selected, onToggle, onSelectAll, onClearAll, onSenalUpdate, liveSenales, onTotalChange }: Props) {
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['red-onus', filters],
    queryFn:  () => redOnusApi.listar(filters),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (data?.total != null) onTotalChange?.(data.total);
  }, [data?.total]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows: OnuRow[] = (data?.data ?? []).map(row => {
    const live = liveSenales?.get(row.sn);
    if (!live) return row;
    return { ...row, rxPower: live.rxPower, txPower: live.txPower, temperatura: live.temperatura, calidadSenal: live.calidadSenal };
  });
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.sn));

  if (isLoading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Cargando ONUs...</div>
  );

  if (!rows.length) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Sin ONUs que coincidan con los filtros</div>
  );

  return (
    <div className="overflow-x-auto relative">
      {isFetching && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 animate-pulse" />
      )}
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-3 py-2 w-8">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => allSelected ? onClearAll() : onSelectAll(rows.map(r => r.sn))}
                className="rounded border-gray-300"
              />
            </th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">SN</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Slot/Port</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">OLT</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Cliente</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Zona</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Estado</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Señal</th>
            <th className="px-3 py-2 w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(row => (
            <tr key={row.sn} className={`hover:bg-gray-50 transition-colors ${selected.has(row.sn) ? 'bg-blue-50' : ''}`}>
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(row.sn)}
                  onChange={() => onToggle(row.sn)}
                  className="rounded border-gray-300"
                />
              </td>
              <td className="px-3 py-2 font-mono text-xs">{row.sn}</td>
              <td className="px-3 py-2 text-gray-600">
                {row.slot != null && row.port != null ? `${row.slot}/${row.port}` : '—'}
              </td>
              <td className="px-3 py-2">
                <span className="text-xs">{row.oltNombre}</span>
              </td>
              <td className="px-3 py-2">
                {row.clienteNombre
                  ? <span>{row.clienteNombre}</span>
                  : <span className="text-gray-400">—</span>}
              </td>
              <td className="px-3 py-2 text-gray-600 text-xs">{row.zonaNombre ?? '—'}</td>
              <td className="px-3 py-2">
                <EstadoBadge estado={row.estado} />
              </td>
              <td className="px-3 py-2">
                <OnuSenalBadge calidad={row.calidadSenal} rx={row.rxPower} />
              </td>
              <td className="px-3 py-2">
                <OnuAccionMenu row={row} onSenalUpdate={onSenalUpdate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <PaginaBar total={data?.total ?? rows.length} page={data?.page ?? 1} pages={data?.pages ?? 1} limit={data?.limit ?? filters.limit ?? 50} />
    </div>
  );
}

function EstadoBadge({ estado }: { estado: string | null }) {
  if (!estado) return <span className="text-gray-400 text-xs">—</span>;
  const map: Record<string, string> = {
    online:    'bg-green-100 text-green-800',
    offline:   'bg-red-100   text-red-800',
    suspendido:'bg-orange-100 text-orange-800',
    rogue:     'bg-red-200   text-red-900',
  };
  const cls = map[estado] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {estado}
    </span>
  );
}

function PaginaBar({ total, page, pages, limit }: { total: number; page: number; pages: number; limit: number }) {
  const from = ((page - 1) * limit) + 1;
  const to   = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 text-xs text-gray-500">
      <span>{from}–{to} de {total} ONUs</span>
      <span>Página {page} / {pages}</span>
    </div>
  );
}
