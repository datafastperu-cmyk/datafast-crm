'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos
const EVENTS     = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const;

export function useInactivityLogout() {
  const logout = useAuthStore((s) => s.logout);
  const isAuth = useAuthStore((s) => s.isAuth);
  const router = useRouter();
  const timer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuth) return undefined;

    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        logout();
        router.replace('/login');
      }, TIMEOUT_MS);
    };

    reset();
    EVENTS.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));

    return () => {
      if (timer.current) clearTimeout(timer.current);
      EVENTS.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [isAuth, logout, router]);
}
