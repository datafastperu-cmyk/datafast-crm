import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight,
  Building2, Users, Mail, Receipt, FileCheck, CreditCard,
  FileEdit, Globe, Upload, ArrowUpDown, Layout, MapPin,
  SlidersHorizontal, HardDrive, Clock,
  Terminal, Monitor, Server, Key, Plug, Cpu,
} from 'lucide-react';

export const metadata: Metadata = { title: 'Ajustes' };

const SECTIONS = [
  { href: '/configuracion/empresa',                label: 'Empresa',                  icon: Building2,        desc: 'Datos de la empresa, dominio y logotipo' },
  { href: '/configuracion/personal',               label: 'Gestión de Personal',      icon: Users,            desc: 'Usuarios, roles y permisos del sistema' },
  { href: '/configuracion/correo',                 label: 'Servidor de Correo',       icon: Mail,             desc: 'Configuración SMTP para envío de emails' },
  { href: '/configuracion/facturacion-config',     label: 'Facturación',              icon: Receipt,          desc: 'Comprobantes, moneda, IGV y formas de pago' },
  { href: '/configuracion/facturacion-electronica',label: 'Facturación Electrónica',  icon: FileCheck,        desc: 'Integración con SUNAT y emisión electrónica' },
  { href: '/configuracion/pasarela-pagos',         label: 'Pasarela de Pagos',        icon: CreditCard,       desc: 'Pagos en línea y recaudación automática' },
  { href: '/configuracion/plantillas',             label: 'Editar Plantilla',         icon: FileEdit,         desc: 'Diseño de facturas y documentos PDF' },
  { href: '/configuracion/portal-cliente',         label: 'Portal Cliente',           icon: Globe,            desc: 'Acceso web y app móvil del abonado' },
  { href: '/configuracion/importar-clientes',      label: 'Importar Clientes',        icon: Upload,           desc: 'Carga masiva desde archivo Excel o CSV' },
  { href: '/configuracion/cambios-masivos',        label: 'Cambios Masivos',          icon: ArrowUpDown,      desc: 'Operaciones en lote sobre múltiples registros' },
  { href: '/configuracion/plantillas-config',      label: 'Plantillas Abonados',      icon: Layout,           desc: 'Configuración de plantillas de contratos' },
  { href: '/configuracion/ubicaciones',            label: 'Zonas',                    icon: MapPin,           desc: 'Sectores y áreas de cobertura del servicio' },
  { href: '/configuracion/campos-personalizados',  label: 'Campos Personalizados',    icon: SlidersHorizontal,desc: 'Atributos adicionales para clientes y contratos' },
  { href: '/configuracion/backup',                 label: 'Copia de Seguridad',       icon: HardDrive,        desc: 'Respaldo y restauración de la base de datos' },
  { href: '/configuracion/crontab',                label: 'Crontab',                  icon: Clock,            desc: 'Tareas programadas del sistema' },
  { href: '/configuracion/log',                    label: 'Log',                      icon: Terminal,         desc: 'Registro de eventos y errores del sistema' },
  { href: '/configuracion/sistema',                label: 'Sistema',                  icon: Monitor,          desc: 'Estado y rendimiento del servidor' },
  { href: '/configuracion/servidor',               label: 'Servidor',                 icon: Server,           desc: 'Configuración del servidor y red' },
  { href: '/configuracion/licencia',               label: 'Licencia',                 icon: Key,              desc: 'Activación y estado de la licencia' },
  { href: '/configuracion/integraciones',          label: 'Integraciones',            icon: Plug,             desc: 'Google, MikroTik, OLT y pasarelas de pago' },
  { href: '/configuracion/olts',                   label: 'Configuración OLT',        icon: Cpu,              desc: 'Gestión de OLTs y ONUs FTTH' },
];

export default function ConfiguracionPage() {
  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Ajustes</h2>
        <p className="text-sm text-muted-foreground">Configura el sistema según tus necesidades.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {SECTIONS.map(({ href, label, icon: Icon, desc }) => (
          <Link key={href} href={href}>
            <div className="flex items-center gap-4 px-4 py-3.5 rounded-xl border border-border bg-card
                            hover:bg-muted/40 transition-colors group">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0
                              group-hover:bg-primary/10 transition-colors">
                <Icon className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
