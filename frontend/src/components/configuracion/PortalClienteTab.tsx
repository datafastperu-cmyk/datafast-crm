'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, AlertTriangle, Plus, Trash2, Image as ImageIcon } from 'lucide-react';

import {
  portalConfigApi,
  type PortalConfig,
  type PortalBanner,
  type UpsertPortalBannerDto,
} from '@/lib/api/portal-config';
import { Switch }   from '@/components/ui/Switch';
import { useToast } from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import { PortalSolicitudesPlan } from './PortalSolicitudesPlan';

type Pestana = 'general' | 'reporte-pago' | 'solicitudes' | 'banners' | 'diseno';

const PESTANAS: Array<{ id: Pestana; label: string }> = [
  { id: 'general',      label: 'General' },
  { id: 'reporte-pago', label: 'Reporte de pago' },
  { id: 'solicitudes',  label: 'Solicitudes de plan' },
  { id: 'banners',      label: 'Banners' },
  { id: 'diseno',       label: 'Diseño' },
];

// Cada toggle es un feature flag real: al apagarlo el backend deja de servir la sección,
// no se limita a ocultar el ítem del menú.
const SECCIONES: Array<{ campo: keyof PortalConfig; label: string; ayuda?: string }> = [
  { campo: 'mostrarComprobantes',   label: 'Mis comprobantes',   ayuda: 'Se muestran en pantalla; el portal no entrega archivos descargables.' },
  { campo: 'mostrarSoporte',        label: 'Soporte técnico',    ayuda: 'El cliente abre y sigue sus tickets.' },
  { campo: 'mostrarInformarPago',   label: 'Informar pago',      ayuda: 'El cliente reporta un pago hecho por transferencia o billetera.' },
  { campo: 'mostrarTestVelocidad',  label: 'Test de velocidad',  ayuda: 'Enlace externo, se abre en una pestaña nueva.' },
  { campo: 'mostrarNotificaciones', label: 'Notificaciones',     ayuda: 'Avisos publicados desde el ERP.' },
  { campo: 'mostrarWifi',           label: 'Mi WiFi',            ayuda: 'Solo disponible en contratos FTTH con ONU gestionable.' },
  { campo: 'mostrarDispositivos',   label: 'Dispositivos conectados', ayuda: 'Solo lectura: nombre, IP y MAC.' },
  { campo: 'mostrarPlanes',         label: 'Catálogo de planes', ayuda: 'Lista los planes marcados como visibles en el portal.' },
  { campo: 'mostrarBanner',         label: 'Banner de publicidad' },
  { campo: 'mostrarMenuPersonalizado', label: 'Menú personalizado' },
  { campo: 'mostrarConsumo',        label: 'Consumo de datos',   ayuda: 'Aún no hay colector de consumo: la sección se verá vacía.' },
];

export function PortalClienteTab() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [pestana, setPestana] = useState<Pestana>('general');
  const [form, setForm]       = useState<PortalConfig | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['portal-config'],
    queryFn:  portalConfigApi.get,
  });

  useEffect(() => {
    if (data?.config) setForm(data.config);
  }, [data]);

  const sucio = useMemo(
    () => !!form && !!data?.config && JSON.stringify(form) !== JSON.stringify(data.config),
    [form, data],
  );

  const { mutate: guardar, isPending: guardando } = useMutation({
    mutationFn: () => portalConfigApi.update(form!),
    onSuccess: (res) => {
      queryClient.setQueryData(['portal-config'], res);
      setForm(res.config);
      toast('Configuración guardada', { type: 'success' });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const set = <K extends keyof PortalConfig>(campo: K, valor: PortalConfig[K]) =>
    setForm((prev) => (prev ? { ...prev, [campo]: valor } : prev));

  if (isLoading || !form) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Advertencias del servidor: se muestran siempre, no solo tras guardar. */}
      {(data?.advertencias?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm font-semibold">Revisar configuración</p>
          </div>
          <ul className="text-sm text-amber-800 dark:text-amber-300 list-disc pl-6 space-y-0.5">
            {data!.advertencias.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}

      {/* Pestañas */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPestana(p.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors',
              pestana === p.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {pestana === 'general' && (
        <div className="space-y-4">
          <Card
            titulo="Datos del portal"
            accion={<BotonGuardar sucio={sucio} guardando={guardando} onClick={() => guardar()} />}
          >
            <Campo
              label="URL del portal"
              ayuda="Dirección pública que se incluye en los avisos enviados al cliente. Debe coincidir con el dominio configurado en el servidor (PORTAL_DOMAIN)."
            >
              <input
                className={inp()}
                placeholder="https://cliente.miempresa.pe"
                value={form.urlPortal ?? ''}
                onChange={(e) => set('urlPortal', e.target.value || null)}
              />
            </Campo>

            <Campo label="Título del portal">
              <input
                className={inp()}
                placeholder="Acceso Cliente"
                value={form.titulo}
                onChange={(e) => set('titulo', e.target.value)}
              />
            </Campo>

            <Campo label="URL del test de velocidad">
              <input
                className={inp()}
                placeholder="https://fast.com/es/"
                value={form.urlTestVelocidad ?? ''}
                onChange={(e) => set('urlTestVelocidad', e.target.value || null)}
              />
            </Campo>
          </Card>

          <Card
            titulo="Secciones habilitadas"
            accion={<BotonGuardar sucio={sucio} guardando={guardando} onClick={() => guardar()} />}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-3">
              {SECCIONES.map((s) => (
                <div key={s.campo} className="flex items-start justify-between gap-4 py-1">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{s.label}</p>
                    {s.ayuda && <p className="text-xs text-muted-foreground mt-0.5">{s.ayuda}</p>}
                  </div>
                  <Switch
                    checked={Boolean(form[s.campo])}
                    onChange={(v) => set(s.campo, v as PortalConfig[typeof s.campo])}
                    label={s.label}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card
            titulo="Menú personalizado"
            accion={<BotonGuardar sucio={sucio} guardando={guardando} onClick={() => guardar()} />}
          >
            <Campo label="Título">
              <input
                className={inp()}
                placeholder="Lugares de Pagos"
                value={form.tituloMenuPersonalizado ?? ''}
                onChange={(e) => set('tituloMenuPersonalizado', e.target.value || null)}
              />
            </Campo>
            <Campo
              label="Contenido"
              ayuda="Solo texto plano. No se admite HTML: este contenido se muestra a todos los abonados."
            >
              <textarea
                className={cn(inp(), 'min-h-[140px] resize-y')}
                placeholder={'Agente Kasnet — Av. Principal 123\nOficina — Jr. Comercio 456'}
                value={form.contenidoMenuPersonalizado ?? ''}
                onChange={(e) => set('contenidoMenuPersonalizado', e.target.value || null)}
              />
            </Campo>
          </Card>
        </div>
      )}

      {pestana === 'reporte-pago' && (
        <Card
          titulo="Reporte de pago"
          accion={<BotonGuardar sucio={sucio} guardando={guardando} onClick={() => guardar()} />}
        >
          <Campo
            label="Destinatarios del aviso"
            ayuda="Correos o números separados por coma. Reciben la notificación cuando un cliente informa un pago."
          >
            <input
              className={inp()}
              placeholder="cobranzas@miempresa.pe, 999888777"
              value={form.reportePagoDestinatarios ?? ''}
              onChange={(e) => set('reportePagoDestinatarios', e.target.value || null)}
            />
          </Campo>
          <Campo
            label="Medios de pago que ve el cliente"
            ayuda="Cuentas bancarias, Yape/Plin y demás datos para que el abonado pague mientras no haya pasarela en línea."
          >
            <textarea
              className={cn(inp(), 'min-h-[160px] resize-y')}
              placeholder={'BCP Soles — 191-0000000-0-00\nYape — 999 888 777 (Mi Empresa SAC)'}
              value={form.reportePagoMedios ?? ''}
              onChange={(e) => set('reportePagoMedios', e.target.value || null)}
            />
          </Campo>
        </Card>
      )}

      {pestana === 'solicitudes' && <PortalSolicitudesPlan />}

      {pestana === 'banners' && <BannersSeccion />}

      {pestana === 'diseno' && (
        <Card
          titulo="Diseño"
          accion={<BotonGuardar sucio={sucio} guardando={guardando} onClick={() => guardar()} />}
        >
          <Campo label="Logo (URL)" ayuda="Se muestra en la cabecera del portal.">
            <input
              className={inp()}
              placeholder="/uploads/logo-portal.png"
              value={form.logoUrl ?? ''}
              onChange={(e) => set('logoUrl', e.target.value || null)}
            />
          </Campo>

          <Campo label="Color primario">
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="h-9 w-14 rounded-lg border border-input bg-background cursor-pointer"
                value={form.colorPrimario}
                onChange={(e) => set('colorPrimario', e.target.value)}
                aria-label="Color primario"
              />
              <input
                className={cn(inp(), 'max-w-[140px] font-mono')}
                value={form.colorPrimario}
                onChange={(e) => set('colorPrimario', e.target.value)}
              />
            </div>
          </Campo>

          <Campo label="Tema">
            <select
              className={inp()}
              value={form.tema}
              onChange={(e) => set('tema', e.target.value)}
            >
              <option value="claro">Claro</option>
              <option value="oscuro">Oscuro</option>
              <option value="auto">Según el dispositivo</option>
            </select>
          </Campo>
        </Card>
      )}
    </div>
  );
}

// ─── Banners ──────────────────────────────────────────────────
const BANNER_NUEVO: UpsertPortalBannerDto = {
  titulo: null, imagenUrl: '', enlaceUrl: null,
  orden: 0, vigenteDesde: null, vigenteHasta: null, activo: true,
};

function BannersSeccion() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [nuevo, setNuevo] = useState<UpsertPortalBannerDto>(BANNER_NUEVO);

  const { data: banners, isLoading } = useQuery({
    queryKey: ['portal-banners'],
    queryFn:  portalConfigApi.listarBanners,
  });

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ['portal-banners'] });

  const { mutate: crear, isPending: creando } = useMutation({
    mutationFn: () => portalConfigApi.crearBanner(nuevo),
    onSuccess: () => { setNuevo(BANNER_NUEVO); invalidar(); toast('Banner creado', { type: 'success' }); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: alternar } = useMutation({
    mutationFn: (b: PortalBanner) => portalConfigApi.actualizarBanner(b.id, { activo: !b.activo }),
    onSuccess: invalidar,
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: eliminar } = useMutation({
    mutationFn: (id: string) => portalConfigApi.eliminarBanner(id),
    onSuccess: () => { invalidar(); toast('Banner eliminado', { type: 'success' }); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <div className="space-y-4">
      <Card titulo="Nuevo banner">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Campo label="Título">
            <input
              className={inp()}
              value={nuevo.titulo ?? ''}
              onChange={(e) => setNuevo({ ...nuevo, titulo: e.target.value || null })}
            />
          </Campo>
          <Campo label="Imagen (URL)">
            <input
              className={inp()}
              placeholder="/uploads/banner-verano.jpg"
              value={nuevo.imagenUrl}
              onChange={(e) => setNuevo({ ...nuevo, imagenUrl: e.target.value })}
            />
          </Campo>
          <Campo label="Enlace al hacer clic">
            <input
              className={inp()}
              placeholder="https://miempresa.pe/promo"
              value={nuevo.enlaceUrl ?? ''}
              onChange={(e) => setNuevo({ ...nuevo, enlaceUrl: e.target.value || null })}
            />
          </Campo>
          <Campo label="Orden">
            <input
              type="number" min={0} max={999}
              className={inp()}
              value={nuevo.orden}
              onChange={(e) => setNuevo({ ...nuevo, orden: Number(e.target.value) })}
            />
          </Campo>
          <Campo label="Vigente desde">
            <input
              type="date"
              className={inp()}
              value={nuevo.vigenteDesde ?? ''}
              onChange={(e) => setNuevo({ ...nuevo, vigenteDesde: e.target.value || null })}
            />
          </Campo>
          <Campo label="Vigente hasta">
            <input
              type="date"
              className={inp()}
              value={nuevo.vigenteHasta ?? ''}
              onChange={(e) => setNuevo({ ...nuevo, vigenteHasta: e.target.value || null })}
            />
          </Campo>
        </div>

        <button
          type="button"
          disabled={!nuevo.imagenUrl.trim() || creando}
          onClick={() => crear()}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
            'bg-primary text-primary-foreground hover:opacity-90 transition-opacity',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {creando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Agregar banner
        </button>
      </Card>

      <Card titulo="Banners publicados">
        {isLoading ? (
          <div className="h-16 rounded-lg bg-muted animate-pulse" />
        ) : !banners?.length ? (
          <p className="text-sm text-muted-foreground">Todavía no hay banners.</p>
        ) : (
          <ul className="divide-y divide-border">
            {banners.map((b) => (
              <li key={b.id} className="flex items-center gap-4 py-3">
                <ImageIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">{b.titulo || b.imagenUrl}</p>
                  <p className="text-xs text-muted-foreground">
                    Orden {b.orden}
                    {b.vigenteDesde && ` · desde ${b.vigenteDesde}`}
                    {b.vigenteHasta && ` · hasta ${b.vigenteHasta}`}
                  </p>
                </div>
                <Switch checked={b.activo} onChange={() => alternar(b)} label={`Activar ${b.titulo ?? 'banner'}`} />
                <button
                  type="button"
                  onClick={() => eliminar(b.id)}
                  className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label="Eliminar banner"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ─── Piezas de UI ─────────────────────────────────────────────
function Card({ titulo, accion, children }: {
  titulo: string; accion?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-6 py-3 border-b border-border flex items-center justify-between gap-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{titulo}</p>
        {accion}
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  );
}

function Campo({ label, ayuda, children }: {
  label: string; ayuda?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

function BotonGuardar({ sucio, guardando, onClick }: {
  sucio: boolean; guardando: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!sucio || guardando}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium',
        'bg-primary text-primary-foreground hover:opacity-90 transition-opacity',
        'disabled:opacity-40 disabled:cursor-not-allowed',
      )}
    >
      {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
      Guardar cambios
    </button>
  );
}

function inp() {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border border-input bg-background',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
  );
}
