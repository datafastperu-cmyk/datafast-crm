# Documento de Consolidación Arquitectónica — ERP Datafast

**Etapa II** · Fecha: 2026-08-06 · Rama `main`, commit base `f8d52b00`

## Propósito

Transformar los hallazgos de la [Auditoría Arquitectónica (Etapa I)](../auditoria/) en
conocimiento arquitectónico estructurado. Este documento identifica **qué debe preservarse, qué
debe corregirse y qué principios deben gobernar la evolución** del ERP.

## Principio rector

> **No se está reconstruyendo el ERP. Se está consolidando su arquitectura.**

Ninguna recomendación de este documento implica reescribir el sistema. Todas son evoluciones
incrementales sobre la plataforma existente, y varias consisten explícitamente en **extender un
patrón que el propio ERP ya inventó y aplicó bien en uno o dos sitios** al resto del sistema.

## Capítulos

| # | Capítulo | Archivo |
|---|---|---|
| 0 | Correcciones a la Etapa I | este archivo |
| 1 | Arquitectura General | [01-arquitectura-backend.md](01-arquitectura-backend.md) |
| 2 | Arquitectura del Backend | [01-arquitectura-backend.md](01-arquitectura-backend.md) |
| 3 | Arquitectura del Frontend | [02-frontend-datos.md](02-frontend-datos.md) |
| 4 | Arquitectura de Datos | [02-frontend-datos.md](02-frontend-datos.md) |
| 5 | Modelo de Negocio | [03-negocio-integraciones-flujos.md](03-negocio-integraciones-flujos.md) |
| 6 | Integraciones | [03-negocio-integraciones-flujos.md](03-negocio-integraciones-flujos.md) |
| 7 | Flujos del Negocio | [03-negocio-integraciones-flujos.md](03-negocio-integraciones-flujos.md) |
| 8 | Dependencias | [04-dependencias-riesgos-fortalezas.md](04-dependencias-riesgos-fortalezas.md) |
| 9 | Reutilización | [04-dependencias-riesgos-fortalezas.md](04-dependencias-riesgos-fortalezas.md) |
| 10 | Riesgos Arquitectónicos | [04-dependencias-riesgos-fortalezas.md](04-dependencias-riesgos-fortalezas.md) |
| 11 | Fortalezas | [04-dependencias-riesgos-fortalezas.md](04-dependencias-riesgos-fortalezas.md) |
| 12 | Inventario Arquitectónico | [05-inventario-arquitectonico.md](05-inventario-arquitectonico.md) |
| **13** | **Recomendaciones Estratégicas para la Consolidación Arquitectónica** | [06-recomendaciones-estrategicas.md](06-recomendaciones-estrategicas.md) |

---

# CAPÍTULO 0 — Correcciones a la Auditoría de Etapa I

Al profundizar para esta etapa se encontraron **estructuras arquitectónicas que la Etapa I no
detectó** porque la extracción inicial buscó por convención de nombre de archivo
(`*.service.ts`, `*.controller.ts`, `*.entity.ts`) y estas viven en subdirectorios con otra
convención. Se corrigen aquí porque las dos primeras eran afirmaciones **de carga**: sobre ellas
se habrían apoyado recomendaciones equivocadas.

## 0.1 Corrección 1 — La capa de repositorio SÍ existe

**Lo que decía la Etapa I:** "No existe capa de repositorio. Los servicios inyectan
`Repository<T>` y `DataSource` y ejecutan SQL directamente."

**Lo real (medido):** existe en **6 módulos**, 1.614 LOC:

| Repositorio | LOC |
|---|---|
| `facturacion/repositories/factura.repository.ts` | 409 |
| `pagos/repositories/pago.repository.ts` | 358 |
| `contratos/repositories/contrato.repository.ts` | 333 |
| `tickets/repositories/ticket.repository.ts` | 212 |
| `smartolt/repositories/onu.repository.ts` | 153 |
| `clientes/repositories/cliente.repository.ts` | 149 |

**Por qué importa:** no hay que *introducir* una capa de repositorio — hay que **completar** una
que ya existe, y que además está exactamente en los módulos correctos (los del núcleo comercial
y financiero). El patrón ya está probado en producción y su forma ya está decidida
(`ContratoRepository` inyecta `DataSource`, obtiene los `Repository<T>` en el constructor y
expone métodos de dominio con `empresaId` obligatorio y soft-delete respetado).

Esto cambia la naturaleza de la recomendación correspondiente: de "adoptar un patrón nuevo" a
"extender el patrón vigente a los 38 módulos restantes".

## 0.2 Corrección 2 — Existen puertos y adaptadores formales en TypeScript

**Lo que decía la Etapa I:** los drivers Python eran "el único patrón adapter formal del sistema".

**Lo real (medido):** hay **cuatro puertos declarados en el backend TypeScript**:

| Puerto (interfaz) | Adaptadores | LOC |
|---|---|---|
| `olt-nativo/interfaces/olt-provider.interface.ts` (`IOltProvider`) | `nativo-ssh.provider.ts` (285), `smartolt.provider.ts` (385), `adminolt.provider.ts` (304) | 1.143 |
| `pagos/adaptadores/adaptador-cobro.interface.ts` | **ninguno — deliberado** | 140 + spec |
| `aprovisionamiento/interfaces/provisionamiento-provider.interface.ts` | `mock-provisionamiento.provider.ts` | 18 |
| `olt-nativo/ztp/` — driver ACS | `genieacs.driver.ts` (390) + `registry.ts` + `resolver.ts` + `device-profiles/` + `parameter-maps/` | 2.579 |

`IOltProvider` no es una interfaz nominal: **impone reglas de implementación por contrato
escrito**, y son las correctas —

1. Nunca propagar una excepción al llamador; todo error se devuelve como `OltOperacionResult { exitoso: false, mensaje, latenciaMs }`.
2. Medir latencia incluyendo el tiempo de conexión SSH/HTTP.
3. **No modificar el estado de la BD desde dentro de un proveedor** — los proveedores son adaptadores puros de protocolo; el estado lo actualizan el Router y el CircuitBreaker.

Eso es una arquitectura hexagonal correcta en el dominio más crítico del sistema. La Etapa I
la reportó como ausente.

## 0.3 Corrección 3 — Hay más subsistemas con diseño explícito de los reportados

| Subsistema | Ubicación | Contenido |
|---|---|---|
| **Catálogo de capacidades** | `olt-nativo/capability/` | `capability.engine.ts` (motor genérico de reglas puras), `olt-capability-catalog.ts`, `olt-model-catalog.ts`, `cpe-provisioning-catalog.ts`, `olt-baseline-standard.ts` (+ 2 specs) |
| **Reglas de compliance** | `olt-nativo/compliance/` | `olt-compliance-rules.ts` (+ spec) |
| **Subsistema ZTP** | `olt-nativo/ztp/` | 2.579 LOC: driver GenieACS, registry, resolver, contratos, perfiles de dispositivo, mapas de parámetros, auth CWMP, preset de ONU (+ 7 specs) |
| **Dominio de planta externa** | `planta-externa/domain/` | `planta-externa-maquina-estados.ts` y `presupuesto-optico.ts` (+ specs) |
| **Orquestador de velocidad** | `mikrotik/services/velocidad/` | `velocidad-orquestador.service.ts`, `velocidad.service.ts`, `mangle.service.ts`, `queue-tree-cliente.service.ts` — con estrategia de queue seleccionable (`simple_queue`/`queue_tree`/`pcq`/`sin_limite`) |

**Consecuencia:** hay **dos máquinas de estados declarativas**, no una (`ftth-maquina-estados` y
`planta-externa-maquina-estados`). El patrón ya se replicó por decisión propia del equipo, lo
que demuestra que es adoptable y no un caso aislado.

## 0.4 Lo que las correcciones cambian en el diagnóstico

| Diagnóstico Etapa I | Diagnóstico corregido |
|---|---|
| "Faltan patrones arquitectónicos" | **Los patrones existen y son buenos. Lo que falta es que sean obligatorios y uniformes.** |
| "Hay que introducir repositorios" | Hay que **extender** los repositorios existentes |
| "Solo Python tiene adaptadores" | Hay 4 puertos en TS; falta aplicarlos donde aún no |
| "Una máquina de estados declarativa" | Dos, replicada voluntariamente |

**Este es el hallazgo central de la Etapa II y condiciona todo el documento:** el problema del
ERP Datafast **no es carencia de arquitectura, es cobertura desigual de una arquitectura que ya
demostró funcionar**. Los patrones nacieron reactivamente —cada uno resolviendo un incidente
concreto— y se aplicaron solo donde dolía. Nunca se declararon obligatorios, así que un módulo
nuevo no los hereda.

## 0.5 Corrección 4 — Dominios que el enunciado da por existentes

El enunciado de Etapa II lista dominios que el ERP **no tiene implementados**. Se registran aquí
para que no entren en el modelo de negocio como si existieran:

| Dominio del enunciado | Estado real medido |
|---|---|
| **SUNAT / Facturación Electrónica** | **No implementado.** Existe la página `configuracion/facturacion-electronica` en el frontend y `pdf.service.ts` genera comprobantes, pero no hay cliente SUNAT, ni OSE, ni firma XML, ni envío/recepción de CDR. |
| **Inventario** | **No implementado como módulo de negocio.** Existe la página `(dashboard)/inventario` y `olt_onu_inventario` (inventario *observado* de ONUs en la OLT), pero no hay control de stock, almacenes ni descuento de materiales. |
| **GIS** | Existe como **capacidad**, no como módulo: coordenadas en `contratos`, CTE `PUNTOS_SERVICIO`, mapa MapLibre/OSM, geocoding por cola Google. No hay módulo GIS. |
| **ChatBot** | No existe. `crm-nativo` es bandeja de conversación humana. |
| **SMS** | No existe proveedor en el gateway de mensajería. |

## 0.6 Nota de método

Todo dato numérico de este documento proviene de extracción mecánica sobre el árbol de código en
el commit indicado. Las valoraciones (criticidad, probabilidad, impacto, prioridad) están
marcadas como tales y son juicio arquitectónico, no medición.

Las limitaciones declaradas en la Etapa I siguen vigentes y acotan este documento: **no hay APM,
ni métricas de request, ni volúmenes de tabla de producción, ni pruebas de carga.** Ninguna
recomendación de este documento depende de un dato que no se pueda verificar en el repositorio.
