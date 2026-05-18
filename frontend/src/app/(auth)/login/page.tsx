import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';
import { Wifi } from 'lucide-react';

export const metadata: Metadata = { title: 'Iniciar Sesión' };

export default function LoginPage() {
  return (
    <div className="space-y-8">
      {/* Logo */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20">
          <Wifi className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">CRM ISP DATAFAST</h1>
        <p className="text-sm text-muted-foreground">
          Sistema de gestión para proveedores de internet
        </p>
      </div>

      {/* Formulario */}
      <Suspense>
        <LoginForm />
      </Suspense>

      <p className="text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} CRM ISP DATAFAST · Todos los derechos reservados
      </p>
    </div>
  );
}
