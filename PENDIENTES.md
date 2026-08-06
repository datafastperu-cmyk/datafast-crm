# Pendientes y deuda técnica — ErpDatafast

> Registro vivo de lo que queda por hacer. **Cualquier sesión debe leer este archivo cuando
> se pregunte "¿qué pendientes hay?"**, y añadir aquí lo nuevo que quede abierto en vez de
> dejarlo solo en el mensaje de una conversación que nadie volverá a leer.
>
> Formato de cada entrada: qué falta, **por qué importa** (la consecuencia real, no la
> tarea) y cómo se comprueba. Una entrada sin consecuencia acaba siendo ignorada.
>
> Última actualización: 2026-08-06

---

## 🔴 Abierto — impacto en producción

### 1. Gateway de mensajería: NINGÚN mensaje sale
**Estado:** pendiente por decisión del usuario (2026-08-06).

`notificaciones_logs` tiene **480 de 480 registros en `NO_ENVIADO`**. Entre ellos, 14 avisos
de servicio suspendido, 35 de bienvenida y 237 de emisor caído. El ERP cree que informa a
los abonados y no informa a nadie.

Deja inútil todo el bloque de notificaciones por cliente cableado el 05/08 (aviso de
factura nueva y los tres recordatorios de pago): se encolan y mueren igual.

```sql
SELECT estado_entrega, COUNT(*) FROM notificaciones_logs GROUP BY 1;
```

**Ojo al arreglarlo:** el gateway soporta WhatsApp (varios proveedores) y SMTP. **No existe
proveedor de SMS**, así que las opciones 'sms' y 'ambos' de la pantalla de configuración
funcionan hoy como un simple interruptor de encendido.

---

## 🟡 Abierto — funciones que faltan

### 2-bis. Cobranza Etapa II — pasarelas de pago (PENDIENTE A PROPÓSITO)
**Estado:** diseñada y contratada, **no construida**. Bloqueada por una puerta de
estabilidad, no por falta de tiempo (2026-08-06).

**⛔ Antes de escribir una sola línea, leer en este orden:**

1. [`docs/cobranza-plan-implementacion.md`](docs/cobranza-plan-implementacion.md) §"⛔ ETAPA II"
2. [`backend/src/modules/pagos/adaptadores/README.md`](backend/src/modules/pagos/adaptadores/README.md)
3. `adaptador-cobro.interface.ts` — **el contrato ya existe y tiene tests. No se reinventa.**

La Etapa I (registro de pagos) está completa y en producción: tres ejes forma/canal/cuenta
receptora, un solo escritor del saldo de una factura, extorno atómico, arqueo de caja y
clave de idempotencia por request.

**Por qué importa que no se adelante:** faltan tres criterios que **no dependen de escribir
código**, sino de que el ERP cobre dinero real unas semanas —30 días de invariante contable
limpio (arrancó el 06/08, cierra ~05/09/2026), un extorno real revisado a mano y un cierre
de caja mensual cuadrado—. Integrar proveedores sobre una frontera no demostrada se descubre
con dinero de clientes en juego, y cada proveedor apilado multiplica el coste de corregirlo.

**Orden correcto cuando la puerta se abra:** F8 (motor + `cobro_intento` + conciliador) →
F9 (MercadoPago migrado al contrato; es el único con dinero real, y si la abstracción no lo
absorbe se corrige con uno y no con tres) → F10 (nuevos proveedores) → F11 (POS/QR).

**Lo que NO hay que hacer** —las tres ya salieron mal en este repo y hay tests que las
bloquean—: crear un servicio de registro de pagos paralelo, aplicar dinero desde un
adaptador o un webhook, e inferir reintentabilidad desde un código HTTP.

```sql
-- Criterio 1 de la puerta: debe dar 0 todos los días hasta el 05/09.
SELECT COUNT(*) FROM (
  SELECT f.id FROM facturas f JOIN pago_aplicaciones pa ON pa.factura_id = f.id
   WHERE f.deleted_at IS NULL GROUP BY f.id, f.monto_pagado
  HAVING ABS(f.monto_pagado::numeric - SUM(pa.monto_aplicado)::numeric) > 0.01) x;
```

**Tarea de negocio previa, sin código:** cargar las cuentas bancarias reales (número, CCI,
titular) en Finanzas → Ajustes de Cobranza. La migración sembró las cajas pero no inventó
cuentas de banco — eso es dato del negocio, y sin él los canales de transferencia no tienen
cuenta que sugerir.

### 2. Campos de configuración del cliente que no hacen nada
**Estado:** pendiente por decisión del usuario (2026-08-05).

En *Cliente → Facturación → Configuración* se guardan y no los lee nadie:

| Campo | Qué haría falta |
|---|---|
| `aplicarMora` + `montoMora` | Generar el cargo al vencer sin pago (existe `cargos_pendientes` y `registrarCargoPendiente`; falta el disparador) |
| `aplicarReconexion` + `montoReconexion` | Generar el cargo al reactivar un servicio cortado |
| `esquemaImpuesto` | Definir antes cómo convive con la regla vigente: el IGV lo decide la carga fiscal del comprobante |
| `impuesto1` (%) | Sumarlo al total del comprobante |
| `avisoPantalla` | Portal cautivo — **no existe la infraestructura**; es el más caro de los cinco |

Un campo que se guarda y no hace nada es peor que no tenerlo: el operador cree haberlo
configurado. Si alguno no se va a implementar, la alternativa honesta es retirarlo de la
pantalla.

### 3. Comprobante fiscal del anticipo
**Estado:** cerrado por el usuario — *"lo trabajaremos internamente, así está bien"*.

El adelanto se registra como movimiento de caja con su recibo imprimible. Si SUNAT
llegara a exigir un documento de anticipo con serie y correlativo propios, es un trabajo
aparte que toca la numeración fiscal.

---

## 🟠 Deuda técnica

### 5. Tests que faltan
- Vista unificada del Log: validada a mano contra la base real, sin test que lo fije.
- La emisión diaria por ciclo de cliente tiene tests de la política de fechas
  (`politica-facturacion.service.spec.ts`, 11 casos) pero no de la selección de a quién se
  emite cada día. **Justo ahí estuvo el fallo del 06/08**, que no lo detectó ningún test
  sino una verificación manual contra producción.

### 6. Colisión de timestamps en migraciones
`FnSnOnuNormalizado1791800000035` y `CreatePagoAplicaciones1791800000035` comparten
timestamp. En producción no causó daño —son independientes y ambas se aplicaron—, pero en
una instalación nueva el orden entre ellas es indeterminado. Con migraciones dependientes
rompería.

### 7. Descripciones antiguas de pagos
Los registros anteriores al 05/08 dicen `factura: undefined`. Corregido para los nuevos.
**No se reescriben**: la auditoría no se toca.

### 8. `AuditLog.id` cambió de `number` a `string`
Por el UNION de la vista unificada. Se ajustó `AuditoriaTab`, pero no se auditó si algún
otro consumidor asume numérico.

---

## 🔵 A vigilar (no es un fallo, es un cambio sin ejercitar)

### 9. Primera emisión automática con el ciclo por cliente
**El cambio más arriesgado del 05/08.** La facturación pasó de dispararse una vez al mes
por empresa a correr **todos los días** evaluando el ciclo de cada abonado
(`diaPago − crearFactura`). Un fallo aquí no afecta a un cliente: afecta a todo el parque
a la vez y de madrugada.

**Verificación en seco hecha el 06/08** — y encontró un fallo que ya estaba tumbando la
generación (ver "Cerrado"). Tras corregirlo, el próximo ciclo queda así:

| Abonado | Se emite | Vence | Corte | Periodo (prepago) |
|---|---|---|---|---|
| James Pena / Piero Escobar | 23/08 | 28/08 | 04/09 | septiembre |

Sigue sin ejercitarse la emisión REAL: la del 23/08 es la primera. Conviene mirar los logs
del worker esa madrugada.

### 10. "Solo registrar" no tiene red de seguridad
Cobra sin reactivar el servicio (baja voluntaria que salda su último comprobante). Si se
usa por error, **el abonado queda sin servicio hasta que una persona lo note**: ningún
watcher lo levanta ni avisa. Queda en auditoría con la marca `SIN reactivar servicio`.

---

## ✅ Cerrado (para no volver a levantarlo)

- **La generación de facturas estaba MUERTA en producción (06/08).** `findContratosParaFacturar`
  filtraba por `co.estado IN ('activo', 'prorroga')` y el estado `prorroga` no existe en el
  enum: Postgres no devuelve menos filas, **rechaza la consulta entera**. El job falló sus
  3 intentos esa madrugada y el día 23 no habría salido ni una factura. El literal era
  preexistente pero estaba latente mientras la generación corría un día al mes. Corregido
  en los tres sitios donde aparecía (facturación y dos consultas de velocidad) y fijado con
  `estados-sql-validos.spec.ts`, que recorre el código y falla si algún SQL compara
  `co.estado` con un valor fuera del enum.
- **`auditoria_logs` sin retención y clasificada por el texto de la descripción (06/08).**
  Ahora hay columna `tipo` que decide quien escribe, y un cron diario que caduca solo el eco
  técnico con más de 90 días. Lo de negocio no se borra nunca.

- **Corte indebido del 05/08** (James Pena): el cron medía la mora desde el alta del
  contrato y no respetaba prórrogas. Corregido y desplegado.
- **`deuda_total` desfasada** de Piero (S/64 mostrados vs S/128 reales): se corrigió sola
  con el pago consolidado; hoy debe S/0.
- **Pago consolidado**: probado en producción por el usuario — un pago de S/128 con un solo
  número de operación imputado 64+64 a dos comprobantes.
- **Log del Sistema**: mostraba `mockLogs`. Ahora lee las tres fuentes reales.
