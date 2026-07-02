import type { Metadata } from 'next';
import { EmpresaTab } from '@/components/configuracion/EmpresaTab';
export const metadata: Metadata = { title: 'Empresa — Ajustes' };
export default function EmpresaPage() {
  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Empresa</h2>
        <p className="text-sm text-muted-foreground">Configuración general de tu empresa.</p>
      </div>
      <EmpresaTab />
    </div>
  );
}
