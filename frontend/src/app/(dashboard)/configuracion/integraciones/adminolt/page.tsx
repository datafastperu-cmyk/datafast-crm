// La gestión de AdminOLT se unificó en Red → OLT / GPON (crear + credenciales por OLT).
import { redirect } from 'next/navigation';

export default function AdminOltIntegracionRedirect() {
  redirect('/red/olt');
}
