# PLAN-001 — Plan de Trabajo

**Versión** 1.0 · **Fecha** 2026-08-06 · **Estado** Vigente
**Naturaleza:** documento **temporal y operativo**. Se actualiza al cerrar cada fase y **se
declara Obsoleto cuando el plan termina**. No es normativo.

---

## Por qué existe

Se abrieron muchos frentes en poco tiempo: cuatro cuerpos documentales, 30 ADR, 20 desviaciones
registradas, 43 recomendaciones evaluadas y once decisiones pendientes. **Cada pieza es correcta;
el conjunto es inmanejable sin un orden.** Este documento es ese orden.

---

## 1. Dónde estamos

### Cerrado y verificado

| Qué | Evidencia |
|---|---|
| **Desviación A-2** — reescritura masiva de WiFi en migraciones | Columna `origen` + guard en ambos barridos + pre-flight + 4 tests. `tsc` limpio, 65 suites / 593 tests en verde |
| Corrección: el barrido peligroso es el de **2 minutos**, no el de 03:30 | 8 documentos corregidos |
| Corrección: **el CI ya existía** y la suite compila | 9 documentos corregidos. Desviación B-9 retirada |
| Cuerpo documental base | 44 documentos, en GitHub |

### Abierto

| Categoría | Cantidad |
|---|---|
| Decisiones esperando al propietario | **11** |
| Desviaciones nivel A (crítico) | **3** |
| Desviaciones nivel B / C | 10 / 7 |
| Trabajo técnico en RDM-001 | R2…R15, R17 |
| Trabajo documental (poda, adopciones) | 2 bloques |
| **Sin desplegar en producción** | **La migración `origen`** |

---

## 2. Las reglas de este plan

Para que no vuelva a dispersarse:

| # | Regla |
|---|---|
| 1 | **No se abre un frente nuevo hasta cerrar el anterior** |
| 2 | **Todo documento nuevo declara qué documento cierra, sustituye o reduce.** Si no reduce nada, no se escribe |
| 3 | **Las decisiones se agrupan.** No se pide una decisión suelta a mitad de un trabajo técnico |
| 4 | Cada fase termina con **evidencia verificable**, no con "hecho" |
| 5 | Si aparece un hallazgo que cambia el plan, **se registra y se sigue** — no se cambia de rumbo a mitad |

---

## 3. Las fases

### FASE 0 — Cerrar lo que ya está hecho · *0 decisiones nuevas*

Ya autorizado. Solo falta ejecutarlo.

| # | Tarea | Verificación |
|---|---|---|
| 0.1 | Desplegar backend con la migración `origen` | `pm2 list` sin bucle de reinicio · `GET /status` con versión correcta |
| 0.2 | Ejecutar el pre-flight | `GET /olt-nativo/ztp/preflight-migracion` → `seguro: true`, todo el parque en `origen = erp` |

> **Por qué va primero:** el código está en `main` y **la columna no existe en producción**. Esa
> asimetría entre esquema y código desplegado es exactamente la que causó el incidente de las 11
> horas. El paso 0.2 es además la primera comprobación real de que la suposición de la migración
> era cierta.

---

### FASE 1 — Una sola sesión de decisiones · *tuyo*

**Las once decisiones juntas, con recomendación para cada una.** Puedes aceptarlas en bloque y
corregir solo las que quieras cambiar.

| # | Decisión | Recomendación | Si se acepta, desbloquea |
|---|---|---|---|
| **D1** | **Ownership** (R-009) | Propietario del producto = tú · Arquitecto = tú, con mi apoyo. Rellenar el campo en los 21 documentos | R-003, R-012, R-032, R-033 y todo el gobierno |
| **D2** | **Ratificar CON-001** §8.3 Visión, §8.4 Misión, §8.5 Valores | Leerlas y ratificarlas o corregirlas. Están derivadas de decisiones reales del sistema | CON-001 pasa a Vigente |
| **D3** | **Marco normativo** (ADR-029) | **D primero** (cumplimiento legal), **luego C** (adopción selectiva declarada). **Descartar B** (certificación formal) | R-036, R-016, H2-1 |
| **D4** | **Referencia por tipo de módulo** (ADR-030 reencuadrado) | Adoptar **la tabla de 6 referencias**, no SID entero. TM Forum como una de seis | La política de construir-vs-adoptar |
| **D5** | **R-001 / R-004** construir-vs-adoptar | Adoptar, **con el guard**: adoptar conocimiento externo ≠ adoptar código; ningún invariante propio se elimina sin ADR | Que ningún módulo empiece de cero por defecto |
| **D6** | **R-011** roadmap arquitectónico | **Uno solo** con presupuesto arquitectónico explícito y protegido. No dos roadmaps | Que el trabajo estructural no se posponga siempre |
| **D7** | **R-036** protección de datos personales | **Sí, y es el más urgente.** Con asesoría legal | R-037; cierra exposición real |
| **D8** | **R-037** entorno de pruebas | Definir el alcance mínimo asumible: qué con laboratorio, qué simulado, qué en producción con precauciones | Reduce el riesgo de todo lo demás |
| **D9** | **R-038** fin de vida de dependencias | Sí. Es barato | Plan de contingencia para `whatsapp-web.js`, GenieACS, licencias |
| **D10** | **R-041** gestión de capacidad | Sí. Es barato | Umbrales de cuándo escalar |
| **D11** | **ADR-019** destino del cálculo de deuda | Servicio de dominio **si** todos los escritores pasan por la aplicación; función de BD si no. **Verificarlo antes de decidir** | Desviación A-4 |

**Salida de la fase:** los ADR 029, 030 y 019 pasan de *Propuesta* a *Aceptada*; el campo
"Revisores" deja de estar vacío; CON-001 queda ratificado.

---

### FASE 2 — Poda del corpus · *sin decisiones, reduce documentación*

Es la fase que hace mantenible todo lo demás. **Ningún documento nuevo: solo se congela, fusiona o
marca.**

| # | Tarea | Efecto |
|---|---|---|
| 2.1 | **Congelar** `docs/archivo/auditoria/` y `docs/archivo/consolidacion/` como evidencia fechada | Dejan de mantenerse. Ya contenían 3 afirmaciones falsas |
| 2.2 | **Resolver la duplicación** `docs/archivo/directrices/` ↔ POL-001 | Hoy hay dos fuentes para las mismas reglas — lo que R-006 prohíbe |
| 2.3 | Marcar qué documentos **se generan del código** y cuáles se escriben a mano | Los inventarios (módulos, endpoints, tablas, crons, tests) se extraen en un minuto. Generados no mienten; escritos mienten en seis meses |
| 2.4 | Aplicar las **14 adopciones de Fase 1 de REC-001** a POL-001, CON-001, EST-001 y GUI-001 | Incorpora tus recomendaciones a la norma |
| 2.5 | Declarar **REC-001 Obsoleto** al terminar 2.4 | Un documento de recomendaciones que sobrevive a las políticas que generó crea dos verdades |

**Salida:** un cuerpo normativo de ~12 documentos vivos, el resto congelado o generado.

---

### FASE 3 — Cerrar las desviaciones críticas · *técnico*

En este orden, por relación seguridad/coste:

| # | Desviación | Trabajo | Decisión previa |
|---|---|---|---|
| ~~3.1~~ | ~~**A-3** — el worker puede morir en silencio~~ | **CERRADA 2026-08-07** — ver §3.1 más abajo | ADR-020 **aceptado** |
| ~~3.2~~ | ~~**A-4** — la deuda se calcula en 4 sitios~~ | **CERRADA 2026-08-08** — ver §3.2 más abajo | **D11** resuelto · ADR-019 **aceptado** |
| ~~3.3~~ | ~~**A-1** — aislamiento multi-tenant por convención~~ | **RETIRADA 2026-08-08** — no corregida: **su premisa era falsa**. Ver §3.3 | **ADR-031** (D12) |

**Salida:** cero desviaciones de nivel A. Es el hito que más cambia el perfil de riesgo del ERP.

> **Alcanzada el 2026-08-08 — pero no como estaba previsto.** A-2, A-3 y A-4 se cerraron
> corrigiendo el defecto. **A-1 se retiró comprobando que su premisa era falsa**: asumía que el
> ERP alojaría varias empresas, y nadie lo había verificado. Es un resultado legítimo, y más
> barato que la fase que se había planificado para ella.
>
> **Queda B-15 como el hallazgo serio que deja esta fase**, y no es de nivel A por clasificación
> sino por consecuencia: la aplicación se conecta a PostgreSQL como superusuario.

#### 3.3 — RETIRADA 2026-08-08 · A-1 (la premisa era falsa)

> **Desenlace, escrito después de todo lo que sigue.** A-1 llevaba semanas clasificada como
> crítica y tenía una fase entera asignada. **No se corrigió: se comprobó que su premisa era
> falsa.** El propietario confirmó que el ERP es **mono-empresa por diseño** — una instalación,
> una empresa; otro operador, otra instalación desde cero (**ADR-031**, decisión D12).
>
> Sin una segunda empresa posible **no puede haber fuga entre empresas**. La desviación se retira,
> el objetivo de RLS desaparece, y el barrido sale del CI el mismo día que entró. Para que la
> decisión se sostenga sola, la base la impone: índice único `unica_empresa_por_instalacion`.
>
> **Lo que queda vivo de esta fase es B-15**, que no depende de la multi-tenancy en absoluto.
>
> Lo que sigue se conserva porque documenta **por qué RLS no funciona aquí**, y eso es lo que
> evita que alguien lo reintente dentro de seis meses creyendo que lo resuelve.

**La medición impidió construir una falsa garantía.** El plan decía «RLS en PostgreSQL + barrido en
CI». Antes de escribir la migración se comprobó si RLS podía siquiera aplicarse:

```
Usuario de la app : datafast_db_user
Privilegios       : rolsuper: true, rolbypassrls: true
Tablas en public  : 111 | DUEÑA de: 111
```

PostgreSQL exime del sistema de seguridad por filas a los superusuarios, a los roles con
`BYPASSRLS` y al dueño de la tabla. **La aplicación cumple las tres.** `ALTER TABLE … ENABLE ROW
LEVEL SECURITY` habría devuelto `ALTER TABLE` sin error y filtrado **cero filas** — y este corpus
tendría escrito que el aislamiento está garantizado. Es ADR-001 (VIO) aplicado a nosotros.

| Entregado | |
|---|---|
| `backend/scripts/barrido-aislamiento.mjs` | Análisis estático con clasificación: de **492** sentencias sobre tablas de empresa, **20 ABIERTAS · 171 TRANSITIVAS · 13 GLOBALES** |
| **ADR-017** | Registra por qué RLS no funciona aquí y la secuencia obligatoria para que funcione |
| **Desviación B-15** | La app se conecta a PostgreSQL **como superusuario**. Estaba oculta detrás de A-1 y es explotable por sí sola |

**Por qué el barrido informa y todavía no rompe el build:** una barrera que se estrena con 204
hallazgos sin triar es lo primero que alguien desactiva. La cifra accionable es **20**.

**Y las peligrosas no son esas 20, son las 171 transitivas** — acotadas por `cliente_id`,
`contrato_id`… y seguras *solo si* ese identificador se validó más arriba. El análisis estático no
puede resolverlo. Es el incidente de `crm-nativo` (30/07): *«con un chatId ajeno, cualquier usuario
con sesión válida se llevaba la conversación completa»*, y la consulta parecía correcta.

**Lo que NO se hizo, y es deliberado:** quitarle `SUPERUSER` y `BYPASSRLS` al rol de base de datos.
Su modo de fallo es que al ERP le falte un permiso **en producción**, y exige inventario de
privilegios, `GRANT` mínimo y prueba sobre una instalación limpia. **Es decisión del propietario.**

**Mitigación actual, y su fecha de caducidad:** esta instalación tiene **una sola empresa**, así que
hoy no hay entre quién filtrar. Es circunstancial, no de diseño, y **desaparece con el primer
cliente multi-empresa** — justo cuando nadie estará mirando esto.

#### 3.1 — CERRADA 2026-08-07 · A-3, y de paso B-12 y B-13

**Lo primero fue medir, y la medición corrigió el diagnóstico.** A-3 decía que el latido existía
pero era «consultable, no vigilante». La realidad: **de 47 jobs programados latían 10**, y 26 de
los 29 `@Cron` no tenían `name:`, así que NestJS les asignaba un UUID distinto en cada arranque.

| Entregado | |
|---|---|
| `common/services/cron-latido.service.ts` | El latido se **deriva** de estar en el `SchedulerRegistry`. De 10/47 a 47/47, y el cron nº 48 lo hereda |
| `common/services/latido-vigilante.service.ts` | Corre donde `RUN_CRONS !== 'true'`: el que responde denuncia al que no late |
| `cron-nombres.barrera.spec.ts` | Falla si un `@Cron` no declara `name:` o lo duplica |
| 26 `@Cron` nombrados · `pagos` desenvuelto | El wrapper manual sobraba: una sola mecánica |
| `scripts/lib/pm2-recargar.sh` | Definición **única** de recargar y verificar. `update.sh` dejó de tener su copia; los cuatro scripts de despliegue la adoptan (**B-12**, **B-13**) |

**Verificado:** `tsc` limpio · suite 68/68 · 610 tests (17 nuevos). Las dos suites que fallaron en
la pasada completa (`dominios`, `wa-client.qr-corte`) pasan en aislado: era presión de recursos de
la máquina, no regresión.

**Lo que NO se entregó, y por qué:** la *segregación del plano automático por criticidad* que el
título original de ADR-020 contemplaba. Decidirla exige saber cuánto dura cada cron — dato que
**este trabajo acaba de empezar a registrar**. Se traslada a ADR-027 para tomarla sobre medidas y
no sobre intuición. El cap por cron va con ella.

**Hallazgo colateral → desviación B-14:** `installer/scripts/08-pm2.sh` genera un
`ecosystem.config.js` que contradice al del repositorio (un solo `datafast-backend` en `cluster`,
sin `RUN_CRONS`). **Una instalación nueva nace sin worker.** Fuera del alcance de 3.1; registrado,
no arreglado.

#### 3.2 — CERRADA 2026-08-08 · A-4

**D11 se resolvió midiendo, no eligiendo.** Su criterio era *«si algún escritor no pasa por la
aplicación, va en la base»*. La medición: `facturas.saldo` es una columna
**`GENERATED ALWAYS AS (total - monto_pagado) STORED`** — el único escritor ajeno a la aplicación ya
está en la base y **es inviolable** (el trigger que intentaba asignarla se eliminó en 2026 por
chocar con ella). La agregación no tiene ningún escritor externo. **→ servicio de dominio.**

**El defecto real, que no era el que la ficha describía:**

`pago.repository.calcularDeudaContrato` sumaba `WHERE f.contrato_id = $1`. El comprobante de este
ERP es **consolidado por cliente** (`contrato_id` en NULL), así que devolvía **cero** para abonados
que sí debían — y su consumidor usaba ese cero para **reactivar el servicio de un moroso**. Es el
mecanismo del incidente 2026-08-04, que se corrigió en `cobranza.worker` y **dejó esta segunda
puerta sin tocar**. El punto 3 del checklist de PD-03 —«¿dónde más ocurre lo mismo?»— sin ejecutar.

| Entregado | |
|---|---|
| `facturacion/domain/estados-con-saldo.ts` | Una definición. Eran **21 escrituras a mano** con tres variantes: `en_cobranza` era deuda para el cobro nocturno y no para el resumen financiero |
| Barrera en `estados-con-saldo.spec.ts` | Falla si alguien vuelve a teclear la lista |
| `DeudaPorContratoModule` | Módulo propio, sin dependencias — mismo patrón que `AdelantosModule`, extraído en su día por esta razón |
| **Un solo escritor** de `contratos.deuda_total` | Eran 4. `reactivarPorPago` escribía `= 0` sin mirar una factura |
| Eliminados `contratos.actualizarDeuda` y `pago.repository.calcularDeudaContrato` | Las dos puertas por las que se podía escribir deuda sin respaldo documental |
| Migración `1791800000046` | `v_resumen_financiero` recupera `en_cobranza`; **se borra** `fn_calcular_deuda_contrato` (cero consumidores, definición divergente) |

**Lo que NO se hizo, y está registrado:** eliminar `contratos.deuda_total`. Un modelo contable
estándar no la tendría —la deuda se deriva de los apuntes abiertos—, y las cuatro implementaciones
eran el síntoma de almacenar algo que debería calcularse. **DOM-001 §8.9.1** lo registra como deuda
de modelo y lo hace entrada obligatoria del ADR de benchmark financiero (PD-11) antes de H2-1.

**Sin verificar aún:** cuántos contratos tienen hoy un `deuda_total` que no cuadra con sus facturas.
La corrección impide el desajuste nuevo, **no repara el existente**.

---

### FASE 4 — Brechas estructurales · *técnico*

| # | Trabajo | Por qué en este orden |
|---|---|---|
| 4.1 | **R8** — observabilidad mínima (colas, edad del outbox, latido, duración de crons) | Multiplicador: sin medir no se verifica que 3.1 funcionó |
| ~~4.2~~ | ~~**R7** — entidades para las tablas de coordinación y dinero~~ | **HECHA 2026-08-08.** Seis entidades: el outbox de red, la saga y sus pasos, el lock FTTH, el arqueo y el extorno. Sin cambiar el camino de acceso — el reclamo atómico y la adquisición del lock siguen siendo una sola sentencia a propósito. Barrera nueva `metadatos-typeorm.spec.ts`, que **construye los metadatos de TypeORM**: es la operación que falla al arrancar en frío, y probada rompiendo una entidad a propósito |
| 4.3 | **R9** — dividir el controlador de `olt-nativo` por grupo funcional | Sin cambiar rutas. Reduce conflictos y hace legible el módulo |
| 4.4 | **R6** — modelar el cambio de ONU (ADR-022) | Operación rutinaria que hoy se improvisa como baja + alta |
| 4.5 | **R5** — extender garantías al plano MikroTik (ADR-021, ADR-028) | El trabajo más grande de esta fase |

---

### FASE 5 — Brechas funcionales · *producto*

Solo cuando las fases 0–3 estén cerradas. Orden según RDM-001 §8.4 y las puertas de §8.7.

| Prioridad | Trabajo | Puerta |
|---|---|---|
| 1 | **SUNAT / facturación electrónica** | Aplicar D5: es dominio maduro, se adopta modelo |
| 2 | Migraciones SmartOLT y MikroWISP | Pre-flight obligatorio (ya desbloqueadas por A-2) |
| 3 | Motor de cobro + pasarelas | **Puerta de estabilidad de 30 días** (ADR-013) |
| 4 | Inventario · SMS · Planta externa fases 2-3 | Decisión de producto |

---

## 4. Qué necesito de ti, y cuándo

| Momento | Qué |
|---|---|
| **Ahora** | Autorizar Fase 0 (ya lo hiciste — falta ejecutarlo) |
| **Una sola vez** | Las 11 decisiones de Fase 1. Puedes aceptar el bloque y corregir lo que quieras |
| **Al final de cada fase** | Confirmar que seguimos, o cambiar el orden |

**El resto no requiere decisiones tuyas.** Fases 2, 3 y 4 son ejecución con las decisiones ya
tomadas.

---

## 5. Registro de decisiones — **FASE 1 CERRADA, 2026-08-06**

Decididas por **Datafast**, propietario del producto.

| # | Decisión | Resolución | Dónde queda registrada |
|---|---|---|---|
| **D1** | Ownership | **Propietario del producto = Datafast** | CON-001 §2 |
| **D2** | Ratificar CON-001 | **Ratificada sin modificaciones.** CON-001 pasa a **Vigente** | CON-001 §2.1 |
| **D3** | Marco normativo | **Certificación descartada** · **adopción selectiva aceptada** · **programa legal SUSPENDIDO**, con excepción: *cuando implique el diseño de un módulo, se define en ese momento* | ADR-029 §6 |
| **D4** | Referencia por tipo de módulo | **Aceptada** la tabla de 6 referencias; no SID entero | ADR-030 (**pendiente de reescritura**) |
| **D5** | Construir-vs-adoptar | **Aceptada con el guard**: adoptar conocimiento ≠ adoptar código; ningún invariante propio se elimina sin ADR | POL-001 (Fase 2.4) |
| **D6** | Roadmap | **Uno solo** con presupuesto arquitectónico explícito y protegido | RDM-001 (Fase 2.4) |
| **D7** | Protección de datos personales (R-036) | **Sí.** Alcance **técnico activo**; alcance **legal suspendido** por D3 | ADR-029 §6.2 |
| **D8** | Entorno de pruebas (R-037) | **Aceptada** — definir alcance mínimo asumible | Fase 2.4 |
| **D9** | Fin de vida de dependencias (R-038) | **Aceptada** | Fase 2.4 |
| **D10** | Gestión de capacidad (R-041) | **Aceptada** | Fase 2.4 |
| **D11** | Destino del cálculo de deuda | **Aceptada**: verificar los escritores **antes** de decidir función de BD vs servicio de dominio | ADR-019, Fase 3.2 |

### 5.1 La regla que salió de D3 — la más valiosa de la sesión

> **Cuando un módulo nuevo toque materia regulada, el marco legal aplicable se define ANTES de
> diseñarlo, no después.**

Es mejor que el programa de cumplimiento que sustituye: evita mantener un programa que hoy nadie
sostendría, y evita el fallo real —diseñar un módulo y descubrir después que la norma exigía otra
estructura de datos—. **Afecta directamente a H2-1 (facturación electrónica SUNAT)**: el marco se
define antes del diseño, porque determina el modelo, no solo la integración.

### 5.2 Interpretación de D3 + D7 — **confirmar si es incorrecta**

D7 aprueba la política de datos personales y D3 suspende lo legal. Se interpretan como
complementarias:

| Parte | Estado | Por qué |
|---|---|---|
| **Técnica**: retención por tabla, anonimización en respaldos y entornos de prueba, quién accede a datos sensibles, registro de accesos | **ACTIVA** | Son decisiones de ingeniería; no requieren abogado |
| **Legal**: base de tratamiento, derechos del titular, plazos normativos | **SUSPENDIDA** | Hasta que un módulo la exija (§5.1) |

---

## 6. Registro de avance

| Fase | Estado | Cerrada |
|---|---|---|
| **0 — Cerrar lo hecho** | **✅ CERRADA** — migración desplegada y pre-flight en verde | **2026-08-06** |
| **1 — Decisiones** | **✅ CERRADA** — las 11 decididas por Datafast | **2026-08-06** |
| **2 — Poda del corpus** | **✅ CERRADA** | **2026-08-06** |
| 3 — Desviaciones críticas | **Desbloqueada** — siguiente | — |
| 4 — Brechas estructurales | No iniciada | — |
| 5 — Brechas funcionales | No iniciada | — |

### 6.1 Evidencia de la Fase 0

| Comprobación | Resultado |
|---|---|
| Commit desplegado | `60e3cc7` |
| Migración 218 `AddOrigenAContratoOnuConfig` | **Aplicada** |
| `api-core` / `worker-auxiliary` | online · **PORT 4000 / 4001** · sin bucle de reinicio |
| `/health` | `ok` · PostgreSQL up · Redis 7.4.9 |
| **Pre-flight** | **`seguro = TRUE`** · 4 filas, todas `origen = erp`, **0 en riesgo** |
| Contexto | `olt_onu_inventario = 205` · `ftth_onu_registro = 1` |

> **204 ONUs reales sin registro FTTH.** Es exactamente el parque que una migración incorporaría
> — y el que el barrido de 2 minutos habría reconfigurado si esas filas hubieran nacido sin
> `origen`. El riesgo no era teórico: eran 204 clientes.

### 6.2 Qué hizo la Fase 2

| # | Tarea | Resultado |
|---|---|---|
| 2.1 | Congelar evidencia | `auditoria/`, `consolidacion/` y `directrices/` con banner de congelado |
| 2.2 | Duplicación `directrices/` ↔ POL-001 | Resuelta: **POL-001 es la única fuente normativa** |
| 2.3 | Generados vs escritos | Índice maestro §7.4 — 7 tipos de inventario que **se regeneran, no se citan** |
| 2.4 | Aplicar decisiones | **7 políticas nuevas**: PD-11, PD-12, PS-10, PI-08, PP-14, PP-15 · RDM-001 §8.0 |
| 2.5 | REC-001 | **Obsoleto**, con tabla de dónde vive cada recomendación |
| 2.6 | ADR-030 | Reescrito y **aceptado**: referencia por tipo de módulo |
| — | Desviaciones nuevas | **B-12** (`be-deploy.mjs` con `--update-env`) · **B-13** (contador de reinicios sin comparar) |

---

## Anexo — Lo que este plan NO incluye, y por qué

| Elemento | Motivo |
|---|---|
| Especificar los 41 módulos restantes (MOD) | Se documentan **cuando se tocan** (MOD-000 §8.4) |
| Manuales con capturas | Requieren producto estable y validación con usuarios (H2-9) |
| Gap analysis formal contra normas | Consecuencia de D3, no requisito |
| Certificación ISO | Descartada mientras haya desviaciones críticas abiertas |
| Consolidación del frontend (R13) | Real, pero no bloquea nada. Después de la Fase 4 |
