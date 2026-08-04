import { describe, it, expect, afterEach, vi } from 'vitest';
import { urlComoLlegar } from '@/components/planta-externa/BotonComoLlegar';

/**
 * Enlace de navegación hacia un punto de la planta.
 *
 * El ERP no traza rutas: delega en la app de mapas del dispositivo. El técnico quiere
 * navegación por voz mientras conduce, con tráfico real y calles actualizadas — cosas que
 * este proyecto nunca mantendría al día.
 */
const LAT = -12.0464;
const LNG = -77.0428;

function conUserAgent(ua: string) {
  vi.stubGlobal('navigator', { userAgent: ua });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('urlComoLlegar', () => {

  it('Android usa el esquema geo:, que abre el SELECTOR del sistema', () => {
    // Deliberado: así el técnico navega con la app que YA tiene configurada —Waze,
    // Google Maps, Organic Maps— en vez de la que nosotros elijamos por él.
    conUserAgent('Mozilla/5.0 (Linux; Android 13; SM-A536E)');
    const url = urlComoLlegar(LAT, LNG);
    expect(url.startsWith('geo:')).toBe(true);
    expect(url).toContain(`${LAT},${LNG}`);
  });

  it('Android incluye la etiqueta para que el destino aparezca con nombre', () => {
    conUserAgent('Mozilla/5.0 (Linux; Android 13)');
    expect(urlComoLlegar(LAT, LNG, 'NAP-042')).toContain('NAP-042');
  });

  it('la etiqueta se codifica: un código con espacios o & no puede romper la URL', () => {
    conUserAgent('Mozilla/5.0 (Linux; Android 13)');
    const url = urlComoLlegar(LAT, LNG, 'Mufa Norte & Sur');
    expect(url).toContain('Mufa%20Norte%20%26%20Sur');
    expect(url).not.toContain('Mufa Norte & Sur');
  });

  it('iOS abre Apple Maps, que está garantizada en el dispositivo', () => {
    conUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    const url = urlComoLlegar(LAT, LNG);
    expect(url.startsWith('maps://')).toBe(true);
    expect(url).toContain(`daddr=${LAT},${LNG}`);
  });

  it('escritorio abre una pestaña del navegador', () => {
    conUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const url = urlComoLlegar(LAT, LNG);
    expect(url.startsWith('https://')).toBe(true);
    expect(url).toContain(`destination=${LAT},${LNG}`);
  });

  it('enlazar a Google Maps NO es usar su API: es un hipervinculo sin clave', () => {
    // Distincion que importa: el mapa del ERP dejo de usar teselas de Google por sus
    // terminos, pero un enlace de navegacion es gratis, sin clave y sin cuota. Si alguien
    // ve "google.com" aqui y asume que hay que configurar algo, este test lo aclara.
    conUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const url = urlComoLlegar(LAT, LNG);
    expect(url).not.toContain('key=');
    expect(url).not.toContain('api_key');
  });

  it('funciona en SSR, donde `navigator` no existe', () => {
    // Este componente se renderiza dentro de páginas del dashboard; reventar en el
    // servidor tumbaría la página entera por un botón secundario.
    vi.stubGlobal('navigator', undefined);
    expect(() => urlComoLlegar(LAT, LNG)).not.toThrow();
  });

  it('coordenadas positivas (otros hemisferios) se transmiten intactas', () => {
    conUserAgent('Mozilla/5.0 (Windows NT 10.0)');
    // El ERP se instala en varios paises: asumir signo negativo lo ataria a Peru.
    expect(urlComoLlegar(40.4168, -3.7038)).toContain('40.4168,-3.7038');
  });
});
