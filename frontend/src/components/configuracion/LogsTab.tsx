'use client';

import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Terminal, Search, RefreshCcw, Loader2, User, Cpu,
  ChevronLeft, ChevronRight, ShieldAlert,
} from 'lucide-react';

import { auditoriaApi, type FiltrosAuditoria } from '@/lib/api/auditoria';
import { cn } from '@/lib/utils';

/**
 * Log del Sistema: qué pasó, quién lo hizo y cuándo.
 *
 * Esta pantalla mostraba `mockLogs` —datos inventados— mientras la tabla real
 * (`auditoria_logs`) acumulaba 25.000 eventos que nadie podía ver: pagos, cortes
 * automáticos, accesos, emisión de comprobantes.
 *
 * Por defecto se ocultan los ecos de peticiones HTTP que el interceptor escribe para cada
 * request ("POST /api/v1/auth/refresh (2265ms)"). Son el 95% de la tabla y, mezclados con
 * lo demás, hacen imposible encontrar quién cobró o a quién se le cortó el servicio. El
 * interruptor "Peticiones técnicas" los devuelve cuando se está depurando.
 */

// Color por acción: de un vistazo hay que distinguir un cobro de un corte o de un borrado.
// No se usan "niveles" (info/warning/error) porque la tabla no los tiene y asignarlos a
// ojo sería inventar una severidad que nadie ha decidido.
const ACCION_STYLE: Record<string, string> = {
  LOGIN:               'bg-emerald-500/10 text-emerald-500',
  LOGIN_FAIL:          'bg-red-500/10 text-red-500',
  CREATE:              'bg-blue-500/10 text-blue-500',
  UPDATE:              'bg-amber-500/10 text-amber-500',
  DELETE:              'bg-red-500/10 text-red-500',
  AUTO_SUSPEND:        'bg-red-500/10 text-red-500',
  AUTO_REACTIVATE:     'bg-emerald-500/10 text-emerald-500',
  BULK_INVOICE:        'bg-violet-500/10 text-violet-500',
  GENERATE_MONTHLY:    'bg-violet-500/10 text-violet-500',
  AUTO_GENERATE_DAILY: 'bg-violet-500/10 text-violet-500',
  // Cambios de estado del servicio (historial de contratos)
  ESTADO:              'bg-amber-500/10 text-amber-500',
  ESTADO_AUTO:         'bg-amber-500/10 text-amber-500',
  // Mensajería: el estado de entrega ES el evento
  MSG_ENVIADO:         'bg-emerald-500/10 text-emerald-500',
  MSG_ENTREGADO:       'bg-emerald-500/10 text-emerald-500',
  MSG_LEIDO:           'bg-emerald-500/10 text-emerald-500',
  MSG_ENCOLADO:        'bg-blue-500/10 text-blue-500',
  MSG_EN_PROCESO:      'bg-blue-500/10 text-blue-500',
  MSG_NO_ENVIADO:      'bg-orange-500/10 text-orange-500',
  MSG_FALLIDO:         'bg-red-500/10 text-red-500',
};

// De qué tabla viene cada evento. Se muestra para que quede claro que el Log reúne varias
// fuentes y no todo sale del mismo sitio.
const FUENTE_LABEL: Record<string, string> = {
  auditoria:    'Auditoría',
  contrato:     'Servicio',
  notificacion: 'Mensaje',
};

const LIMITE = 50;

export function LogsTab() {
  const [search, setSearch]     = useState('');
  const [modulo, setModulo]     = useState('');
  const [accion, setAccion]     = useState('');
  const [origen, setOrigen]     = useState<'' | 'usuario' | 'sistema'>('');
  const [tecnicas, setTecnicas] = useState(false);
  const [page, setPage]         = useState(1);
  const [auto, setAuto]         = useState(true);

  const filtros: FiltrosAuditoria = {
    search:      search || undefined,
    modulo:      modulo || undefined,
    accion:      accion || undefined,
    origen:      origen || undefined,
    soloNegocio: !tecnicas,
    page,
    limit:       LIMITE,
  };

  const { data: resumen } = useQuery({
    queryKey: ['auditoria-resumen'],
    queryFn:  auditoriaApi.getResumen,
    refetchInterval: auto ? 30_000 : false,
  });

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['auditoria-logs', filtros],
    queryFn:  () => auditoriaApi.getLogs(filtros),
    refetchInterval: auto ? 15_000 : false,
    placeholderData: keepPreviousData,
  });

  const logs    = data?.data ?? [];
  const total   = data?.total ?? 0;
  const paginas = data?.totalPages ?? 1;

  const fmtFecha = (iso: string) =>
    new Date(iso).toLocaleString('es-PE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

  // Cambiar cualquier filtro vuelve a la primera página: si no, se consulta una página que
  // ya no existe y la pantalla aparece vacía sin motivo aparente.
  const cambiarFiltro = (fn: () => void) => { fn(); setPage(1); };

  return (
    <div className="space-y-5">

      {/* Cifras reales: cuánto pasó hoy, cuánto lo hizo una persona y cuánto el sistema */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Eventos hoy',           value: resumen?.hoy ?? 0,                   color: 'text-foreground', bg: 'bg-muted/50' },
          { label: 'Hechos por usuarios',   value: resumen?.hoyUsuarios ?? 0,           color: 'text-blue-400',   bg: 'bg-blue-500/8' },
          { label: 'Hechos por el sistema', value: resumen?.hoySistema ?? 0,            color: 'text-violet-400', bg: 'bg-violet-500/8' },
          // Un aviso de corte que nunca salió importa tanto como el corte: si el gateway
          // de mensajería está caído, el ERP cree que avisa a los abonados y no avisa.
          { label: 'Mensajes sin entregar',  value: resumen?.mensajesNoEntregados ?? 0,  color: 'text-orange-400', bg: 'bg-orange-500/8' },
          { label: 'Accesos fallidos (7d)',  value: resumen?.accesosFallidosSemana ?? 0, color: 'text-red-400',    bg: 'bg-red-500/8' },
        ].map((s) => (
          <div key={s.label} className={cn('border border-border rounded-xl p-4', s.bg)}>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => cambiarFiltro(() => setSearch(e.target.value))}
            placeholder="Buscar por descripción, usuario o id…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          {([['', 'Todos'], ['usuario', 'Personas'], ['sistema', 'Sistema']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => cambiarFiltro(() => setOrigen(v as '' | 'usuario' | 'sistema'))}
              className={cn(
                'text-xs px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap',
                origen === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >{label}</button>
          ))}
        </div>

        <select
          value={modulo}
          onChange={(e) => cambiarFiltro(() => setModulo(e.target.value))}
          className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todos los módulos</option>
          {(resumen?.modulos ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>

        <select
          value={accion}
          onChange={(e) => cambiarFiltro(() => setAccion(e.target.value))}
          className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todas las acciones</option>
          {(resumen?.acciones ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        <button
          onClick={() => setAuto((a) => !a)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
            auto
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-muted text-muted-foreground border border-border',
          )}
        >
          <RefreshCcw className={cn('w-3.5 h-3.5', auto && isFetching && 'animate-spin')} />
          {auto ? 'Auto' : 'Pausado'}
        </button>
      </div>

      {/* Peticiones técnicas: fuera por defecto, a mano cuando se depura */}
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={tecnicas}
          onChange={(e) => cambiarFiltro(() => setTecnicas(e.target.checked))}
          className="w-3.5 h-3.5 accent-blue-600"
        />
        Mostrar peticiones técnicas (cada llamada HTTP
        {resumen ? `: ${resumen.peticionesTecnicas.toLocaleString('es-PE')} registros` : ''})
        <span className="text-muted-foreground/60 ml-1">
          · El log reúne auditoría, cambios de estado del servicio y mensajes enviados
        </span>
      </label>

      {/* Listado */}
      <div className="bg-muted/20 border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Terminal className="w-3.5 h-3.5" />
            <span>Actividad del sistema</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{total.toLocaleString('es-PE')} eventos</span>
          </div>
          {auto && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="status-dot-online" />
              En vivo
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Cargando actividad…
          </div>
        ) : !logs.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <ShieldAlert className="w-9 h-9 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">Sin eventos con estos filtros</p>
            <p className="text-xs text-muted-foreground">Prueba a quitar filtros o a ampliar la búsqueda.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold whitespace-nowrap">Fecha</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Quién</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Origen</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Módulo</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Acción</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Qué ocurrió</th>
                  <th className="text-left px-4 py-2.5 font-semibold">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {logs.map((l) => {
                  const esSistema = !l.usuario_email;
                  return (
                    <tr key={l.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2 text-[11px] text-muted-foreground whitespace-nowrap font-mono">
                        {fmtFecha(l.created_at)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={cn(
                          'inline-flex items-center gap-1.5 text-[11px]',
                          esSistema ? 'text-violet-400' : 'text-foreground',
                        )}>
                          {esSistema ? <Cpu className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                          {l.usuario_email || 'Sistema'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[10px] text-muted-foreground/70 whitespace-nowrap">
                        {FUENTE_LABEL[l.fuente ?? 'auditoria'] ?? l.fuente}
                      </td>
                      <td className="px-4 py-2 text-[11px] text-muted-foreground capitalize">{l.modulo}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-bold',
                          ACCION_STYLE[l.accion] ?? 'bg-muted text-muted-foreground',
                        )}>
                          {l.accion}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[12px] text-foreground">
                        {l.descripcion}
                        {/* El registro guarda un UUID; el nombre se resuelve al leer para
                            que el operador sepa a quién le pasó. */}
                        {l.entidad_nombre && (
                          <span className="ml-1.5 text-[11px] text-muted-foreground">
                            → {l.entidad_nombre}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-[11px] text-muted-foreground font-mono">
                        {l.ip_address ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {paginas > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
            <span className="text-xs text-muted-foreground">Página {page} de {paginas}</span>
            <div className="flex gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="p-1.5 rounded border border-border disabled:opacity-40 hover:bg-accent"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={page >= paginas}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-border disabled:opacity-40 hover:bg-accent"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => void refetch()}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Actualizar ahora
      </button>
    </div>
  );
}
