import { Global, Module } from '@nestjs/common';
import { ModuleHealthService } from './services/module-health.service';

// @Global() hace que ModuleHealthService sea inyectable en cualquier módulo
// sin necesidad de importar ModuleHealthModule explícitamente.
@Global()
@Module({
  providers: [ModuleHealthService],
  exports:   [ModuleHealthService],
})
export class ModuleHealthModule {}
