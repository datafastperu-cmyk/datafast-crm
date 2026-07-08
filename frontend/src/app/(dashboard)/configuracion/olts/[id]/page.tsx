'use client';

// La gestión de OLTs se unificó en /red/olt. Esta ruta queda como redirect para no
// romper enlaces/bookmarks existentes hacia el detalle bajo configuracion/olts.
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function OltDetalleRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/red/olt/${id}`);
  }, [id, router]);
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}
