'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, CheckCircle2, CircleSlash2,
  Key, Loader2, MapPin, Plus, RefreshCw, Server,
  Settings, Wifi, X, XCircle,
} from 'lucide-react';
import {
  oltNativoApi,
  type CrearOltIntegracionDto,
  type ProveedorConOlt,
  type TipoProveedor,
  type UpsertProveedorDto,
} from '@/lib/api/olt-nativo';
import { mikrotikApi, type Router } from '@/lib/api/mikrotik';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────

function dominioDe(url: string | null): string {
  if (!url) return '—';
  try { return new URL(url).hostname; } catch { return url; }
}

function tiempoRelativo(iso: string | null): string {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1)  return 'ahora';
  if (min < 60) return `hace ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

// ─── Constantes ───────────────────────────────────────────────

const HEALTH_DOT: Record<string, string> = {
  ok:      'bg-emerald-500',
  degraded:'bg-yellow-400',
  down:    'bg-red-500',
  unknown: 'bg-gray-400',
};

const HEALTH_LABEL: Record<string, string> = {
  ok:      'OK',
  degraded:'Degradado',
  down:    'Caído',
  unknown: 'Desconocido',
};

const CIRCUIT_COLOR: Record<string, string> = {
  closed:   'text-emerald-400',
  open:     'text-red-400',
  half_open:'text-yellow-400',
};

const MARCA_COLOR: Record<string, string> = {
  huawei: 'bg-red-500/10 text-red-400 border-red-500/20',
  zte:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  vsol:   'bg-purple-500/10 text-purple-400 border-purple-500/20',
  cdata:  'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

const INPUT_CLS =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground ' +
  'placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary';

const LABEL_CLS = 'text-xs font-medium text-muted-foreground';

// ─── Modal crear OLT ─────────────────────────────────────────

interface CrearOltModalProps {
  tipo:    'smartolt' | 'adminolt';
  routers: Router[];
  onClose: () => void;
  onSaved: () => void;
}

type IpStatus = 'idle' | 'checking' | 'ok' | 'taken';

const FORM_INIT: CrearOltIntegracionDto & { _marcaKey: string } = {
  nombre:        '',
  marca:         'huawei',
  modelo:        '',
  ipGestion:     '',
  routerId:      '',
  slotsTotales:  1,
  puertosPorSlot: 8,
  ubicacion:     '',
  baseUrl:       '',
  apiKey:        '',
  oltIdExterno:  '',
  prioridad:     1,
  _marcaKey:     'huawei',
};

export function CrearOltModal({ tipo, routers, onClose, onSaved }: CrearOltModalProps) {
  const { toast } = useToast();
  const [form, setForm]     = useState({ ...FORM_INIT, routerId: routers[0]?.id ?? '' });
  const [saving, setSaving] = useState(false);
  const [ipStatus, setIpStatus] = useState<IpStatus>('idle');
  const [ipMensaje, setIpMensaje] = useState('');
  const ipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const labelExt = tipo === 'smartolt' ? 'SmartOLT' : 'AdminOLT';

  const checkIp = useCallback(async (ip: string) => {
    if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      setIpStatus('idle');
      return;
    }
    setIpStatus('checking');
    try {
      const r = await oltNativoApi.validarIp(ip);
      if (r.disponible) {
        setIpStatus('ok');
        setIpMensaje('');
      } else {
        setIpStatus('taken');
        const secLabel = r.seccion === 'smartolt' ? 'SmartOLT' : r.seccion === 'adminolt' ? 'AdminOLT' : 'Nativo SSH';
        setIpMensaje(`En uso por "${r.oltNombre}" (${secLabel})`);
      }
    } catch {
      setIpStatus('idle');
    }
  }, []);

  const handleIpChange = (val: string) => {
    setForm((f) => ({ ...f, ipGestion: val }));
    setIpStatus('idle');
    if (ipTimerRef.current) clearTimeout(ipTimerRef.current);
    ipTimerRef.current = setTimeout(() => checkIp(val), 600);
  };

  useEffect(() => () => { if (ipTimerRef.current) clearTimeout(ipTimerRef.current); }, []);

  const f = (key: keyof typeof form, val: unknown) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    if (!form.nombre.trim())  { toast('El nombre es obligatorio', { type: 'error' }); return; }
    if (!form.ipGestion.trim()) { toast('La IP de gestión es obligatoria', { type: 'error' }); return; }
    if (ipStatus === 'taken')   { toast('La IP ya está en uso', { type: 'error' }); return; }
    if (!form.routerId)         { toast('Selecciona un router', { type: 'error' }); return; }
    if (!form.baseUrl.trim())   { toast('La URL base es obligatoria', { type: 'error' }); return; }
    if (!form.apiKey.trim())    { toast('La API Key es obligatoria', { type: 'error' }); return; }

    setSaving(true);
    try {
      const dto: CrearOltIntegracionDto = {
        nombre:         form.nombre.trim(),
        descripcion:    undefined,
        marca:          form.marca as CrearOltIntegracionDto['marca'],
        modelo:         form.modelo.trim() || undefined,
        ipGestion:      form.ipGestion.trim(),
        routerId:       form.routerId,
        slotsTotales:   form.slotsTotales,
        puertosPorSlot: form.puertosPorSlot,
        ubicacion:      form.ubicacion.trim() || undefined,
        baseUrl:        form.baseUrl.trim(),
        apiKey:         form.apiKey.trim(),
        oltIdExterno:   form.oltIdExterno.trim() || undefined,
        prioridad:      form.prioridad,
      };

      if (tipo === 'smartolt') {
        await oltNativoApi.crearSmartolt(dto);
      } else {
        await oltNativoApi.crearAdminolt(dto);
      }

      toast(`OLT "${dto.nombre}" creada y vinculada a ${labelExt}`, { type: 'success' });
      onSaved();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Error al crear la OLT';
      toast(msg, { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 my-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Nueva OLT — {labelExt}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Crea la OLT y vincula sus credenciales de {labelExt} en una sola operación.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">

          {/* Sección: OLT */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Server className="w-3.5 h-3.5" />
              Información del dispositivo
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <label className={LABEL_CLS}>Nombre *</label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={(e) => f('nombre', e.target.value)}
                  placeholder="Ej. OLT Norte — Cabecera"
                  className={INPUT_CLS}
                />
              </div>

              <div className="space-y-1.5">
                <label className={LABEL_CLS}>Marca *</label>
                <select
                  value={form.marca}
                  onChange={(e) => f('marca', e.target.value)}
                  className={INPUT_CLS}
                >
                  {['huawei', 'zte', 'vsol', 'cdata'].map((m) => (
                    <option key={m} value={m}>{m.toUpperCase()}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className={LABEL_CLS}>Modelo</label>
                <input
                  type="text"
                  value={form.modelo}
                  onChange={(e) => f('modelo', e.target.value)}
                  placeholder="MA5800-X7"
                  className={INPUT_CLS}
                />
              </div>

              {/* IP con validación en tiempo real */}
              <div className="col-span-2 space-y-1.5">
                <label className={LABEL_CLS}>IP de Gestión *</label>
                <div className="relative">
                  <input
                    type="text"
                    value={form.ipGestion}
                    onChange={(e) => handleIpChange(e.target.value)}
                    placeholder="10.0.50.10"
                    className={cn(
                      INPUT_CLS,
                      'pr-8',
                      ipStatus === 'ok'    && 'border-emerald-500/50 focus:ring-emerald-500',
                      ipStatus === 'taken' && 'border-red-500/50 focus:ring-red-500',
                    )}
                  />
                  <div className="absolute inset-y-0 right-2.5 flex items-center pointer-events-none">
                    {ipStatus === 'checking' && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                    {ipStatus === 'ok'       && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                    {ipStatus === 'taken'    && <XCircle className="w-3.5 h-3.5 text-red-400" />}
                  </div>
                </div>
                {ipStatus === 'taken' && (
                  <p className="text-xs text-red-400">{ipMensaje}</p>
                )}
                {ipStatus === 'ok' && (
                  <p className="text-xs text-emerald-400">IP disponible</p>
                )}
              </div>

              <div className="col-span-2 space-y-1.5">
                <label className={LABEL_CLS}>Router MikroTik *</label>
                <select
                  value={form.routerId}
                  onChange={(e) => f('routerId', e.target.value)}
                  className={INPUT_CLS}
                >
                  {routers.length === 0 && <option value="">Sin routers disponibles</option>}
                  {routers.map((r) => (
                    <option key={r.id} value={r.id}>{r.nombre} — {r.vpnIp ?? r.ipGestion}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className={LABEL_CLS}>Slots totales</label>
                <input
                  type="number"
                  min={1} max={64}
                  value={form.slotsTotales}
                  onChange={(e) => f('slotsTotales', parseInt(e.target.value, 10) || 1)}
                  className={INPUT_CLS}
                />
              </div>

              <div className="space-y-1.5">
                <label className={LABEL_CLS}>Puertos por slot</label>
                <input
                  type="number"
                  min={1} max={128}
                  value={form.puertosPorSlot}
                  onChange={(e) => f('puertosPorSlot', parseInt(e.target.value, 10) || 8)}
                  className={INPUT_CLS}
                />
              </div>

              <div className="col-span-2 space-y-1.5">
                <label className={cn(LABEL_CLS, 'flex items-center gap-1')}>
                  <MapPin className="w-3 h-3" /> Ubicación
                </label>
                <input
                  type="text"
                  value={form.ubicacion}
                  onChange={(e) => f('ubicacion', e.target.value)}
                  placeholder="Cabecera Norte — Av. Panamericana km 4.5"
                  className={INPUT_CLS}
                />
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Sección: Credenciales del proveedor */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Key className="w-3.5 h-3.5" />
              Credenciales {labelExt}
            </div>

            <div className="space-y-1.5">
              <label className={LABEL_CLS}>URL Base *</label>
              <input
                type="url"
                value={form.baseUrl}
                onChange={(e) => f('baseUrl', e.target.value)}
                placeholder={`https://tu-instancia.${tipo}.com`}
                className={INPUT_CLS}
              />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL_CLS}>API Key *</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => f('apiKey', e.target.value)}
                placeholder="Ingresar API Key"
                className={INPUT_CLS}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={LABEL_CLS}>OLT ID en {labelExt}</label>
                <input
                  type="text"
                  value={form.oltIdExterno}
                  onChange={(e) => f('oltIdExterno', e.target.value)}
                  placeholder="ID en la plataforma"
                  className={INPUT_CLS}
                />
              </div>
              <div className="space-y-1.5">
                <label className={LABEL_CLS}>Prioridad</label>
                <input
                  type="number"
                  min={1} max={99}
                  value={form.prioridad}
                  onChange={(e) => f('prioridad', parseInt(e.target.value, 10) || 1)}
                  className={INPUT_CLS}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground
                       hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || ipStatus === 'taken' || ipStatus === 'checking'}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground
                       hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Crear OLT
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de configuración de credenciales ───────────────────

interface CredModalProps {
  config:  ProveedorConOlt;
  tipo:    TipoProveedor;
  onClose: () => void;
  onSaved: () => void;
}

function CredModal({ config, tipo, onClose, onSaved }: CredModalProps) {
  const { toast } = useToast();
  const labelExt = tipo === 'smartolt' ? 'SmartOLT' : 'AdminOLT';
  const [form, setForm] = useState({
    baseUrl:      config.baseUrl      ?? '',
    apiKey:       '',
    oltIdExterno: config.oltIdExterno ?? '',
    prioridad:    config.prioridad,
    activo:       config.activo,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.baseUrl.trim()) {
      toast('URL base es obligatoria', { type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const dto: UpsertProveedorDto = {
        tipo:         config.tipo,
        baseUrl:      form.baseUrl.trim(),
        oltIdExterno: form.oltIdExterno.trim() || undefined,
        prioridad:    form.prioridad,
        activo:       form.activo,
      };
      if (form.apiKey.trim()) dto.apiKey = form.apiKey.trim();
      await oltNativoApi.upsertProveedor(config.oltId, dto);
      toast(`Credenciales guardadas para ${config.oltNombre}`, { type: 'success' });
      onSaved();
    } catch {
      toast('Error al guardar credenciales', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4">

        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Configurar credenciales {labelExt}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{config.oltNombre}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">

          <div className="space-y-1.5">
            <label className={LABEL_CLS}>URL Base</label>
            <input
              type="url"
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              placeholder={`https://tu-instancia.${tipo}.com`}
              className={INPUT_CLS}
            />
          </div>

          <div className="space-y-1.5">
            <label className={LABEL_CLS}>
              API Key
              {config.tieneCredenciales && (
                <span className="ml-1.5 text-emerald-400">(ya configurada)</span>
              )}
            </label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={config.tieneCredenciales ? 'Dejar vacío para mantener la actual' : 'Ingresar API Key'}
              className={INPUT_CLS}
            />
          </div>

          <div className="space-y-1.5">
            <label className={LABEL_CLS}>OLT ID en {labelExt}</label>
            <input
              type="text"
              value={form.oltIdExterno}
              onChange={(e) => setForm((f) => ({ ...f, oltIdExterno: e.target.value }))}
              placeholder={`ID de la OLT en ${labelExt}`}
              className={INPUT_CLS}
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="space-y-1.5 flex-1">
              <label className={LABEL_CLS}>Prioridad</label>
              <input
                type="number"
                min={1}
                max={10}
                value={form.prioridad}
                onChange={(e) => setForm((f) => ({ ...f, prioridad: parseInt(e.target.value, 10) || 1 }))}
                className={INPUT_CLS}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer mt-5">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
                className="rounded border-border"
              />
              <span className="text-sm text-foreground">Activo</span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground
                       hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground
                       hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Fila de proveedor ────────────────────────────────────────

function FilaProveedor({ config, tipo }: { config: ProveedorConOlt; tipo: TipoProveedor }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [testing,   setTesting]   = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await oltNativoApi.testProveedor(config.id);
      if (r.exitoso) {
        toast(`${config.oltNombre}: ${r.mensaje} (${r.latenciaMs}ms)`, { type: 'success' });
      } else {
        toast(`${config.oltNombre}: ${r.mensaje}`, { type: 'error' });
      }
      qc.invalidateQueries({ queryKey: ['proveedores-por-tipo'] });
    } catch {
      toast(`Error al probar conexión con ${config.oltNombre}`, { type: 'error' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <tr className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">

        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <Wifi className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium text-foreground text-sm">{config.oltNombre}</span>
          </div>
          <div className="ml-5 mt-0.5 flex items-center gap-2 flex-wrap">
            <span className={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border uppercase',
              MARCA_COLOR[config.oltMarca] ?? 'bg-muted text-muted-foreground border-border',
            )}>
              {config.oltMarca}
            </span>
            {config.baseUrl && (
              <span className="text-[10px] text-muted-foreground/70 font-mono">
                {dominioDe(config.baseUrl)}
              </span>
            )}
            {config.oltIdExterno && (
              <span className="text-[10px] text-muted-foreground/50">
                ID: {config.oltIdExterno}
              </span>
            )}
          </div>
        </td>

        <td className="px-4 py-3">
          {config.tieneCredenciales ? (
            <div className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="text-xs">Configuradas</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="text-xs">Sin credenciales</span>
            </div>
          )}
        </td>

        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-full shrink-0', HEALTH_DOT[config.healthEstado] ?? 'bg-gray-400')} />
            <span className="text-xs text-muted-foreground">
              {HEALTH_LABEL[config.healthEstado] ?? config.healthEstado}
            </span>
            {config.healthLatenciaMs !== null && (
              <span className="text-[10px] text-muted-foreground/60">
                {config.healthLatenciaMs}ms
              </span>
            )}
          </div>
          {config.ultimoHealth && (
            <p className="text-[10px] text-muted-foreground/50 mt-0.5 ml-3.5">
              {tiempoRelativo(config.ultimoHealth)}
            </p>
          )}
        </td>

        <td className="px-4 py-3 hidden md:table-cell">
          <div className={cn('flex items-center gap-1.5 text-xs', CIRCUIT_COLOR[config.circuitEstado] ?? 'text-muted-foreground')}>
            {config.circuitEstado === 'open'
              ? <CircleSlash2 className="w-3.5 h-3.5" />
              : config.circuitEstado === 'half_open'
                ? <Activity className="w-3.5 h-3.5" />
                : <CheckCircle2 className="w-3.5 h-3.5" />}
            {config.circuitEstado}
          </div>
        </td>

        <td className="px-4 py-3 hidden sm:table-cell">
          <span className={cn(
            'text-[11px] px-1.5 py-0.5 rounded font-medium',
            config.activo
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-muted text-muted-foreground',
          )}>
            {config.activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>

        <td className="px-4 py-3">
          <div className="flex items-center gap-1 justify-end">
            <button
              onClick={handleTest}
              disabled={testing || !config.tieneCredenciales}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground/60 hover:text-green-500
                         transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={config.tieneCredenciales ? 'Probar conexión' : 'Sin credenciales configuradas'}
            >
              {testing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setModalOpen(true)}
              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Configurar credenciales"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>

      {modalOpen && (
        <CredModal
          config={config}
          tipo={tipo}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            qc.invalidateQueries({ queryKey: ['proveedores-por-tipo'] });
          }}
        />
      )}
    </>
  );
}

// ─── Props ────────────────────────────────────────────────────

interface IntegracionProveedorPageProps {
  tipo:        TipoProveedor;
  titulo:      string;
  descripcion: string;
  colorCls:    string;
  icono:       React.ReactNode;
}

// ─── Componente principal ─────────────────────────────────────

export function IntegracionProveedorPage({
  tipo,
  titulo,
  descripcion,
  colorCls,
  icono,
}: IntegracionProveedorPageProps) {
  const qc = useQueryClient();
  const [crearOpen, setCrearOpen] = useState(false);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['proveedores-por-tipo', tipo],
    queryFn:  () => oltNativoApi.listarPorTipo(tipo),
    staleTime: 30_000,
  });

  const { data: routers = [] } = useQuery({
    queryKey: ['routers-lista'],
    queryFn:  () => mikrotikApi.listar(),
    staleTime: 60_000,
    enabled:   crearOpen,
  });

  const activos   = configs.filter((c) => c.activo);
  const conCreds  = configs.filter((c) => c.tieneCredenciales);
  const conHealth = configs.filter((c) => c.healthEstado === 'ok');

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center', colorCls)}>
            {icono}
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{titulo}</h1>
            <p className="text-sm text-muted-foreground">{descripcion}</p>
          </div>
        </div>
        <button
          onClick={() => setCrearOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-sm rounded-lg bg-primary text-primary-foreground
                     hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nueva OLT
        </button>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total OLTs', value: configs.length, cls: 'text-foreground' },
          { label: 'Activos',    value: activos.length, cls: 'text-emerald-400' },
          { label: 'Con API Key',value: conCreds.length, cls: 'text-blue-400' },
          { label: 'Health OK',  value: conHealth.length, cls: 'text-emerald-400' },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className={cn('text-2xl font-bold mt-1', m.cls)}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Estado vacío */}
      {!isLoading && configs.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <Wifi className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Aún no hay OLTs en esta sección.
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Usa el botón <span className="text-primary font-medium">Nueva OLT</span> para agregar la primera.
          </p>
        </div>
      )}

      {/* Tabla */}
      {(isLoading || configs.length > 0) && (
        <div className="rounded-xl border border-border overflow-hidden">
          {isLoading ? (
            <div>
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 border-b border-border bg-muted/20 animate-pulse" />
              ))}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">OLT</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Credenciales</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Health</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Circuit</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {configs.map((cfg) => (
                  <FilaProveedor key={cfg.id} config={cfg} tipo={tipo} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Info footer */}
      <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Gestión de OLTs {titulo}</p>
        <p>
          Crea OLTs directamente en esta sección con el botón <span className="text-primary">Nueva OLT</span>.
          Cada OLT creada aquí queda vinculada exclusivamente a {titulo}.
        </p>
        <p>
          El ícono <Settings className="w-3 h-3 inline" /> permite actualizar las credenciales de una OLT existente.
          El botón <RefreshCw className="w-3 h-3 inline" /> verifica la conectividad en tiempo real.
        </p>
      </div>

      {/* Modal crear OLT */}
      {crearOpen && (
        <CrearOltModal
          tipo={tipo as 'smartolt' | 'adminolt'}
          routers={routers}
          onClose={() => setCrearOpen(false)}
          onSaved={() => {
            setCrearOpen(false);
            qc.invalidateQueries({ queryKey: ['proveedores-por-tipo'] });
          }}
        />
      )}
    </div>
  );
}
