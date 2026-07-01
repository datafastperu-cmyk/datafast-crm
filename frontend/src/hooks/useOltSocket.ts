'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getAccessToken } from '@/lib/api';

// ─── Tipos de payload WebSocket ──────────────────────────────

export interface OltSyncProgressEvent {
  oltId:    string;
  jobId:    string;
  progreso: number;
  etapa:    string;
}

export interface OltSyncCompletedEvent {
  oltId:     string;
  jobId:     string;
  resultado: Record<string, unknown>;
}

export interface OltSyncErrorEvent {
  oltId:  string;
  jobId:  string;
  error:  string;
}

export type SyncState =
  | { fase: 'idle' }
  | { fase: 'running'; progreso: number; etapa: string; jobId: string }
  | { fase: 'completed'; resultado: Record<string, unknown>; jobId: string }
  | { fase: 'failed'; error: string; jobId: string };

// ─────────────────────────────────────────────────────────────

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === 'undefined') return 'http://localhost:4000';
  return `${window.location.protocol}//${window.location.host}`;
}

interface UseOltSocketOptions {
  onProgress?:  (data: OltSyncProgressEvent)   => void;
  onCompleted?: (data: OltSyncCompletedEvent)  => void;
  onError?:     (data: OltSyncErrorEvent)      => void;
}

/**
 * Hook WebSocket para el namespace /olt.
 * Se suscribe a la sala olt:{oltId} y expone el estado del sync en curso.
 * Solo conecta cuando oltId está definido.
 */
export function useOltSocket(oltId: string | undefined, opts: UseOltSocketOptions = {}) {
  const socketRef    = useRef<Socket | null>(null);
  const [conectado, setConectado] = useState(false);
  const [sync, setSync]           = useState<SyncState>({ fase: 'idle' });

  const onProgressRef  = useRef(opts.onProgress);
  const onCompletedRef = useRef(opts.onCompleted);
  const onErrorRef     = useRef(opts.onError);

  useEffect(() => { onProgressRef.current  = opts.onProgress;  }, [opts.onProgress]);
  useEffect(() => { onCompletedRef.current = opts.onCompleted; }, [opts.onCompleted]);
  useEffect(() => { onErrorRef.current     = opts.onError;     }, [opts.onError]);

  useEffect(() => {
    if (!oltId) return undefined;
    const token = getAccessToken();
    if (!token) return undefined;

    const wsUrl = getWsUrl();
    const socket = io(`${wsUrl}/olt`, {
      auth:                 { token },
      transports:           ['websocket', 'polling'],
      reconnection:         true,
      reconnectionDelay:    2000,
      reconnectionAttempts: 10,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConectado(true);
      socket.emit('olt:subscribe', { oltId });
    });

    socket.on('disconnect', () => setConectado(false));

    socket.on('olt:sync:progress', (data: OltSyncProgressEvent) => {
      if (data.oltId !== oltId) return;
      setSync({ fase: 'running', progreso: data.progreso, etapa: data.etapa, jobId: data.jobId });
      onProgressRef.current?.(data);
    });

    socket.on('olt:sync:completed', (data: OltSyncCompletedEvent) => {
      if (data.oltId !== oltId) return;
      setSync({ fase: 'completed', resultado: data.resultado, jobId: data.jobId });
      onCompletedRef.current?.(data);
    });

    socket.on('olt:sync:error', (data: OltSyncErrorEvent) => {
      if (data.oltId !== oltId) return;
      setSync({ fase: 'failed', error: data.error, jobId: data.jobId });
      onErrorRef.current?.(data);
    });

    return () => {
      socket.emit('olt:unsubscribe', { oltId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [oltId]); // re-conecta si cambia el oltId

  const resetSync = () => setSync({ fase: 'idle' });

  return { conectado, sync, resetSync };
}
