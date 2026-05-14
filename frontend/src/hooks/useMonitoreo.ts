'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getAccessToken } from '@/lib/api';
import type {
  WsEventMedicion, WsEventAlerta, WsEventNodoStatus, WsEventDashboard, Nodo,
} from '@/types';

interface MonitoreoState {
  conectado:   boolean;
  mediciones:  Map<string, WsEventMedicion>;  // nodoId → última medición
  alertas:     WsEventAlerta[];
  dashboard:   WsEventDashboard | null;
  ultimaAlerta: WsEventAlerta | null;
}

interface UseMonitoreoOptions {
  onMedicion?:    (data: WsEventMedicion) => void;
  onAlerta?:      (data: WsEventAlerta) => void;
  onNodoStatus?:  (data: WsEventNodoStatus) => void;
  onDashboard?:   (data: WsEventDashboard) => void;
  nodoIds?:       string[];   // Suscribirse solo a nodos específicos
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000';

export function useMonitoreo(opts: UseMonitoreoOptions = {}) {
  const socketRef = useRef<Socket | null>(null);

  const [state, setState] = useState<MonitoreoState>({
    conectado:   false,
    mediciones:  new Map(),
    alertas:     [],
    dashboard:   null,
    ultimaAlerta: null,
  });

  // ── Conectar WebSocket ─────────────────────────────────────
  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;

    const socket = io(`${WS_URL}/monitoreo`, {
      auth:       { token },
      transports: ['websocket', 'polling'],
      reconnection:          true,
      reconnectionDelay:     2000,
      reconnectionAttempts:  10,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setState((s) => ({ ...s, conectado: true }));

      // Suscribirse a nodos específicos si se indicaron
      if (opts.nodoIds?.length) {
        opts.nodoIds.forEach((id) =>
          socket.emit('monitoreo:subscribe', { nodoId: id }),
        );
      }
    });

    socket.on('disconnect', () => {
      setState((s) => ({ ...s, conectado: false }));
    });

    // ── Medición de nodo ─────────────────────────────────────
    socket.on('monitoreo:medicion', (data: WsEventMedicion) => {
      setState((s) => {
        const nuevas = new Map(s.mediciones);
        nuevas.set(data.nodoId, data);
        return { ...s, mediciones: nuevas };
      });
      opts.onMedicion?.(data);
    });

    // ── Nueva alerta ─────────────────────────────────────────
    socket.on('monitoreo:alerta', (data: WsEventAlerta) => {
      setState((s) => ({
        ...s,
        alertas:      [data, ...s.alertas].slice(0, 50),
        ultimaAlerta: data,
      }));
      opts.onAlerta?.(data);
    });

    // ── Recovery (alerta resuelta) ───────────────────────────
    socket.on('monitoreo:recovery', (data: WsEventAlerta) => {
      setState((s) => ({
        ...s,
        alertas: s.alertas.map((a) =>
          a.alerta?.id === data.alerta?.id ? data : a,
        ),
      }));
      opts.onAlerta?.(data);
    });

    // ── Estado de nodo ───────────────────────────────────────
    socket.on('monitoreo:nodo_status', (data: WsEventNodoStatus) => {
      opts.onNodoStatus?.(data);
    });

    // ── Dashboard broadcast ──────────────────────────────────
    socket.on('monitoreo:dashboard', (data: WsEventDashboard) => {
      setState((s) => ({ ...s, dashboard: data }));
      opts.onDashboard?.(data);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Suscribirse a un nodo específico ──────────────────────
  const suscribir = useCallback((nodoId: string) => {
    socketRef.current?.emit('monitoreo:subscribe', { nodoId });
  }, []);

  const desuscribir = useCallback((nodoId: string) => {
    socketRef.current?.emit('monitoreo:unsubscribe', { nodoId });
  }, []);

  // ── Obtener medición de un nodo ───────────────────────────
  const getMedicion = useCallback(
    (nodoId: string) => state.mediciones.get(nodoId) ?? null,
    [state.mediciones],
  );

  return {
    ...state,
    suscribir,
    desuscribir,
    getMedicion,
    socket: socketRef.current,
  };
}
