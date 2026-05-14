import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource }   from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository }   from '@nestjs/typeorm';
import { EventEmitter }      from '@nestjs/event-emitter';

import {
  Alerta, ConfiguracionAlerta,
  NivelAlerta, EstadoAlerta, MetricaAlerta,
  Nodo, EstadoNodo,
} from '../entities/monitoreo.entity';
import { WhatsAppService } from '../../notificaciones/services/whatsapp.service';

export const EVENTO_ALERTA_NUEVA     = 'monitoreo.alerta.nueva';
export const EVENTO_ALERTA_RESUELTA  = 'monitoreo.alerta.resuelta';
export const EVENTO_NODO_OFFLINE     = 'monitoreo.nodo.offline';
export const EVENTO_NODO_ONLINE      = 'monitoreo.nodo.online';

// ─── Datos de una nueva medición para evaluar umbrales ────────
export interface MedicionParaEvaluar {
  nodoId:        string;
  empresaId:     string;
  nodoNombre:    string;
  metrica:       MetricaAlerta;
  valorActual:   number;
  unidad?:       string;
}

@Injectable()
export class AlertasService {
  private readonly logger = new Logger(AlertasService.name);

  constructor(
    @InjectRepository(Alerta)
    private readonly alertaRepo: Repository<Alerta>,

    @InjectRepository(ConfiguracionAlerta)
    private readonly configRepo: Repository<ConfiguracionAlerta>,

    @InjectRepository(Nodo)
    private readonly nodoRepo: Repository<Nodo>,

    private readonly whatsapp: WhatsAppService,
    private readonly events:   EventEmitter,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────
  // EVALUAR MEDICIÓN CONTRA UMBRALES
  // Llamado por el worker de monitoreo después de cada medición.
  // ────────────────────────────────────────────────────────────
  async evaluar(medicion: MedicionParaEvaluar): Promise<void> {
    // Obtener configuración de alertas para esta métrica y nodo
    const configs = await this.configRepo.find({
      where: [
        // Config específica para este nodo
        { nodoId: medicion.nodoId, metrica: medicion.metrica, activo: true },
        // Config global de la empresa (nodoId = null)
        { empresaId: medicion.empresaId, nodoId: null, metrica: medicion.metrica, activo: true },
      ],
    });

    for (const config of configs) {
      await this.evaluarUmbral(medicion, config);
    }
  }

  // ────────────────────────────────────────────────────────────
  // EVALUAR UN UMBRAL ESPECÍFICO
  // ────────────────────────────────────────────────────────────
  private async evaluarUmbral(
    medicion: MedicionParaEvaluar,
    config:   ConfiguracionAlerta,
  ): Promise<void> {
    const valor = medicion.valorActual;

    // Determinar nivel de alerta según umbrales
    let nivelNuevo: NivelAlerta | null = null;

    if (valor >= config.umbralCritical) {
      nivelNuevo = NivelAlerta.CRITICAL;
    } else if (valor >= config.umbralWarning) {
      nivelNuevo = NivelAlerta.WARNING;
    }

    // Buscar alerta activa previa para esta métrica/nodo
    const alertaExistente = await this.alertaRepo.findOne({
      where: {
        nodoId:   medicion.nodoId,
        metrica:  medicion.metrica,
        estado:   EstadoAlerta.ACTIVA,
      },
      order: { createdAt: 'DESC' },
    });

    if (nivelNuevo && !alertaExistente) {
      // Crear nueva alerta
      await this.crearAlerta({
        nodoId:     medicion.nodoId,
        empresaId:  medicion.empresaId,
        nodoNombre: medicion.nodoNombre,
        nivel:      nivelNuevo,
        metrica:    medicion.metrica,
        valorActual: valor,
        umbral:     nivelNuevo === NivelAlerta.CRITICAL ? config.umbralCritical : config.umbralWarning,
        config,
      });

    } else if (!nivelNuevo && alertaExistente) {
      // Resolver alerta previa (recovery)
      await this.resolverAlerta(alertaExistente.id, 'Sistema — valor volvió a rango normal');
    }
  }

  // ────────────────────────────────────────────────────────────
  // ALERTA DE NODO OFFLINE (sin umbral — evento directo)
  // ────────────────────────────────────────────────────────────
  async alertarNodoOffline(
    nodoId:     string,
    empresaId:  string,
    nodoNombre: string,
  ): Promise<void> {
    // Verificar si ya hay una alerta activa de offline para este nodo
    const alertaExistente = await this.alertaRepo.findOne({
      where: { nodoId, metrica: MetricaAlerta.ESTADO_NODO, estado: EstadoAlerta.ACTIVA },
    });
    if (alertaExistente) return; // Ya está alertado

    const alerta = await this.crearAlerta({
      nodoId,
      empresaId,
      nodoNombre,
      nivel:      NivelAlerta.CRITICAL,
      metrica:    MetricaAlerta.ESTADO_NODO,
      valorActual: 0,
      umbral:     1,
    });

    // Emitir evento para WebSocket broadcast
    this.events.emit(EVENTO_NODO_OFFLINE, {
      nodoId, empresaId, nodoNombre, alertaId: alerta?.id,
      timestamp: new Date().toISOString(),
    });
  }

  async alertarNodoOnline(
    nodoId:    string,
    empresaId: string,
    nodoNombre: string,
  ): Promise<void> {
    // Resolver alerta de offline si existe
    const alertaOffline = await this.alertaRepo.findOne({
      where: { nodoId, metrica: MetricaAlerta.ESTADO_NODO, estado: EstadoAlerta.ACTIVA },
    });

    if (alertaOffline) {
      await this.resolverAlerta(alertaOffline.id, 'Nodo recuperado — online');
    }

    // Emitir evento de recovery
    this.events.emit(EVENTO_NODO_ONLINE, {
      nodoId, empresaId, nodoNombre,
      timestamp: new Date().toISOString(),
    });
  }

  // ────────────────────────────────────────────────────────────
  // CREAR ALERTA
  // ────────────────────────────────────────────────────────────
  private async crearAlerta(params: {
    nodoId:     string;
    empresaId:  string;
    nodoNombre: string;
    nivel:      NivelAlerta;
    metrica:    MetricaAlerta;
    valorActual: number;
    umbral:     number;
    config?:    ConfiguracionAlerta;
  }): Promise<Alerta> {
    const mensaje = this.construirMensaje(params.metrica, params.valorActual, params.nivel);

    const alerta = this.alertaRepo.create({
      nodoId:     params.nodoId,
      empresaId:  params.empresaId,
      nodoNombre: params.nodoNombre,
      nivel:      params.nivel,
      estado:     EstadoAlerta.ACTIVA,
      metrica:    params.metrica,
      mensaje,
      detalle:    `Valor: ${params.valorActual} | Umbral: ${params.umbral}`,
      valorActual: params.valorActual,
      umbral:     params.umbral,
    });

    const saved = await this.alertaRepo.save(alerta);

    this.logger.warn(
      `🚨 ALERTA [${params.nivel.toUpperCase()}] ${params.nodoNombre}: ` +
      `${params.metrica} = ${params.valorActual} (umbral: ${params.umbral})`,
    );

    // Emitir evento para broadcast WebSocket en tiempo real
    this.events.emit(EVENTO_ALERTA_NUEVA, {
      alerta:    saved,
      empresaId: params.empresaId,
    });

    // Notificar por WhatsApp si está configurado
    if (params.config?.notificarWhatsapp && params.config?.telefonoDestino) {
      this.whatsapp.enviar({
        telefono:  params.config.telefonoDestino,
        tipo:      'onu_offline' as any,
        variables: {
          clienteNombre: params.nodoNombre,
          fechaHora:     new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }),
        },
      }).catch((err) =>
        this.logger.error(`WhatsApp alerta: ${err.message}`),
      );
    }

    return saved;
  }

  // ────────────────────────────────────────────────────────────
  // RESOLVER ALERTA
  // ────────────────────────────────────────────────────────────
  async resolverAlerta(
    alertaId:    string,
    motivo:      string,
    resueltaPor?: string,
  ): Promise<void> {
    const alerta = await this.alertaRepo.findOne({ where: { id: alertaId } });
    if (!alerta || alerta.estado !== EstadoAlerta.ACTIVA) return;

    const ahora       = new Date();
    const duracionMin = Math.floor(
      (ahora.getTime() - new Date(alerta.createdAt).getTime()) / 60000,
    );

    await this.alertaRepo.update(alertaId, {
      estado:          EstadoAlerta.RESUELTA,
      resueltaEn:      ahora,
      resueltaPor:     resueltaPor || 'sistema',
      duracionMinutos: duracionMin,
    });

    this.logger.log(
      `✅ Alerta resuelta [${duracionMin}min]: ${alerta.nodoNombre} | ${alerta.metrica}`,
    );

    this.events.emit(EVENTO_ALERTA_RESUELTA, {
      alertaId,
      nodoId:      alerta.nodoId,
      empresaId:   alerta.empresaId,
      nodoNombre:  alerta.nodoNombre,
      metrica:     alerta.metrica,
      duracionMin,
      timestamp:   ahora.toISOString(),
    });
  }

  // ────────────────────────────────────────────────────────────
  // QUERIES
  // ────────────────────────────────────────────────────────────
  async getAlertasActivas(empresaId: string): Promise<Alerta[]> {
    return this.alertaRepo.find({
      where: { empresaId, estado: EstadoAlerta.ACTIVA },
      order: { nivel: 'ASC', createdAt: 'DESC' },
      take: 100,
    });
  }

  async getHistorialAlertas(
    empresaId: string,
    nodoId?:   string,
    limit = 50,
  ): Promise<Alerta[]> {
    const qb = this.alertaRepo.createQueryBuilder('a')
      .where('a.empresa_id = :empresaId', { empresaId })
      .orderBy('a.created_at', 'DESC')
      .take(limit);

    if (nodoId) qb.andWhere('a.nodo_id = :nodoId', { nodoId });
    return qb.getMany();
  }

  async getResumenAlertas(empresaId: string): Promise<{
    activas: number; criticas: number; warnings: number;
    resueltasHoy: number;
  }> {
    const [activas, resueltasHoy] = await Promise.all([
      this.alertaRepo.createQueryBuilder('a')
        .select('a.nivel', 'nivel').addSelect('COUNT(*)', 'total')
        .where('a.empresa_id = :empresaId', { empresaId })
        .andWhere('a.estado = :estado', { estado: EstadoAlerta.ACTIVA })
        .groupBy('a.nivel').getRawMany(),

      this.alertaRepo.createQueryBuilder('a')
        .where('a.empresa_id = :empresaId', { empresaId })
        .andWhere('a.estado = :estado', { estado: EstadoAlerta.RESUELTA })
        .andWhere('a.resuelta_en >= CURRENT_DATE')
        .getCount(),
    ]);

    return {
      activas:      activas.reduce((acc, r) => acc + parseInt(r.total), 0),
      criticas:     parseInt(activas.find((r) => r.nivel === NivelAlerta.CRITICAL)?.total || '0'),
      warnings:     parseInt(activas.find((r) => r.nivel === NivelAlerta.WARNING)?.total || '0'),
      resueltasHoy,
    };
  }

  // ── Texto descriptivo de la alerta ──────────────────────
  private construirMensaje(
    metrica: MetricaAlerta,
    valor:   number,
    nivel:   NivelAlerta,
  ): string {
    const textos: Record<MetricaAlerta, string> = {
      [MetricaAlerta.PING_LATENCIA]:  `Alta latencia: ${valor.toFixed(1)}ms`,
      [MetricaAlerta.PING_PERDIDA]:   `Pérdida de paquetes: ${valor.toFixed(1)}%`,
      [MetricaAlerta.CPU]:            `CPU alta: ${valor.toFixed(1)}%`,
      [MetricaAlerta.MEMORIA]:        `Memoria alta: ${valor.toFixed(1)}%`,
      [MetricaAlerta.TRAFICO_BAJADA]: `Tráfico bajada: ${this.formatBps(valor)}`,
      [MetricaAlerta.TRAFICO_SUBIDA]: `Tráfico subida: ${this.formatBps(valor)}`,
      [MetricaAlerta.TEMPERATURA]:    `Temperatura alta: ${valor.toFixed(1)}°C`,
      [MetricaAlerta.ESTADO_NODO]:    `Nodo OFFLINE — sin respuesta`,
      [MetricaAlerta.SESIONES_PPPOE]: `Sesiones PPPoE: ${valor}`,
      [MetricaAlerta.SENAL_ONU]:      `Señal ONU baja: ${valor.toFixed(2)} dBm`,
    };
    return `[${nivel.toUpperCase()}] ${textos[metrica] || metrica}`;
  }

  private formatBps(bps: number): string {
    if (bps >= 1e9)  return `${(bps / 1e9).toFixed(2)} Gbps`;
    if (bps >= 1e6)  return `${(bps / 1e6).toFixed(2)} Mbps`;
    if (bps >= 1e3)  return `${(bps / 1e3).toFixed(2)} Kbps`;
    return `${bps} bps`;
  }
}
