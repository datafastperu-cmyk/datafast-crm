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

### 4. `auditoria_logs` sin política de retención
13 MB, de los cuales **24.670 filas (95%) son eco de peticiones HTTP** que escribe el
`AuditInterceptor` para cada request. Crece sin límite y nadie la recorta.

### 5. Tests que faltan
- Vista unificada del Log y su filtro de ruido: validados a mano contra la base real, sin
  test que lo fije.
- La emisión diaria por ciclo de cliente tiene tests de la política de fechas
  (`politica-facturacion.service.spec.ts`, 11 casos) pero no de la selección de a quién se
  emite cada día.

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

Con la configuración actual (día de pago 28, emisión 5 días antes) la primera emisión real
es **el día 23**. Verificación en seco disponible sin esperar: consultar qué abonados
emitirían cada día y con qué vencimiento y periodo.

### 10. "Solo registrar" no tiene red de seguridad
Cobra sin reactivar el servicio (baja voluntaria que salda su último comprobante). Si se
usa por error, **el abonado queda sin servicio hasta que una persona lo note**: ningún
watcher lo levanta ni avisa. Queda en auditoría con la marca `SIN reactivar servicio`.

---

## ✅ Cerrado (para no volver a levantarlo)

- **Corte indebido del 05/08** (James Pena): el cron medía la mora desde el alta del
  contrato y no respetaba prórrogas. Corregido y desplegado.
- **`deuda_total` desfasada** de Piero (S/64 mostrados vs S/128 reales): se corrigió sola
  con el pago consolidado; hoy debe S/0.
- **Pago consolidado**: probado en producción por el usuario — un pago de S/128 con un solo
  número de operación imputado 64+64 a dos comprobantes.
- **Log del Sistema**: mostraba `mockLogs`. Ahora lee las tres fuentes reales.
