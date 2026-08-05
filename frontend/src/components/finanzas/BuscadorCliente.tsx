'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, X } from 'lucide-react';

import { clientesApi } from '@/lib/api/clientes';
import type { Cliente } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Búsqueda de abonado con desplegable de resultados.
 *
 * Tanto un adelanto como una prórroga se aplican a un cliente concreto, así que las dos
 * altas empiezan por lo mismo. Está extraído para que las dos pantallas busquen igual:
 * dos buscadores distintos acaban filtrando distinto y el operador no sabe cuál mira.
 */
export function BuscadorCliente({
  onSelect, seleccionado, onLimpiar, autoFocus,
}: {
  onSelect: (c: Cliente) => void;
  seleccionado: Cliente | null;
  onLimpiar: () => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery]       = useState('');
  const [debounced, setDeb]     = useState('');
  const [abierto, setAbierto]   = useState(false);
  const contenedor              = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDeb(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function fuera(e: MouseEvent) {
      if (contenedor.current && !contenedor.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const { data: resultados, isFetching } = useQuery({
    queryKey: ['clientes-buscador', debounced],
    queryFn:  () => clientesApi.list({ search: debounced, limit: 8 }),
    enabled:  debounced.length >= 2 && !seleccionado,
  });

  if (seleccionado) {
    return (
      <div className="flex items-center justify-between gap-2 rounded border border-input bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {seleccionado.nombreCompleto}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {seleccionado.numeroDocumento} · {seleccionado.telefono ?? 'sin teléfono'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { onLimpiar(); setQuery(''); setDeb(''); }}
          className="p-1 rounded hover:bg-accent text-muted-foreground flex-shrink-0"
          title="Cambiar de cliente"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={contenedor} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={e => { setQuery(e.target.value); setAbierto(true); }}
          onFocus={() => debounced.length >= 2 && setAbierto(true)}
          placeholder="Nombre, documento o teléfono…"
          className="w-full rounded border border-input bg-background pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {isFetching && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {abierto && debounced.length >= 2 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded border border-border bg-popover shadow-lg">
          {!resultados?.data.length ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">
              {isFetching ? 'Buscando…' : 'Sin resultados'}
            </p>
          ) : (
            resultados.data.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onSelect(c); setAbierto(false); }}
                className={cn(
                  'w-full text-left px-3 py-2 hover:bg-accent transition-colors',
                  'border-b border-border last:border-b-0',
                )}
              >
                <p className="text-sm font-medium text-foreground">{c.nombreCompleto}</p>
                <p className="text-xs text-muted-foreground">
                  {c.numeroDocumento} · {c.telefono ?? 'sin teléfono'}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
