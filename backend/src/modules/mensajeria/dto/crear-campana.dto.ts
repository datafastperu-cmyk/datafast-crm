import {
  IsString, IsNotEmpty, IsOptional, IsObject, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CrearCampanaDto {
  @ApiProperty({ description: 'TipoNotificacion o clave TEXTOS para renderizar el cuerpo' })
  @IsString() @IsNotEmpty() @MaxLength(60)
  tipo: string;

  @ApiPropertyOptional({ description: 'ID de plantilla personalizada del proveedor activo' })
  @IsString() @IsOptional()
  templateId?: string;

  @ApiPropertyOptional({ description: 'Zona/Sector — filtra por zona_id en clientes' })
  @IsString() @IsOptional()
  sectorId?: string;

  @ApiPropertyOptional({ description: 'Router Telco — filtra contratos activos por router_id' })
  @IsString() @IsOptional()
  routerId?: string;

  @ApiPropertyOptional({ description: 'Variables extra para el cuerpo del mensaje' })
  @IsObject() @IsOptional()
  variables?: Record<string, string>;
}
