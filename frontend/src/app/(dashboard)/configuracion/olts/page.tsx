'use client';

// La gestión de OLTs se unificó en /red/olt (tab OLTs). Redirect para no romper enlaces.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function OltsListRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/red/olt');
  }, [router]);
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}
