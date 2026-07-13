import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';

import { OltDispositivo } from '../entities/olt-dispositivo.entity';
import { InfrastructureSnapshotService } from './infrastructure-snapshot.service';
import { resolverCapacidadesOlt } from '../capability/olt-capability-catalog';
import {
  ComplianceCheck,
  OLT_COMPLIANCE_RULES,
} from '../compliance/olt-compliance-rules';

export interface ComplianceReport {
  oltId:       string;
  oltNombre:   string;
  evaluadoEn:  Date;
  checks:      ComplianceCheck[];
  cumpleTodo:  boolean;
  criticos:    number;
  advertencias: number;
}

// ─────────────────────────────────────────────────────────────
// OltComplianceService — Incremento 4
//
// Evalúa OLT_COMPLIANCE_RULES contra el InfrastructureSnapshot del
// Incremento 2 y las capacidades del Incremento 3. Lectura pura —
// no abre SSH, no muta nada.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OltComplianceService {
  constructor(
    @InjectRepository(OltDispositivo)
    private readonly oltRepo: Repository<OltDispositivo>,

    private readonly snapshotService: InfrastructureSnapshotService,
  ) {}

  async evaluar(oltId: string, empresaId: string): Promise<ComplianceReport> {
    const olt = await this.oltRepo.findOne({
      where: { id: oltId, empresaId, deletedAt: IsNull() as any },
    });
    if (!olt) throw new NotFoundException(`OLT ${oltId} no encontrada`);

    const snapshot = await this.snapshotService.obtener(oltId, empresaId);
    const caps     = resolverCapacidadesOlt(olt.marca);

    const checks = OLT_COMPLIANCE_RULES.map(rule => rule(olt, snapshot, caps));

    const criticos     = checks.filter(c => !c.cumple && c.severidad === 'critical').length;
    const advertencias = checks.filter(c => !c.cumple && c.severidad === 'warning').length;

    return {
      oltId:      olt.id,
      oltNombre:  olt.nombre,
      evaluadoEn: new Date(),
      checks,
      cumpleTodo: checks.every(c => c.cumple),
      criticos,
      advertencias,
    };
  }
}
