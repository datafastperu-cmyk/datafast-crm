import { create } from 'zustand';
import { setGlobalMoneda } from '@/lib/utils';

interface EmpresaState {
  moneda:    string;
  setMoneda: (m: string) => void;
}

export const useEmpresaStore = create<EmpresaState>()((set) => ({
  moneda:    'PEN',
  setMoneda: (m) => {
    const val = m || 'PEN';
    setGlobalMoneda(val);
    set({ moneda: val });
  },
}));

export const useMoneda    = () => useEmpresaStore((s) => s.moneda);
