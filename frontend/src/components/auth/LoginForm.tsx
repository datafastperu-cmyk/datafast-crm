'use client';

import { useState }       from 'react';
import { useRouter }      from 'next/navigation';
import { useForm }        from 'react-hook-form';
import { zodResolver }    from '@hookform/resolvers/zod';
import { z }              from 'zod';
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';

import { useAuthStore }   from '@/store/auth.store';
import api, { parseApiError } from '@/lib/api';
import type { AuthTokens } from '@/types';

// ─── Schema de validación ─────────────────────────────────────
const loginSchema = z.object({
  email:    z.string().email('Ingresa un email válido').min(1, 'El email es requerido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router       = useRouter();
  const login        = useAuthStore((s) => s.login);
  const [showPass, setShowPass]   = useState(false);
  const [error,    setError]      = useState<string | null>(null);
  const [loading,  setLoading]    = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver:      zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginValues) => {
    setError(null);
    setLoading(true);

    try {
      const res = await api.post<{ success: boolean; data: AuthTokens }>(
        '/auth/login',
        values,
      );

      if (res.data.success) {
        login(res.data.data);
        router.replace('/dashboard');
      }
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-8 shadow-lg space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Bienvenido</h2>
        <p className="text-sm text-muted-foreground mt-1">Ingresa tus credenciales para continuar</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {/* Email */}
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            Correo electrónico
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="admin@datafast.pe"
            disabled={loading}
            {...register('email')}
            className={`
              w-full px-3.5 py-2.5 rounded-lg border bg-background text-sm
              placeholder:text-muted-foreground transition-colors
              focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
              disabled:opacity-50 disabled:cursor-not-allowed
              ${errors.email ? 'border-destructive' : 'border-input'}
            `}
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Contraseña
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPass ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              disabled={loading}
              {...register('password')}
              className={`
                w-full px-3.5 py-2.5 pr-10 rounded-lg border bg-background text-sm
                placeholder:text-muted-foreground transition-colors
                focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                ${errors.password ? 'border-destructive' : 'border-input'}
              `}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPass(!showPass)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        {/* Error general */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            <span className="mt-0.5">⚠</span>
            <span>{error}</span>
          </div>
        )}

        {/* Submit */}
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
            <><Loader2 className="w-4 h-4 animate-spin" /> Verificando...</>
          ) : (
            <><LogIn className="w-4 h-4" /> Iniciar sesión</>
          )}
        </button>
      </form>
    </div>
  );
}
