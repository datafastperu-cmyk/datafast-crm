'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  MessageSquare, Search, Send, Loader2,
  Wifi, WifiOff, RefreshCw, CheckCheck, User,
  Download, X, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';

const MEDIA_EXT_RE = /\.(jpg|jpeg|png|gif|webp|ogg|mp3|m4a|wav|mp4)(\?.*)?$/i;
const AUDIO_EXT_RE = /\.(ogg|mp3|m4a|wav)(\?.*)?$/i;

function extractFilename(raw: string): string | null {
  const name = raw.includes('://') ? raw.split('/').pop()!.split('?')[0] : raw;
  return MEDIA_EXT_RE.test(name) ? name : null;
}

function AuthedMedia({ raw }: { raw: string }) {
  const filename = extractFilename(raw);
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [failed,  setFailed]  = React.useState(false);
  const [open,       setOpen]      = React.useState(false);
  const [zoom,       setZoom]      = React.useState(1);
  const [offset,     setOffset]    = React.useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const dragRef  = React.useRef(false);
  const startRef = React.useRef({ mx: 0, my: 0, ox: 0, oy: 0 });

  const zoomIn    = () => setZoom(z => Math.min(z + 0.25, 4));
  const zoomOut   = () => setZoom(z => Math.max(z - 0.25, 0.25));
  const zoomReset = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };
  const closeModal = () => { setOpen(false); setZoom(1); setOffset({ x: 0, y: 0 }); };

  // ── Drag: mouse ─────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    dragRef.current  = true;
    setIsDragging(true);
    startRef.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setOffset({
      x: startRef.current.ox + (e.clientX - startRef.current.mx),
      y: startRef.current.oy + (e.clientY - startRef.current.my),
    });
  };
  const onMouseUp = () => { dragRef.current = false; setIsDragging(false); };

  // ── Drag: touch ──────────────────────────────────────────
  const onTouchStart = (e: React.TouchEvent) => {
    if (zoom <= 1) return;
    dragRef.current  = true;
    startRef.current = { mx: e.touches[0].clientX, my: e.touches[0].clientY, ox: offset.x, oy: offset.y };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    setOffset({
      x: startRef.current.ox + (e.touches[0].clientX - startRef.current.mx),
      y: startRef.current.oy + (e.touches[0].clientY - startRef.current.my),
    });
  };
  const onTouchEnd = () => { dragRef.current = false; };

  React.useEffect(() => {
    if (!filename) { setFailed(true); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/crm-nativo/media/${encodeURIComponent(filename)}`, { responseType: 'blob' });
        if (!cancelled) setBlobUrl(URL.createObjectURL(res.data as Blob));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [filename]);

  const handleDownload = React.useCallback(() => {
    if (!blobUrl || !filename) return;
    const a = document.createElement('a');
    a.href    = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [blobUrl, filename]);

  if (failed || !filename) return null;
  if (!blobUrl) return <div className="w-32 h-20 bg-muted rounded-lg animate-pulse" />;

  const isAudio = AUDIO_EXT_RE.test(filename);
  if (isAudio) return <audio controls src={blobUrl} className="max-w-xs w-full" />;

  return (
    <>
      {/* Miniatura clicable */}
      <div className="relative group cursor-pointer" onClick={() => setOpen(true)}>
        <img
          src={blobUrl}
          alt="Imagen"
          className="max-w-[200px] max-h-[160px] w-auto h-auto object-cover rounded-xl shadow-md border border-white/10"
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 rounded-xl">
          <ZoomIn className="w-6 h-6 text-white drop-shadow-lg" />
        </div>
      </div>

      {/* Modal flotante */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm p-4"
          onClick={closeModal}
        >
          <div
            className="relative bg-zinc-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-w-[92vw] max-h-[92vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* Barra superior */}
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-zinc-800 shrink-0">
              <span className="text-xs text-zinc-400 font-mono truncate max-w-[160px]">{filename}</span>
              <div className="flex items-center gap-1">
                {/* Controles de zoom */}
                <button
                  onClick={zoomOut}
                  disabled={zoom <= 0.25}
                  className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition disabled:opacity-30"
                  title="Alejar"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={zoomReset}
                  className="px-2 py-1 text-xs font-mono text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition min-w-[44px] text-center"
                  title="Restablecer zoom"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  onClick={zoomIn}
                  disabled={zoom >= 4}
                  className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition disabled:opacity-30"
                  title="Acercar"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={zoomReset}
                  className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition"
                  title="Ajustar a pantalla"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>

                <div className="w-px h-5 bg-zinc-700 mx-1" />

                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 active:scale-95 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar
                </button>
                <button
                  onClick={closeModal}
                  className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition"
                  aria-label="Cerrar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Imagen con zoom + drag */}
            <div
              className="flex items-center justify-center p-4"
              style={{
                minWidth:  '340px',
                minHeight: '200px',
                overflow:  zoom > 1 ? 'hidden' : 'auto',
                cursor:    zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
              }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <img
                src={blobUrl}
                alt="Vista completa"
                className="object-contain rounded-lg select-none"
                style={{
                  transform:       `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition:      isDragging ? 'none' : 'transform 0.15s ease',
                  maxWidth:        zoom <= 1 ? '100%'  : 'none',
                  maxHeight:       zoom <= 1 ? '78vh'  : 'none',
                  userSelect:      'none',
                }}
                draggable={false}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Tipos ────────────────────────────────────────────────────────
type WaEstado = 'INICIANDO' | 'REQUERIDO_QR' | 'CONECTADO' | 'DESCONECTADO';

interface WaStatus {
  estado: WaEstado;
  qr?:    string | null;
}

interface Chat {
  id:             string;
  waChatId:       string;
  telefono:       string;
  nombreContacto: string | null;
  ultimoMensaje:  string | null;
  ultimoMsgAt:    string | null;
  noLeidos:       number;
}

interface Mensaje {
  id:        string;
  direction: 'INBOUND' | 'OUTBOUND';
  agente:    string | null;
  body:      string;
  mediaUrl?: string | null;
  createdAt: string;
}

// ── URL del WebSocket ────────────────────────────────────────────
// Usa window.location.origin para que nginx proxee /socket.io/ → :4000
// Sin NEXT_PUBLIC_API_URL, conectar a :4000 directo rompe el proxy SSL.
const WS_URL = (() => {
  if (typeof window === 'undefined') return 'http://localhost:4000';
  const api = process.env.NEXT_PUBLIC_API_URL;
  if (api) return api.replace(/\/api\/v1\/?$/, '');
  return window.location.origin;
})();

// ── Input estilo app ─────────────────────────────────────────────
const INPUT_CLS = [
  'w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--sidebar-border))]',
  'bg-[hsl(var(--sidebar-bg))] text-foreground placeholder:text-muted-foreground',
  'focus:outline-none focus:ring-1 focus:ring-primary/50',
].join(' ');

// ── Helpers ──────────────────────────────────────────────────────
function formatHora(iso: string) {
  return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}
function formatFechaRelativa(iso: string | null) {
  if (!iso) return '';
  const d   = new Date(iso);
  const now = new Date();
  const mismo = d.toDateString() === now.toDateString();
  if (mismo) return formatHora(iso);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────
export default function WhatsAppWebPage() {
  const usuario = useAuthStore(s => s.usuario);

  const [socket,    setSocket]    = useState<Socket | null>(null);
  const [status,    setStatus]    = useState<WaStatus>({ estado: 'INICIANDO' });
  const [chats,     setChats]     = useState<Chat[]>([]);
  const [chatActivo, setChatActivo] = useState<Chat | null>(null);
  const [mensajes,  setMensajes]  = useState<Mensaje[]>([]);
  const [busqueda,  setBusqueda]  = useState('');
  const [texto,     setTexto]     = useState('');
  const [enviando,  setEnviando]  = useState(false);
  const [cargando,  setCargando]  = useState(true);

  const mensajesRef = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLInputElement>(null);

  // ── Scroll al fondo de mensajes ──────────────────────────────
  const scrollFondo = useCallback(() => {
    setTimeout(() => {
      mensajesRef.current?.scrollTo({ top: mensajesRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  }, []);

  // ── Cargar mensajes del chat activo ──────────────────────────
  const cargarMensajes = useCallback(async (chat: Chat) => {
    setCargando(true);
    try {
      const { data } = await api.get<{ data: Mensaje[] }>(`/crm-nativo/mensajes/${chat.id}`);
      setMensajes(data.data ?? []);
      scrollFondo();
    } finally {
      setCargando(false);
    }
  }, [scrollFondo]);

  // ── Seleccionar chat ─────────────────────────────────────────
  const seleccionarChat = useCallback((chat: Chat) => {
    setChatActivo(chat);
    socket?.emit('crm:leer_chat', { chatId: chat.id });
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, noLeidos: 0 } : c));
    cargarMensajes(chat);
    inputRef.current?.focus();
  }, [socket, cargarMensajes]);

  // ── Conectar socket.io ────────────────────────────────────────
  useEffect(() => {
    const sock = io(`${WS_URL}/crm-nativo`, {
      transports:         ['websocket', 'polling'],
      reconnectionDelay:  3000,
      reconnectionAttempts: 20,
    });

    sock.on('connect',    () => console.log('[CRM-WS] conectado'));
    sock.on('disconnect', () => console.log('[CRM-WS] desconectado'));

    sock.on('wa:status', (payload: WaStatus) => {
      setStatus(payload);
      if (payload.estado === 'CONECTADO') {
        api.get<{ data: Chat[] }>('/crm-nativo/chats')
          .then(r => setChats(r.data.data ?? []));
      }
    });

    sock.on('wa:chats', (lista: Chat[]) => {
      setChats(lista);
    });

    sock.on('wa:chat_update', (chat: Chat) => {
      setChats(prev => {
        const idx = prev.findIndex(c => c.id === chat.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx]  = chat;
          return next.sort((a, b) =>
            (b.ultimoMsgAt ?? '').localeCompare(a.ultimoMsgAt ?? ''));
        }
        return [chat, ...prev];
      });
    });

    sock.on('wa:mensaje', (evt: { chatId: string; mensaje: Mensaje }) => {
      setChatActivo(prev => {
        if (prev?.id === evt.chatId) {
          setMensajes(m => [...m, evt.mensaje]);
          scrollFondo();
        }
        return prev;
      });
    });

    setSocket(sock);

    // Obtener estado inicial vía REST
    api.get<{ data: WaStatus }>('/crm-nativo/estado')
      .then(r => setStatus(r.data.data))
      .catch(() => {});

    return () => { sock.disconnect(); };
  }, [scrollFondo]);

  // ── Enviar mensaje ────────────────────────────────────────────
  const enviar = async () => {
    if (!texto.trim() || !chatActivo || enviando) return;
    const textoLocal = texto.trim();
    setTexto('');
    setEnviando(true);
    try {
      await api.post('/crm-nativo/enviar', {
        telefono: chatActivo.telefono,
        texto:    textoLocal,
      });
    } catch {
      setTexto(textoLocal);
    } finally {
      setEnviando(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
  };

  // ── Filtrar chats por búsqueda ────────────────────────────────
  const chatsFiltrados = chats.filter(c => {
    const q = busqueda.toLowerCase();
    return !q ||
      (c.nombreContacto ?? '').toLowerCase().includes(q) ||
      c.telefono.includes(q);
  });

  // ── Estado "INICIANDO" ────────────────────────────────────────
  if (status.estado === 'INICIANDO') {
    return (
      <div className="flex items-center justify-center h-[calc(100dvh-120px)]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
          <p className="text-sm">Iniciando cliente WhatsApp Web…</p>
        </div>
      </div>
    );
  }

  // ── Estado "REQUERIDO_QR" ─────────────────────────────────────
  if (status.estado === 'REQUERIDO_QR') {
    return (
      <div className="flex items-center justify-center h-[calc(100dvh-120px)]">
        <div className="bg-card border border-border rounded-2xl p-8 flex flex-col items-center gap-5 max-w-sm w-full shadow-xl">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <MessageSquare className="w-6 h-6 text-emerald-400" />
          </div>
          <div className="text-center">
            <h2 className="text-base font-semibold text-foreground">Vincular WhatsApp Web</h2>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Abre WhatsApp en tu celular → Dispositivos vinculados → Vincular dispositivo → Escanea el QR
            </p>
          </div>
          {status.qr ? (
            <div className="rounded-xl overflow-hidden border-4 border-white shadow-md">
              <img src={status.qr} alt="QR WhatsApp" className="w-56 h-56 object-cover" />
            </div>
          ) : (
            <div className="w-56 h-56 bg-muted rounded-xl flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <p className="text-[10px] text-muted-foreground text-center">
            El QR se renueva automáticamente cada 60 segundos
          </p>
        </div>
      </div>
    );
  }

  // ── Estado "DESCONECTADO" ─────────────────────────────────────
  if (status.estado === 'DESCONECTADO') {
    return (
      <div className="flex items-center justify-center h-[calc(100dvh-120px)]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <WifiOff className="w-8 h-8 text-rose-400" />
          <p className="text-sm font-medium text-foreground">WhatsApp desconectado</p>
          <p className="text-xs">El servidor reconectará automáticamente…</p>
          <Loader2 className="w-4 h-4 animate-spin mt-1" />
        </div>
      </div>
    );
  }

  // ── Estado "CONECTADO" — interfaz completa ────────────────────
  return (
    <div className="flex h-[calc(100dvh-112px)] rounded-xl overflow-hidden border border-border bg-card">

      {/* ── Panel izquierdo: lista de chats ──────────────── */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-border">

        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <Wifi className="w-3 h-3 text-emerald-400" />
          </div>
          <span className="text-xs font-semibold text-foreground flex-1">WhatsApp Web</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
            Conectado
          </span>
        </div>

        {/* Buscador */}
        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar chat…"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className={cn(INPUT_CLS, 'pl-8 py-1.5 text-xs')}
            />
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {chatsFiltrados.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
              <MessageSquare className="w-6 h-6 opacity-30" />
              <p className="text-xs">Sin chats</p>
            </div>
          )}
          {chatsFiltrados.map(chat => (
            <button
              key={chat.id}
              onClick={() => seleccionarChat(chat)}
              className={cn(
                'w-full flex items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-muted/40',
                chatActivo?.id === chat.id && 'bg-primary/8 border-l-2 border-primary',
              )}
            >
              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs font-medium text-foreground truncate">
                    {chat.nombreContacto || `+${chat.telefono}`}
                  </p>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">
                    {formatFechaRelativa(chat.ultimoMsgAt)}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <p className="text-[11px] text-muted-foreground truncate flex-1">
                    {chat.ultimoMensaje || ''}
                  </p>
                  {chat.noLeidos > 0 && (
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {chat.noLeidos > 9 ? '9+' : chat.noLeidos}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Panel derecho: visor de conversación ──────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header del chat activo */}
        {chatActivo ? (
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {chatActivo.nombreContacto || `+${chatActivo.telefono}`}
              </p>
              {/* Solo mostrar teléfono si parece un número real (≤13 dígitos) */}
              {chatActivo.telefono && chatActivo.telefono.length <= 13 && (
                <p className="text-[11px] text-muted-foreground font-mono">+{chatActivo.telefono}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="px-5 py-3 border-b border-border">
            <p className="text-xs text-muted-foreground">Selecciona un chat para comenzar</p>
          </div>
        )}

        {/* Mensajes */}
        <div
          ref={mensajesRef}
          className="flex-1 overflow-y-auto px-5 py-4 space-y-2"
          style={{ backgroundImage: 'radial-gradient(hsl(var(--border)/0.4) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
        >
          {!chatActivo && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <MessageSquare className="w-12 h-12 opacity-10" />
              <p className="text-sm">Selecciona una conversación</p>
            </div>
          )}

          {chatActivo && cargando && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {chatActivo && !cargando && mensajes.length === 0 && (
            <div className="flex justify-center py-8">
              <p className="text-xs text-muted-foreground">Sin mensajes aún</p>
            </div>
          )}

          {mensajes.map((msg) => {
            const esOutbound = msg.direction === 'OUTBOUND';
            return (
              <div key={msg.id} className={cn('flex', esOutbound ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[75%] px-3 py-2 rounded-2xl text-sm shadow-sm',
                  esOutbound
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-card border border-border text-foreground rounded-bl-sm',
                )}>
                  {esOutbound && msg.agente && (
                    <p className="text-[10px] opacity-70 font-medium mb-0.5">{msg.agente}</p>
                  )}
                  {(() => {
                    const raw = msg.mediaUrl || msg.body || '';
                    if (extractFilename(raw)) return <AuthedMedia raw={raw} />;
                    if (msg.body && msg.body !== '[media]') {
                      return (
                        <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                          {msg.body}
                        </p>
                      );
                    }
                    return null;
                  })()}
                  <div className={cn('flex items-center gap-1 mt-0.5', esOutbound ? 'justify-end' : 'justify-start')}>
                    <span className="text-[10px] opacity-60">{formatHora(msg.createdAt)}</span>
                    {esOutbound && <CheckCheck className="w-3 h-3 opacity-60" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Caja de texto */}
        {chatActivo && (
          <div className="px-4 py-3 border-t border-border flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Mensaje como ${usuario?.nombreCompleto ?? 'agente'}…`}
              className={cn(INPUT_CLS, 'flex-1')}
              disabled={enviando}
            />
            <button
              onClick={enviar}
              disabled={!texto.trim() || enviando}
              className={cn(
                'flex items-center justify-center w-9 h-9 rounded-lg transition-colors flex-shrink-0',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              {enviando
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send    className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
