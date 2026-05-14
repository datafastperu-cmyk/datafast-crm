import type { Metadata } from 'next';
import { ContratoForm } from '@/components/contratos/ContratoForm';
export const metadata: Metadata = { title: 'Nuevo Contrato' };
export default function NuevoContratoPage({
  searchParams,
}: {
  searchParams: { clienteId?: string };
}) {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Nuevo Contrato</h2>
        <p className="text-sm text-muted-foreground">
          Configura el plan, la red y las credenciales PPPoE del cliente.
        </p>
      </div>
      <ContratoForm clienteId={searchParams.clienteId} />
    </div>
  );
}
