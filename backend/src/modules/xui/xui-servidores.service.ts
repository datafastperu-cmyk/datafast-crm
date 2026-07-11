import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { XuiServidor } from './entities/xui-servidor.entity';
import { XuiApiService } from './xui-api.service';
import { CrearXuiServidorDto, EditarXuiServidorDto, ProbarXuiServidorDto } from './dto/xui-servidor.dto';
import { encrypt } from '../../common/utils/encryption.util';

@Injectable()
export class XuiServidoresService {
  constructor(
    @InjectRepository(XuiServidor)
    private readonly repo: Repository<XuiServidor>,
    private readonly xuiApi: XuiApiService,
  ) {}

  async obtener(empresaId: string): Promise<XuiServidor | null> {
    return this.repo.findOne({ where: { empresaId } });
  }

  async probar(dto: ProbarXuiServidorDto) {
    return this.xuiApi.probarConexionExterna(dto.apiUrl, dto.apiKey);
  }

  async crear(dto: CrearXuiServidorDto, empresaId: string): Promise<XuiServidor> {
    const existente = await this.repo.findOne({ where: { empresaId } });
    if (existente) {
      throw new ConflictException('Ya existe un servidor XUI configurado — usa editar en vez de crear otro.');
    }

    const prueba = await this.xuiApi.probarConexionExterna(dto.apiUrl, dto.apiKey);
    if (!prueba.conectado) {
      throw new BadRequestException(`No se pudo verificar la conexión: ${prueba.mensaje}`);
    }

    const catalogo = await this.xuiApi.contarCatalogoRemoto(dto.apiUrl, dto.apiKey);

    const servidor = this.repo.create({
      empresaId,
      nombre:       dto.nombre,
      descripcion:  dto.descripcion,
      apiUrl:       dto.apiUrl,
      apiKey:       encrypt(dto.apiKey),
      latitud:      dto.latitud,
      longitud:     dto.longitud,
      estadoConexion:          'ok',
      ultimaConexionEn:        new Date(),
      totalBouquets:           catalogo.totalBouquets,
      totalCanales:            catalogo.totalCanales,
      totalLineas:             catalogo.totalLineas,
      catalogoSincronizadoEn:  new Date(),
    });
    const guardado = await this.repo.save(servidor);

    await this.xuiApi.recargarConfiguracion();
    return guardado;
  }

  async editar(id: string, dto: EditarXuiServidorDto, empresaId: string): Promise<XuiServidor> {
    const servidor = await this.repo.findOne({ where: { id, empresaId } });
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
      latitud:      dto.latitud,
      longitud:     dto.longitud,
      estadoConexion:          'ok',
      ultimaConexionEn:        new Date(),
      totalBouquets:           catalogo.totalBouquets,
      totalCanales:            catalogo.totalCanales,
      totalLineas:             catalogo.totalLineas,
      catalogoSincronizadoEn:  new Date(),
    });

    await this.xuiApi.recargarConfiguracion();
    return this.repo.findOne({ where: { id } });
  }
}
