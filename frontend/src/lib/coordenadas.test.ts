import { describe, it, expect } from 'vitest';
import { parsearCoordenadas } from '@/components/planta-externa/CapturaCoordenadas';

/**
 * Parser de coordenadas pegadas en un solo campo.
 *
 * En la BD son dos columnas —el visor consulta por bounding box sobre un índice compuesto
 * `(empresa_id, latitud, longitud)`, y con un texto concatenado ese índice no existe—.
 * Pero el operador no ESCRIBE coordenadas: las PEGA, y Google Maps las entrega como una
 * sola cadena. Este parser es el puente, y es el único punto donde un error de pegado
 * puede colarse hasta la base de datos.
 */
describe('parsearCoordenadas', () => {

  describe('formatos que aparecen en la práctica', () => {
    it('acepta el formato que copia Google Maps (coma + espacio)', () => {
      const r = parsearCoordenadas('-12.0464, -77.0428');
      expect(r).toMatchObject({ ok: true, latitud: -12.0464, longitud: -77.0428 });
    });

    it('acepta sin espacio tras la coma', () => {
      expect(parsearCoordenadas('-12.0464,-77.0428')).toMatchObject({ ok: true });
    });

    it('acepta separación por espacio y por punto y coma', () => {
      expect(parsearCoordenadas('-12.0464 -77.0428')).toMatchObject({ ok: true });
      expect(parsearCoordenadas('-12.0464; -77.0428')).toMatchObject({ ok: true });
    });

    it('tolera espacios sobrantes al pegar', () => {
      expect(parsearCoordenadas('  -12.0464 ,  -77.0428  ')).toMatchObject({ ok: true });
    });

    it('acepta coordenadas positivas (otros hemisferios)', () => {
      // El ERP se instala en varios países; asumir signo negativo sería atarlo a Perú.
      expect(parsearCoordenadas('40.4168, -3.7038')).toMatchObject({ ok: true, latitud: 40.4168 });
    });
  });

  describe('errores de pegado que sí se pueden detectar', () => {
    it('detecta el orden invertido SÓLO cuando la longitud supera 90°', () => {
      // Sídney: lng 151, fuera del rango de latitud → la inversión es detectable.
      const r = parsearCoordenadas('151.2093, -33.8688');
      expect(r.ok).toBe(false);
      expect(r.motivo).toContain('invertidos');
      // El mensaje propone el par corregido: el operador confirma en vez de recalcular.
      expect(r.motivo).toContain('-33.8688');
    });

    it('NO puede detectar la inversión en Perú, y eso es matemático, no un descuido', () => {
      // Lima invertida (-77.0428, -12.0464) es un par perfectamente válido: −77 es una
      // latitud legal y −12 una longitud legal. Ningún parser puede distinguirlo.
      //
      // Este test existe para que nadie "arregle" el guard creyendo que falla, y para
      // dejar constancia de que la protección real de este caso es el eco "Lat … · Lng …"
      // bajo el campo, donde el operador ve lo que el sistema entendió antes de guardar.
      const r = parsearCoordenadas('-77.0428, -12.0464');
      expect(r.ok).toBe(true);
    });

    it('rechaza grados/minutos/segundos explicando cómo obtener decimales', () => {
      // Es lo que Google Maps MUESTRA en pantalla, aunque "copiar coordenadas" dé
      // decimales. Un "formato inválido" a secas no le dice al operador qué hacer.
      const r = parsearCoordenadas(`12°02'47.0"S 77°02'34.1"W`);
      expect(r.ok).toBe(false);
      expect(r.motivo).toContain('decimales');
    });

    it('rechaza 0, 0 — el "null island" del Atlántico', () => {
      // Casi siempre es un campo sin llenar que se guardó igual, no una coordenada real.
      const r = parsearCoordenadas('0, 0');
      expect(r.ok).toBe(false);
      expect(r.motivo).toContain('Atlántico');
    });

    it('rechaza latitud fuera de rango', () => {
      expect(parsearCoordenadas('95, 20').ok).toBe(false);
    });

    it('rechaza longitud fuera de rango', () => {
      expect(parsearCoordenadas('12, 200').ok).toBe(false);
    });

    it('rechaza un solo valor', () => {
      const r = parsearCoordenadas('-12.0464');
      expect(r.ok).toBe(false);
      expect(r.motivo).toContain('dos valores');
    });

    it('rechaza tres valores (pegado de más)', () => {
      expect(parsearCoordenadas('-12.04, -77.04, 150').ok).toBe(false);
    });

    it('rechaza texto que no es numérico', () => {
      expect(parsearCoordenadas('-12.0464, abc').ok).toBe(false);
    });
  });

  describe('estados intermedios de tecleo', () => {
    it('vacío no es un error: no hay nada que explicar todavía', () => {
      // El campo recién montado no debe mostrar un mensaje en rojo.
      const r = parsearCoordenadas('');
      expect(r.ok).toBe(false);
      expect(r.motivo).toBeNull();
    });

    it('sólo espacios se trata como vacío', () => {
      expect(parsearCoordenadas('   ').motivo).toBeNull();
    });

    it('a medio escribir no es válido: nunca se guarda media coordenada', () => {
      expect(parsearCoordenadas('-12.04, ').ok).toBe(false);
    });
  });
});
