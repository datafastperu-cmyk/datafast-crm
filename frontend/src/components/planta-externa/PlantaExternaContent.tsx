'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Layers, Cable, GitMerge, Box } from 'lucide-react';

import { SitesContent } from '@/components/red/SitesContent';
import { CajasNapTab } from './CajasNapTab';
import { MufasTab } from './MufasTab';
import { FibraTab } from './FibraTab';
import { ScrollableTabs } from '@/components/ui/ScrollableTabs';
import { cn } from '@/lib/utils';

/**
 * Sección única de infraestructura física de red.
 *
 * Los cinco elementos (site → fibra → mufa → fibra → NAP → cliente) son UN SOLO GRAFO
 * continuo. Tenerlos como ítems sueltos del menú obligaba al operador a saltar entre
 * pantallas para documentar una misma cosa física, recordando de memoria con qué segmento
 * venía.
 *
 * Se llama "Planta Externa" y no "Red GPON" a propósito: absorbe Sites, que NO es una
 * entidad GPON — un Site agrupa Router + VPN + OLT y existe igual en una instalación WISP
 * sin una sola fibra. El mismo binario se instala en operadores que no tienen GPON, y ahí
 * "Red GPON" sería un nombre que miente sobre lo que contiene.
 *
 * El VISOR cartográfico vive aparte, en `/red/mapa`: es otro trabajo (consulta de campo y
 * soporte, no carga de datos) y abarca capas que no son planta externa — clientes, routers,
 * OLTs. Lo que NO puede haber es dos componentes de mapa; cuando se construya, será uno.
 */
const TABS = [
  { key: 'sites',  label: 'Sites',      icon: Layers,   desc: 'Cabeceras de red' },
  { key: 'fibra',  label: 'Fibra',      icon: Cable,    desc: 'Tendidos e hilos' },
  { key: 'mufas',  label: 'Mufas',      icon: GitMerge, desc: 'Empalmes y splitters' },
  { key: 'naps',   label: 'Cajas NAP',  icon: Box,      desc: 'Puntos de acceso' },
] as const;

type TabKey = typeof TABS[number]['key'];

export function PlantaExternaContent() {
  const router = useRouter();
  const params = useSearchParams();

  // La pestaña vive en la URL, no en estado local: así un enlace a "las mufas de la zona
  // norte" es compartible y el botón atrás del navegador hace lo que el operador espera.
  const activa = (params.get('tab') as TabKey) ?? 'sites';
  const tabValida = TABS.some((t) => t.key === activa) ? activa : 'sites';

  const cambiar = (key: TabKey) => {
    const q = new URLSearchParams(Array.from(params.entries()));
    q.set('tab', key);
    router.replace(`/red/planta-externa?${q.toString()}`, { scroll: false });
  };

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Planta Externa</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Infraestructura física de la red: cabeceras, fibra, empalmes y puntos de acceso
        </p>
      </div>

      <ScrollableTabs className="flex items-center gap-0.5 border-b border-border">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tabValida === key;
          return (
            <button
              key={key}
              onClick={() => cambiar(key)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-3 text-xs font-medium whitespace-nowrap',
                'border-b-2 transition-all duration-150',
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </ScrollableTabs>

      {tabValida === 'sites' && <SitesContent />}
      {tabValida === 'fibra' && <FibraTab />}
      {tabValida === 'mufas' && <MufasTab />}
      {tabValida === 'naps'  && <CajasNapTab />}
    </div>
  );
}
