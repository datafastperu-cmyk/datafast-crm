import { NombreCanal } from '../../capability/cpe-provisioning-catalog';

// ─────────────────────────────────────────────────────────────
// Abstracción de canal de aprovisionamiento TR-069 por CPE.
//
// El ERP nunca decide "cómo" escribir la config TR-069 en el equipo —
// eso lo decide el catálogo de capacidad (capability/cpe-provisioning-catalog.ts)
// y lo ejecuta el ProvisioningStrategyResolver, iterando canales certificados
// en orden hasta que uno converja (verificado contra GenieACS, nunca por el
// "success" del propio canal). Cada canal solo sabe hacer una cosa: intentar
// escribir la config en SU protocolo específico. No verifica convergencia —
// eso es responsabilidad centralizada del resolver (evita duplicar la lógica
// de verificación en cada implementación de canal).
// ─────────────────────────────────────────────────────────────

export interface DeviceProfile {
  fabricante: string;          // 'Huawei', 'ZTE', ...
  modelo:     string;          // productClass / equipmentId (ej. 'EG8145V5')
  firmware:   string | null;   // softwareVersion si se conoce
  sn:         string;          // serial number del ONT
  mgmtIp:     string;          // IP de gestión TR-069 (VLAN 1600 propia del ERP)
}

export interface BootstrapContext {
  device:          DeviceProfile;
  acsUrl:          string;
  acsUsername:     string;
  acsPassword:     string;
  connReqUsername?: string;
  connReqPassword?: string;
  oltId:           string;
  empresaId:       string;
  ftthRegistroId:  string;
  // Parámetros de red ya resueltos por ProvisionFtthService (pool de IPs,
  // service-port, VLAN, traffic-table) — el canal OMCI los necesita para
  // crear la WAN/service-port; el canal HTTP los ignora (solo usa mgmtIp).
  omci?: {
    connection: OltConnection;
    slot: number; port: number; onuId: number;
    mgmtVlan: number; mgmtServicePortId: number; mgmtMask: string;
    mgmtGateway: string; trafficIndex: number; priority: number;
  };
}

export interface OltConnection {
  ip:       string;
  port:     number;
  username: string;
  password: string;
  brand:    string;
}

export interface ChannelResult {
  exitoso: boolean;
  mensaje: string;
  error?:  string;
}

export interface CpeProvisioningChannel {
  readonly nombre: NombreCanal;

  /** ¿Este canal aplica al dispositivo dado? (chequeo de forma, no de red). */
  supports(device: DeviceProfile): boolean;

  /**
   * Intenta escribir la configuración TR-069 en el CPE por este canal.
   * NUNCA debe interpretarse como "convergió" — solo "el canal no reportó
   * error al intentar". La verificación real es responsabilidad del resolver.
   */
  bootstrap(ctx: BootstrapContext): Promise<ChannelResult>;
}
