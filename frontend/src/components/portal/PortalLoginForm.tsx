'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Eye, EyeOff, AlertCircle } from 'lucide-react';

import { portalApi, PortalError } from '@/lib/api/portal';
import { cn } from '@/lib/utils';

export function PortalLoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [usuario,  setUsuario]  = useState('');
  const [password, setPassword] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await portalApi.login(usuario.trim(), password);
      // El destino viene de la query solo si es una ruta del portal: aceptar cualquier
      // valor convertiría el login en un redirector abierto hacia sitios de terceros.
      const destino = params?.get('next');
      const seguro = destino && destino.startsWith('/portal') ? destino : '/portal';
      router.replace(seguro);
    } catch (err) {
      setError(
        err instanceof PortalError
          ? err.message
          : 'No pudimos iniciar tu sesión. Inténtalo de nuevo.',
      );
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5"
        >
          <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="usuario" className="text-sm font-medium text-foreground">
          Usuario
        </label>
        <input
          id="usuario"
          name="usuario"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          className={campo()}
          placeholder="El usuario que te entregamos"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Contraseña
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={verClave ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cn(campo(), 'pr-11')}
          />
          <button
            type="button"
            onClick={() => setVerClave((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
            aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          >
            {verClave ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={enviando || !usuario.trim() || !password}
        className={cn(
          'w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg',
          'text-sm font-medium bg-primary text-primary-foreground',
          'hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
        Ingresar
      </button>

      {/* El abonado no administra su clave: la emite y la reemite el operador. Decirlo
          aquí evita el "olvidé mi contraseña" que no existe y la llamada consiguiente. */}
      <p className="text-xs text-muted-foreground text-center">
        ¿Olvidaste tus datos de acceso? Comunícate con nosotros y te los reenviamos.
      </p>
    </form>
  );
}

function campo() {
  return cn(
    'w-full px-3 py-2.5 text-sm rounded-lg border border-input bg-background',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
  );
}
