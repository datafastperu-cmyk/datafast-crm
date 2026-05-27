// Ruta: /opt/datafast/backend/src/modules/monitoreo/enums/monitoreo.enums.ts

export enum TipoEquipo {
  ANTENA_AP           = 'ANTENA_AP',
  ROUTER_BORDE        = 'ROUTER_BORDE',
  ROUTER_ACCESO       = 'ROUTER_ACCESO',
  CAMARA_IP           = 'CAMARA_IP',
  DISPOSITIVO_CRITICO = 'DISPOSITIVO_CRITICO',
}

export enum Fabricante {
  MIKROTIK = 'MIKROTIK',
  UBIQUITI = 'UBIQUITI',
  GENERICO = 'GENERICO',
}

export enum StatusDispositivo {
  ONLINE        = 'ONLINE',
  OFFLINE       = 'OFFLINE',
  REVERIFICANDO = 'REVERIFICANDO',
  DEGRADADO     = 'DEGRADADO',
}

export enum NivelAlerta {
  CRITICA = 'CRITICA',
  WARNING = 'WARNING',
}

export enum StatusAlerta {
  ACTIVA   = 'ACTIVA',
  RESUELTA = 'RESUELTA',
}
