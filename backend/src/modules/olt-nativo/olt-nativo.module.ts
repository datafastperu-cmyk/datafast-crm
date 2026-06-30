import { Module }           from '@nestjs/common';
import { TypeOrmModule }    from '@nestjs/typeorm';
import { HttpModule }       from '@nestjs/axios';
import { MulterModule }     from '@nestjs/platform-express';
import { memoryStorage }    from 'multer';

import { OltDispositivo }      from './entities/olt-dispositivo.entity';
import { OltProveedorConfig }  from './entities/olt-proveedor-config.entity';
import { OltOperacionLog }     from './entities/olt-operacion-log.entity';
import { MetricasOnuOptical }  from './entities/metricas-onu-optical.entity';
import { HistorialFirmware }   from './entities/historial-firmware.entity';
import { FtthOnuRegistro }    from './entities/ftth-onu-registro.entity';
import { OltServicePortPool } from './entities/olt-service-port-pool.entity';
import { Onu }                 from '../smartolt/entities/onu.entity';
import { AlertaSistema }       from '../monitoreo/entities/alerta-sistema.entity';
import { SmartoltModule }      from '../smartolt/smartolt.module';

import { OltAutomationClient }   from './olt-automation.client';
import { OltNativoService }      from './olt-nativo.service';
import { OltNativoController }   from './olt-nativo.controller';
import { OltMonitoreoService }   from './olt-monitoreo.service';
import { FirmwareService }       from './firmware.service';
import { CircuitBreakerService }    from './services/circuit-breaker.service';
import { OltProviderRegistry }      from './services/olt-provider-registry.service';
import { OltAtomicLockService }     from './services/olt-atomic-lock.service';
import { OltIdempotencyService }    from './services/olt-idempotency.service';
import { OltOperationRouter }       from './services/olt-operation-router.service';
import { OltHealthMonitorService }  from './services/olt-health-monitor.service';
import { NativoSshProvider }        from './providers/nativo-ssh.provider';
import { SmartoltProvider }         from './providers/smartolt.provider';
import { AdminOltProvider }         from './providers/adminolt.provider';
import { ProvisionFtthService }       from './services/provision-ftth.service';
import { OltServicePortPoolService }  from './services/olt-service-port-pool.service';
import { FtthRecoveryCron }           from './cron/ftth-recovery.cron';

// ═══════════════════════════════════════════════════════════════════
// OltNativoModule — ecosistema multi-proveedor OLT/ONU
//
// CAPAS (de infraestructura a dominio):
//
//  ┌─ Adaptadores de proveedor (IOltProvider) ──────────────────────┐
//  │  NativoSshProvider → OltAutomationClient → Python/Netmiko/SSH  │
//  │  SmartoltProvider  → HTTP REST (credenciales por OLT)          │
//  │  AdminOltProvider  → HTTP REST (credenciales por OLT)          │
//  └────────────────────────────────────────────────────────────────┘
//            │ registrados en
//            ▼
//  ┌─ OltProviderRegistry ──────────────────────────────────────────┐
//  │  Map<TipoProveedor, IOltProvider>  lookup O(1)                 │
//  └────────────────────────────────────────────────────────────────┘
//            │ usado por
//            ▼
//  ┌─ OltOperationRouter ───────────────────────────────────────────┐
//  │  withLock → idempotency.execute → _iterar(circuit breaker)     │
//  │  Operaciones mutantes : provisionar / desaprovisionar          │
//  │  Operaciones lectura  : testConexion / descubrir / métricas    │
//  └────────────────────────────────────────────────────────────────┘
//            │ apoyado en
//            ▼
//  ┌─ Servicios de soporte ─────────────────────────────────────────┐
//  │  CircuitBreakerService  — CLOSED/OPEN/HALF_OPEN por config     │
//  │  OltAtomicLockService   — PG advisory locks por (OLT, ONU SN) │
//  │  OltIdempotencyService  — SHA-1 key + olt_operacion_log       │
//  │  OltHealthMonitorService— cron 5min, pLimit(5)                 │
//  └────────────────────────────────────────────────────────────────┘
//            │ accedido por
//            ▼
//  ┌─ Servicios de dominio ─────────────────────────────────────────┐
//  │  OltNativoService   — API de negocio para el controller        │
//  │  OltMonitoreoService— cron métricas ópticas ONUs               │
//  │  FirmwareService    — upload/apply firmware a OLTs             │
//  └────────────────────────────────────────────────────────────────┘
//
// EXPORTS PÚBLICOS (lo que otros módulos pueden inyectar):
//   OltNativoService    — AprovisionamientoService, otros módulos
//   OltOperationRouter  — punto de entrada al ecosistema multi-proveedor
//   OltAutomationClient — acceso directo al microservicio Python si se necesita
//   CircuitBreakerService — endpoints de admin para reset manual
//   OltProviderRegistry — diagnóstico / admin
// ═══════════════════════════════════════════════════════════════════
@Module({
  imports: [
    TypeOrmModule.forFeature([
      OltDispositivo,
      OltProveedorConfig,
      OltOperacionLog,
      Onu,
      MetricasOnuOptical,
      AlertaSistema,
      HistorialFirmware,
      FtthOnuRegistro,
      OltServicePortPool,
    ]),

    // HTTP compartido: OltAutomationClient + SmartoltProvider + AdminOltProvider
    HttpModule.register({
      timeout:      30_000,
      maxRedirects: 2,
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
    }),

    // Multer en memoria — el buffer no toca disco hasta que FirmwareService lo escribe
    MulterModule.register({ storage: memoryStorage() }),

    // SmartoltApiService (legacy) — usado por OltNativoService hasta FASE L
    SmartoltModule,
  ],
  controllers: [OltNativoController],
  providers: [
    // ── Capa: Adaptadores de proveedor (FASE E) ──────────────
    NativoSshProvider,
    SmartoltProvider,
    AdminOltProvider,
    // ── Capa: Infraestructura (FASE D, F, G, H) ──────────────
    OltAutomationClient,
    CircuitBreakerService,
    OltProviderRegistry,
    OltAtomicLockService,
    OltIdempotencyService,
    // ── Capa: Orquestación (FASE I, J) ───────────────────────
    OltOperationRouter,
    OltHealthMonitorService,
    // ── Capa: Dominio ─────────────────────────────────────────
    OltNativoService,
    OltMonitoreoService,
    FirmwareService,
    ProvisionFtthService,
    OltServicePortPoolService,
    FtthRecoveryCron,
  ],
  // Solo exports que módulos externos realmente consumen
  exports: [
    OltNativoService,       // módulos de aprovisionamiento, contratos, etc.
    OltOperationRouter,     // punto de entrada multi-proveedor (FASE L en adelante)
    OltAutomationClient,    // acceso Python directo si se necesita desde otro módulo
    CircuitBreakerService,  // reset manual desde endpoints de administración
    OltProviderRegistry,    // diagnóstico y listado de proveedores disponibles
    ProvisionFtthService,   // aprovisionamiento FTTH bifásico
  ],
})
export class OltNativoModule {}
