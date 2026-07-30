import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket, TicketComentario } from './entities/ticket.entity';
import { TicketRepository }  from './repositories/ticket.repository';
import { TicketsService }    from './tickets.service';
import { TicketsController } from './tickets.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Ticket, TicketComentario])],
  providers: [TicketRepository, TicketsService],
  controllers: [TicketsController],
  // TicketRepository se exporta para el Portal del Cliente: un ticket abierto por el
  // abonado no puede pasar por TicketsService.create, que asume un operador autenticado
  // (escribiría `creado_por` con el id del cliente, que no es un usuario del ERP).
  exports: [TicketsService, TicketRepository],
})
export class TicketsModule {}
