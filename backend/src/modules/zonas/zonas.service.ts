import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Zona } from './zona.entity';

@Injectable()
export class ZonasService {
  constructor(
    @InjectRepository(Zona)
    private readonly repo: Repository<Zona>,
  ) {}

  async list(empresaId: string, search?: string): Promise<Zona[]> {
    return this.repo.find({
      where: {
        empresaId,
        activo: true,
        ...(search ? { nombre: ILike(`%${search}%`) } : {}),
      },
      order: { nombre: 'ASC' },
    });
  }

  async create(empresaId: string, nombre: string): Promise<Zona> {
    const existe = await this.repo.findOne({ where: { empresaId, nombre, activo: true } });
    if (existe) throw new ConflictException(`Ya existe una zona con el nombre "${nombre}"`);
    const zona = this.repo.create({ empresaId, nombre });
    return this.repo.save(zona);
  }

  async update(id: string, empresaId: string, nombre: string): Promise<Zona> {
    const zona = await this.repo.findOne({ where: { id, empresaId, activo: true } });
    if (!zona) throw new NotFoundException('Zona no encontrada');
    zona.nombre = nombre;
    return this.repo.save(zona);
  }

  async remove(id: string, empresaId: string): Promise<void> {
    const zona = await this.repo.findOne({ where: { id, empresaId, activo: true } });
    if (!zona) throw new NotFoundException('Zona no encontrada');
    await this.repo.update(id, { activo: false });
  }
}
