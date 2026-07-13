'use client';

import { useState } from 'react';
import { useRouter as useNextRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MapPin, Plus, X, Trash2, Loader2, Server, Router as RouterIcon,
  Shield, ChevronRight, Radio, Wifi, WifiOff,
} from 'lucide-react';

import { sitesApi, type Site, type CreateSiteDto } from '@/lib/api/sites';
import { mikrotikApi } from '@/lib/api/mikrotik';
import { useToast } from '@/components/ui/toaster';
import { Portal } from '@/components/ui/portal';
import { parseApiError, cn } from '@/lib/utils';

const inputCls = 'w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors';
const labelCls = 'text-xs font-medium text-muted-foreground block mb-1';

// ─── Modal: crear Site ──────────────────────────────────────────

function CrearSiteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<CreateSiteDto>({ nombre: '', ubicacion: '', routerId: '' });

  const { data: routers = [], isLoading: loadingRouters } = useQuery({
    queryKey: ['routers-lista'],
    queryFn:  () => mikrotikApi.listar(),
  });

  const crear = useMutation({
    mutationFn: () => sitesApi.crear({
      ...form,
      routerId: form.routerId || undefined,
      ubicacion: form.ubicacion || undefined,
    }),
    onSuccess: () => {
      toast(`Site "${form.nombre}" creado`, { type: 'success' });
      onCreated();
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
        <div
          role="dialog" aria-modal="true"
          className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Nuevo Site</h3>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); if (form.nombre.trim()) crear.mutate(); }}
            className="p-5 space-y-3.5"
          >
            <div>
              <label className={labelCls}>Nombre *</label>
              <input
                className={inputCls}
                placeholder="Ej: Nodo Norte - Cabecera Principal"
                value={form.nombre}
                onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))}
                autoFocus
                required
              />
            </div>

            <div>
              <label className={labelCls}>Ubicación</label>
              <input
                className={inputCls}
                placeholder="Ej: Av. Los Pinos 450"
                value={form.ubicacion}
                onChange={(e) => setForm(f => ({ ...f, ubicacion: e.target.value }))}
              />
            </div>

            <div>
              <label className={labelCls}>Router de cabecera</label>
              <select
                className={inputCls}
                value={form.routerId}
                onChange={(e) => setForm(f => ({ ...f, routerId: e.target.value }))}
                disabled={loadingRouters}
              >
                <option value="">— Sin asignar todavía —</option>
                {routers.map(r => (
                  <option key={r.id} value={r.id}>{r.nombre} ({r.ipGestion})</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Se puede asignar después. Un router solo puede pertenecer a un Site.
              </p>
            </div>

            {crear.isError && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {parseApiError(crear.error)}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={crear.isPending || !form.nombre.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {crear.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Crear Site
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}

// ─── Modal: detalle Site (Router + VPN + OLTs) ──────────────────

const VPN_ESTADO_COLORS: Record<string, string> = {
  conectado:     'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  desconectado:  'bg-red-500/15 text-red-400 border-red-500/30',
  pendiente:     'bg-amber-500/15 text-amber-400 border-amber-500/30',
  revocado:      'bg-muted/40 text-muted-foreground border-border',
};

function DetalleSiteModal({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const nextRouter = useNextRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['site-detalle', siteId],
    queryFn:  () => sitesApi.detalle(siteId),
  });

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
        <div
          role="dialog" aria-modal="true"
          className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">{data?.site.nombre ?? 'Site'}</h3>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando...
              </div>
            ) : !data ? (
              <p className="text-sm text-muted-foreground">No se pudo cargar el Site.</p>
            ) : (
              <>
                {data.site.ubicacion && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> {data.site.ubicacion}
                  </p>
                )}

                {/* Router */}
                <div className="border border-border rounded-xl p-3.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                    <RouterIcon className="w-3.5 h-3.5" /> Router de cabecera
                  </div>
                  {data.router ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{data.router.nombre}</p>
                        <p className="text-xs text-muted-foreground font-mono">{data.router.ipGestion}</p>
                      </div>
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border',
                        data.router.estado === 'online'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-red-500/15 text-red-400 border-red-500/30')}>
                        {data.router.estado === 'online' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                        {data.router.estado}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/70">Sin router asignado.</p>
                  )}
                </div>

                {/* VPN */}
                <div className="border border-border rounded-xl p-3.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                    <Shield className="w-3.5 h-3.5" /> Túnel VPN
                  </div>
                  {data.vpn ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{data.vpn.nombre}</p>
                        {data.vpn.vpnIp && <p className="text-xs text-muted-foreground font-mono">{data.vpn.vpnIp}</p>}
                      </div>
                      <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs border',
                        VPN_ESTADO_COLORS[data.vpn.estado] ?? VPN_ESTADO_COLORS.pendiente)}>
                        {data.vpn.estado}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/70">Sin túnel VPN registrado para este router.</p>
                  )}
                </div>

                {/* OLTs */}
                <div className="border border-border rounded-xl p-3.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                    <Server className="w-3.5 h-3.5" /> OLTs ({data.olts.length})
                  </div>
                  {data.olts.length === 0 ? (
                    <p className="text-xs text-muted-foreground/70">Sin OLTs registradas detrás de este router.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {data.olts.map(olt => (
                        <button
                          key={olt.id}
                          onClick={() => nextRouter.push(`/red/olt/${olt.id}`)}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-accent/40 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Radio className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm text-foreground truncate">{olt.nombre}</p>
                              <p className="text-xs text-muted-foreground">{olt.marca.toUpperCase()} · {olt.onusActivas} ONUs</p>
                            </div>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ─── Modal: confirmar eliminación ───────────────────────────────

function DeleteSiteModal({
  site, onClose, onDeleted,
}: { site: Site; onClose: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const eliminar = useMutation({
    mutationFn: () => sitesApi.eliminar(site.id),
    onSuccess: () => { toast(`Site "${site.nombre}" eliminado`, { type: 'success' }); onDeleted(); },
    onError:   (err) => toast(parseApiError(err), { type: 'error' }),
  });

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
        <div
          role="dialog" aria-modal="true"
          className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-sm font-semibold text-foreground mb-1.5">Eliminar Site</h3>
          <p className="text-sm text-muted-foreground mb-4">
            ¿Eliminar <strong className="text-foreground">{site.nombre}</strong>? El Router, VPN y OLTs asociados
            no se eliminan — solo dejan de estar agrupados bajo este Site.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted">
              Cancelar
            </button>
            <button
              onClick={() => eliminar.mutate()}
              disabled={eliminar.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {eliminar.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Eliminar
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ─── Componente principal ────────────────────────────────────────

export function SitesContent() {
  const queryClient = useQueryClient();
  const [crearOpen, setCrearOpen] = useState(false);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Site | null>(null);

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['sites-lista'],
    queryFn:  () => sitesApi.listar(),
  });

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ['sites-lista'] });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Sites</h2>
          <p className="text-sm text-muted-foreground">
            {sites.length} sites · Router + VPN + OLT agrupados por nodo de red
          </p>
        </div>
        <button
          onClick={() => setCrearOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Nuevo Site
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando sites...
          </div>
        ) : sites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <MapPin className="w-10 h-10 opacity-30" />
            <p className="text-sm">No hay Sites registrados</p>
            <button onClick={() => setCrearOpen(true)} className="mt-1 text-sm text-primary hover:underline">
              Crear el primer Site
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Site</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Ubicación</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Router</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sites.map((site) => (
                  <tr
                    key={site.id}
                    onClick={() => setDetalleId(site.id)}
                    className="transition-colors hover:bg-accent/40 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-foreground">{site.nombre}</div>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{site.ubicacion || '—'}</td>
                    <td className="px-4 py-3">
                      {site.routerId ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                          Asignado
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">Sin asignar</span>
                      )}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDeleteTarget(site)}
                          title="Eliminar Site"
                          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-red-400 hover:border-red-700/50 hover:bg-red-500/10 transition-colors"
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
      </div>

      {crearOpen && (
        <CrearSiteModal
          onClose={() => setCrearOpen(false)}
          onCreated={() => { setCrearOpen(false); invalidar(); }}
        />
      )}
      {detalleId && (
        <DetalleSiteModal siteId={detalleId} onClose={() => setDetalleId(null)} />
      )}
      {deleteTarget && (
        <DeleteSiteModal
          site={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); invalidar(); }}
        />
      )}
    </div>
  );
}
