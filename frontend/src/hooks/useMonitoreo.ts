'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getAccessToken } from '@/lib/api';
import type {
  WsEventMedicion, WsEventAlerta, WsEventNodoStatus, WsEventDashboard,
} from '@/types';

interface MonitoreoState {
  conectado:    boolean;
  mediciones:   Map<string, WsEventMedicion>;
  alertas:      WsEventAlerta[];
  dashboard:    WsEventDashboard | null;
  ultimaAlerta: WsEventAlerta | null;
}

interface UseMonitoreoOptions {
  onMedicion?:   (data: WsEventMedicion) => void;
  onAlerta?:     (data: WsEventAlerta) => void;
  onNodoStatus?: (data: WsEventNodoStatus) => void;
  onDashboard?:  (data: WsEventDashboard) => void;
  nodoIds?:      string[];
}

// Derive WS URL from current browser origin — works on any domain/IP.
// Local dev only: set NEXT_PUBLIC_WS_URL=http://localhost:4000 in .env.local
function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === 'undefined') return 'http://localhost:4000';
  return `${window.location.protocol}//${window.location.host}`;
}
const WS_URL = getWsUrl();

export function useMonitoreo(opts: UseMonitoreoOptions = {}) {
  const socketRef = useRef<Socket | null>(null);

  // Stable refs for callbacks — avoids stale closure without re-creating socket
  const onMedicionRef   = useRef(opts.onMedicion);
  const onAlertaRef     = useRef(opts.onAlerta);
  const onNodoStatusRef = useRef(opts.onNodoStatus);
  const onDashboardRef  = useRef(opts.onDashboard);

  useEffect(() => { onMedicionRef.current   = opts.onMedicion;   }, [opts.onMedicion]);
  useEffect(() => { onAlertaRef.current     = opts.onAlerta;     }, [opts.onAlerta]);
  useEffect(() => { onNodoStatusRef.current = opts.onNodoStatus; }, [opts.onNodoStatus]);
  useEffect(() => { onDashboardRef.current  = opts.onDashboard;  }, [opts.onDashboard]);

  const [state, setState] = useState<MonitoreoState>({
    conectado:    false,
    mediciones:   new Map(),
    alertas:      [],
    dashboard:    null,
    ultimaAlerta: null,
  });

  // ── Conectar WebSocket ─────────────────────────────────────
  useEffect(() => {
    const token = getAccessToken();
    if (!token) return undefined;

    const socket = io(`${WS_URL}/monitoreo`, {
      auth:                  { token },
      transports:            ['websocket', 'polling'],
      reconnection:          true,
      reconnectionDelay:     2000,
      reconnectionAttempts:  10,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setState((s) => ({ ...s, conectado: true }));
      if (opts.nodoIds?.length) {
        opts.nodoIds.forEach((id) => socket.emit('monitoreo:subscribe', { nodoId: id }));
      }
    });

    socket.on('disconnect', () => setState((s) => ({ ...s, conectado: false })));

    socket.on('monitoreo:medicion', (data: WsEventMedicion) => {
      setState((s) => {
        const nuevas = new Map(s.mediciones);
        nuevas.set(data.nodoId, data);
        return { ...s, mediciones: nuevas };
      });
      onMedicionRef.current?.(data);
    });

    socket.on('monitoreo:alerta', (data: WsEventAlerta) => {
      setState((s) => ({
        ...s,
        alertas:      [data, ...s.alertas].slice(0, 50),
        ultimaAlerta: data,
      }));
      onAlertaRef.current?.(data);
    });

    socket.on('monitoreo:recovery', (data: WsEventAlerta) => {
      setState((s) => ({
        ...s,
        alertas: s.alertas.map((a) => a.alerta?.id === data.alerta?.id ? data : a),
      }));
      onAlertaRef.current?.(data);
    });

    socket.on('monitoreo:nodo_status', (data: WsEventNodoStatus) => {
      onNodoStatusRef.current?.(data);
    });

    socket.on('monitoreo:dashboard', (data: WsEventDashboard) => {
      setState((s) => ({ ...s, dashboard: data }));
      onDashboardRef.current?.(data);
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
