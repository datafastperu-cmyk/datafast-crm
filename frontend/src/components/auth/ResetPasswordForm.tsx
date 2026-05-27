'use client';

import { useState }          from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link                  from 'next/link';
import { useForm }           from 'react-hook-form';
import { zodResolver }       from '@hookform/resolvers/zod';
import { z }                 from 'zod';
import { Eye, EyeOff, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

import api, { parseApiError } from '@/lib/api';

const schema = z.object({
  passwordNuevo: z
    .string()
    .min(8, 'Mínimo 8 caracteres')
    .regex(
      /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#\-_])/,
      'Debe tener al menos 1 mayúscula, 1 número y 1 carácter especial',
    ),
  confirmar: z.string(),
}).refine((d) => d.passwordNuevo === d.confirmar, {
  message: 'Las contraseñas no coinciden',
  path: ['confirmar'],
});
type Values = z.infer<typeof schema>;

export function ResetPasswordForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get('token');

  const [done,     setDone]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [showNew,  setShowNew]  = useState(false);
  const [showConf, setShowConf] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
  });

  if (!token) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8 shadow-lg space-y-4 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
        <h2 className="text-lg font-semibold text-foreground">Enlace inválido</h2>
        <p className="text-sm text-muted-foreground">
          Este enlace de recuperación no es válido o no tiene el token requerido.
        </p>
        <Link href="/forgot-password" className="text-sm text-primary hover:underline">
          Solicitar un nuevo enlace
        </Link>
      </div>
    );
  }

  const onSubmit = async (values: Values) => {
    setError(null);
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, passwordNuevo: values.passwordNuevo });
      setDone(true);
      setTimeout(() => router.replace('/login'), 3000);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8 shadow-lg space-y-5 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
        <div>
          <h2 className="text-xl font-semibold text-foreground">Contraseña restablecida</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Tu contraseña fue actualizada correctamente. Redirigiendo al login...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-8 shadow-lg space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Nueva contraseña</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Elige una contraseña segura. Mínimo 8 caracteres con mayúscula, número y símbolo.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {/* Nueva contraseña */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Nueva contraseña</label>
          <div className="relative">
            <input
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={loading}
              {...register('passwordNuevo')}
              className={`
                w-full px-3.5 py-2.5 pr-10 rounded-lg border bg-background text-sm
                placeholder:text-muted-foreground transition-colors
                focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                ${errors.passwordNuevo ? 'border-destructive' : 'border-input'}
              `}
            />
            <button type="button" tabIndex={-1} onClick={() => setShowNew(!showNew)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.passwordNuevo && (
            <p className="text-xs text-destructive">{errors.passwordNuevo.message}</p>
          )}
        </div>

        {/* Confirmar */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Confirmar contraseña</label>
          <div className="relative">
            <input
              type={showConf ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={loading}
              {...register('confirmar')}
              className={`
                w-full px-3.5 py-2.5 pr-10 rounded-lg border bg-background text-sm
                placeholder:text-muted-foreground transition-colors
                focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                ${errors.confirmar ? 'border-destructive' : 'border-input'}
              `}
            />
            <button type="button" tabIndex={-1} onClick={() => setShowConf(!showConf)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showConf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.confirmar && (
            <p className="text-xs text-destructive">{errors.confirmar.message}</p>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="
            w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
            bg-primary text-primary-foreground font-medium text-sm
            hover:bg-primary/90 active:scale-[0.98] transition-all
            disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100
          "
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
          ) : (
            'Restablecer contraseña'
          )}
        </button>
      </form>
    </div>
  );
}
