import { Injectable }        from '@nestjs/common';
import { InjectRepository }  from '@nestjs/typeorm';
import { Repository }        from 'typeorm';

import { OltHealthSnapshot } from '../entities/olt-health-snapshot.entity';

export interface BoardSnapshotDto {
  slot:         number;
  boardType:    string | null;
  boardState:   string | null;
  onuCapacity:  number | null;
  onusOnline:   number | null;
  onusOffline:  number | null;
  onusTotal:    number | null;
  capturedAt:   string;
}

export interface PomSnapshotDto {
  slot:        number;
  port:        number;
  tempCelsius: number | null;
  txDbm:       number | null;
  rxDbm:       number | null;
  voltageMv:   number | null;
  laserMa:     number | null;
  pomState:    string | null;
  capturedAt:  string;
}

@Injectable()
export class OltHealthDashboardService {

  constructor(
    @InjectRepository(OltHealthSnapshot)
    private readonly snapshotRepo: Repository<OltHealthSnapshot>,
  ) {}

  // Último snapshot de board por slot (port IS NULL)
  async latestBoards(oltId: string, empresaId: string): Promise<BoardSnapshotDto[]> {
    // DISTINCT ON simulado con subquery MAX(captured_at) por slot
    const rows = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.olt_id = :oltId AND s.empresa_id = :empresaId AND s.port IS NULL', { oltId, empresaId })
      .andWhere(`s.captured_at = (
        SELECT MAX(s2.captured_at)
        FROM olt_health_snapshots s2
        WHERE s2.olt_id = s.olt_id
          AND s2.slot = s.slot
          AND s2.port IS NULL
      )`)
      .orderBy('s.slot', 'ASC')
      .getMany();

    return rows.map((r) => ({
      slot:        r.slot!,
      boardType:   r.boardType,
      boardState:  r.boardState,
      onuCapacity: r.onuCapacity,
      onusOnline:  r.onusOnline,
      onusOffline: r.onusOffline,
      onusTotal:   r.onusTotal,
      capturedAt:  r.capturedAt.toISOString(),
    }));
  }

  // Último snapshot POM por slot+port (port IS NOT NULL)
  async latestPom(oltId: string, empresaId: string): Promise<PomSnapshotDto[]> {
    const rows = await this.snapshotRepo
      .createQueryBuilder('s')
      .where('s.olt_id = :oltId AND s.empresa_id = :empresaId AND s.port IS NOT NULL', { oltId, empresaId })
      .andWhere(`s.captured_at = (
        SELECT MAX(s2.captured_at)
        FROM olt_health_snapshots s2
        WHERE s2.olt_id = s.olt_id
          AND s2.slot = s.slot
          AND s2.port = s.port
          AND s2.port IS NOT NULL
      )`)
      .orderBy('s.slot', 'ASC')
      .addOrderBy('s.port', 'ASC')
      .getMany();

    return rows.map((r) => ({
      slot:        r.slot!,
      port:        r.port!,
      tempCelsius: r.tempCelsius !== null ? Number(r.tempCelsius) : null,
      txDbm:       r.txDbm      !== null ? Number(r.txDbm)       : null,
      rxDbm:       r.rxDbm      !== null ? Number(r.rxDbm)       : null,
      voltageMv:   r.voltageMv  !== null ? Number(r.voltageMv)   : null,
      laserMa:     r.laserMa    !== null ? Number(r.laserMa)     : null,
      pomState:    r.pomState,
      capturedAt:  r.capturedAt.toISOString(),
    }));
  }
}
