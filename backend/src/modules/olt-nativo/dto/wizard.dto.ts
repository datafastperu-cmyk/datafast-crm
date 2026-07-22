import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TipoOperacionWizard } from '../services/operacion-wizard.service';

const TIPOS: TipoOperacionWizard[] = ['ftth_provision', 'router_vpn', 'olt_wizard'];

export class AbrirWizardDto {
  @ApiProperty({ enum: TIPOS, description: 'Tipo de procedimiento operativo' })
  @IsIn(TIPOS)
  tipo: TipoOperacionWizard;

  @ApiProperty({ description: 'Recurso sobre el que opera el wizard (p.ej. contratoId)' })
  @IsString()
  @MaxLength(64)
  recursoRef: string;
}

export class CerrarWizardDto {
  @ApiPropertyOptional({ description: 'Motivo del cierre — queda en auditoría' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}
