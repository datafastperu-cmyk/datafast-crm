import { UnauthorizedException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { PortalTenantService } from './portal-tenant.service';
import { PortalConfig } from './entities/portal-config.entity';

// El ERP se instala en VPS distintos Y en redes locales sin IP pública ni dominio. La
// resolución del tenant tiene que funcionar en los dos escenarios: si exigiera un
// dominio, una instalación local se quedaría sin portal.
//
// Regla que NO cambia entre modos: el HOST decide la empresa, nunca el usuario que
// escribe el abonado. Si se dedujera del usuario, dos empresas de la misma instalación
// compartirían espacio de nombres de credenciales y el índice único por
// (empresa_id, usuario) dejaría de proteger nada.

const EMPRESA_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMPRESA_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function servicio(opts: {
  configs?: Array<{ empresaId: string; urlPortal: string | null }>;
  empresas?: string[];
}) {
  const configRepo = {
    find: jest.fn().mockResolvedValue(opts.configs ?? []),
  } as unknown as Repository<PortalConfig>;

  const dataSource = {
    query: jest.fn().mockResolvedValue((opts.empresas ?? [EMPRESA_A]).map((id) => ({ id }))),
  } as unknown as DataSource;

  return new PortalTenantService(configRepo, dataSource);
}

describe('PortalTenantService — resolución del tenant', () => {
  it('modo subdominio: resuelve por la URL configurada del portal', async () => {
    const svc = servicio({
      configs: [
        { empresaId: EMPRESA_A, urlPortal: 'https://cliente.empresa-a.pe' },
        { empresaId: EMPRESA_B, urlPortal: 'https://cliente.empresa-b.pe' },
      ],
      empresas: [EMPRESA_A, EMPRESA_B],
    });

    await expect(svc.resolverEmpresaId('cliente.empresa-b.pe')).resolves.toBe(EMPRESA_B);
  });

  it('ignora el puerto y las mayúsculas del Host', async () => {
    const svc = servicio({
      configs: [{ empresaId: EMPRESA_A, urlPortal: 'https://Cliente.Empresa-A.pe' }],
      empresas: [EMPRESA_A, EMPRESA_B],
    });

    await expect(svc.resolverEmpresaId('cliente.empresa-a.pe:443')).resolves.toBe(EMPRESA_A);
  });

  // Instalación local o con solo IP: no hay dominio que configurar y el portal igual
  // tiene que funcionar. Es el caso que este servicio existía para NO romper.
  it('modo ruta con una sola empresa: resuelve sin dominio (instalación local)', async () => {
    const svc = servicio({ configs: [], empresas: [EMPRESA_A] });

    await expect(svc.resolverEmpresaId(undefined)).resolves.toBe(EMPRESA_A);
    await expect(svc.resolverEmpresaId('192.168.1.50:3000')).resolves.toBe(EMPRESA_A);
    await expect(svc.resolverEmpresaId('localhost:3000')).resolves.toBe(EMPRESA_A);
  });

  it('una URL mal escrita en el panel no rompe la resolución', async () => {
    const svc = servicio({
      configs: [{ empresaId: EMPRESA_A, urlPortal: 'no-es-una-url' }],
      empresas: [EMPRESA_A],
    });

    await expect(svc.resolverEmpresaId('149.34.48.224')).resolves.toBe(EMPRESA_A);
  });

  // Con varias empresas y ningún host que las distinga, elegir una sería servirle a un
  // abonado los datos de otra empresa. Se rechaza: es el único caso sin respuesta segura.
  it('varias empresas sin host que las distinga: se rechaza, no se adivina', async () => {
    const svc = servicio({ configs: [], empresas: [EMPRESA_A, EMPRESA_B] });

    await expect(svc.resolverEmpresaId('149.34.48.224')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
