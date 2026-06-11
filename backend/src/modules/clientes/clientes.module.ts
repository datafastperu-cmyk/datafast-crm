import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { ClienteRepository } from './repositories/cliente.repository';
import { ReniecService } from './reniec.service';

import { Cliente, ClienteHistorialEstado } from './entities/cliente.entity';
import { AuthModule } from '../auth/auth.module';
import { ContratosModule } from '../contratos/contratos.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports: [
    // Entidades TypeORM
    TypeOrmModule.forFeature([Cliente, ClienteHistorialEstado]),
    ContratosModule,

    // HTTP client para llamadas a RENIEC
    HttpModule.register({
      timeout: 10_000,
      maxRedirects: 3,
      // Headers por defecto para todas las llamadas del módulo
      headers: {
        'User-Agent': 'DATAFAST-ISP/1.0',
        Accept: 'application/json',
      },
    }),

    // Multer en memoria (la foto se procesa con sharp antes de guardar)
    MulterModule.register({ storage: memoryStorage() }),

    // Para usar AuditoriaService
    AuthModule,
    NotificacionesModule,
  ],
  controllers: [ClientesController],
  providers: [
    ClientesService,
    ClienteRepository,
    ReniecService,
    // Dependencias resueltas vía módulos globales en AppModule:
    // - LicenciaService    → @Global() LicenciaModule
    // - EventEmitter2      → EventEmitterModule.forRoot()
    // - CACHE_MANAGER      → CacheModule.registerAsync()
    // - DataSource         → TypeOrmModule.forRootAsync()
  ],
  exports: [
    // Exportar para uso en otros módulos (contratos, facturación, etc.)
    ClientesService,
    ClienteRepository,
  ],
})
export class ClientesModule {}
