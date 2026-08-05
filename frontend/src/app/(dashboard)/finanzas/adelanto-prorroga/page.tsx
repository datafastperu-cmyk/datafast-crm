'use client';

import { useState } from 'react';
import { CalendarDays, Wallet } from 'lucide-react';

import { TabPromesas }  from '@/components/finanzas/TabPromesas';
import { TabAdelantos } from '@/components/finanzas/TabAdelantos';
import { cn } from '@/lib/utils';

/**
 * Adelantos y prórrogas: los dos compromisos que alteran el ciclo normal de cobro.
 *
 * Comparten pantalla porque el operador los consulta juntos, pero NO comparten modelo: una
 * prórroga es una promesa (no hay dinero de por medio y cancelarla no cuesta nada); un
 * adelanto es dinero ya cobrado, y deshacerlo significa devolverlo.
 */
export default function AdelantoProrrogaPage() {
  const [tab, setTab] = useState<'prorrogas' | 'adelantos'>('prorrogas');

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-x-auto">
        <TabBtn active={tab === 'prorrogas'} onClick={() => setTab('prorrogas')}>
          <CalendarDays className="w-4 h-4" />
          Prórrogas
        </TabBtn>
        <TabBtn active={tab === 'adelantos'} onClick={() => setTab('adelantos')}>
          <Wallet className="w-4 h-4" />
          Adelantos
        </TabBtn>
      </div>

      <div className="flex-1 bg-gray-50 dark:bg-gray-950">
        {tab === 'prorrogas' && <TabPromesas />}
        {tab === 'adelantos' && <TabAdelantos />}
      </div>
    </div>
  );
}

function TabBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
        active
          ? 'border-blue-500 text-blue-600 dark:text-blue-400'
          : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
      )}
    >
      {children}
    </button>
  );
}
