'use client';

import { useEffect } from 'react';
import { X, UserPlus } from 'lucide-react';
import { ClienteWizard } from './ClienteWizard';

interface Props {
  open:    boolean;
  onClose: () => void;
}

export function NuevoAbonadoModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return () => {};
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full sm:max-w-4xl sm:mx-4 bg-background flex flex-col
                      h-[96dvh] sm:h-auto sm:max-h-[92vh]
                      rounded-t-2xl sm:rounded-2xl shadow-2xl
                      animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4
                        border-b border-border rounded-t-2xl bg-background">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <UserPlus className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground leading-tight">Nuevo Abonado</h2>
              <p className="text-xs text-muted-foreground">Completa los pasos para registrar el abonado</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          <ClienteWizard onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
