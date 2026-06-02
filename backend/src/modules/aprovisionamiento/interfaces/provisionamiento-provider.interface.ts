export interface IProvisionamientoProvider {
  suspenderServicio(contratoId: string, detallesTecnicos: any): Promise<boolean>;
  reactivarServicio(contratoId: string, detallesTecnicos: any): Promise<boolean>;
}
