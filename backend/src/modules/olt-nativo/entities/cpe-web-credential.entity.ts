import { Column, Entity } from 'typeorm';
import { BaseModel } from '../../../common/entities/base.entity';

// Credenciales del panel de administración WEB del propio CPE (ONT/ONU) —
// NO son las credenciales del ACS. Se gestionan por OLT (o por lote de
// despliegue, ya que suelen ser uniformes por modelo/proveedor) porque son
// una credencial de infraestructura, análoga a `usuarioAnclado`/
// `contrasenaCifrada` de OltDispositivo. Usadas exclusivamente por el canal
// http_web (ver capability/cpe-provisioning-catalog.ts).
@Entity('cpe_web_credential')
export class CpeWebCredential extends BaseModel {
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ name: 'fabricante', type: 'varchar', length: 32 })
  fabricante: string;

  // null = aplica a todos los modelos de ese fabricante bajo esta OLT
  @Column({ name: 'modelo_pattern', type: 'varchar', length: 64, nullable: true })
  modeloPattern: string | null;

  @Column({ name: 'usuario', type: 'varchar', length: 64 })
  usuario: string;

  // Cifrado AES-256-GCM (encryption.util.ts) — formato "iv:authTag:ciphertext"
  @Column({ name: 'password_cifrada', type: 'text' })
  passwordCifrada: string;

  @Column({ name: 'activo', type: 'boolean', default: true })
  activo: boolean;
}
