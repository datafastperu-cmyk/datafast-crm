import {
  Injectable, NotFoundException, BadRequestException,
  ForbiddenException, ServiceUnavailableException, Logger, Inject, OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

import { ProvisionFtthService } from '../olt-nativo/services/provision-ftth.service';
import { OnuTr069DetalleService, OnuHost } from '../olt-nativo/ztp/onu-tr069-detalle.service';
import { ModuleHealthService } from '../../common/services/module-health.service';

// Mi WiFi y dispositivos conectados, desde la óptica del abonado.
//
// Toda la maquinaria (carril TR-069 bajo demanda, GenieACS, OLT) ya existe y se reutiliza:
// este servicio traduce, valida y protege — no reimplementa nada del plano de red.

const MINUTOS_ENTRE_CONEXIONES = 10;

// Límite de escrituras WiFi. Lo que hay que evitar es MARTILLEAR el equipo, no que el
// abonado configure su casa: dejar las dos bandas a su gusto son ya 2 escrituras, y si
// una no converge a la primera querrá repetir. Un tope diario de 3 se agotaba antes de
// terminar de configurar.
//
// Se protege con lo que ataca el riesgo real —una espera corta entre escrituras— más un
// techo diario amplio contra el abuso sostenido.
const ESPERA_ENTRE_CAMBIOS_MS = 20_000;
const MAX_CAMBIOS_WIFI_DIA    = 12;
// Una sesión TR-069 se considera viva con el mismo criterio que usa el ERP (12 min).
const VIVO_MS = 12 * 60_000;

export type CarrilVisible = 'desconectado' | 'conectando' | 'conectado' | 'error';

export interface PortalOnuEstado {
  // `false` cuando el servicio no tiene ONU gestionable: inalámbrico, router propio,
  // o FTTH sin registro. La sección se muestra explicada, nunca vacía ni rota.
  disponible: boolean;
  motivo:     string | null;
  carril:     CarrilVisible;
  vivo:       boolean;
  mensaje:    string;
}

export interface PortalBandaWifi {
  banda:   '2.4' | '5';
  ssid:    string | null;
  activa:  boolean | null;
}

export interface PortalWifi {
  bandas:      PortalBandaWifi[];
  // Antigüedad de la lectura. Un formulario editable sobre datos rancios sobrescribe
  // una configuración que nadie está viendo: el abonado tiene derecho a saberlo.
  ultimaLectura: string | null;
  editable:      boolean;
  motivoNoEditable: string | null;
}

export interface PortalDispositivo {
  nombre:   string;
  ip:       string | null;
  mac:      string | null;
  conexion: '2.4' | '5' | 'wifi' | 'lan';
  activo:   boolean;
}

// Vocabulario de dominio: "aceptado" y "confirmado" son estados distintos y el abonado
// debe distinguirlos. Nunca se dice "guardado" sin haberlo releído del equipo.
export interface ResultadoWifi {
  clase:   'confirmado' | 'sin_confirmar';
  mensaje: string;
}

interface FilaRegistro {
  registro_id: string;
  sn: string;
  estado: string;
  carril_estado: string;
  contrato_estado: string;
}

@Injectable()
export class PortalOnuService implements OnModuleInit {
  private readonly logger = new Logger(PortalOnuService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ftth: ProvisionFtthService,
    private readonly detalle: OnuTr069DetalleService,
    private readonly moduleHealth: ModuleHealthService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // Las secciones de red del portal (Mi WiFi, dispositivos) dependen de GenieACS. Ya se
  // degradaban de cara al abonado —muestran "no disponible" con motivo mientras el resto
  // del portal sigue en pie—, pero esa degradación era INVISIBLE para el operador: no
  // figuraba en /health/modules. Con el portal en producción, ese es justo el dato que se
  // mira primero cuando alguien reporta "no puedo cambiar mi WiFi".
  //
  // El probe es un chequeo de configuración, no de liveness: `isReady()` mira si el NBI
  // está configurado, y eso no cambia en caliente. La salud del ACS vivo la publica el
  // módulo `tr069`, que sí lo sondea; duplicar ese sondeo aquí sería un segundo poller
  // contra GenieACS que puede contradecir al primero.
  onModuleInit(): void {
    try {
      if (this.detalle.isReady()) {
        this.moduleHealth.registrar('portal-red', 'ok');
      } else {
        this.moduleHealth.registrar(
          'portal-red', 'degraded',
          'GenieACS no configurado (GENIEACS_NBI_URL vacío): Mi WiFi y Dispositivos ' +
          'quedan no disponibles en el portal. El resto del portal funciona.',
        );
      }
    } catch (err) {
      // NUNCA relanzar en onModuleInit: crashearía el backend por una sección opcional
      // del portal, cuando facturas y perfil pueden seguir sirviéndose sin problema.
      this.moduleHealth.registrar(
        'portal-red', 'degraded',
        `No se pudo determinar el estado del plano TR-069: ${(err as Error).message}`,
      );
    }
  }

  // ── Estado del carril ───────────────────────────────────────
  async estado(
    clienteId: string,
    empresaId: string,
    contratoId: string,
  ): Promise<PortalOnuEstado> {
    const registro = await this.buscarRegistro(clienteId, empresaId, contratoId);

    if (!registro) {
      return {
        disponible: false,
        motivo: 'sin_onu',
        carril: 'desconectado',
        vivo: false,
        mensaje:
          'La gestión del WiFi solo está disponible en servicios de fibra con equipo administrado por nosotros.',
      };
    }

    if (!this.detalle.isReady()) {
      return {
        disponible: false,
        motivo: 'acs_degradado',
        carril: 'desconectado',
        vivo: false,
        mensaje: 'La gestión remota no está disponible en este momento. Inténtalo más tarde.',
      };
    }

    const carril = this.carrilVisible(registro.carril_estado);
    const vivo   = carril === 'conectado' ? await this.sesionViva(registro.sn) : false;

    return {
      disponible: true,
      motivo: null,
      carril,
      vivo,
      mensaje: this.mensajeCarril(carril, vivo),
    };
  }

  // ── Conectar el router (abrir el carril TR-069) ─────────────
  async conectar(
    clienteId: string,
    empresaId: string,
    contratoId: string,
  ): Promise<PortalOnuEstado> {
    const registro = await this.exigirRegistro(clienteId, empresaId, contratoId);

    // Abrir el carril abre una sesión SSH contra la OLT, y el MA5800 admite pocas VTY
    // concurrentes. Sin este freno, un abonado impaciente pulsando el botón —o muchos a
    // la vez— convierte el portal en un ataque de denegación contra la propia OLT.
    const clave = `portal_conectar:${contratoId}`;
    if (await this.cache.get(clave)) {
      throw new BadRequestException(
        `Ya estamos conectando con tu router. Espera unos minutos antes de volver a intentarlo.`,
      );
    }

    const resultado = await this.ftth.activarCarril(contratoId, empresaId);
    await this.cache.set(clave, 1, MINUTOS_ENTRE_CONEXIONES * 60_000);

    this.logger.log(
      `Portal: abonado ${clienteId} conectó router del contrato ${contratoId} (${registro.sn}) → ${resultado.estado}`,
    );

    const carril = this.carrilVisible(resultado.estado);
    return {
      disponible: true,
      motivo: null,
      carril,
      vivo: false,
      mensaje: this.mensajeCarril(carril, false),
    };
  }

  // Mantiene vivo el carril mientras el abonado tiene la sección abierta. El heartbeat
  // SUPRIME el barrido por inactividad, nunca autoriza nada por sí mismo.
  async heartbeat(clienteId: string, empresaId: string, contratoId: string): Promise<void> {
    await this.exigirRegistro(clienteId, empresaId, contratoId);
    await this.ftth.marcarUsoTr069(contratoId, empresaId);
  }

  // ── WiFi ────────────────────────────────────────────────────
  async wifi(
    clienteId: string,
    empresaId: string,
    contratoId: string,
    refrescar = false,
  ): Promise<PortalWifi> {
    const registro = await this.exigirRegistro(clienteId, empresaId, contratoId);
    this.exigirAcs();

    // Por defecto se sirve la ÚLTIMA lectura conocida, no se fuerza una nueva.
    //
    // Forzar el refresco al abrir parecía lo correcto —un formulario editable sobre datos
    // rancios sobrescribe lo que nadie está viendo— pero en la práctica hacía lo
    // contrario: cada lectura espera al CPE y superaba los 30 s del interceptor, así que
    // la sección terminaba en timeout y el abonado no veía NADA. Una pantalla vacía es
    // peor que un dato de hace tres minutos etiquetado con su hora.
    //
    // La garantía se mantiene por otra vía: `ultimaLectura` va siempre a la vista, y
    // editar exige que la sesión TR-069 esté VIVA (lastInform < 12 min), así que el dato
    // mostrado no puede ser viejo cuando los campos están habilitados. El refresco
    // explícito queda a un botón.
    const detalle = refrescar
      ? await this.detalle.refrescarWifi(registro.sn).catch(() => null)
      : await this.detalle.getDetalle(registro.sn).catch(() => null);

    if (!detalle?.informing) {
      throw new ServiceUnavailableException(
        'Tu router no está respondiendo. Verifica que esté encendido y vuelve a intentarlo.',
      );
    }

    const bandas: PortalBandaWifi[] = ['2.4', '5'].map((banda) => {
      const encontrada = detalle.wifi?.find((w) => w.band === banda);
      return {
        banda: banda as '2.4' | '5',
        ssid:  encontrada?.ssid ?? null,
        activa: encontrada?.enabled ?? null,
      };
    });

    const bloqueo = this.motivoNoEditable(registro, detalle.vivo === true);

    return {
      bandas,
      ultimaLectura:    detalle.lastInform ?? null,
      editable:         bloqueo === null,
      motivoNoEditable: bloqueo,
    };
  }

  async guardarWifi(
    clienteId: string,
    empresaId: string,
    contratoId: string,
    banda: '2.4' | '5',
    dto: { ssid?: string; password?: string },
  ): Promise<ResultadoWifi> {
    const registro = await this.exigirRegistro(clienteId, empresaId, contratoId);
    this.exigirAcs();

    const ssid     = dto.ssid?.trim();
    const password = dto.password;

    if (!ssid && !password) {
      throw new BadRequestException('No indicaste ningún cambio.');
    }
    if (ssid !== undefined && ssid !== '') this.validarSsid(ssid);
    if (password) this.validarPassword(password, ssid);

    const vivo = await this.sesionViva(registro.sn);
    const bloqueo = this.motivoNoEditable(registro, vivo);
    if (bloqueo) throw new ForbiddenException(bloqueo);

    // Se comprueba ANTES de escribir, pero solo se CONSUME si la escritura llegó a
    // despacharse: un intento que falla —ACS caído, modelo sin perfil— no puede gastarle
    // el cupo al abonado por algo que no es culpa suya.
    await this.verificarLimiteCambios(contratoId);

    // Con `await`: sin él, un fallo del write quedaba como rechazo no capturado y el
    // abonado veía "enviado" cuando no se había enviado nada.
    await this.detalle.setWifi(registro.sn, {
      band: banda,
      ssid: ssid || undefined,
      password: password || undefined,
    });

    await this.registrarCambio(contratoId);

    this.logger.log(
      `Portal: abonado ${clienteId} cambió WiFi ${banda}GHz del contrato ${contratoId} ` +
        `(ssid=${ssid ? 'sí' : 'no'}, clave=${password ? 'sí' : 'no'})`,
    );

    return this.verificarWifi(registro.sn, banda, ssid, Boolean(password));
  }

  // VIO: encolar el cambio solo confirma "aceptado". Se relee del equipo para confirmar
  // que se materializó — y se dice la verdad cuando no se puede confirmar.
  private async verificarWifi(
    sn: string,
    banda: '2.4' | '5',
    ssidEsperado: string | undefined,
    huboClave: boolean,
  ): Promise<ResultadoWifi> {
    // La clave WiFi es write-only en TR-069: el equipo nunca la devuelve. No hay forma
    // honesta de confirmarla releyendo, así que no se afirma que quedó guardada.
    if (!ssidEsperado) {
      return {
        clase: 'sin_confirmar',
        mensaje:
          'Enviamos la nueva contraseña a tu router. Conéctate con ella en unos minutos; ' +
          'si tus equipos siguen pidiendo la anterior, escríbenos.',
      };
    }

    // 4 lecturas separadas 1,5 s: ~6 s en total. Acotado a propósito — el interceptor
    // global corta la request a los 30 s, y el abonado no debe quedarse mirando un
    // spinner. Si no converge aquí, se le dice que no se confirmó, no que falló.
    for (let intento = 1; intento <= 4; intento++) {
      await new Promise((r) => setTimeout(r, 1500));
      const leido = await this.detalle.getDetalle(sn).catch(() => null);
      const actual = leido?.wifi?.find((w) => w.band === banda)?.ssid;
      if (actual === ssidEsperado) {
        return {
          clase: 'confirmado',
          mensaje: huboClave
            ? `Listo. Tu red ${banda} GHz ya se llama "${ssidEsperado}". Vuelve a conectar tus equipos con la nueva contraseña.`
            : `Listo. Tu red ${banda} GHz ya se llama "${ssidEsperado}".`,
        };
      }
    }

    return {
      clase: 'sin_confirmar',
      mensaje:
        'Enviamos el cambio a tu router, pero todavía no pudimos confirmarlo. ' +
        'Revisa en unos minutos; si tu red no cambió, escríbenos.',
    };
  }

  // ── Dispositivos conectados ─────────────────────────────────
  async dispositivos(
    clienteId: string,
    empresaId: string,
    contratoId: string,
  ): Promise<PortalDispositivo[]> {
    const registro = await this.exigirRegistro(clienteId, empresaId, contratoId);
    this.exigirAcs();

    const detalle = await this.detalle.getDetalle(registro.sn).catch(() => null);
    if (!detalle?.informing) {
      throw new ServiceUnavailableException(
        'Tu router no está respondiendo. Verifica que esté encendido y vuelve a intentarlo.',
      );
    }

    return (detalle.hosts ?? []).map((h: OnuHost) => ({
      nombre:   h.hostname?.trim() || 'Dispositivo sin nombre',
      ip:       h.ip,
      mac:      h.mac,
      conexion: h.conexion,
      activo:   h.active === true,
    }));
  }

  // ── Internos ────────────────────────────────────────────────
  private async buscarRegistro(
    clienteId: string,
    empresaId: string,
    contratoId: string,
  ): Promise<FilaRegistro | null> {
    // La pertenencia del contrato al abonado se valida en la MISMA consulta: separar
    // ambas cosas es cómo aparecen los IDOR.
    const [fila] = await this.dataSource.query<FilaRegistro[]>(
      `SELECT r.id AS registro_id, r.sn, r.estado::text AS estado,
              r.carril_estado::text AS carril_estado,
              c.estado::text AS contrato_estado
         FROM contratos c
         JOIN ftth_onu_registro r
           ON r.contrato_id = c.id AND r.empresa_id = c.empresa_id
        WHERE c.id = $1 AND c.cliente_id = $2 AND c.empresa_id = $3
          AND c.deleted_at IS NULL`,
      [contratoId, clienteId, empresaId],
    );
    return fila ?? null;
  }

  private async exigirRegistro(
    clienteId: string,
    empresaId: string,
    contratoId: string,
  ): Promise<FilaRegistro> {
    const registro = await this.buscarRegistro(clienteId, empresaId, contratoId);
    if (!registro) throw new NotFoundException('Este servicio no tiene equipo administrado.');
    return registro;
  }

  private exigirAcs(): void {
    if (!this.detalle.isReady()) {
      throw new ServiceUnavailableException(
        'La gestión remota no está disponible en este momento. Inténtalo más tarde.',
      );
    }
  }

  private async sesionViva(sn: string): Promise<boolean> {
    const detalle = await this.detalle.getDetalle(sn).catch(() => null);
    if (!detalle?.lastInform) return false;
    return Date.now() - new Date(detalle.lastInform).getTime() < VIVO_MS;
  }

  private carrilVisible(estado: string): CarrilVisible {
    switch (estado) {
      case 'activo':                return 'conectado';
      case 'activando':             return 'conectando';
      case 'activacion_fallida':    return 'error';
      default:                      return 'desconectado';
    }
  }

  private mensajeCarril(carril: CarrilVisible, vivo: boolean): string {
    if (carril === 'conectando') {
      return 'Estamos conectando con tu router. Puede tomar unos minutos.';
    }
    if (carril === 'error') {
      return 'No pudimos conectar con tu router. Vuelve a intentarlo o escríbenos.';
    }
    if (carril === 'conectado') {
      return vivo
        ? 'Tu router está conectado.'
        : 'Tu router está configurado pero no responde ahora. Verifica que esté encendido.';
    }
    return 'Conecta tu router para ver y cambiar tu WiFi.';
  }

  // Escribir sobre un servicio cortado es prometerle al abonado un cambio que su equipo
  // probablemente no puede aplicar. Leer sí se permite.
  private motivoNoEditable(registro: FilaRegistro, vivo: boolean): string | null {
    if (registro.contrato_estado === 'cortado' || registro.contrato_estado === 'suspendido') {
      return 'Tu servicio está suspendido. Regulariza tu pago para poder cambiar la configuración de tu WiFi.';
    }
    if (this.carrilVisible(registro.carril_estado) !== 'conectado') {
      return 'Conecta tu router para poder cambiar el nombre y la contraseña de tu WiFi.';
    }
    if (!vivo) {
      return 'Tu router no está respondiendo ahora. Verifica que esté encendido e inténtalo de nuevo.';
    }
    return null;
  }

  private validarSsid(ssid: string): void {
    if (ssid.length < 1 || ssid.length > 32) {
      throw new BadRequestException('El nombre de la red debe tener entre 1 y 32 caracteres.');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(ssid)) {
      throw new BadRequestException('El nombre de la red contiene caracteres no permitidos.');
    }
    if (/^[!#;+\]/"\t ]/.test(ssid)) {
      throw new BadRequestException('El nombre de la red no puede empezar con ese carácter.');
    }
  }

  private validarPassword(password: string, ssid?: string): void {
    // 8 caracteres es el mínimo de WPA2: por debajo, el equipo rechaza la clave.
    if (password.length < 8 || password.length > 63) {
      throw new BadRequestException('La contraseña debe tener entre 8 y 63 caracteres.');
    }
    const triviales = ['12345678', 'password', 'contrasena', 'contraseña', '00000000', 'qwertyui'];
    if (triviales.includes(password.toLowerCase())) {
      throw new BadRequestException('Esa contraseña es demasiado fácil de adivinar. Elige otra.');
    }
    if (ssid && password.toLowerCase() === ssid.toLowerCase()) {
      throw new BadRequestException('La contraseña no puede ser igual al nombre de la red.');
    }
  }

  private claveCambios(contratoId: string): string {
    return `portal_wifi_cambios:${contratoId}`;
  }

  private claveUltimoCambio(contratoId: string): string {
    return `portal_wifi_ultimo:${contratoId}`;
  }

  private async verificarLimiteCambios(contratoId: string): Promise<void> {
    // Espera entre escrituras: es lo que evita martillear el equipo. Se dice CUÁNTO
    // falta — "inténtalo más tarde" obliga a probar a ciegas.
    const ultimo = await this.cache.get<number>(this.claveUltimoCambio(contratoId));
    if (ultimo) {
      const restante = ESPERA_ENTRE_CAMBIOS_MS - (Date.now() - ultimo);
      if (restante > 0) {
        throw new BadRequestException(
          `Tu router está aplicando el cambio anterior. Espera ${Math.ceil(restante / 1000)} ` +
          'segundos e inténtalo de nuevo.',
        );
      }
    }

    const usados = (await this.cache.get<number>(this.claveCambios(contratoId))) ?? 0;
    if (usados >= MAX_CAMBIOS_WIFI_DIA) {
      throw new BadRequestException(
        'Hiciste muchos cambios de WiFi hoy. Inténtalo mañana o escríbenos si algo no quedó bien.',
      );
    }
  }

  /** Solo se llama cuando la escritura SÍ se despachó al equipo. */
  private async registrarCambio(contratoId: string): Promise<void> {
    const usados = (await this.cache.get<number>(this.claveCambios(contratoId))) ?? 0;
    await this.cache.set(this.claveCambios(contratoId), usados + 1, 24 * 60 * 60_000);
    await this.cache.set(this.claveUltimoCambio(contratoId), Date.now(), ESPERA_ENTRE_CAMBIOS_MS);
  }
}
