import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OltDispositivo }    from '../entities/olt-dispositivo.entity';
import { OltBoard }          from '../entities/olt-board.entity';
import { OltVlan }           from '../entities/olt-vlan.entity';
import { OltLineProfile }    from '../entities/olt-line-profile.entity';
import { OltServiceProfile } from '../entities/olt-service-profile.entity';
import { OltTrafficTable }   from '../entities/olt-traffic-table.entity';
import { OltHealthSnapshot } from '../entities/olt-health-snapshot.entity';
import { OltSyncJob }        from '../entities/olt-sync-job.entity';
import { InfrastructureSnapshot } from '../types/infrastructure-snapshot';

// ─────────────────────────────────────────────────────────────
// InfrastructureSnapshotService — Incremento 2
//
// Compone InfrastructureSnapshot leyendo el read-model que ya
// persisten wizardTopologia() (vía OltSyncService) y healthSnapshot()
// (vía OltHealthPollerCron). No abre sesión SSH — es lectura pura
// de BD, por lo que responde en milisegundos y nunca falla por
// timeout de la OLT.
//
// Si la OLT nunca fue sincronizada, las listas vienen vacías y
// ultimoSyncEn/ultimoSyncEstado son null — el consumidor decide
// qué hacer con un snapshot "vacío" (p.ej. las reglas de
// cumplimiento del Incremento 4 deben tratarlo como "sin datos",
// no como "no cumple").
// ─────────────────────────────────────────────────────────────
@Injectable()
export class InfrastructureSnapshotService {
  constructor(
    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    @InjectRepository(OltBoard)
    private readonly boardRepo: Repository<OltBoard>,

    @InjectRepository(OltVlan)
    private readonly vlanRepo: Repository<OltVlan>,

    @InjectRepository(OltLineProfile)
    private readonly lineProfileRepo: Repository<OltLineProfile>,

    @InjectRepository(OltServiceProfile)
    private readonly srvProfileRepo: Repository<OltServiceProfile>,

    @InjectRepository(OltTrafficTable)
    private readonly trafficRepo: Repository<OltTrafficTable>,

    @InjectRepository(OltHealthSnapshot)
    private readonly healthRepo: Repository<OltHealthSnapshot>,

    @InjectRepository(OltSyncJob)
    private readonly syncJobRepo: Repository<OltSyncJob>,
  ) {}

  async obtener(oltId: string, empresaId: string): Promise<InfrastructureSnapshot> {
    const olt = await this.oltRepo.findOne({ where: { id: oltId, empresaId } });
    if (!olt) throw new NotFoundException(`OLT ${oltId} no encontrada`);

    const [boards, vlans, lineProfiles, serviceProfiles, trafficTables, ultimoSync] =
      await Promise.all([
        this.boardRepo.find({ where: { oltId, empresaId }, order: { slot: 'ASC' } }),
        this.vlanRepo.find({ where: { oltId, empresaId }, order: { vlanId: 'ASC' } }),
        this.lineProfileRepo.find({ where: { oltId, empresaId }, order: { profileId: 'ASC' } }),
        this.srvProfileRepo.find({ where: { oltId, empresaId }, order: { profileId: 'ASC' } }),
        this.trafficRepo.find({ where: { oltId, empresaId }, order: { trafficId: 'ASC' } }),
        this.syncJobRepo.findOne({ where: { oltId, empresaId }, order: { iniciadoEn: 'DESC' } }),
      ]);

    // Último snapshot POM disponible por (slot, puerto) — solo el más
    // reciente de cada puerto, no el historial completo.
    const opticalPorts = await this._ultimoPomPorPuerto(oltId, empresaId);

    return {
      oltId:     olt.id,
      oltNombre: olt.nombre,
      marca:     olt.marca,
      modelo:    olt.modelo ?? null,
      firmware:  olt.firmware ?? null,

      boards: boards.map(b => ({
        slot:         b.slot,
        boardType:    b.boardType,
        estado:       b.estado,
        onuCount:     b.onuCount,
        onuCapacity:  null,
        portsPorSlot: b.portsPorSlot,
      })),

      vlans: vlans.map(v => ({
        vlanId: v.vlanId,
        nombre: v.nombre,
        origen: v.origen,
        estado: v.estado,
      })),

      lineProfiles:    lineProfiles.map(p => ({ profileId: p.profileId, nombre: p.nombre })),
      serviceProfiles: serviceProfiles.map(p => ({ profileId: p.profileId, nombre: p.nombre })),

      trafficTables: trafficTables.map(t => ({
        trafficId: t.trafficId,
        nombre:    t.nombre,
        cirKbps:   t.cirKbps,
        pirKbps:   t.pirKbps,
        tipo:      t.tipo,
      })),

      opticalPorts,

      snmpCommunities: olt.snmpRealCommunities ?? null,
      snmpVersions:    olt.snmpRealVersions ?? null,
      ntpServers:      olt.ntpServers ?? null,
      uplinkVlans:     olt.uplinkVlans ?? null,

      ultimoSyncEn:     ultimoSync?.completadoEn ?? null,
      ultimoSyncEstado: ultimoSync?.estado ?? null,
      ultimoHealthEn:   opticalPorts[0]?.capturedAt ?? null,
      configSnapshotEn: olt.configSnapshotAt ?? null,
    };
  }

  // ── Privados ──────────────────────────────────────────────

  private async _ultimoPomPorPuerto(
    oltId: string, empresaId: string,
  ): Promise<InfrastructureSnapshot['opticalPorts']> {
    const rows = await this.healthRepo
      .createQueryBuilder('h')
      .distinctOn(['h.slot', 'h.port'])
      .where('h.oltId = :oltId', { oltId })
      .andWhere('h.empresaId = :empresaId', { empresaId })
      .andWhere('h.snapshotType = :tipo', { tipo: 'pom' })
      .orderBy('h.slot', 'ASC')
      .addOrderBy('h.port', 'ASC')
      .addOrderBy('h.capturedAt', 'DESC')
      .getMany();

    return rows
      .filter(r => r.slot !== null && r.port !== null)
      .map(r => ({
        slot:        r.slot as number,
        port:        r.port as number,
        tempCelsius: r.tempCelsius,
        txDbm:       r.txDbm,
        rxDbm:       r.rxDbm,
        pomState:    r.pomState,
        capturedAt:  r.capturedAt,
      }));
  }
}
