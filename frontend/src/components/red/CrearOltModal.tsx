'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2, Key, Loader2, MapPin, Server, X, XCircle,
} from 'lucide-react';
import {
  oltNativoApi,
  type CrearOltIntegracionDto,
} from '@/lib/api/olt-nativo';
import { type Router } from '@/lib/api/mikrotik';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const INPUT_CLS =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground ' +
  'placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary';

const LABEL_CLS = 'text-xs font-medium text-muted-foreground';

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
