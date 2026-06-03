'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useTheme }               from 'next-themes';
import {
  Sun, Moon, Bell, LogOut, User,
  ChevronDown, Settings, DollarSign,
  Search, Loader2, Menu, Undo2, Redo2, X,
} from 'lucide-react';
import { useAuthStore }   from '@/store/auth.store';
import api                from '@/lib/api';
import { cn }             from '@/lib/utils';
import { useState, useEffect, useRef } from 'react';
import type { Cliente }   from '@/types';
import Link               from 'next/link';
import { useUndoRedo }    from '@/lib/contexts/undo-redo.context';

const LABELS: Record<string, string> = {
  dashboard:     'Dashboard',
  clientes:      'Abonados',
  contratos:     'Contratos',
  facturacion:   'Facturación',
  pagos:         'Transacciones',
  monitoreo:     'Monitoreo',
  red:           'Gestión de Red',
  servicios:     'Servicios',
  finanzas:      'Finanzas',
  tickets:       'Soporte',
  mensajeria:    'Mensajería',
  reportes:      'Reportes',
  configuracion: 'Configuración',
  tecnicos:      'Técnicos',
  inventario:    'Inventario',
  gastos:        'Gastos / Ingresos',
  iptv:          'IPTV / Streaming',
  logs:          'Logs del Sistema',
  cortes:        'Cortes Automáticos',
};

function getBreadcrumb(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean)[0] || 'dashboard';
  return LABELS[segment] || segment;
}

function ClienteSearch() {
  const router = useRouter();
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<Cliente[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [isOpen,   setIsOpen]   = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setIsOpen(false); return undefined; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/clientes', { params: { search: query.trim(), limit: 6 } });
        const list: Cliente[] = data?.data ?? [];
        setResults(list);
        setIsOpen(list.length > 0);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (id: string) => {
    setQuery('');
    setIsOpen(false);
    router.push(`/clientes/${id}`);
  };

  return (
    <div ref={ref} className="relative hidden sm:block">
      <div className="flex items-center gap-1.5 bg-muted/60 border border-border rounded-lg px-3 py-1.5 w-56 focus-within:w-72 transition-all duration-200">
        {loading
          ? <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin flex-shrink-0" />
          : <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
        <input
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-w-0"
          placeholder="Buscar abonado..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
        />
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1.5 w-80 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSelect(c.id)}
              className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
            >
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary mt-0.5">
                {c.nombres[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{c.nombreCompleto}</p>
                <p className="text-xs text-muted-foreground">{c.tipoDocumento}: {c.numeroDocumento}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Topbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const router    = useRouter();
  const pathname  = usePathname();
  const { theme, setTheme }  = useTheme();
  const { usuario, logout }  = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const { canUndo, canRedo, undoing, redoing, undo, redo, estado } = useUndoRedo();

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
      {/* Hamburger + Breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Abrir menú"
        >
          <Menu className="w-5 h-5" />
        </button>
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
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-1">

        {/* Búsqueda móvil */}
        {mobileSearchOpen && <MobileSearch onClose={() => setMobileSearchOpen(false)} router={router} />}
        <button
          onClick={() => setMobileSearchOpen(true)}
          className="sm:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Buscar"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Búsqueda de clientes */}
        <ClienteSearch />

        {/* Undo / Redo */}
        <div className="hidden sm:flex items-center gap-0.5 border border-border rounded-lg p-0.5 bg-muted/30">
          <button
            onClick={undo}
            disabled={undoing}
            title={canUndo && estado?.lastUndo
              ? `Deshacer: ${estado.lastUndo.descripcion} (Ctrl+Z)`
              : 'Deshacer (Ctrl+Z)'}
            className={cn(
              'flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors',
              canUndo
                ? 'text-foreground hover:bg-muted'
                : 'text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground',
            )}
          >
            {undoing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Undo2 className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">Deshacer</span>
          </button>
          <button
            onClick={redo}
            disabled={redoing}
            title={canRedo && estado?.lastRedo
              ? `Rehacer: ${estado.lastRedo.descripcion} (Ctrl+Y)`
              : 'Rehacer (Ctrl+Y)'}
            className={cn(
              'flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors',
              canRedo
                ? 'text-foreground hover:bg-muted'
                : 'text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground',
            )}
          >
            {redoing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Redo2 className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">Rehacer</span>
          </button>
        </div>

        {/* Registro de pago rápido */}
        <Link href="/finanzas/registro">
          <button
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground
                       hover:bg-muted transition-colors"
            title="Registrar pago"
          >
            <DollarSign className="w-4 h-4" />
          </button>
        </Link>

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

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 w-52 z-20
                              bg-popover border border-border rounded-xl shadow-xl
                              overflow-hidden animate-fade-in">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-medium text-foreground truncate">{usuario?.nombreCompleto}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{usuario?.email}</p>
                  <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5
                                   rounded-full bg-primary/10 text-primary">
                    {usuario?.roles[0]}
                  </span>
                </div>
                <div className="p-1">
                  <MenuOption icon={User} label="Mi perfil"
                    onClick={() => { setMenuOpen(false); router.push('/configuracion/perfil'); }} />
                  <MenuOption icon={Settings} label="Ajustes"
                    onClick={() => { setMenuOpen(false); router.push('/configuracion'); }} />
                  <div className="border-t border-border my-1" />
                  <MenuOption icon={LogOut} label="Cerrar sesión" danger onClick={handleLogout} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function MobileSearch({ onClose, router }: { onClose: () => void; router: ReturnType<typeof useRouter> }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return undefined; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/clientes', { params: { search: query.trim(), limit: 8 } });
        setResults(data?.data ?? []);
      } catch { /* ignore */ } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (id: string) => { onClose(); router.push(`/clientes/${id}`); };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col sm:hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        {loading
          ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground flex-shrink-0" />
          : <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
        <input
          ref={inputRef}
          className="flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground outline-none"
          placeholder="Buscar abonado..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground flex-shrink-0">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {results.map((c) => (
          <button
            key={c.id}
            onClick={() => handleSelect(c.id)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-left border-b border-border/50"
          >
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
              {c.nombres[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{c.nombreCompleto}</p>
              <p className="text-xs text-muted-foreground">{c.tipoDocumento}: {c.numeroDocumento}</p>
            </div>
          </button>
        ))}
        {query && !loading && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <Search className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Sin resultados para &ldquo;{query}&rdquo;</p>
          </div>
        )}
        {!query && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <Search className="w-10 h-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground">Escribe para buscar abonados</p>
          </div>
        )}
      </div>
    </div>
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
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-muted',
      )}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {label}
    </button>
  );
}
