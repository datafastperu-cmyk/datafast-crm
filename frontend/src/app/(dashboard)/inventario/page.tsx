'use client';

import { useState }       from 'react';
import { Package, Search, Plus, AlertTriangle } from 'lucide-react';
import { PageHeader }     from '@/components/shared/PageHeader';
import { EmptyState }     from '@/components/shared/EmptyState';
import { cn, formatPEN } from '@/lib/utils';
import { mockInventario } from '@/mock-data';

const ESTADO_STYLE: Record<string, string> = {
  disponible: 'pill-online',
  bajo_stock: 'pill-warning',
  agotado:    'pill-offline',
  reservado:  'pill-info',
};

const CATEGORIAS = ['Todos', 'Router', 'ONU/ONT', 'Cable FO', 'Splitter', 'Herramienta', 'Accesorios FO', 'Conectores'];

export default function InventarioPage() {
  const [search,     setSearch]     = useState('');
  const [categoria,  setCategoria]  = useState('Todos');
  const [estadoFiltro, setEstadoFiltro] = useState<string>('todos');

  const items = mockInventario.filter((i) => {
    const q = search.toLowerCase();
    const matchSearch  = !q || i.nombre.toLowerCase().includes(q) || i.codigo.toLowerCase().includes(q);
    const matchCat     = categoria === 'Todos' || i.categoria === categoria;
    const matchEstado  = estadoFiltro === 'todos' || i.estado === estadoFiltro;
    return matchSearch && matchCat && matchEstado;
  });

  const stats = {
    total:     mockInventario.length,
    bajoStock: mockInventario.filter(i => i.estado === 'bajo_stock').length,
    agotados:  mockInventario.filter(i => i.estado === 'agotado').length,
    valorTotal:mockInventario.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0),
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventario"
        description="Control de stock de equipos y materiales"
        breadcrumbs={[{ label:'Inventario' }]}
        badge={{ label:`${mockInventario.length} items`, color:'blue' }}
        actions={
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
            <Plus className="w-3.5 h-3.5" />
            Registrar entrada
          </button>
        }
      />

      {/* Alertas de stock */}
      {stats.bajoStock > 0 || stats.agotados > 0 ? (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/8 border border-amber-500/20">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-400">Atención de stock requerida</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {stats.agotados > 0 && <span className="text-red-400 font-medium">{stats.agotados} items agotados</span>}
              {stats.agotados > 0 && stats.bajoStock > 0 && ' · '}
              {stats.bajoStock > 0 && <span>{stats.bajoStock} items bajo el mínimo</span>}
              . Se recomienda realizar una orden de compra.
            </p>
          </div>
          <button className="text-xs text-primary hover:underline flex-shrink-0">Generar orden</button>
        </div>
      ) : null}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label:'Items en inventario', value:stats.total,                    color:'text-foreground' },
          { label:'Bajo stock',          value:stats.bajoStock,                color:'text-amber-400' },
          { label:'Agotados',            value:stats.agotados,                 color:'text-red-400' },
          { label:'Valor en stock',      value:formatPEN(stats.valorTotal),    color:'text-emerald-400' },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
            <p className={cn('text-xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o código..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)}
            className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="todos">Todos los estados</option>
            <option value="disponible">Disponible</option>
            <option value="bajo_stock">Bajo stock</option>
            <option value="agotado">Agotado</option>
            <option value="reservado">Reservado</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIAS.map((c) => (
            <button key={c} onClick={() => setCategoria(c)}
              className={cn('text-xs px-3 py-1.5 rounded-full border transition-colors',
                categoria === c
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-border/60'
              )}>{c}</button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {items.length === 0 ? (
          <EmptyState icon={Package} title="Sin items" description="No hay items que coincidan con los filtros." compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Categoría</th>
                  <th>Stock</th>
                  <th>Mínimo</th>
                  <th>Precio unit.</th>
                  <th>Valor total</th>
                  <th>Ubicación</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={cn(item.estado === 'agotado' && 'bg-red-500/5', item.estado === 'bajo_stock' && 'bg-amber-500/5')}>
                    <td className="font-mono text-xs text-muted-foreground">{item.codigo}</td>
                    <td>
                      <p className="text-sm font-medium text-foreground">{item.nombre}</p>
                      <p className="text-[10px] text-muted-foreground">{item.proveedor}</p>
                    </td>
                    <td className="text-xs text-muted-foreground">{item.categoria}</td>
                    <td>
                      <span className={cn('text-sm font-bold',
                        item.estado === 'agotado' ? 'text-red-400' :
                        item.estado === 'bajo_stock' ? 'text-amber-400' : 'text-foreground'
                      )}>{item.cantidad}</span>
                      <span className="text-xs text-muted-foreground ml-1">{item.unidad}</span>
                    </td>
                    <td className="text-xs text-muted-foreground">{item.minimo} {item.unidad}</td>
                    <td className="text-xs font-mono text-foreground">{formatPEN(item.precioUnitario)}</td>
                    <td className="text-xs font-semibold text-foreground">{formatPEN(item.cantidad * item.precioUnitario)}</td>
                    <td className="text-xs text-muted-foreground">{item.ubicacion}</td>
                    <td>
                      <span className={ESTADO_STYLE[item.estado]}>
                        {item.estado.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
          {items.length} de {mockInventario.length} items
        </div>
      </div>
    </div>
  );
}
