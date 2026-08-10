import { BadRequestException } from '@nestjs/common';
import { PlanesService } from './planes.service';
import { TipoProducto } from './entities/plan.entity';

/**
 * Fase 2 del plan del core — **el catálogo deja de tener forma de conexión** (2026-08-09).
 *
 * `planes` solo sabía describir un enlace: `velocidad_bajada` y `velocidad_subida` eran
 * obligatorias y sin valor por defecto, así que un plan de cable coaxial era literalmente
 * inexpresable — había que inventarle una velocidad y dejarla escrita como si fuera cierta.
 *
 * `planes.tipo` no servía para distinguirlos: es el segmento comercial (`residencial`,
 * `empresarial`…), no lo que el abonado contrata. Dos ejes que el modelo no separaba.
 */
describe('Fase 2 · El catálogo admite productos que no son internet', () => {
  // Solo se ejercita la regla; no hace falta el grafo de dependencias para eso.
  const svc: any = Object.create(PlanesService.prototype);
  const validar = (dto: Record<string, unknown>) => () => svc.validarCoherenciaDelProducto(dto);

  describe('internet', () => {
    it('sin producto declarado se asume internet, y entonces la velocidad es obligatoria', () => {
      expect(validar({})).toThrow(BadRequestException);
      expect(validar({})).toThrow(/velocidad de bajada y de subida/);
    });

    it('con las dos velocidades pasa', () => {
      expect(validar({ producto: TipoProducto.INTERNET, velocidadBajada: 100, velocidadSubida: 50 })).not.toThrow();
    });

    it('con una sola velocidad NO pasa — media conexión no es una conexión', () => {
      expect(validar({ producto: TipoProducto.INTERNET, velocidadBajada: 100 })).toThrow(BadRequestException);
      expect(validar({ producto: TipoProducto.INTERNET, velocidadSubida: 50 })).toThrow(BadRequestException);
    });
  });

  describe('cable y streaming', () => {
    it.each([TipoProducto.CABLE_IPTV, TipoProducto.CABLE_COAXIAL, TipoProducto.STREAMING])(
      'un plan de %s se crea SIN velocidad — esto era imposible antes de la fase 2',
      (producto) => {
        expect(validar({ producto })).not.toThrow();
      },
    );

    it.each([TipoProducto.CABLE_IPTV, TipoProducto.CABLE_COAXIAL, TipoProducto.STREAMING])(
      'un plan de %s CON velocidad se rechaza',
      (producto) => {
        // El defecto simétrico: si se permitiera, el catálogo volvería a mezclar los dos ejes.
        expect(validar({ producto, velocidadBajada: 100, velocidadSubida: 50 })).toThrow(BadRequestException);
        expect(validar({ producto, velocidadBajada: 100, velocidadSubida: 50 })).toThrow(/no tiene velocidad/);
      },
    );

    it('basta con UNA velocidad para rechazarlo', () => {
      expect(validar({ producto: TipoProducto.STREAMING, velocidadSubida: 10 })).toThrow(BadRequestException);
    });
  });

  describe('la regla no se puede esquivar por la puerta del update', () => {
    it('cambiar solo el producto, dejando las velocidades viejas, se rechaza', () => {
      // Validar el parche suelto diría que todo está bien —solo trae `producto`— y sería la base
      // la que fallara después, con un error que no le explica nada al operador.
      const resultado = {
        producto:        TipoProducto.CABLE_COAXIAL,
        velocidadBajada: 100,   // heredadas del plan existente
        velocidadSubida: 50,
      };
      expect(validar(resultado)).toThrow(/no tiene velocidad/);
    });

    it('cambiar a internet sin aportar velocidades se rechaza', () => {
      expect(validar({ producto: TipoProducto.INTERNET, velocidadBajada: null, velocidadSubida: null }))
        .toThrow(/velocidad de bajada y de subida/);
    });
  });
});
