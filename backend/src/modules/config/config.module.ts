import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empresa }             from './empresa.entity';
import { ConfigEmpresaService } from './config-empresa.service';
import { EmpresaConfigService } from './empresa-config.service';
import { ConfigController }    from './config.controller';

@Module({
  imports:     [TypeOrmModule.forFeature([Empresa])],
  controllers: [ConfigController],
  providers:   [ConfigEmpresaService, EmpresaConfigService],
  exports:     [ConfigEmpresaService, EmpresaConfigService],
})
export class ConfiguracionModule {}
