'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Eye, Wifi, Server, ChevronDown } from 'lucide-react';
import { redesApi, type SegmentoIpv4, type CreateSegmentoDto, type DisponibilidadSegmento } from '@/lib/api/contratos';
import type { Router } from '@/lib/api/mikrotik';
import { useToast } from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

// ─── Main component ───────────────────────────────────────────
export function RedesIpv4Tab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [detalle, setDetalle] = useState<string | null>(null);

  const { data: segmentos = [], isLoading } = useQuery({
    queryKey: ['segmentos-ipv4'],
    queryFn: () => redesApi.listSegmentos(),
  });

  const { data: routers = [] } = useQuery({
    queryKey: ['mikrotik-routers'],
    queryFn: () => redesApi.listRouters(),
  });

  const { mutate: eliminar } = useMutation({
    mutationFn: (id: string) => redesApi.deleteSegmento(id),
    onSuccess: () => {
      toast('Segmento desactivado', { type: 'success' });
      qc.invalidateQueries({ queryKey: ['segmentos-ipv4'] });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Cargando...</div>;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{segmentos.length} segmento{segmentos.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Nuevo segmento
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <SegmentoForm
          routers={routers}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ['segmentos-ipv4'] });
          }}
        />
      )}

      {/* Table */}
      {segmentos.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Wifi className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No hay segmentos configurados.</p>
          <p className="text-xs mt-1">Crea el primero con el botón de arriba.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Nombre</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Red CIDR</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Gateway</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Uso</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {segmentos.map((seg) => (
                <SegmentoRow
                  key={seg.id}
                  seg={seg}
                  onEliminar={() => eliminar(seg.id)}
                  onDetalle={() => setDetalle(detalle === seg.id ? null : seg.id)}
                  showDetalle={detalle === seg.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Row component ────────────────────────────────────────────
function SegmentoRow({
  seg, onEliminar, onDetalle, showDetalle,
}: {
  seg: SegmentoIpv4;
  onEliminar: () => void;
  onDetalle: () => void;
  showDetalle: boolean;
}) {
  const pct = seg.totalIps > 0 ? Math.round((seg.ipsUsadas / seg.totalIps) * 100) : 0;
  const { data: dispo, isLoading: loadingDispo } = useQuery({
    queryKey: ['segmento-dispo', seg.id],
    queryFn: () => redesApi.getDisponibilidad(seg.id),
    enabled: showDetalle,
  });

  return (
    <>
      <tr className="hover:bg-muted/30 transition-colors">
        <td className="px-4 py-3 font-medium text-foreground">{seg.nombre}</td>
        <td className="px-4 py-3 font-mono text-xs">{seg.redCidr}</td>
        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{seg.gateway}</td>
        <td className="px-4 py-3">
          <span className={cn(
            'inline-flex px-2 py-0.5 rounded-full text-xs font-medium',
            seg.tipoServicio === 'ftth' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400' :
            seg.tipoServicio === 'wisp' ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400' :
            'bg-muted text-muted-foreground',
          )}>
            {seg.tipoServicio.toUpperCase()}
          </span>
        </td>
        <td className="px-4 py-3 min-w-[140px]">
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{seg.ipsUsadas}/{seg.totalIps} IPs</span>
              <span>{pct}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-orange-500' : 'bg-green-500',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1 justify-end">
            <button
              onClick={onDetalle}
              title="Ver IPs"
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn('w-4 h-4 transition-transform', showDetalle && 'rotate-180')} />
            </button>
            <button
              onClick={onEliminar}
              title="Desactivar"
              className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
      {showDetalle && (
        <tr>
          <td colSpan={6} className="bg-muted/20 px-4 py-3">
            {loadingDispo ? (
              <p className="text-xs text-muted-foreground">Cargando disponibilidad...</p>
            ) : dispo ? (
              <DisponibilidadView dispo={dispo} />
            ) : null}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Disponibilidad view ─────────────────────────────────────
function DisponibilidadView({ dispo }: { dispo: DisponibilidadSegmento }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">
        {dispo.segmento.ipsDisponibles} IPs libres de {dispo.segmento.totalIps} — {dispo.segmento.porcentajeUso}% usado
      </p>
      <div className="flex flex-wrap gap-1">
        {dispo.ips?.map((entry) => (
          <span
            key={entry.ip}
            title={entry.ip}
            className={cn(
              'inline-block w-2 h-2 rounded-sm',
              entry.estado === 'libre'     ? 'bg-green-500' :
              entry.estado === 'asignada'  ? 'bg-red-500' :
                                             'bg-muted-foreground',
            )}
          />
        ))}
        {dispo.hayMas && <span className="text-xs text-muted-foreground">+más...</span>}
      </div>
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500 inline-block" /> Libre</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> Asignada</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-muted-foreground inline-block" /> Reservada</span>
      </div>
    </div>
  );
}

// ─── Form component ───────────────────────────────────────────
function SegmentoForm({
  routers, onClose, onCreated,
}: {
  routers: Router[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<CreateSegmentoDto>({
    nombre: '',
    redCidr: '',
    gateway: '',
    dnsPrimario: '8.8.8.8',
    dnsSecundario: '8.8.4.4',
    tipoServicio: 'ftth',
    routerId: '',
  });

  const { mutate: crear, isPending } = useMutation({
    mutationFn: () => redesApi.createSegmento({
      ...form,
      routerId: form.routerId || undefined,
      dnsSecundario: form.dnsSecundario || undefined,
    }),
    onSuccess: () => {
      toast('Segmento creado', { type: 'success' });
      onCreated();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const set = (k: keyof CreateSegmentoDto, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Nuevo segmento IPv4</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Nombre *</label>
          <input
            value={form.nombre}
            onChange={(e) => set('nombre', e.target.value)}
            placeholder="Red Clientes Piura"
            className={inputCls()}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Tipo de servicio</label>
          <select value={form.tipoServicio} onChange={(e) => set('tipoServicio', e.target.value)} className={inputCls()}>
            <option value="ftth">FTTH</option>
            <option value="wisp">WISP</option>
            <option value="dedicado">Dedicado</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Red CIDR *</label>
          <input
            value={form.redCidr}
            onChange={(e) => set('redCidr', e.target.value)}
            placeholder="192.168.1.0/24"
            className={cn(inputCls(), 'font-mono')}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Gateway *</label>
          <input
            value={form.gateway}
            onChange={(e) => set('gateway', e.target.value)}
            placeholder="192.168.1.1"
            className={cn(inputCls(), 'font-mono')}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">DNS primario</label>
          <input
            value={form.dnsPrimario}
            onChange={(e) => set('dnsPrimario', e.target.value)}
            placeholder="8.8.8.8"
            className={cn(inputCls(), 'font-mono')}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">DNS secundario</label>
          <input
            value={form.dnsSecundario}
            onChange={(e) => set('dnsSecundario', e.target.value)}
            placeholder="8.8.4.4"
            className={cn(inputCls(), 'font-mono')}
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <label className="text-xs font-medium text-foreground">Router MikroTik (opcional)</label>
          <select value={form.routerId} onChange={(e) => set('routerId', e.target.value)} className={inputCls()}>
            <option value="">Sin asignar</option>
            {routers.map((r) => (
              <option key={r.id} value={r.id}>{r.nombre} — {r.host}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
          Cancelar
        </button>
        <button
          onClick={() => crear()}
          disabled={isPending || !form.nombre || !form.redCidr || !form.gateway}
          className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {isPending ? 'Guardando...' : 'Crear segmento'}
        </button>
      </div>
    </div>
  );
}

function inputCls() {
  return 'w-full px-3 py-2 text-sm rounded-lg border border-input bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors';
}
