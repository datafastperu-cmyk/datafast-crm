import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Consumo de datos del abonado: acumulado del mes y desglose por día.
//
// La tabla `consumo_datos` existe desde la migración 1700000009000 pero HOY NADIE LA
// ESCRIBE: no hay colector. Por eso `fuente` es parte del contrato de este endpoint y no
// un detalle interno — el portal necesita distinguir "consumiste 0 GB" de "no lo medimos".
// Inventar una cifra sería darle al abonado un número que puede reclamar y que nadie
// podría sustentar.
//
// Cuando exista el colector (lee contadores de cola/PPPoE en MikroTik y agrega por hora),
// este servicio no cambia: empezará a devolver `fuente: 'medido'` porque habrá filas.

export type FuenteConsumo = 'medido' | 'no_disponible';

export interface ConsumoDia {
  fecha:    string;
  rxBytes:  number;
  txBytes:  number;
}

export interface PortalConsumo {
  desde:         string;
  hasta:         string;
  totalRxBytes:  number;
  totalTxBytes:  number;
  dias:          ConsumoDia[];
  fuente:        FuenteConsumo;
}

@Injectable()
export class PortalConsumoService {
  constructor(private readonly dataSource: DataSource) {}

  async consumo(
    clienteId: string,
    empresaId: string,
    contratoId: string,
    desde?: string,
    hasta?: string,
  ): Promise<PortalConsumo> {
    const [contrato] = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM contratos
        WHERE id = $1 AND cliente_id = $2 AND empresa_id = $3 AND deleted_at IS NULL`,
      [contratoId, clienteId, empresaId],
    );
    if (!contrato) throw new NotFoundException('Servicio no encontrado');

    const rango = this.resolverRango(desde, hasta);

    // Se agrega por día aunque la tabla admita granularidad horaria: al abonado le
    // interesa el día, y sumar en SQL evita traer 720 filas por mes.
    const filas = await this.dataSource.query<
      Array<{ fecha: string; rx: string; tx: string }>
    >(
      `SELECT fecha::text AS fecha,
              SUM(rx_bytes)::bigint::text AS rx,
              SUM(tx_bytes)::bigint::text AS tx
         FROM consumo_datos
        WHERE contrato_id = $1 AND cliente_id = $2 AND empresa_id = $3
          AND fecha BETWEEN $4 AND $5
        GROUP BY fecha
        ORDER BY fecha ASC`,
      [contratoId, clienteId, empresaId, rango.desde, rango.hasta],
    );

    const dias = filas.map((f) => ({
      fecha:   f.fecha,
      rxBytes: Number(f.rx),
      txBytes: Number(f.tx),
    }));

    return {
      desde:        rango.desde,
      hasta:        rango.hasta,
      totalRxBytes: dias.reduce((s, d) => s + d.rxBytes, 0),
      totalTxBytes: dias.reduce((s, d) => s + d.txBytes, 0),
      dias,
      // Sin filas no se afirma "0 GB": se declara que no hay medición. Es la diferencia
      // entre un dato y una suposición.
      fuente: dias.length > 0 ? 'medido' : 'no_disponible',
    };
  }

  // Por defecto, el mes en curso. Se acotan los rangos arbitrarios a 92 días para que un
  // parámetro suelto no dispare un escaneo de años sobre la tabla.
  private resolverRango(desde?: string, hasta?: string): { desde: string; hasta: string } {
    const valida = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const d = valida(desde);
    const h = valida(hasta);

    if (d && h) {
      const dias = (Date.parse(h) - Date.parse(d)) / 86_400_000;
      if (dias >= 0 && dias <= 92) return { desde: d, hasta: h };
    }

    const hoy = new Date();
    const primero = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    return {
      desde: primero.toISOString().slice(0, 10),
      hasta: hoy.toISOString().slice(0, 10),
    };
  }
}
