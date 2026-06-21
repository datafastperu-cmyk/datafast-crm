'use client';

import { useQuery } from '@tanstack/react-query';
import { RefreshCw, AlertTriangle, CheckCircle2, Clock, Wifi, Shield } from 'lucide-react';
import { mikrotikApi, type DriftRecord } from '@/lib/api/mikrotik';
import { cn } from '@/lib/utils';

const TIPO_LABEL: Record<DriftRecord['tipoDrift'], string> = {
  PPPOE_AUSENTE:    'PPPoE ausente en router',
  FIREWALL_AUSENTE: 'Bloqueo firewall ausente',
};

const TIPO_ICON: Record<DriftRecord['tipoDrift'], React.ElementType> = {
  PPPOE_AUSENTE:    Wifi,
  FIREWALL_AUSENTE: Shield,
};

const ESTADO_CONFIG: Record<DriftRecord['estado'], { label: string; className: string; icon: React.ElementType }> = {
  DETECTADO: { label: 'Detectado',  className: 'bg-red-100 text-red-700',    icon: AlertTriangle  },
  ENCOLADO:  { label: 'En cola',    className: 'bg-yellow-100 text-yellow-700', icon: Clock        },
  RESUELTO:  { label: 'Resuelto',   className: 'bg-green-100 text-green-700', icon: CheckCircle2  },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function DriftContent() {
  const { data: registros = [], isFetching, refetch } = useQuery({
    queryKey: ['drift-detectado'],
    queryFn:  () => mikrotikApi.getDrift(200),
    refetchInterval: 60_000,
  });

  const sinResolver = registros.filter((r) => r.estado !== 'RESUELTO').length;

  return (
    <div className="space-y-4 p-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Panel de Drift — Red</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Discrepancias detectadas entre la BD y el hardware MikroTik
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50 text-gray-700"
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          Actualizar
        </button>
      </div>

      {/* Resumen */}
      <div className="flex gap-3">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
          <div className="text-2xl font-bold text-gray-900">{registros.length}</div>
          <div className="text-gray-500">Total registros</div>
        </div>
        <div className={cn('rounded-lg border px-4 py-3 text-sm', sinResolver > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white')}>
          <div className={cn('text-2xl font-bold', sinResolver > 0 ? 'text-red-700' : 'text-gray-900')}>{sinResolver}</div>
          <div className={sinResolver > 0 ? 'text-red-600' : 'text-gray-500'}>Sin resolver</div>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm">
          <div className="text-2xl font-bold text-green-700">{registros.filter((r) => r.estado === 'RESUELTO').length}</div>
          <div className="text-green-600">Resueltos</div>
        </div>
      </div>

      {/* Tabla */}
      {registros.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <CheckCircle2 className="h-12 w-12 mb-3 text-green-400" />
          <p className="font-medium text-gray-600">Sin drift detectado</p>
          <p className="text-sm">Todos los contratos coinciden con el estado en los routers</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Router', 'Tipo de Drift', 'Usuario PPPoE', 'IP Asignada', 'Estado', 'Detectado', 'Resuelto'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {registros.map((r) => {
                const estadoCfg  = ESTADO_CONFIG[r.estado];
                const EstadoIcon = estadoCfg.icon;
                const TipoIcon   = TIPO_ICON[r.tipoDrift];
                return (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{r.routerNombre}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex items-center gap-1.5 text-gray-700">
                        <TipoIcon className="h-4 w-4 text-gray-400 shrink-0" />
                        {TIPO_LABEL[r.tipoDrift]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">{r.usuarioPppoe ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-gray-700">{r.ipAsignada ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', estadoCfg.className)}>
                        <EstadoIcon className="h-3 w-3" />
                        {estadoCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(r.detectadoEn)}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {r.resueltoEn ? formatDate(r.resueltoEn) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
