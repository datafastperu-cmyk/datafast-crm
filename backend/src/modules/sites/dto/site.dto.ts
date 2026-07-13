import { IsString, IsOptional, IsUUID, IsNumber, MaxLength } from 'class-validator';

export class CreateSiteDto {
  @IsString()
  @MaxLength(150)
  nombre: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ubicacion?: string;

  @IsOptional()
  @IsNumber()
  latitud?: number;

  @IsOptional()
  @IsNumber()
  longitud?: number;

  @IsOptional()
  @IsUUID()
  zonaId?: string;

  @IsOptional()
  @IsUUID()
  routerId?: string;
}

export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombre?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ubicacion?: string;

  @IsOptional()
  @IsNumber()
  latitud?: number;

  @IsOptional()
  @IsNumber()
  longitud?: number;

  @IsOptional()
  @IsUUID()
  zonaId?: string;

  @IsOptional()
  @IsUUID()
  routerId?: string;
}
