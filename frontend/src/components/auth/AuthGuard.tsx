'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { Loader2 } from 'lucide-react';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router     = useRouter();
  const isAuth     = useAuthStore((s) => s.isAuth);
  const isLoading  = useAuthStore((s) => s.isLoading);
  const _hydrated  = useAuthStore((s) => s._hydrated);

  useEffect(() => {
    if (_hydrated && !isLoading && !isAuth) {
      router.replace('/login');
    }
  }, [isAuth, isLoading, _hydrated, router]);

  if (!_hydrated || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuth) return null;

  return <>{children}</>;
}
