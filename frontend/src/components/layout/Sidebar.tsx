'use client';

import { useState, useEffect } from 'react';
import Link            from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Wifi, Activity, Settings, BarChart2,
  ChevronDown, Router, Shield, Network, Server, Globe, Box,
  Package, MapPin, Wrench, DollarSign, Receipt, TrendingUp,
  Ticket, MessageSquare, Send, HardDrive,
  UserCheck, Zap,
  List, Tv, Scissors, Layers,
  ChevronRight, Gift, Trophy, Settings2,
  Megaphone, FileText, History,
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
      { href: '/red/routers',    label: 'Routers MikroTik', icon: Router,   permiso: 'mikrotik:view'   },
      { href: '/red/vpn',        label: 'OpenVPN',          icon: Shield,   permiso: 'mikrotik:manage' },
      { href: '/red/olt',        label: 'OLT / GPON',       icon: Server,   permiso: 'mikrotik:view'   },
      { href: '/red/redes-ipv4', label: 'Redes IPv4',       icon: Globe,    permiso: 'mikrotik:view'   },
      { href: '/red/pppoe',      label: 'Sesiones PPPoE',   icon: Zap,      permiso: 'mikrotik:view'   },
      { href: '/red/dhcp',       label: 'DHCP Leases',      icon: Layers,   permiso: 'mikrotik:view'   },
      { href: '/red/colas',      label: 'Colas / QoS',      icon: List,     permiso: 'mikrotik:view'   },
      { href: '/red/cajas-nap',  label: 'Cajas NAP',        icon: Box,      permiso: 'mikrotik:view'   },
      { href: '/red/mapa',       label: 'Mapa de Red',      icon: MapPin,   permiso: 'mikrotik:view'   },
    ],
  },

  {
    id: 'monitoreo', label: 'Monitoreo', icon: Activity,
    items: [
      { href: '/monitoreo',              label: 'Tiempo Real',  icon: Activity, permiso: 'monitoreo:view' },
      { href: '/monitoreo/alertas',      label: 'Alertas',      icon: Zap,      permiso: 'monitoreo:view' },
      { href: '/monitoreo/configuracion',label: 'Umbrales',     icon: Settings, permiso: 'monitoreo:view' },
    ],
  },

  {
    id: 'servicios', label: 'Servicios', icon: Package,
    items: [
      { href: '/servicios/internet',       label: 'Planes Internet',    icon: Wifi,   permiso: null },
      { href: '/servicios/personalizados', label: 'Serv. Personalizados',icon: Wrench, permiso: null },
      { href: '/iptv',                     label: 'IPTV / Streaming',   icon: Tv,     permiso: null },
    ],
  },

  {
    id: 'clientes', label: 'Abonados', icon: Users,
    items: [
      { href: '/clientes',               label: 'Abonados',      icon: Users,     permiso: 'clientes:view' },
      { href: '/clientes/mapa',          label: 'Mapa',          icon: MapPin,    permiso: 'clientes:view' },
      { href: '/clientes/instalaciones', label: 'Instalaciones', icon: Wrench,    permiso: 'clientes:view' },
      { href: '/tecnicos',               label: 'Técnicos',      icon: UserCheck, permiso: null            },
    ],
  },

  {
    id: 'finanzas', label: 'Finanzas', icon: DollarSign,
    items: [
      { href: '/facturacion',       label: 'Facturas',          icon: Receipt,    permiso: 'facturacion:view' },
      { href: '/finanzas/registro', label: 'Registrar Pago',    icon: DollarSign, permiso: 'pagos:view'       },
      { href: '/pagos',             label: 'Transacciones',     icon: TrendingUp, permiso: 'pagos:view'       },
      { href: '/caja',              label: 'Caja del Día',      icon: HardDrive,  permiso: 'pagos:view'       },
      { href: '/cortes',            label: 'Cortes Automáticos',icon: Scissors,   permiso: 'pagos:view'       },
      { href: '/reportes',          label: 'Reportes',          icon: BarChart2,  permiso: 'reportes:view'    },
    ],
  },

  {
    id: 'inventario', label: 'Inventario', icon: Package,
    items: [
      { href: '/inventario', label: 'Stock de Equipos', icon: Package, permiso: null },
    ],
  },

  {
    id: 'tickets', label: 'Soporte', icon: Ticket,
    items: [
      { href: '/tickets/nuevos',      label: 'Nuevos',      icon: Ticket, permiso: null },
      { href: '/tickets/contestados', label: 'En Progreso', icon: Ticket, permiso: null },
      { href: '/tickets/cerrados',    label: 'Cerrados',    icon: Ticket, permiso: null },
    ],
  },

  {
    id: 'mensajeria', label: 'Mensajería', icon: MessageSquare,
    items: [
      { href: '/mensajeria/enviados',   label: 'Mensajes Enviados', icon: Send,          permiso: null },
      { href: '/mensajeria/whatsapp',   label: 'WhatsApp Bot',      icon: MessageSquare, permiso: null },
      { href: '/mensajeria/campanas',   label: 'Campañas',          icon: Megaphone,     permiso: null },
      { href: '/mensajeria/plantillas', label: 'Plantillas',        icon: FileText,      permiso: null },
      { href: '/mensajeria/historial',  label: 'Historial',         icon: History,       permiso: null },
    ],
  },

  {
    id: 'lealtad', label: 'Lealtad', icon: Gift,
    items: [
      { href: '/lealtad/premios',        label: 'Premios',       icon: Trophy,    permiso: null },
      { href: '/lealtad/configuracion',  label: 'Configuración', icon: Settings2, permiso: null },
    ],
  },

  { id: 'ajustes', href: '/configuracion',  label: 'Configuración',    icon: Settings, permiso: 'sistema:config' },
];

interface SidebarProps {
  isOpen:    boolean;
  onClose:   () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ isOpen, onClose, collapsed = false, onToggleCollapse }: SidebarProps) {
  const pathname     = usePathname();
  const tienePermiso = useAuthStore((s) => s.tienePermiso);
  const usuario      = useAuthStore((s) => s.usuario);
  const [open, setOpen] = useState<string[]>([]);

  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line

  useEffect(() => {
    if (collapsed) return;
    NAV.forEach((entry) => {
      if (!isGroup(entry)) return;
      const hasActive = entry.items.some((item) =>
        item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href),
      );
      if (hasActive) setOpen([entry.id]);
    });
  }, [pathname, collapsed]);

  const toggle = (id: string) =>
    setOpen((prev) => prev.includes(id) ? [] : [id]);

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  const w = collapsed ? 64 : 248;

  return (
    <aside
      style={{ width: w }}
      className={cn(
        'flex flex-col flex-shrink-0 h-full transition-all duration-300 ease-in-out overflow-hidden',
        'bg-[hsl(var(--sidebar-bg))] text-[hsl(var(--sidebar-fg))]',
        'border-r border-[hsl(var(--sidebar-border))]',
        'fixed inset-y-0 left-0 z-50',
        'lg:static lg:translate-x-0',
        isOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center border-b border-[hsl(var(--sidebar-border))]',
        collapsed ? 'justify-center px-0 py-4' : 'gap-3 px-4 py-4',
      )}>
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/20 flex-shrink-0">
          <Wifi className="w-4.5 h-4.5 text-primary" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-bold text-white text-sm leading-tight tracking-wide">DATAFAST</p>
            <p className="text-[10px] text-[hsl(var(--sidebar-fg)/0.4)] tracking-widest uppercase">ISP Manager</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5 overflow-x-hidden">
        {NAV.map((entry) => {

          /* ── Single item ── */
          if (!isGroup(entry)) {
            const nav = entry as NavSingle;
            if (nav.permiso && !tienePermiso(nav.permiso)) return null;
            return (
              <Link key={nav.id} href={nav.href} title={collapsed ? nav.label : undefined}>
                <div className={cn('sidebar-nav-item', isActive(nav.href) && 'active', collapsed && 'justify-center px-0')}>
                  <nav.icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span className="flex-1 truncate">{nav.label}</span>}
                </div>
              </Link>
            );
          }

          /* ── Group ── */
          const visibles = entry.items.filter((item) => !item.permiso || tienePermiso(item.permiso));
          if (!visibles.length) return null;
          const groupActive = visibles.some((item) => isActive(item.href));
          const isExpanded  = open.includes(entry.id);

          if (collapsed) {
            return (
              <div key={entry.id} className="relative group">
                <div className={cn(
                  'flex items-center justify-center w-full py-2 rounded-lg cursor-pointer transition-colors',
                  groupActive
                    ? 'bg-white/5 text-white'
                    : 'text-[hsl(var(--sidebar-fg)/0.7)] hover:text-white hover:bg-[hsl(var(--sidebar-hover))]',
                )} title={entry.label}>
                  <entry.icon className="w-4 h-4" />
                </div>
              </div>
            );
          }

          return (
            <div key={entry.id}>
              <button
                onClick={() => toggle(entry.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 text-left',
                  groupActive
                    ? 'text-white bg-white/5'
                    : 'text-[hsl(var(--sidebar-fg)/0.7)] hover:text-white hover:bg-[hsl(var(--sidebar-hover))]',
                )}
              >
                <entry.icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 truncate">{entry.label}</span>
                <ChevronDown className={cn(
                  'w-3.5 h-3.5 opacity-60 transition-transform duration-200 flex-shrink-0',
                  isExpanded && 'rotate-180',
                )} />
              </button>

              {isExpanded && (
                <div className="ml-3 mt-0.5 pl-3 border-l border-white/8 space-y-0.5 mb-1">
                  {visibles.map((item) => (
                    <Link key={item.href} href={item.href}>
                      <div className={cn(
                        'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-all duration-150 cursor-pointer',
                        isActive(item.href)
                          ? 'bg-primary/12 text-primary font-medium'
                          : 'text-[hsl(var(--sidebar-fg)/0.6)] hover:text-white hover:bg-[hsl(var(--sidebar-hover))]',
                      )}>
                        <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      {usuario && !collapsed && (
        <div className="px-3 py-3 border-t border-[hsl(var(--sidebar-border))]">
          <Link href="/configuracion">
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[hsl(var(--sidebar-hover))] transition-colors cursor-pointer">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
                {usuario.nombreCompleto[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">{usuario.nombreCompleto}</p>
                <p className="text-[10px] text-[hsl(var(--sidebar-fg)/0.45)] truncate">{usuario.roles[0]}</p>
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* Collapse toggle (desktop only) */}
      {onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          className={cn(
            'hidden lg:flex items-center justify-center w-full py-2.5 text-[hsl(var(--sidebar-fg)/0.4)]',
            'hover:text-white hover:bg-[hsl(var(--sidebar-hover))] transition-colors',
            'border-t border-[hsl(var(--sidebar-border))]',
          )}
          title={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
        >
          <ChevronRight className={cn('w-4 h-4 transition-transform duration-300', !collapsed && 'rotate-180')} />
        </button>
      )}
    </aside>
  );
}
