'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, Network } from 'lucide-react';
import { oltNativoApi, type OltVlan } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const inputCls = (err?: boolean) => cn(
  'w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground transition-colors outline-none',
  'focus:ring-2 focus:ring-primary/30 focus:border-primary',
  err ? 'border-red-500' : 'border-border hover:border-muted-foreground/50',
);

export function TabVlans({ oltId }: { oltId: string }) {
  const qc           = useQueryClient();
  const { toast }    = useToast();
  const [newId,      setNewId]      = useState('');
  const [newNombre,  setNewNombre]  = useState('');
  const [formErr,    setFormErr]    = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data: vlans = [], isLoading } = useQuery<OltVlan[]>({
    queryKey: ['olt-vlans', oltId],
    queryFn:  () => oltNativoApi.listarVlans(oltId),
    enabled:  !!oltId,
  });

  const addMut = useMutation({
    mutationFn: (dto: { vlanId: number; nombre: string }) =>
      oltNativoApi.agregarVlan(oltId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-vlans', oltId] });
      setNewId(''); setNewNombre(''); setFormErr('');
      toast('VLAN agregada', { type: 'success' });
    },
    onError: (e: any) =>
      setFormErr(e?.response?.data?.message ?? 'Error al agregar VLAN'),
  });

  const delMut = useMutation({
    mutationFn: (vlanId: number) => oltNativoApi.eliminarVlan(oltId, vlanId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-vlans', oltId] });
      setDeletingId(null);
      toast('VLAN eliminada', { type: 'success' });
    },
    onError: () => {
      setDeletingId(null);
      toast('Error al eliminar VLAN', { type: 'error' });
    },
  });

  const handleAdd = () => {
    const id = parseInt(newId, 10);
    if (!newId || isNaN(id) || id < 1 || id > 4094) {
      setFormErr('VLAN ID debe ser 1–4094'); return;
    }
    if (!newNombre.trim()) {
      setFormErr('El nombre es requerido'); return;
    }
    setFormErr('');
    addMut.mutate({ vlanId: id, nombre: newNombre.trim() });
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
      {/* Tabla */}
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
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">Descripción</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody>
              {vlans.map((v) => (
                <tr key={v.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-primary">{v.vlanId}</td>
                  <td className="px-4 py-2.5 text-sm text-foreground">{v.nombre}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{v.descripcion ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => { setDeletingId(v.vlanId); delMut.mutate(v.vlanId); }}
                      disabled={delMut.isPending && deletingId === v.vlanId}
                      className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      {delMut.isPending && deletingId === v.vlanId
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2  className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border bg-muted/20">
            {vlans.length} VLANs
          </p>
        </div>
      )}

      {/* Agregar VLAN */}
      <div className="rounded-xl border border-border p-4 bg-muted/10 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Agregar VLAN
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
