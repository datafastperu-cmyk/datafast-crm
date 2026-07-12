import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';

import { XuiController } from './xui.controller';
import { XuiApiService } from './xui-api.service';
import { XuiLinesService } from './xui-lines.service';
import { XuiMonitorService } from './xui-monitor.service';
import { XuiServidoresService } from './xui-servidores.service';
import { XuiLine } from './entities/xui-line.entity';
import { XuiServidor } from './entities/xui-servidor.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([XuiLine, XuiServidor]),
    AuthModule,
    HttpModule.register({
      timeout: 15_000,
      maxRedirects: 3,
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
        'User-Agent':   'DATAFAST-ISP/1.0',
      },
    }),
  ],
  controllers: [XuiController],
  providers: [XuiApiService, XuiLinesService, XuiMonitorService, XuiServidoresService],
  exports: [XuiApiService, XuiLinesService],
})
export class XuiModule {}
