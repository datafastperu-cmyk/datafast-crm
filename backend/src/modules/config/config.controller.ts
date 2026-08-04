import {
  Controller, Get, Put, Post,
  Body, UploadedFile, UseInterceptors,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission }       from '../../common/decorators/roles.decorator';
import { ApiResponse }             from '../../common/dto/response.dto';
import { ConfigEmpresaService, UpdateEmpresaDto, FacturacionResumen } from './config-empresa.service';
import { DominiosService } from './dominios.service';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@ApiTags('Configuración')
@ApiBearerAuth('JWT')
@Controller('config')
export class ConfigController {
  constructor(
    private readonly svc: ConfigEmpresaService,
    private readonly dominios: DominiosService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  @Get('empresa')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Obtener datos de la empresa' })
  async getEmpresa(@CurrentUser() user: JwtPayload) {
    const empresa = await this.svc.getEmpresa(user.empresaId);
    return ApiResponse.ok(empresa);
  }

  @Put('empresa')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Actualizar datos de la empresa' })
  async updateEmpresa(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateEmpresaDto,
  ) {
    const empresa = await this.svc.updateEmpresa(user.empresaId, dto);
    return ApiResponse.ok(empresa, 'Configuración guardada');
  }

  @Post('empresa/logo')
  @RequirePermission('configuracion:manage')
  @ApiOperation({ summary: 'Subir logo de la empresa' })
  @UseInterceptors(FileInterceptor('logo', {
    storage: memoryStorage(),
    limits:  { fileSize: 2 * 1024 * 1024 },
  }))
  async uploadLogo(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const result = await this.svc.uploadLogo(user.empresaId, file);
    return ApiResponse.ok(result, 'Logo actualizado');
  }

  @Get('facturacion-resumen')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Resumen en vivo de facturación: correlativos y deuda pendiente' })
  async getFacturacionResumen(@CurrentUser() user: JwtPayload) {
    const resumen = await this.svc.getFacturacionResumen(user.empresaId);
    return ApiResponse.ok(resumen);
  }

  /**
   * Estado de los tres roles de host: qué sirve nginx y qué dice el ERP.
   *
   * Existe porque hay dos fuentes de verdad que no pueden unificarse: nginx necesita el
   * dominio al arrancar el contenedor —antes de que exista una BD que consultar—, así que
   * el `.env` manda; la BD guarda una copia para construir enlaces. Si divergen, el ERP
   * envía al abonado una URL que no resuelve y nadie se entera hasta que llama.
   */
  @Get('dominios')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Coherencia entre los hosts que sirve el servidor y los que declara el ERP' })
  async getDominios(@CurrentUser() user: JwtPayload) {
    const empresa = await this.svc.getEmpresa(user.empresaId);

    // El portal guarda su URL pública aparte, en su propia configuración. Se lee con
    // tolerancia a fallo: un problema al consultarla no debe impedir ver el estado del
    // resto de los hosts.
    let portalDeclarado: string | null = null;
    try {
      const [fila] = await this.ds.query(
        `SELECT url_portal FROM portal_config WHERE empresa_id = $1 LIMIT 1`,
        [user.empresaId],
      );
      portalDeclarado = fila?.url_portal ?? null;
    } catch { /* el estado de los otros roles sigue siendo útil */ }

    return ApiResponse.ok(
      this.dominios.evaluar({
        erp: empresa.dominio ?? null,
        portal: portalDeclarado,
        // La web pública todavía no tiene dónde declararse en la BD: la sección está por
        // construir. Hasta entonces sólo se informa lo que el servidor publica.
        web: null,
      }),
    );
  }

  @Get('ssl-status')
  @RequirePermission('configuracion:view')
  @ApiOperation({ summary: 'Estado del certificado SSL del dominio configurado' })
  async getSslStatus(@CurrentUser() user: JwtPayload) {
    const empresa = await this.svc.getEmpresa(user.empresaId);
    const status  = await this.svc.getSslStatus(empresa.dominio);
    return ApiResponse.ok(status);
  }

  @Post('provisionar-ssl')
  @RequirePermission('configuracion:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtener certificado SSL automáticamente para el dominio configurado' })
  async provisionarSsl(@CurrentUser() user: JwtPayload) {
    const empresa = await this.svc.getEmpresa(user.empresaId);
    if (!empresa.dominio) {
      return ApiResponse.ok({ success: false, message: 'Configura primero el dominio de tu servidor.' });
    }
    const result = await this.svc.provisionSsl(empresa.dominio, empresa.email ?? '');
    return ApiResponse.ok(result, result.message);
  }
}
