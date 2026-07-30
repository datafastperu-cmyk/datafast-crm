'use client';

import {
  createContext, useCallback, useContext, useRef, useState, type ReactNode,
} from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';

/**
 * Confirmación con el diseño del ERP, en lugar de `window.confirm`.
 *
 * El diálogo nativo del navegador rompe la interfaz por tres motivos, y el primero es el
 * que importa:
 *   1. Antepone el ORIGEN al mensaje — "149.34.48.224:3000 dice:" —, así que el operador
 *      lee una IP antes que la pregunta. En una acción destructiva, eso es exactamente
 *      lo contrario de lo que debe destacar.
 *   2. No distingue una acción destructiva de una cualquiera: mismo botón para "eliminar
 *      un pago" que para "continuar".
 *   3. Bloquea el hilo y no se puede probar ni maquetar.
 *
 * API de promesa a propósito: sustituir `if (window.confirm(...))` por
 * `if (await confirmar({...}))` es un cambio de una línea en cada sitio, sin reescribir
 * el flujo alrededor.
 */
export interface OpcionesConfirmacion {
  titulo:      string;
  mensaje?:    string;
  /** Texto del botón que ejecuta la acción. Debe nombrar la ACCIÓN, no decir "Aceptar". */
  confirmar?:  string;
  cancelar?:   string;
  /** `peligro` para lo irreversible: eliminar, anular, desaprovisionar. */
  variante?:   'peligro' | 'normal';
}

type Resolver = (valor: boolean) => void;

const ConfirmContext = createContext<((o: OpcionesConfirmacion) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opciones, setOpciones] = useState<OpcionesConfirmacion | null>(null);
  const resolver = useRef<Resolver | null>(null);

  const confirmar = useCallback((o: OpcionesConfirmacion) => {
    setOpciones(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const cerrar = useCallback((valor: boolean) => {
    // Se resuelve SIEMPRE, también al cerrar con Escape o clic fuera: una promesa que
    // nunca resuelve deja el handler colgado y el botón en "cargando" para siempre.
    resolver.current?.(valor);
    resolver.current = null;
    setOpciones(null);
  }, []);

  const peligro = opciones?.variante === 'peligro';

  return (
    <ConfirmContext.Provider value={confirmar}>
      {children}

      <Modal
        open={Boolean(opciones)}
        onClose={() => cerrar(false)}
        title={opciones?.titulo ?? ''}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => cerrar(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-foreground hover:opacity-90 transition-opacity"
            >
              {opciones?.cancelar ?? 'Cancelar'}
            </button>
            <button
              type="button"
              // Foco inicial en CANCELAR, no aquí: en una acción irreversible, un Enter
              // reflejo no debe ejecutarla.
              onClick={() => cerrar(true)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90',
                peligro ? 'bg-destructive' : 'bg-primary',
              )}
            >
              {opciones?.confirmar ?? 'Confirmar'}
            </button>
          </div>
        }
      >
        <div className="flex items-start gap-3">
          {peligro && (
            <div className="w-9 h-9 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {opciones?.mensaje ?? '¿Deseas continuar?'}
          </p>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

/**
 * Devuelve la función de confirmación.
 *
 *   if (await confirmar({ titulo: 'Eliminar pago', variante: 'peligro' })) { ... }
 *
 * Si no hay provider montado NO se cae ni bloquea: registra el fallo y niega la acción.
 * Ante la duda, no ejecutar lo destructivo.
 */
export function useConfirmar(): (o: OpcionesConfirmacion) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  return useCallback(
    (o: OpcionesConfirmacion) => {
      if (!ctx) {
        console.error('useConfirmar sin <ConfirmProvider>: se cancela', o.titulo);
        return Promise.resolve(false);
      }
      return ctx(o);
    },
    [ctx],
  );
}

// Re-exportado por comodidad: algunas pantallas muestran su propio spinner mientras la
// acción confirmada está en vuelo.
export { Loader2 as IconoCargando };
