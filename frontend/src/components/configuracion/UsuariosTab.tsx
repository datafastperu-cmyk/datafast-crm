'use client';

import { useState }       from 'react';
import { useForm }        from 'react-hook-form';
import { zodResolver }    from '@hookform/resolvers/zod';
import { z }              from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, ToggleLeft, ToggleRight, Loader2, ShieldCheck } from 'lucide-react';

import { configApi, type CreateUsuarioDto } from '@/lib/api/configuracion';
import { useToast }  from '@/components/ui/toaster';
import { parseApiError, formatDateTime, cn } from '@/lib/utils';

const schema = z.object({
  nombreCompleto: z.string().min(3, 'Mínimo 3 caracteres'),
  email:          z.string().email('Email inválido'),
  password:       z.string().min(8, 'Mínimo 8 caracteres'),
  roles:          z.array(z.string()).min(1, 'Selecciona al menos un rol'),
});
type FormValues = z.infer<typeof schema>;

const ROLES_DESC: Record<string, { label: string; desc: string; color: string }> = {
  Administrador: { label: 'Administrador', desc: 'Acceso total al sistema', color: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' },
  Supervisor:    { label: 'Supervisor',    desc: 'Reportes, aprobaciones, sin config', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400' },
  Cajero:        { label: 'Cajero',        desc: 'Registrar y verificar pagos', color: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' },
  Técnico:       { label: 'Técnico',       desc: 'Contratos, aprovisionamiento, monitoreo', color: 'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400' },
};

export function UsuariosTab() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [showForm, setShowForm] = useState(false);

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn:  configApi.getUsuarios,
  });

  const {
    register, handleSubmit, reset, setValue, watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: { roles: [] },
  });

  const rolesSeleccionados = watch('roles');

  const toggleRol = (rol: string) => {
    const current = watch('roles');
    setValue(
      'roles',
      current.includes(rol) ? current.filter((r) => r !== rol) : [...current, rol],
      { shouldValidate: true },
    );
  };

  const { mutate: crear, isPending: creando } = useMutation({
    mutationFn: (values: FormValues) => configApi.createUsuario(values as CreateUsuarioDto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      toast('Usuario creado', { type: 'success' });
      setShowForm(false); reset();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: toggleActivo } = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      configApi.toggleUsuario(id, activo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['usuarios'] }),
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  return (
    <div className="space-y-5">

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {usuarios.length} usuario{usuarios.length !== 1 ? 's' : ''} registrado{usuarios.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                     bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="w-3.5 h-3.5" /> Nuevo usuario
        </button>
      </div>

      {/* Lista de usuarios */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-16 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {(usuarios as any[]).map((u) => (
            <div key={u.id}
                 className="flex items-center gap-4 p-4 rounded-xl border border-border
                            hover:bg-muted/30 transition-colors">
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center
                              text-sm font-bold text-primary flex-shrink-0">
                {u.nombreCompleto?.[0]?.toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground">{u.nombreCompleto}</p>
                  {u.roles?.map((r: string) => (
                    <span key={r} className={cn(
                      'text-[10px] font-bold px-1.5 py-px rounded-full',
                      ROLES_DESC[r]?.color ?? 'bg-muted text-muted-foreground',
                    )}>
                      {r}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{u.email}</p>
                {u.ultimoAcceso && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Último acceso: {formatDateTime(u.ultimoAcceso)}
                  </p>
                )}
              </div>

              {/* Toggle activo */}
              <button
                onClick={() => toggleActivo({ id: u.id, activo: !u.activo })}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-colors font-medium',
                  u.activo
                    ? 'text-green-700 bg-green-100 hover:bg-green-200 dark:bg-green-950/30 dark:text-green-400'
                    : 'text-muted-foreground bg-muted hover:bg-muted/70',
                )}
              >
                {u.activo
                  ? <><ToggleRight className="w-3.5 h-3.5" /> Activo</>
                  : <><ToggleLeft  className="w-3.5 h-3.5" /> Inactivo</>}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Descripción de roles */}
      <div className="bg-muted/30 rounded-xl p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> Roles del sistema
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          {Object.entries(ROLES_DESC).map(([key, { label, desc, color }]) => (
            <div key={key} className="flex items-start gap-2">
              <span className={cn('text-[10px] font-bold px-1.5 py-px rounded-full flex-shrink-0 mt-0.5', color)}>
                {label}
              </span>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Modal crear usuario */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-semibold text-foreground">Nuevo usuario</h3>
              <button onClick={() => { setShowForm(false); reset(); }}
                className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>

            <form onSubmit={handleSubmit((v) => crear(v))} className="p-6 space-y-4">
              <Field label="Nombre completo *" error={errors.nombreCompleto?.message}>
                <input {...register('nombreCompleto')} placeholder="Juan Pérez" className={inp(!!errors.nombreCompleto)} />
              </Field>
              <Field label="Email *" error={errors.email?.message}>
                <input {...register('email')} type="email" placeholder="juan@datafast.pe" className={inp(!!errors.email)} />
              </Field>
              <Field label="Contraseña inicial *" error={errors.password?.message}>
                <input {...register('password')} type="password" placeholder="Mínimo 8 caracteres" className={inp(!!errors.password)} />
              </Field>

              <Field label="Roles *" error={errors.roles?.message}>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(ROLES_DESC).map(([key, { label, color }]) => (
                    <label key={key} className={cn(
                      'flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-all text-sm',
                      rolesSeleccionados.includes(key)
                        ? 'border-primary bg-primary/5'
                        : 'border-input hover:border-muted-foreground',
                    )}>
                      <input
                        type="checkbox"
                        checked={rolesSeleccionados.includes(key)}
                        onChange={() => toggleRol(key)}
                        className="sr-only"
                      />
                      <span className={cn('text-[10px] font-bold px-1.5 py-px rounded-full', color)}>{label}</span>
                    </label>
                  ))}
                </div>
              </Field>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); reset(); }}
                  className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={creando}
                  className="flex-1 flex items-center justify-center gap-2 py-2 text-sm rounded-lg
                             bg-primary text-primary-foreground font-medium disabled:opacity-60 transition-colors">
                  {creando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Crear usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function inp(hasError = false) {
  return cn(
    'w-full px-3 py-2 text-sm rounded-lg border bg-background placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
    hasError ? 'border-destructive' : 'border-input',
  );
}
