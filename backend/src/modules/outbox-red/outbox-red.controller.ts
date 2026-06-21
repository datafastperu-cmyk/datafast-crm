import { Controller, Get, SetMetadata } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { OutboxRedService }                from './outbox-red.service';
import { RequirePermission }               from '../../common/decorators/roles.decorator';
import { ApiResponse as StdResponse }      from '../../common/dto/response.dto';

@ApiTags('Outbox Red')
@ApiBearerAuth('JWT')
@Controller('outbox-red')
export class OutboxRedController {
  constructor(private readonly svc: OutboxRedService) {}

  @Get('status')
  @RequirePermission('mikrotik:view')
  @SetMetadata('skipAudit', true)
  @ApiOperation({
    summary: 'Estado del outbox de comandos de red',
    description:
      'Retorna cantidad de comandos pendientes, agotados y ejecutados en la última hora.',
  })
  async getStatus() {
    return StdResponse.ok(await this.svc.getStatus());
  }
}
