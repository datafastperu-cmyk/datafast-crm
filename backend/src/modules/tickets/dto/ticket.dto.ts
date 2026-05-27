import {
  IsString, IsEnum, IsOptional, IsUUID, IsInt, Min, Max,
  IsBoolean, IsArray, MaxLength, MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CategoriaTicket, PrioridadTicket, EstadoTicket } from '../entities/ticket.entity';
import { PaginationDto } from '../../../common/dto/response.dto';

export class CreateTicketDto {
  @IsUUID() clienteId: string;
  @IsOptional() @IsUUID() contratoId?: string;
  @IsString() @MinLength(5) @MaxLength(250) titulo: string;
  @IsString() @MinLength(10) descripcion: string;
  @IsOptional() @IsEnum(CategoriaTicket) categoria?: CategoriaTicket;
  @IsOptional() @IsEnum(PrioridadTicket) prioridad?: PrioridadTicket;
  @IsOptional() @IsUUID() tecnicoId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(168) slaHoras?: number;
}

export class UpdateTicketDto {
  @IsOptional() @IsString() @MaxLength(250) titulo?: string;
  @IsOptional() @IsString() descripcion?: string;
  @IsOptional() @IsEnum(CategoriaTicket) categoria?: CategoriaTicket;
  @IsOptional() @IsEnum(PrioridadTicket) prioridad?: PrioridadTicket;
  @IsOptional() @IsEnum(EstadoTicket) estado?: EstadoTicket;
  @IsOptional() @IsUUID() tecnicoId?: string;
  @IsOptional() @IsUUID() supervisorId?: string;
  @IsOptional() @IsString() solucion?: string;
  @IsOptional() @IsString() causaRaiz?: string;
  @IsOptional() @IsInt() @Min(1) @Max(168) slaHoras?: number;
}

export class CerrarTicketDto {
  @IsString() @MinLength(10) solucion: string;
  @IsOptional() @IsString() causaRaiz?: string;
}

export class CalificarTicketDto {
  @IsInt() @Min(1) @Max(5) calificacion: number;
  @IsOptional() @IsString() comentario?: string;
}

export class CreateComentarioDto {
  @IsString() @MinLength(1) contenido: string;
  @IsOptional() @IsBoolean() esPrivado?: boolean;
  @IsOptional() @IsBoolean() esNotaInterna?: boolean;
}

export class FilterTicketDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(EstadoTicket) estado?: EstadoTicket;
  @ApiPropertyOptional() @IsOptional() @IsArray() estados?: EstadoTicket[];
  @ApiPropertyOptional() @IsOptional() @IsEnum(CategoriaTicket) categoria?: CategoriaTicket;
  @ApiPropertyOptional() @IsOptional() @IsEnum(PrioridadTicket) prioridad?: PrioridadTicket;
  @ApiPropertyOptional() @IsOptional() @IsUUID() clienteId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tecnicoId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() @Type(() => Boolean) slaPendiente?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() fechaDesde?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fechaHasta?: string;
}
