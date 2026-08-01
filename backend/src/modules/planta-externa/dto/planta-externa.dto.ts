import {
  IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min, IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { SegmentoJerarquia, TipoInstalacion } from '../entities/pe-fibra-segmento.entity';
import { MufaJerarquia } from '../entities/pe-mufa.entity';
import { SplitterRelacion } from '../entities/pe-splitter.entity';

/**
 * Coordenadas: validadas en rango en el borde HTTP además del CHECK de la BD.
 * El CHECK es la garantía; esto es el mensaje legible.
 *
 * `precisionGpsM` no es decorativo. Un GPS con 2 km de error rellena el formulario
 * exactamente igual que uno bueno; sin persistir la precisión nadie se entera hasta que
 * un técnico viaja a buscar una mufa que no está donde el mapa dice.
 */
export class CoordenadasDto {
  @ApiProperty({ example: -12.0464 })
  @IsNumber() @Min(-90) @Max(90)
  latitud: number;

  @ApiProperty({ example: -77.0428 })
  @IsNumber() @Min(-180) @Max(180)
  longitud: number;

  @ApiPropertyOptional({ description: 'Precisión reportada por el GPS, en metros' })
  @IsOptional() @IsInt() @Min(0) @Max(100000)
  precisionGpsM?: number;
}

export class CrearMufaDto extends CoordenadasDto {
  @ApiProperty() @IsString() @MaxLength(50)
  codigo: string;

  @ApiPropertyOptional({ enum: MufaJerarquia })
  @IsOptional() @IsEnum(MufaJerarquia)
  jerarquia?: MufaJerarquia;

  @ApiPropertyOptional() @IsOptional() @IsString()
  descripcion?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  direccion?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(288)
  capacidadFusiones?: number;
}

export class CrearNapDto extends CoordenadasDto {
  @ApiProperty() @IsString() @MaxLength(50)
  codigo: string;

  /**
   * Adaptadores FÍSICOS de la caja. No es la capacidad de sus splitters: una NAP de 16
   * con un solo 1x8 tiene 8 puertos que se ven y se tocan pero no dan servicio.
   */
  @ApiProperty({ enum: [8, 16, 24, 32] })
  @IsInt() @IsEnum([8, 16, 24, 32] as unknown as object)
  capacidadPuertos: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  direccion?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  descripcion?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  mufaOrigenId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  segmentoAlimentadorId?: string;
}

export class CrearSegmentoDto {
  @ApiProperty() @IsString() @MaxLength(50)
  codigo: string;

  @ApiProperty({ enum: SegmentoJerarquia })
  @IsEnum(SegmentoJerarquia)
  jerarquia: SegmentoJerarquia;

  @ApiProperty({ enum: [2, 4, 6, 8, 12, 24, 48, 96, 144, 288] })
  @IsInt()
  hilosTotales: number;

  @ApiProperty({ description: 'Longitud del tendido en metros. Entra en el presupuesto óptico.' })
  @IsNumber() @Min(0.01)
  longitudM: number;

  @ApiPropertyOptional({ enum: TipoInstalacion })
  @IsOptional() @IsEnum(TipoInstalacion)
  tipoInstalacion?: TipoInstalacion;

  @ApiPropertyOptional({ description: 'dB/km del cable. Varía por fabricante; el default cubre 1490nm típico.' })
  @IsOptional() @IsNumber() @Min(0.1) @Max(2)
  atenuacionDbKm?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  descripcion?: string;

  /**
   * Polilínea del trazado. Es JSONB entrante de cliente: se valida como objeto aquí y el
   * servicio lo persiste tal cual. No se renderiza como HTML en ningún punto.
   */
  @ApiPropertyOptional() @IsOptional() @IsObject()
  rutaGeojson?: Record<string, unknown>;

  // Extremos: exactamente uno de cada terna. El servicio lo verifica y la BD lo garantiza
  // con un CHECK — sin eso un segmento puede colgar de dos nodos o de ninguno, y el
  // recorrido del grafo devolvería rutas que no existen.
  @ApiPropertyOptional() @IsOptional() @IsUUID() origenSiteId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() origenMufaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() origenNapId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() destinoSiteId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() destinoMufaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() destinoNapId?: string;
}

export class InstalarSplitterDto {
  @ApiProperty({ enum: SplitterRelacion })
  @IsEnum(SplitterRelacion)
  relacion: SplitterRelacion;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  codigo?: string;

  @ApiPropertyOptional({ description: 'Pérdida real medida. Si se omite se usa la típica de la relación.' })
  @IsOptional() @IsNumber() @Min(0.1) @Max(29.9)
  perdidaDb?: number;

  @ApiPropertyOptional({ description: 'Hilo que lo alimenta. En el 2º splitter suele ser un hilo de paso.' })
  @IsOptional() @IsUUID()
  hiloEntradaId?: string;
}

export class CrearFusionDto {
  @ApiProperty() @IsUUID()
  hiloAId: string;

  @ApiProperty() @IsUUID()
  hiloBId: string;

  /**
   * Pérdida medida con la fusionadora. El default (0.10 dB) es el valor típico de un
   * empalme bien hecho; el real se registra cuando el técnico lo mide, porque una fusión
   * sucia de 0.8 dB es justo lo que el presupuesto óptico debe poder delatar.
   */
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(4.99)
  perdidaDb?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  observacion?: string;
}

export class AsignarPuertoDto {
  @ApiProperty() @IsUUID()
  contratoId: string;

  @ApiPropertyOptional({ description: 'Metros de drop hasta el domicilio. Entra en el presupuesto óptico.' })
  @IsOptional() @IsNumber() @Min(0) @Max(2000)
  longitudM?: number;
}

export class TransicionDto {
  @ApiProperty({ enum: ['instalar', 'activar', 'averiar', 'reparar', 'retirar'] })
  @IsEnum(['instalar', 'activar', 'averiar', 'reparar', 'retirar'] as unknown as object)
  transicion: 'instalar' | 'activar' | 'averiar' | 'reparar' | 'retirar';
}
