import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleHealthService } from '../../../../common/services/module-health.service';
import { Tr069GenieacsClient } from '../../../tr069/tr069-genieacs.client';
import { GenieAcsDriver } from '../../ztp/genieacs.driver';
import { CpeProvisioningAttemptService } from './cpe-provisioning-attempt.service';
import { HuaweiOmciBootstrapChannel } from './huawei-omci-bootstrap-channel.service';
import { HuaweiDhcpBootstrapChannel } from './huawei-dhcp-bootstrap-channel.service';
import { HuaweiHttpBootstrapChannel } from './huawei-http-bootstrap-channel.service';
import { BootstrapContext, CpeProvisioningChannel } from './cpe-provisioning-channel.interface';
import { evaluarCanalesDisponibles, NombreCanal } from '../../capability/cpe-provisioning-catalog';

export interface ResolverResult {
  exitoso:      boolean;
  mensaje:      string;
  canalUsado?:  NombreCanal;
  convergido:   boolean;   // true = verificado contra GenieACS (lastInform avanzó)
  intentos:     Array<{ canal: NombreCanal; exitoso: boolean; mensaje: string }>;
}

// ─────────────────────────────────────────────────────────────
// ProvisioningStrategyResolver — DISP: el ERP expresa la intención
// ("este ONT debe informar a nuestro ACS"), el resolver decide POR QUÉ
// CANAL materializarla, según la capacidad real del dispositivo — nunca
// un `if` embebido en el servicio de aprovisionamiento.
//
// Flujo:
//   1. Catálogo de capacidad → lista de canales candidatos (certificados
//      primero), o rechazo explícito si el modelo no está catalogado.
//   2. Para cada candidato: circuit breaker → intento → verificación REAL
//      contra GenieACS (nunca se confía en el "success" del canal mismo).
//   3. Primer canal que converge = fin. Ninguno converge = se reporta
//      "requiere intervención manual", nunca un éxito falso.
//
// Peor escenario cubierto:
// - GenieACS no configurado/caído → módulo se marca degraded, resolver
//   igual intenta el bootstrap (el ONT puede converger más tarde) pero
//   sin poder confirmar — reporta "aceptado sin confirmar", no "éxito".
// - Todos los canales agotados/en cooldown → retorna de inmediato sin
//   tocar nada, listo para el próximo intento cuando el cooldown expire.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class ProvisioningStrategyResolver implements OnModuleInit {
  private readonly logger = new Logger(ProvisioningStrategyResolver.name);
  private channelsByName: Map<NombreCanal, CpeProvisioningChannel>;

  // Ventana de gracia esperando un Inform que confirme el carril.
  //
  // DEBE SUPERAR el PeriodicInformInterval del CPE (300 s en nuestros presets). Con 3 min
  // un carril perfectamente funcional daba FALSO NEGATIVO: si el CPE acababa de informar,
  // el siguiente Inform llegaba a los 5 min, fuera de la ventana → el ERP declaraba
  // "requiere intervención manual", liberaba el pool de gestión y dejaba el registro sin
  // `mgmt_service_port_id`, mientras la ONU estaba gestionada de verdad
  // (observado 2026-07-22, ONT 1/8/44).
  private readonly VENTANA_VERIFICACION_MS = 6 * 60_000; // 6 min > 300 s de PeriodicInform
  private readonly POLL_INTERVAL_MS        = 10_000;

  constructor(
    private readonly moduleHealth:   ModuleHealthService,
    private readonly genieacs:       Tr069GenieacsClient,
    private readonly genieDriver:    GenieAcsDriver,
    private readonly attemptService: CpeProvisioningAttemptService,
    private readonly omciChannel:    HuaweiOmciBootstrapChannel,
    private readonly dhcpChannel:    HuaweiDhcpBootstrapChannel,
    private readonly httpChannel:    HuaweiHttpBootstrapChannel,
  ) {
    this.channelsByName = new Map<NombreCanal, CpeProvisioningChannel>([
      [this.dhcpChannel.nombre, this.dhcpChannel],
      [this.omciChannel.nombre, this.omciChannel],
      [this.httpChannel.nombre, this.httpChannel],
    ]);
  }

  onModuleInit(): void {
    if (this.genieacs.isConfigured()) {
      this.moduleHealth.registrar('cpe-provisioning-resolver', 'ok');
    } else {
      this.moduleHealth.registrar(
        'cpe-provisioning-resolver', 'degraded',
        'GenieACS NBI no configurado — el resolver puede intentar el bootstrap pero no puede verificar convergencia real.',
      );
    }
  }

  async ejecutarBootstrap(ctx: BootstrapContext): Promise<ResolverResult> {
    const evaluacion = evaluarCanalesDisponibles(
      ctx.device.fabricante, ctx.device.modelo, ctx.device.firmware,
    );

    if (!evaluacion.soportado) {
      this.logger.warn(`CPE_MODEL_NOT_SUPPORTED | registro=${ctx.ftthRegistroId}: ${evaluacion.motivo}`);
      return {
        exitoso: false, convergido: false, intentos: [],
        mensaje: `Modelo no soportado por el catálogo de aprovisionamiento CPE: ${evaluacion.motivo}`,
      };
    }
    if (evaluacion.candidatos.length === 0) {
      return {
        exitoso: false, convergido: false, intentos: [],
        mensaje: 'No hay canales certificados y habilitados para este dispositivo — requiere intervención manual o habilitar un canal experimental explícitamente.',
      };
    }

    const intentos: ResolverResult['intentos'] = [];

    for (const candidato of evaluacion.candidatos) {
      const canal = this.channelsByName.get(candidato.canal);
      if (!canal || !canal.supports(ctx.device)) continue;

      const permiso = await this.attemptService.canAttempt(ctx.empresaId, ctx.ftthRegistroId, candidato.canal);
      if (!permiso.permitido) {
        intentos.push({ canal: candidato.canal, exitoso: false, mensaje: permiso.motivo ?? 'Circuito abierto' });
        this.logger.log(`Canal ${candidato.canal} omitido (circuit breaker) | registro=${ctx.ftthRegistroId}: ${permiso.motivo}`);
        continue;
      }

      this.logger.log(`Intentando canal ${candidato.canal} | registro=${ctx.ftthRegistroId}`);

      // Referencia de convergencia tomada ANTES de aplicar el carril. Es la clave del fix:
      // el CPE puede informar MIENTRAS corre el bootstrap (dura ~30 s), y ese Inform es
      // prueba válida de que el carril quedó vivo. Tomando la referencia después, ese
      // Inform quedaba "ya contado" y había que esperar al siguiente ciclo periódico
      // (300 s) — que caía fuera de la ventana → falso negativo con carril funcionando.
      const refInform = await this._lastInformSeguro(ctx.device.sn);

      const resultado = await canal.bootstrap(ctx);

      if (!resultado.exitoso) {
        await this.attemptService.recordFailure(
          ctx.empresaId, ctx.ftthRegistroId, candidato.canal,
          this._clasificarError(resultado.error), resultado.error,
        );
        intentos.push({ canal: candidato.canal, exitoso: false, mensaje: resultado.mensaje });
        continue;
      }

      // El canal no reportó error — ahora se verifica de verdad contra GenieACS.
      const convergio = await this.confirmarConvergencia(ctx.device, refInform);
      if (convergio) {
        await this.attemptService.recordSuccess(ctx.empresaId, ctx.ftthRegistroId, candidato.canal);
        intentos.push({ canal: candidato.canal, exitoso: true, mensaje: 'Convergió — Inform recibido en GenieACS' });
        return {
          exitoso: true, convergido: true, canalUsado: candidato.canal, intentos,
          mensaje: `TR-069 aplicado y confirmado vía canal "${candidato.canal}".`,
        };
      }

      // Aceptado por el canal pero sin confirmación real — VIO: no es éxito.
      await this.attemptService.recordFailure(
        ctx.empresaId, ctx.ftthRegistroId, candidato.canal, 'fallido_red',
        'Canal aceptó el bootstrap pero no se confirmó Inform en la ventana de verificación',
      );
      intentos.push({
        canal: candidato.canal, exitoso: false,
        mensaje: 'Aceptado por el canal pero sin confirmación de Inform dentro de la ventana de verificación',
      });
    }

    return {
      exitoso: false, convergido: false, intentos,
      mensaje: 'Ningún canal disponible logró que el CPE convergiera con el ACS — requiere intervención manual.',
    };
  }

  private _clasificarError(error?: string): 'fallido_red' | 'fallido_auth' | 'fallido_no_soportado' {
    if (!error) return 'fallido_red';
    if (/credential|auth|login_not_confirmed|password/i.test(error)) return 'fallido_auth';
    if (/not_supported|missing/i.test(error)) return 'fallido_no_soportado';
    return 'fallido_red';
  }

  // Verifica materialización REAL contra GenieACS: espera hasta VENTANA_VERIFICACION_MS a que
  // el `lastInform` del dispositivo AVANCE (o aparezca por primera vez). Público para que el
  // carril de gestión pueda confirmar convergencia también en su ruta de fallo del canal (VIO:
  // un "% Unknown command" tras un conflicto transitorio no significa que el carril no se haya
  // materializado — el DHCP+Inform es asíncrono; la verdad observable manda sobre el eco CLI).
  async confirmarConvergencia(
    device: { fabricante: string; modelo: string; sn: string },
    // Referencia tomada ANTES de aplicar el carril. Si se omite se lee ahora, que es el
    // comportamiento antiguo y solo sirve para llamadas sueltas (p.ej. el watcher de drift).
    referencia?: Date | null,
  ): Promise<boolean> {
    if (!this.genieacs.isConfigured()) return false; // no se puede verificar — nunca se asume éxito
    const deadline = Date.now() + this.VENTANA_VERIFICACION_MS;
    const antes = referencia !== undefined ? referencia : await this._lastInformSeguro(device.sn);

    // Atajo: si el CPE ya informó DESPUÉS de la referencia, el carril está confirmado y no
    // hay nada que esperar. Evita quemar la ventana entera cuando la prueba ya existe.
    const yaInformo = await this._lastInformSeguro(device.sn);
    if (yaInformo && (!antes || yaInformo.getTime() > antes.getTime())) return true;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.POLL_INTERVAL_MS));
      const actual = await this._lastInformSeguro(device.sn);
      if (actual && (!antes || actual.getTime() > antes.getTime())) return true;
    }
    return false;
  }

  /**
   * `_lastInform` del CPE, resuelto POR SERIAL (no por `_id` fabricado).
   *
   * CAUSA RAÍZ 2026-07-22: el ERP guarda el SN legible (`HWTC78CA0FAA`) y GenieACS registra
   * el device con el serial HEX completo (`4857544378CA0FAA`). El `_id` construido a mano
   * (`OUI-Modelo-SN`) nunca coincidía → `getDevice` null → `lastInform` null → la
   * convergencia del carril NUNCA podía confirmarse, con cualquier ventana. El ERP declaraba
   * "requiere intervención manual" y liberaba el pool de gestión mientras la ONU estaba
   * perfectamente gestionada. El driver ya sabe probar ambas variantes: se usa eso.
   */
  private async _lastInformSeguro(serial: string): Promise<Date | null> {
    try {
      return await this.genieDriver.getLastInformBySerial(serial);
    } catch {
      return null;
    }
  }

  // Huawei-only por ahora (OUI 00259E confirmado en esta plataforma). Si se
  // agregan fabricantes al catálogo, este helper debe moverse a un mapa
  // fabricante→OUI o resolverse consultando GenieACS por SN en vez de armar
  // el _id a mano.
  private _buildGenieAcsDeviceId(device: { fabricante: string; modelo: string; sn: string }): string {
    return `00259E-${device.modelo}-${device.sn}`;
  }
}
