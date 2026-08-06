import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { CanalPago, FormaPago } from './entities/canal-pago.entity';

/**
 * Resolución de los tres ejes de un ingreso: forma, canal y cuenta receptora.
 *
 * Existe porque durante la transición conviven DOS formularios de cobro que hablan
 * lenguajes distintos, y ninguno de los dos puede dejar de funcionar:
 *
 *   · `RegistrarPagoForm.tsx`   → valores del enum de dominio (`efectivo`, `yape`…)
 *   · `finanzas/registro`       → rótulos del catálogo `formas_pago_isp` (`Efectivo`,
 *                                 `Transferencia`, `Depósito`) + `bancos_isp`
 *
 * Esa divergencia es la causa raíz de lo que midió el diagnóstico F0: `metodo_pago`
 * guardaba `'Efectivo'` capitalizado, que no es ningún valor del dominio, y un pago en
 * efectivo llevaba `banco = 'Banco 01'` porque el segundo formulario autoselecciona el
 * primer banco de la lista y lo envía siempre.
 *
 * Aquí se traduce cualquiera de los dos lenguajes a un canal. El objetivo de esta fase no
 * es que los formularios cambien —eso es F5— sino que **ningún pago nazca sin canal**,
 * porque un pago sin canal desaparece de todo reporte de tesorería sin que nadie lo note.
 */
@Injectable()
export class CanalPagoService {
  private readonly logger = new Logger(CanalPagoService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Mapa de compatibilidad: lo que los formularios vivos envían hoy → código de canal.
   *
   * DUPLICACIÓN DECLARADA (directriz "reutilizar antes de construir", punto 5): estas
   * claves replican el mapeo del backfill de la migración 1791800000040. Se duplica
   * porque una es SQL de despliegue y otro es resolución en caliente, y no comparten
   * runtime. **Si se añade un método aquí, hay que añadirlo también allí**, o un pago
   * histórico y uno nuevo con el mismo método acabarán en canales distintos.
   *
   * Desaparece en F5, cuando el formulario mande `canalPagoId` y no haya nada que
   * adivinar.
   */
  private static readonly LEGACY_A_CANAL: Record<string, string> = {
    'efectivo':               'oficina',
    'yape':                   'yape',
    'plin':                   'plin',
    'mercadopago':            'mercadopago',
    'nota_credito':           'nota_credito',
  };

  /** Métodos legados que designan una FORMA y necesitan el banco para elegir canal. */
  private static readonly LEGACY_A_FORMA: Record<string, FormaPago> = {
    'transferencia_bancaria': FormaPago.TRANSFERENCIA,
    'transferencia':          FormaPago.TRANSFERENCIA,
    'deposito_bancario':      FormaPago.DEPOSITO,
    'deposito':               FormaPago.DEPOSITO,
    'depósito':               FormaPago.DEPOSITO,
    'tarjeta_credito':        FormaPago.TARJETA,
    'tarjeta_debito':         FormaPago.TARJETA,
    'cheque':                 FormaPago.OTRO,
    'otro':                   FormaPago.OTRO,
  };

  async porId(id: string, empresaId: string, manager?: EntityManager): Promise<CanalPago> {
    const repo = (manager ?? this.ds.manager).getRepository(CanalPago);
    const canal = await repo.findOne({ where: { id, empresaId } });
    if (!canal) throw new BadRequestException('El canal de pago indicado no existe');
    if (!canal.activo) {
      throw new BadRequestException(
        `El canal "${canal.nombre}" está desactivado — elige otro para registrar el cobro`,
      );
    }
    return canal;
  }

  async listar(empresaId: string, soloManuales = false): Promise<CanalPago[]> {
    const repo = this.ds.getRepository(CanalPago);
    const canales = await repo.find({
      where: soloManuales
        ? { empresaId, activo: true, permiteRegistroManual: true }
        : { empresaId, activo: true },
      order: { formaPago: 'ASC', nombre: 'ASC' },
    });
    return canales;
  }

  /**
   * Taxonomía cerrada. Se sirve desde la BD para que la UI y el dominio no diverjan.
   *
   * `requiereOperacion` viaja con cada forma porque es la SUGERENCIA con la que nace un
   * canal nuevo: una transferencia sin número de operación no se puede antiduplicar, y
   * pedirle al operador que se acuerde de marcarlo es delegarle una regla que el sistema
   * ya conoce. El canal sigue mandando — puede desmarcarlo si su caso lo justifica.
   */
  async formas(): Promise<Array<{ codigo: string; nombre: string; requiereOperacion: boolean }>> {
    return this.ds.query(
      `SELECT codigo, nombre, requiere_operacion AS "requiereOperacion"
         FROM forma_pago ORDER BY orden, nombre`,
    );
  }

  /**
   * Alta de canal. `codigo` se deriva del nombre y es INMUTABLE: es lo que referencia el
   * histórico. Cambiar el rótulo mañana no puede reescribir por dónde entró un cobro de
   * hace dos años.
   */
  async crear(empresaId: string, dto: {
    nombre: string; formaPago: FormaPago; cuentaReceptoraDefaultId?: string | null;
    requiereNumeroOperacion?: boolean; requiereVoucher?: boolean;
    comisionPorcentaje?: number; comisionFija?: number;
  }): Promise<CanalPago> {
    const codigo = `${dto.formaPago}-${dto.nombre}`
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

    const existe = await this.ds.getRepository(CanalPago)
      .findOne({ where: { empresaId, codigo } });
    if (existe) {
      throw new BadRequestException(
        `Ya existe un canal "${existe.nombre}" para esa forma de pago` +
        (existe.activo ? '' : ' (está desactivado — reactívalo en vez de crear otro)'),
      );
    }

    const canal = this.ds.getRepository(CanalPago).create({
      empresaId, codigo, nombre: dto.nombre.trim(), formaPago: dto.formaPago,
      cuentaReceptoraDefaultId: dto.cuentaReceptoraDefaultId ?? null,
      requiereNumeroOperacion: dto.requiereNumeroOperacion ?? false,
      requiereVoucher:         dto.requiereVoucher ?? false,
      comisionPorcentaje:      dto.comisionPorcentaje ?? 0,
      comisionFija:            dto.comisionFija ?? 0,
      permiteRegistroManual:   true,
      activo: true, esProtegido: false,
    });
    return this.ds.getRepository(CanalPago).save(canal);
  }

  /**
   * Edición. `codigo` y `formaPago` NO se pueden cambiar: mover un canal de forma
   * reescribiría el significado de todos los cobros que ya entraron por él. Para eso se
   * desactiva y se crea otro.
   */
  async actualizar(id: string, empresaId: string, dto: Partial<{
    nombre: string; cuentaReceptoraDefaultId: string | null;
    requiereNumeroOperacion: boolean; requiereVoucher: boolean;
    comisionPorcentaje: number; comisionFija: number; activo: boolean;
  }>): Promise<CanalPago> {
    const repo = this.ds.getRepository(CanalPago);
    const canal = await repo.findOne({ where: { id, empresaId } });
    if (!canal) throw new BadRequestException('Canal no encontrado');

    Object.assign(canal, dto, { updatedAt: new Date() });
    return repo.save(canal);
  }

  /**
   * Baja LÓGICA, siempre. Un canal con pagos históricos no se puede borrar sin dejar esos
   * cobros sin explicación de por dónde entraron; y uno sin pagos tampoco se borra, porque
   * mañana puede tenerlos y la regla sería distinta según el día.
   */
  async desactivar(id: string, empresaId: string): Promise<void> {
    const repo = this.ds.getRepository(CanalPago);
    const canal = await repo.findOne({ where: { id, empresaId } });
    if (!canal) throw new BadRequestException('Canal no encontrado');
    canal.activo = false;
    await repo.save(canal);
  }

  /**
   * Resuelve el canal de un pago entrante.
   *
   * Devuelve `null` en vez de lanzar cuando no reconoce el método: en esta fase el canal
   * es información añadida, y **rechazar un cobro porque el ERP no supo clasificarlo
   * sería peor que registrarlo sin clasificar**. Se registra un warn para que un método
   * no contemplado se vea el mismo día, no en el reporte de fin de mes.
   */
  async resolverDesdeLegacy(
    empresaId: string,
    metodoPago: string,
    banco: string | null | undefined,
    manager?: EntityManager,
  ): Promise<CanalPago | null> {
    const em = manager ?? this.ds.manager;
    const clave = (metodoPago ?? '').trim().toLowerCase();

    const codigoDirecto = CanalPagoService.LEGACY_A_CANAL[clave];
    if (codigoDirecto) {
      const canal = await em.getRepository(CanalPago).findOne({
        where: { empresaId, codigo: codigoDirecto },
      });
      if (canal) return canal;
    }

    // Métodos que designan una forma: el canal lo decide el banco escrito a mano.
    const forma = CanalPagoService.LEGACY_A_FORMA[clave];
    if (forma && banco?.trim()) {
      const canal = await em.getRepository(CanalPago)
        .createQueryBuilder('c')
        .where('c.empresa_id = :empresaId', { empresaId })
        .andWhere('c.forma_pago = :forma', { forma })
        .andWhere('LOWER(c.nombre) = LOWER(:banco)', { banco: banco.trim() })
        .getOne();
      if (canal) return canal;
    }

    this.logger.warn(
      `[COBRANZA] Pago con método "${metodoPago}"${banco ? ` / banco "${banco}"` : ''} ` +
      `sin canal equivalente: queda sin clasificar y no aparecerá en el reporte por canal. ` +
      `Da de alta el canal o amplía el mapa de compatibilidad.`,
    );
    return null;
  }

  /**
   * Comisión del canal sobre un importe.
   *
   * `monto` es SIEMPRE el bruto: es lo que pagó el abonado y lo que salda la factura. El
   * neto es lo que llega a la cuenta, y por tanto lo que hay que buscar en el extracto
   * bancario al conciliar. Confundirlos deja debiendo la comisión a quien pagó completo.
   */
  calcularComision(canal: CanalPago | null, monto: number): { comision: number; neto: number } {
    if (!canal) return { comision: 0, neto: Number(monto.toFixed(2)) };
    const bruta = (monto * Number(canal.comisionPorcentaje)) / 100 + Number(canal.comisionFija);
    const comision = Number(Math.max(0, bruta).toFixed(2));

    // Una comisión que se come el cobro entero es un error de configuración, no un cobro.
    // Registrar un neto negativo lo propaga a la conciliación y al asiento de gasto.
    if (comision > monto) {
      this.logger.error(
        `[COBRANZA] La comisión del canal "${canal.nombre}" (S/ ${comision}) supera el ` +
        `importe cobrado (S/ ${monto}). Se registra comisión 0 — revisa la configuración.`,
      );
      return { comision: 0, neto: Number(monto.toFixed(2)) };
    }
    return { comision, neto: Number((monto - comision).toFixed(2)) };
  }
}
