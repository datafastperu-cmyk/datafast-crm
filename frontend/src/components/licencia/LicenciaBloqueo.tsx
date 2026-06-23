'use client';

import { useState } from 'react';
import { ShieldAlert, Key, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import axios from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Props {
  razon?: string;
  onLicenciaActivada: () => void;
}

const MENSAJES: Record<string, string> = {
  NO_LICENSE_KEY:    'No hay licencia configurada en el servidor.',
  INVALID_SIGNATURE: 'La licencia es inválida o ha sido modificada.',
  EXPIRED:           'La licencia ha expirado.',
  MACHINE_MISMATCH:  'Esta licencia no pertenece a este servidor.',
  REVOKED:           'La licencia fue revocada. Contacte al proveedor.',
  GRACE_EXPIRED:     'El período de gracia terminó. Verifique conexión y renueve.',
  default:           'Sistema sin licencia válida.',
};

export function LicenciaBloqueo({ razon, onLicenciaActivada }: Props) {
  const [licenseKey, setLicenseKey] = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState(false);

  const activar = async () => {
    if (!licenseKey.trim()) return;
    setLoading(true);
    setError('');

    try {
      const res = await axios.post(
        `${BASE_URL}/api/v1/admin/licencia/activar`,
        { licenseKey: licenseKey.trim() },
      );

      if (res.data?.data?.plan) {
        setSuccess(true);
        setTimeout(() => onLicenciaActivada(), 1500);
      } else {
        setError(res.data?.message || 'Licencia inválida');
      }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Error al activar la licencia');
    } finally {
      setLoading(false);
    }
  };

  const mensaje = MENSAJES[razon ?? ''] ?? MENSAJES.default;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="w-full max-w-md mx-4">

        {/* Icono y título */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
            <ShieldAlert className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Sistema sin licencia</h1>
          <p className="text-sm text-zinc-400 max-w-sm">{mensaje}</p>
          {razon && (
            <span className="mt-2 text-xs font-mono text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded">
              {razon}
            </span>
          )}
        </div>

        {/* Formulario de activación */}
        {!success ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Key className="w-4 h-4 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-300">Activar licencia</span>
            </div>

            <textarea
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="Pegue aquí su clave de licencia JWT..."
              rows={5}
              className="w-full bg-black border border-zinc-700 rounded-xl px-3 py-2.5 text-xs font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
            />

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            <button
              onClick={activar}
              disabled={loading || !licenseKey.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white text-black text-sm font-semibold hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {loading
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Verificando...</>
                : <><Key className="w-4 h-4" /> Activar licencia</>
              }
            </button>

            <p className="text-center text-xs text-zinc-600">
              ¿No tiene licencia?{' '}
              <a
                href="mailto:soporte@datafast.pe"
                className="text-zinc-400 hover:text-white transition-colors"
              >
                Contacte al proveedor
              </a>
            </p>
          </div>
        ) : (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-8 flex flex-col items-center gap-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            <p className="text-white font-semibold">Licencia activada</p>
            <p className="text-sm text-zinc-400">Cargando el sistema...</p>
          </div>
        )}

      </div>
    </div>
  );
}
