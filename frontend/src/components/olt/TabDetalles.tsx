'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2 } from 'lucide-react';
import { oltNativoApi, type OltDispositivo } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';

interface Props {
  olt:   OltDispositivo;
  oltId: string;
}

const MARCAS  = ['huawei', 'zte', 'vsol', 'cdata'] as const;
const ESTADOS = ['online', 'offline', 'mantenimiento', 'desconocido'] as const;

export function TabDetalles({ olt, oltId }: Props) {
  const qc       = useQueryClient();
  const { toast } = useToast();

  const [nombre,      setNombre]      = useState(olt.nombre);
  const [descripcion, setDescripcion] = useState(olt.descripcion ?? '');
  const [modelo,      setModelo]      = useState(olt.modelo ?? '');
  const [estado,      setEstado]      = useState(olt.estado);
  const [ubicacion,   setUbicacion]   = useState(olt.ubicacion ?? '');
  const [gps,         setGps]         = useState(
    olt.latitud != null && olt.longitud != null ? `${olt.latitud}, ${olt.longitud}` : '',
  );
  const [slots,       setSlots]       = useState(String(olt.slotsTotales));
  const [puertos,     setPuertos]     = useState(String(olt.puertosPorSlot));
  const [vlanMgmt,    setVlanMgmt]    = useState(String(olt.vlanGestionDefecto ?? ''));

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => oltNativoApi.patch(oltId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-detalle', oltId] });
      qc.invalidateQueries({ queryKey: ['olts-config'] });
      toast('OLT actualizada', { type: 'success' });
    },
    onError: (e: any) => toast(`Error: ${e?.message ?? 'Error al guardar'}`, { type: 'error' }),
  });

  const handleSave = () => {
    const gpsParts = gps.split(',').map(s => s.trim());
    const body: Record<string, unknown> = {
      nombre:             nombre.trim(),
      descripcion:        descripcion.trim() || null,
      modelo:             modelo.trim() || null,
      estado,
      ubicacion:          ubicacion.trim() || null,
      latitud:            gpsParts[0] ? parseFloat(gpsParts[0]) : null,
      longitud:           gpsParts[1] ? parseFloat(gpsParts[1]) : null,
      slotsTotales:       Number(slots) || olt.slotsTotales,
      puertosPorSlot:     Number(puertos) || olt.puertosPorSlot,
      vlanGestionDefecto: vlanMgmt ? Number(vlanMgmt) : null,
    };
    saveMut.mutate(body);
  };

  const Field = ({
    label, children,
  }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';
  const selectCls = `${inputCls} cursor-pointer`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Nombre */}
        <Field label="Nombre">
          <input className={inputCls} value={nombre} onChange={e => setNombre(e.target.value)} />
        </Field>

        {/* Modelo */}
        <Field label="Modelo">
          <input className={inputCls} value={modelo} onChange={e => setModelo(e.target.value)} placeholder="Ej: MA5608T" />
        </Field>

        {/* Estado */}
        <Field label="Estado">
          <select className={selectCls} value={estado} onChange={e => setEstado(e.target.value as typeof estado)}>
            {ESTADOS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>

        {/* Marca (read-only) */}
        <Field label="Marca">
          <input className={`${inputCls} opacity-60 cursor-not-allowed`} value={olt.marca} readOnly />
        </Field>

        {/* IP Gestión (read-only) */}
        <Field label="IP Gestión">
          <input className={`${inputCls} font-mono opacity-60 cursor-not-allowed`} value={olt.ipGestion} readOnly />
        </Field>

        {/* Puerto (read-only) */}
        <Field label="Puerto SSH">
          <input className={`${inputCls} opacity-60 cursor-not-allowed`} value={olt.puerto} readOnly />
        </Field>

        {/* Slots */}
        <Field label="Slots totales">
          <input className={inputCls} type="number" min={1} max={16} value={slots} onChange={e => setSlots(e.target.value)} />
        </Field>

        {/* Puertos por slot */}
        <Field label="Puertos por slot (PON)">
          <input className={inputCls} type="number" min={1} max={16} value={puertos} onChange={e => setPuertos(e.target.value)} />
        </Field>

        {/* VLAN gestión */}
        <Field label="VLAN gestión por defecto">
          <input className={inputCls} type="number" min={1} max={4094} value={vlanMgmt} onChange={e => setVlanMgmt(e.target.value)} placeholder="Ej: 100" />
        </Field>

        {/* Dirección física */}
        <Field label="Dirección física">
          <input className={inputCls} value={ubicacion} onChange={e => setUbicacion(e.target.value)} placeholder="Ej: Av. Los Pinos 123, Zona Norte" />
        </Field>

        {/* Coordenadas GPS */}
        <Field label="Coordenadas GPS">
          <input
            className={inputCls}
            value={gps}
            onChange={e => setGps(e.target.value)}
            placeholder="-12.046374, -77.042793"
          />
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">Formato: latitud, longitud</p>
        </Field>

        {/* Descripción */}
        <div className="md:col-span-2">
          <Field label="Descripción adicional">
            <textarea
              className={`${inputCls} resize-none`}
              rows={3}
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Notas técnicas, rack, nodo, etc."
            />
          </Field>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saveMut.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground
                     hover:bg-primary/90 transition-colors text-sm font-medium disabled:opacity-60"
        >
          {saveMut.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin" />Guardando…</>
            : <><Save className="w-4 h-4" />Guardar cambios</>
          }
        </button>
      </div>
    </div>
  );
}
