import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectDataSource }                        from '@nestjs/typeorm';
import { DataSource }                              from 'typeorm';

@Module({})
export class SchemaGuardModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('SchemaGuard');

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV !== 'production') return;
    try {
      const builder = this.ds.driver.createSchemaBuilder();
      // log() devuelve los queries que synchronize ejecutaría — si hay algo, hay drift
      const { upQueries } = await (builder as any).log();
      if (upQueries && upQueries.length > 0) {
        this.logger.error('══════════════════════════════════════════════');
        this.logger.error('ALERTA: hay columnas en las entidades que NO');
        this.logger.error('existen en la BD. Crea una migración con:');
        this.logger.error('  npm run migration:generate -- src/database/migrations/NombreFix');
        this.logger.error('  npm run migration:run');
        this.logger.error(`Pendiente (${upQueries.length} queries):`);
        upQueries.slice(0, 10).forEach((q: { query: string }) =>
          this.logger.error(`  » ${q.query.slice(0, 120)}`),
        );
        this.logger.error('══════════════════════════════════════════════');
      }
    } catch {
      // Si falla el check no bloqueamos el arranque
    }
  }
}
