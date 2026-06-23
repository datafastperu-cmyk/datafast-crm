'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ModalProps {
  open:        boolean;
  onClose:     () => void;
  title:       string;
  description?: string;
  size?:       ModalSize;
  children:    ReactNode;
  footer?:     ReactNode;
  /** Impide cerrar al clickear el backdrop */
  persistent?: boolean;
  className?:  string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm:   'max-w-sm',
  md:   'max-w-md',
  lg:   'max-w-lg',
  xl:   'max-w-2xl',
  full: 'max-w-[92vw]',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  size       = 'md',
  children,
  footer,
  persistent = false,
  className,
}: ModalProps) {
  const titleId = useId();
  const descId  = useId();

  // Cierre con Escape
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !persistent) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, persistent]);

  // Bloquear scroll del body mientras está abierto
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={persistent ? undefined : onClose}
    >
      {/* Dialog box — detiene propagación para no cerrar al clickear dentro */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          'relative w-full bg-card border border-border rounded-2xl shadow-2xl',
          'flex flex-col max-h-[90vh]',
          sizeClasses[size],
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-border flex-shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              {title}
            </h2>
            {description && (
              <p id={descId} className="text-sm text-muted-foreground mt-0.5">
                {description}
              </p>
            )}
          </div>
          {!persistent && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className={cn(
                'flex-shrink-0 p-1 rounded-lg text-muted-foreground',
                'hover:text-foreground hover:bg-muted transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Body — scrolleable */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>

        {/* Footer opcional */}
        {footer && (
          <div className="flex-shrink-0 px-6 py-4 border-t border-border bg-muted/30 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
