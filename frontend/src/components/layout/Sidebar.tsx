'use client';

import { useState, useEffect } from 'react';
import Link            from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Wifi, Activity, Settings, BarChart2,
  ChevronDown, Router, Shield, Network, Server, Globe, Box,
  Package, MapPin, Wrench, DollarSign, Receipt, TrendingUp,
  Ticket, MessageSquare, Send,
} from 'lucide-react';
import { cn }          from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';

type NavItem   = { href: string; label: string; icon: React.ElementType; permiso?: string | null };
type NavGroup  = { id: string; label: string; icon: React.ElementType; items: NavItem[] };
type NavSingle = NavItem & { id: string };
type NavEntry  = NavSingle | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => 'items' in e;

const NAV: NavEntry[] = [
  { id: 'dashboard', href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permiso: null },
  {
    id: 'red', label: 'Gestión de Red', icon: Network,
    items: [
      { href: '/red/routers',    label: 'Routers',    icon: Router,   permiso: 'mikrotik:view'   },
      { href: '/red/vpn',        label: 'OpenVPN',    icon: Shield,   permiso: 'mikrotik:manage' },
      { href: '/red/olt',        label: 'OLT',        icon: Server,   permiso: 'mikrotik:view'   },
      { href: '/red/redes-ipv4', label: 'Redes IPv4', icon: Globe,    permiso: 'mikrotik:view'   },
      { href: '/monitoreo',      label: 'Monitoreo',  icon: Activity, permiso: 'monitoreo:view'  },
      { href: '/red/cajas-nap',  label: 'Cajas Nap',  icon: Box,      permiso: 'mikrotik:view'   },
      { href: '/red/mapa',       label: 'Mapa',       icon: MapPin,   permiso: 'mikrotik:view'   },
    ],
  },
  {
    id: 'servicios', label: 'Servicios', icon: Package,
    items: [
      { href: '/servicios/internet',       label: 'Internet',       icon: Wifi,   permiso: null },
      { href: '/servicios/personalizados', label: 'Personalizados', icon: Wrench, permiso: null },
    ],
  },
  {
    id: 'clientes', label: 'Clientes', icon: Users,
    items: [
      { href: '/clientes',               label: 'Usuarios',      icon: Users,  permiso: 'clientes:view' },
      { href: '/clientes/mapa',          label: 'Mapa Clientes', icon: MapPin, permiso: 'clientes:view' },
      { href: '/clientes/instalaciones', label: 'Instalaciones', icon: Wrench, permiso: 'clientes:view' },
    ],
  },
  {
    id: 'finanzas', label: 'Finanzas', icon: DollarSign,
    items: [
      { href: '/facturacion',       label: 'Facturas',           icon: Receipt,    permiso: 'facturacion:view' },
      { href: '/finanzas/registro', label: 'Registro de Pagos',  icon: DollarSign, permiso: 'pagos:view'       },
      { href: '/pagos',             label: 'Transacciones',      icon: TrendingUp, permiso: 'pagos:view'       },
      { href: '/reportes',          label: 'Reporte Financiero', icon: BarChart2,  permiso: 'reportes:view'    },
    ],
  },
  {
    id: 'tickets', label: 'Ticket', icon: Ticket,
    items: [
      { href: '/tickets/nuevos',      label: 'Nuevos',      icon: Ticket, permiso: null },
      { href: '/tickets/contestados', label: 'Contestados', icon: Ticket, permiso: null },
      { href: '/tickets/cerrados',    label: 'Cerrados',    icon: Ticket, permiso: null },
    ],
  },
  {
    id: 'mensajeria', label: 'Mensajería', icon: MessageSquare,
    items: [
      { href: '/mensajeria/enviados', label: 'Mensajes Enviados', icon: Send, permiso: null },
    ],
  },
  { id: 'ajustes', href: '/configuracion', label: 'Ajustes', icon: Settings, permiso: 'sistema:config' },
];

export function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname     = usePathname();
  const tienePermiso = useAuthStore((s) => s.tienePermiso);
  const usuario      = useAuthStore((s) => s.usuario);
  const [open, setOpen] = useState<string[]>([]);

  useEffect(() => {
    onClose();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    NAV.forEach((entry) => {
      if (!isGroup(entry)) return;
      const hasActive = entry.items.some((item) =>
        item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href),
      );
      if (hasActive) setOpen((prev) => prev.includes(entry.id) ? prev : [...prev, entry.id]);
    });
  }, [pathname]);

  const toggle = (id: string) =>
    setOpen((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  return (
    <aside className={cn('sidebar flex flex-col flex-shrink-0', isOpen && 'sidebar-open')}>
      <div className="flex items-center gap-3 px-4 py-4 border-b border-[hsl(var(--sidebar-border))]">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/20">
          <Wifi className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="font-bold text-white text-sm leading-tight">DATAFAST</p>
          <p className="text-[10px] text-[hsl(var(--sidebar-fg)/0.5)]">ISP Manager</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV.map((entry) => {
          if (!isGroup(entry)) {
            const perm = (entry as NavSingle).permiso;
            if (perm && !tienePermiso(perm)) return null;
            return (
              <Link key={entry.id} href={(entry as NavSingle).href}>
                <div className={cn('sidebar-nav-item', isActive((entry as NavSingle).href) && 'active')}>
                  <entry.icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1">{entry.label}</span>
                </div>
              </Link>
            );
          }

          const visibles = entry.items.filter((item) => !item.permiso || tienePermiso(item.permiso));
          if (!visibles.length) return null;

          const groupActive = visibles.some((item) => isActive(item.href));
          const isOpen      = open.includes(entry.id);

          return (
            <div key={entry.id}>
              <button
                onClick={() => toggle(entry.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors text-left',
                  groupActive
                    ? 'text-white bg-white/5'
                    : 'text-[hsl(var(--sidebar-fg)/0.7)] hover:text-white hover:bg-[hsl(var(--sidebar-hover))]',
                )}
              >
                <entry.icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{entry.label}</span>
                <ChevronDown className={cn(
                  'w-3.5 h-3.5 transition-transform duration-200',
                  isOpen && 'rotate-180',
                )} />
              </button>

              {isOpen && (
                <div className="ml-3 mt-0.5 pl-3 border-l border-white/10 space-y-0.5 mb-1">
                  {visibles.map((item) => (
                    <Link key={item.href} href={item.href}>
                      <div className={cn(
                        'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors cursor-pointer',
                        isActive(item.href)
                          ? 'bg-primary/15 text-primary font-medium'
                          : 'text-[hsl(var(--sidebar-fg)/0.6)] hover:text-white hover:bg-[hsl(var(--sidebar-hover))]',
                      )}>
                        <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
                        {item.label}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {usuario && (
        <div className="px-3 py-3 border-t border-[hsl(var(--sidebar-border))]">
          <Link href="/configuracion">
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[hsl(var(--sidebar-hover))] transition-colors cursor-pointer">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
                {usuario.nombreCompleto[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">{usuario.nombreCompleto}</p>
                <p className="text-[10px] text-[hsl(var(--sidebar-fg)/0.5)] truncate">{usuario.roles[0]}</p>
              </div>
            </div>
          </Link>
        </div>
      )}
    </aside>
  );
}
