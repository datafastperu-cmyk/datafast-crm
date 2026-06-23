'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, UserPlus, AlertTriangle } from 'lucide-react';
import { ClienteWizard } from './ClienteWizard';
import { Portal }        from '@/components/ui/portal';

interface Props {
  open:    boolean;
  onClose: () => void;
}

export function NuevoAbonadoModal({ open, onClose }: Props) {
  const [confirmClose, setConfirmClose] = useState(false);

  const handleRequestClose = useCallback(() => {
    setConfirmClose(true);
  }, []);

  const handleConfirmClose = useCallback(() => {
    setConfirmClose(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) { setConfirmClose(false); return () => {}; }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); handleRequestClose(); }
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, handleRequestClose]);

  if (!open) return null;

  return (
    <Portal>
    {/* Diálogo de confirmación de cierre */}
    {confirmClose && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70">
        <div role="dialog" aria-modal="true" className="bg-background rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
            <h3 className="font-semibold text-foreground">¿Descartar registro?</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            Los datos ingresados se perderán. ¿Deseas cerrar el formulario?
          </p>
          <div className="flex gap-2 justify-between">
            <button
              onClick={handleConfirmClose}
              className="px-4 py-2 rounded-lg text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              Descartar
            </button>
            <button
              onClick={() => setConfirmClose(false)}
              className="px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Continuar editando
            </button>
          </div>
        </div>
      </div>
    )}
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleRequestClose(); }}
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
            onClick={handleRequestClose}
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
    </Portal>
  );
}
