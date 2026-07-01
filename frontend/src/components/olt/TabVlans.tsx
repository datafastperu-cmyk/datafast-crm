'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, Network, RefreshCw, Pencil, Check, X } from 'lucide-react';
import { oltNativoApi, type OltVlan } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const inputCls = (err?: boolean) => cn(
  'w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground transition-colors outline-none',
  'focus:ring-2 focus:ring-primary/30 focus:border-primary',
  err ? 'border-red-500' : 'border-border hover:border-muted-foreground/50',
);

const ESTADO_BADGE: Record<string, string> = {
  active:  'bg-emerald-500/10 text-emerald-400',
  syncing: 'bg-yellow-500/10 text-yellow-400',
  error:   'bg-red-500/10 text-red-400',
};
const ORIGEN_BADGE: Record<string, string> = {
  erp: 'bg-blue-500/10 text-blue-400',
  olt: 'bg-muted text-muted-foreground',
};

export function TabVlans({ oltId }: { oltId: string }) {
  const qc        = useQueryClient();
  const { toast } = useToast();

  const [newId,      setNewId]      = useState('');
  const [newNombre,  setNewNombre]  = useState('');
  const [formErr,    setFormErr]    = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [editNombre, setEditNombre] = useState('');

  const { data: vlans = [], isLoading } = useQuery<OltVlan[]>({
    queryKey: ['olt-vlans', oltId],
    queryFn:  () => oltNativoApi.listarVlans(oltId),
    enabled:  !!oltId,
  });

  const addMut = useMutation({
    mutationFn: (dto: { vlanId: number; nombre: string }) =>
      oltNativoApi.agregarVlanConCli(oltId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-vlans', oltId] });
      setNewId(''); setNewNombre(''); setFormErr('');
      toast('VLAN creada en OLT y ERP', { type: 'success' });
    },
    onError: (e: any) => // eslint-disable-line
      setFormErr(e?.response?.data?.message ?? 'Error al agregar VLAN'),
  });

  const delMut = useMutation({
    mutationFn: (vlanId: number) => oltNativoApi.eliminarVlanConCli(oltId, vlanId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-vlans', oltId] });
      setDeletingId(null);
      toast('VLAN eliminada de OLT y ERP', { type: 'success' });
    },
    onError: (e: any) => { // eslint-disable-line
      setDeletingId(null);
      toast(e?.response?.data?.message ?? 'Error al eliminar VLAN', { type: 'error' });
    },
  });

  const editMut = useMutation({
    mutationFn: ({ vlanId, nombre }: { vlanId: number; nombre: string }) =>
      oltNativoApi.editarVlanNombre(oltId, vlanId, nombre),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-vlans', oltId] });
      setEditingId(null);
      toast('Nombre actualizado', { type: 'success' });
    },
    onError: () => toast('Error al actualizar nombre', { type: 'error' }),
  });

  const pullMut = useMutation({
    mutationFn: () => oltNativoApi.pullVlansDesdeOlt(oltId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['olt-vlans', oltId] });
      toast(`Pull completado: ${r.insertadas} nuevas, ${r.omitidas} omitidas`, { type: 'success' });
    },
    onError: (e: any) => // eslint-disable-line
      toast(e?.response?.data?.message ?? 'Error al leer VLANs desde OLT', { type: 'error' }),
  });

  const handleAdd = () => {
    const id = parseInt(newId, 10);
    if (!newId || isNaN(id) || id < 1 || id > 4094) { setFormErr('VLAN ID debe ser 1–4094'); return; }
    if (!newNombre.trim()) { setFormErr('El nombre es requerido'); return; }
    setFormErr('');
    addMut.mutate({ vlanId: id, nombre: newNombre.trim() });
  };

  const startEdit = (v: OltVlan) => {
    setEditingId(v.vlanId);
    setEditNombre(v.nombre);
  };

  const confirmEdit = (vlanId: number) => {
    if (!editNombre.trim()) return;
    editMut.mutate({ vlanId, nombre: editNombre.trim() });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{vlans.length} VLANs</p>
        <button
          onClick={() => pullMut.mutate()}
          disabled={pullMut.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border
                     hover:bg-accent transition-colors disabled:opacity-60 text-muted-foreground hover:text-foreground"
        >
          {pullMut.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5" />}
          Pull desde OLT
        </button>
      </div>

      {vlans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 border border-dashed border-border rounded-xl">
          <Network className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Sin VLANs registradas</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">VLAN ID</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Nombre</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Origen</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Estado</th>
                <th className="px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody>
              {vlans.map((v) => (
                <tr key={v.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-primary">{v.vlanId}</td>
                  <td className="px-4 py-2.5">
                    {editingId === v.vlanId ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          value={editNombre}
                          onChange={e => setEditNombre(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') confirmEdit(v.vlanId);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="px-2 py-1 text-xs rounded border border-primary/50 bg-background text-foreground outline-none w-40"
                          autoFocus
                        />
                        <button
                          onClick={() => confirmEdit(v.vlanId)}
                          disabled={editMut.isPending}
                          className="p-1 rounded hover:bg-emerald-500/10 text-emerald-400 transition-colors disabled:opacity-50"
                        >
                          {editMut.isPending
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <Check className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-foreground">{v.nombre}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 hidden sm:table-cell">
                    <span className={cn(
                      'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                      ORIGEN_BADGE[v.origen] ?? ORIGEN_BADGE.olt,
                    )}>
                      {v.origen}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 hidden sm:table-cell">
                    <span className={cn(
                      'text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5',
                      ESTADO_BADGE[v.estado] ?? ESTADO_BADGE.active,
                    )}>
                      {v.estado === 'syncing' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                      {v.estado}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 justify-end">
                      {editingId !== v.vlanId && (
                        <button
                          onClick={() => startEdit(v)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => { setDeletingId(v.vlanId); delMut.mutate(v.vlanId); }}
                        disabled={delMut.isPending && deletingId === v.vlanId}
                        className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        {delMut.isPending && deletingId === v.vlanId
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border border-border p-4 bg-muted/10 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Agregar VLAN (push a OLT)
        </p>
        <div className="flex gap-2">
          <input
            value={newId}
            onChange={e => { setNewId(e.target.value); setFormErr(''); }}
            placeholder="ID (1-4094)"
            type="number" min={1} max={4094}
            className={cn(inputCls(!!formErr), 'w-32')}
          />
          <input
            value={newNombre}
            onChange={e => { setNewNombre(e.target.value); setFormErr(''); }}
            placeholder="Nombre (ej: Internet Clientes)"
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            className={inputCls(!!formErr)}
          />
          <button
            onClick={handleAdd}
            disabled={addMut.isPending}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground
                       hover:bg-primary/90 transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            {addMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Agregar
          </button>
        </div>
        {formErr && <p className="text-xs text-red-500">{formErr}</p>}
      </div>
    </div>
  );
}
