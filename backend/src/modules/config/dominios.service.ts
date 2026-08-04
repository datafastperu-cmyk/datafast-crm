import { Injectable, Logger } from '@nestjs/common';

/**
 * Los tres roles de host de una instalación. Ninguno es obligatorio.
 *
 * El ERP no está atado a ningún dominio, subdominio ni IP —pública o local—. Una
 * instalación válida puede servirse por `http://192.168.1.50:3000` en una LAN sin DNS, y
 * otra por tres subdominios con certificado. Ninguna de las dos es un caso especial.
 */
export type RolHost = 'erp' | 'portal' | 'web';

export interface EstadoHost {
  rol: RolHost;
  /** Lo que nginx SIRVE realmente (viene del `.env`). `null` = ese rol no está publicado. */
  configurado: string | null;
  /** Lo que el ERP DICE en enlaces y avisos (viene de la BD). */
  declarado: string | null;
  coherente: boolean;
  mensaje: string;
}

/**
 * Lee la variable de entorno en el momento de la llamada, no al cargar el módulo.
 *
 * Las constantes de nivel de módulo en NestJS se evalúan ANTES de que `ConfigModule` lea
 * el `.env`, así que quedarían vacías para siempre. Es la directriz de lazy getters de
 * portabilidad multi-VPS.
 */
const env = (clave: string): string | null => {
  const v = (process.env[clave] ?? '').trim().toLowerCase();
  return v ? v.split(':')[0] : null;
};

/**
 * `ERP_DOMAIN` con respaldo en `APP_DOMAIN`.
 *
 * El renombrado necesita periodo de gracia: con tres hosts, "APP" ya no dice cuál es —
 * pero cambiar el nombre a secas rompería toda instalación existente en su próxima
 * actualización, y el fallo sería nginx sin `server_name`, es decir el ERP inaccesible.
 * El respaldo se retira cuando ninguna instalación use ya el nombre viejo.
 */
export const dominioErp    = (): string | null => env('ERP_DOMAIN') ?? env('APP_DOMAIN');
export const dominioPortal = (): string | null => env('PORTAL_DOMAIN');

/**
 * `web.invalid` es el marcador que `docker-compose` pasa cuando no hay web pública
 * configurada: un TLD reservado por la RFC 2606 que ningún DNS resuelve. nginx no admite
 * plantillas condicionales, así que el vhost existe siempre y lo que cambia es si alguien
 * puede llegar. Aquí se traduce de vuelta a "no configurado".
 */
export const dominioWeb = (): string | null => {
  const v = env('WEB_DOMAIN');
  return v === 'web.invalid' ? null : v;
};

/**
 * Verifica que lo que el ERP DICE coincida con lo que nginx SIRVE.
 *
 * Hay dos fuentes de verdad y no pueden unificarse: nginx necesita el dominio al arrancar
 * el contenedor —para el `server_name` y la ruta del certificado—, mucho antes de que
 * exista una base de datos que consultar. Así que el `.env` es la autoridad por fuerza.
 *
 * Lo que la BD guarda (`empresas.dominio`, `portal_config.url_portal`) es una COPIA para
 * mostrar en el panel y para construir los enlaces que se envían al abonado. Si divergen,
 * el ERP manda un enlace que no resuelve — y nadie se entera hasta que un cliente llama.
 *
 * Esta comprobación existe para que la divergencia sea visible antes de eso. Es la regla
 * VIO aplicada a la configuración: la BD no declara dónde vive el ERP, sólo AFIRMA dónde
 * cree que vive, y una afirmación sin verificar no vale como garantía.
 */
@Injectable()
export class DominiosService {
  private readonly logger = new Logger(DominiosService.name);

  /**
   * @param declarados lo que la BD dice de cada rol. Se recibe como dato para que este
   *        servicio no dependa de los repositorios de otros módulos: su trabajo es
   *        comparar, no averiguar.
   */
  evaluar(declarados: Partial<Record<RolHost, string | null>>): EstadoHost[] {
    const servidos: Record<RolHost, string | null> = {
      erp:    dominioErp(),
      portal: dominioPortal(),
      web:    dominioWeb(),
    };

    return (Object.keys(servidos) as RolHost[]).map((rol) => {
      const configurado = servidos[rol];
      const declarado = normalizar(declarados[rol] ?? null);

      // Sin dominio publicado NO es un error: es una instalación servida por IP, que es
      // un modo de uso legítimo y frecuente en redes locales.
      if (!configurado) {
        return {
          rol, configurado, declarado, coherente: true,
          mensaje: declarado
            ? `Hay un dominio guardado ("${declarado}") pero este servidor no lo publica. ` +
              `Los enlaces que use el ERP no van a resolver hasta que se configure en el .env.`
            : 'Sin dominio publicado: esta instalación se sirve por IP.',
        };
      }

      if (!declarado) {
        return {
          rol, configurado, declarado, coherente: true,
          mensaje: `Se sirve en "${configurado}". Falta guardarlo en la configuración para ` +
                   `que el ERP lo use al construir enlaces.`,
        };
      }

      if (declarado !== configurado) {
        return {
          rol, configurado, declarado, coherente: false,
          mensaje: `DISCREPANCIA: este servidor sirve "${configurado}" pero el ERP envía ` +
                   `enlaces a "${declarado}". Los enlaces no resuelven.`,
        };
      }

      return { rol, configurado, declarado, coherente: true, mensaje: 'Coherente.' };
    });
  }
}

/** Acepta lo que el operador haya guardado: con esquema, con puerto, con barra final. */
function normalizar(valor: string | null): string | null {
  if (!valor) return null;
  const limpio = valor
    .trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .split(':')[0];
  return limpio || null;
}
