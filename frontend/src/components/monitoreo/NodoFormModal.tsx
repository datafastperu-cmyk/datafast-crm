'use client';

import { useState }      from 'react';
import { useMutation }   from '@tanstack/react-query';
import { X, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { monitoreoApi }  from '@/lib/api/monitoreo';
import { useToast }      from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import type { CreateNodoDto, TestConexionResult } from '@/lib/api/monitoreo';

const FABRICANTES = ['MikroTik', 'Ubiquiti', 'Huawei', 'Cisco', 'TP-Link', 'Cambium', 'Otro'];

const TIPOS_EQUIPO = [
  { value: 'antena',   label: 'Antena'   },
  { value: 'router',   label: 'Router'   },
  { value: 'servidor', label: 'Servidor' },
  { value: 'camara',   label: 'Cámara'   },
  { value: 'alarma',   label: 'Alarma'   },
  { value: 'otro',     label: 'Otro'     },
];

const VERSIONES_SNMP = [
  { value: 1, label: 'Versión 1'  },
  { value: 2, label: 'Versión 2c' },
  { value: 3, label: 'Versión 3'  },
];

interface Props {
  onClose:   () => void;
  onSuccess: () => void;
}

export function NodoFormModal({ onClose, onSuccess }: Props) {
  const { toast } = useToast();

  const [form, setForm] = useState({
    nombre:         '',
    ipMonitoreo:    '',
    tipo:           '',
    fabricante:     'MikroTik',
    modelo:         '',
    usuario:        '',
    contrasena:     '',
    puertoApi:      8728,
    usarSsl:        false,
    metodoConexion: 'api',   // MikroTik por defecto → api
    snmpHabilitado: false,
    snmpCommunity:  'public',
    snmpVersion:    1,
  });

  const [testResult, setTestResult] = useState<TestConexionResult | null>(null);
  const [testando, setTestando]     = useState(false);

  const set = (field: string, value: unknown) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-ajustar método de conexión según fabricante
      if (field === 'fabricante') {
        next.metodoConexion = value === 'MikroTik' ? 'api' : 'snmp';
        if (value === 'MikroTik') next.puertoApi = 8728;
      }
      return next;
    });
    setTestResult(null);
  };

  const { mutate: crear, isPending } = useMutation({
    mutationFn: (dto: CreateNodoDto) => monitoreoApi.createNodo(dto),
    onSuccess: () => {
      toast('Nodo registrado correctamente', { type: 'success' });
      onSuccess();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const handleProbar = async () => {
    if (!form.ipMonitoreo || !form.usuario || !form.contrasena) {
      toast('Completa IP, usuario y contraseña para probar', { type: 'error' });
      return;
    }
    setTestando(true);
    setTestResult(null);
    try {
      const r = await monitoreoApi.testConexionRaw({
        ip:         form.ipMonitoreo,
        usuario:    form.usuario,
        password:   form.contrasena,
        fabricante: form.fabricante,
        puertoApi:  form.puertoApi,
        usarSsl:    form.usarSsl,
      });
      setTestResult(r);
    } catch (e) {
      setTestResult({ conectado: false, metodo: 'api', error: parseApiError(e) });
    } finally {
      setTestando(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim() || !form.ipMonitoreo.trim()) return;

    const dto: CreateNodoDto = {
      nombre:         form.nombre.trim(),
      ipMonitoreo:    form.ipMonitoreo.trim(),
      tipo:           form.tipo    || undefined,
      fabricante:     form.fabricante,
      descripcion:    form.modelo  || undefined,
      usuario:        form.usuario || undefined,
      password:       form.contrasena || undefined,
      puertoApi:      form.puertoApi,
      usarSsl:        form.usarSsl,
      metodoConexion: form.metodoConexion,
      snmpHabilitado: form.snmpHabilitado,
      snmpCommunity:  form.snmpHabilitado ? form.snmpCommunity : undefined,
      snmpVersion:    form.snmpHabilitado ? form.snmpVersion   : undefined,
    };

    crear(dto);
  };

  const esMikrotik = form.fabricante === 'MikroTik';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Agregar nodo</h3>
          <button type="button" onClick={onClose}
            className="p-1 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">

            <Row label="Nombre Emisor">
              <input required type="text" placeholder="Emisor principal"
                value={form.nombre} onChange={(e) => set('nombre', e.target.value)}
                className={INPUT} />
            </Row>

            <Row label="Dirección IP">
              <input required type="text" placeholder="192.168.1.20"
                value={form.ipMonitoreo} onChange={(e) => set('ipMonitoreo', e.target.value)}
                className={INPUT} />
            </Row>

            <Row label="Tipo de equipo">
              <select value={form.tipo} onChange={(e) => set('tipo', e.target.value)} className={INPUT}>
                <option value="">Seleccionar…</option>
                {TIPOS_EQUIPO.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Row>

            <Row label="Fabricante / Tipo">
              <select value={form.fabricante} onChange={(e) => set('fabricante', e.target.value)} className={INPUT}>
                {FABRICANTES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </Row>

            <Row label="Modelo / Nombre">
              <input type="text" placeholder="RB 1100Ahx2"
                value={form.modelo} onChange={(e) => set('modelo', e.target.value)}
                className={INPUT} />
            </Row>

            <Row label="Usuario">
              <input type="text" placeholder="admin"
                value={form.usuario} onChange={(e) => set('usuario', e.target.value)}
                className={INPUT} />
            </Row>

            <Row label="Contraseña">
              <input type="password" placeholder="••••••"
                value={form.contrasena} onChange={(e) => set('contrasena', e.target.value)}
                className={INPUT} />
            </Row>

            {/* Puerto API — solo visible para MikroTik */}
            {esMikrotik && (
              <Row label="Puerto API">
                <div className="flex gap-2">
                  <input type="number" min={1} max={65535}
                    value={form.puertoApi}
                    onChange={(e) => set('puertoApi', Number(e.target.value))}
                    className={cn(INPUT, 'flex-1')} />
                  <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
                    <input type="checkbox" checked={form.usarSsl}
                      onChange={(e) => set('usarSsl', e.target.checked)}
                      className="rounded" />
                    SSL
                  </label>
                </div>
              </Row>
            )}

            {/* Resultado del test */}
            {testResult && (
              <div className={cn(
                'flex items-start gap-3 p-3 rounded-xl text-sm border',
                testResult.conectado
                  ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400'
                  : 'bg-destructive/5 border-destructive/20 text-destructive',
              )}>
                {testResult.conectado
                  ? <Wifi className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  : <WifiOff className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                <div>
                  {testResult.conectado ? (
                    <>
                      <p className="font-medium">Conectado ({testResult.metodo.toUpperCase()})</p>
                      {testResult.info?.hostname && (
                        <p className="text-xs mt-0.5 opacity-80">
                          {testResult.info.board ?? testResult.info.hostname}
                          {testResult.info.version && ` · ROS ${testResult.info.version}`}
                          {testResult.info.cpu && ` · CPU ${testResult.info.cpu}`}
                          {testResult.latenciaMs && ` · ${testResult.latenciaMs}ms`}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="font-medium">Sin conexión — {testResult.error ?? 'Error desconocido'}</p>
                  )}
                </div>
              </div>
            )}

            <Row label="Monitoreo SNMP">
              <button type="button" role="switch" aria-checked={form.snmpHabilitado}
                onClick={() => set('snmpHabilitado', !form.snmpHabilitado)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  form.snmpHabilitado ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  form.snmpHabilitado ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </Row>

            {form.snmpHabilitado && (
              <>
                <Row label="Comunidad SNMP">
                  <input type="text" placeholder="public"
                    value={form.snmpCommunity}
                    onChange={(e) => set('snmpCommunity', e.target.value)}
                    className={INPUT} />
                </Row>
                <Row label="Versión SNMP">
                  <select value={form.snmpVersion}
                    onChange={(e) => set('snmpVersion', Number(e.target.value))}
                    className={INPUT}>
                    {VERSIONES_SNMP.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </select>
                </Row>
              </>
            )}

          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
            <button type="button" onClick={handleProbar} disabled={testando || isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-input
                         hover:bg-muted transition-colors disabled:opacity-50">
              {testando
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Probando…</>
                : <><Wifi className="w-3.5 h-3.5" /> Probar conexión</>}
            </button>

            <div className="flex gap-3">
              <button type="button" onClick={onClose} disabled={isPending}
                className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50">
                Cerrar
              </button>
              <button type="submit"
                disabled={isPending || !form.nombre.trim() || !form.ipMonitoreo.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground
                           font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                {isPending ? 'Registrando…' : 'Registrar'}
              </button>
            </div>
          </div>
        </form>

      </div>
    </div>
  );
}

const INPUT = 'w-full px-3 py-2 text-sm rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-center gap-4">
      <span className="text-sm text-muted-foreground text-right">{label}</span>
      {children}
    </div>
  );
}
