import { Global, Module } from '@nestjs/common';
import { EventosSistemaService } from './eventos-sistema.service';

// Global: cualquier módulo (OLT, MikroTik, notificaciones, crons) puede
// inyectar EventosSistemaService sin importar SistemaModule, evitando
// ciclos de dependencia (SistemaModule importa NotificacionesModule).
@Global()
@Module({
  providers: [EventosSistemaService],
  exports:   [EventosSistemaService],
})
export class EventosSistemaModule {}
