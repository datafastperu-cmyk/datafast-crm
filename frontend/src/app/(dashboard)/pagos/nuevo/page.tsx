import type { Metadata } from 'next';
import { RegistrarPagoForm } from '@/components/pagos/RegistrarPagoForm';
export const metadata: Metadata = { title: 'Registrar Pago' };
export default function NuevoPagoPage({
  searchParams,
}: { searchParams: { clienteId?: string; facturaId?: string; contratoId?: string } }) {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Registrar Pago</h2>
        <p className="text-sm text-muted-foreground">
          Registra un pago recibido. Los pagos Yape/Plin/Transferencia requieren número de operación.
        </p>
      </div>
      <RegistrarPagoForm
        clienteId={searchParams.clienteId}
        facturaId={searchParams.facturaId}
        contratoId={searchParams.contratoId}
      />
    </div>
  );
}
