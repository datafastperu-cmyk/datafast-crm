'use client';

import { Navigation } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Construye el enlace de navegación adecuado al dispositivo.
 *
 * El ERP NO traza la ruta: la delega a la app de mapas del propio equipo. El técnico no
 * quiere ver una línea en la pantalla del ERP, quiere navegación por voz mientras
 * conduce — con tráfico en tiempo real y calles actualizadas, cosas que nosotros nunca
 * mantendríamos al día.
 *
 * Importante: enlazar a Google Maps NO es usar su API. Es un hipervínculo — gratis, sin
 * clave, sin cuota y sin restricción de términos. Prescindir de la *API* de Google (que es
 * lo que ya hicimos con las teselas) es compatible con ofrecer este enlace.
 */
export function urlComoLlegar(lat: number, lng: number, etiqueta?: string): string {
  const destino = `${lat},${lng}`;

  if (typeof navigator === 'undefined') {
    return `https://www.google.com/maps/dir/?api=1&destination=${destino}`;
  }

  const ua = navigator.userAgent;

  // Android: el esquema `geo:` abre el SELECTOR del sistema, así que el técnico usa la app
  // que ya tiene configurada —Waze, Google Maps, Organic Maps— en vez de la que nosotros
  // elijamos por él. El parámetro `q` con etiqueta hace que el destino aparezca con nombre.
  if (/Android/i.test(ua)) {
    const q = etiqueta ? `${destino}(${encodeURIComponent(etiqueta)})` : destino;
    return `geo:${destino}?q=${q}`;
  }

  // iOS: Apple Maps es la que está garantizada en el dispositivo. `maps://` la abre
  // directamente; si el usuario tiene Google Maps la puede compartir desde ahí.
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return `maps://?daddr=${destino}&dirflg=d`;
  }

  // Escritorio: pestaña del navegador. Google Maps por cobertura de rutas en Perú, que es
  // notablemente mejor que la de OSRM en calles secundarias.
  return `https://www.google.com/maps/dir/?api=1&destination=${destino}`;
}

interface Props {
  latitud?: number | null;
  longitud?: number | null;
  etiqueta?: string;
  className?: string;
  /** `icono` para usarlo dentro de tarjetas apretadas, sin texto. */
  variante?: 'texto' | 'icono';
}

export function BotonComoLlegar({
  latitud, longitud, etiqueta, className, variante = 'texto',
}: Props) {
  // Sin coordenada no hay a dónde llegar. Se omite en vez de mostrarse deshabilitado: un
  // botón gris que no explica nada sólo genera clics inútiles.
  if (latitud == null || longitud == null) return null;

  const href = urlComoLlegar(Number(latitud), Number(longitud), etiqueta);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // `stopPropagation`: estos botones viven dentro de tarjetas que abren un detalle al
      // hacer clic. Sin esto, pedir la ruta abriría además el modal.
      onClick={(e) => e.stopPropagation()}
      title={`Cómo llegar a ${etiqueta ?? 'este punto'}`}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline',
        className,
      )}
    >
      <Navigation className="w-3.5 h-3.5 shrink-0" />
      {variante === 'texto' && 'Cómo llegar'}
    </a>
  );
}
