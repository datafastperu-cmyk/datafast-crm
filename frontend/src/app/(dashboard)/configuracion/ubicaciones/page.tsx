'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Search, MapPin } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toaster';
import { parseApiError } from '@/lib/utils';

interface Zona { id: string; nombre: string; activo: boolean; createdAt: string; }

const zonasApi = {
  list:   (search?: string) => api.get<any>('/zonas', { params: search ? { search } : {} }).then(r => r.data.data as Zona[]),
  create: (nombre: string)  => api.post<any>('/zonas', { nombre }).then(r => r.data.data as Zona),
  update: (id: string, nombre: string) => api.put<any>(`/zonas/${id}`, { nombre }).then(r => r.data.data as Zona),
  remove: (id: string)      => api.delete(`/zonas/${id}`),
};

export default function ZonasPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [search,     setSearch]     = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [modal,      setModal]      = useState<{ open: boolean; zona?: Zona }>({ open: false });
  const [nombre,     setNombre]     = useState('');
  const [page,       setPage]       = useState(1);
  const PER_PAGE = 12;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: zonas = [], isLoading } = useQuery({
    queryKey: ['zonas', debouncedQ],
    queryFn:  () => zonasApi.list(debouncedQ || undefined),
  });

  const { mutate: crear, isPending: creando } = useMutation({
    mutationFn: () => zonasApi.create(nombre.trim()),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['zonas'] }); closeModal(); toast('Zona creada', { type: 'success' }); },
    onError:    (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: actualizar, isPending: actualizando } = useMutation({
    mutationFn: () => zonasApi.update(modal.zona!.id, nombre.trim()),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['zonas'] }); closeModal(); toast('Zona actualizada', { type: 'success' }); },
    onError:    (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: eliminar } = useMutation({
    mutationFn: (id: string) => zonasApi.remove(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['zonas'] }); toast('Zona eliminada', { type: 'success' }); },
    onError:    (e) => toast(parseApiError(e), { type: 'error' }),
  });

  function openCreate() { setNombre(''); setModal({ open: true }); }
  function openEdit(z: Zona) { setNombre(z.nombre); setModal({ open: true, zona: z }); }
  function closeModal() { setModal({ open: false }); setNombre(''); }
  function handleSubmit() { if (!nombre.trim()) return; modal.zona ? actualizar() : crear(); }
  function confirmDelete(z: Zona) {
    if (confirm(`¿Eliminar la zona "${z.nombre}"?`)) eliminar(z.id);
  }

  const total    = zonas.length;
  const pages    = Math.max(1, Math.ceil(total / PER_PAGE));
  const pageData = zonas.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const isPending = creando || actualizando;

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" /> Zonas
          </h2>
          <p className="text-sm text-muted-foreground">Gestiona las zonas geográficas de cobertura</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Nuevo
        </button>
      </div>

      {/* Card */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {total}
          </span>
          <div className="relative ml-auto w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Buscar..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted border border-input rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Table */}
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-16">ID</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Zona</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-28">Activos</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-28">Suspendidos</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {isLoading ? (
              <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">Cargando...</td></tr>
            ) : pageData.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No hay zonas registradas</td></tr>
            ) : pageData.map((z, i) => (
              <tr key={z.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 text-muted-foreground">{(page - 1) * PER_PAGE + i + 1}</td>
                <td className="px-4 py-2.5 font-medium text-foreground">{z.nombre}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-white text-xs font-bold">0</span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-destructive text-white text-xs font-bold">0</span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => openEdit(z)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => confirmDelete(z)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
          <span>Mostrando {Math.min((page - 1) * PER_PAGE + 1, total)} al {Math.min(page * PER_PAGE, total)} de un total de {total}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-2.5 py-1 rounded border border-input hover:bg-muted disabled:opacity-40 transition-colors">←</button>
            <span className="px-3 py-1 rounded bg-primary text-primary-foreground font-semibold">{page}</span>
            <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
              className="px-2.5 py-1 rounded border border-input hover:bg-muted disabled:opacity-40 transition-colors">→</button>
          </div>
        </div>
      </div>

      {/* Modal */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-foreground">{modal.zona ? 'Editar Zona' : 'Nueva Zona'}</h3>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
            </div>
            <div className="px-5 py-4">
              <label className="block text-sm text-muted-foreground mb-1.5">Nombre Zona</label>
              <input
                autoFocus
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                maxLength={100}
                placeholder="Ej: Miraflores Norte"
                className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
              <button onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cerrar
              </button>
              <button
                onClick={handleSubmit}
                disabled={!nombre.trim() || isPending}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {isPending ? 'Guardando...' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
