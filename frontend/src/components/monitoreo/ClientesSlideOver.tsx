'use client';

import { useEffect }   from 'react';
import { useQuery }    from '@tanstack/react-query';
import { X, Wifi, RefreshCw, Users } from 'lucide-react';

import { dispositivosApi } from '@/lib/api/monitoreo';
import { cn }              from '@/lib/utils';
import { Portal }          from '@/components/ui/portal';

interface WirelessClient {
  mac:          string;
  interfaz:     string;
  signalDbm:    number;
  txCcq:        number;
  rxCcq:        number;
  txRate:       string;
  rxRate:       string;
  uptime:       string;
  lastActivity: string;
  comment:      string;
}

interface Props {
  dispositivoId: string;
  nombreEmisor:  string;
  isOpen:        boolean;
  onClose:       () => void;
}

function SignalDot({ dbm }: { dbm: number }) {
  const color = dbm >= -65 ? 'bg-emerald-400' : dbm >= -80 ? 'bg-amber-400' : 'bg-red-400';
  return <span className={cn('inline-block h-2 w-2 rounded-full', color)} />;
}

export function ClientesSlideOver({ dispositivoId, nombreEmisor, isOpen, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const { data, isLoading, isFetching, refetch, error } = useQuery<WirelessClient[]>({
    queryKey:  ['monitoreo', 'clientes', dispositivoId],
    queryFn:   () => dispositivosApi.getClientesConectados(dispositivoId),
    enabled:   isOpen,
    refetchInterval: 20_000,
    staleTime: 15_000,
  });

  const clientes = data ?? [];

  if (!isOpen) return null;

  return (
    <Portal>
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-[100]" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-card border-l border-border z-[101] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Wifi className="h-4 w-4 text-blue-500 dark:text-blue-400" />
            <div>
              <p className="text-sm font-semibold text-foreground">{nombreEmisor}</p>
              <p className="text-xs text-muted-foreground">Clientes inalámbricos conectados</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              Consultando AP...
            </div>
          ) : error ? (
            <div className="m-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-sm">
              {(error as Error).message ?? 'Error al obtener clientes'}
            </div>
          ) : clientes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Users className="h-8 w-8 mb-2 text-muted-foreground/40" />
              <p className="text-sm">Sin clientes conectados</p>
            </div>
          ) : (
            <div>
              <div className="px-5 py-3 text-xs text-muted-foreground font-medium border-b border-border/50">
                {clientes.length} cliente{clientes.length !== 1 ? 's' : ''} conectado{clientes.length !== 1 ? 's' : ''}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    {['MAC', 'Comentario', 'Señal', 'TX/RX CCQ', 'TX/RX Rate', 'Uptime'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {clientes.map(c => (
                    <tr key={c.mac} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-foreground">{c.mac}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-foreground/80 max-w-[160px]">
                        {c.comment ? (
                          <span className="truncate block" title={c.comment}>{c.comment}</span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <SignalDot dbm={c.signalDbm} />
                          <span className={cn(
                            'text-xs font-medium',
                            c.signalDbm >= -65 ? 'text-emerald-600 dark:text-emerald-400' : c.signalDbm >= -80 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                          )}>
                            {c.signalDbm} dBm
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-foreground/80 whitespace-nowrap">{c.txCcq}/{c.rxCcq}%</td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs text-foreground/80">{c.txRate}</div>
                        <div className="text-xs text-muted-foreground">{c.rxRate}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.uptime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
    </Portal>
  );
}
