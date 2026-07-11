import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CrearXuiServidorDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100)
  nombre: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  descripcion?: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300)
  apiUrl: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  apiKey: string;

  @ApiPropertyOptional() @IsOptional() @IsLatitude() @Type(() => Number)
  latitud?: number;

  @ApiPropertyOptional() @IsOptional() @IsLongitude() @Type(() => Number)
  longitud?: number;
}

export class EditarXuiServidorDto extends CrearXuiServidorDto {}

export class ProbarXuiServidorDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  apiUrl: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  apiKey: string;
}
