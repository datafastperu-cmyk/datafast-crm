import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Registro de Pagos' };
export default function RegistroPagosPage() {
  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-[400px] text-gray-400">
      <p className="text-lg font-medium">Registro de Pagos</p>
      <p className="text-sm mt-1">Próximamente disponible</p>
    </div>
  );
}
