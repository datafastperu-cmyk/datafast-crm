import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException,
  Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';

import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { traducirAHttp } from '../../common/domain/resultado-operacion';
import { AuditoriaService } from '../auth/auditoria.service';

import { Permission, RequirePermission } from '../../common/decorators/roles.decorator';
import { PlantaExternaService } from './planta-externa.service';
import { PlantaExternaPuertosService } from './planta-externa-puertos.service';
import { PlantaExternaMapaService, type CapaMapa } from './planta-externa-mapa.service';
import { PlantaExternaTrazaService } from './planta-externa-traza.service';
import { PeMufa } from './entities/pe-mufa.entity';
import { PeNap } from './entities/pe-nap.entity';
import { PeNapPuerto } from './entities/pe-nap-puerto.entity';
import { PeFibraSegmento } from './entities/pe-fibra-segmento.entity';
import { PeAcometida } from './entities/pe-acometida.entity';
import {
  AsignarPuertoDto, CrearFusionDto, CrearMufaDto, CrearNapDto, CrearSegmentoDto,
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
    private readonly mapaSvc: PlantaExternaMapaService,
    private readonly traza: PlantaExternaTrazaService,
    private readonly auditoria: AuditoriaService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ── Visor cartográfico ──────────────────────────────────────────

  /**
   * Datos del mapa, acotados al rectángulo visible.
   *
   * Consulta por bounding box y no "todo lo de la empresa": es lo que hace que el visor
   * responda en milisegundos con la planta completa cargada, y la razón por la que las
   * coordenadas viven en dos columnas numéricas indexadas.
   *
   * La capa `clientes` exige `red:mapa:clientes`, separado de `mikrotik:view`. El guard se
   * resuelve AQUÍ, en el borde, y se pasa como dato al servicio: la autorización debe ser
   * visible donde entra el request, no escondida en una consulta.
   */
  @Get('mapa/extension')
  @ApiOperation({ summary: 'Rectángulo que envuelve toda la planta; null si no hay coordenadas' })
  async extensionMapa(@CurrentUser() user: JwtPayload) {
    return this.mapaSvc.extension(user.empresaId);
  }

  /**
   * Resumen de un abonado, para el popup del mapa.
   *
   * Exige el mismo permiso que la capa de clientes, y el guard se resuelve AQUÍ y no dentro
   * de la consulta: incluye teléfono, que es dato personal. Se sirve de a uno y bajo demanda
   * justamente para no llevar ese dato en la capa, que se recarga con cada movimiento del
   * mapa y convertiría cada arrastre en una descarga del padrón de la zona.
   */
  @Get('mapa/abonado/:contratoId')
  @RequirePermission(Permission.MAPA_CLIENTES)
  @ApiOperation({ summary: 'Datos del abonado para el popup del mapa (incluye PII)' })
  async abonadoMapa(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.mapaSvc.resumenAbonado(user.empresaId, contratoId);
    if (!r) throw new NotFoundException('Contrato no encontrado.');
    return r;
  }

  @Get('mapa')
  @ApiOperation({ summary: 'Capas del mapa de red en formato GeoJSON, acotadas por bounding box' })
  async mapa(
    @Query('minLat') minLat: string,
    @Query('maxLat') maxLat: string,
    @Query('minLng') minLng: string,
    @Query('maxLng') maxLng: string,
    @Query('zoom')   zoom: string,
    @Query('capas')  capas: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const bbox = {
      minLat: Number(minLat), maxLat: Number(maxLat),
      minLng: Number(minLng), maxLng: Number(maxLng),
    };

    // Un bbox inválido devolvería una consulta con NaN que Postgres rechaza con un error
    // críptico. Se corta acá con un motivo legible.
    if (Object.values(bbox).some((v) => !Number.isFinite(v))) {
      throw new BadRequestException('Bounding box inválido: se esperan minLat, maxLat, minLng y maxLng numéricos.');
    }

    const solicitadas = (capas ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean) as CapaMapa[];

    return this.mapaSvc.obtener({
      empresaId: user.empresaId,
      bbox,
      zoom: Number(zoom) || 12,
      capas: solicitadas.length ? solicitadas : ['sites', 'mufas', 'naps', 'fibra'],
      puedeVerClientes: (user.permisos ?? []).includes(Permission.MAPA_CLIENTES),
    });
  }

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

  @Get('mufas/:mufaId')
  @ApiOperation({ summary: 'Detalle de mufa: cables que llegan, hilos, fusiones y splitters' })
  async detalleMufa(
    @Param('mufaId', ParseUUIDPipe) mufaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const detalle = await this.service.detalleMufa(user.empresaId, mufaId);
    if (!detalle) throw new NotFoundException('La mufa no existe.');
    return detalle;
  }

  @Post('mufas/:mufaId/fusiones')
  @ApiOperation({ summary: 'Fusionar dos hilos dentro de la mufa' })
  async crearFusion(
    @Param('mufaId', ParseUUIDPipe) mufaId: string,
    @Body() dto: CrearFusionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.service.crearFusion(user.empresaId, mufaId, dto);
    // Se audita también el rechazo: una fusión mal intentada es información de campo.
    await this.auditoria.logCreate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'planta-externa', entidadId: r.id ?? mufaId,
      descripcion: `Fusión en mufa: ${r.clase}`, datosNuevos: dto,
    });
    return { ...traducirAHttp(r), id: r.id };
  }

  @Delete('fusiones/:fusionId')
  @ApiOperation({ summary: 'Deshacer una fusión y liberar sus hilos' })
  async eliminarFusion(
    @Param('fusionId', ParseUUIDPipe) fusionId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.service.eliminarFusion(user.empresaId, fusionId);
    await this.auditoria.logDelete({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'planta-externa', entidadId: fusionId,
      descripcion: `Fusión deshecha: ${r.clase}`,
    });
    return traducirAHttp(r);
  }

  @Post('mufas/:mufaId/splitters')
  @ApiOperation({ summary: 'Instalar un splitter dentro de la mufa' })
  async instalarSplitterMufa(
    @Param('mufaId', ParseUUIDPipe) mufaId: string,
    @Body() dto: InstalarSplitterDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const r = await this.service.instalarSplitterEnMufa(user.empresaId, { mufaId, ...dto });
    if (r.clase === 'aplicado') {
      await this.auditoria.logCreate({
        empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
        modulo: 'planta-externa', entidadId: r.id,
        descripcion: `Splitter ${dto.relacion} instalado en mufa`, datosNuevos: { mufaId, ...dto },
      });
    }
    return { ...traducirAHttp(r), id: r.id };
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

  @Get('acometidas/contrato/:contratoId')
  @ApiOperation({ summary: 'Acometida de un contrato (puerto NAP asignado), o null si no tiene' })
  async acometidaDeContrato(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    // Devuelve `null` y no 404 cuando no hay acometida: un contrato sin puerto es un
    // estado LEGÍTIMO —todo cliente WISP lo está— y tratarlo como error obligaría al
    // frontend a distinguir "no tiene" de "falló la consulta" por el status code.
    const acometida = await this.ds.getRepository(PeAcometida).findOne({
      where: { contratoId, empresaId: user.empresaId, deletedAt: IsNull() },
    });
    if (!acometida) return null;

    const puerto = await this.ds.getRepository(PeNapPuerto).findOne({
      where: { id: acometida.napPuertoId, empresaId: user.empresaId },
    });
    const nap = puerto
      ? await this.ds.getRepository(PeNap).findOne({ where: { id: puerto.napId } })
      : null;

    return { acometida, puerto, nap };
  }

  @Get('traza/contrato/:contratoId')
  @ApiOperation({ summary: 'Camino óptico del abonado a la cabecera, con presupuesto y contraste real' })
  async trazaContrato(
    @Param('contratoId', ParseUUIDPipe) contratoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    // Lectura óptica real de la ONU del contrato, si existe. Es lo que convierte el
    // cálculo teórico en diagnóstico: sin ella la traza sigue sirviendo para ver el camino,
    // pero no valida nada — y el veredicto lo dice explícitamente en vez de callarlo.
    const [medicion] = await this.ds.query(
      `SELECT inv.rx_power_dbm
         FROM servicios c
         JOIN ftth_onu_registro r ON r.contrato_id = c.id
         JOIN olt_onu_inventario inv
           ON inv.olt_id = r.olt_id AND inv.sn = r.sn
        WHERE c.id = $1 AND c.empresa_id = $2
        LIMIT 1`,
      [contratoId, user.empresaId],
    ).catch(() => [null]);

    return this.traza.trazarContrato(
      user.empresaId,
      contratoId,
      medicion?.rx_power_dbm != null ? Number(medicion.rx_power_dbm) : null,
    );
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
