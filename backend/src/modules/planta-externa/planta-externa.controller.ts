import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';

import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { traducirAHttp } from '../../common/domain/resultado-operacion';
import { AuditoriaService } from '../auth/auditoria.service';

import { PlantaExternaService } from './planta-externa.service';
import { PlantaExternaPuertosService } from './planta-externa-puertos.service';
import { PeMufa } from './entities/pe-mufa.entity';
import { PeNap } from './entities/pe-nap.entity';
import { PeNapPuerto } from './entities/pe-nap-puerto.entity';
import { PeFibraSegmento } from './entities/pe-fibra-segmento.entity';
import {
  AsignarPuertoDto, CrearMufaDto, CrearNapDto, CrearSegmentoDto,
  InstalarSplitterDto, TransicionDto,
} from './dto/planta-externa.dto';

/**
 * Borde HTTP del módulo de planta externa.
 *
 * Aquí —y sólo aquí— el vocabulario de dominio se traduce a transporte con
 * `traducirAHttp`. Los servicios devuelven `ResultadoOperacion` porque sus métodos los
 * consume tanto un humano como el cron de barrido, y un status code no distingue "esto
 * nunca va a funcionar" de "vuelve en 5 minutos" (incidente 2026-07-28).
 *
 * `empresaId` sale SIEMPRE del JWT, nunca del body ni del query string: aceptarlo del
 * cliente convertiría cualquier endpoint en un acceso cruzado entre instalaciones.
 */
@ApiTags('Planta Externa')
@Controller('planta-externa')
export class PlantaExternaController {
  constructor(
    private readonly service: PlantaExternaService,
    private readonly puertos: PlantaExternaPuertosService,
    private readonly auditoria: AuditoriaService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ── Mufas ───────────────────────────────────────────────────────

  @Get('mufas')
  @ApiOperation({ summary: 'Listar mufas de la empresa' })
  async listarMufas(@CurrentUser() user: JwtPayload) {
    return this.ds.getRepository(PeMufa).find({
      where: { empresaId: user.empresaId, deletedAt: IsNull() },
      order: { codigo: 'ASC' },
    });
  }

  @Post('mufas')
  @ApiOperation({ summary: 'Crear mufa de empalme' })
  async crearMufa(@Body() dto: CrearMufaDto, @CurrentUser() user: JwtPayload) {
    const mufa = await this.ds.getRepository(PeMufa).save(
      this.ds.getRepository(PeMufa).create({ empresaId: user.empresaId, ...dto }),
    );
    await this.auditoria.logCreate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'planta-externa', entidadId: mufa.id,
      descripcion: `Mufa ${dto.codigo} creada`, datosNuevos: dto,
    });
    return mufa;
  }

  // ── Segmentos de fibra ──────────────────────────────────────────

  @Get('segmentos')
  @ApiOperation({ summary: 'Listar segmentos de fibra' })
  async listarSegmentos(@CurrentUser() user: JwtPayload) {
    return this.ds.getRepository(PeFibraSegmento).find({
      where: { empresaId: user.empresaId, deletedAt: IsNull() },
      order: { codigo: 'ASC' },
    });
  }

  @Post('segmentos')
  @ApiOperation({ summary: 'Crear segmento de fibra (crea sus hilos en la misma transacción)' })
  async crearSegmento(@Body() dto: CrearSegmentoDto, @CurrentUser() user: JwtPayload) {
    const r = await this.service.crearSegmento(user.empresaId, dto);
    if (r.clase === 'aplicado') {
      await this.auditoria.logCreate({
        empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
        modulo: 'planta-externa', entidadId: r.id,
        descripcion: `Segmento ${dto.codigo} creado (${dto.hilosTotales} hilos)`, datosNuevos: dto,
      });
    }
    return { ...traducirAHttp(r), id: r.id };
  }

  // ── Cajas NAP ───────────────────────────────────────────────────

  @Get('naps')
  @ApiOperation({ summary: 'Listar cajas NAP con su ocupación' })
  async listarNaps(@CurrentUser() user: JwtPayload) {
    return this.ds.getRepository(PeNap).find({
      where: { empresaId: user.empresaId, deletedAt: IsNull() },
      order: { codigo: 'ASC' },
    });
  }

  @Get('naps/:napId/puertos')
  @ApiOperation({ summary: 'Puertos de una caja, con su estado real' })
  async listarPuertos(
    @Param('napId', ParseUUIDPipe) napId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ds.getRepository(PeNapPuerto).find({
      where: { napId, empresaId: user.empresaId, deletedAt: IsNull() },
      order: { numero: 'ASC' },
    });
  }

  @Post('naps')
  @ApiOperation({ summary: 'Crear caja NAP (crea sus puertos físicos en no_habilitado)' })
  async crearNap(@Body() dto: CrearNapDto, @CurrentUser() user: JwtPayload) {
    const r = await this.service.crearNap(user.empresaId, dto);
    if (r.clase === 'aplicado') {
      await this.auditoria.logCreate({
        empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
        modulo: 'planta-externa', entidadId: r.id,
        descripcion: `Caja NAP ${dto.codigo} creada (${dto.capacidadPuertos} puertos físicos)`,
        datosNuevos: dto,
      });
    }
    return { ...traducirAHttp(r), id: r.id };
  }

  // ── Splitters ───────────────────────────────────────────────────

  @Post('naps/:napId/splitters')
  @ApiOperation({ summary: 'Instalar splitter en una caja y habilitar sus puertos' })
  async instalarSplitter(
    @Param('napId', ParseUUIDPipe) napId: string,
    @Body() dto: InstalarSplitterDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.service.instalarSplitterEnNap(user.empresaId, { napId, ...dto });
    if (r.clase === 'aplicado') {
      await this.auditoria.logCreate({
        empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
        modulo: 'planta-externa', entidadId: r.id,
        descripcion: `Splitter ${dto.relacion} instalado`, datosNuevos: { napId, ...dto },
      });
    }
    return { ...traducirAHttp(r), id: r.id };
  }

  @Post('splitters/:splitterId/retirar')
  @ApiOperation({ summary: 'Retirar splitter (falla si alimenta puertos en uso)' })
  async retirarSplitter(
    @Param('splitterId', ParseUUIDPipe) splitterId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.service.retirarSplitter(user.empresaId, splitterId);
    await this.auditoria.logDelete({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'planta-externa', entidadId: splitterId,
      descripcion: `Retiro de splitter: ${r.clase}`,
    });
    return traducirAHttp(r);
  }

  // ── Puertos y acometidas ────────────────────────────────────────

  @Post('puertos/:puertoId/reservar')
  @ApiOperation({ summary: 'Reservar un puerto durante un wizard de alta (TTL corto)' })
  async reservar(
    @Param('puertoId', ParseUUIDPipe) puertoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return traducirAHttp(
      await this.puertos.reservarPuerto({
        empresaId: user.empresaId, puertoId, usuarioId: user.sub,
      }),
    );
  }

  @Post('puertos/:puertoId/heartbeat')
  @ApiOperation({ summary: 'Extender la reserva mientras el wizard sigue abierto (con techo absoluto)' })
  async heartbeat(
    @Param('puertoId', ParseUUIDPipe) puertoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return traducirAHttp(
      await this.puertos.extenderReserva({
        empresaId: user.empresaId, puertoId, usuarioId: user.sub,
      }),
    );
  }

  @Post('puertos/:puertoId/asignar')
  @ApiOperation({ summary: 'Asignar el puerto a un contrato (reclamo atómico)' })
  async asignar(
    @Param('puertoId', ParseUUIDPipe) puertoId: string,
    @Body() dto: AsignarPuertoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.puertos.asignarPuerto({
      empresaId: user.empresaId, puertoId, usuarioId: user.sub, ...dto,
    });
    // Se audita SIEMPRE, también el rechazo: quién intentó tomar un puerto ajeno es
    // justamente lo que hace falta saber cuando dos técnicos discuten de quién es.
    await this.auditoria.logUpdate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'planta-externa', entidadId: puertoId,
      descripcion: `Asignación de puerto a contrato ${dto.contratoId}: ${r.clase}`,
      datosNuevos: { contratoId: dto.contratoId, resultado: r.clase },
    });
    return traducirAHttp(r);
  }

  @Post('puertos/:puertoId/liberar')
  @ApiOperation({ summary: 'Liberar el puerto (baja de acometida o cancelación del wizard)' })
  async liberar(
    @Param('puertoId', ParseUUIDPipe) puertoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.puertos.liberarPuerto({ empresaId: user.empresaId, puertoId });
    await this.auditoria.logUpdate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'planta-externa', entidadId: puertoId,
      descripcion: `Liberación de puerto: ${r.clase}`,
    });
    return traducirAHttp(r);
  }

  // ── Transiciones de estado ──────────────────────────────────────

  @Post(':tipo/:id/transicion')
  @ApiOperation({ summary: 'Aplicar una transición de la máquina de estados a un elemento' })
  async transicionar(
    @Param('tipo') tipo: 'mufa' | 'nap' | 'segmento' | 'splitter',
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransicionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.service.transicionarElemento({
      empresaId: user.empresaId, tipo, id, transicion: dto.transicion,
    });
    await this.auditoria.logUpdate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'planta-externa', entidadId: id,
      descripcion: `Transición "${dto.transicion}" sobre ${tipo}: ${r.clase}`,
    });
    return traducirAHttp(r);
  }
}
