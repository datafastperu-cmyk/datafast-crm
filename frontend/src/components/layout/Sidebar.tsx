'use client';

import Link            from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, FileText, CreditCard,
  Wifi, Activity, Settings, BarChart2,
  ChevronRight, Router, Zap,
} from 'lucide-react';
import { cn }          from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';

const NAV_ITEMS = [
  {
    grupo: 'Principal',
    items: [
      { href: '/dashboard', label: 'Dashboard',  icon: LayoutDashboard, permiso: null },
      { href: '/monitoreo', label: 'Monitoreo',  icon: Activity,        permiso: 'monitoreo:view' },
    ],
  },
  {
    grupo: 'CRM',
    items: [
      { href: '/clientes',  label: 'Clientes',   icon: Users,     permiso: 'clientes:view' },
      { href: '/contratos', label: 'Contratos',  icon: FileText,  permiso: 'contratos:view' },
    ],
  },
  {
    grupo: 'Facturación',
    items: [
      { href: '/facturacion',      label: 'Facturas',       icon: FileText,   permiso: 'facturacion:view' },
      { href: '/pagos',            label: 'Pagos',          icon: CreditCard, permiso: 'pagos:view' },
      { href: '/pagos/pendientes', label: 'Por verificar',  icon: CreditCard, permiso: 'pagos:view' },
    ],
  },
  {
    grupo: 'Análisis',
    items: [
      { href: '/reportes', label: 'Reportes', icon: BarChart2, permiso: 'reportes:view' },
    ],
  },
  {
    grupo: 'Sistema',
    items: [
      { href: '/configuracion', label: 'Configuración', icon: Settings, permiso: 'sistema:config' },
    ],
  },
];

export function Sidebar() {
  const pathname     = usePathname();
  const tienePermiso = useAuthStore((s) => s.tienePermiso);
  const usuario      = useAuthStore((s) => s.usuario);

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  return (
    <aside className="sidebar flex flex-col h-full flex-shrink-0">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-[hsl(var(--sidebar-border))]">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/20">
          <Wifi className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="font-bold text-white text-sm leading-tight">FibraNet</p>
          <p className="text-[10px] text-[hsl(var(--sidebar-fg)/0.5)]">ISP Manager</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {NAV_ITEMS.map((grupo) => {
          const visibles = grupo.items.filter(
            (item) => !item.permiso || tienePermiso(item.permiso),
          );
          if (!visibles.length) return null;
          return (
            <div key={grupo.grupo}>
              <p className="text-[10px] font-semibold uppercase tracking-wider px-3 mb-1 text-[hsl(var(--sidebar-fg)/0.4)]">
                {grupo.grupo}
              </p>
              {visibles.map((item) => (
                <Link key={item.href} href={item.href}>
                  <div className={cn('sidebar-nav-item', isActive(item.href) && 'active')}>
                    <item.icon className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {isActive(item.href) && <ChevronRight className="w-3 h-3 opacity-60" />}
                  </div>
                </Link>
              ))}
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
