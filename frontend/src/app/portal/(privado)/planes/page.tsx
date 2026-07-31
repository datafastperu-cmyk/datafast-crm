import { redirect } from 'next/navigation';

// El catálogo se absorbió en «Mis servicios», donde el abonado lo compara contra su
// plan actual. La ruta se conserva porque puede estar en un marcador del navegador o
// haberse enviado por soporte en un mensaje anterior.
export default function PlanesPage() {
  redirect('/portal/servicios');
}
