'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Server, Trash2 } from 'lucide-react';
import { oltNativoApi, type OltServiceProfile, type OltTrafficTable } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

type SubTab = 'line' | 'service' | 'traffic';

export function TabProfiles({ oltId }: { oltId: string }) {
  const [sub, setSub] = useState<SubTab>('line');

  const { data: lineProfiles = [], isLoading: loadingLine } = useQuery({
    queryKey: ['olt-line-profiles', oltId],
    queryFn:  () => oltNativoApi.getLineProfiles(oltId),
    enabled:  !!oltId,
  });

  const { data: srvProfiles = [], isLoading: loadingSrv } = useQuery({
    queryKey: ['olt-service-profiles', oltId],
    queryFn:  () => oltNativoApi.getServiceProfiles(oltId),
    enabled:  !!oltId,
  });

  const { data: trafficTables = [], isLoading: loadingTraffic } = useQuery({
    queryKey: ['olt-traffic-tables', oltId],
    queryFn:  () => oltNativoApi.listarTrafficTables(oltId),
    enabled:  !!oltId,
  });

  const isLoading = loadingLine || loadingSrv || loadingTraffic;

  const subTabCls = (id: SubTab) => cn(
    'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
    sub === id
      ? 'bg-muted text-foreground'
      : 'text-muted-foreground hover:text-foreground',
  );

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-lg p-1 w-fit">
        <button className={subTabCls('line')}    onClick={() => setSub('line')}>    Line ({lineProfiles.length})</button>
        <button className={subTabCls('service')} onClick={() => setSub('service')}>Service ({srvProfiles.length})</button>
        <button className={subTabCls('traffic')} onClick={() => setSub('traffic')}>Traffic ({trafficTables.length})</button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {sub === 'line' && (
            lineProfiles.length === 0 ? <EmptyProfiles label="perfiles de línea" /> : (
              <ProfileTable
                headers={['Profile ID', 'Nombre']}
                rows={lineProfiles.map(p => [String(p.profileId), p.nombre])}
              />
            )
          )}
          {/* Excepción de la directriz: los TIPOS DE ONU (ont-srvprofile) se
              gestionan a demanda — cada modelo nuevo de ONU necesita el suyo. */}
          {sub === 'service' && <TiposOnuManager oltId={oltId} srvProfiles={srvProfiles} />}
          {/* Excepción de la directriz: las VELOCIDADES son flexibles post-baseline
              (agregar/retirar según el negocio). Sello DATAFAST obligatorio; solo
              se eliminan las del ERP y sin ONUs usándolas (guards del backend). */}
          {sub === 'traffic' && <VelocidadesManager oltId={oltId} trafficTables={trafficTables} />}
        </>
      )}

      <p className="text-[11px] text-muted-foreground">
        Line y Service profiles son vistas informativas del estado sincronizado. Las velocidades
        (traffic tables) sí se gestionan aquí — siempre con sello DATAFAST; el resto de recursos
        del ERP se declara en el Baseline (tab Cumplimiento).
      </p>
    </div>
  );
}

// ─── Gestor de tipos de ONU (ont-srvprofile) ───────────────────────

export function TiposOnuManager({ oltId, srvProfiles }: { oltId: string; srvProfiles: OltServiceProfile[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modelo, setModelo] = useState('');
  const [eth,  setEth]  = useState('4');
  const [pots, setPots] = useState('0');
  const [catv, setCatv] = useState('0');

  const valido = modelo.trim().length > 0 && Number(eth) >= 1;

  const agregar = useMutation({
    mutationFn: () => oltNativoApi.agregarSrvProfile(oltId, {
      modelo: modelo.trim().toUpperCase(), eth: Number(eth), pots: Number(pots), catv: Number(catv),
    }),
    onSuccess: (p) => {
      toast(`Tipo de ONU "${p.nombre}" creado en la OLT (profile-id ${p.profileId})`, { type: 'success' });
      setModelo('');
      qc.invalidateQueries({ queryKey: ['olt-service-profiles', oltId] });
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Error al crear el tipo de ONU', { type: 'error' }),
  });

  const eliminar = useMutation({
    mutationFn: (p: OltServiceProfile) => oltNativoApi.eliminarSrvProfile(oltId, p.profileId),
    onSuccess: (_d, p) => {
      toast(`Tipo de ONU "${p.nombre}" eliminado de la OLT`, { type: 'success' });
      qc.invalidateQueries({ queryKey: ['olt-service-profiles', oltId] });
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'No se pudo eliminar (¿en uso o preexistente?)', { type: 'error' }),
  });

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border p-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Modelo de ONU (sello automático)</label>
          <div className="flex items-center">
            <span className="px-2 py-2 text-sm font-mono text-muted-foreground bg-muted/40 border border-r-0 border-border rounded-l-lg">DATAFAST_</span>
            <input value={modelo} onChange={e => setModelo(e.target.value)} placeholder="EG8145V5"
              className="w-32 px-2 py-2 text-sm font-mono rounded-r-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>
        {[
          { label: 'Puertos ETH', val: eth,  set: setEth,  min: 1 },
          { label: 'POTS (tel.)', val: pots, set: setPots, min: 0 },
          { label: 'CATV',        val: catv, set: setCatv, min: 0 },
        ].map(f => (
          <div key={f.label}>
            <label className="block text-[11px] text-muted-foreground mb-1">{f.label}</label>
            <input value={f.val} onChange={e => f.set(e.target.value)} type="number" min={f.min} max={24}
              className="w-20 px-3 py-2 text-sm font-mono rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        ))}
        <button
          onClick={() => agregar.mutate()}
          disabled={!valido || agregar.isPending}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {agregar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Crear en la OLT
        </button>
      </div>

      {srvProfiles.length === 0 ? <EmptyProfiles label="tipos de ONU" /> : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Profile ID', 'Nombre (modelo)', 'Origen', ''].map((h, i) => (
                  <th key={i} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {srvProfiles.map(p => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                  <td className="px-4 py-2.5 font-mono font-semibold text-primary">{p.profileId}</td>
                  <td className="px-4 py-2.5 font-mono">{p.nombre}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      'inline-flex rounded-full border px-2 py-0.5 text-[11px]',
                      p.origen === 'erp' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                    )}>
                      {p.origen === 'erp' ? 'ERP (DataFast)' : 'Preexistente'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {p.origen === 'erp' && (
                      <button
                        onClick={() => eliminar.mutate(p)}
                        disabled={eliminar.isPending}
                        title="Eliminar de la OLT (solo si ninguna ONU lo usa)"
                        className="p-1 text-muted-foreground hover:text-red-400 disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        El tipo de ONU (ont-srvprofile) describe el modelo físico del equipo del cliente
        (puertos ETH, telefonía, CATV). Los preexistentes nunca se tocan; la OLT además
        rechaza eliminar cualquiera con ONTs asociadas.
      </p>
    </div>
  );
}

// ─── Gestor de velocidades (traffic tables) ────────────────────────

function VelocidadesManager({ oltId, trafficTables }: { oltId: string; trafficTables: OltTrafficTable[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [sufijo, setSufijo] = useState('');
  const [mbps, setMbps]     = useState('');

  const nombre = sufijo.trim() ? `DATAFAST-${sufijo.trim().toUpperCase()}` : '';
  const kbps   = Math.round(Number(mbps) * 1024);
  const valido = !!nombre && kbps >= 64 && kbps <= 10_000_000
    && !trafficTables.some(t => t.nombre === nombre);

  const agregar = useMutation({
    mutationFn: () => oltNativoApi.agregarTrafficTable(oltId, { nombre, cirKbps: kbps, pirKbps: kbps }),
    onSuccess: (t) => {
      toast(`Velocidad "${t.nombre}" creada en la OLT (TID ${t.trafficId})`, { type: 'success' });
      setSufijo(''); setMbps('');
      qc.invalidateQueries({ queryKey: ['olt-traffic-tables', oltId] });
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Error al crear la velocidad', { type: 'error' }),
  });

  const eliminar = useMutation({
    mutationFn: (t: OltTrafficTable) => oltNativoApi.eliminarTrafficTableConCli(oltId, t.trafficId),
    onSuccess: (_d, t) => {
      toast(`Velocidad "${t.nombre}" eliminada de la OLT`, { type: 'success' });
      qc.invalidateQueries({ queryKey: ['olt-traffic-tables', oltId] });
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'No se pudo eliminar (¿en uso o preexistente?)', { type: 'error' }),
  });

  return (
    <div className="space-y-3">
      {/* Agregar velocidad — sello DATAFAST forzado, CIR=PIR simétrico */}
      <div className="rounded-xl border border-border p-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Nombre (sello automático)</label>
          <div className="flex items-center">
            <span className="px-2 py-2 text-sm font-mono text-muted-foreground bg-muted/40 border border-r-0 border-border rounded-l-lg">DATAFAST-</span>
            <input value={sufijo} onChange={e => setSufijo(e.target.value)} placeholder="300M"
              className="w-24 px-2 py-2 text-sm font-mono rounded-r-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground mb-1">Velocidad (Mbps, simétrica)</label>
          <input value={mbps} onChange={e => setMbps(e.target.value)} type="number" min={1} placeholder="300"
            className="w-28 px-3 py-2 text-sm font-mono rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <button
          onClick={() => agregar.mutate()}
          disabled={!valido || agregar.isPending}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {agregar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Crear en la OLT
        </button>
        {kbps > 0 && <span className="text-[11px] text-muted-foreground">= {kbps} kbps CIR/PIR</span>}
      </div>

      {trafficTables.length === 0 ? <EmptyProfiles label="traffic tables" /> : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['TID', 'Nombre', 'CIR (kbps)', 'PIR (kbps)', 'Origen', ''].map((h, i) => (
                  <th key={i} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trafficTables.map(t => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                  <td className="px-4 py-2.5 font-mono font-semibold text-primary">{t.trafficId}</td>
                  <td className="px-4 py-2.5 font-mono">{t.nombre}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{t.cirKbps ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{t.pirKbps ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      'inline-flex rounded-full border px-2 py-0.5 text-[11px]',
                      t.origen === 'erp' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                    )}>
                      {t.origen === 'erp' ? 'ERP (DataFast)' : 'Preexistente'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {t.origen === 'erp' && (
                      <button
                        onClick={() => eliminar.mutate(t)}
                        disabled={eliminar.isPending}
                        title="Eliminar de la OLT (solo si ninguna ONU la usa)"
                        className="p-1 text-muted-foreground hover:text-red-400 disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Las preexistentes nunca se tocan. Si una velocidad nueva se vuelve estándar del negocio,
        agrégala también al Baseline (versión nueva) para que toda OLT futura la reciba.
      </p>
    </div>
  );
}

function EmptyProfiles({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <Server className="w-8 h-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">Sin {label} — usa &quot;Sincronizar&quot; para cargar</p>
    </div>
  );
}

function ProfileTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {headers.map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className={cn('px-4 py-2.5 text-sm', j === 0 ? 'font-mono font-semibold text-primary' : 'text-foreground')}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border bg-muted/20">
        {rows.length} entradas
      </p>
    </div>
  );
}
