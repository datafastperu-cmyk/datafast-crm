> # ⛔ DOCUMENTO CONGELADO — 2026-08-06
>
> **Auditoría Arquitectónica — Etapa I**
>
> Este cuerpo es **evidencia fechada**, no norma. Describe el sistema tal como estaba en el
> commit `f8d52b00`. **No se mantiene y no debe citarse como fuente de obligación.**
>
> Ya contenía tres afirmaciones falsas que se detectaron el mismo día de su emisión (H3, H4, H5). Una fuente documental envejece; citarla no es medir.
>
> **Dónde vive lo vigente:** POL-001 (reglas), DOM-001/DAT-001/ARS-001 (descripción), RDM-001 (plan).
>
> *Congelado por PLAN-001 Fase 2.1. Se conserva por trazabilidad: es la prueba de dónde salió
> cada regla.*

---

# Auditoría Arquitectónica — ERP Datafast ISP

**Fecha de levantamiento:** 2026-08-06
**Rama:** `main` — commit base `f8d52b00`
**Alcance:** Etapa I — Levantamiento y documentación de la arquitectura ACTUAL.
**Restricción explícita:** este documento NO propone rediseños, no optimiza, no modifica código.
Documenta el estado tal como está hoy en el repositorio.

## Método

Fase 1A — **Descubrimiento automático** (ejecutado sobre el árbol de código real):

| Extracción | Comando/fuente | Resultado |
|---|---|---|
| Módulos backend | `ls backend/src/modules` | 44 directorios |
| Controladores y rutas | grep de `@Controller` / `@Get|@Post|@Put|@Patch|@Delete` | 46 controladores, ~560 endpoints |
| Entidades → tablas | grep de `@Entity('...')` | 81 entidades TypeORM |
| Tablas reales (incl. SQL crudo) | grep de `FROM|INTO|UPDATE` | ~120 tablas distintas |
| Migraciones | `find backend/src/database -name '*.ts'` | 215 archivos |
| Crons | grep de `@Cron(` | 29 tareas programadas |
| Colas / workers | grep de `@Processor` / `@Process` / `registerQueue` | 6 colas Bull, 6 processors |
| Eventos | grep de `@OnEvent` / `EventEmitter2` | 25 listeners |
| WebSockets | grep de `@WebSocketGateway` | 3 gateways |
| SQL crudo | grep de `.query(` | 445 llamadas |
| Servicio Python | `find olt-automation-service -name '*.py'` | 22 módulos, 5.520 LOC en `services/` |

Fase 1B — **Validación funcional**: interpretación del propósito de cada módulo, flujos de
negocio y decisiones de diseño, leyendo `CLAUDE.md`, `docs/`, `PENDIENTES.md`, los comentarios
de diseño embebidos en el código (`ecosystem.config.js`, `app.module.ts`, `outbox-red`,
`provision-ftth`) y el historial de incidentes citado en ellos.

## Capítulos

| # | Capítulo | Archivo |
|---|---|---|
| 1 | Arquitectura General | [01-arquitectura-y-modulos.md](01-arquitectura-y-modulos.md) |
| 2 | Inventario Completo de Módulos | [01-arquitectura-y-modulos.md](01-arquitectura-y-modulos.md) |
| 3 | Estructura Física del Proyecto | [01-arquitectura-y-modulos.md](01-arquitectura-y-modulos.md) |
| 4 | Diagrama de Dependencias | [01-arquitectura-y-modulos.md](01-arquitectura-y-modulos.md) |
| 5 | APIs Internas | [02-apis-datos-sql.md](02-apis-datos-sql.md) |
| 6 | Base de Datos | [02-apis-datos-sql.md](02-apis-datos-sql.md) |
| 7 | Consultas SQL | [02-apis-datos-sql.md](02-apis-datos-sql.md) |
| 8 | Comunicación con Equipos | [03-hardware-procesos.md](03-hardware-procesos.md) |
| 9 | Servicios Compartidos | [03-hardware-procesos.md](03-hardware-procesos.md) |
| 10 | Procesos Programados | [03-hardware-procesos.md](03-hardware-procesos.md) |
| 11 | Eventos | [03-hardware-procesos.md](03-hardware-procesos.md) |
| 12 | Integraciones Externas | [03-hardware-procesos.md](03-hardware-procesos.md) |
| 13 | Seguridad | [04-transversal-infra-uml.md](04-transversal-infra-uml.md) |
| 14 | Cache | [04-transversal-infra-uml.md](04-transversal-infra-uml.md) |
| 15 | Rendimiento | [04-transversal-infra-uml.md](04-transversal-infra-uml.md) |
| 16 | Infraestructura | [04-transversal-infra-uml.md](04-transversal-infra-uml.md) |
| 17 | Flujo Completo de Información | [04-transversal-infra-uml.md](04-transversal-infra-uml.md) |
| 18 | Diagramas UML / C4 | [04-transversal-infra-uml.md](04-transversal-infra-uml.md) |
| 19 | Inventario de Código | [04-transversal-infra-uml.md](04-transversal-infra-uml.md) |
| 20 | Problemas Detectados | [05-problemas-detectados.md](05-problemas-detectados.md) |

## Nota sobre la precisión del inventario

Todo lo declarado como conteo o listado proviene de una extracción mecánica sobre el código.
Donde una afirmación es interpretativa (criticidad, frecuencia de uso, acoplamiento) se marca
como **valoración**, no como dato medido. Las frecuencias de invocación de endpoints no están
instrumentadas en el sistema (no hay APM ni métricas de request), por lo que **toda frecuencia
de endpoint en este documento es una inferencia a partir del consumidor en el frontend**, y así
se indica.
