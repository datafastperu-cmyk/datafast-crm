'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Wifi, ChevronDown, X, Network, Pencil, AlertTriangle } from 'lucide-react';
import { redesApi, type SegmentoIpv4, type CreateSegmentoDto, type DisponibilidadSegmento } from '@/lib/api/contratos';
import type { Router } from '@/lib/api/mikrotik';
import { useToast } from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import { Portal } from '@/components/ui/portal';

// ─── Main component ───────────────────────────────────────────
export function RedesIpv4Tab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm,  setShowForm]  = useState(false);
  const [editando,  setEditando]  = useState<SegmentoIpv4 | null>(null);
  const [detalle,   setDetalle]   = useState<string | null>(null);

  const { data: segmentos = [], isLoading } = useQuery({
    queryKey: ['segmentos-ipv4'],
    queryFn: () => redesApi.listSegmentos(),
  });

  const { data: routers = [] } = useQuery({
    queryKey: ['mikrotik-routers'],
    queryFn: () => redesApi.listRouters(),
  });

  const { mutate: eliminarMutation } = useMutation({
    mutationFn: (id: string) => redesApi.deleteSegmento(id),
    onSuccess: () => {
      toast('Segmento eliminado', { type: 'success' });
      qc.invalidateQueries({ queryKey: ['segmentos-ipv4'] });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const eliminar = (seg: SegmentoIpv4) => {
    // eslint-disable-next-line no-restricted-globals
    if (!confirm(`¿Eliminar el segmento "${seg.nombre}" (${seg.redCidr})? Esta acción no se puede deshacer.`)) return;
    eliminarMutation(seg.id);
  };

  const refresh = () => qc.invalidateQueries({ queryKey: ['segmentos-ipv4'] });

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

      {/* Modal crear */}
      {showForm && (
        <SegmentoForm
          routers={routers}
          segmentos={segmentos}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); refresh(); }}
        />
      )}

      {/* Modal editar */}
      {editando && (
        <SegmentoForm
          routers={routers}
          segmentos={segmentos}
          segmento={editando}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); refresh(); }}
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
                  onEditar={() => setEditando(seg)}
                  onEliminar={() => eliminar(seg)}
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
  seg, onEditar, onEliminar, onDetalle, showDetalle,
}: {
  seg: SegmentoIpv4;
  onEditar: () => void;
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
              onClick={onEditar}
              disabled={seg.ipsUsadas > 0}
              title={seg.ipsUsadas > 0 ? `Edición bloqueada: ${seg.ipsUsadas} IP${seg.ipsUsadas > 1 ? 's' : ''} asignada${seg.ipsUsadas > 1 ? 's' : ''}` : 'Editar segmento'}
              className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors text-muted-foreground hover:text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={onEliminar}
              disabled={seg.ipsUsadas > 0}
              title={seg.ipsUsadas > 0 ? `Eliminación bloqueada: ${seg.ipsUsadas} IP${seg.ipsUsadas > 1 ? 's' : ''} asignada${seg.ipsUsadas > 1 ? 's' : ''}` : 'Eliminar segmento'}
              className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
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

const CIDR_GRUPOS = [
  {
    label: 'Clase A',
    opts: [
      { prefix:  8, mask: '255.0.0.0',       hosts: 16777214, total: 16777216 },
      { prefix:  9, mask: '255.128.0.0',      hosts: 8388606,  total: 8388608  },
      { prefix: 10, mask: '255.192.0.0',      hosts: 4194302,  total: 4194304  },
      { prefix: 11, mask: '255.224.0.0',      hosts: 2097150,  total: 2097152  },
      { prefix: 12, mask: '255.240.0.0',      hosts: 1048574,  total: 1048576  },
      { prefix: 13, mask: '255.248.0.0',      hosts: 524286,   total: 524288   },
      { prefix: 14, mask: '255.252.0.0',      hosts: 262142,   total: 262144   },
      { prefix: 15, mask: '255.254.0.0',      hosts: 131070,   total: 131072   },
    ],
  },
  {
    label: 'Clase B',
    opts: [
      { prefix: 16, mask: '255.255.0.0',      hosts: 65534,    total: 65536    },
      { prefix: 17, mask: '255.255.128.0',    hosts: 32766,    total: 32768    },
      { prefix: 18, mask: '255.255.192.0',    hosts: 16382,    total: 16384    },
      { prefix: 19, mask: '255.255.224.0',    hosts: 8190,     total: 8192     },
      { prefix: 20, mask: '255.255.240.0',    hosts: 4094,     total: 4096     },
      { prefix: 21, mask: '255.255.248.0',    hosts: 2046,     total: 2048     },
      { prefix: 22, mask: '255.255.252.0',    hosts: 1022,     total: 1024     },
      { prefix: 23, mask: '255.255.254.0',    hosts: 510,      total: 512      },
    ],
  },
  {
    label: 'Clase C',
    opts: [
      { prefix: 24, mask: '255.255.255.0',    hosts: 254,      total: 256      },
      { prefix: 25, mask: '255.255.255.128',  hosts: 126,      total: 128      },
      { prefix: 26, mask: '255.255.255.192',  hosts: 62,       total: 64       },
      { prefix: 27, mask: '255.255.255.224',  hosts: 30,       total: 32       },
      { prefix: 28, mask: '255.255.255.240',  hosts: 14,       total: 16       },
      { prefix: 29, mask: '255.255.255.248',  hosts: 6,        total: 8        },
      { prefix: 30, mask: '255.255.255.252',  hosts: 2,        total: 4        },
    ],
  },
];

// ─── Form component (modal — create & edit) ──────────────────
function SegmentoForm({
  routers, segmentos, segmento, onClose, onSaved,
}: {
  routers:   Router[];
  segmentos: SegmentoIpv4[];
  segmento?: SegmentoIpv4;   // undefined = crear | defined = editar
  onClose:   () => void;
  onSaved:   () => void;
}) {
  const { toast }   = useToast();
  const esEdicion   = !!segmento;

  // Descomponer redCidr existente en red + prefijo
  const [redInicial, prefInicial] = segmento
    ? (segmento.redCidr || '/24').split('/')
    : ['', '24'];

  const [red,    setRed]    = useState(redInicial);
  const [prefix, setPrefix] = useState(prefInicial ?? '24');
  const [form,   setForm]   = useState({
    nombre:       segmento?.nombre       ?? '',
    gateway:      segmento?.gateway      ?? '',
    routerId:     segmento?.routerId     ?? '',
    tipoServicio: segmento?.tipoServicio ?? 'wisp',
    authType:     segmento?.authType     ?? 'pppoe',
  });

  // Auto-rellena gateway solo en modo creación
  useEffect(() => {
    if (esEdicion) return;
    const parts = red.trim().split('.');
    if (parts.length === 4 && parts.every((p) => p !== '' && !isNaN(Number(p)))) {
      setForm((prev) => ({ ...prev, gateway: [...parts.slice(0, 3), '1'].join('.') }));
    }
  }, [red, esEdicion]);

  const dto = {
    nombre:       form.nombre,
    redCidr:      `${red}/${prefix}`,
    gateway:      form.gateway,
    routerId:     form.routerId     || undefined,
    tipoServicio: form.tipoServicio || 'wisp',
    authType:     form.authType     || 'pppoe',
  };

  const { mutate: crear, isPending: creando } = useMutation({
    mutationFn: () => redesApi.createSegmento(dto),
    onSuccess: () => { toast('Segmento creado', { type: 'success' }); onSaved(); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: actualizar, isPending: actualizando } = useMutation({
    mutationFn: () => redesApi.updateSegmento(segmento!.id, dto),
    onSuccess: () => { toast('Segmento actualizado', { type: 'success' }); onSaved(); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const isPending  = creando || actualizando;
  const set        = (k: keyof typeof form, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  // Detecta si el CIDR ya existe en otro segmento (diferente id)
  const cidrActual = `${red.trim()}/${prefix}`;
  const conflictos = useMemo(() => segmentos.filter(
    (s) => s.redCidr === cidrActual && s.id !== segmento?.id,
  ), [segmentos, cidrActual, segmento?.id]);

  // Verifica si el CIDR existe como red configurada en el router MikroTik.
  // Solo aplica para amarre_ip_mac / amarre_ip_mac_dhcp: el ARP estático y el DHCP server
  // requieren que la subred esté configurada como dirección local en el router.
  // PPPoE NO lo necesita: el pool PPPoE asigna IPs directamente sin depender de una interfaz.
  const redCompleta     = red.trim().split('.').length === 4 && red.trim() !== '';
  const requiereVerif   = form.authType !== 'pppoe';
  const { data: checkRouter, isFetching: checkando } = useQuery({
    queryKey: ['cidr-en-router', form.routerId, cidrActual],
    queryFn: () => redesApi.checkCidrEnRouter(form.routerId, cidrActual),
    enabled: !!form.routerId && redCompleta && requiereVerif,
    staleTime: 10_000,
    retry: false,
  });

  // Bloquear envío si la verificación está en curso o confirmó que la red no existe en el router
  const bloqueadoPorRouter = requiereVerif && !!form.routerId && redCompleta && (checkando || checkRouter?.existe === false);
  const canSubmit  = form.nombre.trim() && red.trim() && form.gateway.trim() && !bloqueadoPorRouter;

  return (
    <Portal>
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">
            {esEdicion ? 'Editar Red IPv4' : 'Nueva Red IPv4'}
          </h3>
          <button type="button" onClick={onClose}
            className="p-1 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">

          <FRow label="Nombre">
            <input
              value={form.nombre}
              onChange={(e) => set('nombre', e.target.value)}
              placeholder="RED NUEVA"
              className={inputCls()}
            />
          </FRow>

          <FRow label="Tipo de servicio">
            <select value={form.tipoServicio} onChange={(e) => set('tipoServicio', e.target.value)} className={inputCls()}>
              <option value="wisp">WISP — Radio / Antena</option>
              <option value="ftth">FTTH — Fibra Óptica</option>
            </select>
          </FRow>

          <FRow label="Tipo de auth">
            <select value={form.authType} onChange={(e) => set('authType', e.target.value)} className={inputCls()}>
              <option value="pppoe">PPPoE</option>
              <option value="amarre_ip_mac">Amarre IP/MAC</option>
              <option value="amarre_ip_mac_dhcp">Amarre IP/MAC + DHCP Leases</option>
            </select>
          </FRow>

          <FRow label="Router">
            <select value={form.routerId} onChange={(e) => set('routerId', e.target.value)} className={inputCls()}>
              <option value="">Sin asignar</option>
              {routers.map((r) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
          </FRow>

          <FRow label="Red">
            <div className="flex items-center gap-0 border border-input rounded-lg overflow-hidden bg-background focus-within:ring-2 focus-within:ring-primary">
              <span className="px-3 py-2 bg-muted border-r border-input">
                <Network className="w-4 h-4 text-muted-foreground" />
              </span>
              <input
                value={red}
                onChange={(e) => setRed(e.target.value)}
                placeholder="192.168.1.0"
                className="flex-1 px-3 py-2 text-sm font-mono bg-transparent focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Ejm: 192.168.1.0</p>
          </FRow>

          <FRow label="CIDR">
            <select value={prefix} onChange={(e) => setPrefix(e.target.value)} className={inputCls()}>
              {CIDR_GRUPOS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.opts.map((o) => (
                    <option key={o.prefix} value={String(o.prefix)}>
                      {o.prefix} ({o.mask} - {o.hosts} hosts, {o.total} IP)
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </FRow>

          <FRow label="Puerta de enlace">
            <input
              value={form.gateway}
              onChange={(e) => set('gateway', e.target.value)}
              placeholder="192.168.1.1"
              className={cn(inputCls(), 'font-mono')}
            />
          </FRow>

          {/* Verificación del CIDR en el router MikroTik — solo amarre IP/MAC */}
          {requiereVerif && form.routerId && redCompleta && (
            checkando ? (
              <p className="text-xs text-muted-foreground px-1">Verificando red en el router...</p>
            ) : checkRouter?.existe === false ? (
              <div className="flex gap-2 p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-800/50">
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs text-red-700 dark:text-red-400 space-y-1">
                  <p className="font-medium">Esta red no existe en el router MikroTik asignado.</p>
                  <p>
                    Debes crear primero la interfaz o dirección <span className="font-mono font-medium">{cidrActual}</span> en el
                    router antes de registrar este segmento. De lo contrario, las IPs asignadas
                    no serán enrutadas correctamente.
                  </p>
                  {checkRouter.redesEnRouter.length > 0 && (
                    <p className="mt-1 text-red-600 dark:text-red-500">
                      Redes detectadas en el router: <span className="font-mono">{checkRouter.redesEnRouter.join(', ')}</span>
                    </p>
                  )}
                </div>
              </div>
            ) : checkRouter?.existe === null ? (
              <div className="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800/50">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  No se pudo verificar el router (puede estar offline o sin VPN activa). Confirma manualmente que la red <span className="font-mono font-medium">{cidrActual}</span> existe antes de registrar.
                </p>
              </div>
            ) : null
          )}

          {/* Advertencia CIDR duplicado */}
          {conflictos.length > 0 && (
            <div className="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800/50">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
                <p className="font-medium">Este rango ya está asignado a otro segmento:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {conflictos.map((c) => {
                    const routerNombre = routers.find((r) => r.id === c.routerId)?.nombre;
                    return (
                      <li key={c.id}>
                        <span className="font-mono">{c.redCidr}</span> — {c.nombre}
                        {routerNombre && <span> (Router: <span className="font-medium">{routerNombre}</span>)</span>}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1 text-amber-600 dark:text-amber-500">
                  Si ambos routers comparten comunicación física o lógica entre sí, esto puede generar conflictos de enrutamiento.
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} disabled={isPending}
            className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50">
            Cerrar
          </button>
          <button
            onClick={() => esEdicion ? actualizar() : crear()}
            disabled={isPending || !canSubmit}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {isPending ? 'Guardando...' : checkando && form.routerId ? 'Verificando router...' : esEdicion ? 'Guardar cambios' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

function FRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-4">
      <span className="text-sm text-muted-foreground text-right pt-2">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function inputCls() {
  return 'w-full px-3 py-2 text-sm rounded-lg border border-input bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors';
}
