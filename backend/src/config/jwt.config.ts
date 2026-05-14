import { registerAs } from '@nestjs/config';

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  // Opciones adicionales
  issuer: 'fibranet-isp',
  audience: 'fibranet-app',

  // Duración del blacklist de tokens en segundos
  // Debe ser >= al tiempo máximo de expiración del access token
  blacklistTtl: 60 * 60, // 1 hora
}));
