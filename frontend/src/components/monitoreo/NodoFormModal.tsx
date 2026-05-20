'use client';

import { useState }      from 'react';
import { useMutation }   from '@tanstack/react-query';
import { X }             from 'lucide-react';
import { monitoreoApi }  from '@/lib/api/monitoreo';
import { useToast }      from '@/components/ui/toaster';
import { parseApiError } from '@/lib/utils';
import type { CreateNodoDto } from '@/lib/api/monitoreo';

const FABRICANTES = ['MikroTik', 'Ubiquiti', 'Huawei', 'Cisco', 'TP-Link', 'Cambium', 'Otro'];

const TIPOS_EQUIPO = [
  { value: 'antena',   label: 'Antena'    },
  { value: 'router',   label: 'Router'    },
  { value: 'servidor', label: 'Servidor'  },
  { value: 'camara',   label: 'Cámara'    },
  { value: 'alarma',   label: 'Alarma'    },
  { value: 'otro',     label: 'Otro'      },
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
    snmpHabilitado: false,
    snmpCommunity:  'public',
    snmpVersion:    1,
  });

  const set = (field: string, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const { mutate: crear, isPending } = useMutation({
    mutationFn: (dto: CreateNodoDto) => monitoreoApi.createNodo(dto),
    onSuccess: () => {
      toast('Nodo registrado correctamente', { type: 'success' });
      onSuccess();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim() || !form.ipMonitoreo.trim()) return;

    const dto: CreateNodoDto = {
      nombre:         form.nombre.trim(),
      ipMonitoreo:    form.ipMonitoreo.trim(),
      tipo:           form.tipo || undefined,
      descripcion:    [form.fabricante, form.modelo].filter(Boolean).join(' · ') || undefined,
      snmpHabilitado: form.snmpHabilitado,
      snmpCommunity:  form.snmpHabilitado ? form.snmpCommunity : undefined,
      snmpVersion:    form.snmpHabilitado ? form.snmpVersion   : undefined,
    };

    crear(dto);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Agregar nodo</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">

            <Row label="Nombre Emisor">
              <input
                type="text"
                required
                placeholder="Emisor principal"
                value={form.nombre}
                onChange={(e) => set('nombre', e.target.value)}
                className={INPUT}
              />
            </Row>

            <Row label="Dirección IP">
              <input
                type="text"
                required
                placeholder="192.168.1.20"
                value={form.ipMonitoreo}
                onChange={(e) => set('ipMonitoreo', e.target.value)}
                className={INPUT}
              />
            </Row>

            <Row label="Tipo de equipo">
              <select
                value={form.tipo}
                onChange={(e) => set('tipo', e.target.value)}
                className={INPUT}
              >
                <option value="">Seleccionar…</option>
                {TIPOS_EQUIPO.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Row>

            <Row label="Fabricante / Tipo">
              <select
                value={form.fabricante}
                onChange={(e) => set('fabricante', e.target.value)}
                className={INPUT}
              >
                {FABRICANTES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </Row>

            <Row label="Modelo / Nombre">
              <input
                type="text"
                placeholder="RB 1100Ahx2"
                value={form.modelo}
                onChange={(e) => set('modelo', e.target.value)}
                className={INPUT}
              />
            </Row>

            <Row label="Usuario">
              <input
                type="text"
                placeholder="admin"
                value={form.usuario}
                onChange={(e) => set('usuario', e.target.value)}
                className={INPUT}
              />
            </Row>

            <Row label="Contraseña">
              <input
                type="password"
                placeholder="••••••"
                value={form.contrasena}
                onChange={(e) => set('contrasena', e.target.value)}
                className={INPUT}
              />
            </Row>

            <Row label="Monitoreo SNMP">
              <button
                type="button"
                role="switch"
                aria-checked={form.snmpHabilitado}
                onClick={() => set('snmpHabilitado', !form.snmpHabilitado)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  form.snmpHabilitado ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  form.snmpHabilitado ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </Row>

            {form.snmpHabilitado && (
              <>
                <Row label="Comunidad SNMP">
                  <input
                    type="text"
                    placeholder="public"
                    value={form.snmpCommunity}
                    onChange={(e) => set('snmpCommunity', e.target.value)}
                    className={INPUT}
                  />
                </Row>

                <Row label="Versión SNMP">
                  <select
                    value={form.snmpVersion}
                    onChange={(e) => set('snmpVersion', Number(e.target.value))}
                    className={INPUT}
                  >
                    {VERSIONES_SNMP.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </select>
                </Row>
              </>
            )}

          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cerrar
            </button>
            <button
              type="submit"
              disabled={isPending || !form.nombre.trim() || !form.ipMonitoreo.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Registrando…' : 'Registrar'}
            </button>
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
