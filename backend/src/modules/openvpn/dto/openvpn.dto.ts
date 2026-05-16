import {
  IsString, IsOptional, IsInt, IsNotEmpty,
  Min, Max, MaxLength, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateOpenvpnConfigDto {
  @ApiPropertyOptional({ default: 'Servidor VPN' })
  @IsOptional() @IsString() @MaxLength(100)
  nombre?: string;

  @ApiProperty({ example: '149.34.48.224', description: 'IP pública del VPS' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  servidorIp: string;

  @ApiPropertyOptional({ default: 1194 })
  @IsOptional() @IsInt() @Min(1) @Max(65535) @Type(() => Number)
  puerto?: number;

  @ApiPropertyOptional({ enum: ['udp', 'tcp'], default: 'udp' })
  @IsOptional() @IsIn(['udp', 'tcp'])
  protocolo?: string;

  @ApiPropertyOptional({ enum: ['tun', 'tap'], default: 'tun' })
  @IsOptional() @IsIn(['tun', 'tap'])
  dispositivo?: string;

  @ApiPropertyOptional({ example: '10.8.0.0' })
  @IsOptional() @IsString() @MaxLength(20)
  vpnNetwork?: string;

  @ApiPropertyOptional({ example: '255.255.255.0' })
  @IsOptional() @IsString() @MaxLength(20)
  vpnNetmask?: string;

  @ApiPropertyOptional({ description: 'Contenido del certificado CA (PEM)' })
  @IsOptional() @IsString()
  caCert?: string;

  @ApiPropertyOptional({ description: 'Certificado del servidor (PEM)' })
  @IsOptional() @IsString()
  serverCert?: string;

  @ApiPropertyOptional({ description: 'Clave privada del servidor (PEM)' })
  @IsOptional() @IsString()
  serverKey?: string;

  @ApiPropertyOptional({ description: 'Parámetros Diffie-Hellman (PEM)' })
  @IsOptional() @IsString()
  dhParams?: string;
}

export class UpdateOpenvpnConfigDto extends PartialType(CreateOpenvpnConfigDto) {}
