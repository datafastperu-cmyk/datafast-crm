import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';

import { decrypt } from '../../../../common/utils/encryption.util';
import { CpeWebCredential } from '../../entities/cpe-web-credential.entity';
import {
  BootstrapContext, ChannelResult, CpeProvisioningChannel, DeviceProfile,
} from './cpe-provisioning-channel.interface';

// ─────────────────────────────────────────────────────────────
// Canal EXPERIMENTAL — NO habilitado automáticamente (ver
// capability/cpe-provisioning-catalog.ts: habilitadoAuto=false para
// http_web en EG8145V5). Escribe la config TR-069 directamente en la
// interfaz de administración HTTP del CPE, sobre su IP de gestión
// (misma VLAN TR-069, no requiere LAN física del cliente).
//
// Origen: incidente CNT-2026-000004 — el OMCI no logró hacer converger la
// ME137 (TR069 Management Server) del ONT; se verificó manualmente que
// escribir el formulario "ACS Configuration" del propio equipo SÍ funciona.
//
// MECANISMO DE SESIÓN — confirmado en vivo el 2026-07-18 mediante captura
// HAR real + pruebas curl/PowerShell contra un equipo real (SN
// HWTC78CA0FAA, interfaz "ssmp/tr069", no la interfaz "net_wan_tr069_t.cgi"
// asumida en una implementación anterior de este mismo archivo — se
// descarta por completo, era una convención genérica sin validar):
//   1. POST /asp/GetRandCount.asp (sin body) → el cuerpo de la respuesta ES
//      el token, pero viene con un BOM UTF-8 al inicio que DEBE recortarse
//      (﻿) — si no se recorta, el login falla en silencio sin error
//      HTTP (confirmado: causó fallos repetidos hasta identificarlo).
//   2. POST /login.cgi con UserName, PassWord (base64 plano, NO hasheado),
//      Language=english, x.X_HW_Token=<token del paso 1>. Éxito se detecta
//      por el body: `var pageName = 'index.asp';` (fallo: `pageName = '/'`
//      o `<title>Failed</title>` — NUNCA por statusCode, siempre es 200).
//      La sesión se sostiene por cookie (`Set-Cookie: Cookie=sid=...`,
//      nombre de cookie literal "Cookie") — debe reenviarse en headers
//      posteriores.
//   3. GET /html/ssmp/tr069/tr069.asp (con la cookie) para leer el campo
//      oculto `id="onttoken"` — es un token de escritura FRESCO por cada
//      carga de página, DISTINTO del token de login. Se debe reenviar como
//      x.X_HW_Token en el POST de escritura (paso 4). Reusar el token de
//      login para el POST de escritura fue el segundo bug encontrado en
//      pruebas reales.
//   4. POST /html/ssmp/tr069/set.cgi?x=InternetGatewayDevice.ManagementServer
//      &RequestFile=html/ssmp/tr069/tr069.asp con los campos del formulario
//      "AcsConfigForm" (BindField exacto extraído del HTML real, no
//      adivinado): x.URL, x.Username, x.Password,
//      x.ConnectionRequestUsername, x.ConnectionRequestPassword,
//      x.X_HW_Token=<onttoken del paso 3>.
//   NOTA .NET/PowerShell: si se reimplementa este flujo con
//   HttpWebRequest/Invoke-WebRequest, hay que desactivar
//   Expect100Continue — el equipo ignora el body silenciosamente si recibe
//   ese header (no aplica a Node/axios, que no lo envía por defecto).
//
// ADVERTENCIA CRÍTICA — confirmado en vivo: el panel de este equipo se
// autobloquea tras 3 intentos de login FALLIDOS. Por eso:
//   1. Esta implementación hace UN SOLO intento de login por llamada —
//      nunca reintenta internamente. El reintento (si corresponde) lo
//      decide el circuit breaker del resolver (CpeProvisioningAttemptService),
//      con cooldown de 30 minutos entre intentos para este canal.
//   2. Los pasos 1-3 (obtención de sesión) están validados en vivo. El paso
//      4 (POST de escritura del ACS Configuration) usa nombres de campo
//      confirmados contra el HTML real del formulario, pero el submit en sí
//      (Apply) todavía NO se probó de punta a punta contra un equipo real
//      con verificación posterior de que el valor persiste — por eso
//      habilitadoAuto sigue en false hasta esa validación.
// ─────────────────────────────────────────────────────────────
@Injectable()
export class HuaweiHttpBootstrapChannel implements CpeProvisioningChannel {
  readonly nombre = 'cpe_local' as const;
  private readonly logger = new Logger(HuaweiHttpBootstrapChannel.name);

  private readonly TIMEOUT_MS = 8_000;

  constructor(
    private readonly http: HttpService,
    @InjectRepository(CpeWebCredential)
    private readonly credRepo: Repository<CpeWebCredential>,
  ) {}

  supports(device: DeviceProfile): boolean {
    return device.fabricante.toLowerCase() === 'huawei' && /^EG8145V5$/i.test(device.modelo);
  }

  async bootstrap(ctx: BootstrapContext): Promise<ChannelResult> {
    const cred = await this._resolverCredencial(ctx.oltId, ctx.device.fabricante, ctx.device.modelo);
    if (!cred) {
      return {
        exitoso: false,
        mensaje: 'No hay credenciales CPE-web configuradas para esta OLT/fabricante',
        error: 'cpe_web_credential_missing',
      };
    }

    // Confirmado en vivo (curl/PowerShell, 2026-07-18): el panel de este equipo
    // sirve HTTP plano en el puerto 80, sin TLS — https contra ese puerto falla
    // el handshake por completo.
    const base = `http://${ctx.device.mgmtIp}`;
    let password: string;
    try {
      password = decrypt(cred.passwordCifrada);
    } catch (err: any) {
      return { exitoso: false, mensaje: 'No se pudo descifrar la credencial CPE-web', error: err?.message };
    }

    try {
      // Paso 1: token de sesión fresco (un solo intento — sin reintentos internos).
      // El body viene con BOM UTF-8 al inicio — confirmado en vivo, hay que recortarlo
      // o el login falla en silencio sin error HTTP.
      const tokenRes = await firstValueFrom(this.http.post<string>(
        `${base}/asp/GetRandCount.asp`, undefined,
        {
          timeout: this.TIMEOUT_MS, responseType: 'text' as any,
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        },
      ));
      const token = String(tokenRes.data ?? '').replace(/^﻿/, '').trim();
      if (!token) {
        return { exitoso: false, mensaje: 'El CPE no devolvió token de sesión', error: 'no_token' };
      }

      // Paso 2: login (password en base64, NO hasheado — confirmado por inspección de safelogin.js)
      const passB64 = Buffer.from(password, 'utf8').toString('base64');
      const loginBody = new URLSearchParams({
        UserName: cred.usuario,
        PassWord: passB64,
        Language: 'english',
        'x.X_HW_Token': token,
      }).toString();

      const loginRes = await firstValueFrom(this.http.post<string>(
        `${base}/login.cgi`, loginBody,
        {
          timeout: this.TIMEOUT_MS, responseType: 'text' as any,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      ));

      // Éxito real: el body redirige a index.asp. NUNCA por statusCode (siempre 200)
      // ni solo por presencia de cookie — confirmado en vivo que ambas señales pueden
      // estar presentes sin que el login haya sido aceptado.
      const loginOk = /pageName\s*=\s*'index\.asp'/.test(String(loginRes.data ?? ''));
      const setCookie = loginRes.headers['set-cookie'];
      if (!loginOk || !setCookie || setCookie.length === 0) {
        return {
          exitoso: false,
          mensaje: 'El CPE no confirmó el login (redirect a login, no a index.asp) — posible credencial incorrecta',
          error: 'login_not_confirmed',
        };
      }
      const sessionCookie = setCookie.map((c) => c.split(';')[0]).join('; ');

      // Paso 3: la página del formulario ACS entrega un token de escritura FRESCO
      // (campo oculto onttoken), DISTINTO del token de login — reusar el de login
      // aquí causó fallos confirmados en pruebas reales.
      const formRes = await firstValueFrom(this.http.get<string>(
        `${base}/html/ssmp/tr069/tr069.asp`,
        {
          timeout: this.TIMEOUT_MS, responseType: 'text' as any,
          headers: { Cookie: sessionCookie },
        },
      ));
      const writeTokenMatch = /id="onttoken"[\s\S]{0,80}?value="([0-9a-f]+)"/i.exec(String(formRes.data ?? ''));
      const writeToken = writeTokenMatch?.[1];
      if (!writeToken) {
        return { exitoso: false, mensaje: 'No se pudo extraer el token de escritura (onttoken) del formulario ACS', error: 'no_write_token' };
      }

      // Paso 4: escribir ACS Configuration. Endpoint y nombres de campo (BindField)
      // extraídos del HTML real del formulario "AcsConfigForm" (no adivinados).
      const acsBody = new URLSearchParams({
        'x.URL':                        ctx.acsUrl,
        'x.Username':                   ctx.acsUsername,
        'x.Password':                   ctx.acsPassword,
        'x.ConnectionRequestUsername':  ctx.connReqUsername ?? '',
        'x.ConnectionRequestPassword':  ctx.connReqPassword ?? '',
        'x.X_HW_Token':                 writeToken,
      }).toString();

      const applyRes = await firstValueFrom(this.http.post(
        `${base}/html/ssmp/tr069/set.cgi?x=InternetGatewayDevice.ManagementServer&RequestFile=html/ssmp/tr069/tr069.asp`,
        acsBody,
        {
          timeout: this.TIMEOUT_MS,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sessionCookie },
        },
      ));

      if (applyRes.status >= 400) {
        return { exitoso: false, mensaje: `El CPE rechazó la config ACS (HTTP ${applyRes.status})`, error: `http_${applyRes.status}` };
      }

      return { exitoso: true, mensaje: 'Config ACS enviada por HTTP al CPE (pendiente de verificación real vía GenieACS)' };
    } catch (err: any) {
      const esFalloRed = err?.code === 'ECONNABORTED' || err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT';
      this.logger.warn(
        `Canal http_web falló | registro=${ctx.ftthRegistroId} mgmtIp=${ctx.device.mgmtIp}: ${err?.message}`,
      );
      return {
        exitoso: false,
        mensaje: esFalloRed ? 'CPE no alcanzable por HTTP' : 'Error inesperado en canal http_web',
        error: err?.message ?? String(err),
      };
    }
  }

  private async _resolverCredencial(
    oltId: string, fabricante: string, modelo: string,
  ): Promise<CpeWebCredential | null> {
    const candidatas = await this.credRepo.find({ where: { oltId, fabricante, activo: true } });
    if (candidatas.length === 0) return null;
    // Prioriza la credencial con modeloPattern específico sobre la genérica (null)
    const especifica = candidatas.find((c) => c.modeloPattern && new RegExp(c.modeloPattern, 'i').test(modelo));
    return especifica ?? candidatas.find((c) => !c.modeloPattern) ?? candidatas[0];
  }
}
