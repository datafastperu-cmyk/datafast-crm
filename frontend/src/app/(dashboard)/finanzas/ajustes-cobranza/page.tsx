'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Power, Pencil } from 'lucide-react';

import { pagosApi, type CanalPago, type CuentaBancaria } from '@/lib/api/facturacion';
import { useToast } from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Ajustes de Cobranza — los tres ejes de un ingreso.
//
//   Forma de pago    ¿cómo pagó?        taxonomía CERRADA, no se configura
//   Canal de pago    ¿por qué medio?    configurable — es lo que se administra aquí
//   Cuenta receptora ¿dónde entró?      tesorería
//
// La forma no es configurable a propósito: es el eje de los reportes contables y de la
// conciliación, y cambiarla cambiaría el significado del histórico. Lo que el negocio
// configura son los canales — y cada canal lleva su cuenta sugerida, si exige número de
// operación y qué comisión retiene.
//
// Esa última parte importa: la regla vive en el canal, no en el formulario. Si viviera en
// el formulario, el portal del cliente y la app móvil tendrían cada uno la suya.
// ─────────────────────────────────────────────────────────────────────────────
export default function AjustesCobranzaPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editando, setEditando] = useState<CanalPago | 'nuevo' | null>(null);

  const { data: formas = [] }  = useQuery({ queryKey: ['formas-pago'],  queryFn: pagosApi.getFormas });
  const { data: canales = [], isLoading } = useQuery({
    queryKey: ['canales-pago-admin'], queryFn: () => pagosApi.getCanales(false),
  });
  const { data: cuentas = [] } = useQuery({
    queryKey: ['cuentas-bancarias'], queryFn: pagosApi.getCuentasBancarias,
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['canales-pago-admin'] });
    qc.invalidateQueries({ queryKey: ['canales-pago'] });
  };

  const { mutate: desactivar } = useMutation({
    mutationFn: (id: string) => pagosApi.desactivarCanal(id),
    onSuccess: () => { toast('Canal desactivado', { type: 'success' }); invalidar(); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: reactivar } = useMutation({
    mutationFn: (id: string) => pagosApi.actualizarCanal(id, { activo: true }),
    onSuccess: () => { toast('Canal reactivado', { type: 'success' }); invalidar(); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const nombreCuenta = (id: string | null) => {
    if (!id) return null;
    const c = cuentas.find((x) => x.id === id);
    return c ? (c.nombre ?? c.banco) : null;
  };

  const porForma = formas.map((f) => ({
    forma:   f,
    canales: canales.filter((c) => c.formaPago === f.codigo),
  }));

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Ajustes de Cobranza</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Un ingreso responde tres preguntas: cómo pagó el abonado, por qué medio concreto,
            y en qué cuenta entró el dinero. Aquí se configura la segunda —los canales— y
            cada uno lleva la cuenta que propone y sus requisitos.
          </p>
        </div>
        <button onClick={() => setEditando('nuevo')}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary
                     text-primary-foreground font-medium hover:bg-primary/90 shrink-0">
          <Plus className="w-4 h-4" /> Nuevo canal
        </button>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-6">
          {porForma.map(({ forma, canales: lista }) => (
            <section key={forma.codigo} className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/40 border-b border-border">
                <h2 className="text-sm font-medium text-foreground">{forma.nombre}</h2>
              </div>

              {lista.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">
                  Sin canales. Un cobro con esta forma quedará sin clasificar y no aparecerá
                  en el reporte por canal.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {lista.map((c) => (
                    <li key={c.id} className={cn(
                      'flex items-center gap-3 px-4 py-3',
                      !c.activo && 'opacity-50',
                    )}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {c.nombre}
                          {!c.activo && <span className="ml-2 text-xs">(desactivado)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {nombreCuenta(c.cuentaReceptoraDefaultId) ?? 'sin cuenta por defecto'}
                          {c.requiereNumeroOperacion && ' · exige N° de operación'}
                          {(Number(c.comisionPorcentaje) > 0 || Number(c.comisionFija) > 0) &&
                            ` · comisión ${c.comisionPorcentaje}% + S/ ${c.comisionFija}`}
                          {!c.permiteRegistroManual && ' · solo automático (pasarela)'}
                        </p>
                      </div>

                      <button onClick={() => setEditando(c)}
                        className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
                        title="Editar">
                        <Pencil className="w-4 h-4" />
                      </button>

                      {/* Baja LÓGICA siempre: el histórico tiene que seguir diciendo por
                          dónde entró cada cobro, aunque el canal ya no se use. */}
                      <button
                        onClick={() => (c.activo ? desactivar(c.id) : reactivar(c.id))}
                        className="p-2 rounded-lg hover:bg-muted text-muted-foreground"
                        title={c.activo ? 'Desactivar' : 'Reactivar'}>
                        <Power className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {editando && (
        <ModalCanal
          canal={editando === 'nuevo' ? null : editando}
          formas={formas}
          cuentas={cuentas}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); invalidar(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ModalCanal({ canal, formas, cuentas, onClose, onSaved }: {
  canal: CanalPago | null;
  formas: Array<{ codigo: string; nombre: string }>;
  cuentas: CuentaBancaria[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [f, setF] = useState({
    nombre:                  canal?.nombre ?? '',
    formaPago:               canal?.formaPago ?? formas[0]?.codigo ?? 'efectivo',
    cuentaReceptoraDefaultId: canal?.cuentaReceptoraDefaultId ?? '',
    requiereNumeroOperacion: canal?.requiereNumeroOperacion ?? false,
    comisionPorcentaje:      Number(canal?.comisionPorcentaje ?? 0),
    comisionFija:            Number(canal?.comisionFija ?? 0),
  });

  const { mutate: guardar, isPending } = useMutation({
    mutationFn: () => {
      const payload = {
        nombre: f.nombre.trim(),
        cuentaReceptoraDefaultId: f.cuentaReceptoraDefaultId || null,
        requiereNumeroOperacion: f.requiereNumeroOperacion,
        comisionPorcentaje: f.comisionPorcentaje,
        comisionFija: f.comisionFija,
      };
      // La forma NO se puede cambiar al editar: mover un canal de forma reescribiría el
      // significado de todos los cobros que ya entraron por él.
      return canal
        ? pagosApi.actualizarCanal(canal.id, payload)
        : pagosApi.crearCanal({ ...payload, formaPago: f.formaPago } as never);
    },
    onSuccess: () => { toast(canal ? 'Canal actualizado' : 'Canal creado', { type: 'success' }); onSaved(); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-input bg-background';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
         onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card border border-border p-5 space-y-4"
           onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-foreground">
          {canal ? `Editar «${canal.nombre}»` : 'Nuevo canal de cobro'}
        </h3>

        <label className="block space-y-1">
          <span className="text-sm text-foreground">Nombre</span>
          <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })}
                 placeholder="BCP, Yape, Oficina…" className={inputCls} />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-foreground">Forma de pago</span>
          <select value={f.formaPago} disabled={!!canal}
                  onChange={(e) => setF({ ...f, formaPago: e.target.value })}
                  className={cn(inputCls, canal && 'opacity-60')}>
            {formas.map((x) => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}
          </select>
          {canal && (
            <span className="text-xs text-muted-foreground">
              No se puede cambiar: reescribiría el significado de los cobros ya registrados
              por este canal. Desactívalo y crea otro.
            </span>
          )}
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-foreground">Cuenta receptora por defecto</span>
          <select value={f.cuentaReceptoraDefaultId}
                  onChange={(e) => setF({ ...f, cuentaReceptoraDefaultId: e.target.value })}
                  className={inputCls}>
            <option value="">— Ninguna (la elige el cajero) —</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre ?? c.banco} ({c.moneda})</option>
            ))}
          </select>
        </label>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={f.requiereNumeroOperacion}
                 onChange={(e) => setF({ ...f, requiereNumeroOperacion: e.target.checked })}
                 className="rounded mt-0.5" />
          <div>
            <p className="text-sm text-foreground">Exige número de operación</p>
            <p className="text-xs text-muted-foreground">
              Es lo que impide cobrar dos veces la misma transacción.
            </p>
          </div>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm text-foreground">Comisión %</span>
            <input type="number" step="0.01" min="0" value={f.comisionPorcentaje}
                   onChange={(e) => setF({ ...f, comisionPorcentaje: Number(e.target.value) })}
                   className={inputCls} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm text-foreground">Comisión fija S/</span>
            <input type="number" step="0.01" min="0" value={f.comisionFija}
                   onChange={(e) => setF({ ...f, comisionFija: Number(e.target.value) })}
                   className={inputCls} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          El abonado paga el importe completo y eso es lo que salda su factura. La comisión
          es un gasto: define cuánto llega realmente a la cuenta, que es lo que hay que
          buscar en el extracto bancario al conciliar.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose}
                  className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted">
            Cancelar
          </button>
          <button onClick={() => guardar()} disabled={isPending || !f.nombre.trim()}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary
                             text-primary-foreground font-medium hover:bg-primary/90
                             disabled:opacity-60">
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
