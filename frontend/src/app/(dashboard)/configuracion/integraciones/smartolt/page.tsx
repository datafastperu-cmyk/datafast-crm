// La gestión de SmartOLT se unificó en Red → OLT / GPON (crear + credenciales por OLT).
import { redirect } from 'next/navigation';

export default function SmartOltIntegracionRedirect() {
  redirect('/red/olt');
}
