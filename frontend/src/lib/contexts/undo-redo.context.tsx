'use client';

import {
  createContext, useContext, useEffect, useCallback,
  useState, useRef, type ReactNode,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditoriaApi, type UndoRedoEstado } from '@/lib/api/auditoria';
import { useToast } from '@/components/ui/toaster';
import { parseApiError } from '@/lib/utils';

interface UndoRedoCtx {
  canUndo:   boolean;
  canRedo:   boolean;
  estado:    UndoRedoEstado | undefined;
  undoing:   boolean;
  redoing:   boolean;
  undo:      () => void;
  redo:      () => void;
}

const Ctx = createContext<UndoRedoCtx>({
  canUndo: false, canRedo: false,
  estado: undefined, undoing: false, redoing: false,
  undo: () => {}, redo: () => {},
});

export function UndoRedoProvider({ children }: { children: ReactNode }) {
  const { toast }      = useToast();
  const queryClient    = useQueryClient();
  const [lastAction, setLastAction] = useState<string | null>(null);

  // Estado del servidor — polling ligero cada 8 s cuando la ventana está activa
  const { data: estado } = useQuery<UndoRedoEstado>({
    queryKey: ['undo-redo-estado'],
    queryFn:  auditoriaApi.getEstado,
    staleTime: 5_000,
    refetchInterval: 8_000,
    refetchIntervalInBackground: false,
  });

  // Invalidar todas las queries críticas después de undo/redo
  const invalidarTodo = useCallback(() => {
    const claves = [
      'clientes', 'contratos', 'planes', 'facturas',
      'pagos', 'planes-admin', 'undo-redo-estado',
    ];
    claves.forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
  }, [queryClient]);

  const { mutate: doUndo, isPending: undoing } = useMutation({
    mutationFn: auditoriaApi.undo,
    onSuccess: (res) => {
      if (res.ok) {
        setLastAction(res.descripcion);
        toast(`↩ ${res.descripcion}`, { type: 'success' });
      } else {
        toast(res.descripcion, { type: 'warning' });
      }
      invalidarTodo();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: doRedo, isPending: redoing } = useMutation({
    mutationFn: auditoriaApi.redo,
    onSuccess: (res) => {
      if (res.ok) {
        setLastAction(res.descripcion);
        toast(`↪ ${res.descripcion}`, { type: 'success' });
      } else {
        toast(res.descripcion, { type: 'warning' });
      }
      invalidarTodo();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const undo = useCallback(() => {
    if (!undoing && estado?.canUndo) doUndo();
  }, [undoing, estado?.canUndo, doUndo]);

  const redo = useCallback(() => {
    if (!redoing && estado?.canRedo) doRedo();
  }, [redoing, estado?.canRedo, doRedo]);

  // Atajos de teclado globales — Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      // No interferir con inputs de texto
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  return (
    <Ctx.Provider value={{
      canUndo:  estado?.canUndo  ?? false,
      canRedo:  estado?.canRedo  ?? false,
      estado,
      undoing,
      redoing,
      undo,
      redo,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useUndoRedo = () => useContext(Ctx);
