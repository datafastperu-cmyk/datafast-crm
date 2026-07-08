import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Tr069Service } from './tr069.service';

@ApiTags('tr069')
@Controller('tr069')
export class Tr069Controller {
  constructor(private readonly tr069: Tr069Service) {}

  // Estado del módulo (ok/degraded). Base para que la UI sepa si el ACS está disponible.
  @Get('status')
  @ApiOperation({ summary: 'Estado del módulo TR-069 / ACS (ok | degraded)' })
  status() {
    return this.tr069.estado();
  }
}
