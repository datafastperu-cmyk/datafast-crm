import { OltConnService } from './olt-conn.service';
import { encrypt } from '../../../common/utils/encryption.util';

// Fix estructural (b) — fuente única de credenciales SSH:
// preferir olt_proveedor_config.credenciales; fallback a la entidad legacy.

describe('OltConnService', () => {
  process.env.ENCRYPTION_KEY ??= 'a'.repeat(64); // clave de test para encrypt/decrypt

  const olt = {
    id: 'olt-1', empresaId: 'emp-1', nombre: 'OLT TEST',
    ipGestion: '10.0.0.2/32', puerto: 22, usuarioAnclado: 'legacy_user',
    contrasenaCifrada: encrypt('legacy_pass'), marca: 'HUAWEI',
  } as never;

  const makeService = (config: unknown) =>
    new OltConnService({ findOne: jest.fn().mockResolvedValue(config) } as never);

  it('prefiere las credenciales de la config del proveedor', async () => {
    const svc = makeService({
      credenciales: {
        ip: '10.0.0.9', port: 2222, username: 'erp_user',
        password_cifrado: encrypt('erp_pass'), brand: 'huawei',
      },
    });
    const conn = await svc.buildConn(olt);
    expect(conn).toEqual({
      ip: '10.0.0.9', port: 2222, username: 'erp_user',
      password: 'erp_pass', brand: 'huawei',
    });
  });

  it('cae a la entidad legacy si no hay config (y limpia el CIDR de la IP)', async () => {
    const svc  = makeService(null);
    const conn = await svc.buildConn(olt);
    expect(conn).toEqual({
      ip: '10.0.0.2', port: 22, username: 'legacy_user',
      password: 'legacy_pass', brand: 'huawei',
    });
  });

  it('mezcla: config sin password usa la contraseña legacy', async () => {
    const svc  = makeService({ credenciales: { username: 'erp_user' } });
    const conn = await svc.buildConn(olt);
    expect(conn.username).toBe('erp_user');
    expect(conn.password).toBe('legacy_pass');
  });
});
