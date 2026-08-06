# Plan de Implementación — Módulo de Cobranza

> Ejecución de [`cobranza-arquitectura.md`](./cobranza-arquitectura.md).
> Cada fase es **desplegable de forma independiente** y deja el sistema funcionando.
> Ninguna fase depende de que la siguiente llegue.

---

## Reglas de ejecución (aplican a todas las fases)

**R1 — Expand / Migrate / Contract.** Ninguna migración añade y borra en el mismo despliegue.
Primero se añade lo nuevo (nullable), luego se pobla, luego se escribe en ambos sitios, y el
borrado de lo viejo es un despliegue posterior — si es que llega. En cobranza, la fase
*contract* de `metodo_pago` **nunca se ejecuta** (se conserva como columna congelada de
auditoría).

**R2 — Escritura dual durante la transición.** Mientras coexisten los dos modelos,
`registrar()` escribe `metodo_pago` **y** `canal_pago_id`. El día que el backfill esté
completo y verificado, la lectura cambia de columna; la escritura sigue siendo dual.

**R3 — Toda migración tiene `down()` real y probado** contra una copia de producción en
staging. Una migración de dinero sin vuelta atrás no se despliega.

**R4 — Índices con `CONCURRENTLY`.** `pagos` es una tabla en escritura constante; un
`CREATE INDEX` bloqueante en horario de caja es un corte de cobranza. Y el índice nuevo se
crea **antes** de borrar el viejo, nunca al revés.

**R5 — Ninguna fase se da por terminada sin evidencia en producción.** No "compila y pasan
los tests": una consulta, un número, un caso real. Es la directriz de validación del proyecto
aplicada a la única tabla que no se puede recalcular.

**R6 — Backup verificado antes de cada migración de datos.** No el backup automático: uno
tomado a mano, restaurado en staging, y comprobado que la fase se puede deshacer sobre él.

---

## Mapa de fases

| Fase | Nombre | Riesgo | Migra datos | UI | Bloquea a |
|---|---|---|---|---|---|
| **F0** | Línea base y diagnóstico | Nulo | No | No | Todo |
| **F1** | Catálogos y backfill | **Alto** | **Sí** | No | F2, F5 |
| **F2** | Índice único e idempotencia | Medio | No | No | — |
| **F3** | **Frontera única** | Medio | No | No | F4, Etapa II |
| **F4** | Extorno | Medio | No | Sí (mínima) | F5 |
| **F5** | UI: Ajustes de Cobranza + formulario | Bajo | No | **Sí** | — |
| **F6** | Comisión, arqueo y reportes | Bajo | No | Sí | — |
| **F7** | Contrato del adaptador | Bajo | No | No | Etapa II |
| — | *Puerta de estabilidad (30 días)* | — | — | — | Etapa II |
| **F8** | Motor de cobro + `cobro_intento` | Medio | No | No | F9 |
| **F9** | MercadoPago migrado al adaptador | Medio | No | No | F10 |
| **F10** | Nuevos proveedores | Bajo | No | Sí | — |
| **F11** | Cobro presencial (POS/QR) | Medio | No | Sí | — |

**Camino crítico real: F0 → F1 → F3.** El resto admite reordenación según urgencia del
negocio. F3 es la fase que justifica el proyecto; si solo se hicieran F1 y F5, el módulo
quedaría más bonito e igual de frágil.

---

# ETAPA I

## F0 — Línea base y diagnóstico

**Por qué va primero:** si el invariante de contabilidad ya está roto hoy, hay que saberlo
**antes** de tocar nada. Si se descubre después de F1, va a parecer que lo rompió la
migración, y se perderán días buscando en el sitio equivocado. Y el mapeo de datos de F1 no
se puede diseñar sin saber qué valores existen realmente en producción.

**No cambia una sola línea de comportamiento.** Es solo mirar.

### Entregables

1. **Consulta de invariante**, ejecutada en producción:
   ```sql
   SELECT f.id, f.numero_completo, f.monto_pagado,
          COALESCE(SUM(pa.monto_aplicado), 0) AS aplicado
     FROM facturas f
     LEFT JOIN pago_aplicaciones pa ON pa.factura_id = f.id
    WHERE f.deleted_at IS NULL
    GROUP BY f.id
   HAVING ABS(f.monto_pagado - COALESCE(SUM(pa.monto_aplicado), 0)) > 0.01;
   ```
   Se espera que las filas anteriores a `pago_aplicaciones` diverjan (fecha de corte). Lo
   que importa es que **no diverja nada posterior**. Si diverge, hay un escritor clandestino
   activo y F3 sube de prioridad.

2. **Censo de valores reales:**
   ```sql
   SELECT metodo_pago, banco, COUNT(*), MIN(fecha_pago), MAX(fecha_pago)
     FROM pagos GROUP BY 1,2 ORDER BY 3 DESC;
   ```
   Esta salida **es** el insumo del mapeo de F1. Sin ella, el mapeo es adivinanza.

3. **Pagos sin aplicar:** `SELECT COUNT(*) FROM pagos WHERE estado='verificado' AND aplicado_en IS NULL;`

4. **Duplicados sospechosos de efectivo** (evidencia del hueco P1):
   ```sql
   SELECT cliente_id, monto, fecha_pago, COUNT(*)
     FROM pagos WHERE numero_operacion IS NULL
    GROUP BY 1,2,3 HAVING COUNT(*) > 1;
   ```

5. **Informe** con los cuatro números, versionado en `docs/`.

### Criterio de aceptación
Los cuatro resultados documentados con fecha. Si el punto 1 devuelve filas posteriores al
corte, **F1 no arranca**: primero se explica el origen (directriz de causa raíz).

### Rollback
No aplica.

---

## F1 — Catálogos y backfill  ✅ EJECUTADA (2026-08-06)

> **Riesgo revisado a la baja tras F0.** El plan la dimensionaba como *"la fase irreversible
> del proyecto"*, con backfill por lotes, canal `LEGACY` y verificación de suma total. El
> diagnóstico midió **2 pagos en total**: nada de eso hizo falta.
>
> **Hallazgo que cambió el diseño:** ya existían dos catálogos vivos —`formas_pago_isp`
> (auto-sembrado con `Efectivo`, `Transferencia`, `Depósito`) y `bancos_isp` (auto-sembrado
> con `Banco 01`)— servidos por `/facturacion-config/*` y consumidos por
> `finanzas/registro`. **Son la causa raíz de H2 y H3**, no un operador despistado: ese
> formulario manda el *rótulo* del catálogo como `metodoPago`, y autoselecciona el primer
> banco de la lista enviándolo siempre, incluso en efectivo.
>
> Y son la razón de que hubiera dos verdades: `RegistrarPagoForm.tsx` habla el enum de
> dominio en minúsculas y `finanzas/registro` habla estos catálogos. Los canales de banco se
> **tradujeron** desde `bancos_isp` — no se perdió configuración del operador.
>
> Los catálogos legados siguen sirviendo su formulario hasta F5, que los retira. La
> duplicación queda declarada en `canal-pago.service.ts` con qué hay que tocar en los dos
> sitios si cambia el mapeo.

**Resultado en producción:** 8 canales, 2 cajas (`Caja Principal`, `Caja Campo`), **0 pagos
sin canal**, y los dos pagos existentes ya dicen dónde está su dinero. El pago en efectivo
que arrastraba `banco = 'Banco 01'` se resolvió a `Oficina` ignorando el banco espurio.

Las cuentas bancarias reales (número, CCI, titular) **no se sembraron**: las carga el
operador. Inventarlas sería lo contrario de la directriz de "implementación desde cero".

### Contenido original de la fase (referencia)

### Migraciones

| # | Migración | Contenido |
|---|---|---|
| 038 | `CreateFormaPago` | Tabla `forma_pago` sembrada con la taxonomía cerrada (§2.2), incluida `nota_credito` |
| 039 | `CreateCanalPago` | Tabla `canal_pago` con FK a forma, `cuenta_receptora_default_id`, `requiere_numero_operacion`, `requiere_voucher`, `comision_*`, `permite_registro_manual`, `activo`. Índice único `(empresa_id, codigo)` |
| 040 | `ExtenderCuentasBancariasAReceptoras` | Añade `tipo`, `nombre`, `cajero_responsable_id`, `requiere_arqueo` a `cuentas_bancarias`; `banco` y `numero_cuenta` pasan a nullable |
| 041 | `AddEjesCobranzaAPagos` | Añade a `pagos`: `canal_pago_id`, `cuenta_receptora_id`, `comision`, `monto_neto` — **todos nullable**. `metodo_pago` intacto |
| 042 | `SeedCatalogosCobranza` | Siembra canales y cuentas por empresa a partir del censo de F0 |
| 043 | `BackfillCanalPagoEnPagos` | Mapeo `metodo_pago`+`banco` → `canal_pago_id`. Lo no mapeable va a canal `LEGACY_<forma>` |

### Código

- Entidades nuevas + extensión de `CuentaBancaria` (`pago.entity.ts:180`).
- `pagos.service.ts registrar()`: escritura dual (R2). Si el DTO trae `canalPagoId` lo usa y
  deriva `metodo_pago` para compatibilidad; si trae `metodoPago` (API antigua) resuelve el
  canal. **El endpoint viejo sigue funcionando** — hay un formulario en producción.
- DTO: `canalPagoId` y `cuentaReceptoraId` opcionales en esta fase.

### Escenarios pesimistas de esta fase

| Riesgo | Defensa |
|---|---|
| El backfill deja pagos sin canal | Migración verifica al final: `SELECT COUNT(*) FROM pagos WHERE canal_pago_id IS NULL` y **falla la migración** si es > 0. Nunca "casi todos" |
| Un valor de `metodo_pago` no previsto aparece entre F0 y el deploy | Canal `LEGACY_<forma>` como destino garantizado. Nunca NULL, nunca inventar |
| La migración tarda y bloquea la tabla | `UPDATE` por lotes con `LIMIT`, no una sola sentencia sobre toda la tabla |
| Deploy a medias: backend viejo con esquema nuevo | Columnas nullable ⇒ el backend viejo sigue funcionando. Es el motivo de R1 |

### Criterio de aceptación
- Cero pagos sin `canal_pago_id`.
- Suma total de `monto` antes y después de la migración: **idéntica al céntimo**.
- Recuento por canal contrastado a mano contra el censo de F0.
- Un pago registrado por el formulario viejo, en producción, escribe ambas columnas.

### Rollback
`down()` elimina las columnas añadidas y las tablas nuevas. `metodo_pago` nunca se tocó, así
que el sistema vuelve intacto. **Este es el motivo de conservarla.**

---

## F2 — Índice único e idempotencia del efectivo

Cierra P1 y P5. Independiente de la UI.

### Migraciones
| # | Migración | Contenido |
|---|---|---|
| 044 | `ReanclarUniqueOperacionACanal` | `CREATE UNIQUE INDEX CONCURRENTLY` sobre `(empresa_id, canal_pago_id, numero_operacion) WHERE numero_operacion IS NOT NULL`; **después** `DROP` del índice por `metodo_pago` |
| 045 | `AddIdempotencyKeyAPagos` | `idempotency_key` + índice único `(empresa_id, idempotency_key)` |

**Ojo con 044:** si el backfill de F1 agrupó valores que antes eran distintos, la creación del
índice puede fallar por duplicados preexistentes. Se ejecuta primero como consulta de
detección; si aparecen colisiones, se resuelven a mano **antes** de crear el índice — nunca
relajando la restricción.

### Código
- El frontend genera un UUID por apertura del formulario de cobro y lo envía en cada intento.
- `registrar()`: si la clave ya existe, **devuelve el pago existente con 200**, no un error.
  Un doble clic no es un fallo del cajero, es un fallo de la red o del ratón.
- Se documenta en el código la asimetría deliberada entre el guard (más estricto) y el índice
  (red de concurrencia), §2.7.

### Criterio de aceptación
Test que dispara dos `registrar()` concurrentes con la misma clave y verifica **una sola fila**
y dos respuestas 200 idénticas. Nombrado por su motivo: *"doble clic en caja de efectivo — el
efectivo no tiene nº de operación"*.

---

## F3 — Frontera única

**La fase que justifica el proyecto.** Sin UI, sin migraciones, y es la de mayor valor.

### Trabajo

1. **`facturacion.service.ts:665 aplicarPago()` deja de ser público.** No se reescribe — el
   UPDATE condicional atómico es correcto. Se encapsula: pasa a ser invocable solo desde el
   flujo de pagos. Toda llamada externa se elimina o se reencauza.
2. **`adelantos.service.ts:197`**: su `UPDATE facturas ... 'pagada'` se sustituye por una
   llamada al mismo aplicador. Deja de ser un escritor paralelo.
3. **Notas de crédito**: pasan a registrarse como pago de forma `nota_credito`.
4. **`marcarVencidas()`**: se documenta como excepción legítima y declarada. Sin ese
   comentario, alguien la va a "corregir" en la primera limpieza.
5. **Test de frontera**, nombrado por el incidente: *"la factura solo la mueve el flujo de
   pagos — tres escritores paralelos, 2026-08"*. Falla si otro módulo importa el aplicador.
6. **Cron de invariante** (la consulta de F0) con alerta si devuelve filas posteriores al
   corte.

### Escenario pesimista propio
Reencauzar adelantos y notas de crédito toca dos flujos vivos. **Se despliega por separado**:
primero el aplicador encapsulado + adelantos, se observa una semana, después notas de crédito.
No los dos a la vez — si algo cuadra mal, hay que saber cuál fue.

### Criterio de aceptación
- El invariante da cero divergencias posteriores al corte durante **7 días** (los 30 días son
  la puerta de la Etapa II, no de esta fase).
- El test de frontera falla al reintroducir una llamada externa a propósito. **Verificado a
  mano**, no asumido: un test de frontera que no se ha visto fallar no es un test de frontera.

---

## F4 — Extorno

Va **después** de F3 a propósito: si se construyera antes, el extorno sería un cuarto escritor
directo de facturas y habría que rehacerlo.

### Migración
| # | Contenido |
|---|---|
| 046 | Valor `extornado` en `EstadoPago`; tabla `pago_extorno` (motivo tipificado, usuario, nota, timestamp, valores previos); `revision_cobranza` en el estado del contrato |

### Código
- `extornar(pagoId, motivo, nota)` — reemplaza a `eliminar()`, que pasa a rechazar siempre.
- TX atómica: marcar → revertir cada `pago_aplicaciones` con el aplicador → **recalcular** el
  estado del comprobante desde `SUM(pago_aplicaciones)` (nunca restando) → auditar antes del
  commit → encolar revisión fuera de la TX.
- **Sin corte automático** (§4.4). El contrato queda en `revision_cobranza`.
- Consolidado: extorno todo-o-nada.
- Extorno de pago conciliado: exige `cobranza.extornar_conciliado` + nota obligatoria.

### Criterio de aceptación
- Test: extornar dos veces seguidas deja el mismo estado final (idempotencia por
  recálculo, P9).
- **Un extorno real en producción, revisado a mano de punta a punta**: factura, saldo,
  contrato, auditoría y arqueo.

---

## F5 — UI: Ajustes de Cobranza y formulario en cascada

### Backend
- CRUD de catálogos con baja lógica (nunca DELETE).
- Permisos nuevos (§8.2) vía migración de permisos — el proyecto ya tiene el patrón
  (`1791800000031-AddPermisoMapaClientes`).
- Endpoint de canales por forma, con la cuenta sugerida resuelta en el servidor. **La cascada
  no se calcula en el navegador**: si la regla vive en el frontend, el portal y la app móvil
  van a tener otra.

### Frontend
- `finanzas/ajustes-cobranza` con las tres pestañas.
- `RegistrarPagoForm.tsx`: cascada forma → canal → cuenta, campos condicionales por
  `requiere_*`, cuenta editable solo con permiso.
- Un canal cuya cuenta por defecto esté inactiva **no se ofrece** a quien no puede cambiarla:
  no se muestra un camino que termina en error.
- Lectura del histórico: muestra el canal aunque esté inactivo.

### Criterio de aceptación
Un cobro completo de cada forma de pago ejecutado en producción por un cajero real, y el
dinero localizado en su cuenta receptora. Es la primera vez que el ERP puede responder *"¿dónde
está ese dinero?"*.

---

## F6 — Comisión, arqueo y reportes

| Entregable | Detalle |
|---|---|
| Comisión | `monto` (bruto) salda la factura, siempre; `monto_neto` es lo que se busca en el extracto. Asiento de gasto en `finanzas-opex` |
| Arqueo | Cierre por cuenta y responsable, con diferencia declarada y auditada. Una caja que cuadra sola no es una caja |
| Reportes | `reportes.service.ts:79` migra del eje `metodo_pago` al eje **canal** (§7.2) |
| Conciliación | Se cierra el flujo sobre `conciliado` / `extractoBancoRef`, ya presentes en el esquema |

### Criterio de aceptación
**Un cierre de caja mensual cuadrado sin ajustes manuales.** Ese es el número, no la
existencia de la pantalla.

---

## F7 — Contrato del adaptador de cobro

Sin implementar ningún proveedor. Cierra la Etapa I.

- Interfaz del adaptador devolviendo `ResultadoOperacion`
  (`common/domain/resultado-operacion.ts`), nunca excepciones HTTP.
- `indeterminado` obligatorio ante timeout.
- **Contrato de idempotencia**: el ID de transacción del proveedor va a `numeroOperacion`. Se
  fija aquí, no en cada integración.
- **Validación**: se escribe sobre el papel la implementación para MercadoPago (que ya está
  en producción) sin desplegarla. Si la interfaz no absorbe el único proveedor real que
  existe, la interfaz está mal y se corrige ahora — no cuando haya tres.

---

## 🚧 Puerta de estabilidad — no negociable

La Etapa II **no arranca** hasta que se cumplan los cinco hechos, medidos, no estimados:

1. Invariante de contabilidad: cero divergencias durante **30 días corridos** en producción.
2. Test de frontera en CI, y verificado a mano que falla al introducir una regresión.
3. Un extorno real ejecutado y revisado de punta a punta.
4. Un cierre de caja mensual cuadrado sin ajustes manuales.
5. Cero pagos con `aplicado_en IS NULL` de más de 15 minutos en el período.

Adelantar la Etapa II sin esto significa construir integraciones sobre una frontera que no se
ha demostrado. Cada proveedor que se sume multiplica el coste de descubrir después que la
base no aguantaba.

---

# ETAPA II

## F8 — Motor de cobro y `cobro_intento`

Se construye **antes** que cualquier adaptador. Es la pieza que hace que un cobro en línea
sea auditable.

- Tabla `cobro_intento`: `iniciado → pendiente → {aprobado | rechazado | expirado | indeterminado}`.
- El motor orquesta y **nunca registra**: al aprobar, invoca el flujo de pagos.
- **Conciliador de intentos no resueltos** (P6): consulta al proveedor los intentos en
  `pendiente`/`indeterminado` pasado un umbral. Sin él, hay dinero cobrado al abonado que el
  ERP nunca sabrá — y ese caso no lo reporta un log, lo reporta el cliente semanas después.
- Módulo degradable desde el primer commit (`OnModuleInit` + probe + `moduleHealth`), según
  la regla del proyecto. **La caja manual nunca depende de él** (Core Indestructible).

## F9 — MercadoPago migrado

Primer adaptador real, y prueba del contrato de F7. Se despliega en **escritura paralela**: el
flujo nuevo corre junto al viejo y se comparan resultados antes de retirar el antiguo. Es la
integración que ya cobra dinero real; no se sustituye a ciegas.

## F10 — Nuevos proveedores

Niubiz, Izipay, Culqi. Cada uno es un adaptador y **cero cambios** en la lógica de negocio.
Si un proveedor obliga a tocar el flujo de pagos, el contrato de F7 estaba incompleto y se
corrige ahí, no en el adaptador.

## F11 — Cobro presencial

POS / QR / NFC. Depende del contrato y del motor; no aporta arquitectura nueva.

---

## Secuencia recomendada

```
F0 ──► F1 ──► F2 ──┐
        │          ├──► F5 ──► F6
        └──► F3 ──► F4 ──┘
                     │
                     └──► F7 ──► [puerta 30d] ──► F8 ──► F9 ──► F10 ──► F11
```

**F2, F5 y F6 pueden reordenarse** según lo que pida el negocio. **F0 → F1 → F3 → F4 no.**

Si hay presión por mostrar avance visible pronto, la tentación va a ser adelantar F5 (la
pantalla nueva). Se puede, pero con el coste declarado: un formulario nuevo sin F4 significa
que un error de captura con el modelo nuevo no se puede deshacer bien. Si se adelanta, que sea
una decisión tomada, no un descuido.

---

## Lo primero que hay que hacer

Ejecutar las cuatro consultas de **F0** contra producción. Son de solo lectura, tardan
segundos, y sus resultados pueden cambiar el orden de todo lo demás — en particular, si el
invariante ya está roto hoy, F3 deja de ser la tercera fase y pasa a ser la primera.
