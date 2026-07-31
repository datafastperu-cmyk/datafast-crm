import { describe, it, expect, afterEach } from 'vitest';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios';

import { portalHttp, portalApi, PortalError } from './portal';

// Renovación silenciosa de la sesión del abonado.
//
// Incidente que lo motiva (2026-07-31): el token de acceso dura 30 min y el de refresco
// 12 h, pero `/portal/auth/refresh` existía y NADIE lo llamaba. El abonado quedaba fuera
// a los 30 min de haber entrado — no de inactividad, sino contados desde el login —
// aunque su refresco siguiera vivo. Cambiar la clave del WiFi implica esperar a la ONU,
// y esa espera cruzaba el límite perdiendo lo que estuviera escribiendo.
//
// Estas pruebas ejercitan las tres propiedades de las que depende el arreglo. Sin ellas
// el interceptor es una afirmación sin verificar: el comentario del código prometía
// "una sola renovación en vuelo" y nada lo sostenía.

const adaptadorOriginal = portalHttp.defaults.adapter;

/** Respuesta mínima con la forma que devuelve el backend (`ApiRespuesta`). */
function ok(config: AxiosRequestConfig, data: unknown = { ok: true }): AxiosResponse {
  return {
    data: { success: true, message: '', data, timestamp: '' },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: config as never,
  };
}

function noAutorizado(config: AxiosRequestConfig): Promise<never> {
  const error = new Error('401') as Error & {
    isAxiosError: boolean;
    config: AxiosRequestConfig;
    response: AxiosResponse;
  };
  error.isAxiosError = true;
  error.config = config;
  error.response = {
    data: { success: false, message: 'Sesión expirada' },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config: config as never,
  };
  return Promise.reject(error);
}

/** Instala un adaptador falso y devuelve la bitácora de URLs pedidas. */
function instalarAdaptador(fn: AxiosAdapter): string[] {
  const llamadas: string[] = [];
  portalHttp.defaults.adapter = ((config: AxiosRequestConfig) => {
    llamadas.push(config.url ?? '');
    return fn(config as never);
  }) as AxiosAdapter;
  return llamadas;
}

afterEach(() => {
  portalHttp.defaults.adapter = adaptadorOriginal;
});

describe('interceptor de renovación de sesión del portal', () => {
  it('renueva y reintenta la petición original cuando el acceso venció', async () => {
    let meFallado = false;

    const llamadas = instalarAdaptador((config) => {
      const url = config.url ?? '';
      if (url.includes('/auth/refresh')) return Promise.resolve(ok(config));
      // El primer /me llega con el acceso vencido; tras renovar, funciona.
      if (!meFallado) { meFallado = true; return noAutorizado(config); }
      return Promise.resolve(ok(config, { clienteId: 'abc' }));
    });

    const perfil = await portalApi.me();

    // El abonado recibe su perfil: no vio ningún error ni fue al login.
    expect(perfil).toEqual({ clienteId: 'abc' });
    expect(llamadas).toEqual(['/me', '/auth/refresh', '/me']);
  });

  it('renueva UNA sola vez aunque varias peticiones fallen a la vez', async () => {
    // Al abrir el dashboard se disparan varias consultas en paralelo y todas ven el 401
    // simultáneamente. N refrescos concurrentes rotarían el token N veces y los últimos
    // reintentos irían con una cookie ya sustituida.
    const vencidas = new Set<string>();

    const llamadas = instalarAdaptador((config) => {
      const url = config.url ?? '';
      if (url.includes('/auth/refresh')) {
        // Renovación lenta a propósito: mantiene la ventana abierta para que las otras
        // peticiones fallen mientras esta sigue en vuelo.
        return new Promise((resolve) => setTimeout(() => resolve(ok(config)), 20));
      }
      if (!vencidas.has(url)) { vencidas.add(url); return noAutorizado(config); }
      return Promise.resolve(ok(config, { url }));
    });

    await Promise.all([
      portalApi.me(),
      portalApi.config(),
      portalApi.soporte(),
    ]);

    const refrescos = llamadas.filter((u) => u.includes('/auth/refresh'));
    expect(refrescos).toHaveLength(1);
  });

  it('no intenta renovar cuando el 401 viene del propio login', async () => {
    // Un 401 en /auth/* ES el veredicto. Reintentarlo sería un bucle contra el endpoint
    // que acaba de rechazarnos, y le mostraría al abonado una espera en vez de "clave
    // incorrecta".
    const llamadas = instalarAdaptador((config) => noAutorizado(config));

    await expect(portalApi.login('47168769', 'clave-mala')).rejects.toBeInstanceOf(PortalError);

    expect(llamadas).toEqual(['/auth/login']);
  });

  it('propaga el 401 como error de sesión si la renovación tampoco vale', async () => {
    // Refresco caducado: el abonado debe ir al login, no quedarse en una pantalla que
    // no carga nunca.
    const llamadas = instalarAdaptador((config) => noAutorizado(config));

    const error = await portalApi.me().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PortalError);
    expect((error as PortalError).tipo).toBe('sesion');
    // Se intentó renovar exactamente una vez y no se reintentó en bucle.
    expect(llamadas).toEqual(['/me', '/auth/refresh']);
  });
});
