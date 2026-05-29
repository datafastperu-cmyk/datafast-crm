import type { Metadata } from 'next';
import Link from 'next/link';
import { Plug, ChevronRight } from 'lucide-react';

export const metadata: Metadata = { title: 'Integraciones' };

const INTEGRATIONS = [
  {
    id:       'google',
    name:     'Google Workspace',
    description: 'Calendar, Contacts, Drive y Maps',
    href:     '/configuracion/integraciones/google',
    badge:    'Disponible',
    badgeCls: 'bg-emerald-500/10 text-emerald-500',
    logo:     'G',
    logoCls:  'bg-blue-500/10 text-blue-600',
  },
  {
    id:       'mensajeria',
    name:     'Pasarela de Mensajería',
    description: 'WhatsApp, AUTOMATIZADO.VIP, Twilio, Vonage y API personalizada',
    href:     '/configuracion/integraciones/whatsapp-business',
    badge:    'Configurar',
    badgeCls: 'bg-violet-500/10 text-violet-500',
    logo:     'M',
    logoCls:  'bg-violet-500/10 text-violet-500',
  },
  {
    id:       'mikrotik',
    name:     'MikroTik RouterOS',
    description: 'Gestión de routers y PPPoE',
    href:     '/red/routers',
    badge:    'Configurar',
    badgeCls: 'bg-blue-500/10 text-blue-500',
    logo:     'M',
    logoCls:  'bg-blue-500/10 text-blue-500',
  },
  {
    id:       'smartolt',
    name:     'SmartOLT',
    description: 'Gestión de OLTs y ONUs FTTH',
    href:     '/configuracion/servidor',
    badge:    'Configurar',
    badgeCls: 'bg-purple-500/10 text-purple-500',
    logo:     'S',
    logoCls:  'bg-purple-500/10 text-purple-500',
  },
  {
    id:       'mercadopago',
    name:     'MercadoPago',
    description: 'Pasarela de pagos en línea',
    href:     '/configuracion/pasarela-pagos',
    badge:    'Configurar',
    badgeCls: 'bg-sky-500/10 text-sky-500',
    logo:     'MP',
    logoCls:  'bg-sky-500/10 text-sky-500',
  },
];

export default function IntegracionesPage() {
  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Plug className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Integraciones</h1>
          <p className="text-xs text-muted-foreground">Conecta servicios externos con tu CRM</p>
        </div>
      </div>

      <div className="grid gap-3">
        {INTEGRATIONS.map((integ) => (
          <Link
            key={integ.id}
            href={integ.href}
            className="group flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-accent/30 transition-colors"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${integ.logoCls}`}>
              {integ.logo}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{integ.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${integ.badgeCls}`}>
                  {integ.badge}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{integ.description}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
