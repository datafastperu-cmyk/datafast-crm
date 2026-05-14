'use client';

import { useEffect }      from 'react';
import { useForm }        from 'react-hook-form';
import { zodResolver }    from '@hookform/resolvers/zod';
import { z }              from 'zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, KeyRound, User } from 'lucide-react';

import { configApi, type ChangePasswordDto } from '@/lib/api/configuracion';
import { useAuthStore }  from '@/store/auth.store';
import { useToast }      from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

const passSchema = z.object({
  currentPassword: z.string().min(1, 'Ingresa tu contraseña actual'),
  newPassword:     z.string().min(8, 'Mínimo 8 caracteres'),
  confirmPassword: z.string().min(1, 'Confirma la contraseña'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Las contraseñas no coinciden',
  path:    ['confirmPassword'],
});
type PassValues = z.infer<typeof passSchema>;

export function PerfilTab() {
  const { toast }   = useToast();
  const { usuario } = useAuthStore();

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn:  configApi.getMe,
    staleTime: Infinity,
  });

  const {
    register, handleSubmit, reset,
    formState: { errors, isSubmitSuccessful },
  } = useForm<PassValues>({ resolver: zodResolver(passSchema) });

  useEffect(() => {
    if (isSubmitSuccessful) reset();
  }, [isSubmitSuccessful, reset]);

  const { mutate: cambiarPass, isPending } = useMutation({
    mutationFn: (values: PassValues) =>
      configApi.changePassword(values as ChangePasswordDto),
    onSuccess: () => {
      toast('Contraseña actualizada', { type: 'success' });
      reset();
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const info = me ?? usuario;

  return (
    <div className="space-y-6 max-w-lg">

      {/* Info del usuario */}
      <div className="flex items-center gap-4 p-5 rounded-xl bg-muted/30 border border-border">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center
                        text-xl font-bold text-primary flex-shrink-0">
          {info?.nombreCompleto?.[0]?.toUpperCase()}
        </div>
        <div>
          <p className="text-base font-bold text-foreground">{info?.nombreCompleto}</p>
          <p className="text-sm text-muted-foreground">{info?.email}</p>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {(info?.roles ?? []).map((r: string) => (
              <span key={r} className="text-[10px] font-bold px-1.5 py-px rounded-full
                                       bg-primary/10 text-primary">
                {r}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Permisos del usuario */}
      {(info?.permisos?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Permisos asignados
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(info?.permisos as string[])?.map((p) => (
              <span key={p} className="text-[10px] font-mono px-2 py-px rounded-md bg-muted text-muted-foreground">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Cambiar contraseña */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground pb-2 border-b border-border flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          Cambiar contraseña
        </h3>

        <form onSubmit={handleSubmit((v) => cambiarPass(v))} className="space-y-4">
          <Field label="Contraseña actual *" error={errors.currentPassword?.message}>
            <input
              {...register('currentPassword')}
              type="password"
              placeholder="Tu contraseña actual"
              className={inp(!!errors.currentPassword)}
            />
          </Field>
          <Field label="Nueva contraseña *" error={errors.newPassword?.message}>
            <input
              {...register('newPassword')}
              type="password"
              placeholder="Mínimo 8 caracteres"
              className={inp(!!errors.newPassword)}
            />
          </Field>
          <Field label="Confirmar nueva contraseña *" error={errors.confirmPassword?.message}>
            <input
              {...register('confirmPassword')}
              type="password"
              placeholder="Repite la nueva contraseña"
              className={inp(!!errors.confirmPassword)}
            />
          </Field>

          <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Requisitos:</p>
            <p>· Mínimo 8 caracteres</p>
            <p>· Se recomienda usar mayúsculas, números y símbolos</p>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg
                       bg-primary text-primary-foreground font-medium
                       hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Actualizar contraseña
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, error, children }: {
  label: string; error?: string; children: React.ReactNode;
}) {
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
