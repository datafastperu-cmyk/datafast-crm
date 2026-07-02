import type { Metadata } from 'next';
import { EmpresaTab } from '@/components/configuracion/EmpresaTab';
export const metadata: Metadata = { title: 'Empresa — Ajustes' };
export default function EmpresaPage() {
  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-lg font-semibold text-foreground mb-6">Empresa</h2>
      <div className="bg-card border border-border rounded-xl p-6"><EmpresaTab /></div>
    </div>
  );
}
