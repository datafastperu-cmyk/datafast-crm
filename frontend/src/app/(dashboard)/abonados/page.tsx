import { redirect } from 'next/navigation';

// Alias legacy: /abonados → /clientes
export default function AbonadosPage() {
  redirect('/clientes');
}
