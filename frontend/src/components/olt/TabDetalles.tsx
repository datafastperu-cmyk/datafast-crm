'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, KeyRound, PlugZap, CheckCircle2, XCircle, Info, MapPin } from 'lucide-react';
import { oltNativoApi, type OltDispositivo } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { ServicePortPoolSection } from './ServicePortPoolSection';

interface Props {
  olt:   OltDispositivo;
  oltId: string;
}

export function TabDetalles({ olt, oltId }: Props) {
  const qc       = useQueryClient();
  const { toast } = useToast();

  const [nombre,      setNombre]      = useState(olt.nombre);
  const [descripcion, setDescripcion] = useState(olt.descripcion ?? '');
  const [ubicacion,   setUbicacion]   = useState(olt.ubicacion ?? '');
  const [gps,         setGps]         = useState(
    olt.latitud != null && olt.longitud != null ? `${olt.latitud}, ${olt.longitud}` : '',
  );

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => oltNativoApi.patch(oltId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['olt-detalle', oltId] });
      qc.invalidateQueries({ queryKey: ['olts-config'] });
      toast('OLT actualizada', { type: 'success' });
    },
    onError: (e: any) => toast(`Error: ${e?.message ?? 'Error al guardar'}`, { type: 'error' }),
  });

  // Solo los campos que DEFINE el ERP. Modelo, estado, slots y puertos son
  // estado observado (detect-version / sync / health poller) — no se editan.
  const handleSave = () => {
    const gpsParts = gps.split(',').map(s => s.trim());
    const body: Record<string, unknown> = {
      nombre:      nombre.trim(),
      descripcion: descripcion.trim() || null,
      ubicacion:   ubicacion.trim() || null,
      latitud:     gpsParts[0] ? parseFloat(gpsParts[0]) : null,
      longitud:    gpsParts[1] ? parseFloat(gpsParts[1]) : null,
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

  const Seccion = ({ icon, titulo, children }: { icon: React.ReactNode; titulo: string; children: React.ReactNode }) => (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold">{titulo}</h3>
      </div>
      {children}
    </div>
  );

  // Capacidad/hardware NO se edita: la topología real (slots, puertos PON) la
  // lee el sync y se muestra en el tab Placas. La VLAN de gestión la declara
  // el baseline (DATAFAST-TR069), no un campo suelto.
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      {/* Columna izquierda: lo que define el ERP (identidad + ubicación) */}
      <div className="space-y-6">
        <Seccion icon={<Info className="w-4 h-4 text-muted-foreground" />} titulo="Información general">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Nombre">
              <input className={inputCls} value={nombre} onChange={e => setNombre(e.target.value)} />
            </Field>
            <Field label="Marca">
              <input className={`${inputCls} opacity-60 cursor-not-allowed`} value={olt.marca} readOnly />
            </Field>
            {/* Modelo y Estado son observados (detect-version / health poller), no editables */}
            <Field label="Modelo (detectado)">
              <input className={`${inputCls} opacity-60 cursor-not-allowed`} value={olt.modelo || '— sin detectar —'} readOnly />
            </Field>
            <Field label="Estado (monitoreo)">
              <input className={`${inputCls} opacity-60 cursor-not-allowed`} value={olt.estado} readOnly />
            </Field>
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
        </Seccion>

        <Seccion icon={<MapPin className="w-4 h-4 text-muted-foreground" />} titulo="Ubicación">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Dirección física">
              <input className={inputCls} value={ubicacion} onChange={e => setUbicacion(e.target.value)} placeholder="Ej: Av. Los Pinos 123, Zona Norte" />
            </Field>
            <Field label="Coordenadas GPS">
              <input
                className={inputCls}
                value={gps}
                onChange={e => setGps(e.target.value)}
                placeholder="-12.046374, -77.042793"
              />
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Formato: latitud, longitud</p>
            </Field>
          </div>
        </Seccion>

        {/* Guarda Información + Ubicación (Conectividad tiene su propio flujo con prueba) */}
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

      {/* Columna derecha: conexión y recursos automáticos */}
      <div className="space-y-6">
        <ConectividadSection olt={olt} oltId={oltId} />
        <ServicePortPoolSection oltId={oltId} />
      </div>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
