'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useTheme }               from 'next-themes';
import {
  Sun, Moon, Bell, LogOut, User,
  ChevronDown, Settings,
} from 'lucide-react';
import { useAuthStore }  from '@/store/auth.store';
import api               from '@/lib/api';
import { cn }            from '@/lib/utils';
import { useState }      from 'react';

// ─── Breadcrumb automático ────────────────────────────────────
const LABELS: Record<string, string> = {
  dashboard:     'Dashboard',
  clientes:      'Clientes',
  contratos:     'Contratos',
  facturacion:   'Facturación',
  pagos:         'Pagos',
  monitoreo:     'Monitoreo',
  mikrotik:      'Mikrotik',
  ftth:          'FTTH / ONUs',
  configuracion: 'Configuración',
};

function getBreadcrumb(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean)[0] || 'dashboard';
  return LABELS[segment] || segment;
}

export function Topbar() {
  const router    = useRouter();
  const pathname  = usePathname();
  const { theme, setTheme }  = useTheme();
  const { usuario, logout }  = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignorar */ }
    logout();
    router.replace('/login');
  };

  return (
    <header
      className="h-[var(--topbar-height)] flex items-center justify-between
                 px-6 border-b border-border bg-card/80 backdrop-blur-sm
                 flex-shrink-0 z-10"
    >
      {/* Breadcrumb */}
      <div>
        <h1 className="text-sm font-semibold text-foreground">
          {getBreadcrumb(pathname)}
        </h1>
        <p className="text-xs text-muted-foreground hidden sm:block">
          {new Date().toLocaleDateString('es-PE', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          })}
        </p>
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-1">

        {/* Toggle de tema */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground
                     hover:bg-muted transition-colors"
          title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Campana de alertas */}
        <button
          onClick={() => router.push('/monitoreo')}
          className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground
                     hover:bg-muted transition-colors"
          title="Ver alertas"
        >
          <Bell className="w-4 h-4" />
          {/* Badge de alertas activas — lo llenará el hook de monitoreo */}
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-destructive" />
        </button>

        {/* Menú de usuario */}
        <div className="relative ml-1">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                       text-sm font-medium text-foreground
                       hover:bg-muted transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center
                            text-xs font-bold text-primary">
              {usuario?.nombreCompleto[0]?.toUpperCase()}
            </div>
            <span className="hidden md:block max-w-[120px] truncate">
              {usuario?.nombreCompleto.split(' ')[0]}
            </span>
            <ChevronDown className={cn(
              'w-3.5 h-3.5 text-muted-foreground transition-transform duration-200',
              menuOpen && 'rotate-180',
            )} />
          </button>

          {/* Dropdown */}
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1.5 w-52 z-20
                              bg-popover border border-border rounded-xl shadow-xl
                              overflow-hidden animate-fade-in">

                {/* Info usuario */}
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-medium text-foreground truncate">
                    {usuario?.nombreCompleto}
                  </p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {usuario?.email}
                  </p>
                  <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5
                                   rounded-full bg-primary/10 text-primary">
                    {usuario?.roles[0]}
                  </span>
                </div>

                {/* Opciones */}
                <div className="p-1">
                  <MenuOption
                    icon={User}
                    label="Mi perfil"
                    onClick={() => { setMenuOpen(false); router.push('/configuracion/perfil'); }}
                  />
                  <MenuOption
                    icon={Settings}
                    label="Configuración"
                    onClick={() => { setMenuOpen(false); router.push('/configuracion'); }}
                  />
                  <div className="border-t border-border my-1" />
                  <MenuOption
                    icon={LogOut}
                    label="Cerrar sesión"
                    danger
                    onClick={handleLogout}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuOption({
  icon: Icon, label, onClick, danger = false,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm',
        'transition-colors text-left',
        danger
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-muted',
      )}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {label}
    </button>
  );
}
