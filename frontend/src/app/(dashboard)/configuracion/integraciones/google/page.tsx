'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { GoogleIntegrationDashboard } from '@/components/integraciones/GoogleIntegrationDashboard';
import { useToast } from '@/components/ui/toaster';

export default function GoogleIntegrationPage() {
  const usuario    = useAuthStore((s) => s.usuario);
  const params     = useSearchParams();
  const { toast }  = useToast();

  useEffect(() => {
    if (params.get('connected') === '1') {
      toast('Cuenta de Google conectada correctamente', { type: 'success' });
    }
    if (params.get('error')) {
      toast(`Error OAuth: ${params.get('error')}`, { type: 'error' });
    }
  }, []);

  if (!usuario) return null;

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link
          href="/configuracion/integraciones"
          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Google Workspace</h1>
          <p className="text-xs text-muted-foreground">
            Conecta y administra la integración con los servicios de Google
          </p>
        </div>
      </div>

      <GoogleIntegrationDashboard empresaId={usuario.empresaId} />
    </div>
  );
}
