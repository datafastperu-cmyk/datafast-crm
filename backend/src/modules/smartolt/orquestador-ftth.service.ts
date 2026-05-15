import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource }   from '@nestjs/typeorm';
import { DataSource }         from 'typeorm';
import { EventEmitter2 as EventEmitter } from '@nestjs/event-emitter';

import { SmartoltService }    from './smartolt.service';
import { SmartoltApiService } from './smartolt-api.service';
import { MikrotikService }    from '../mikrotik/mikrotik.service';
import { PppoeService }       from '../mikrotik/services/pppoe.service';
import { VelocidadOrquestador } from '../mikrotik/services/velocidad/velocidad-orquestador.service';
import { FirewallService }    from '../mikrotik/services/firewall.service';
import { AuditoriaService }   from '../auth/auditoria.service';
import { JwtPayload }         from '../../common/decorators/current-user.decorator';
import { EstadoOnu }          from './entities/onu.entity';
import { encrypt, decrypt }   from '../../common/utils/encryption.util';

import {
  FlujoComipletoFtthDto,
  FlujoComipletoResultadoDto,
} from './dto/smartolt.dto';

// ─── Paso del flujo ───────────────────────────────────────────
interface Paso {
  paso:    number;
  nombre:  string;
  fn:      () => Promise<string>;
}

// ─────────────────────────────────────────────────────────────
// OrquestadorFtth — Ejecuta los 8 pasos del aprovisionamiento
//
// PASO 1: Validar contrato, cliente y plan
// PASO 2: Asignar IP del pool (si no tiene)
// PASO 3: Obtener/detectar ONU en SmartOLT
// PASO 4: Aprovisionar ONU en SmartOLT (SN+PON+perfil+VLAN)
// PASO 5: Registrar ONU en BD y asociar al contrato
// PASO 6: Crear usuario PPPoE en Mikrotik
// PASO 7: Aplicar control de velocidad (Queue)
// PASO 8: Activar contrato y notificar al cliente
// ─────────────────────────────────────────────────────────────
@Injectable()
export class OrquestadorFtthService {
  private readonly logger = new Logger(OrquestadorFtthService.name);

  constructor(
    private readonly smartoltSvc:  SmartoltService,
    private readonly smartoltApi:  SmartoltApiService,
    private readonly mikrotikSvc:  MikrotikService,
    private readonly pppoeSvc:     PppoeService,
    private readonly velocidadOrc: VelocidadOrquestador,
    private readonly firewallSvc:  FirewallService,
    private readonly auditoria:    AuditoriaService,
    private readonly events:       EventEmitter,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────
  // FLUJO COMPLETO FTTH
  // ────────────────────────────────────────────────────────────
  async ejecutarFlujoComipletoFtth(
    dto:  FlujoComipletoFtthDto,
    user: JwtPayload,
  ): Promise<FlujoComipletoResultadoDto> {

    const resultado: FlujoComipletoResultadoDto = {
      pasos:        [],
      exitoso:      false,
      mensajeFinal: '',
    };

    // Estado compartido entre pasos
    const ctx: {
      contrato?:     any;
      cliente?:      any;
      plan?:         any;
      router?:       any;
      olt?:          any;
      ipAsignada?:   string;
      usuarioPppoe?: string;
      passwordPppoe?: string;
      onuId?:        string;
      serialNumber?: string;
    } = {};

    // ─── Definición de los 8 pasos ────────────────────────────
    const pasos: Paso[] = [

      // ── PASO 1: Validar datos ─────────────────────────────
      {
        paso:   1,
        nombre: 'Validar contrato, cliente y plan',
        fn: async () => {
          const [row] = await this.ds.query(`
            SELECT
              co.id, co.numero_contrato, co.estado,
              co.usuario_pppoe, co.password_pppoe, co.ip_asignada,
              co.aprovisionado,
              cl.nombre_completo AS cliente_nombre, cl.telefono, cl.email,
              pl.nombre AS plan_nombre, pl.velocidad_bajada, pl.velocidad_subida,
              pl.tipo_queue, pl.ppp_profile, pl.tipo AS tipo_plan,
              pl.burst_bajada, pl.burst_subida, pl.burst_tiempo,
              ro.id AS router_id, ro.ip_gestion AS router_ip,
              ro.version_ros, ro.usuario AS router_user,
              ro.password_cifrado AS router_pass, ro.usar_ssl,
              ro.puerto_api, ro.puerto_api_ssl, ro.timeout_conexion
            FROM contratos co
            JOIN clientes cl ON cl.id = co.cliente_id
            JOIN planes   pl ON pl.id = co.plan_id
            JOIN routers  ro ON ro.id = $2
            WHERE co.id = $1 AND co.empresa_id = $3 AND co.deleted_at IS NULL
          `, [dto.contratoId, dto.routerId, user.empresaId]);

          if (!row) throw new Error('Contrato o router no encontrado');

          if (row.aprovisionado) {
            throw new Error(`El contrato ${row.numero_contrato} ya está aprovisionado`);
          }
          if (!['pendiente_instalacion', 'activo'].includes(row.estado)) {
            throw new Error(`Estado del contrato no permite aprovisionamiento: ${row.estado}`);
          }

          ctx.contrato     = row;
          ctx.usuarioPppoe = row.usuario_pppoe;
          ctx.passwordPppoe = row.password_pppoe;
          ctx.ipAsignada   = row.ip_asignada;

          return `Contrato ${row.numero_contrato} | Cliente: ${row.cliente_nombre} | Plan: ${row.plan_nombre}`;
        },
      },

      // ── PASO 2: Asignar IP si no tiene ───────────────────
      {
        paso:   2,
        nombre: 'Verificar/asignar IP del pool',
        fn: async () => {
          if (ctx.ipAsignada) {
            return `IP ya asignada: ${ctx.ipAsignada}`;
          }

          if (!dto.segmentoId) {
            return 'Sin segmento configurado — IP se asignará manualmente';
          }

          // Obtener próxima IP del segmento
          const [segmento] = await this.ds.query(
            'SELECT red_cidr, gateway, ips_reservadas FROM segmentos_ipv4 WHERE id = $1 AND empresa_id = $2',
            [dto.segmentoId, user.empresaId],
          );

          if (!segmento) throw new Error('Segmento IPv4 no encontrado');

          // Usar la función SQL de la BD para obtener la próxima IP
          const [{ fn_next_available_ip: ip }] = await this.ds.query(
            'SELECT fn_next_available_ip($1, $2)',
            [dto.segmentoId, segmento.ips_reservadas || '{}'],
          ).catch(() => [{ fn_next_available_ip: null }]);

          if (!ip) throw new Error('Pool IPv4 exhausto — sin IPs disponibles');

          // Registrar en BD
          await this.ds.query(`
            INSERT INTO ips_asignadas (empresa_id, segmento_id, contrato_id, ip_address, tipo, activa)
            VALUES ($1, $2, $3, $4, 'cliente', true)
            ON CONFLICT DO NOTHING
          `, [user.empresaId, dto.segmentoId, dto.contratoId, ip]);

          await this.ds.query(
            'UPDATE contratos SET ip_asignada = $1 WHERE id = $2',
            [ip, dto.contratoId],
          );

          ctx.ipAsignada = ip;
          return `IP asignada del pool: ${ip}`;
        },
      },

      // ── PASO 3: Detectar ONU en SmartOLT ─────────────────
      {
        paso:   3,
        nombre: 'Detectar ONU no aprovisionada',
        fn: async () => {
          ctx.serialNumber = dto.serialNumber;

          if (ctx.serialNumber) {
            return `SN proporcionado: ${ctx.serialNumber}`;
          }

          // Detectar automáticamente en el puerto PON
          const olt = await this.smartoltSvc.findOneOlt(dto.oltId, user.empresaId);
          if (!olt.smartoltId) throw new Error('El OLT no tiene SmartOLT ID configurado');

          const onuDetectada = await this.smartoltApi.detectarOnuEnPuerto(
            olt.smartoltId, dto.ponPort,
          );

          if (!onuDetectada) {
            throw new Error(
              `No se encontró ONU no aprovisionada en el puerto ${dto.ponPort}. ` +
              `Verifica que la ONU esté conectada.`,
            );
          }

          ctx.serialNumber = onuDetectada.serial;
          return `ONU detectada: SN=${onuDetectada.serial} | PON=${dto.ponPort} | Tipo=${onuDetectada.pon_type}`;
        },
      },

      // ── PASO 4: Aprovisionar ONU en SmartOLT ─────────────
      {
        paso:   4,
        nombre: 'Aprovisionar ONU en SmartOLT',
        fn: async () => {
          const onu = await this.smartoltSvc.aprovisionarOnu({
            oltId:       dto.oltId,
            serialNumber: ctx.serialNumber!,
            ponPort:     dto.ponPort,
            perfil:      dto.perfil,
            vlanId:      dto.vlanId,
            descripcion: `${ctx.contrato.cliente_nombre} — ${ctx.contrato.numero_contrato}`,
            contratoId:  dto.contratoId,
          }, user);

          ctx.onuId = onu.id;
          return `ONU aprovisionada: ID=${onu.id} | SN=${ctx.serialNumber} | VLAN=${dto.vlanId}`;
        },
      },

      // ── PASO 5: Registrar ONU y asociar al contrato ───────
      {
        paso:   5,
        nombre: 'Registrar ONU y asociar al contrato',
        fn: async () => {
          if (!ctx.onuId) throw new Error('No hay ONU ID para asociar');

          await this.smartoltSvc.asociarAContrato(
            { contratoId: dto.contratoId, onuId: ctx.onuId },
            user,
          );

          return `ONU ${ctx.onuId} asociada al contrato ${dto.contratoId}`;
        },
      },

      // ── PASO 6: Configurar PPPoE en Mikrotik ─────────────
      {
        paso:   6,
        nombre: 'Configurar PPPoE en Mikrotik',
        fn: async () => {
          if (!ctx.contrato.router_id) throw new Error('Contrato sin router asignado');
          if (!ctx.usuarioPppoe)       throw new Error('Contrato sin usuario PPPoE');

          const router = ctx.contrato;
          let password = '';
          try { password = decrypt(ctx.passwordPppoe || ''); }
          catch { password = ctx.passwordPppoe || ''; }

          const creds = {
            id:              router.router_id,
            ip:              router.router_ip,
            port:            router.usar_ssl ? router.puerto_api_ssl : router.puerto_api,
            user:            router.router_user,
            passwordCifrado: router.router_pass,
            useSsl:          router.usar_ssl || false,
            timeoutSec:      router.timeout_conexion || 10,
            version:         router.version_ros === 'v7' ? 'v7' : 'v6',
          };

          await this.pppoeSvc.crear(creds, {
            name:          ctx.usuarioPppoe,
            password,
            profile:       router.ppp_profile || 'default',
            remoteAddress: ctx.ipAsignada,
            comment:       `FibraNet:${dto.contratoId}`,
          });

          return `PPPoE creado: ${ctx.usuarioPppoe} | IP remota: ${ctx.ipAsignada}`;
        },
      },

      // ── PASO 7: Aplicar control de velocidad ──────────────
      {
        paso:   7,
        nombre: 'Aplicar control de velocidad (Queue)',
        fn: async () => {
          const c = ctx.contrato;
          const creds = {
            id:              c.router_id,
            ip:              c.router_ip,
            port:            c.usar_ssl ? c.puerto_api_ssl : c.puerto_api,
            user:            c.router_user,
            passwordCifrado: c.router_pass,
            useSsl:          c.usar_ssl || false,
            timeoutSec:      c.timeout_conexion || 10,
            version:         c.version_ros === 'v7' ? 'v7' : 'v6',
          };

          const res = await this.velocidadOrc.aplicarVelocidad({
            routerCreds:   creds,
            clienteId:     dto.clienteId,
            usuarioPppoe:  ctx.usuarioPppoe!,
            ipAsignada:    ctx.ipAsignada!,
            downloadMbps:  c.velocidad_bajada,
            uploadMbps:    c.velocidad_subida,
            burstDownMbps: c.burst_bajada,
            burstUpMbps:   c.burst_subida,
            burstTiempoSeg: c.burst_tiempo,
            tipoQueuePlan: c.tipo_queue || 'simple_queue',
            tipoPlan:      c.tipo_plan  || 'residencial',
          });

          return `Queue aplicada: ${res.estrategia} | ${c.velocidad_bajada}/${c.velocidad_subida} Mbps | ${res.detalle}`;
        },
      },

      // ── PASO 8: Activar contrato y notificar ──────────────
      {
        paso:   8,
        nombre: 'Activar contrato y notificar al cliente',
        fn: async () => {
          // Activar el contrato
          await this.ds.query(`
            UPDATE contratos
            SET estado = 'activo',
                fecha_estado = NOW(),
                fecha_instalacion = NOW(),
                motivo_estado = 'Aprovisionamiento FTTH completado'
            WHERE id = $1
          `, [dto.contratoId]);

          // Insertar historial
          await this.ds.query(`
            INSERT INTO contratos_historial
              (contrato_id, empresa_id, estado_anterior, estado_nuevo, motivo, usuario_id, automatico)
            VALUES ($1, $2, 'pendiente_instalacion', 'activo',
                   'Aprovisionamiento FTTH completado', $3, false)
          `, [dto.contratoId, user.empresaId, user.sub]);

          // Emitir evento para notificaciones (el módulo de notificaciones lo escuchará)
          if (dto.notificarCliente !== false) {
            this.events.emit('ftth.cliente.activado', {
              clienteId:    dto.clienteId,
              contratoId:   dto.contratoId,
              empresaId:    user.empresaId,
              usuarioPppoe: ctx.usuarioPppoe,
              ipAsignada:   ctx.ipAsignada,
              planNombre:   ctx.contrato.plan_nombre,
              clienteNombre: ctx.contrato.cliente_nombre,
              clienteTelefono: ctx.contrato.telefono,
              clienteEmail:  ctx.contrato.email,
            });
          }

          resultado.ipAsignada   = ctx.ipAsignada;
          resultado.usuarioPppoe = ctx.usuarioPppoe;
          resultado.onuId        = ctx.onuId;

          return `Contrato activado | IP: ${ctx.ipAsignada} | Usuario: ${ctx.usuarioPppoe} | Notificación: ${dto.notificarCliente !== false ? 'enviada' : 'omitida'}`;
        },
      },
    ];

    // ─── Ejecutar pasos en secuencia ──────────────────────────
    this.logger.log(
      `Iniciando flujo FTTH: contrato=${dto.contratoId} | ` +
      `OLT=${dto.oltId} | PON=${dto.ponPort} | por: ${user.email}`,
    );

    let ultimoPasoExitoso = 0;

    for (const paso of pasos) {
      const inicio = Date.now();
      try {
        const detalle = await paso.fn();
        const dur     = Date.now() - inicio;

        resultado.pasos.push({
          paso:       paso.paso,
          nombre:     paso.nombre,
          estado:     'ok',
          detalle,
          duracionMs: dur,
        });

        ultimoPasoExitoso = paso.paso;
        this.logger.log(`✓ Paso ${paso.paso} [${dur}ms]: ${detalle}`);

      } catch (error) {
        const dur = Date.now() - inicio;

        resultado.pasos.push({
          paso:       paso.paso,
          nombre:     paso.nombre,
          estado:     'error',
          detalle:    error.message,
          duracionMs: dur,
        });

        this.logger.error(`✗ Paso ${paso.paso} [${dur}ms]: ${error.message}`);

        // Marcar pasos restantes como omitidos
        for (const restante of pasos.slice(paso.paso)) {
          resultado.pasos.push({
            paso:    restante.paso,
            nombre:  restante.nombre,
            estado:  'omitido',
            detalle: `Omitido por fallo en paso ${paso.paso}`,
          });
        }

        resultado.exitoso     = false;
        resultado.mensajeFinal = `Flujo FTTH interrumpido en paso ${paso.paso}: ${error.message}`;

        // Auditar el fallo
        await this.auditoria.log({
          empresaId:    user.empresaId,
          usuarioId:    user.sub,
          usuarioEmail: user.email,
          accion:       'FTTH_FAILED',
          modulo:       'smartolt',
          entidadId:    dto.contratoId,
          descripcion:  `Fallo en paso ${paso.paso}: ${error.message}`,
        });

        return resultado;
      }
    }

    // ─── Todo exitoso ─────────────────────────────────────────
    resultado.exitoso     = true;
    resultado.mensajeFinal = `✅ Aprovisionamiento FTTH completado en ${ultimoPasoExitoso} pasos`;

    const duracionTotal = resultado.pasos.reduce((acc, p) => acc + (p.duracionMs || 0), 0);
    this.logger.log(
      `Flujo FTTH completado: contrato ${dto.contratoId} | ` +
      `${duracionTotal}ms total | IP: ${ctx.ipAsignada}`,
    );

    await this.auditoria.log({
      empresaId:    user.empresaId,
      usuarioId:    user.sub,
      usuarioEmail: user.email,
      accion:       'FTTH_PROVISIONED',
      modulo:       'smartolt',
      entidadId:    dto.contratoId,
      descripcion:  `Aprovisionamiento FTTH completado: ${ctx.usuarioPppoe} | IP: ${ctx.ipAsignada}`,
    });

    return resultado;
  }
}
