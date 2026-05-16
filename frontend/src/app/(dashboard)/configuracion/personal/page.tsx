import type { Metadata } from 'next';
import { UsuariosTab } from '@/components/configuracion/UsuariosTab';
export const metadata: Metadata = { title: 'Gestión de Personal — Ajustes' };
export default function PersonalPage() {
  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-lg font-semibold text-foreground mb-6">Gestión de Personal</h2>
      <div className="bg-card border border-border rounded-xl p-6"><UsuariosTab /></div>
    </div>
  );
}
