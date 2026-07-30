import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional, IsString, IsBoolean, IsInt, IsUrl, IsHexColor, IsIn,
  IsDateString, MaxLength, Min, Max,
} from 'class-validator';

export class UpdatePortalConfigDto {
  // ── General ──────────────────────────────────────────────────
  @ApiPropertyOptional({ example: 'https://cliente.miempresa.pe' })
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(255)
  urlPortal?: string;

  @ApiPropertyOptional({ example: 'Acceso Cliente' })
  @IsOptional() @IsString() @MaxLength(100)
  titulo?: string;

  @ApiPropertyOptional({ example: 'https://fast.com/es/' })
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(255)
  urlTestVelocidad?: string;

  @ApiPropertyOptional({ example: 'Lugares de Pagos' })
  @IsOptional() @IsString() @MaxLength(100)
  tituloMenuPersonalizado?: string;

  @ApiPropertyOptional({ description: 'Texto plano. No admite HTML.' })
  @IsOptional() @IsString() @MaxLength(5000)
  contenidoMenuPersonalizado?: string;

  // ── Secciones habilitadas ────────────────────────────────────
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mostrarComprobantes?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mostrarSoporte?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mostrarInformarPago?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mostrarTestVelocidad?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mostrarNotificaciones?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mostrarWifi?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mostrarDispositivos?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mostrarPlanes?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mostrarBanner?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mostrarMenuPersonalizado?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() mostrarConsumo?: boolean;

  // ── Reporte de pago ──────────────────────────────────────────
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  reportePagoDestinatarios?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  reportePagoMedios?: string;

  // ── Diseño ───────────────────────────────────────────────────
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  logoUrl?: string;

  @ApiPropertyOptional({ example: '#16A34A' })
  @IsOptional() @IsHexColor()
  colorPrimario?: string;

  @ApiPropertyOptional({ enum: ['claro', 'oscuro', 'auto'] })
  @IsOptional() @IsIn(['claro', 'oscuro', 'auto'])
  tema?: string;
}

export class UpsertPortalBannerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  titulo?: string;

  @ApiPropertyOptional() @IsString() @MaxLength(255)
  imagenUrl: string;

  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(255)
  enlaceUrl?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(999)
  orden?: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  vigenteDesde?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  vigenteHasta?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  activo?: boolean;
}
