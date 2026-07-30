import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Servicio (contrato) que el abonado está viendo. Se persiste porque el portal es
// mayoritariamente móvil: volver y tener que reelegir el servicio en cada visita es
// fricción pura para quien solo quiere ver cuánto debe.
//
// La elección NO es una credencial: cada endpoint valida en el servidor que el contrato
// pertenece al abonado del token. Manipular este valor no da acceso a nada ajeno.
interface PortalState {
  contratoId: string | null;
  setContratoId: (id: string | null) => void;
  limpiar: () => void;
}

export const usePortalStore = create<PortalState>()(
  persist(
    (set) => ({
      contratoId: null,
      setContratoId: (contratoId) => set({ contratoId }),
      limpiar: () => set({ contratoId: null }),
    }),
    { name: 'datafast-portal' },
  ),
);
