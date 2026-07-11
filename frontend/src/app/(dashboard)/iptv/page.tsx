'use client';

import { useState, useEffect } from 'react';
import { createPortal }  from 'react-dom';
import { useForm }       from 'react-hook-form';
import { zodResolver }   from '@hookform/resolvers/zod';
import { z }             from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tv, Users, Radio, AlertTriangle, Server, Plus, X, Loader2,
  CheckCircle2, XCircle, MapPin, Pencil,
} from 'lucide-react';
import { PageHeader }  from '@/components/shared/PageHeader';
import { useToast }    from '@/components/ui/toaster';
import { cn, parseApiError } from '@/lib/utils';
import { xuiApi, type XuiServidor, type ServidorFormDto } from '@/lib/api/xui';

// Vista administrativa global de todos los lines IPTV (no reemplaza la
// sección "Servicios IPTV" de la ficha del cliente, que es donde se editan).
// Sin botón eliminar: la baja de un line es siempre automática, disparada
// por el cambio de plan del contrato dueño.
export default function IPTVPage() {
  const [tab, setTab] = useState<'lines' | 'canales' | 'servidores'>('lines');
  const [q, setQ]     = useState('');
  const [showWizard, setShowWizard] = useState(false);

  const { data: servidor, isLoading: cargandoServidor } = useQuery({
    queryKey: ['xui-servidor'],
    queryFn:  xuiApi.obtenerServidor,
    enabled:  tab === 'servidores',
  });

  const { data: lines = [], isLoading: cargandoLines } = useQuery({
    queryKey: ['xui-lines-all'],
    queryFn:  () => xuiApi.listar(),
    refetchInterval: 20_000,
  });

  const { data: canalesData, isLoading: cargandoCanales } = useQuery({
    queryKey: ['xui-channels-status'],
    queryFn:  xuiApi.canalesStatus,
    refetchInterval: 20_000,
    enabled: tab === 'canales',
  });

  const { data: health } = useQuery({
    queryKey: ['xui-health'],
    queryFn:  xuiApi.health,
    refetchInterval: 60_000,
  });

  const linesFiltered = lines.filter(l =>
    !q || l.usuario.toLowerCase().includes(q.toLowerCase()),
  );

  const canales = canalesData?.canales ?? [];
  const stats = {
    linesActivos:   lines.filter(l => l.activo).length,
    conectados:     lines.filter(l => l.conectado).length,
    canalesOnline:  canales.filter(c => c.online).length,
    canalesOffline: canales.filter(c => !c.online).length,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="IPTV — XUI ONE"
        description="Vista administrativa de lines y canales del panel XUI ONE"
        breadcrumbs={[{ label: 'Servicios' }, { label: 'IPTV' }]}
        badge={
          health && !health.conectado
            ? { label: 'XUI degradado', color: 'red' }
            : { label: 'XUI ONE', color: 'purple' }
        }
      />

      {health && !health.conectado && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {health.mensaje}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Lines activos',    value: stats.linesActivos,   icon: Users,  color: 'text-blue-400',    bg: 'bg-blue-500/10' },
          { label: 'Conectados ahora', value: stats.conectados,     icon: Tv,     color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Canales online',   value: stats.canalesOnline,  icon: Radio,  color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Canales caídos',   value: stats.canalesOffline, icon: Radio,  color: 'text-red-400',     bg: 'bg-red-500/10' },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className={cn('p-2.5 rounded-xl flex-shrink-0', s.bg)}>
              <s.icon className={cn('w-5 h-5', s.color)} />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
              <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-0.5 w-fit">
        {(['lines', 'canales', 'servidores'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('text-sm px-4 py-1.5 rounded-md capitalize transition-colors',
              tab === t ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}>{t === 'lines' ? 'Lines' : t === 'canales' ? 'Canales' : 'Servidores'}</button>
        ))}
      </div>

      {tab === 'lines' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-3 border-b border-border">
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por usuario..."
              className="w-full max-w-xs px-3 py-1.5 text-sm rounded-md border border-border bg-background"
            />
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Vínculo</th>
                <th>Bouquets</th>
                <th>Máx. conexiones</th>
                <th>Canal actual</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {cargandoLines ? (
                <tr><td colSpan={6} className="text-center text-sm text-muted-foreground py-6">Cargando…</td></tr>
              ) : linesFiltered.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-sm text-muted-foreground py-6">Sin lines registrados</td></tr>
              ) : linesFiltered.map((l) => (
                <tr key={l.id}>
                  <td className="font-mono text-sm text-foreground">{l.usuario}</td>
                  <td>
                    {l.contratoId
                      ? <span className="pill-online">Con contrato</span>
                      : <span className="pill-offline">Sin contrato</span>}
                  </td>
                  <td className="text-center text-sm">{l.bouquetIds.length}</td>
                  <td className="text-center text-sm">{l.maxConexiones}</td>
                  <td className="text-xs text-muted-foreground">{l.canalActual ?? '—'}</td>
                  <td>
                    {l.estadoSync === 'error'
                      ? <span className="pill-offline">Error sync</span>
                      : l.estadoSync === 'pendiente_creacion'
                      ? <span className="pill-offline">Sincronizando…</span>
                      : l.conectado
                      ? <span className="pill-online">Conectado</span>
                      : <span className="text-xs text-muted-foreground">Desconectado</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'canales' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {cargandoCanales ? (
            <p className="text-sm text-muted-foreground">Cargando canales…</p>
          ) : canales.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos de canales — el módulo puede estar degradado o el poller aún no corrió.</p>
          ) : canales.map((ch) => (
            <div key={ch.channelId}
                 className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 hover:border-border/80 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                <Tv className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{ch.nombre}</p>
                <span className="text-xs text-muted-foreground">Bouquet {ch.bouquetId}</span>
              </div>
              <span className={ch.online ? 'status-dot-online' : 'status-dot-offline'} />
            </div>
          ))}
        </div>
      )}

      {tab === 'servidores' && (
        <div className="space-y-3">
          {cargandoServidor ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : !servidor ? (
            <div className="bg-card border border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-3 text-center">
              <Server className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Aún no se ha configurado el servidor XUI ONE.</p>
              <button
                onClick={() => setShowWizard(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Agregar servidor
              </button>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-4">
              <div className="p-2.5 rounded-xl bg-purple-500/10 flex-shrink-0">
                <Server className="w-5 h-5 text-purple-400" />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{servidor.nombre}</p>
                  {servidor.estadoConexion === 'ok' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Conectado
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                      <XCircle className="w-3.5 h-3.5" /> {servidor.ultimoErrorConexion ?? 'Sin verificar'}
                    </span>
                  )}
                </div>
                {servidor.descripcion && (
                  <p className="text-xs text-muted-foreground">{servidor.descripcion}</p>
                )}
                {(servidor.latitud != null && servidor.longitud != null) && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {servidor.latitud}, {servidor.longitud}
                  </p>
                )}
                <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground">
                  <span>{servidor.totalLineas} lines</span>
                  <span>{servidor.totalBouquets} bouquets</span>
                  <span>{servidor.totalCanales} canales</span>
                </div>
              </div>
              <button
                onClick={() => setShowWizard(true)}
                className="p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {showWizard && (
        <XuiServidorWizard servidor={servidor ?? null} onClose={() => setShowWizard(false)} />
      )}
    </div>
  );
}

// ── Wizard de alta/edición del servidor XUI ONE ────────────────
// "Probar conexión" debe ser exitosa antes de habilitar "Guardar".
const servidorSchema = z.object({
  nombre:      z.string().min(2, 'Mínimo 2 caracteres'),
  descripcion: z.string().optional(),
  apiUrl:      z.string().min(1, 'Requerido'),
  apiKey:      z.string().min(1, 'Requerido'),
  latitud:     z.coerce.number().optional(),
  longitud:    z.coerce.number().optional(),
});
type ServidorFormValues = z.infer<typeof servidorSchema>;

function XuiServidorWizard({ servidor, onClose }: { servidor: XuiServidor | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast }    = useToast();
  const [prueba, setPrueba] = useState<{ conectado: boolean; mensaje: string } | null>(null);
  const [probando, setProbando] = useState(false);

  const { register, handleSubmit, getValues, watch, formState: { errors } } = useForm<ServidorFormValues>({
    resolver: zodResolver(servidorSchema),
    defaultValues: {
      nombre:      servidor?.nombre ?? '',
      descripcion: servidor?.descripcion ?? '',
      apiUrl:      servidor?.apiUrl ?? '',
      apiKey:      '',
      latitud:     servidor?.latitud ?? undefined,
      longitud:    servidor?.longitud ?? undefined,
    },
  });

  // Cualquier cambio en URL/Key invalida la prueba previa — hay que
  // volver a probar antes de poder guardar.
  const apiUrl = watch('apiUrl');
  const apiKey = watch('apiKey');
  useEffect(() => { setPrueba(null); }, [apiUrl, apiKey]);

  const probarConexion = async () => {
    const values = getValues();
    if (!values.apiUrl || !values.apiKey) {
      toast('Completa API URL y API Key antes de probar', { type: 'warning' });
      return;
    }
    setProbando(true);
    setPrueba(null);
    try {
      const res = await xuiApi.probarServidor({ apiUrl: values.apiUrl, apiKey: values.apiKey });
      setPrueba(res);
    } catch (e) {
      setPrueba({ conectado: false, mensaje: parseApiError(e) });
    } finally {
      setProbando(false);
    }
  };

  const { mutate: guardar, isPending } = useMutation({
    mutationFn: (dto: ServidorFormDto) =>
      servidor ? xuiApi.editarServidor(servidor.id, dto) : xuiApi.crearServidor(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['xui-servidor'] });
      queryClient.invalidateQueries({ queryKey: ['xui-health'] });
      toast('Servidor XUI ONE guardado', { type: 'success' });
      onClose();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const onSubmit = (values: ServidorFormValues) => {
    if (!prueba?.conectado) {
      toast('Prueba la conexión antes de guardar', { type: 'warning' });
      return;
    }
    const dto: ServidorFormDto = {
      nombre:      values.nombre,
      descripcion: values.descripcion,
      apiUrl:      values.apiUrl,
      apiKey:      values.apiKey,
      latitud:     values.latitud,
      longitud:    values.longitud,
    };
    guardar(dto);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-xl shadow-xl w-full max-w-md p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {servidor ? 'Editar servidor XUI ONE' : 'Agregar servidor XUI ONE'}
          </h3>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Nombre</label>
            <input {...register('nombre')} className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-background" />
            {errors.nombre && <p className="text-[11px] text-red-500">{errors.nombre.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Descripción</label>
            <textarea {...register('descripcion')} rows={2} className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-background" />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">API URL</label>
            <input {...register('apiUrl')} placeholder="https://panel.tudominio.com" className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-background" />
            {errors.apiUrl && <p className="text-[11px] text-red-500">{errors.apiUrl.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">API Key</label>
            <input {...register('apiKey')} type="password" className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-background" />
            {errors.apiKey && <p className="text-[11px] text-red-500">{errors.apiKey.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Latitud</label>
              <input {...register('latitud')} type="number" step="any" className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-background" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Longitud</label>
              <input {...register('longitud')} type="number" step="any" className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-background" />
            </div>
          </div>

          <button
            type="button"
            onClick={probarConexion}
            disabled={probando}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {probando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Probar conexión
          </button>

          {prueba && (
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-md text-xs',
              prueba.conectado
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-500/10 text-red-600 dark:text-red-400',
            )}>
              {prueba.conectado ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {prueba.mensaje}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!prueba?.conectado || isPending}
              className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground disabled:opacity-50 flex items-center gap-1"
            >
              {isPending && <Loader2 className="w-3 h-3 animate-spin" />} Guardar
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
