import {
  Controller, Get, Post, Body, Param,
  HttpCode, HttpStatus, Logger, BadRequestException,
  Res, NotFoundException, UploadedFile, UseInterceptors,
  UseFilters, ExceptionFilter, Catch, ArgumentsHost,
} from '@nestjs/common';
import { FileInterceptor }  from '@nestjs/platform-express';
import { diskStorage, MulterError } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';
import { Response } from 'express';
import * as fs     from 'fs';
import * as path   from 'path';
import * as crypto from 'crypto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApiResponse }   from '../../common/dto/response.dto';
import { WaClientService }   from './wa-client.service';
import { CrmNativoService }  from './crm-nativo.service';

const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/datafast/backend/public/crm_whatsapp';

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif',  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',  '.wav': 'audio/wav',  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

const ALLOWED_EXT  = new Set(['.jpg', '.jpeg', '.png', '.pdf']);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);

// ── Filtro para errores de Multer (ej. LIMIT_FILE_SIZE) ──────────
@Catch(MulterError)
class MulterFilter implements ExceptionFilter {
  catch(err: MulterError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'El archivo excede el límite de 10 MB permitido por el sistema'
      : `Error al procesar el archivo: ${err.message}`;
    res.status(400).json({ success: false, message: msg, data: null });
  }
}

// ── DTOs ─────────────────────────────────────────────────────────
class EnviarMensajeDto {
  @IsString() @IsNotEmpty()
  telefono: string;

  @IsString() @IsNotEmpty() @MaxLength(1000)
  texto: string;
}

class EnviarMediaDto {
  @IsString() @IsNotEmpty()
  telefono: string;

  @IsString() @IsOptional() @MaxLength(500)
  caption?: string;
}

// ── Opciones Multer ───────────────────────────────────────────────
const multerOpts = {
  storage: diskStorage({
    destination: (_req: any, _file: any, cb: any) => {
      if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
      cb(null, MEDIA_DIR);
    },
    filename: (_req: any, file: any, cb: any) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits:     { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(file.mimetype)) {
      return cb(new BadRequestException('Solo se permiten imágenes (jpg, png) y documentos PDF.'), false);
    }
    cb(null, true);
  },
};

@ApiTags('CRM Nativo — WhatsApp Web')
@ApiBearerAuth('JWT')
@Controller('crm-nativo')
export class CrmNativoController {
  private readonly logger = new Logger(CrmNativoController.name);

  constructor(
    private readonly waClient: WaClientService,
    private readonly crmSvc:   CrmNativoService,
  ) {}

  // ── GET /api/v1/crm-nativo/estado ────────────────────────────
  @Get('estado')
  @ApiOperation({ summary: 'Estado actual del cliente WhatsApp Web' })
  getEstado() {
    return ApiResponse.ok(this.waClient.getEstado());
  }

  // ── GET /api/v1/crm-nativo/chats ─────────────────────────────
  @Get('chats')
  @ApiOperation({ summary: 'Lista de chats activos' })
  async getChats(@CurrentUser() user: JwtPayload) {
    const chats = await this.crmSvc.listarChats(user.empresaId);
    return ApiResponse.ok(chats);
  }

  // ── GET /api/v1/crm-nativo/mensajes/:chatId ──────────────────
  @Get('mensajes/:chatId')
  @ApiOperation({ summary: 'Mensajes de un chat (últimos 50)' })
  async getMensajes(@Param('chatId') chatId: string) {
    const mensajes = await this.crmSvc.listarMensajes(chatId);
    return ApiResponse.ok(mensajes);
  }

  // ── GET /api/v1/crm-nativo/media/:filename ───────────────────
  @Get('media/:filename')
  @ApiOperation({ summary: 'Descargar archivo multimedia CRM (JWT requerido)' })
  servirMedia(@Param('filename') filename: string, @Res() res: Response) {
    const safe     = path.basename(filename);
    const filePath = path.join(MEDIA_DIR, safe);

    if (!fs.existsSync(filePath)) throw new NotFoundException('Archivo no encontrado');

    const contentType = MIME_MAP[path.extname(safe).toLowerCase()] ?? 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  }

  // ── POST /api/v1/crm-nativo/enviar ───────────────────────────
  @Post('enviar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar mensaje de texto desde el CRM' })
  async enviarMensaje(
    @Body() dto: EnviarMensajeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.waClient.enviarMensaje(
      dto.telefono,
      dto.texto,
      user.nombreCompleto,
      user.empresaId,
    );
    return ApiResponse.ok(result, 'Mensaje enviado');
  }

  // ── POST /api/v1/crm-nativo/enviar-media ─────────────────────
  @Post('enviar-media')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar imagen o PDF al contacto (máx. 10 MB)' })
  @UseFilters(new MulterFilter())
  @UseInterceptors(FileInterceptor('file', multerOpts))
  async enviarMedia(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: EnviarMediaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    const result = await this.waClient.enviarMedia(
      file.path,
      file.filename,
      dto.telefono,
      dto.caption ?? '',
      user.nombreCompleto,
      user.empresaId,
    );
    return ApiResponse.ok(result, 'Media enviada');
  }
}
