'use client';

import { useState }              from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Router, Plus, Pencil, Trash2, Wifi, WifiOff,
  RefreshCw, CheckCircle2, XCircle, Loader2, AlertTriangle,
  Lock, Shield, ShieldOff,
} from 'lucide-react';

import { mikrotikApi }  from '@/lib/api/mikrotik';
import { useToast }     from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import type { Router as RouterType, CreateRouterDto } from '@/lib/api/mikrotik';

const TIPO_CONTROL_LABELS = {
  ninguna:             { label: 'Sin control',           icon: ShieldOff,  color: 'text-gray-400' },
  amarre_ip_mac:       { label: 'Amarre IP + MAC',       icon: Shield,     color: 'text-blue-400' },
  amarre_ip_mac_dhcp:  { label: 'IP + MAC + DHCP Lease', icon: Lock,       color: 'text-violet-400' },
};

const ESTADO_COLORS = {
  online:        'text-green-400',
  offline:       'text-red-400',
  degradado:     'text-yellow-400',
  mantenimiento: 'text-orange-400',
  desconocido:   'text-gray-400',
};

// ─── Modal de agregar / editar router ────────────────────────────
interface RouterModalProps {
  router?: RouterType | null;
  onClose: () => void;
  onSaved: () => void;
}

function RouterModal({ router, onClose, onSaved }: RouterModalProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<CreateRouterDto>({
    nombre:        router?.nombre        ?? '',
    descripcion:   router?.descripcion   ?? '',
    ubicacion:     router?.ubicacion     ?? '',
    modelo:        router?.modelo        ?? '',
    ipGestion:     router?.ipGestion     ?? '',
    vpnIp:         router?.vpnIp         ?? '',
    puertoApi:     router?.puertoApi     ?? 8728,
    usuario:       router?.usuario       ?? 'admin',
    password:      '',
    metodoConexion: router?.metodoConexion ?? 'api',
    usarSsl:       router?.usarSsl       ?? false,
    tipoControl:   router?.tipoControl   ?? 'ninguna',
  });
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!form.nombre || !form.ipGestion || !form.usuario) {
      toast('Nombre, IP de gestión y usuario son obligatorios', { type: 'error' });
      return;
    }
    if (!router && !form.password) {
      toast('La contraseña es obligatoria al crear un router', { type: 'error' });
      return;
    }
    setLoading(true);
    try {
      const dto = { ...form };
      // Si no se cambió la contraseña en edición, no enviarla
      if (router && !dto.password) delete dto.password;
      if (router) {
        await mikrotikApi.actualizar(router.id, dto);
        toast('Router actualizado', { type: 'success' });
      } else {
        await mikrotikApi.crear(dto);
        toast('Router registrado', { type: 'success' });
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(parseApiError(err), { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const set = (key: keyof CreateRouterDto, val: any) =>
    setForm((f) => ({ ...f, [key]: val }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[hsl(var(--sidebar-bg))] border border-white/10 rounded-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-semibold text-white">
            {router ? 'Editar Router' : 'Agregar Router'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-400 mb-1 block">Nombre *</label>
              <input
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                value={form.nombre}
                onChange={(e) => set('nombre', e.target.value)}
                placeholder="Router Castilla Norte"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">IP de Gestión *</label>
              <input
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                value={form.ipGestion}
                onChange={(e) => set('ipGestion', e.target.value)}
                placeholder="192.168.1.1"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">IP VPN (opcional)</label>
              <input
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                value={form.vpnIp ?? ''}
                onChange={(e) => set('vpnIp', e.target.value)}
                placeholder="10.8.0.2"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Usuario *</label>
              <input
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                value={form.usuario}
                onChange={(e) => set('usuario', e.target.value)}
                placeholder="admin"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">
                Contraseña {router ? '(dejar vacío = no cambiar)' : '*'}
              </label>
              <input
                type="password"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Puerto API</label>
              <input
                type="number"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                value={form.puertoApi}
                onChange={(e) => set('puertoApi', parseInt(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Modelo</label>
              <input
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                value={form.modelo ?? ''}
                onChange={(e) => set('modelo', e.target.value)}
                placeholder="CCR1036-12G-4S"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Ubicación</label>
              <input
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                value={form.ubicacion ?? ''}
                onChange={(e) => set('ubicacion', e.target.value)}
                placeholder="Av. Sánchez Cerro 1234"
              />
            </div>
          </div>

          {/* Control de Seguridad */}
          <div>
            <label className="text-xs text-gray-400 mb-2 block">Tipo de Control de Seguridad</label>
            <div className="space-y-2">
              {(Object.entries(TIPO_CONTROL_LABELS) as Array<[string, typeof TIPO_CONTROL_LABELS['ninguna']]>).map(([val, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <label
                    key={val}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      form.tipoControl === val
                        ? 'border-primary/50 bg-primary/10'
                        : 'border-white/10 hover:border-white/20',
                    )}
                  >
                    <input
                      type="radio"
                      name="tipoControl"
                      value={val}
                      checked={form.tipoControl === val}
                      onChange={() => set('tipoControl', val)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className={cn('text-sm font-medium flex items-center gap-1.5', cfg.color)}>
                        <Icon className="w-3.5 h-3.5" />
                        {cfg.label}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {val === 'ninguna' && 'No aplica controles de seguridad IP-MAC'}
                        {val === 'amarre_ip_mac' && 'Agrega entrada estática en IP > ARP al provisionar clientes'}
                        {val === 'amarre_ip_mac_dhcp' && 'Agrega ARP estático + lease estático en IP > DHCP Server > Leases'}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="usarSsl"
              checked={form.usarSsl}
              onChange={(e) => set('usarSsl', e.target.checked)}
              className="rounded"
            />
            <label htmlFor="usarSsl" className="text-sm text-gray-300">Usar SSL (puerto 8729)</label>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-5 pb-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-5 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {router ? 'Guardar cambios' : 'Agregar router'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────
export function RoutersContent() {
  const { toast }      = useToast();
  const queryClient    = useQueryClient();
  const [showModal, setShowModal]     = useState(false);
  const [editRouter, setEditRouter]   = useState<RouterType | null>(null);
  const [testingId, setTestingId]     = useState<string | null>(null);

  const { data: routers = [], isLoading } = useQuery<RouterType[]>({
    queryKey:        ['routers'],
    queryFn:         mikrotikApi.listar,
    refetchInterval: 60_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => mikrotikApi.eliminar(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routers'] });
      toast('Router eliminado', { type: 'success' });
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const testConexion = async (router: RouterType) => {
    setTestingId(router.id);
    try {
      const result = await mikrotikApi.testConexion(router.id);
      if (result.exitoso) {
        toast(`Conectado en ${result.latenciaMs}ms — ${result.mensaje}`, { type: 'success' });
      } else {
        toast(result.mensaje, { type: 'error' });
      }
      queryClient.invalidateQueries({ queryKey: ['routers'] });
    } catch (err) {
      toast(parseApiError(err), { type: 'error' });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = (router: RouterType) => {
    if (!confirm(`¿Eliminar el router "${router.nombre}"?`)) return;
    deleteMut.mutate(router.id);
  };

  const onSaved = () => queryClient.invalidateQueries({ queryKey: ['routers'] });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Router className="w-5 h-5 text-primary" />
            Routers MikroTik
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            {routers.length} router{routers.length !== 1 ? 's' : ''} registrado{routers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => { setEditRouter(null); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Agregar router
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : routers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400">
          <Router className="w-12 h-12 mb-3 opacity-30" />
          <p>No hay routers registrados</p>
          <button
            onClick={() => { setEditRouter(null); setShowModal(true); }}
            className="mt-3 text-primary text-sm hover:underline"
          >
            Agregar el primer router
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-gray-400 uppercase tracking-wider">
                <th className="text-left px-4 py-3">Router</th>
                <th className="text-left px-4 py-3">IP Gestión</th>
                <th className="text-left px-4 py-3">IP VPN</th>
                <th className="text-left px-4 py-3">Control</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">Latencia</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {routers.map((r) => {
                const estadoColor = ESTADO_COLORS[r.estado as keyof typeof ESTADO_COLORS] ?? 'text-gray-400';
                const ctrl        = TIPO_CONTROL_LABELS[r.tipoControl];
                const CtrlIcon    = ctrl?.icon ?? ShieldOff;
                const isTesting   = testingId === r.id;

                return (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{r.nombre}</div>
                      {r.modelo && <div className="text-xs text-gray-400">{r.modelo}</div>}
                      {r.identityRouteros && <div className="text-xs text-gray-500">{r.identityRouteros}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-300">{r.ipGestion}</td>
                    <td className="px-4 py-3 font-mono">
                      {r.vpnIp ? (
                        <span className="text-blue-400">{r.vpnIp}</span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('flex items-center gap-1 text-xs', ctrl?.color ?? 'text-gray-400')}>
                        <CtrlIcon className="w-3.5 h-3.5" />
                        {ctrl?.label ?? r.tipoControl}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('flex items-center gap-1.5 capitalize', estadoColor)}>
                        {r.estado === 'online' ? (
                          <Wifi className="w-3.5 h-3.5" />
                        ) : (
                          <WifiOff className="w-3.5 h-3.5" />
                        )}
                        {r.estado}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {r.latenciaMs != null ? `${r.latenciaMs}ms` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Test conexión */}
                        <button
                          onClick={() => testConexion(r)}
                          disabled={isTesting}
                          title="Probar conexión"
                          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-green-400 transition-colors disabled:opacity-50"
                        >
                          {isTesting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                        </button>
                        {/* Editar */}
                        <button
                          onClick={() => { setEditRouter(r); setShowModal(true); }}
                          title="Editar"
                          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-blue-400 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {/* Eliminar */}
                        <button
                          onClick={() => handleDelete(r)}
                          title="Eliminar"
                          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Info sobre controles de seguridad */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-sm text-blue-300">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium mb-1">Control de seguridad IP+MAC</p>
            <p className="text-blue-300/70 text-xs">
              Al provisionar un cliente en un router con control de amarre IP+MAC, el sistema
              automáticamente agrega la entrada en <strong>IP &gt; ARP</strong> del MikroTik.
              Con "IP+MAC+DHCP Lease" también registra el equipo en <strong>IP &gt; DHCP Server &gt; Leases</strong>.
            </p>
          </div>
        </div>
      </div>

      {showModal && (
        <RouterModal
          router={editRouter}
          onClose={() => setShowModal(false)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
