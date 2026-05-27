'use client';

import { useState }    from 'react';
import Link            from 'next/link';
import { useForm }     from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z }           from 'zod';
import { ArrowLeft, Loader2, Mail, CheckCircle2 } from 'lucide-react';

import api, { parseApiError } from '@/lib/api';

const schema = z.object({
  email: z.string().email('Ingresa un email válido'),
});
type Values = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors }, getValues } = useForm<Values>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: Values) => {
    setError(null);
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', values);
      setSent(true);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8 shadow-lg space-y-5 text-center">
        <div className="flex justify-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">Revisa tu email</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Si <strong>{getValues('email')}</strong> está registrado, recibirás un enlace
            de recuperación válido por <strong>15 minutos</strong>.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          ¿No llegó? Revisa tu carpeta de spam o{' '}
          <button onClick={() => setSent(false)} className="text-primary hover:underline">
            intenta de nuevo
          </button>.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Volver al inicio de sesión
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-8 shadow-lg space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Recuperar contraseña</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ingresa tu email y te enviaremos un enlace para restablecer tu contraseña.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            Correo electrónico
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="admin@datafast.pe"
              disabled={loading}
              {...register('email')}
              className={`
                w-full pl-9 pr-3.5 py-2.5 rounded-lg border bg-background text-sm
                placeholder:text-muted-foreground transition-colors
                focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                ${errors.email ? 'border-destructive' : 'border-input'}
              `}
            />
          </div>
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            <span className="mt-0.5">⚠</span>
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
            <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</>
          ) : (
            'Enviar enlace de recuperación'
          )}
        </button>
      </form>

      <Link
        href="/login"
        className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Volver al inicio de sesión
      </Link>
    </div>
  );
}
