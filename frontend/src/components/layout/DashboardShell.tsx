'use client';

import { useState, useEffect } from 'react';
import { Sidebar }               from '@/components/layout/Sidebar';
import { Topbar }                from '@/components/layout/Topbar';
import { useInactivityLogout }   from '@/hooks/useInactivityLogout';
import { UndoRedoProvider }      from '@/lib/contexts/undo-redo.context';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  useInactivityLogout();

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<{ message: string }>).detail?.message
        ?? 'Los datos fueron modificados por otro usuario. Por favor, recargue la página.';
      (window as any).__datafast_toast?.(msg, { type: 'error' });
    };
    window.addEventListener('concurrencia:conflicto', handler);
    return () => window.removeEventListener('concurrencia:conflicto', handler);
  }, []);

  const [sidebarOpen,    setSidebarOpen]    = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('sidebar-collapsed') === 'true',
  );

  const toggleCollapse = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('sidebar-collapsed', String(next));
  };

  return (
    <UndoRedoProvider>
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleCollapse}
      />

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Topbar onToggleSidebar={() => setSidebarOpen((o) => !o)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="page-transition max-w-screen-2xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
    </UndoRedoProvider>
  );
}
