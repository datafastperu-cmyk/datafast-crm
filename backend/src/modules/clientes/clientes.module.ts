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

@Module({
  imports: [
    // Entidades TypeORM
    TypeOrmModule.forFeature([Cliente, ClienteHistorialEstado]),

    // HTTP client para llamadas a RENIEC
    HttpModule.register({
      timeout: 10_000,
      maxRedirects: 3,
      // Headers por defecto para todas las llamadas del módulo
      headers: {
        'User-Agent': 'FibraNet-ISP/1.0',
        Accept: 'application/json',
      },
    }),

    // Multer en memoria (la foto se procesa con sharp antes de guardar)
    MulterModule.register({ storage: memoryStorage() }),

    // Para usar AuditoriaService
    AuthModule,
  ],
  controllers: [ClientesController],
  providers: [
    ClientesService,
    ClienteRepository,
    ReniecService,
  ],
  exports: [
    // Exportar para uso en otros módulos (contratos, facturación, etc.)
    ClientesService,
    ClienteRepository,
  ],
})
export class ClientesModule {}
