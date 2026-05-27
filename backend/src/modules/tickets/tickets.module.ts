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
  exports: [TicketsService],
})
export class TicketsModule {}
