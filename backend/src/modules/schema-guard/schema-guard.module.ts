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
      // Hallazgo Ola 0 (2026-08-16, F-0.1 §5.1.1): `log()` lee `typeorm_metadata` para
      // resolver columnas GENERATED (`segmentos_ipv4.ips_disponibles`), pero a diferencia de
      // `synchronize()` no la crea si falta. En una instalación limpia real esa tabla nunca
      // existe: `log()` revienta con "relation typeorm_metadata does not exist", el catch de
      // abajo se lo traga, y esta alarma queda MUDA para siempre en cualquier instalación
      // nueva — el mismo defecto que rompía `npm run db:check`, aquí en producción. Se
      // reproduce solo el paso de bookkeeping que falta, igual que
      // `scripts/preparar-schema-log.ts`; nunca sincroniza tablas ni columnas.
      const qrPrevio = this.ds.createQueryRunner();
      try {
        await (builder as any).createTypeormMetadataTable(qrPrevio);
      } finally {
        await qrPrevio.release();
      }
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
