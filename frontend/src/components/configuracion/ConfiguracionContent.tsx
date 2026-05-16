'use client';

import { useState }       from 'react';
import { useQuery }       from '@tanstack/react-query';
import { Settings, Building2, Users, Server } from 'lucide-react';

import { EmpresaTab }   from './EmpresaTab';
import { UsuariosTab }  from './UsuariosTab';
import { PerfilTab }    from './PerfilTab';
import { ServidorTab }  from './ServidorTab';
import { cn }           from '@/lib/utils';

const TABS = [
  { key: 'empresa',   label: 'Empresa',    icon: Building2 },
  { key: 'usuarios',  label: 'Usuarios',   icon: Users },
  { key: 'perfil',    label: 'Mi Perfil',  icon: Settings },
  { key: 'servidor',  label: 'Servidor',   icon: Server },
] as const;

type TabKey = typeof TABS[number]['key'];

export function ConfiguracionContent() {
  const [tab, setTab] = useState<TabKey>('empresa');

  return (
    <div className="space-y-5 max-w-4xl">

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          Configuración del sistema
        </h2>
        <p className="text-sm text-muted-foreground">
          Administra la empresa, usuarios, planes y preferencias del sistema.
        </p>
      </div>

      {/* Tabs */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex border-b border-border overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                tab === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === 'empresa'   && <EmpresaTab />}
          {tab === 'usuarios'  && <UsuariosTab />}
          {tab === 'perfil'    && <PerfilTab />}
          {tab === 'servidor'  && <ServidorTab />}
        </div>
      </div>
    </div>
  );
}
