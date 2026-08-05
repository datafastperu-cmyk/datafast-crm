import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';

import { RolHost, dominioErp, dominioPortal, dominioWeb } from './dominios.service';

const execAsync = promisify(exec);

/**
 * Archivo de vhosts TLS, propiedad EXCLUSIVA del ERP.
 *
 * Se regenera entero en cada emisión. Está separado del archivo que define el enrutado por
 * rol (`datafast-frontend`, escrito a mano) porque son dos responsabilidades distintas:
 * ese define QUÉ sirve cada host, éste sólo añade el escuchar en 443.
 *
 * La versión anterior de este proceso escribía vhosts completos en
 * `/etc/nginx/sites-enabled/datafast`, incluido el `location /` del ERP. Con la separación
 * por roles ya montada eso habría creado un segundo server con el mismo `server_name`:
 * nginx carga los archivos por orden alfabético, así que `datafast` habría ganado a
 * `datafast-frontend` y el portal habría vuelto a servir el panel administrativo. Un botón
 * de la UI no puede tener ese poder.
 */
const ARCHIVO_TLS = '/etc/nginx/sites-enabled/datafast-tls';
const WEBROOT = '/var/www/certbot';

export interface EstadoSslRol {
  rol: RolHost;
  dominio: string | null;
  /** El DNS del dominio resuelve a este servidor (o a un proxy que lo alcanza). */
  alcanzable: boolean;
  tieneCertificado: boolean;
  expiraEn: number | null;
  mensaje: string;
}

export interface ResultadoEmision {
  rol: RolHost;
  dominio: string | null;
  exitoso: boolean;
  mensaje: string;
  pista?: string;
}

/**
 * Emisión y renovación de certificados TLS, operable desde la UI del ERP.
 *
 * Diseñado para que **el servidor se sostenga solo**: con certificados propios el ERP tiene
 * HTTPS por sí mismo, y un CDN o proxy por delante pasa a ser una capa AÑADIDA en vez de un
 * requisito. Una instalación que depende del proxy para tener HTTPS pierde el candado —y con
 * él la geolocalización y la PWA— el día que alguien lo apaga.
 */
@Injectable()
export class SslService {
  private readonly logger = new Logger(SslService.name);

  private dominioDe(rol: RolHost): string | null {
    return { erp: dominioErp(), portal: dominioPortal(), web: dominioWeb() }[rol];
  }

  /** Estado de los tres roles: qué hay publicado, qué resuelve y qué certificado existe. */
  async estado(): Promise<EstadoSslRol[]> {
    const roles: RolHost[] = ['erp', 'portal', 'web'];
    return Promise.all(roles.map((rol) => this.estadoDeRol(rol)));
  }

  private async estadoDeRol(rol: RolHost): Promise<EstadoSslRol> {
    const dominio = this.dominioDe(rol);

    if (!dominio) {
      return {
        rol, dominio, alcanzable: false, tieneCertificado: false, expiraEn: null,
        mensaje: 'Sin dominio configurado para este rol. Si el servidor se usa por IP, no hace falta.',
      };
    }

    const cert = await this.infoCertificado(dominio);
    const alcanzable = await this.retoAlcanzable(dominio);

    if (cert.existe) {
      return {
        rol, dominio, alcanzable, tieneCertificado: true, expiraEn: cert.diasRestantes,
        mensaje: cert.diasRestantes != null && cert.diasRestantes < 15
          ? `El certificado vence en ${cert.diasRestantes} días. La renovación es automática; si no ocurre, vuelve a emitirlo.`
          : `Certificado activo${cert.diasRestantes != null ? `, vence en ${cert.diasRestantes} días` : ''}.`,
      };
    }

    return {
      rol, dominio, alcanzable, tieneCertificado: false, expiraEn: null,
      mensaje: alcanzable
        ? 'Sin certificado. El dominio ya responde a la validación: se puede emitir.'
        : 'Sin certificado. La validación no llega a este servidor — revisa que el DNS apunte aquí y que el puerto 80 esté abierto.',
    };
  }

  /**
   * Comprueba que la validación HTTP-01 pueda completarse ANTES de gastar un intento.
   *
   * Let's Encrypt limita a 5 fallos por hora y dominio. Descubrir el problema tras agotar
   * ese margen deja al operador esperando sin saber por qué, así que primero se coloca un
   * archivo de prueba y se pide desde fuera exactamente igual que hará la autoridad.
   *
   * **Funciona con un proxy tipo Cloudflare delante**: reenvía `/.well-known/acme-challenge/`
   * al origen. Verificado en producción con los tres hosts. La versión anterior rechazaba de
   * plano cuando detectaba Cloudflare y pedía apagar el proxy — eso deja la IP del servidor
   * expuesta mientras dura y, si alguien olvida reactivarlo, indefinidamente.
   */
  private async retoAlcanzable(dominio: string): Promise<boolean> {
    const token = `verificacion-erp-${Date.now()}`;
    const ruta = `${WEBROOT}/.well-known/acme-challenge/${token}`;

    try {
      await execAsync(`mkdir -p ${WEBROOT}/.well-known/acme-challenge`);
      await fs.writeFile(ruta, token, 'utf-8');

      // `-L` sigue redirecciones: un proxy con "forzar HTTPS" activo responde 301 al reto,
      // y la autoridad certificadora también las sigue.
      const { stdout } = await execAsync(
        `curl -sL --max-time 15 http://${dominio}/.well-known/acme-challenge/${token}`,
        { timeout: 20_000 },
      );
      return stdout.trim() === token;
    } catch {
      return false;
    } finally {
      await fs.unlink(ruta).catch(() => null);
    }
  }

  private async infoCertificado(dominio: string): Promise<{ existe: boolean; diasRestantes: number | null }> {
    const ruta = `/etc/letsencrypt/live/${dominio}/fullchain.pem`;
    try {
      await fs.access(ruta);
      const { stdout } = await execAsync(`openssl x509 -enddate -noout -in ${ruta}`);
      const fin = new Date(stdout.replace('notAfter=', '').trim());
      const dias = Math.floor((fin.getTime() - Date.now()) / 86_400_000);
      return { existe: true, diasRestantes: Number.isFinite(dias) ? dias : null };
    } catch {
      return { existe: false, diasRestantes: null };
    }
  }

  /**
   * Emite el certificado de un rol y publica su vhost TLS.
   *
   * Nunca deja nginx en un estado inválido: se valida con `nginx -t` antes de recargar y, si
   * la validación falla, se restaura el archivo anterior. nginx es el frente de todo — una
   * configuración rota no deja el ERP a medias, lo deja caído.
   */
  async emitir(rol: RolHost, email: string): Promise<ResultadoEmision> {
    const dominio = this.dominioDe(rol);

    if (!dominio) {
      return {
        rol, dominio, exitoso: false,
        mensaje: 'Este rol no tiene dominio configurado.',
        pista: 'Defínelo en el archivo .env del servidor y reinicia el ERP.',
      };
    }

    if (!(await this.retoAlcanzable(dominio))) {
      return {
        rol, dominio, exitoso: false,
        mensaje: `La validación no llega a este servidor desde "${dominio}".`,
        pista: 'Comprueba que el registro DNS apunte aquí y que el puerto 80 esté abierto. ' +
               'No hace falta desactivar ningún proxy o CDN: la ruta de validación se reenvía sola.',
      };
    }

    try {
      const flagEmail = email
        ? `--email ${email} --no-eff-email`
        : '--register-unsafely-without-email';
      await execAsync(
        `certbot certonly --webroot -w ${WEBROOT} -d ${dominio} --non-interactive --agree-tos ${flagEmail}`,
        { timeout: 120_000 },
      );
    } catch (err: any) {
      this.logger.error(`certbot falló para ${dominio}: ${err.message}`);
      return {
        rol, dominio, exitoso: false,
        mensaje: 'La autoridad certificadora rechazó la solicitud.',
        pista: 'Let\'s Encrypt limita a 5 intentos fallidos por hora y dominio. Si acabas de ' +
               'reintentar varias veces, espera una hora antes de volver.',
      };
    }

    const publicado = await this.publicarVhostsTls();
    if (!publicado.ok) {
      return {
        rol, dominio, exitoso: false,
        mensaje: `Certificado obtenido, pero no se pudo publicar en el servidor web: ${publicado.error}`,
        pista: 'El certificado está guardado; se publicará al corregir la configuración de nginx.',
      };
    }

    // El temporizador de renovación es lo que evita que esto haya que repetirlo a mano cada
    // 90 días. Si falla no se reporta error: el certificado ya está emitido y funcionando.
    await execAsync('systemctl enable --now certbot.timer').catch(() => null);

    this.logger.log(`Certificado emitido y publicado para ${dominio} (rol ${rol}).`);
    return {
      rol, dominio, exitoso: true,
      mensaje: `HTTPS activo en ${dominio}. La renovación es automática.`,
    };
  }

  /**
   * Regenera el archivo de vhosts TLS con TODOS los roles que tengan certificado.
   *
   * Se regenera entero en vez de añadir bloques: un archivo que sólo crece acumula
   * referencias a certificados borrados, y basta una para que nginx no arranque.
   */
  // `error` se declara en ambas variantes (opcional en la exitosa) porque el `tsconfig` de
  // este backend tiene `strict: false`: sin `strictNullChecks` el compilador no estrecha
  // por `ok`, y un union discriminado puro obligaría a un cast en cada uso.
  private async publicarVhostsTls(): Promise<{ ok: boolean; error?: string }> {
    const roles: RolHost[] = ['erp', 'portal', 'web'];
    const bloques: string[] = [];

    for (const rol of roles) {
      const dominio = this.dominioDe(rol);
      if (!dominio) continue;
      if (!(await this.infoCertificado(dominio)).existe) continue;
      bloques.push(this.bloqueTls(rol, dominio));
    }

    if (bloques.length === 0) return { ok: true };

    const contenido =
      '# GENERADO POR EL ERP — no editar a mano.\n' +
      '# Se regenera entero cada vez que se emite un certificado desde /configuracion.\n' +
      '# El enrutado por rol vive en `datafast-frontend`; este archivo sólo agrega el 443.\n\n' +
      bloques.join('\n');

    // Copia de seguridad antes de escribir: si `nginx -t` rechaza el resultado, se vuelve
    // atrás y el servidor sigue sirviendo lo que servía.
    const previo = await fs.readFile(ARCHIVO_TLS, 'utf-8').catch(() => null);

    try {
      await fs.writeFile(ARCHIVO_TLS, contenido, 'utf-8');
      await execAsync('nginx -t');
      await execAsync('nginx -s reload');
      return { ok: true };
    } catch (err: any) {
      if (previo !== null) await fs.writeFile(ARCHIVO_TLS, previo, 'utf-8').catch(() => null);
      else await fs.unlink(ARCHIVO_TLS).catch(() => null);
      await execAsync('nginx -s reload').catch(() => null);
      return { ok: false, error: String(err.message ?? err).slice(0, 300) };
    }
  }

  /**
   * Bloque TLS de un rol.
   *
   * Reutiliza los MISMOS snippets que el vhost de 80, así que el sitio no puede comportarse
   * distinto por HTTPS que por HTTP. Duplicar las reglas aquí habría creado dos verdades que
   * divergen en la primera modificación que alguien haga sólo en una.
   */
  private bloqueTls(rol: RolHost, dominio: string): string {
    const rutaCert = `/etc/letsencrypt/live/${dominio}`;

    const cuerpo = rol === 'portal'
      ? '    include /etc/nginx/snippets/datafast-portal.conf;'
      : rol === 'web'
        ? '    include /etc/nginx/snippets/datafast-web.conf;'
        : '    include /etc/nginx/snippets/datafast-erp.conf;';

    return `server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${dominio};

    ssl_certificate     ${rutaCert}/fullchain.pem;
    ssl_certificate_key ${rutaCert}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size ${rol === 'portal' ? '10M' : '25M'};

    include /etc/nginx/snippets/datafast-acme.conf;
${cuerpo}
}
`;
  }
}
