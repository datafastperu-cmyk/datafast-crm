import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import { TipoProveedor }  from '../entities/olt-proveedor-config.entity';

// ─────────────────────────────────────────────────────────────
// Interfaces del ecosistema multi-proveedor OLT
//
// IOltProvider es el contrato que NativoSshProvider, SmartoltProvider
// y AdminOltProvider deben cumplir sin excepción.
//
// Reglas de implementación obligatorias para toda clase que implemente
// esta interfaz:
//
//   1. Nunca propagar una excepción al llamador.
//      Todo error se captura internamente y se retorna como
//      OltOperacionResult { exitoso: false, mensaje, latenciaMs }.
//
//   2. Medir latencia con Date.now() al inicio y al final del método,
//      incluyendo el tiempo de conexión SSH/HTTP.
//
//   3. No modificar el estado de la BD desde dentro de un proveedor.
//      Los proveedores son adaptadores puros de protocolo; el estado
//      lo actualiza el Router y el CircuitBreaker.
// ─────────────────────────────────────────────────────────────

// ─── Credenciales descifradas ─────────────────────────────────
// Construido por OltOperationRouter antes de llamar al proveedor.
// Todos los campos son opcionales — cada proveedor usa el subconjunto
// que necesita. Nunca se persiste; vive solo en memoria durante la op.
export interface ProveedorCredenciales {
  // Nativo SSH / SNMP
  ip?:              string;
  port?:            number;
  username?:        string;
  password?:        string;   // ya descifrado — nunca loguear
  brand?:           string;   // 'huawei' | 'zte' | 'vsol' | 'cdata'
  snmpCommunity?:   string;
  snmpVersion?:     number;
  // SmartOLT / AdminOLT
  baseUrl?:         string;
  apiKey?:          string;   // ya descifrado — nunca loguear
  oltIdExterno?:    string;   // ID de la OLT en la plataforma externa
}

// ─── Resultado unificado ──────────────────────────────────────
// Todas las operaciones retornan este tipo.
// exitoso=false nunca lanza excepción — el Router decide qué hacer.
export interface OltOperacionResult<T = void> {
  exitoso:    boolean;
  datos?:     T;
  mensaje:    string;
  latenciaMs: number;
  proveedor:  TipoProveedor;
}

// ─── Payloads de entrada por operación ───────────────────────

export interface OltProvisionPayload {
  sn:            string;
  frame:         number;
  slot:          number;
  port:          number;
  onuId:         number;
  vlan:          number;
  vlanGestion:   number;
  profileSpeed:  string;   // campo legacy nativo SSH
  servicePortId?: number;
  trafficIndex?:  number;
  onuType?:       string;  // ZTE nativo + SmartOLT onu_type ID
  // SmartOLT / AdminOLT específicos
  profileDown?:   string;  // nombre perfil descarga  (ej: "100M")
  profileUp?:     string;  // nombre perfil subida     (ej: "100M")
  zone?:          string;  // nombre zona SmartOLT     (ej: "Zone1")
  odb?:           string;  // ODB ID (vacío = sin ODB)
  onuMode?:       string;  // "bridge" | "router"
}

export interface OltDeprovisionPayload {
  sn:            string;
  slot:          number;
  port:          number;
  onuId:         number;
  servicePortId?: number;
}

export interface OltMetricasPayload {
  slot:   number;
  port:   number;
  onuId:  number;
  sn?:    string;
}

// ─── Tipos de datos de retorno ────────────────────────────────

export interface OltOnuEncontrada {
  sn:         string;
  slot:       number;
  port:       number;
  ont_model?: string | null;
}

export interface OltMetricasDatos {
  status:           'online' | 'offline' | 'degraded';
  metricsAvailable: boolean;
  rxPowerDbm?:      number | null;
  txPowerDbm?:      number | null;
  temperatureC?:    number | null;
  alarm?: {
    level:   'warning' | 'critical' | 'error';
    message: string;
  } | null;
}

export interface OltProvisionDatos {
  oltIp:   string;
  onuSn:   string;
  details?: Record<string, unknown> | null;
}

export interface OltDeprovisionDatos {
  oltIp:  string;
  onuId:  number;
  details?: Record<string, unknown> | null;
}

// ─── Contrato principal ───────────────────────────────────────
export interface IOltProvider {

  // Identificador del proveedor — debe coincidir con TipoProveedor.
  readonly tipo: TipoProveedor;

  // Abre y cierra una sesión SSH/HTTP sin ejecutar comandos.
  // Usado por: botón "Probar Conexión" y Health Monitor.
  testConexion(
    olt:   OltDispositivo,
    creds: ProveedorCredenciales,
  ): Promise<OltOperacionResult>;

  // Aprovisiona una ONU en la OLT.
  // Operación destructiva — requiere lock de ONU antes de llamar.
  provisionar(
    olt:     OltDispositivo,
    creds:   ProveedorCredenciales,
    payload: OltProvisionPayload,
  ): Promise<OltOperacionResult<OltProvisionDatos>>;

  // Elimina la configuración de una ONU de la OLT.
  // Operación destructiva — requiere lock de ONU antes de llamar.
  desaprovisionar(
    olt:     OltDispositivo,
    creds:   ProveedorCredenciales,
    payload: OltDeprovisionPayload,
  ): Promise<OltOperacionResult<OltDeprovisionDatos>>;

  // Lista ONUs no autorizadas en un slot/puerto o en toda la OLT.
  descubrirOnus(
    olt:    OltDispositivo,
    creds:  ProveedorCredenciales,
    slot?:  number,
    port?:  number,
  ): Promise<OltOperacionResult<OltOnuEncontrada[]>>;

  // Consulta métricas ópticas en tiempo real (RxPower, TxPower, Temp).
  obtenerMetricas(
    olt:     OltDispositivo,
    creds:   ProveedorCredenciales,
    payload: OltMetricasPayload,
  ): Promise<OltOperacionResult<OltMetricasDatos>>;
}
