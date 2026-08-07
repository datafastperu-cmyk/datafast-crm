# EST-001 — Estándares Técnicos

---

## 2. Control documental

| Campo | Valor |
|---|---|
| **Código** | EST-001 · **Versión** 1.0 · **Estado** Vigente |
| **Autor** | Arquitectura · **Revisores** Pendientes de asignar |
| **Fecha** | 2026-08-06 · **Documento superior** CON-001, POL-001 |

## 3. Historial de cambios

| Versión | Fecha | Cambio | Motivo |
|---|---|---|---|
| 1.0 | 2026-08-06 | Emisión inicial | Las convenciones existían de hecho pero no estaban escritas; se detecta además una contradicción entre la política de tipado y la configuración del compilador (§8.1.1) |

## 4. Índice

1. Backend · 2. Frontend · 3. Base de Datos · 4. APIs · 5. Testing · 6. Logging ·
7. Observabilidad · 8. Git

## 5. Objetivo

Definir **cómo se implementa** el software: convenciones, herramientas, formatos y patrones
obligatorios.

## 6. Alcance

Backend NestJS, frontend Next.js, servicio Python, base de datos y flujo de trabajo con Git.

## 7. Definiciones y glosario

| Término | Definición |
|---|---|
| **Convención** | Forma acordada de hacer algo; su incumplimiento no rompe nada pero degrada el conjunto |
| **Estándar** | Convención con carácter obligatorio (POL-001) |
| **Barrera** | Mecanismo que impide incumplir un estándar |

---

# 8. Contenido

# 8.1 Backend

## 8.1.1 Configuración del compilador — **contradicción declarada**

Configuración real medida en `backend/tsconfig.json` y `.eslintrc.js`:

| Opción | Valor real |
|---|---|
| `strict` | **`false`** |
| `strictNullChecks` | **`false`** |
| `noImplicitAny` | **`false`** |
| `@typescript-eslint/no-explicit-any` | **`off`** |
| `target` | `ES2021` · `module` `commonjs` |
| Builder | **SWC** (`nest-cli.json`) |

> ⚠️ **POL-001 §PD-08 exige tipado estricto y prohíbe `any`. El compilador no lo exige, y el
> linter tampoco.** La política se cumple hoy por disciplina del equipo, no por barrera.

**Estándar:** el tipado estricto se aplica **en el código nuevo** como norma. Endurecer la
configuración global requiere ADR, porque activarla de golpe sobre ~96.000 LOC produciría un
volumen de errores inmanejable. Ver Anexo B.

## 8.1.2 Formato

`prettier` con: comillas simples · coma final `all` · **ancho 90** · indentación 2 · punto y coma
· paréntesis en flechas · fin de línea `lf`.

`eslint` con `@typescript-eslint/recommended` + `prettier/recommended`. Variables sin usar:
warning, salvo prefijo `_`.

## 8.1.3 Estructura de un módulo

```
modules/<nombre>/
├── <nombre>.module.ts
├── <nombre>.controller.ts
├── <nombre>.service.ts
├── dto/                    obligatorio si hay endpoints
├── entities/               obligatorio si tiene tablas
├── repositories/           obligatorio para módulos de negocio
├── services/               si el módulo tiene más de un servicio
├── interfaces/             si define un puerto
├── providers/              adaptadores del puerto
├── domain/                 máquina de estados y reglas puras
├── cron/                   tareas programadas
├── listeners/ · processors/
└── *.spec.ts               junto al código que prueban
```

**Estándar:** las entidades van en `entities/`, no en la raíz del módulo. *(Desviación conocida:
`finanzas-opex`, `proyectos-inversion`, `backup`, `config`, `zonas` las tienen en la raíz.)*

## 8.1.4 Convenciones de nombres

| Elemento | Convención | Ejemplo |
|---|---|---|
| Archivo | `kebab-case` + sufijo de rol | `provision-ftth.service.ts` |
| Clase | `PascalCase` + sufijo | `ProvisionFtthService` |
| Interfaz de puerto | `I` + `PascalCase` | `IOltProvider` |
| Método | `camelCase`, **verbo en español** | `provisionarOnu()` |
| Constante | `SCREAMING_SNAKE` | `VELOCIDAD_QUEUE` |
| DTO | `PascalCase` + `Dto` | `CrearContratoDto` |
| Evento | `SCREAMING_SNAKE` o `dominio.accion` | `FACTURA_EMITIDA`, `cliente.created` |
| Cola | `kebab-case` en `QUEUES` | `mikrotik-velocidad` |
| Máquina de estados | `<recurso>-maquina-estados.ts` | `ftth-maquina-estados.ts` |

**Idioma:** identificadores de dominio **en español** (`contrato`, `factura`, `provisionar`);
términos técnicos universales en inglés (`repository`, `service`, `guard`).

## 8.1.5 Estándares obligatorios de servicio

| # | Estándar |
|---|---|
| 1 | Un servicio invocable por un orquestador devuelve `ResultadoOperacion`, no excepciones HTTP |
| 2 | Un servicio con dependencia externa implementa el patrón degradable desde su creación |
| 3 | Un servicio **nunca** llama a hardware dentro de un request HTTP: escribe en el outbox |
| 4 | Un adaptador **nunca** propaga excepciones ni toca la base de datos |
| 5 | Un servicio de módulo con repositorio **no** consulta por fuera del repositorio |
| 6 | Toda mutación de hardware declara su **sonda de verificación** |
| 7 | Un cron declara cap, presupuesto de tiempo y latido; **nunca relanza** |
| 8 | Un listener de evento **encola**; no ejecuta lógica de negocio |

## 8.1.6 Entidades

| # | Estándar |
|---|---|
| 1 | Toda tabla nueva tiene entidad |
| 2 | **Columnas `string \| null` llevan `type:` explícito** — sin él, SWC crashea el backend en frío |
| 3 | `@Entity('nombre_tabla')` en `snake_case` |
| 4 | Campos sensibles con `@Exclude()` |
| 5 | Toda entidad de negocio lleva `empresa_id` |
| 6 | Soft-delete con `deleted_at` e índice único parcial |

## 8.1.7 Manejo de errores

| # | Estándar |
|---|---|
| 1 | **PROHIBIDO** `catch` genérico sin lógica de recuperación |
| 2 | **PROHIBIDO** silenciar un error sin registrarlo |
| 3 | Excepciones tipadas de NestJS en el borde HTTP; `ResultadoOperacion` hacia dentro |
| 4 | El `onModuleInit` de un módulo degradable **nunca relanza** |
| 5 | Un cron **nunca relanza**: tumbaría el proceso PM2 |
| 6 | Un adaptador **nunca propaga**: retorna resultado estructurado |

## 8.1.8 Servicio Python

| # | Estándar |
|---|---|
| 1 | Esquemas Pydantic para toda entrada y salida |
| 2 | Excepciones de dominio (`ProvisioningError`, `ConnectionError`) con handler propio |
| 3 | Toda operación mutante tiene su función de verificación |
| 4 | Reintentos acotados con backoff corto — **el MA5800 tiene VTY limitadas** |
| 5 | Drenar el autosave antes de enviar comandos a la OLT |
| 6 | El pool de sesiones se reutiliza; no se abre sesión por operación |

# 8.2 Frontend

## 8.2.1 Organización — **estándar unificado**

**Estándar:** organización **por dominio**, alineada con los módulos del backend. `ui/`,
`shared/` y `atoms/` para lo genuinamente reutilizable.

*(Desviación conocida: coexisten tres convenciones; `molecules/` está vacío y `organisms/` tiene
1 archivo. Ver RDM-001 R13.)*

## 8.2.2 Convenciones

| Elemento | Convención | Ejemplo |
|---|---|---|
| Componente | `PascalCase.tsx` | `ClienteDetalle.tsx` |
| Página | `page.tsx` en su carpeta de ruta | `app/(dashboard)/clientes/page.tsx` |
| Hook | `use` + `PascalCase` | `useOltSocket.ts` |
| Store | `<dominio>.store.ts` | `auth.store.ts` |
| Cliente de API | `<dominio>.ts` en `lib/api/` | `olt-nativo.ts` |
| Utilidad | `kebab-case.ts` | `senal-ftth.ts` |

## 8.2.3 Estándares obligatorios

| # | Estándar |
|---|---|
| 1 | **PROHIBIDO** `fetch` directo en un componente: todo pasa por `lib/api/` |
| 2 | El estado global (Zustand) es **solo** para sesión, empresa y preferencias — **nunca datos de servidor** |
| 3 | Un componente que supera el umbral acordado se descompone antes de añadirle nada |
| 4 | **PROHIBIDO** cualquier secreto en el frontend |
| 5 | Las rutas del portal viven bajo `app/portal/`, con su propio store y sesión |
| 6 | Los errores de API se presentan con `parseApiError` |
| 7 | ESLint: usar `// eslint-disable-line` **sin regla específica** — el plugin `@typescript-eslint` no está registrado en el frontend y el build rompe en el VPS |

# 8.3 Base de Datos

## 8.3.1 Nombres

| Elemento | Convención |
|---|---|
| Tabla | `snake_case` plural o con prefijo de dominio (`pe_`, `olt_`, `ftth_`, `cpe_`) |
| Columna | `snake_case` |
| Índice | `idx_<tabla>_<campos>` |
| Índice único | `uq_<tabla>_<campos>` |
| Función | `fn_<accion>` |
| Trigger | `trg_<tabla>_<evento>` |
| Vista | `v_<concepto>` |
| Migración | `<timestamp>-<DescripcionEnPascalCase>.ts` |

## 8.3.2 Estándares

| # | Estándar |
|---|---|
| 1 | `synchronize: false` — el esquema **solo** cambia por migración |
| 2 | **PROHIBIDO** editar una migración desplegada; se corrige con otra |
| 3 | Toda migración implementa `up` **y** `down` |
| 4 | Migraciones idempotentes (`IF NOT EXISTS`) siempre que sea posible |
| 5 | Toda tabla de negocio lleva `empresa_id` con su índice único compuesto |
| 6 | Soft-delete con índice único **parcial** (`WHERE deleted_at IS NULL`) |
| 7 | **PROHIBIDO** `MAX()+1` para correlativos |
| 8 | El SQL crudo se parametriza siempre — **PROHIBIDA** la interpolación de cadenas |
| 9 | Toda consulta sobre una tabla con `empresa_id` la filtra |
| 10 | Una consulta pesada nueva se justifica en el código |

## 8.3.3 Verificaciones disponibles

| Herramienta | Comando |
|---|---|
| Validez del SQL crudo | `npm run sql:check` |
| Divergencia entidades ↔ esquema | `npm run db:check` |
| Estado de migraciones | `npm run migration:show` |
| Verificación al arrancar | módulo `schema-guard` |

# 8.4 APIs

## 8.4.1 Convenciones REST

| Aspecto | Estándar |
|---|---|
| Prefijo | `/api/v1` |
| Recurso | Sustantivo plural en español (`/contratos`, `/pagos`) |
| Sub-recurso | `/contratos/:id/historial` |
| Acción no-CRUD | Verbo tras el recurso (`/contratos/:id/activar`) |
| Métodos | `GET` leer · `POST` crear/acción · `PUT` reemplazar · `PATCH` modificar · `DELETE` borrar |
| Paginación | `pagination.util` |
| Respuesta | Envuelta por `TransformInterceptor` |
| Errores | Normalizados por `AllExceptionsFilter` |

## 8.4.2 Estándares obligatorios

| # | Estándar |
|---|---|
| 1 | Todo endpoint declara su DTO con `class-validator` |
| 2 | Todo endpoint mutante declara `@RequirePermission('recurso:accion')` |
| 3 | Las lecturas de alto volumen marcan `@SetMetadata('skipAudit', true)` |
| 4 | Toda ruta pública se marca `@Public()` explícitamente |
| 5 | **Las rutas estáticas se declaran antes que las paramétricas** — en NestJS/Express el orden de registro importa: `/contratos/segmentos` debe ir antes que `/contratos/:id` |
| 6 | Un controlador que supera el umbral acordado se divide por grupo funcional |
| 7 | Ningún endpoint ejecuta hardware de forma síncrona (timeout global de 30 s) |
| 8 | Todo endpoint documenta su propósito con decoradores Swagger |

## 8.4.3 Códigos de estado

| Código | Uso |
|---|---|
| 200 / 201 / 204 | Éxito · creado · sin contenido |
| 400 | Entrada inválida — **rechazo definitivo** para el orquestador |
| 401 / 403 | No autenticado · no autorizado |
| 404 | No existe — **rechazo definitivo** |
| 409 | Conflicto o lock — **REINTENTABLE, nunca definitivo** |
| 422 | Entidad no procesable |
| 429 | Rate limit — **reintentable** |
| 5xx | Error del servidor — **reintentable** |

# 8.5 Testing

## 8.5.1 Estándares

| # | Estándar |
|---|---|
| 1 | El test vive **junto al código** que prueba (`*.spec.ts`) |
| 2 | **El nombre indica qué incidente previene.** PROHIBIDO "no debería fallar" |
| 3 | Todo invariante crítico (dinero, aislamiento, concurrencia, plano físico) lleva test |
| 4 | Un comentario que garantiza concurrencia lleva test **o se borra** |
| 5 | Los tests no dependen de red, hardware ni base de datos real: se mockean las dependencias |
| 6 | Un test que falla **no se ajusta**: se investiga qué garantía se rompió |

## 8.5.2 Ejemplo del estándar de nombres

| ✅ Correcto | ❌ Incorrecto |
|---|---|
| `"409 de lock es reintentable, no un veredicto (incidente 28/07)"` | `"debería manejar errores"` |
| `"desaprovisionar acepta origen suspendido (ONU huérfana 28/07)"` | `"test de desaprovisionar"` |
| `"no aplica saldo a favor contra facturas anuladas"` | `"aplicación de adelantos"` |

## 8.5.3 Comandos

`npm test` · `npm run test:cov` · `npm run test:e2e` · `npm run typecheck` · `npm run sql:check`

## 8.5.4 Estado actual — brecha declarada

~30 specs para ~96.000 LOC de backend · **2 tests** para 57.435 LOC de frontend · la suite de
facturación **no compila** · `sql:check` **no está en CI**.

> Los tests existentes son de altísima calidad: cubren invariantes que ya fallaron y nombran el
> incidente. **El problema es cobertura, no criterio.**

# 8.6 Logging

## 8.6.1 Estándares

| # | Estándar |
|---|---|
| 1 | **Un log describe lo que ocurrió, nunca lo que el código pretendía hacer** |
| 2 | Si el mensaje puede quedar desactualizado por un cambio en otro archivo, **ya está mal escrito** |
| 3 | **PROHIBIDO** loguear credenciales, tokens, contraseñas o datos personales sensibles |
| 4 | Cada servicio usa su propio `Logger` con el nombre de la clase |
| 5 | Un error que se captura se registra con su contexto |
| 6 | Los logs de operaciones de hardware incluyen la latencia medida |

## 8.6.2 Niveles

| Nivel | Uso |
|---|---|
| `error` | Fallo que requiere atención humana |
| `warn` | Degradación, reintento, resultado `indeterminado` |
| `log` | Hito de negocio (contrato activado, pago aplicado) |
| `debug` | Detalle de diagnóstico; no en producción por defecto |

## 8.6.3 Incidente de referencia

`contratos.service.ts` logueaba *"requiere confirmación manual"* cuando el outbox **ya tenía el
trabajo encolado**. El log describía la intención del autor al escribirlo, no el estado del
sistema.

# 8.7 Observabilidad

## 8.7.1 Estado actual

| Disponible | No disponible |
|---|---|
| Logs winston por proceso | APM |
| `/health`, `/health/modules`, `/status` | Trazas distribuidas |
| `/admin/sistema/watchers` (latido) | Métricas de request |
| `/admin/workers/status`, `/jobs` | `pg_stat_statements` |
| `/outbox-red/status` | Logging SQL (**desactivado**) |
| `eventos_sistema` | Alertas automáticas de salud |

## 8.7.2 Estándares

| # | Estándar |
|---|---|
| 1 | Todo módulo degradable **registra su estado** en `ModuleHealthService` con su razón |
| 2 | Todo proceso de fondo **emite latido** |
| 3 | Todo proceso de fondo **expone su progreso**, no solo su resultado |
| 4 | Una afirmación de rendimiento sin medición **se enuncia como hipótesis** |
| 5 | Si una corrección no se puede verificar con un número, **no está verificada** |

# 8.8 Git

## 8.8.1 Mensajes de commit

Formato: `tipo(ámbito): descripción en minúscula`

| Tipo | Uso |
|---|---|
| `feat` | Funcionalidad nueva |
| `fix` | Corrección |
| `refactor` | Sin cambio de comportamiento |
| `docs` | Documentación |
| `chore` | Mantenimiento |
| `test` | Tests |
| `perf` | Rendimiento |

**Estándar de contenido:** el mensaje **explica qué estaba mal y por qué no se veía**, no qué
líneas cambiaron.

| ✅ Correcto | ❌ Incorrecto |
|---|---|
| `fix(cobranza): faltaba poder crear cuentas receptoras — el catalogo quedaba a medias` | `fix: correcciones` |
| `fix(cobranza): finanzas/registro seguia con "Seleccionar Banco" y "Forma de Pago"` | `update` |

## 8.8.2 Flujo

| # | Estándar |
|---|---|
| 1 | Rama `main` es la de despliegue |
| 2 | Un commit por unidad de cambio comprensible |
| 3 | **PROHIBIDO** commitear con el typecheck en rojo |
| 4 | **PROHIBIDO** commitear secretos, `.env` o `ACCESOS.local.md` |
| 5 | Tras cada cambio sin errores: commit + push + despliegue |
| 6 | El despliegue se verifica; **PROHIBIDO** dar por bueno un script que afirma éxito sin comprobarlo |

## 8.8.3 Archivos que nunca se versionan

`.env*` (salvo `.env.example`) · `ACCESOS.local.md` · `node_modules/` · `dist/` · `logs/` ·
certificados y claves · respaldos.

---

# 9. Referencias

CON-001 · POL-001 · ARS-001 · DAT-001 · SEC-001 · GUI-001 ·
`backend/.prettierrc` · `backend/.eslintrc.js` · `backend/tsconfig.json` · `nest-cli.json`

---

# 10. Anexos

## Anexo A — Comandos de referencia

| Área | Comando |
|---|---|
| Build backend | `npm run build` (SWC) |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Tests | `npm test` · `npm run test:cov` |
| Migración: generar | `npm run migration:generate` |
| Migración: ejecutar | `npm run migration:run` |
| Migración: revertir | `npm run migration:revert` |
| Migración: estado | `npm run migration:show` |
| Instalación nueva | `npm run migration:run:all` |
| Verificar SQL | `npm run sql:check` |
| Seeds | `npm run seed:run` |
| Build en VPS | `NODE_OPTIONS='--max-old-space-size=2048' npm run build` |

## Anexo B — Desviaciones entre política y configuración

Clasificación según POL-001 Anexo B: **A** incumplimiento crítico · **B** riesgo técnico ·
**C** mejora futura.

| Nivel | Política | **Hoy** | **Objetivo** | Requiere |
|---|---|---|---|---|
| **B-1** | PD-08 tipado estricto | `strict: false`<br/>`strictNullChecks: false`<br/>`noImplicitAny: false`<br/>`no-explicit-any: off` | `strict: true`<br/>`strictNullChecks: true`<br/>`noImplicitAny: true`<br/>`no-explicit-any: error` | **ADR-018** |
| **B-2** | PA-13 entidad por tabla | 39 tablas sin entidad | **0** tablas de coordinación y dinero sin entidad | **ADR-026** |
| **B-3** | PS-05 permiso fino | `@RequirePermission` en 4 de 44 módulos | Todo endpoint mutante lo declara; CI lo exige en código nuevo | **ADR-025** |
| **B-6** | PA-15 cap y lock en crons | `reconciliar()` itera sin cap ni lock | Todo cron declara cap, lock y presupuesto de tiempo | **ADR-027** |
| **B-9** | PC-05 verificaciones en CI | `typecheck`, `test` y `sql:check` manuales · suite de facturación **no compila** | Los tres en CI bloqueando el merge · suite reparada | RDM-001 **R16** |
| **C-1** | PS-06 validación de entrada | `forbidNonWhitelisted: false` | `forbidNonWhitelisted: true` | Revisión de impacto |
| **C-5** | EST-001 §8.2 frontend | 3 convenciones · `molecules/` vacío · 1,8 % reutilizable | 1 convención (por dominio) · sin directorios muertos · umbral de tamaño | RDM-001 **R13** |

### B.1 Por qué el tipado estricto no se activa de golpe

Activar `strict: true` sobre ~96.000 LOC produciría un volumen de errores inmanejable, y
"arreglarlos" en masa introduciría más riesgo del que elimina. **ADR-018** debe decidir la
estrategia de adopción. Opciones a evaluar en él:

| Opción | Ventaja | Coste |
|---|---|---|
| Activar global y corregir todo | Termina de una vez | Diff enorme, irrevisable, con riesgo de regresión |
| `strict` solo en archivos nuevos (por `include` o por directorio) | Sin regresión; el código nuevo nace correcto | Dos regímenes conviviendo |
| Activar opción por opción (`strictNullChecks` primero) | Progresivo y medible | Varias iteraciones |
| Activar por módulo, empezando por el Core Indestructible | Prioriza donde más duele un `null` inesperado | Requiere configuración por proyecto |

**Regla mientras tanto:** el código nuevo se escribe como si `strict` estuviera activo. Es
disciplina, y está declarada como tal — no como cumplimiento.

**Regla general:** una desviación de esta tabla **es una excepción registrada**, no una política
derogada. El registro maestro, con nivel y condición de cierre, está en **POL-001 Anexo B**.

## Anexo C — Trampas conocidas del entorno

| Trampa | Síntoma | Regla |
|---|---|---|
| Columna `string \| null` sin `type:` | El backend crashea en frío (SWC no soporta `Object`) | Declarar `type:` siempre |
| `extends BaseEntity` o accessors `get/set` en entidades | Crash de SWC (`__esDecorate`) | Prohibidos |
| Constante de módulo leyendo `process.env` | Vale `undefined` (se evalúa antes de `ConfigModule`) | Lazy getter |
| Ruta paramétrica antes que estática | `/contratos/segmentos` cae en `/contratos/:id` | Declarar estáticas primero |
| `// eslint-disable-line @typescript-eslint/...` en frontend | El build rompe en el VPS | Usar `// eslint-disable-line` sin regla |
| Heap por defecto de Node en el VPS | El build falla | `NODE_OPTIONS='--max-old-space-size=2048'` |
| Reintento CLI tras autosave de la OLT | `% Unknown command` — **falso negativo** | Drenar el autosave antes |
