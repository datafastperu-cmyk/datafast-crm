// ─── Datos de conexión que cada provider necesita ────────────
export interface OltConexion {
  externId:          string;   // smartolt_id (SmartOLT) | ip_gestion (nativo)
  ipGestion?:        string;
  puerto?:           number;
  usuario?:          string;
  contrasenaCifrada?: string;
  marca?:            string;
}

// ─── ONUs descubiertas pero no aprovisionadas ─────────────────
export interface OnuNoAprovisionada {
  serial:      string;
  ponPort:     string;   // '0/1/3'
  ponType?:    string;   // 'GPON' | 'EPON'
  model?:      string;
  rxPower?:    number;   // dBm — para identificar la ONU correcta en campo
  detectedAt?: string;
}

// ─── ONU tras aprovisionamiento exitoso ───────────────────────
export interface OnuAprovisionadaResult {
  externId: string;   // ID en SmartOLT o identificador nativo equivalente
  serial:   string;
  ponPort:  string;
  estado:   string;
}

// ─── Payload para aprovisionar ────────────────────────────────
export interface ProvisionarOnuPayload {
  serial:        string;
  ponPort:       string;   // '0/1/3' — slot/subslot/port
  perfil:        string;
  vlanId:        number;
  vlanModo?:     string;   // 'access' | 'trunk'
  descripcion?:  string;
  // Campos requeridos por NATIVO_SSH (parseados del ONU entity o pasados explícitamente)
  frame?:          number;
  ponSlot?:        number;
  ponSubslot?:     number;
  ponPortNum?:     number;
  onuId?:          number;
  vlanGestion?:    number;
  servicePortId?:  number;
  trafficIndex?:   number;
  onuType?:        string;
}

// ─── Contrato de todos los providers OLT ─────────────────────
export interface IOltProvider {
  listarOnusNoAprovisionadas(olt: OltConexion): Promise<OnuNoAprovisionada[]>;
  aprovisionarOnu(olt: OltConexion, payload: ProvisionarOnuPayload): Promise<OnuAprovisionadaResult>;
  desaprovisionarOnu(olt: OltConexion, onuExternId: string): Promise<void>;
  suspenderOnu(olt: OltConexion, onuExternId: string): Promise<void>;
  reactivarOnu(olt: OltConexion, onuExternId: string): Promise<void>;
}
