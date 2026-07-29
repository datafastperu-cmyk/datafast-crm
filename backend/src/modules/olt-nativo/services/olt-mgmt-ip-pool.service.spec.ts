import { UnprocessableEntityException } from '@nestjs/common';
import { OltMgmtIpPoolService } from './olt-mgmt-ip-pool.service';

// La VLAN 1600 de gestión es un único dominio L2 compartido por todas las OLTs, y cada OLT
// usa un tramo disjunto dentro de él. Esa disjunción es lo ÚNICO que impide que dos ONUs de
// OLTs distintas reciban la misma IP estática: la unicidad del pool es (olt_id, ip_address),
// así que la misma IP en dos OLTs es insertable sin más. En un L2 compartido eso es un
// conflicto de IP — ambas ONUs con gestión intermitente y cada OLT reportando su lado como
// correcto.
//
// Era una convención que nadie verificaba. Este test es lo que la convierte en invariante.
describe('OltMgmtIpPoolService — tramos disjuntos por OLT', () => {
  const hacer = (colisiones: Array<{ ip_address: string; olt: string }> = []) => {
    const ds = {
      query: jest.fn(async (sql: string, _params?: any[]) => {
        if (/FROM\s+olt_mgmt_ip_pool\s+p/i.test(sql) && /olt_id\s*<>/i.test(sql)) return colisiones;
        return []; // INSERT ... RETURNING
      }),
    };
    return { svc: new OltMgmtIpPoolService(ds as any), ds };
  };

  it('rechaza un rango que pisa el tramo de otra OLT, nombrándola', async () => {
    const { svc } = hacer([{ ip_address: '10.16.4.7', olt: 'OLT NODO MALVINAS' }]);

    await expect(
      svc.configurarRango('olt-2', 'e-1', { inicio: '10.16.4.1', fin: '10.16.4.50' }),
    ).rejects.toThrow(UnprocessableEntityException);

    // El operador tiene que poder actuar con el mensaje: qué OLT y qué IP concreta chocan.
    await expect(
      svc.configurarRango('olt-2', 'e-1', { inicio: '10.16.4.1', fin: '10.16.4.50' }),
    ).rejects.toThrow(/OLT NODO MALVINAS.*10\.16\.4\.7/s);
  });

  it('acepta un tramo libre: la comprobación no bloquea el uso normal', async () => {
    const { svc } = hacer([]);
    await expect(
      svc.configurarRango('olt-2', 'e-1', { inicio: '10.16.8.1', fin: '10.16.8.50' }),
    ).resolves.toEqual({ insertados: 0, omitidos: 50 });
  });

  it('la comprobación excluye a la propia OLT: reconfigurar su rango es idempotente', async () => {
    const { svc, ds } = hacer([]);
    await svc.configurarRango('olt-1', 'e-1', { inicio: '10.16.4.1', fin: '10.16.4.10' });

    const guard = ds.query.mock.calls.find(([sql]) => /olt_id\s*<>/i.test(sql as string));
    expect(guard).toBeDefined();
    // Sin este `<>`, ampliar el rango de una OLT chocaría contra sus propias IPs ya sembradas.
    expect(guard![1]).toEqual(expect.arrayContaining(['e-1', 'olt-1']));
  });

  it('el solapamiento se juzga dentro de la empresa: otro tenant no bloquea', async () => {
    const { svc, ds } = hacer([]);
    await svc.configurarRango('olt-1', 'e-1', { inicio: '10.16.4.1', fin: '10.16.4.10' });

    const guard = ds.query.mock.calls.find(([sql]) => /olt_id\s*<>/i.test(sql as string));
    expect(guard![0]).toMatch(/empresa_id\s*=\s*\$1/i);
  });

  it('sigue rechazando rangos invertidos o desmedidos antes de tocar la BD', async () => {
    const { svc } = hacer([]);
    await expect(svc.configurarRango('olt-1', 'e-1', { inicio: '10.16.4.50', fin: '10.16.4.1' }))
      .rejects.toThrow(/debe ser/i);
    await expect(svc.configurarRango('olt-1', 'e-1', { inicio: '10.16.0.0', fin: '10.16.8.0' }))
      .rejects.toThrow(/1024/);
  });
});
