import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Empresa } from './empresa.entity';

export interface UpdateEmpresaDto {
  razonSocial?:              string;
  ruc?:                      string;
  direccion?:                string;
  telefono?:                 string;
  email?:                    string;
  websiteUrl?:               string;
  dominio?:                  string;
  serieBoleta?:              string;
  serieFactura?:             string;
  igvRate?:                  number;
  diaFacturacion?:           number;
  diasGraciaCorte?:          number;
  notifWhatsappVencimiento?: boolean;
  notifWhatsappCorte?:       boolean;
}

@Injectable()
export class ConfigEmpresaService {
  constructor(
    @InjectRepository(Empresa)
    private readonly repo: Repository<Empresa>,
  ) {}

  async getEmpresa(empresaId: string): Promise<Empresa> {
    const empresa = await this.repo.findOne({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    return empresa;
  }

  async updateEmpresa(empresaId: string, dto: UpdateEmpresaDto): Promise<Empresa> {
    const { dominio, ...rest } = dto;
    const updatePayload: Partial<Empresa> = rest as any;
    if (dominio !== undefined) {
      updatePayload.dominio = dominio.trim() || null;
    }
    await this.repo.update({ id: empresaId }, updatePayload);

    if (dominio?.trim()) {
      const baseUrl = dominio.startsWith('http') ? dominio.trim() : `http://${dominio.trim()}`;
      process.env.FRONTEND_URL = baseUrl;
      await this.upsertEnvFile(path.resolve(process.cwd(), '.env.production'), {
        FRONTEND_URL: baseUrl,
      });
    }
    return this.getEmpresa(empresaId);
  }

  async uploadLogo(empresaId: string, file: Express.Multer.File): Promise<{ logoUrl: string }> {
    const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
    const dir = path.join(uploadDir, 'logos');
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(file.originalname) || '.png';
    const filename = `${empresaId}${ext}`;
    await fs.writeFile(path.join(dir, filename), file.buffer);
    const logoUrl = `/uploads/logos/${filename}`;
    await this.repo.update({ id: empresaId }, { logoUrl });
    return { logoUrl };
  }

  private async upsertEnvFile(filePath: string, updates: Record<string, string>): Promise<void> {
    let content = '';
    try { content = await fs.readFile(filePath, 'utf-8'); } catch { /* new file */ }
    for (const [k, v] of Object.entries(updates)) {
      const re = new RegExp(`^${k}=.*$`, 'm');
      const line = `${k}=${v}`;
      content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
    }
    await fs.writeFile(filePath, content, 'utf-8');
  }
}
