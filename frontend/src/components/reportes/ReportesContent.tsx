'use client';

import { useState }   from 'react';
import { useQuery }   from '@tanstack/react-query';
import {
  BarChart2, Download, Calendar, TrendingUp,
  Users, Wifi,
} from 'lucide-react';

import { ReporteCobranza }  from './ReporteCobranza';
import { ReporteClientes }  from './ReporteClientes';
import { ReporteRed }       from './ReporteRed';
import { reportesApi }      from '@/lib/api/configuracion';
import { useToast }         from '@/components/ui/toaster';
import { parseApiError, mesNombre, cn } from '@/lib/utils';

const TABS = [
  { key: 'cobranza', label: 'Cobranza',  icon: TrendingUp },
  { key: 'clientes', label: 'Clientes',  icon: Users },
  { key: 'red',      label: 'Red',       icon: Wifi },
] as const;
type TabKey = typeof TABS[number]['key'];

export function ReportesContent() {
  const { toast } = useToast();
  const hoy       = new Date();
  const [tab, setTab]     = useState<TabKey>('cobranza');
  const [mes,  setMes]    = useState(hoy.getMonth() + 1);
  const [anio, setAnio]   = useState(hoy.getFullYear());
  const [exportando, setExportando] = useState(false);

  const filtros = { mes, anio };

  // Resumen general (stats del header)
  const { data: resumen } = useQuery({
    queryKey: ['reportes-resumen'],
    queryFn:  reportesApi.getResumenGeneral,
    staleTime: 5 * 60_000,
  });

  const handleExportar = async () => {
    setExportando(true);
    try {
      const blob = await reportesApi.exportar(tab, { ...filtros, formato: 'csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `reporte-${tab}-${mes}-${anio}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Exportación descargada', { type: 'success' });
    } catch (e) {
      toast(parseApiError(e), { type: 'error' });
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" />
            Reportes
          </h2>
          <p className="text-sm text-muted-foreground">
            Análisis operacional · {mesNombre(mes)} {anio}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Selector de período */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input bg-background text-sm">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="bg-transparent text-sm focus:outline-none"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{mesNombre(m)}</option>
              ))}
            </select>
            <input
              type="number"
              min={2020}
              max={2030}
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
              className="bg-transparent w-16 text-sm focus:outline-none text-center"
            />
          </div>

          <button
            onClick={handleExportar}
            disabled={exportando}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                       border border-input hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            {exportando ? 'Exportando…' : 'Exportar CSV'}
          </button>
        </div>
      </div>

      {/* Tarjetas de resumen global */}
      {resumen && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Clientes activos',  value: resumen.clientes?.activos   ?? '—',  color: 'text-green-600' },
            { label: 'Contratos activos', value: resumen.contratos?.activos   ?? '—',  color: 'text-blue-600' },
            { label: 'Cobrado este mes',  value: resumen.facturacion?.cobradoMes
                ? `S/ ${Number(resumen.facturacion.cobradoMes).toLocaleString('es-PE', { minimumFractionDigits: 2 })}`
                : '—',                                                                 color: 'text-foreground' },
            { label: 'Nodos online',      value: `${resumen.red?.nodesOnline ?? '—'} / ${resumen.red?.total ?? '—'}`,
                                                                                       color: 'text-orange-600' },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl px-4 py-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={cn('text-xl font-bold mt-0.5', s.color)}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs de reportes */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex border-b border-border">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors',
                tab === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'cobranza' && <ReporteCobranza filtros={filtros} />}
          {tab === 'clientes' && <ReporteClientes filtros={filtros} />}
          {tab === 'red'      && <ReporteRed      filtros={filtros} />}
        </div>
      </div>
    </div>
  );
}
