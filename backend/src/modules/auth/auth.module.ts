import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuditoriaService } from './auditoria.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';

import { Usuario } from '../usuarios/entities/usuario.entity';
import { Rol } from '../usuarios/entities/rol.entity';
import { Permiso } from '../usuarios/entities/permiso.entity';
import { AuditoriaLog } from '../usuarios/entities/auditoria-log.entity';

@Module({
  imports: [
    // TypeORM — entidades necesarias
    TypeOrmModule.forFeature([Usuario, Rol, Permiso, AuditoriaLog]),

    // Passport con JWT como estrategia por defecto
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // JWT configurado desde variables de entorno
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: config.get<string>('jwt.expiresIn', '15m'),
          issuer: 'fibranet-isp',
          audience: 'fibranet-app',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuditoriaService,
    JwtStrategy,
    JwtRefreshStrategy,
  ],
  exports: [
    // Exportar para que otros módulos puedan usar JwtService y AuditoriaService
    AuthService,
    AuditoriaService,
    JwtModule,
    PassportModule,
  ],
})
export class AuthModule {}
