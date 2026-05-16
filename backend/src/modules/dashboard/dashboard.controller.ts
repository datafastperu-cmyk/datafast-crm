import { Controller, Get, SetMetadata } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse } from '../../common/dto/response.dto';

@ApiTags('Dashboard')
@ApiBearerAuth('JWT')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('stats')
  @SetMetadata('skipAudit', true)
  @ApiOperation({ summary: 'Estadísticas generales del dashboard' })
  async getStats(@CurrentUser() user: JwtPayload) {
    const data = await this.svc.getStats(user.empresaId);
    return ApiResponse.ok(data);
  }
}
