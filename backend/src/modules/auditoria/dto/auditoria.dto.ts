import { IsOptional, IsString, IsInt, Min, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class FiltrosAuditoriaDto {
  @ApiPropertyOptional() @IsOptional() @IsString()  search?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()  modulo?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()  accion?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()  usuarioId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()  desde?:    string;
  @ApiPropertyOptional() @IsOptional() @IsString()  hasta?:    string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?:  number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

export class RestaurarDto {
  @IsString() tabla: string;
  @IsString() id:    string;
}

export class EliminarPermanenteDto {
  @IsString() tabla: string;
  @IsString() id:    string;
}
