import { redirect } from 'next/navigation';

// Redirigir / → /dashboard (el AuthGuard maneja la autenticación)
export default function RootPage() {
  redirect('/dashboard');
}
