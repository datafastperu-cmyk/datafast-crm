import { Module }        from '@nestjs/common';
import { HttpModule }     from '@nestjs/axios';
import { TypeOrmModule }  from '@nestjs/typeorm';

import { Tr069Device }          from './entities/tr069-device.entity';
import { Tr069GenieacsClient }  from './tr069-genieacs.client';
import { Tr069Service }         from './tr069.service';
import { Tr069Controller }      from './tr069.controller';

// Módulo TR-069 / ACS (GenieACS). Degradable: arranca aunque GenieACS no exista.
@Module({
  imports: [
    HttpModule.register({ timeout: 15_000, maxRedirects: 2 }),
    TypeOrmModule.forFeature([Tr069Device]),
  ],
  controllers: [Tr069Controller],
  providers:   [Tr069GenieacsClient, Tr069Service],
  exports:     [Tr069Service],
})
export class Tr069Module {}
