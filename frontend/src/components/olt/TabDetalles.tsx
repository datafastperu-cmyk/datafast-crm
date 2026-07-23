'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, KeyRound, PlugZap, CheckCircle2, XCircle } from 'lucide-react';
import { oltNativoApi, type OltDispositivo } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { ServicePortPoolSection } from './ServicePortPoolSection';

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

        {/* IP y puerto se editan en la sección Conectividad SSH (con prueba previa) */}
        <Field label="IP Gestión">
          <input className={`${inputCls} font-mono opacity-60 cursor-not-allowed`} value={olt.ipGestion} readOnly />
        </Field>

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

      {/* Conectividad SSH — edición post-integración con prueba previa */}
      <ConectividadSection olt={olt} oltId={oltId} />

      {/* Pool de Service Port IDs (asignación automática por el ERP) */}
      <ServicePortPoolSection oltId={oltId} />
    </div>
  );
}

// ─── Conectividad SSH (IP / puerto / usuario / contraseña) ─────────
//
// La contraseña nunca se muestra (el backend no la devuelve); campo vacío =
// no cambiar. Guardar exige una prueba SSH exitosa con los valores del
// formulario, salvo confirmación explícita ("guardar sin probar", para una
// OLT temporalmente caída). El backend además rechaza con 409 si hay
// operaciones FTTH en vuelo contra la OLT.

function ConectividadSection({ olt, oltId }: { olt: OltDispositivo; oltId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [ip,         setIp]         = useState(olt.ipGestion);
  const [puerto,     setPuerto]     = useState(String(olt.puerto));
  const [usuario,    setUsuario]    = useState(olt.usuarioAnclado);
  const [contrasena, setContrasena] = useState('');
  const [probado, setProbado] = useState<null | { ok: boolean; msg: string; latencia?: number }>(null);
  const [detectado, setDetectado] = useState<null | { modelo: string | null; firmware: string | null; nivel: string; mensaje: string }>(null);

  const hayCambios =
    ip.trim() !== olt.ipGestion || Number(puerto) !== olt.puerto ||
    usuario.trim() !== olt.usuarioAnclado || contrasena !== '';
  const credencialesCambiadas =
    ip.trim() !== olt.ipGestion || Number(puerto) !== olt.puerto ||
    usuario.trim() !== olt.usuarioAnclado;

  // Cualquier edición invalida la prueba anterior
  const editar = (set: (v: string) => void) => (v: string) => { set(v); setProbado(null); setDetectado(null); };

  const probarMut = useMutation({
    mutationFn: async () => {
      if (contrasena) {
        return oltNativoApi.testConexionDirecta({
          ip: ip.trim(), puerto: Number(puerto), usuario: usuario.trim(),
          password: contrasena, marca: olt.marca, oltId,
        });
      }
      // Sin contraseña nueva solo se puede probar contra las credenciales
      // guardadas — válido únicamente si IP/puerto/usuario no cambiaron.
      return oltNativoApi.testConexion(oltId);
    },
    onSuccess: async (r) => {
      setProbado({ ok: r.exitoso, msg: r.mensaje, latencia: r.latenciaMs });
      if (r.exitoso && contrasena) {
        // Con credenciales en crudo se puede re-detectar modelo/firmware:
        // misma fila con otra IP puede ser físicamente otro equipo.
        try {
          const d = await oltNativoApi.wizardDetectVersion({
            ip: ip.trim(), puerto: Number(puerto), usuario: usuario.trim(),
            contrasena, marca: olt.marca,
          });
          if (d.exitoso) {
            setDetectado({ modelo: d.modelo, firmware: d.firmware, nivel: d.compatibilidad.nivel, mensaje: d.compatibilidad.mensaje });
          }
        } catch { /* detección es informativa, no bloquea */ }
      }
    },
    onError: (e: any) => setProbado({ ok: false, msg: e?.response?.data?.message ?? e?.message ?? 'Error al probar' }),
  });

  const guardarMut = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (ip.trim() !== olt.ipGestion)          body.ipGestion = ip.trim();
      if (Number(puerto) !== olt.puerto)        body.puerto = Number(puerto);
      if (usuario.trim() !== olt.usuarioAnclado) body.usuarioAnclado = usuario.trim();
      if (contrasena)                            body.contrasena = contrasena;
      if (detectado?.modelo)                     body.modelo = detectado.modelo;
      return oltNativoApi.patch(oltId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-detalle', oltId] });
      qc.invalidateQueries({ queryKey: ['olts-config'] });
      setContrasena(''); setProbado(null); setDetectado(null);
      toast('Conectividad actualizada (propagada a todos los caminos de conexión)', { type: 'success' });
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Error al guardar la conectividad', { type: 'error' }),
  });

  const handleGuardar = () => {
    if (!probado?.ok) {
      const seguir = window.confirm(
        'No hay una prueba SSH exitosa con estos valores. Si guardas credenciales ' +
        'incorrectas, TODAS las operaciones contra esta OLT fallarán (sync, provisión, señal).\n\n' +
        '¿Guardar sin probar? (solo para una OLT temporalmente inalcanzable)',
      );
      if (!seguir) return;
    }
    guardarMut.mutate();
  };

  const puedeProbarSinPassword = !credencialesCambiadas && !contrasena;
  const inputCls = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Conectividad SSH</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">IP de gestión</label>
          <input className={`${inputCls} font-mono`} value={ip} onChange={e => editar(setIp)(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Puerto</label>
          <input className={inputCls} type="number" min={1} max={65535} value={puerto} onChange={e => editar(setPuerto)(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Usuario</label>
          <input className={`${inputCls} font-mono`} value={usuario} onChange={e => editar(setUsuario)(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Contraseña (vacía = no cambiar)</label>
          <input className={`${inputCls} font-mono`} type="password" value={contrasena} autoComplete="new-password"
            onChange={e => editar(setContrasena)(e.target.value)} placeholder="••••••••" />
        </div>
      </div>

      {credencialesCambiadas && !contrasena && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Cambiaste IP, puerto o usuario: ingresa la contraseña para poder probar la conexión con los valores nuevos.
        </p>
      )}

      {probado && (
        <div className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
          probado.ok
            ? 'border-emerald-700/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
            : 'border-red-700/40 bg-red-500/5 text-red-700 dark:text-red-400',
        )}>
          {probado.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          <span>{probado.msg}{probado.latencia != null ? ` (${probado.latencia} ms)` : ''}</span>
        </div>
      )}

      {detectado && (
        <div className="rounded-lg border border-sky-700/40 bg-sky-500/5 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
          Detectado: <span className="font-mono font-semibold">{detectado.modelo ?? '—'}</span>
          {detectado.firmware ? <> · fw <span className="font-mono">{detectado.firmware}</span></> : null}
          {' — '}{detectado.mensaje}
          {detectado.modelo && detectado.modelo !== olt.modelo ? ' (el modelo se actualizará al guardar)' : ''}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={() => probarMut.mutate()}
          disabled={probarMut.isPending || (credencialesCambiadas && !contrasena) || (!hayCambios && !puedeProbarSinPassword)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/40 disabled:opacity-50"
        >
          {probarMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
          Probar SSH
        </button>
        <button
          onClick={handleGuardar}
          disabled={!hayCambios || guardarMut.isPending}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium disabled:opacity-50"
        >
          {guardarMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Guardar conectividad
        </button>
      </div>
    </div>
  );
}
