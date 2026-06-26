'use client';

import { useState, useMemo }         from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm }                   from 'react-hook-form';
import { zodResolver }               from '@hookform/resolvers/zod';
import { z }                         from 'zod';
import {
  Users, Shield, Activity, Plus, Pencil, Trash2,
  Key, ToggleLeft, ToggleRight, Copy, Loader2,
  ChevronDown, ChevronRight, Search, X,
  CheckCircle2, AlertCircle, ShieldCheck,
  UserX, UserCheck, Clock, Mail,
} from 'lucide-react';

import {
  usuariosApi, rolesApi, permisosApi, logsPersonalApi,
  type UsuarioDetalle, type RolDetalle, type GrupoPermisos, type CreateUsuarioPayload,
} from '@/lib/api/usuarios';
import { useToast }       from '@/components/ui/toaster';
import { parseApiError, formatDateTime, cn } from '@/lib/utils';

// ── Helpers de UI ─────────────────────────────────────────────
function inp(err = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background placeholder:text-muted-foreground transition-all',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    err ? 'border-destructive' : 'border-input',
  );
}
function Fld({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ── Colores por estado ────────────────────────────────────────
const ESTADO_CFG: Record<string, { label: string; color: string }> = {
  activo:                  { label: 'Activo',     color: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' },
  inactivo:                { label: 'Inactivo',   color: 'bg-muted text-muted-foreground' },
  bloqueado:               { label: 'Bloqueado',  color: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' },
  pendiente_verificacion:  { label: 'Pendiente',  color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400' },
};
const ROL_COLORS = [
  'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
  'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
  'bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
  'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-400',
  'bg-pink-100 text-pink-700 dark:bg-pink-950/30 dark:text-pink-400',
  'bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400',
];
function rolColor(nombre: string) {
  const hash = nombre.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return ROL_COLORS[hash % ROL_COLORS.length];
}

// ════════════════════════════════════════════════════════════
// TAB USUARIOS
// ════════════════════════════════════════════════════════════
const crearSchema = z.object({
  nombres:   z.string().min(2),
  apellidos: z.string().min(2),
  email:     z.string().email(),
  password:  z.string().min(8, 'Mínimo 8 caracteres'),
  telefono:  z.string().optional(),
  roles:     z.array(z.string()).min(1, 'Selecciona al menos un rol'),
});
type CrearForm = z.infer<typeof crearSchema>;

function UsuariosTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch]             = useState('');
  const [modalCrear, setModalCrear]     = useState(false);
  const [editando, setEditando]         = useState<UsuarioDetalle | null>(null);
  const [resetId, setResetId]           = useState<string | null>(null);
  const [nuevaPw, setNuevaPw]           = useState('');
  const [resetting, setResetting]       = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<UsuarioDetalle | null>(null);
  const [editNombres, setEditNombres]     = useState('');
  const [editApellidos, setEditApellidos] = useState('');
  const [editEmail, setEditEmail]         = useState('');
  const [editTelefono, setEditTelefono]   = useState('');
  const [editRoles, setEditRoles]         = useState<string[]>([]);

  const { data: usuarios = [], isLoading } = useQuery({ queryKey: ['usuarios-admin'], queryFn: usuariosApi.list });
  const { data: roles    = [] }            = useQuery({ queryKey: ['roles-list'], queryFn: rolesApi.list });

  const {
    register, handleSubmit, reset: resetForm, setValue, watch,
    formState: { errors },
  } = useForm<CrearForm>({ resolver: zodResolver(crearSchema), defaultValues: { roles: [] } });
  const rolesWatch = watch('roles');
  const toggleRolForm = (r: string) => {
    const c = rolesWatch;
    setValue('roles', c.includes(r) ? c.filter((x) => x !== r) : [...c, r], { shouldValidate: true });
  };

  const { mutate: crear, isPending: creando } = useMutation({
    mutationFn: (v: CrearForm) => usuariosApi.create(v as CreateUsuarioPayload),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['usuarios-admin'] }); toast('Usuario creado', { type: 'success' }); setModalCrear(false); resetForm(); },
    onError:    (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: cambiarEstado } = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: string }) => usuariosApi.cambiarEstado(id, estado),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['usuarios-admin'] }),
    onError:    (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: eliminar } = useMutation({
    mutationFn: (id: string) => usuariosApi.eliminar(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['usuarios-admin'] }); toast('Usuario eliminado'); },
    onError:    (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: actualizar, isPending: actualizando } = useMutation({
    mutationFn: () => usuariosApi.update(editando!.id, {
      nombres: editNombres, apellidos: editApellidos,
      email: editEmail, telefono: editTelefono || undefined, roles: editRoles,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['usuarios-admin'] }); toast('Usuario actualizado', { type: 'success' }); setEditando(null); },
    onError:   (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const abrirEditar = (u: UsuarioDetalle) => {
    setEditando(u);
    setEditNombres(u.nombres);
    setEditApellidos(u.apellidos);
    setEditEmail(u.email);
    setEditTelefono(u.telefono ?? '');
    setEditRoles(u.roles);
  };

  const handleReset = async () => {
    if (!resetId || nuevaPw.length < 8) return;
    setResetting(true);
    try {
      await usuariosApi.resetPassword(resetId, nuevaPw);
      toast('Contraseña restablecida', { type: 'success' });
      setResetId(null); setNuevaPw('');
    } catch (e) { toast(parseApiError(e), { type: 'error' }); }
    setResetting(false);
  };

  const filtrados = useMemo(() =>
    search
      ? usuarios.filter((u) => `${u.nombreCompleto} ${u.email}`.toLowerCase().includes(search.toLowerCase()))
      : usuarios,
    [usuarios, search],
  );

  const roleNames = roles.map((r) => r.nombre);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nombre o email..." className={cn(inp(), 'pl-8')} />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X className="w-3 h-3 text-muted-foreground" /></button>}
        </div>
        <p className="text-xs text-muted-foreground">{filtrados.length} usuario{filtrados.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setModalCrear(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Nuevo usuario
        </button>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({length:5}).map((_,i)=><div key={i} className="skeleton h-16 rounded-xl animate-pulse"/>)}</div>
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Users className="w-10 h-10 mb-2 opacity-30" />
          <p className="text-sm">Sin usuarios</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((u) => {
            const est = ESTADO_CFG[u.estado] ?? ESTADO_CFG.inactivo;
            return (
              <div key={u.id} className="flex items-center gap-3 p-3.5 rounded-xl border border-border hover:bg-muted/20 transition-colors">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                  {u.nombres?.[0]?.toUpperCase()}{u.apellidos?.[0]?.toUpperCase()}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-sm font-semibold text-foreground truncate">{u.nombreCompleto}</p>
                    <span className={cn('text-[10px] font-bold px-1.5 py-px rounded-full', est.color)}>{est.label}</span>
                    {u.roles.map((r) => (
                      <span key={r} className={cn('text-[10px] font-bold px-1.5 py-px rounded-full', rolColor(r))}>{r}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                    {u.ultimoAcceso && <p className="text-[10px] text-muted-foreground">Acceso: {formatDateTime(u.ultimoAcceso)}</p>}
                  </div>
                </div>
                {/* Acciones */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button title="Editar usuario" onClick={() => abrirEditar(u)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button title="Restablecer contraseña" onClick={() => setResetId(u.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <Key className="w-3.5 h-3.5" />
                  </button>
                  <button
                    title={u.estado === 'activo' ? 'Desactivar' : 'Activar'}
                    onClick={() => cambiarEstado({ id: u.id, estado: u.estado === 'activo' ? 'inactivo' : 'activo' })}
                    className={cn('p-1.5 rounded-lg transition-colors',
                      u.estado === 'activo' ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-950/20' : 'text-muted-foreground hover:bg-muted',
                    )}>
                    {u.estado === 'activo' ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  </button>
                  <button title="Eliminar" onClick={() => setPendingDeleteUser(u)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal crear */}
      {modalCrear && (
        <Modal title="Nuevo usuario" onClose={() => { setModalCrear(false); resetForm(); }}>
          <form onSubmit={handleSubmit((v) => crear(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Nombres *" error={errors.nombres?.message}>
                <input {...register('nombres')} className={inp(!!errors.nombres)} placeholder="Juan" />
              </Fld>
              <Fld label="Apellidos *" error={errors.apellidos?.message}>
                <input {...register('apellidos')} className={inp(!!errors.apellidos)} placeholder="Pérez" />
              </Fld>
            </div>
            <Fld label="Email *" error={errors.email?.message}>
              <input {...register('email')} type="email" className={inp(!!errors.email)} placeholder="juan@tuisp.pe" />
            </Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Contraseña *" error={errors.password?.message}>
                <input {...register('password')} type="password" className={inp(!!errors.password)} placeholder="Mínimo 8 caracteres" />
              </Fld>
              <Fld label="Teléfono">
                <input {...register('telefono')} className={inp()} placeholder="+51 987 654 321" />
              </Fld>
            </div>
            <Fld label="Roles *" error={errors.roles?.message}>
              <div className="flex flex-wrap gap-2 mt-1">
                {roleNames.map((r) => (
                  <button key={r} type="button" onClick={() => toggleRolForm(r)}
                    className={cn('text-xs px-2.5 py-1 rounded-full font-medium border transition-all',
                      rolesWatch.includes(r) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary/50',
                    )}>
                    {r}
                  </button>
                ))}
              </div>
            </Fld>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { setModalCrear(false); resetForm(); }}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted">Cancelar</button>
              <button type="submit" disabled={creando}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-60">
                {creando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Crear usuario
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal reset password */}
      {resetId && (
        <Modal title="Restablecer contraseña" onClose={() => { setResetId(null); setNuevaPw(''); }}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">La nueva contraseña se enviará al email del usuario si el SMTP está configurado.</p>
            <Fld label="Nueva contraseña *">
              <input value={nuevaPw} onChange={(e) => setNuevaPw(e.target.value)} type="password"
                className={inp()} placeholder="Mínimo 8 caracteres" />
            </Fld>
            <div className="flex gap-3">
              <button onClick={() => { setResetId(null); setNuevaPw(''); }}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted">Cancelar</button>
              <button onClick={handleReset} disabled={nuevaPw.length < 8 || resetting}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-60">
                {resetting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Restablecer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {pendingDeleteUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <p className="font-semibold text-foreground">Eliminar usuario</p>
            <p className="text-sm text-muted-foreground">
              ¿Eliminar a <strong>{pendingDeleteUser.nombreCompleto}</strong>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setPendingDeleteUser(null)}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button onClick={() => { eliminar(pendingDeleteUser.id); setPendingDeleteUser(null); }}
                className="flex-1 py-2 text-sm rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal editar usuario */}
      {editando && (
        <Modal title="Editar usuario" onClose={() => setEditando(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Nombres *">
                <input value={editNombres} onChange={(e) => setEditNombres(e.target.value)} className={inp()} placeholder="Juan" />
              </Fld>
              <Fld label="Apellidos *">
                <input value={editApellidos} onChange={(e) => setEditApellidos(e.target.value)} className={inp()} placeholder="Pérez" />
              </Fld>
            </div>
            <Fld label="Email *">
              <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} type="email" className={inp()} />
            </Fld>
            <Fld label="Teléfono">
              <input value={editTelefono} onChange={(e) => setEditTelefono(e.target.value)} className={inp()} placeholder="+51 987 654 321" />
            </Fld>
            <Fld label="Roles *">
              <div className="flex flex-wrap gap-2 mt-1">
                {roleNames.map((r) => (
                  <button key={r} type="button"
                    onClick={() => setEditRoles((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r])}
                    className={cn('text-xs px-2.5 py-1 rounded-full font-medium border transition-all',
                      editRoles.includes(r) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary/50',
                    )}>
                    {r}
                  </button>
                ))}
              </div>
              {editRoles.length === 0 && <p className="text-xs text-destructive mt-1">Selecciona al menos un rol</p>}
            </Fld>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditando(null)}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted">Cancelar</button>
              <button
                onClick={() => actualizar()}
                disabled={actualizando || !editNombres.trim() || !editApellidos.trim() || !editEmail.trim() || editRoles.length === 0}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-60">
                {actualizando && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar cambios
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// TAB ROLES
// ════════════════════════════════════════════════════════════
function RolesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [expandedRol, setExpandedRol]   = useState<string | null>(null);
  const [editando, setEditando]         = useState<RolDetalle | null>(null);
  const [modalNuevo, setModalNuevo]     = useState(false);
  const [nombre, setNombre]             = useState('');
  const [desc, setDesc]                 = useState('');
  const [saving, setSaving]             = useState(false);

  const { data: roles    = [], isLoading: loadingRoles } = useQuery({ queryKey: ['roles-list'], queryFn: rolesApi.list });
  const { data: grupos   = [] }                          = useQuery({ queryKey: ['permisos-list'], queryFn: permisosApi.list });

  const allPermisos = useMemo(() => grupos.flatMap((g) => g.permisos), [grupos]);

  const [permisosSeleccionados, setPermSel] = useState<Set<string>>(new Set());
  const [pendingDeleteRol, setPendingDeleteRol] = useState<RolDetalle | null>(null);
  const [pendingClonar, setPendingClonar] = useState<{ id: string; nombre: string } | null>(null);

  const abrirEditar = (rol: RolDetalle) => {
    setEditando(rol);
    setNombre(rol.nombre);
    setDesc(rol.descripcion ?? '');
    setPermSel(new Set(rol.permisos));
    setModalNuevo(false);
  };

  const abrirNuevo = () => {
    setEditando(null);
    setNombre(''); setDesc('');
    setPermSel(new Set());
    setModalNuevo(true);
  };

  const togglePermiso = (codigo: string) => {
    setPermSel((prev) => {
      const next = new Set(prev);
      next.has(codigo) ? next.delete(codigo) : next.add(codigo);
      return next;
    });
  };

  const toggleGrupo = (grupo: GrupoPermisos) => {
    const codigos = grupo.permisos.map((p) => p.codigo);
    const todosActivos = codigos.every((c) => permisosSeleccionados.has(c));
    setPermSel((prev) => {
      const next = new Set(prev);
      if (todosActivos) codigos.forEach((c) => next.delete(c));
      else              codigos.forEach((c) => next.add(c));
      return next;
    });
  };

  const handleGuardar = async () => {
    if (!nombre.trim()) return;
    setSaving(true);
    try {
      const payload = { nombre: nombre.trim(), descripcion: desc, permisosCodigos: [...permisosSeleccionados] };
      if (editando) {
        await rolesApi.update(editando.id, payload);
        toast('Rol actualizado', { type: 'success' });
      } else {
        await rolesApi.create(payload);
        toast('Rol creado', { type: 'success' });
      }
      qc.invalidateQueries({ queryKey: ['roles-list'] });
      setEditando(null); setModalNuevo(false);
    } catch (e) { toast(parseApiError(e), { type: 'error' }); }
    setSaving(false);
  };

  const { mutate: eliminar } = useMutation({
    mutationFn: (id: string) => rolesApi.eliminar(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['roles-list'] }); toast('Rol eliminado'); },
    onError:    (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: clonar } = useMutation({
    mutationFn: ({ id, nombre: n }: { id: string; nombre: string }) => rolesApi.clonar(id, n),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['roles-list'] }); toast('Rol clonado', { type: 'success' }); },
    onError:    (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{roles.length} roles configurados</p>
        <button onClick={abrirNuevo}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Nuevo rol
        </button>
      </div>

      {loadingRoles ? (
        <div className="space-y-2">{Array.from({length:4}).map((_,i)=><div key={i} className="skeleton h-14 rounded-xl animate-pulse"/>)}</div>
      ) : (
        <div className="space-y-2">
          {roles.map((rol) => (
            <div key={rol.id} className="border border-border rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors cursor-pointer"
                   onClick={() => setExpandedRol(expandedRol === rol.id ? null : rol.id)}>
                <div className={cn('w-2 h-2 rounded-full flex-shrink-0', rolColor(rol.nombre).split(' ')[0])} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{rol.nombre}</p>
                    {rol.esSistema && <span className="text-[9px] font-bold px-1.5 py-px rounded bg-muted text-muted-foreground uppercase tracking-wide">Sistema</span>}
                  </div>
                  {rol.descripcion && <p className="text-xs text-muted-foreground truncate">{rol.descripcion}</p>}
                </div>
                <span className="text-xs text-muted-foreground">{rol.totalPermisos} permisos</span>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button title="Editar" onClick={() => abrirEditar(rol)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button title="Clonar" onClick={() => setPendingClonar({ id: rol.id, nombre: '' })}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {!rol.esSistema && (
                    <button title="Eliminar" onClick={() => setPendingDeleteRol(rol)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {expandedRol === rol.id ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                </div>
              </div>
              {expandedRol === rol.id && (
                <div className="px-4 pb-3 pt-1 border-t border-border bg-muted/10">
                  <div className="flex flex-wrap gap-1.5">
                    {rol.permisos.length === 0
                      ? <p className="text-xs text-muted-foreground">Sin permisos asignados</p>
                      : rol.permisos.map((p) => (
                          <span key={p} className="text-[10px] font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground">{p}</span>
                        ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal crear/editar rol con matriz de permisos */}
      {(editando || modalNuevo) && (
        <Modal title={editando ? `Editar: ${editando.nombre}` : 'Nuevo rol'} onClose={() => { setEditando(null); setModalNuevo(false); }} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Nombre del rol *">
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inp(!nombre)} placeholder="Ej. Soporte Técnico" />
              </Fld>
              <Fld label="Descripción">
                <input value={desc} onChange={(e) => setDesc(e.target.value)} className={inp()} placeholder="Descripción breve" />
              </Fld>
            </div>

            {/* Matriz de permisos */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Permisos asignados ({permisosSeleccionados.size} / {allPermisos.length})
              </p>
              <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                {grupos.map((grupo) => {
                  const codigos = grupo.permisos.map((p) => p.codigo);
                  const activos = codigos.filter((c) => permisosSeleccionados.has(c)).length;
                  const todos   = activos === codigos.length;
                  return (
                    <div key={grupo.modulo} className="border border-border rounded-lg overflow-hidden">
                      <div
                        className="flex items-center gap-2 px-3 py-2 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => toggleGrupo(grupo)}
                      >
                        <div className={cn('w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0',
                          todos ? 'bg-primary border-primary' : activos > 0 ? 'bg-primary/30 border-primary/60' : 'border-input')}>
                          {todos && <CheckCircle2 className="w-2.5 h-2.5 text-primary-foreground" />}
                          {!todos && activos > 0 && <div className="w-1.5 h-1.5 rounded-sm bg-primary" />}
                        </div>
                        <span className="text-xs font-semibold text-foreground capitalize">{grupo.modulo}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{activos}/{codigos.length}</span>
                      </div>
                      <div className="px-3 py-2 flex flex-wrap gap-1.5">
                        {grupo.permisos.map((p) => {
                          const act = permisosSeleccionados.has(p.codigo);
                          return (
                            <button key={p.codigo} type="button" onClick={() => togglePermiso(p.codigo)}
                              title={p.descripcion || p.nombre}
                              className={cn('text-[11px] px-2 py-0.5 rounded-md border font-medium transition-all',
                                act ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary/50',
                              )}>
                              {p.codigo.split(':')[1] ?? p.codigo}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => { setEditando(null); setModalNuevo(false); }}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted">Cancelar</button>
              <button onClick={handleGuardar} disabled={saving || !nombre.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-60">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar rol
              </button>
            </div>
          </div>
        </Modal>
      )}

      {pendingDeleteRol && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <p className="font-semibold text-foreground">Eliminar rol</p>
            <p className="text-sm text-muted-foreground">
              ¿Eliminar el rol <strong>&ldquo;{pendingDeleteRol.nombre}&rdquo;</strong>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setPendingDeleteRol(null)}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button onClick={() => { eliminar(pendingDeleteRol.id); setPendingDeleteRol(null); }}
                className="flex-1 py-2 text-sm rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingClonar && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <p className="font-semibold text-foreground">Clonar rol</p>
            <input
              autoFocus
              type="text"
              placeholder="Nombre del nuevo rol"
              value={pendingClonar.nombre}
              onChange={(e) => setPendingClonar((prev) => prev ? { ...prev, nombre: e.target.value } : null)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex gap-3 pt-1">
              <button onClick={() => setPendingClonar(null)}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => { clonar({ id: pendingClonar.id, nombre: pendingClonar.nombre }); setPendingClonar(null); }}
                disabled={!pendingClonar.nombre.trim()}
                className="flex-1 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60">
                Clonar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// TAB LOGS
// ════════════════════════════════════════════════════════════
function LogsTab() {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['personal-logs'],
    queryFn:  () => logsPersonalApi.list(200),
    refetchInterval: 30_000,
  });

  const ACCION_COLOR: Record<string, string> = {
    LOGIN:          'text-green-600 dark:text-green-400',
    LOGOUT:         'text-slate-500',
    CREATE_USER:    'text-blue-600 dark:text-blue-400',
    UPDATE_USER:    'text-amber-600 dark:text-amber-400',
    DELETE_USER:    'text-red-600 dark:text-red-400',
    CHANGE_USER_STATUS: 'text-orange-600 dark:text-orange-400',
    RESET_PASSWORD: 'text-violet-600 dark:text-violet-400',
    CREATE_ROL:     'text-blue-500',
    UPDATE_ROL:     'text-amber-500',
    DELETE_ROL:     'text-red-500',
    CLONE_ROL:      'text-teal-500',
    ASSIGN_PERMISOS: 'text-cyan-500',
    LOGIN_FAIL:     'text-red-500',
  };

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="space-y-2">{Array.from({length:8}).map((_,i)=><div key={i} className="skeleton h-10 rounded-lg animate-pulse"/>)}</div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Activity className="w-10 h-10 mb-2 opacity-30" />
          <p className="text-sm">Sin actividad registrada</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Fecha', 'Usuario', 'Acción', 'Descripción', 'IP'].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDateTime(l.createdAt)}</td>
                  <td className="px-3 py-2 font-medium truncate max-w-[120px]">{l.usuarioEmail ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={cn('font-semibold', ACCION_COLOR[l.accion] ?? 'text-foreground')}>{l.accion}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[200px]">{l.descripcion ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{l.ipAddress ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// MODAL HELPER
// ════════════════════════════════════════════════════════════
function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className={cn('bg-card border border-border rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════
const TABS = [
  { id: 'usuarios', label: 'Usuarios',   icon: Users },
  { id: 'roles',    label: 'Roles',      icon: Shield },
  { id: 'logs',     label: 'Actividad',  icon: Activity },
];

export function PersonalContent() {
  const [activeTab, setActiveTab] = useState('usuarios');

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Gestión de Personal</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Usuarios, roles, permisos y auditoría del sistema</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex items-center gap-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all',
                activeTab === id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              )}>
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido del tab */}
      <div>
        {activeTab === 'usuarios' && <UsuariosTab />}
        {activeTab === 'roles'    && <RolesTab />}
        {activeTab === 'logs'     && <LogsTab />}
      </div>
    </div>
  );
}
