'use client';

import { useEffect } from 'react';

/**
 * Saca al Portal del Cliente del service worker del ERP.
 *
 * El SW se registra con alcance '/' y el portal vive en el mismo origen (modo ruta), así
 * que sin esto intercepta también `/portal/*`. Dos problemas, y el segundo ya ocurrió en
 * producción:
 *
 *   1. Serviría desde caché la deuda, el estado del servicio y las facturas. Un abonado
 *      mirando un saldo viejo reclama por algo que ya pagó.
 *   2. Una respuesta cacheada SOBREVIVE al despliegue que la corrige. Tras arreglar el
 *      bucle de redirección del login, el navegador seguía sirviendo la versión vieja:
 *      el portal "no abría" mientras el servidor respondía en 50 ms.
 *
 * Se desregistra en vez de solo configurar `exclude` en next-pwa porque eso último aplica
 * a partir del siguiente build: no cura los navegadores que YA tienen el worker instalado,
 * que son justamente los que fallan. Esto sí, en cuanto el abonado abre el portal.
 *
 * Efecto lateral aceptado: el service worker del ERP también queda desregistrado en ese
 * navegador. Se vuelve a registrar solo la próxima vez que se abra el panel (next-pwa usa
 * `register: true`), y un abonado rara vez usa el mismo navegador que el operador.
 */
export function SinServiceWorker(): null {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.getRegistrations()
      .then((registros) => Promise.all(registros.map((r) => r.unregister())))
      .catch(() => { /* best-effort: no romper el portal por no poder desregistrar */ });

    // Las cachés sobreviven al desregistro: hay que vaciarlas o el navegador podría
    // seguir sirviendo la respuesta vieja hasta que expire.
    if ('caches' in window) {
      caches.keys()
        .then((claves) => Promise.all(claves.map((c) => caches.delete(c))))
        .catch(() => { /* idem */ });
    }
  }, []);

  return null;
}
