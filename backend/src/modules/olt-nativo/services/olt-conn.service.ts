import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import { OltProveedorConfig, TipoProveedor } from '../entities/olt-proveedor-config.entity';
import { decrypt } from '../../../common/utils/encryption.util';

export interface OltSshConn {
  ip:       string;
  port:     number;
  username: string;
  password: string;
  brand:    string;
}

// ─────────────────────────────────────────────────────────────
// OltConnService — única fuente de credenciales SSH de una OLT.
//
// Fuente de verdad: olt_proveedor_config (tipo nativo_ssh, activo).
// Fallback: campos legacy de olt_dispositivos (OLTs previas al modelo
// multi-proveedor). Antes cada servicio (VLANs, traffic-tables, pools,
// sync) armaba su propia conexión leyendo fuentes distintas — al editar
// la contraseña por un camino, la mitad de las operaciones seguía usando
// la vieja (riesgo de bloqueo de cuenta en la OLT por intentos fallidos).
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltConnService {
  constructor(
    @InjectRepository(OltProveedorConfig)
    private readonly provRepo: Repository<OltProveedorConfig>,
  ) {}

  async buildConn(olt: OltDispositivo): Promise<OltSshConn> {
    const config = await this.provRepo.findOne({
      where: { oltId: olt.id, empresaId: olt.empresaId, tipo: 'nativo_ssh' as TipoProveedor, activo: true },
    });
    const c = (config?.credenciales ?? {}) as Record<string, unknown>;

    let password: string;
    try {
      password = decrypt(
        (c.password_cifrado as string) || olt.contrasenaCifrada,
      );
    } catch {
      throw new ServiceUnavailableException(
        `No se pudo descifrar la contraseña de la OLT "${olt.nombre}". ` +
        `Verifica que ENCRYPTION_KEY no haya cambiado desde que se guardó.`,
      );
    }

    const rawIp = (c.ip as string) || olt.ipGestion;
    return {
      ip:       rawIp.includes('/') ? rawIp.split('/')[0] : rawIp,
      port:     ((c.port    as number) || olt.puerto) ?? 22,
      username: (c.username as string) || olt.usuarioAnclado,
      password,
      brand:    ((c.brand   as string) || olt.marca).toLowerCase(),
    };
  }
}
