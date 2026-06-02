'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Cpu, Wifi, AlertTriangle } from 'lucide-react';
import { oltNativoApi, type OltDispositivo } from '@/lib/api/olt-nativo';
import { OltFormModal } from '@/components/red/OltFormModal';
import { cn } from '@/lib/utils';

const MARCA_COLOR: Record<string, string> = {
  huawei: 'bg-red-500/10 text-red-400 border-red-500/20',
  zte:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  vsol:   'bg-purple-500/10 text-purple-400 border-purple-500/20',
  cdata:  'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

const ESTADO_COLOR: Record<string, string> = {
  online:        'bg-emerald-500/10 text-emerald-400',
  offline:       'bg-red-500/10 text-red-400',
  mantenimiento: 'bg-yellow-500/10 text-yellow-400',
  desconocido:   'bg-muted text-muted-foreground',
};

const METODO_LABEL: Record<string, string> = {
  nativo_ssh:   'SSH Nativo',
  smartolt_api: 'SmartOLT API',
  nativo_snmp:  'SNMP Nativo',
};

export default function OltsConfigPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen]     = useState(false);
  const [editing,   setEditing]       = useState<OltDispositivo | null>(null);
  const [deleteId,  setDeleteId]      = useState<string | null>(null);

  const { data: olts = [], isLoading } = useQuery({
    queryKey: ['olts-config'],
    queryFn:  oltNativoApi.listar,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => oltNativoApi.eliminar(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-nativas'] });
      qc.invalidateQueries({ queryKey: ['olts-config'] });
      setDeleteId(null);
    },
  });

  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit   = (olt: OltDispositivo) => { setEditing(olt); setModalOpen(true); };

  return (
    <div className="p-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Configuración OLT</h1>
            <p className="text-sm text-muted-foreground">
              {olts.length} equipo{olts.length !== 1 ? 's' : ''} registrado{olts.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground
                     hover:bg-primary/90 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Agregar OLT
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : olts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Cpu className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground text-sm">No hay OLTs registradas</p>
          <button onClick={openCreate} className="mt-4 text-sm text-primary hover:underline">
            Agregar la primera OLT
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nombre</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Marca</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Método</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">IP Gestión</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Slots / Puertos</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">ONUs activas</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {olts.map((olt) => (
                <tr key={olt.id}
                  className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Wifi className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium text-foreground">{olt.nombre}</span>
                    </div>
                    {olt.modelo && (
                      <p className="text-[11px] text-muted-foreground ml-5">{olt.modelo}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border uppercase',
                      MARCA_COLOR[olt.marca] ?? 'bg-muted text-muted-foreground border-border',
                    )}>
                      {olt.marca}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                    {METODO_LABEL[olt.metodoConexion] ?? olt.metodoConexion}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {olt.ipGestion}
                    {olt.puerto !== 22 && (
                      <span className="text-muted-foreground">:{olt.puerto}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">
                    {olt.slotsTotales} × {olt.puertosPorSlot}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium capitalize',
                      ESTADO_COLOR[olt.estado] ?? 'bg-muted text-muted-foreground',
                    )}>
                      {olt.estado}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                    {olt.onusActivas}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => openEdit(olt)}
                        className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteId(olt.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <OltFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
      />

      {/* Delete Confirm */}
      {deleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteId(null); }}
        >
          <div className="bg-background rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4
                          animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Eliminar OLT</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Esta acción es reversible (soft delete). Las ONUs asociadas quedan sin OLT activa.
                </p>
              </div>
            </div>
            {deleteMutation.isError && (
              <p className="text-xs text-red-500 mb-3">
                {(deleteMutation.error as any)?.response?.data?.message ?? 'Error al eliminar'}
              </p>
            )}
            <div className="flex gap-2.5 justify-end">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600
                           transition-colors disabled:opacity-60"
              >
                {deleteMutation.isPending ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
