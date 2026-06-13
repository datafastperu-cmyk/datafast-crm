import { redirect } from 'next/navigation';

// Alias legacy: /finanzas → /facturacion
export default function FinanzasPage() {
  redirect('/facturacion');
}
