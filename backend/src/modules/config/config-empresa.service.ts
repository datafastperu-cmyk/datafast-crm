import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as dns from 'dns/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Empresa } from './empresa.entity';

const execAsync = promisify(exec);

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

export interface SslStatus {
  hasCert:    boolean;
  expiresAt:  string | null;
  domain:     string | null;
  cloudflare: boolean;
  serverIp:   string;
  domainIp:   string | null;
  dnsOk:      boolean;
}

export interface SslResult {
  success:  boolean;
  message:  string;
  hint?:    string;
  cloudflare?: boolean;
}

// Cloudflare published IPv4 ranges (major blocks — sufficient for detection)
const CLOUDFLARE_RANGES = [
  '103.21.244.', '103.22.200.', '103.31.4.',
  '104.16.',     '104.17.',     '104.18.',     '104.19.',
  '108.162.',    '141.101.',    '162.158.',    '172.64.',    '172.65.',
  '172.66.',     '172.67.',     '173.245.',    '188.114.',   '190.93.',
  '197.234.',    '198.41.',
];

function isCloudflareIp(ip: string): boolean {
  return CLOUDFLARE_RANGES.some(r => ip.startsWith(r));
}

@Injectable()
export class ConfigEmpresaService {
  private readonly logger = new Logger(ConfigEmpresaService.name);

  constructor(
    @InjectRepository(Empresa)
    private readonly repo: Repository<Empresa>,
  ) {}

  // ── Empresa CRUD ──────────────────────────────────────────────

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

  // ── SSL Provisioning ──────────────────────────────────────────

  async getSslStatus(domain: string | null): Promise<SslStatus> {
    const serverIp = await this.getServerPublicIp();
    let domainIp: string | null = null;
    let cloudflare = false;
    let dnsOk = false;

    if (domain) {
      try {
        const addrs = await dns.resolve4(domain);
        domainIp = addrs[0] ?? null;
        cloudflare = domainIp ? isCloudflareIp(domainIp) : false;
        dnsOk = domainIp === serverIp;
      } catch { /* domain doesn't resolve */ }
    }

    let hasCert = false;
    let expiresAt: string | null = null;
    if (domain) {
      try {
        await fs.access(`/etc/letsencrypt/live/${domain}/fullchain.pem`);
        hasCert = true;
        const { stdout } = await execAsync(
          `openssl x509 -enddate -noout -in /etc/letsencrypt/live/${domain}/fullchain.pem`,
        );
        const match = stdout.match(/notAfter=(.*)/);
        if (match) expiresAt = new Date(match[1].trim()).toISOString();
      } catch { /* no cert */ }
    }

    return { hasCert, expiresAt, domain, cloudflare, serverIp, domainIp, dnsOk };
  }

  async provisionSsl(domain: string, contactEmail: string): Promise<SslResult> {
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '');

    // 1. Validate DNS
    const status = await this.getSslStatus(clean);

    if (!status.domainIp) {
      return {
        success: false,
        message: `El dominio "${clean}" no tiene un registro DNS activo.`,
        hint:    'Verifica que el registro A de tu DNS apunte a la IP de este servidor.',
      };
    }

    if (status.cloudflare) {
      return {
        success: false,
        cloudflare: true,
        message: 'Tu dominio pasa por Cloudflare con proxy activo.',
        hint:    'En Cloudflare → DNS → haz clic en el ícono naranja del registro para desactivar el proxy (nube gris). Una vez hecho, vuelve a intentarlo. Puedes reactivarlo después de obtener el certificado.',
      };
    }

    if (!status.dnsOk) {
      return {
        success: false,
        message: `El dominio apunta a ${status.domainIp} pero este servidor está en ${status.serverIp}.`,
        hint:    'Actualiza el registro A de tu DNS para que apunte a la IP correcta.',
      };
    }

    // 2. Prepare webroot dir
    await execAsync('mkdir -p /var/www/certbot/.well-known/acme-challenge').catch(() => null);

    // 3. Ensure nginx serves ACME challenge path on port 80
    await this.writeNginxHttp(clean);
    await execAsync('nginx -s reload').catch(() => null);

    // 4. Run certbot
    try {
      const emailFlag = contactEmail
        ? `--email ${contactEmail} --no-eff-email`
        : '--register-unsafely-without-email';
      await execAsync(
        `certbot certonly --webroot -w /var/www/certbot -d ${clean} --non-interactive --agree-tos ${emailFlag}`,
        { timeout: 60_000 },
      );
    } catch (err: any) {
      this.logger.error(`certbot failed: ${err.message}`);
      return {
        success: false,
        message: 'No se pudo obtener el certificado SSL.',
        hint:    'Verifica que el dominio apunte a este servidor y que el puerto 80 esté accesible desde internet.',
      };
    }

    // 5. Write full SSL nginx config
    await this.writeNginxSsl(clean);
    try {
      await execAsync('nginx -t');
      await execAsync('nginx -s reload');
    } catch (err: any) {
      this.logger.error(`nginx reload failed: ${err.message}`);
      return { success: false, message: 'Certificado obtenido pero hubo un error al reiniciar el servidor web.' };
    }

    // 6. Update FRONTEND_URL
    const baseUrl = `https://${clean}`;
    process.env.FRONTEND_URL = baseUrl;
    await this.upsertEnvFile(path.resolve(process.cwd(), '.env.production'), { FRONTEND_URL: baseUrl });

    // 7. Ensure certbot auto-renewal timer is active
    await execAsync('systemctl enable --now certbot.timer').catch(() => null);

    this.logger.log(`SSL provisioned for ${clean}`);
    return {
      success: true,
      message: `Certificado SSL obtenido correctamente para ${clean}. El sitio ahora funciona con HTTPS.`,
    };
  }

  // ── Nginx config helpers ──────────────────────────────────────

  private async writeNginxHttp(domain: string): Promise<void> {
    const config = `server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:4000;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
    await fs.writeFile('/etc/nginx/sites-enabled/datafast', config, 'utf-8');
  }

  private async writeNginxSsl(domain: string): Promise<void> {
    const config = `server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${domain};

    ssl_certificate     /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
    await fs.writeFile('/etc/nginx/sites-enabled/datafast', config, 'utf-8');
  }

  // ── Helpers ───────────────────────────────────────────────────

  private async getServerPublicIp(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        'curl -s --max-time 5 https://api.ipify.org || curl -s --max-time 5 https://ifconfig.me',
      );
      return stdout.trim();
    } catch {
      return '149.34.48.224';
    }
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
