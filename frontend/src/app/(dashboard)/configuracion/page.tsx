import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight,
  Building2, Users, Mail, Receipt, FileCheck, CreditCard,
  FileEdit, Globe, Upload, ArrowUpDown, Layout, MapPin,
  SlidersHorizontal, HardDrive, Clock,
  Terminal, Monitor, Server, Key, Plug, Cpu,
} from 'lucide-react';

export const metadata: Metadata = { title: 'Ajustes' };

const CATEGORIES = [
  {
    label: 'Organización',
    iconBg: 'bg-blue-100 dark:bg-blue-950/60',
    iconColor: 'text-blue-600 dark:text-blue-400',
    items: [
      { href: '/configuracion/empresa',  label: 'Empresa',             icon: Building2, desc: 'Datos de la empresa, dominio y logotipo' },
      { href: '/configuracion/personal', label: 'Gestión de Personal', icon: Users,     desc: 'Usuarios, roles y permisos del sistema' },
    ],
  },
  {
    label: 'Facturación',
    iconBg: 'bg-amber-100 dark:bg-amber-950/60',
    iconColor: 'text-amber-600 dark:text-amber-400',
    items: [
      { href: '/configuracion/facturacion-config',      label: 'Facturación',             icon: Receipt,   desc: 'Comprobantes, moneda, IGV y formas de pago' },
      { href: '/configuracion/facturacion-electronica', label: 'Facturación Electrónica', icon: FileCheck, desc: 'Integración con SUNAT y emisión electrónica' },
      { href: '/configuracion/pasarela-pagos',          label: 'Pasarela de Pagos',       icon: CreditCard,desc: 'Pagos en línea y recaudación automática' },
      { href: '/configuracion/plantillas',              label: 'Plantilla de Documentos', icon: FileEdit,  desc: 'Diseño de facturas y documentos PDF' },
    ],
  },
  {
    label: 'Abonados',
    iconBg: 'bg-violet-100 dark:bg-violet-950/60',
    iconColor: 'text-violet-600 dark:text-violet-400',
    items: [
      { href: '/configuracion/portal-cliente',        label: 'Portal Cliente',         icon: Globe,            desc: 'Acceso web y app móvil del abonado' },
      { href: '/configuracion/importar-clientes',     label: 'Importar Clientes',      icon: Upload,           desc: 'Carga masiva desde archivo Excel o CSV' },
      { href: '/configuracion/cambios-masivos',       label: 'Cambios Masivos',        icon: ArrowUpDown,      desc: 'Operaciones en lote sobre múltiples registros' },
      { href: '/configuracion/plantillas-config',     label: 'Plantillas de Contrato', icon: Layout,           desc: 'Configuración de plantillas de contratos' },
      { href: '/configuracion/ubicaciones',           label: 'Zonas',                  icon: MapPin,           desc: 'Sectores y áreas de cobertura del servicio' },
      { href: '/configuracion/campos-personalizados', label: 'Campos Personalizados',  icon: SlidersHorizontal,desc: 'Atributos adicionales para clientes y contratos' },
    ],
  },
  {
    label: 'Red y Equipos',
    iconBg: 'bg-cyan-100 dark:bg-cyan-950/60',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    items: [
      { href: '/configuracion/integraciones', label: 'Integraciones',     icon: Plug, desc: 'Google, MikroTik, OLT y pasarelas de pago' },
      { href: '/red/olt',                     label: 'Gestión de OLTs',   icon: Cpu,  desc: 'Unificada en Red → OLT / GPON' },
    ],
  },
  {
    label: 'Sistema',
    iconBg: 'bg-rose-100 dark:bg-rose-950/60',
    iconColor: 'text-rose-600 dark:text-rose-400',
    items: [
      { href: '/configuracion/correo',   label: 'Servidor de Correo', icon: Mail,     desc: 'Configuración SMTP para envío de emails' },
      { href: '/configuracion/backup',   label: 'Copia de Seguridad', icon: HardDrive,desc: 'Respaldo y restauración de la base de datos' },
      { href: '/configuracion/crontab',  label: 'Crontab',            icon: Clock,    desc: 'Tareas programadas del sistema' },
      { href: '/configuracion/log',      label: 'Log',                icon: Terminal, desc: 'Registro de eventos y errores del sistema' },
      { href: '/configuracion/sistema',  label: 'Sistema',            icon: Monitor,  desc: 'Estado y rendimiento del servidor' },
      { href: '/configuracion/servidor', label: 'Servidor',           icon: Server,   desc: 'Configuración del servidor y red' },
      { href: '/configuracion/licencia', label: 'Licencia',           icon: Key,      desc: 'Activación y estado de la licencia' },
    ],
  },
];

export default function ConfiguracionPage() {
  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Ajustes</h2>
        <p className="text-sm text-muted-foreground">Configura el sistema según tus necesidades.</p>
      </div>
      <div className="space-y-6">
        {CATEGORIES.map(({ label, iconBg, iconColor, items }) => (
          <div key={label}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">{label}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {items.map(({ href, label: itemLabel, icon: Icon, desc }) => (
                <Link key={href} href={href}>
                  <div className="flex items-center gap-4 px-4 py-3.5 rounded-xl border border-border bg-card
                                  hover:bg-primary/5 hover:border-primary/30 transition-colors group">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${iconBg} group-hover:bg-primary/15`}>
                      <Icon className={`w-5 h-5 transition-colors ${iconColor} group-hover:text-primary`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{itemLabel}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
