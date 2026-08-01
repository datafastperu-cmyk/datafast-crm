import { redirect } from 'next/navigation';

// Cajas NAP dejó de ser una sección propia: ahora es una pestaña de Planta Externa, junto
// al resto del grafo óptico (sites, fibra, mufas). La ruta se conserva como redirección
// porque puede estar en marcadores o en un enlace compartido — romperla no aportaría nada.
export default function CajasNapRedirect() {
  redirect('/red/planta-externa?tab=naps');
}
