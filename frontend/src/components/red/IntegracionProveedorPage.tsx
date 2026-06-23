'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, CheckCircle2, CircleSlash2,
  Loader2, RefreshCw, Settings, Wifi, XCircle,
} from 'lucide-react';
import {
  oltNativoApi,
  type ProveedorConOlt,
  type TipoProveedor,
} from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

// ─── Constantes ───────────────────────────────────────────────

const HEALTH_DOT: Record<string, string> = {
  ok:      'bg-emerald-500',
  degraded:'bg-yellow-400',
  down:    'bg-red-500',
  unknown: 'bg-gray-400',
};

const HEALTH_LABEL: Record<string, string> = {
  ok:      'OK',
  degraded:'Degradado',
  down:    'Caído',
  unknown: 'Desconocido',
};

const CIRCUIT_COLOR: Record<string, string> = {
  closed:   'text-emerald-400',
  open:     'text-red-400',
  half_open:'text-yellow-400',
};

const MARCA_COLOR: Record<string, string> = {
  huawei: 'bg-red-500/10 text-red-400 border-red-500/20',
  zte:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  vsol:   'bg-purple-500/10 text-purple-400 border-purple-500/20',
  cdata:  'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

// ─── Props ────────────────────────────────────────────────────

interface IntegracionProveedorPageProps {
  tipo:        TipoProveedor;
  titulo:      string;
  descripcion: string;
  colorCls:    string;
  icono:       React.ReactNode;
}

// ─── Fila de proveedor ────────────────────────────────────────

function FilaProveedor({ config }: { config: ProveedorConOlt }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await oltNativoApi.testProveedor(config.id);
      if (r.exitoso) {
        toast(`${config.oltNombre}: ${r.mensaje} (${r.latenciaMs}ms)`, { type: 'success' });
      } else {
        toast(`${config.oltNombre}: ${r.mensaje}`, { type: 'error' });
      }
      qc.invalidateQueries({ queryKey: ['proveedores-por-tipo'] });
    } catch {
      toast(`Error al probar conexión con ${config.oltNombre}`, { type: 'error' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">

      {/* OLT */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Wifi className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="font-medium text-foreground text-sm">{config.oltNombre}</span>
        </div>
        <span className={cn(
          'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border uppercase mt-0.5 ml-5',
          MARCA_COLOR[config.oltMarca] ?? 'bg-muted text-muted-foreground border-border',
        )}>
          {config.oltMarca}
        </span>
      </td>

      {/* Credenciales */}
      <td className="px-4 py-3">
        {config.tieneCredenciales ? (
          <div className="flex items-center gap-1.5 text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="text-xs">Configuradas</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="text-xs">Sin credenciales</span>
          </div>
        )}
      </td>

      {/* Health */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full shrink-0', HEALTH_DOT[config.healthEstado] ?? 'bg-gray-400')} />
          <span className="text-xs text-muted-foreground">
            {HEALTH_LABEL[config.healthEstado] ?? config.healthEstado}
          </span>
          {config.healthLatenciaMs !== null && (
            <span className="text-[10px] text-muted-foreground/60">
              {config.healthLatenciaMs}ms
            </span>
          )}
        </div>
      </td>

      {/* Circuit Breaker */}
      <td className="px-4 py-3 hidden md:table-cell">
        <div className={cn('flex items-center gap-1.5 text-xs', CIRCUIT_COLOR[config.circuitEstado] ?? 'text-muted-foreground')}>
          {config.circuitEstado === 'open'
            ? <CircleSlash2 className="w-3.5 h-3.5" />
            : config.circuitEstado === 'half_open'
              ? <Activity className="w-3.5 h-3.5" />
              : <CheckCircle2 className="w-3.5 h-3.5" />}
          {config.circuitEstado}
        </div>
      </td>

      {/* Estado activo */}
      <td className="px-4 py-3 hidden sm:table-cell">
        <span className={cn(
          'text-[11px] px-1.5 py-0.5 rounded font-medium',
          config.activo
            ? 'bg-emerald-500/10 text-emerald-400'
            : 'bg-muted text-muted-foreground',
        )}>
          {config.activo ? 'Activo' : 'Inactivo'}
        </span>
      </td>

      {/* Acciones */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={handleTest}
            disabled={testing || !config.tieneCredenciales}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground/60 hover:text-green-500
                       transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={config.tieneCredenciales ? 'Probar conexión' : 'Sin credenciales configuradas'}
          >
            {testing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
          <a
            href={`/configuracion/olts`}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Gestionar proveedor en configuración OLT"
          >
            <Settings className="w-3.5 h-3.5" />
          </a>
        </div>
      </td>
    </tr>
  );
}

// ─── Componente principal ─────────────────────────────────────

export function IntegracionProveedorPage({
  tipo,
  titulo,
  descripcion,
  colorCls,
  icono,
}: IntegracionProveedorPageProps) {
  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['proveedores-por-tipo', tipo],
    queryFn:  () => oltNativoApi.listarPorTipo(tipo),
    staleTime: 30_000,
  });

  const activos   = configs.filter((c) => c.activo);
  const conCreds  = configs.filter((c) => c.tieneCredenciales);
  const conHealth = configs.filter((c) => c.healthEstado === 'ok');

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center', colorCls)}>
          {icono}
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">{titulo}</h1>
          <p className="text-sm text-muted-foreground">{descripcion}</p>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total OLTs', value: configs.length, cls: 'text-foreground' },
          { label: 'Activos',    value: activos.length, cls: 'text-emerald-400' },
          { label: 'Con API Key',value: conCreds.length, cls: 'text-blue-400' },
          { label: 'Health OK',  value: conHealth.length, cls: 'text-emerald-400' },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className={cn('text-2xl font-bold mt-1', m.cls)}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Aviso sin configs */}
      {!isLoading && configs.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <XCircle className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No hay OLTs configuradas con este proveedor.
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Ve a{' '}
            <a href="/configuracion/olts" className="text-primary hover:underline">
              Configuración → OLT
            </a>
            {' '}y asigna un proveedor {titulo} a cada OLT.
          </p>
        </div>
      )}

      {/* Tabla */}
      {(isLoading || configs.length > 0) && (
        <div className="rounded-xl border border-border overflow-hidden">
          {isLoading ? (
            <div className="space-y-0">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 border-b border-border bg-muted/20 animate-pulse" />
              ))}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">OLT</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">API Key</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Health</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Circuit</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {configs.map((cfg) => (
                  <FilaProveedor key={cfg.id} config={cfg} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Info footer */}
      <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">¿Cómo configurar credenciales?</p>
        <p>
          Las credenciales (API Key, URL base, ID externo de OLT) se configuran por OLT desde{' '}
          <a href="/configuracion/olts" className="text-primary hover:underline">
            Configuración → OLT
          </a>
          {' '}→ ícono de engranaje → pestaña Proveedores.
        </p>
        <p>
          El botón <strong>▶ Probar</strong> verifica la conectividad usando las credenciales guardadas
          y actualiza el estado de health del circuit breaker.
        </p>
      </div>
    </div>
  );
}
