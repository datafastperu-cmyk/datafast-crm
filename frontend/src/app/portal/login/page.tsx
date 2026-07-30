import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Wifi } from 'lucide-react';
import { PortalLoginForm } from '@/components/portal/PortalLoginForm';

export const metadata: Metadata = { title: 'Ingresar — Portal del Cliente' };

export default function PortalLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20">
            <Wifi className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Portal del Cliente</h1>
          <p className="text-sm text-muted-foreground">
            Consulta tu servicio, tus pagos y tu red WiFi.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <Suspense>
            <PortalLoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
