import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicator } from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class HealthService extends HealthIndicator {
  private readonly logger = new Logger(HealthService.name);
  private redis: Redis;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    super();
    // Conexión Redis solo para health check
    this.redis = new Redis({
      host: config.get('redis.host'),
      port: config.get('redis.port'),
      password: config.get('redis.password'),
      db: 0,
      connectTimeout: 3000,
      lazyConnect: true,
    });
  }

  // ─── Check Redis ──────────────────────────────────────────────
  async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      await this.redis.connect().catch(() => {}); // silenciar si ya conectado
      const pong = await this.redis.ping();
      const info = await this.redis.info('server');
      const versionMatch = info.match(/redis_version:(.+)\r/);
      const version = versionMatch ? versionMatch[1].trim() : 'unknown';

      return this.getStatus('redis', pong === 'PONG', {
        version,
        status: 'connected',
      });
    } catch (error) {
      this.logger.error(`Redis health check failed: ${error.message}`);
      return this.getStatus('redis', false, {
        message: error.message,
      });
    }
  }

  // ─── Info del sistema ─────────────────────────────────────────
  async getSystemInfo() {
    const memUsage = process.memoryUsage();
    const dbConnected = this.dataSource.isInitialized;

    let dbStats = null;
    if (dbConnected) {
      try {
        const result = await this.dataSource.query(`
          SELECT 
            count(*) as active_connections
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND state = 'active'
        `);
        dbStats = {
          connected: true,
          activeConnections: parseInt(result[0]?.active_connections || '0'),
        };
      } catch {
        dbStats = { connected: dbConnected };
      }
    }

    return {
      memory: {
        heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMb: Math.round(memUsage.rss / 1024 / 1024),
        externalMb: Math.round(memUsage.external / 1024 / 1024),
      },
      database: dbStats,
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    };
  }
}
