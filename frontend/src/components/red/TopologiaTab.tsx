'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, RefreshCw, Loader2, Network, Zap } from 'lucide-react';
import { oltNativoApi, type OltVlan, type OltTrafficTable } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

interface Props { oltId: string; }

function inputCls(err?: boolean) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground transition-colors outline-none',
    'focus:ring-2 focus:ring-primary/30 focus:border-primary',
    err ? 'border-red-500' : 'border-border hover:border-muted-foreground/50',
  );
}

// ─── VLANs section ────────────────────────────────────────────

function VlansSection({ oltId }: { oltId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newVlanId,   setNewVlanId]   = useState('');
  const [newNombre,   setNewNombre]   = useState('');
  const [formErr,     setFormErr]     = useState('');
  const [deletingId,  setDeletingId]  = useState<number | null>(null);

  const { data: vlans = [], isLoading } = useQuery<OltVlan[]>({
    queryKey: ['olt-vlans', oltId],
    queryFn:  () => oltNativoApi.listarVlans(oltId),
  });

  const addMut = useMutation({
    mutationFn: (dto: { vlanId: number; nombre: string }) =>
      oltNativoApi.agregarVlan(oltId, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-vlans', oltId] });
      setNewVlanId('');
      setNewNombre('');
      setFormErr('');
      toast('VLAN agregada', { type: 'success' });
    },
    onError: (e: any) => {
      setFormErr(e?.response?.data?.message ?? 'Error al agregar VLAN');
    },
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
    const id = parseInt(newVlanId, 10);
    if (!newVlanId || isNaN(id) || id < 1 || id > 4094) {
      setFormErr('VLAN ID debe ser 1-4094');
      return;
    }
    if (!newNombre.trim()) {
      setFormErr('El nombre es requerido');
      return;
    }
    setFormErr('');
    addMut.mutate({ vlanId: id, nombre: newNombre.trim() });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Network className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-semibold text-foreground">VLANs registradas</h4>
        <span className="text-xs text-muted-foreground">({vlans.length})</span>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="space-y-1.5">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-9 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : vlans.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
          Sin VLANs registradas
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden mb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">ID</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Nombre</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {vlans.map((v) => (
                <tr key={v.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-xs text-foreground">{v.vlanId}</td>
                  <td className="px-3 py-2 text-foreground">{v.nombre}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => { setDeletingId(v.vlanId); delMut.mutate(v.vlanId); }}
                      disabled={delMut.isPending && deletingId === v.vlanId}
                      className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                    >
                      {delMut.isPending && deletingId === v.vlanId
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Agregar VLAN */}
      <div className="rounded-lg border border-border p-3 bg-muted/10 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Agregar VLAN
        </p>
        <div className="flex gap-2">
          <input
            value={newVlanId}
            onChange={(e) => { setNewVlanId(e.target.value); setFormErr(''); }}
            placeholder="ID (1-4094)"
            type="number" min={1} max={4094}
            className={cn(inputCls(!!formErr), 'w-32')}
          />
          <input
            value={newNombre}
            onChange={(e) => { setNewNombre(e.target.value); setFormErr(''); }}
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

// ─── Traffic Tables section ───────────────────────────────────

function TrafficTablesSection({ oltId }: { oltId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: tables = [], isLoading } = useQuery<OltTrafficTable[]>({
    queryKey: ['olt-traffic-tables', oltId],
    queryFn:  () => oltNativoApi.listarTrafficTables(oltId),
  });

  const syncMut = useMutation({
    mutationFn: () => oltNativoApi.sincronizarTrafficTables(oltId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['olt-traffic-tables', oltId] });
      toast(`Sincronizado: ${r.insertadas} nuevas, ${r.actualizadas} actualizadas`, { type: 'success' });
    },
    onError: () => {
      toast('Error al sincronizar desde la OLT', { type: 'error' });
    },
  });

  const fmtSpeed = (kbps: number | null) => {
    if (kbps == null) return '—';
    if (kbps >= 1_000_000) return `${(kbps / 1_000_000).toFixed(0)} Gbps`;
    if (kbps >= 1_000)     return `${(kbps / 1_000).toFixed(0)} Mbps`;
    return `${kbps} kbps`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          <h4 className="text-sm font-semibold text-foreground">Traffic Tables (perfiles de velocidad)</h4>
          <span className="text-xs text-muted-foreground">({tables.length})</span>
        </div>
        <button
          onClick={() => syncMut.mutate()}
          disabled={syncMut.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border
                     hover:bg-accent transition-colors disabled:opacity-60 text-muted-foreground hover:text-foreground"
        >
          {syncMut.isPending
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5" />}
          Sincronizar desde OLT
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-1.5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-9 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : tables.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
          <p>Sin traffic tables.</p>
          <p className="text-xs mt-1 opacity-70">Usa &quot;Sincronizar desde OLT&quot; para importarlas.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Idx</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Nombre</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">CIR</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">PIR</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.trafficId}</td>
                  <td className="px-3 py-2 text-foreground">{t.nombre}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmtSpeed(t.cirKbps)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmtSpeed(t.pirKbps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────

export function TopologiaTab({ oltId }: Props) {
  return (
    <div className="space-y-6">
      <VlansSection oltId={oltId} />
      <div className="border-t border-border" />
      <TrafficTablesSection oltId={oltId} />
    </div>
  );
}
