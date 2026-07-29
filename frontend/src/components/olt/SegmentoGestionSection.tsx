'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Network, Plus, Trash2, Search } from 'lucide-react';
import { oltMgmtIpPoolApi } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const inputCls = cn(
  'w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground transition-colors outline-none',
  'focus:ring-2 focus:ring-primary/30 focus:border-primary border-border hover:border-muted-foreground/50',
);

// Segmento de gestión TR-069 de una OLT.
//
// Las IPs de gestión NO las reparte un servidor DHCP: el ERP las asigna estáticamente desde
// este pool y las escribe en el IP-host de la ONU (el modo DHCP nunca materializó en las
// EG8145V5 probadas — incidente 2026-07-17). Hasta ahora el pool solo existía como endpoint:
// no había forma de ver el rango, la ocupación ni qué ONU tenía qué IP sin consultar la base
// de datos. Con el carril inyectándose en cada aprovisionamiento pasa a ser un recurso de
// primera línea, y un recurso que se agota no puede ser invisible.
export function SegmentoGestionSection({ oltId }: { oltId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [estado, setEstado] = useState<'todos' | 'libre' | 'ocupado'>('ocupado');
  const [q, setQ]           = useState('');
  const [page, setPage]     = useState(1);

  // Rango a configurar/retirar
  const [inicio, setInicio] = useState('');
  const [fin, setFin]       = useState('');

  const { data: resumen } = useQuery({
    queryKey: ['olt-mgmt-ip-estado', oltId],
    queryFn:  () => oltMgmtIpPoolApi.estado(oltId),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['olt-mgmt-ip-detalle', oltId, estado, q, page],
    queryFn:  () => oltMgmtIpPoolApi.detalle(oltId, {
      estado: estado === 'todos' ? undefined : estado,
      q: q.trim() || undefined,
      page, limit: 50,
    }),
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['olt-mgmt-ip-estado', oltId] });
    qc.invalidateQueries({ queryKey: ['olt-mgmt-ip-detalle', oltId] });
  };

  const configurar = useMutation({
    mutationFn: () => oltMgmtIpPoolApi.configurar(oltId, inicio.trim(), fin.trim()),
    onSuccess: (r) => {
      toast(`${r.insertados} IP(s) añadidas al segmento`, { type: 'success' });
      setInicio(''); setFin(''); refrescar();
    },
    // El backend rechaza con motivo (solapamiento con otra OLT, rango invertido, >1024):
    // se muestra tal cual, porque es exactamente lo que el operador necesita para corregir.
    onError: (e: any) => toast(e?.response?.data?.message ?? 'No se pudo configurar el rango', { type: 'error' }),
  });

  const retirar = useMutation({
    mutationFn: () => oltMgmtIpPoolApi.retirar(oltId, inicio.trim(), fin.trim()),
    onSuccess: (r) => {
      toast(`${r.retiradas} IP(s) retiradas del segmento`, { type: 'success' });
      setInicio(''); setFin(''); refrescar();
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'No se pudo retirar el rango', { type: 'error' }),
  });

  const total    = resumen?.total ?? 0;
  const ocupados = resumen?.ocupados ?? 0;
  const libres   = resumen?.libres ?? 0;
  const pctUso   = total > 0 ? Math.round((ocupados / total) * 100) : 0;
  const sinPool  = total === 0;
  // Aviso temprano: quedarse sin IPs de gestión no degrada nada, corta el aprovisionamiento.
  const critico  = !sinPool && libres <= Math.max(10, Math.round(total * 0.05));

  const paginas = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Network className="w-5 h-5 text-primary mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Segmento de gestión TR-069</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            IPs estáticas que el ERP asigna al carril de gestión de cada ONU de esta OLT. No las
            reparte ningún DHCP: el ERP las escribe directamente en el IP-host de la ONU. En una
            VLAN de gestión compartida, cada OLT debe tener un tramo propio y disjunto.
          </p>
        </div>
      </div>

      {/* ── Resumen de ocupación ─────────────────────────────── */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        {sinPool ? (
          <p className="text-sm text-muted-foreground">
            Esta OLT no tiene segmento configurado. Sin él, el carril TR-069 solo funciona
            indicando la IP a mano en cada aprovisionamiento.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="text-sm font-mono text-foreground">
                {data?.rango.desde ?? '—'} – {data?.rango.hasta ?? '—'}
              </span>
              <span className="text-xs text-muted-foreground">
                <b className="text-foreground">{ocupados}</b> en uso · <b className="text-foreground">{libres}</b> libres · {total} totales
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', critico ? 'bg-amber-500' : 'bg-primary')}
                style={{ width: `${Math.max(pctUso, 1)}%` }}
              />
            </div>
            {critico && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Quedan {libres} IP(s) libres. Al agotarse, los aprovisionamientos con carril TR-069
                empezarán a fallar — amplía el tramo antes de llegar ahí.
              </p>
            )}
          </>
        )}

        {/* ── Configurar / retirar tramo ──────────────────────── */}
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="w-40">
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Desde</label>
            <input value={inicio} onChange={(e) => setInicio(e.target.value)} placeholder="10.16.4.1" className={cn(inputCls, 'font-mono')} />
          </div>
          <div className="w-40">
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Hasta</label>
            <input value={fin} onChange={(e) => setFin(e.target.value)} placeholder="10.16.4.254" className={cn(inputCls, 'font-mono')} />
          </div>
          <button
            onClick={() => configurar.mutate()}
            disabled={!inicio.trim() || !fin.trim() || configurar.isPending}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {configurar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Añadir tramo
          </button>
          <button
            onClick={() => retirar.mutate()}
            disabled={!inicio.trim() || !fin.trim() || retirar.isPending}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40"
          >
            {retirar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Retirar tramo
          </button>
          <p className="text-[11px] text-muted-foreground w-full">
            Máximo 1024 IPs por operación. Retirar solo saca las libres: una IP en uso vive en el
            IP-host de una ONU, y para liberarla hay que desaprovisionarla o desactivar su carril.
          </p>
        </div>
      </div>

      {/* ── Filtros ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(['ocupado', 'libre', 'todos'] as const).map((op) => (
            <button
              key={op}
              onClick={() => { setEstado(op); setPage(1); }}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                estado === op ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {op === 'ocupado' ? 'En uso' : op === 'libre' ? 'Libres' : 'Todas'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="IP, SN, contrato o cliente"
            className={cn(inputCls, 'pl-8 py-1.5 text-xs')}
          />
        </div>
      </div>

      {/* ── Tabla IP → ONU ───────────────────────────────────── */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">IP</th>
                <th className="text-left font-medium px-3 py-2">ONU</th>
                <th className="text-left font-medium px-3 py-2">SN</th>
                <th className="text-left font-medium px-3 py-2">Contrato</th>
                <th className="text-left font-medium px-3 py-2">Cliente</th>
                <th className="text-left font-medium px-3 py-2">Carril</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr><td colSpan={6} className="px-3 py-8 text-center"><Loader2 className="w-4 h-4 animate-spin inline text-muted-foreground" /></td></tr>
              )}
              {!isLoading && (data?.items.length ?? 0) === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">Sin resultados.</td></tr>
              )}
              {data?.items.map((it) => (
                <tr key={it.ip} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-mono text-xs text-foreground">{it.ip}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {it.onuId != null ? `0/${it.slot}/${it.port}:${it.onuId}` : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{it.sn ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{it.numeroContrato ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-foreground">{it.cliente ?? <span className="text-muted-foreground">libre</span>}</td>
                  <td className="px-3 py-2">
                    {it.carrilEstado
                      ? <span className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-medium',
                          it.carrilEstado === 'activo'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground',
                        )}>{it.carrilEstado}</span>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {paginas > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/20">
            <span className="text-[11px] text-muted-foreground">{data?.total} resultado(s) · página {page} de {paginas}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-2 py-1 text-xs rounded border border-border disabled:opacity-40 hover:bg-muted transition-colors">Anterior</button>
              <button onClick={() => setPage((p) => Math.min(paginas, p + 1))} disabled={page >= paginas}
                className="px-2 py-1 text-xs rounded border border-border disabled:opacity-40 hover:bg-muted transition-colors">Siguiente</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
