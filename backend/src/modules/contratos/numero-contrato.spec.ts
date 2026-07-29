import { ContratoRepository } from './repositories/contrato.repository';

// `MAX()+1` para un correlativo es un TOCTOU: dos altas simultáneas leen el mismo máximo y
// proponen el mismo número. El índice `uq_contratos_empresa_numero` impedía el duplicado —así
// que nunca se corrompió nada—, pero el segundo operador recibía un 500 sin explicación.
//
// Los otros dos correlativos del ERP ya eran seguros (`nextval` para el código de cliente,
// `UPDATE ... RETURNING` para el de comprobante); este se había quedado atrás.
describe('ContratoRepository — número de contrato correlativo', () => {
  const hacer = (maxActual = '5') => {
    const llamadas: Array<{ sql: string; params: any[] }> = [];
    const ejecutor = {
      query: jest.fn(async (sql: string, params?: any[]) => {
        llamadas.push({ sql, params: params ?? [] });
        if (/pg_advisory/i.test(sql)) return [{ pg_advisory_xact_lock: '' }];
        return [{ max_num: maxActual }];
      }),
    };
    const repo = Object.create(ContratoRepository.prototype) as any;
    repo.repo = { manager: ejecutor };
    return { repo, ejecutor, llamadas };
  };

  it('toma el lock ANTES de leer el máximo', async () => {
    const { repo, llamadas } = hacer();
    await repo.generarNumeroContrato('e-1', undefined);

    // Si se leyera primero y se bloqueara después, el lock no protegería nada: la lectura
    // que decide el número ya habría ocurrido fuera de la sección crítica.
    expect(llamadas[0].sql).toMatch(/pg_advisory_xact_lock/i);
    expect(llamadas[1].sql).toMatch(/MAX\(/i);
  });

  it('el lock es de TRANSACCIÓN, no de sesión', async () => {
    const { repo, llamadas } = hacer();
    await repo.generarNumeroContrato('e-1', undefined);

    // `pg_advisory_lock` (de sesión) habría que liberarlo a mano y se filtraría entre
    // requests al reusarse la conexión del pool. El de transacción se suelta en el commit,
    // que es justo cuando el número deja de necesitar protección.
    expect(llamadas[0].sql).toMatch(/pg_advisory_xact_lock/i);
    expect(llamadas[0].sql).not.toMatch(/pg_advisory_lock\s*\(/i);
  });

  it('la clave del lock separa empresas y años', async () => {
    const { repo, llamadas } = hacer();
    await repo.generarNumeroContrato('empresa-A', undefined);

    const clave = String(llamadas[0].params[0]);
    expect(clave).toContain('empresa-A');
    expect(clave).toContain(String(new Date().getFullYear()));
    // Sin separar por empresa, dos tenants facturando a la vez se bloquearían entre sí sin
    // ninguna razón; sin separar por año, el correlativo no podría reiniciarse.
  });

  it('usa el manager de la transacción cuando se le pasa', async () => {
    // Es lo que mantiene el lock vivo hasta el INSERT del contrato. Con el manager por
    // defecto, el lock se soltaría antes y la ventana volvería a abrirse.
    const { repo } = hacer();
    const llamadasTx: string[] = [];
    const managerTx = {
      query: jest.fn(async (sql: string) => {
        llamadasTx.push(sql);
        return /pg_advisory/i.test(sql) ? [{}] : [{ max_num: '9' }];
      }),
    };

    const numero = await repo.generarNumeroContrato('e-1', managerTx as any);

    expect(llamadasTx[0]).toMatch(/pg_advisory_xact_lock/i);
    expect(repo.repo.manager.query).not.toHaveBeenCalled();
    expect(numero).toMatch(/^CNT-\d{4}-000010$/);
  });

  it('formatea con 6 dígitos y continúa desde el máximo existente', async () => {
    const { repo } = hacer('41');
    await expect(repo.generarNumeroContrato('e-1', undefined))
      .resolves.toMatch(/^CNT-\d{4}-000042$/);
  });

  it('arranca en 1 cuando la empresa no tiene contratos', async () => {
    const { repo } = hacer('0');
    await expect(repo.generarNumeroContrato('e-1', undefined))
      .resolves.toMatch(/^CNT-\d{4}-000001$/);
  });
});
