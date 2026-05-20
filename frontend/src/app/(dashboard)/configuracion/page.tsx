import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Settings, Users, Mail, Receipt, FileCheck, CreditCard,
  FileEdit, Globe, Upload, ArrowUpDown, Layout, MapPin,
  SlidersHorizontal, MessageSquare, HardDrive, Clock,
  Terminal, Monitor, Server, Key, Plug,
} from 'lucide-react';

export const metadata: Metadata = { title: 'Ajustes' };

const SECTIONS = [
  { href: '/configuracion/general',                label: 'General',                  icon: Settings },
  { href: '/configuracion/personal',               label: 'Gestión de Personal',      icon: Users },
  { href: '/configuracion/correo',                 label: 'Servidor de Correo',       icon: Mail },
  { href: '/configuracion/facturacion-config',     label: 'Facturación',              icon: Receipt },
  { href: '/configuracion/facturacion-electronica',label: 'Facturación Electrónica',  icon: FileCheck },
  { href: '/configuracion/pasarela-pagos',         label: 'Pasarela de Pagos',        icon: CreditCard },
  { href: '/configuracion/plantillas',             label: 'Editar Plantilla',         icon: FileEdit },
  { href: '/configuracion/portal-cliente',         label: 'Portal Cliente',           icon: Globe },
  { href: '/configuracion/importar-clientes',      label: 'Importar Clientes',        icon: Upload },
  { href: '/configuracion/cambios-masivos',        label: 'Cambios Masivos',          icon: ArrowUpDown },
  { href: '/configuracion/plantillas-config',      label: 'Plantillas Abonados',      icon: Layout },
  { href: '/configuracion/ubicaciones',            label: 'Zonas',                    icon: MapPin },
  { href: '/configuracion/campos-personalizados',  label: 'Campos Personalizados',    icon: SlidersHorizontal },
  { href: '/configuracion/mensajeria-config',      label: 'Mensajería',               icon: MessageSquare },
  { href: '/configuracion/backup',                 label: 'Copia de Seguridad',       icon: HardDrive },
  { href: '/configuracion/crontab',                label: 'Crontab',                  icon: Clock },
  { href: '/configuracion/log',                    label: 'Log',                      icon: Terminal },
  { href: '/configuracion/sistema',                label: 'Sistema',                  icon: Monitor },
  { href: '/configuracion/servidor',               label: 'Servidor',                 icon: Server },
  { href: '/configuracion/licencia',               label: 'Licencia',                 icon: Key },
  { href: '/configuracion/integraciones',          label: 'Integraciones',            icon: Plug },
];

export default function ConfiguracionPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Ajustes</h2>
        <p className="text-sm text-muted-foreground">Configura el sistema según tus necesidades.</p>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
        {SECTIONS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}>
            <div className="flex flex-col items-center gap-3 p-4 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer group">
              <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                <Icon className="w-11 h-11 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <span className="text-xs text-center text-muted-foreground group-hover:text-foreground leading-tight">
                {label}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
