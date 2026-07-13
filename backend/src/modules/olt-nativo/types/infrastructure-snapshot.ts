// ─────────────────────────────────────────────────────────────
// InfrastructureSnapshot — Incremento 2 del roadmap de arquitectura
// de infraestructura (ver memoria project_infra_architecture_incremental).
//
// Contrato único de "estado actual" de una OLT. Antes de este tipo,
// wizardTopologia(), healthSnapshot() y el resultado de OltSyncJob
// eran 3 formas distintas de describir lo mismo. Este tipo no
// reemplaza esas llamadas — se compone LEYENDO el read-model que el
// ERP ya persiste (OltBoard, OltVlan, OltLineProfile,
// OltServiceProfile, OltTrafficTable, OltHealthSnapshot), porque
// wizard y sync escriben esas mismas tablas y health las complementa.
//
// Consumido por: InfrastructureSnapshotService. Futuro consumidor:
// las reglas de cumplimiento del Incremento 4.
// ─────────────────────────────────────────────────────────────

export interface SnapshotBoard {
  slot:         number;
  boardType:    string;
  estado:       string;
  onuCount:     number;
  onuCapacity:  number | null;
  portsPorSlot: number | null;
}

export interface SnapshotVlan {
  vlanId: number;
  nombre: string;
  origen: string;
  estado: string;
}

export interface SnapshotProfile {
  profileId: number;
  nombre:    string;
}

export interface SnapshotTrafficTable {
  trafficId: number;
  nombre:    string;
  cirKbps:   number | null;
  pirKbps:   number | null;
  tipo:      string;
}

export interface SnapshotOpticalPort {
  slot:        number;
  port:        number;
  tempCelsius: number | null;
  txDbm:       number | null;
  rxDbm:       number | null;
  pomState:    string | null;
  capturedAt:  Date;
}

export interface InfrastructureSnapshot {
  oltId:            string;
  oltNombre:        string;
  marca:            string;
  modelo:            string | null;
  firmware:          string | null;

  boards:           SnapshotBoard[];
  vlans:            SnapshotVlan[];
  lineProfiles:     SnapshotProfile[];
  serviceProfiles:  SnapshotProfile[];
  trafficTables:    SnapshotTrafficTable[];
  opticalPorts:      SnapshotOpticalPort[];

  // Metadata de frescura — de dónde viene cada mitad del snapshot.
  ultimoSyncEn:     Date | null;
  ultimoSyncEstado: 'pending' | 'running' | 'completed' | 'failed' | null;
  ultimoHealthEn:   Date | null;
}
