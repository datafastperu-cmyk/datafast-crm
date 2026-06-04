'use client';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';

export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted ? createPortal(children, document.body) : null;
}
