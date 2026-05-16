import type { Metadata } from 'next';
import { EmpresaTab } from '@/components/configuracion/EmpresaTab';
export const metadata: Metadata = { title: 'General — Ajustes' };
export default function GeneralPage() {
  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-lg font-semibold text-foreground mb-6">General</h2>
      <div className="bg-card border border-border rounded-xl p-6"><EmpresaTab /></div>
    </div>
  );
}
