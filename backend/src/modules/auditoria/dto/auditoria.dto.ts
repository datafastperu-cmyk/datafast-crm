import { IsOptional, IsString, IsInt, Min, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export class FiltrosAuditoriaDto {
  @ApiPropertyOptional() @IsOptional() @IsString()  search?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()  modulo?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()  accion?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()  usuarioId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()  desde?:    string;
  @ApiPropertyOptional() @IsOptional() @IsString()  hasta?:    string;

  /**
   * `true` (por defecto en la pantalla de Log) oculta el eco de peticiones HTTP que el
   * AuditInterceptor escribe para CADA request —"POST /api/v1/auth/refresh (2265ms)"—.
   * Son 24.568 de 25.772 registros: sin este filtro, la actividad real del negocio queda
   * enterrada y la pantalla es inservible para lo que se usa (quién cobró, a quién se
   * cortó, quién entró).
   */
  @ApiPropertyOptional() @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  soloNegocio?: boolean;

  /** 'usuario' = lo hizo una persona; 'sistema' = cron, worker o automatismo. */
  @ApiPropertyOptional() @IsOptional() @IsString() @IsIn(['usuario', 'sistema'])
  origen?: 'usuario' | 'sistema';
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
