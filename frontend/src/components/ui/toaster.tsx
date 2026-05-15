'use client';

import * as React     from 'react';
import * as ToastPrim from '@radix-ui/react-toast';
import { X }          from 'lucide-react';
import { cn }         from '@/lib/utils';

// ─── Context ─────────────────────────────────────────────────
type ToastType = 'default' | 'success' | 'error' | 'warning';

interface ToastItem {
  id:      number;
  title:   string;
  description?: string;
  type:    ToastType;
}

interface ToastCtx {
  toast: (title: string, opts?: { description?: string; type?: ToastType }) => void;
}

const ToastContext = React.createContext<ToastCtx>({ toast: () => {} });

let toastId = 0;

// ─── Provider global ─────────────────────────────────────────
export function Toaster() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const addToast = React.useCallback(
    (title: string, opts?: { description?: string; type?: ToastType }) => {
      const id = ++toastId;
      setToasts((p) => [...p, { id, title, description: opts?.description, type: opts?.type ?? 'default' }]);
      setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 5000);
    },
    [],
  );

  // Exponer globalmente
  React.useEffect(() => {
    (window as any).__datafast_toast = addToast;
  }, [addToast]);

  const STYLES: Record<ToastType, string> = {
    default: 'bg-card border-border',
    success: 'bg-green-50  border-green-200  dark:bg-green-950/50 dark:border-green-800',
    error:   'bg-red-50    border-red-200    dark:bg-red-950/50   dark:border-red-800',
    warning: 'bg-orange-50 border-orange-200 dark:bg-orange-950/50 dark:border-orange-800',
  };

  return (
    <ToastPrim.Provider>
      {toasts.map((t) => (
        <ToastPrim.Root
          key={t.id}
          open
          className={cn(
            'flex items-start gap-3 p-4 rounded-xl border shadow-lg',
            'data-[state=open]:animate-fade-in',
            STYLES[t.type],
          )}
        >
          <div className="flex-1 min-w-0">
            <ToastPrim.Title className="text-sm font-semibold text-foreground">
              {t.title}
            </ToastPrim.Title>
            {t.description && (
              <ToastPrim.Description className="text-xs text-muted-foreground mt-0.5">
                {t.description}
              </ToastPrim.Description>
            )}
          </div>
          <ToastPrim.Close className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5">
            <X className="w-4 h-4" />
          </ToastPrim.Close>
        </ToastPrim.Root>
      ))}
      <ToastPrim.Viewport
        className="fixed bottom-4 right-4 flex flex-col gap-2 w-80 z-[9999]"
      />
    </ToastPrim.Provider>
  );
}

// ─── Hook de uso ──────────────────────────────────────────────
export function useToast() {
  return {
    toast: (title: string, opts?: { description?: string; type?: ToastType }) => {
      (window as any).__datafast_toast?.(title, opts);
    },
  };
}
