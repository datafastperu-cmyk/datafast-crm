import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { XuiServidor } from './entities/xui-servidor.entity';
import { XuiApiService } from './xui-api.service';
import { CrearXuiServidorDto, EditarXuiServidorDto, ProbarXuiServidorDto } from './dto/xui-servidor.dto';
import { encrypt, decrypt } from '../../common/utils/encryption.util';
import { AuditoriaService } from '../auth/auditoria.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

// Vista pública — nunca expone apiKey (ni cifrada) al frontend.
export type XuiServidorPublico = Omit<XuiServidor, 'apiKey'> & { apiKeyMask: string | null };

function aPublico(servidor: XuiServidor): XuiServidorPublico {
  const { apiKey, ...resto } = servidor;
  return {
    ...resto,
    apiKeyMask: servidor.apiKeyUltimos4 ? `••••••••${servidor.apiKeyUltimos4}` : null,
  };
}

@Injectable()
export class XuiServidoresService {
  constructor(
    @InjectRepository(XuiServidor)
    private readonly repo: Repository<XuiServidor>,
    private readonly xuiApi: XuiApiService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async obtener(empresaId: string): Promise<XuiServidorPublico | null> {
    const servidor = await this.repo.findOne({ where: { empresaId } });
    return servidor ? aPublico(servidor) : null;
  }

  async probar(dto: ProbarXuiServidorDto) {
    return this.xuiApi.probarConexionExterna(dto.apiUrl, dto.apiKey);
  }

  async crear(dto: CrearXuiServidorDto, user: JwtPayload, req?: any): Promise<XuiServidorPublico> {
    const existente = await this.repo.findOne({ where: { empresaId: user.empresaId } });
    if (existente) {
      throw new ConflictException('Ya existe un servidor XUI configurado — usa editar en vez de crear otro.');
    }

    const prueba = await this.xuiApi.probarConexionExterna(dto.apiUrl, dto.apiKey);
    if (!prueba.conectado) {
      throw new BadRequestException(`No se pudo verificar la conexión: ${prueba.mensaje}`);
    }

    const catalogo = await this.xuiApi.contarCatalogoRemoto(dto.apiUrl, dto.apiKey);

    const servidor = this.repo.create({
      empresaId:    user.empresaId,
      nombre:       dto.nombre,
      descripcion:  dto.descripcion,
      apiUrl:       dto.apiUrl,
      apiKey:       encrypt(dto.apiKey),
      apiKeyUltimos4: dto.apiKey.slice(-4),
      latitud:      dto.latitud,
      longitud:     dto.longitud,
      estadoConexion:          'ok',
      ultimaConexionEn:        new Date(),
      latenciaMs:              prueba.latenciaMs ?? null,
      xuiVersion:              prueba.version ?? null,
      hostname:                prueba.hostname ?? null,
      totalBouquets:           catalogo.totalBouquets,
      totalCanales:            catalogo.totalCanales,
      totalLineas:             catalogo.totalLineas,
      catalogoSincronizadoEn:  new Date(),
    });
    const guardado = await this.repo.save(servidor);

    await this.xuiApi.recargarConfiguracion();
    await this.auditoria.logCreate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'xui', entidadId: guardado.id, descripcion: `Servidor XUI ONE configurado: ${guardado.nombre}`, req,
    });
    return aPublico(guardado);
  }

  async editar(id: string, dto: EditarXuiServidorDto, user: JwtPayload, req?: any): Promise<XuiServidorPublico> {
    const servidor = await this.repo.findOne({ where: { id, empresaId: user.empresaId } });
    if (!servidor) throw new NotFoundException('Servidor XUI no encontrado');

    const prueba = await this.xuiApi.probarConexionExterna(dto.apiUrl, dto.apiKey);
    if (!prueba.conectado) {
      throw new BadRequestException(`No se pudo verificar la conexión: ${prueba.mensaje}`);
    }

    const catalogo = await this.xuiApi.contarCatalogoRemoto(dto.apiUrl, dto.apiKey);

    await this.repo.update(id, {
      nombre:       dto.nombre,
      descripcion:  dto.descripcion,
      apiUrl:       dto.apiUrl,
      apiKey:       encrypt(dto.apiKey),
      apiKeyUltimos4: dto.apiKey.slice(-4),
      latitud:      dto.latitud,
      longitud:     dto.longitud,
      estadoConexion:          'ok',
      ultimaConexionEn:        new Date(),
      latenciaMs:              prueba.latenciaMs ?? null,
      xuiVersion:              prueba.version ?? null,
      hostname:                prueba.hostname ?? null,
      totalBouquets:           catalogo.totalBouquets,
      totalCanales:            catalogo.totalCanales,
      totalLineas:             catalogo.totalLineas,
      catalogoSincronizadoEn:  new Date(),
    });

    await this.xuiApi.recargarConfiguracion();
    await this.auditoria.logUpdate({
      empresaId: user.empresaId, usuarioId: user.sub, usuarioEmail: user.email,
      modulo: 'xui', entidadId: id, descripcion: `Servidor XUI ONE editado: ${dto.nombre}`, req,
    });
    return aPublico(await this.repo.findOne({ where: { id } }));
  }

  // Refresca solo los totales de catálogo, reutilizando las credenciales ya
  // guardadas — no requiere reingresar la API Key ni volver a "Guardar".
  async sincronizar(id: string, empresaId: string): Promise<XuiServidorPublico> {
    const servidor = await this.repo.findOne({ where: { id, empresaId } });
    if (!servidor) throw new NotFoundException('Servidor XUI no encontrado');

    const apiKeyPlano = decrypt(servidor.apiKey);
    const prueba = await this.xuiApi.probarConexionExterna(servidor.apiUrl, apiKeyPlano);
    if (!prueba.conectado) {
      await this.repo.update(id, {
        estadoConexion: 'error',
        ultimoErrorConexion: prueba.mensaje,
        ultimaConexionEn: new Date(),
        latenciaMs: prueba.latenciaMs ?? null,
      });
      throw new BadRequestException(`No se pudo sincronizar: ${prueba.mensaje}`);
    }

    const catalogo = await this.xuiApi.contarCatalogoRemoto(servidor.apiUrl, apiKeyPlano);
    await this.repo.update(id, {
      estadoConexion:          'ok',
      ultimoErrorConexion:     null,
      ultimaConexionEn:        new Date(),
      latenciaMs:              prueba.latenciaMs ?? null,
      xuiVersion:              prueba.version ?? servidor.xuiVersion,
      hostname:                prueba.hostname ?? servidor.hostname,
      totalBouquets:           catalogo.totalBouquets,
      totalCanales:            catalogo.totalCanales,
      totalLineas:             catalogo.totalLineas,
      catalogoSincronizadoEn:  new Date(),
    });
    return aPublico(await this.repo.findOne({ where: { id } }));
  }
}
