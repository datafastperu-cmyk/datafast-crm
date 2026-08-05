'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, ShieldCheck, ShieldAlert, ShieldX, Loader2, Lock,
} from 'lucide-react';

import api from '@/lib/api';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

type RolHost = 'erp' | 'portal' | 'web';

interface EstadoSslRol {
  rol: RolHost;
  dominio: string | null;
  alcanzable: boolean;
  tieneCertificado: boolean;
  expiraEn: number | null;
  mensaje: string;
}

interface ResultadoEmision {
  rol: RolHost;
  dominio: string | null;
  exitoso: boolean;
  mensaje: string;
  pista?: string;
}

interface ApiRespuesta<T> { success: boolean; message: string; data: T }

const ETIQUETA: Record<RolHost, { titulo: string; detalle: string }> = {
  erp:    { titulo: 'Panel administrativo', detalle: 'Donde trabajan los operadores' },
  portal: { titulo: 'Portal del abonado',   detalle: 'Donde entran los clientes' },
  web:    { titulo: 'Web pública',          detalle: 'Sitio institucional' },
};

/**
 * Emisión de certificados HTTPS desde la UI, por rol.
 *
 * Existe para que no haga falta SSH ni saber usar certbot: cualquier operador con permiso
 * de configuración puede activar HTTPS.
 *
 * Y hay una razón de arquitectura detrás: con certificados propios el servidor tiene HTTPS
 * POR SÍ MISMO. Un CDN o proxy por delante pasa a ser una capa añadida en vez de un
 * requisito — una instalación que depende del proxy para el candado lo pierde, junto con
 * la geolocalización y la PWA, el día que alguien lo apaga.
 */
export function HttpsCard() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: roles, isLoading, refetch, isRefetching } = useQuery<EstadoSslRol[]>({
    queryKey: ['ssl-roles'],
    queryFn: async () => {
      const res = await api.get<ApiRespuesta<EstadoSslRol[]>>('/config/ssl');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const emitir = useMutation<ResultadoEmision, unknown, RolHost>({
    mutationFn: async (rol) => {
      const res = await api.post<ApiRespuesta<ResultadoEmision>>(`/config/ssl/${rol}`);
      return res.data.data;
    },
    onSuccess: (r) => {
      // La pista se muestra junto al fallo: un "no se pudo" a secas deja al operador sin
      // saber qué hacer, y este proceso depende de cosas fuera del ERP (DNS, puerto 80).
      toast(r.exitoso ? r.mensaje : `${r.mensaje}${r.pista ? ` ${r.pista}` : ''}`,
            { type: r.exitoso ? 'success' : 'error' });
      qc.invalidateQueries({ queryKey: ['ssl-roles'] });
    },
    onError: () => toast('No se pudo contactar con el servidor para emitir el certificado.', { type: 'error' }),
  });

  if (isLoading) return <div className="h-24 rounded-xl bg-muted animate-pulse mt-3" />;

  // Sin ningún rol con dominio, esta tarjeta no aporta nada: es una instalación servida por
  // IP, que es un modo de uso legítimo y no requiere certificados.
  const conDominio = (roles ?? []).filter((r) => r.dominio);
  if (conDominio.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4">
        <p className="text-xs text-muted-foreground">
          Este servidor se usa por IP, sin dominios configurados. No hacen falta certificados
          HTTPS. Para activarlos, define los dominios en el archivo <code>.env</code> del servidor.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-xs font-semibold text-foreground">Certificados HTTPS</p>
        </div>
        <button type="button" onClick={() => refetch()} disabled={isRefetching}
          className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-50">
          <RefreshCw className={cn('w-3.5 h-3.5 text-muted-foreground', isRefetching && 'animate-spin')} />
        </button>
      </div>

      <div className="space-y-2">
        {conDominio.map((r) => {
          const porVencer = r.tieneCertificado && r.expiraEn != null && r.expiraEn < 15;
          const Icono = r.tieneCertificado ? (porVencer ? ShieldAlert : ShieldCheck) : ShieldX;
          const color = r.tieneCertificado
            ? (porVencer ? 'text-amber-500' : 'text-emerald-500')
            : 'text-muted-foreground';

          const enCurso = emitir.isPending && emitir.variables === r.rol;

          return (
            <div key={r.rol} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <Icono className={cn('w-4 h-4 shrink-0 mt-0.5', color)} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">
                      {ETIQUETA[r.rol].titulo}
                      <span className="text-muted-foreground font-normal"> · {ETIQUETA[r.rol].detalle}</span>
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground truncate">{r.dominio}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{r.mensaje}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => emitir.mutate(r.rol)}
                  // Se deja pulsable aunque la validación no llegue: el estado se cachea 30 s
                  // y el operador puede haber arreglado el DNS hace un instante. El intento
                  // vuelve a comprobarlo y explica qué falta si sigue mal.
                  disabled={emitir.isPending}
                  className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {enCurso && <Loader2 className="w-3 h-3 animate-spin" />}
                  {r.tieneCertificado ? 'Renovar' : 'Activar HTTPS'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Nota deliberada: la versión anterior de este proceso exigía desactivar el proxy de
          Cloudflare antes de emitir. No hace falta —la ruta de validación se reenvía al
          origen, verificado en producción— y apagarlo deja la IP del servidor expuesta
          mientras dura, o indefinidamente si alguien olvida reactivarlo. */}
      <p className="text-[11px] text-muted-foreground pt-1 border-t border-border">
        La emisión no requiere desactivar ningún proxy o CDN. Sólo que el dominio apunte a
        este servidor y que el puerto 80 esté accesible. La renovación es automática.
      </p>
    </div>
  );
}
