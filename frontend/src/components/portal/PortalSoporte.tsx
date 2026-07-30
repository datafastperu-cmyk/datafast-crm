'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LifeBuoy, Loader2, AlertTriangle, CheckCircle2, Clock, Star, Plus,
} from 'lucide-react';

import { portalApi, PortalError, type PortalTicket } from '@/lib/api/portal';
import { useServicioActual } from './useServicioActual';
import { cn } from '@/lib/utils';

const ESTADO_LABEL: Record<string, string> = {
  abierto:            'Recibido',
  en_progreso:        'En atención',
  pendiente_cliente:  'Esperamos tu respuesta',
  pendiente_tecnico:  'Con el técnico',
  resuelto:           'Resuelto',
  cerrado:            'Cerrado',
  cancelado:          'Cancelado',
};

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-PE');

export function PortalSoporte() {
  const queryClient = useQueryClient();
  const { servicio } = useServicioActual();
  const [abrirForm, setAbrirForm] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-soporte'],
    queryFn:  portalApi.soporte,
  });

  if (isLoading || !servicio) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-card border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
        <p className="text-sm text-foreground">
          {error instanceof PortalError ? error.message : 'No pudimos cargar tus solicitudes.'}
        </p>
      </div>
    );
  }

  const tickets = data?.tickets ?? [];

  return (
    <div className="space-y-4">
      {abrirForm ? (
        <FormularioTicket
          contratoId={servicio.contratoId}
          categorias={data?.categorias ?? []}
          onCerrar={() => setAbrirForm(false)}
          onCreado={() => {
            setAbrirForm(false);
            queryClient.invalidateQueries({ queryKey: ['portal-soporte'] });
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAbrirForm(true)}
          className={cn(
            'w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl',
            'text-sm font-medium bg-primary text-primary-foreground',
            'hover:opacity-90 transition-opacity',
          )}
        >
          <Plus className="w-4 h-4" />
          Solicitar soporte
        </button>
      )}

      {tickets.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-2">
          <LifeBuoy className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            No tienes solicitudes de soporte. Si algo no funciona, cuéntanos.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {tickets.map((t) => <TarjetaTicket key={t.id} ticket={t} />)}
        </ul>
      )}
    </div>
  );
}

function FormularioTicket({
  contratoId, categorias, onCerrar, onCreado,
}: {
  contratoId: string;
  categorias: Array<{ id: string; label: string }>;
  onCerrar: () => void;
  onCreado: () => void;
}) {
  const [categoria, setCategoria]     = useState(categorias[0]?.id ?? '');
  const [descripcion, setDescripcion] = useState('');
  const [error, setError]             = useState<string | null>(null);

  const { mutate: crear, isPending } = useMutation({
    mutationFn: () => portalApi.crearTicket({ contratoId, categoria, descripcion: descripcion.trim() }),
    onSuccess: onCreado,
    onError: (e) =>
      setError(e instanceof PortalError ? e.message : 'No pudimos registrar tu solicitud.'),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <p className="text-sm font-semibold text-foreground">¿Qué está pasando?</p>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Motivo</label>
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className={campo()}
        >
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Cuéntanos con detalle</label>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          maxLength={1000}
          className={cn(campo(), 'min-h-[120px] resize-y')}
          placeholder="Ej.: desde ayer en la noche no tengo internet en ningún equipo. El router tiene la luz roja."
        />
        {/* El mínimo evita el "no funciona" que obliga a llamar al abonado para
            entender qué pasa. */}
        <p className="text-xs text-muted-foreground">
          Mínimo 10 caracteres. Mientras más nos cuentes, más rápido resolvemos.
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive flex items-start gap-1.5">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => crear()}
          disabled={isPending || descripcion.trim().length < 10 || !categoria}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
            'bg-primary text-primary-foreground hover:opacity-90 transition-opacity',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Enviar solicitud
        </button>
        <button
          type="button"
          onClick={onCerrar}
          disabled={isPending}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-foreground hover:opacity-90"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function TarjetaTicket({ ticket }: { ticket: PortalTicket }) {
  const queryClient = useQueryClient();
  const [calificando, setCalificando] = useState(false);

  const { mutate: calificar, isPending } = useMutation({
    mutationFn: (estrellas: number) => portalApi.calificarTicket(ticket.id, { calificacion: estrellas }),
    onSuccess: () => {
      setCalificando(false);
      queryClient.invalidateQueries({ queryKey: ['portal-soporte'] });
    },
  });

  const cerrado = !ticket.abierto;
  const puedeCalificar = cerrado && ticket.calificacion === null &&
    (ticket.estado === 'resuelto' || ticket.estado === 'cerrado');

  return (
    <li className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{ticket.titulo}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {ticket.numero} · {fechaHora(ticket.creadoEn)}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium flex-shrink-0',
            cerrado
              ? 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30'
              : 'text-amber-700 bg-amber-500/10 border-amber-500/30',
          )}
        >
          {cerrado ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
          {ESTADO_LABEL[ticket.estado] ?? ticket.estado}
        </span>
      </div>

      <p className="text-sm text-muted-foreground whitespace-pre-line">{ticket.descripcion}</p>

      {ticket.solucion && (
        <div className="rounded-lg bg-muted/60 p-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Respuesta
          </p>
          <p className="text-sm text-foreground mt-1 whitespace-pre-line">{ticket.solucion}</p>
        </div>
      )}

      {ticket.calificacion !== null && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          Calificaste esta atención con {ticket.calificacion} de 5
          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
        </p>
      )}

      {/* Solo se califica lo que ya se cerró: pedir una nota sobre un trabajo en curso
          presiona al técnico por algo que todavía no terminó. */}
      {puedeCalificar && (
        calificando ? (
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                disabled={isPending}
                onClick={() => calificar(n)}
                aria-label={`Calificar con ${n}`}
                className="p-1 text-muted-foreground hover:text-amber-400 disabled:opacity-50"
              >
                <Star className="w-5 h-5" />
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCalificando(true)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Calificar la atención
          </button>
        )
      )}
    </li>
  );
}

function campo() {
  return cn(
    'w-full px-3 py-2.5 text-sm rounded-lg border border-input bg-background',
    'placeholder:text-muted-foreground transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
  );
}
