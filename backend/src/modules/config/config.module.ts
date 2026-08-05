import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empresa }             from './empresa.entity';
import { ConfigEmpresaService } from './config-empresa.service';
import { EmpresaConfigService } from './empresa-config.service';
import { DominiosService } from './dominios.service';
import { SslService } from './ssl.service';
import { ConfigController }    from './config.controller';

@Module({
  imports:     [TypeOrmModule.forFeature([Empresa])],
  controllers: [ConfigController],
  providers:   [ConfigEmpresaService, EmpresaConfigService, DominiosService, SslService],
  exports:     [ConfigEmpresaService, EmpresaConfigService],
})
export class ConfiguracionModule {}
