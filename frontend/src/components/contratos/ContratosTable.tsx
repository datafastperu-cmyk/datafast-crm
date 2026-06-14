'use client';

import { Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { cn, formatPEN, formatDate, labelContrato } from '@/lib/utils';
import type { Contrato } from '@/types';

// ─── Badge de estado ──────────────────────────────────────────
const ESTADOS: Record<string, { label: string; cls: string; icon?: React.ElementType }> = {
  pendiente_instalacion: { label: 'Pend. Instalac.', cls: 'badge-pendiente', icon: AlertTriangle },
  activo:                { label: 'Activo',           cls: 'badge-activo',    icon: Wifi },
  suspendido:            { label: 'Suspendido',       cls: 'badge-suspendido',icon: WifiOff },
  baja_definitiva:       { label: 'Baja',             cls: 'badge-baja' },
};

export function ContratoEstadoBadge({ estado }: { estado: string }) {
  const cfg = ESTADOS[estado] ?? { label: estado, cls: 'badge-pendiente' };
  const Icon = cfg.icon;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold',
      cfg.cls,
    )}>
      {Icon && <Icon className="w-2.5 h-2.5" />}
      {cfg.label}
    </span>
  );
}

// ─── Tabla de contratos ───────────────────────────────────────
interface Props {
  contratos:   Contrato[];
  loading:     boolean;
  onRowClick:  (c: Contrato) => void;
}

export function ContratosTable({ contratos, loading, onRowClick }: Props) {
  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-4 animate-pulse">
            <div className="skeleton h-4 flex-1 rounded" />
            <div className="skeleton h-4 w-24 rounded" />
            <div className="skeleton h-4 w-20 rounded" />
            <div className="skeleton h-4 w-16 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!contratos.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Wifi className="w-10 h-10 text-muted-foreground mb-3 opacity-30" />
        <p className="text-sm font-medium text-foreground">Sin contratos</p>
        <p className="text-xs text-muted-foreground mt-1">
          No hay contratos con los filtros seleccionados.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>N° Contrato</th>
            <th>Cliente</th>
            <th>Plan</th>
            <th>IP / PPPoE</th>
            <th>Estado</th>
            <th>Precio</th>
            <th>Deuda</th>
            <th>Inicio</th>
          </tr>
        </thead>
        <tbody>
          {contratos.map((c) => (
            <tr key={c.id} onClick={() => onRowClick(c)} className="cursor-pointer">

              {/* N° contrato */}
              <td>
                <span className="text-xs font-mono font-semibold text-foreground">
                  {c.numeroContrato}
                </span>
                {c.aprovisionado && (
                  <span className="ml-1.5 text-[9px] font-bold px-1 py-px rounded bg-green-100
                                   text-green-700 dark:bg-green-950/30 dark:text-green-400">
                    PROV
                  </span>
                )}
              </td>

              {/* Cliente */}
              <td>
                <p className="text-sm font-medium text-foreground truncate max-w-[160px]">
                  {c.clienteNombre ?? '—'}
                </p>
                {c.clienteTelefono && (
                  <p className="text-xs text-muted-foreground">{c.clienteTelefono}</p>
                )}
              </td>

              {/* Plan */}
              <td>
                <p className="text-sm text-foreground">{c.planNombre ?? '—'}</p>
                {c.velocidadBajada && (
                  <p className="text-xs text-muted-foreground">
                    {c.velocidadBajada}/{c.velocidadSubida} Mbps
                  </p>
                )}
              </td>

              {/* IP / PPPoE */}
              <td>
                {c.ipAsignada ? (
                  <span className="font-mono text-xs text-foreground">{c.ipAsignada}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
                {c.usuarioPppoe && (
                  <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                    {c.usuarioPppoe}
                  </p>
                )}
              </td>

              {/* Estado */}
              <td><ContratoEstadoBadge estado={c.estado} /></td>

              {/* Precio */}
              <td>
                <span className="text-sm font-semibold text-foreground">
                  {formatPEN(c.precioFinal ?? 0)}
                </span>
              </td>

              {/* Deuda */}
              <td>
                {(c.deudaTotal ?? 0) > 0 ? (
                  <div>
                    <span className="text-sm font-bold text-destructive">
                      {formatPEN(c.deudaTotal)}
                    </span>
                    {(c.mesesDeuda ?? 0) > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        {c.mesesDeuda} mes{c.mesesDeuda > 1 ? 'es' : ''}
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-green-600 font-medium">Al día ✓</span>
                )}
              </td>

              {/* Inicio */}
              <td>
                <span className="text-xs text-muted-foreground">
                  {formatDate(c.fechaInicio)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
