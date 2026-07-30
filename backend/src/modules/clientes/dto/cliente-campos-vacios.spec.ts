import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateClienteDto } from './cliente.dto';

// Un formulario web manda '' cuando el usuario deja el campo vacío, no undefined.
// `@IsOptional()` SOLO ignora null y undefined: con '' la validación de formato se
// ejecuta y falla.
//
// Incidente 2026-07-30: guardar cualquier cliente SIN email o SIN zona desde Detalle del
// Cliente devolvía 400 "Email inválido / zonaId must be a UUID". El formulario convierte
// los nulos de la BD en '' al cargar, así que el error saltaba aunque el operador no
// tocara esos campos — y el mensaje real quedaba oculto tras un toast genérico.
//
// Estos casos fijan que '' significa "vacío" y no "formato inválido".

async function errores(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateClienteDto, payload);
  const fallos = await validate(dto, { whitelist: true });
  return fallos.flatMap((f) => Object.values(f.constraints ?? {}));
}

describe('UpdateClienteDto — campos opcionales vacíos', () => {
  it('email vacío NO es un email inválido: es un email sin poner', async () => {
    expect(await errores({ email: '' })).toEqual([]);
  });

  it('zonaId vacío NO es un UUID inválido: es un cliente sin zona', async () => {
    expect(await errores({ zonaId: '' })).toEqual([]);
  });

  it('el payload completo del formulario con nulos convertidos en "" valida', async () => {
    // Exactamente lo que arma ClienteDetalle para un cliente sin email ni zona.
    expect(
      await errores({
        tipoDocumento: 'dni', numeroDocumento: '47168769',
        nombres: 'Piero Escobar', apellidoPaterno: '', apellidoMaterno: '',
        telefono: '950420266', whatsapp: '950420266',
        email: '', direccion: 'Tumbes',
        departamento: '', provincia: '', distrito: '', zonaId: '',
        usuarioPortal: 'piero.test', passwordPortal: '',
        version: 15,
      }),
    ).toEqual([]);
  });

  it("'' se normaliza a null, no a undefined: vaciar un campo lo BORRA", async () => {
    // La diferencia importa: `undefined` significaría "no lo toques" y el operador no
    // podría quitar un email ya guardado.
    const dto = plainToInstance(UpdateClienteDto, { email: '', zonaId: '   ' });
    expect(dto.email).toBeNull();
    expect(dto.zonaId).toBeNull();
  });

  it('un email con formato REALMENTE inválido sigue rechazándose', async () => {
    // La normalización no puede convertirse en una barra libre.
    expect(await errores({ email: 'no-es-un-email' })).toContain('Email inválido');
  });

  it('un zonaId con formato inválido sigue rechazándose', async () => {
    expect((await errores({ zonaId: 'abc-123' })).join(' ')).toMatch(/UUID/i);
  });

  it('un email válido se normaliza a minúsculas y sin espacios', async () => {
    const dto = plainToInstance(UpdateClienteDto, { email: '  Piero@Datafast.PE  ' });
    expect(dto.email).toBe('piero@datafast.pe');
    expect(await errores({ email: '  Piero@Datafast.PE  ' })).toEqual([]);
  });
});
