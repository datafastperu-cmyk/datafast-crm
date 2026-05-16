import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Copia de Seguridad — Ajustes' };
export default function Page() {
  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-[400px] text-gray-400">
      <p className="text-lg font-medium">Copia de Seguridad</p>
      <p className="text-sm mt-1">Próximamente disponible</p>
    </div>
  );
}
