import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { QUEUES, JOBS } from '../../workers/workers.constants';
import { GoogleOAuthService } from '../services/google-oauth.service';

// ─── Eventos de dominio que disparan sync Google ──────────────
export interface EventClienteCreado {
  empresaId:  string;
  clienteId:  string;
  nombres:    string;
  apellidos:  string;
  email?:     string;
  telefono?:  string;
  direccion?: string;
}

export interface EventInstalacionCompletada {
  empresaId:       string;
  clienteId:       string;
  contratoId:      string;
  nombreCliente:   string;
  direccion:       string;
  fechaInstalacion: string;
  tecnicoId?:      string;
  latitud?:        number;
  longitud?:       number;
}

export interface EventPagoRegistrado {
  empresaId:    string;
  clienteId:    string;
  contratoId:   string;
  pagoId:       string;
  monto:        number;
  nombreCliente: string;
  fechaPago:    string;
}

export interface EventContratoSuspendido {
  empresaId:    string;
  clienteId:    string;
  contratoId:   string;
  nombreCliente: string;
  motivo?:      string;
}

export interface EventVisitaTecnicaAgendada {
  empresaId:     string;
  clienteId:     string;
  contratoId?:   string;
  nombreCliente: string;
  descripcion:   string;
  fechaVisita:   string;  // ISO 8601
  duracionHoras?: number;
  direccion?:    string;
  tecnicoId?:    string;
}

// ─────────────────────────────────────────────────────────────
@Injectable()
export class GoogleEventsListener {
  private readonly logger = new Logger(GoogleEventsListener.name);

  constructor(
    @InjectQueue(QUEUES.GOOGLE_SYNC) private readonly googleQueue: Queue,
    private readonly oauthSvc: GoogleOAuthService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ── Cliente creado → sync contacto ───────────────────────
  @OnEvent('cliente.created', { async: true })
  async onClienteCreado(event: EventClienteCreado) {
    if (!await this.isConnected(event.empresaId)) return;

    await this.googleQueue.add(JOBS.GOOGLE_SYNC_CONTACT, {
      empresaId: event.empresaId,
      clienteId: event.clienteId,
      triggered: 'cliente.created',
    }, { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } });

    this.logger.debug(`[${event.empresaId}] Encolado sync contacto para cliente ${event.clienteId}`);
  }

  // ── Instalación completada → evento calendario + geocodificación ──
  @OnEvent('instalacion.completed', { async: true })
  async onInstalacionCompletada(event: EventInstalacionCompletada) {
    if (!await this.isConnected(event.empresaId)) return;

    const account = await this.oauthSvc.getAccount(event.empresaId).catch(() => null);
    if (!account) return;

    // Evento en calendario si está habilitado
    if (account.calendarEnabled) {
      const fecha = new Date(event.fechaInstalacion);
      const fin   = new Date(fecha.getTime() + 2 * 3600 * 1000);

      await this.googleQueue.add(JOBS.GOOGLE_CALENDAR_EVENT, {
        empresaId:     event.empresaId,
        summary:       `Instalación: ${event.nombreCliente}`,
        description:   `Instalación completada\nContrato: ${event.contratoId}`,
        startDateTime: fecha.toISOString(),
        endDateTime:   fin.toISOString(),
        location:      event.direccion,
        colorId:       '2', // verde
        referenceId:   event.contratoId,
        clienteId:     event.clienteId,
      }, { attempts: 2 });
    }

    // Geocodificar si no hay coordenadas
    if (!event.latitud && event.direccion) {
      await this.googleQueue.add(JOBS.GOOGLE_GEOCODE_ADDRESS, {
        empresaId:   event.empresaId,
        address:     event.direccion,
        clienteId:   event.clienteId,
        contratoId:  event.contratoId,
      }, { attempts: 2 });
    }

    // Sync contacto actualizado
    if (account.contactsEnabled) {
      await this.googleQueue.add(JOBS.GOOGLE_SYNC_CONTACT, {
        empresaId: event.empresaId,
        clienteId: event.clienteId,
        triggered: 'instalacion.completed',
      }, { attempts: 2 });
    }
  }

  // ── Pago registrado → evento calendario ──────────────────
  @OnEvent('pago.registered', { async: true })
  async onPagoRegistrado(event: EventPagoRegistrado) {
    if (!await this.isConnected(event.empresaId)) return;
    const account = await this.oauthSvc.getAccount(event.empresaId).catch(() => null);
    if (!account?.calendarEnabled) return;

    const fecha = new Date(event.fechaPago);
    const fin   = new Date(fecha.getTime() + 30 * 60 * 1000);

    await this.googleQueue.add(JOBS.GOOGLE_CALENDAR_EVENT, {
      empresaId:     event.empresaId,
      summary:       `Pago S/ ${event.monto.toFixed(2)}: ${event.nombreCliente}`,
      description:   `Pago registrado\nContrato: ${event.contratoId}\nPago ID: ${event.pagoId}`,
      startDateTime: fecha.toISOString(),
      endDateTime:   fin.toISOString(),
      colorId:       '9', // azul
      referenceId:   event.pagoId,
      clienteId:     event.clienteId,
    }, { attempts: 2 });
  }

  // ── Visita técnica agendada → evento calendario ───────────
  @OnEvent('visita.scheduled', { async: true })
  async onVisitaAgendada(event: EventVisitaTecnicaAgendada) {
    if (!await this.isConnected(event.empresaId)) return;
    const account = await this.oauthSvc.getAccount(event.empresaId).catch(() => null);
    if (!account?.calendarEnabled) return;

    const inicio = new Date(event.fechaVisita);
    const horas  = event.duracionHoras ?? 1;
    const fin    = new Date(inicio.getTime() + horas * 3600 * 1000);

    await this.googleQueue.add(JOBS.GOOGLE_CALENDAR_EVENT, {
      empresaId:     event.empresaId,
      summary:       `Visita: ${event.nombreCliente}`,
      description:   event.descripcion,
      startDateTime: inicio.toISOString(),
      endDateTime:   fin.toISOString(),
      location:      event.direccion,
      colorId:       '5', // amarillo
      referenceId:   event.contratoId,
      clienteId:     event.clienteId,
    }, { attempts: 2 });
  }

  // ── Contrato suspendido → actualizar contacto ─────────────
  @OnEvent('contrato.suspended', { async: true })
  async onContratoSuspendido(event: EventContratoSuspendido) {
    if (!await this.isConnected(event.empresaId)) return;
    const account = await this.oauthSvc.getAccount(event.empresaId).catch(() => null);
    if (!account?.contactsEnabled) return;

    await this.googleQueue.add(JOBS.GOOGLE_SYNC_CONTACT, {
      empresaId: event.empresaId,
      clienteId: event.clienteId,
      triggered: 'contrato.suspended',
    }, { attempts: 2 });
  }

  // ── Helper: verificar si empresa tiene Google conectado ───
  private readonly connectedCache = new Map<string, { ts: number; ok: boolean }>();

  private async isConnected(empresaId: string): Promise<boolean> {
    const cached = this.connectedCache.get(empresaId);
    if (cached && Date.now() - cached.ts < 60_000) return cached.ok;

    try {
      const account = await this.oauthSvc.getAccount(empresaId);
      const ok = !!account;
      this.connectedCache.set(empresaId, { ts: Date.now(), ok });
      return ok;
    } catch {
      this.connectedCache.set(empresaId, { ts: Date.now(), ok: false });
      return false;
    }
  }
}
