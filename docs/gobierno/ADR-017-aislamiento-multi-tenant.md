# ADR-017 — RLS no es hoy un mecanismo de aislamiento: primero hay que poder aplicarla

**Estado:** **Aceptada, y su objetivo de RLS queda SIN EFECTO el mismo día** — ver **ADR-031**
**Fecha:** 2026-08-08, Datafast (PLAN-001 Fase 3.3)
**Decide:** Datafast · **Aborda:** desviación **A-1** (queda **parcialmente abierta**, a propósito) ·
**Relacionado:** PS-04 · ADR-012 · RDM-001 **R3**

> ## ⚠ Leer esto primero (2026-08-08, horas después de aceptarse)
>
> **ADR-031 deja sin efecto el objetivo de este ADR.** El propietario confirmó que el ERP es
> **mono-empresa por diseño**: una instalación sirve a exactamente una empresa, y otra empresa
> implica otra instalación desde cero. La base lo impone ahora con el índice único
> `unica_empresa_por_instalacion`.
>
> Sin una segunda empresa posible, **no puede haber fuga entre empresas**: RLS deja de hacer
> falta y el barrido sale del CI (queda latente).
>
> **Lo que de este ADR SIGUE VIGENTE y no depende de la multi-tenancy:**
> - **§2.2 — la aplicación se conecta a PostgreSQL como superusuario** (desviación **B-15**).
>   Es explotable hoy, con una sola empresa. Al desactivarse A-1, deja de estar tapada por ella.
> - **§2.3 — siete tablas con `empresa_id` nulable**, si alguna vez se retoma RLS.
> - **§2.4 — la clasificación del barrido** (20 abiertas / 171 transitivas / 13 globales), como
>   fotografía del estado del código.
>
> Se conserva entero en vez de reescribirse: **el registro de por qué se descartó RLS aquí es lo
> que evita que alguien lo reintente dentro de seis meses creyendo que lo resuelve.**

---

## 1. Problema

**Toda consulta debe filtrar por `empresa_id`, y hoy eso es una convención.** Nada lo obliga: si
una consulta lo omite, no falla — **devuelve datos de otra empresa**, sin log y sin síntoma. Es la
única clase de fallo del ERP que es silenciosa por definición.

El estado objetivo que fijó POL-001 era claro: *«una consulta que omita el filtro devuelve CERO
filas, no filas ajenas»*, más un barrido en CI. La vía obvia era Row-Level Security.

---

## 2. La medición, que cambia la decisión entera

### 2.1 RLS, activada hoy, no filtraría absolutamente nada

Medido contra la base de datos de producción, no deducido:

```
Usuario de la app : datafast_db_user
Privilegios       : rolsuper: true, rolbypassrls: true
Tablas en public  : 111 | DUEÑA de: 111
Tablas con RLS    : 0    · Políticas RLS: 0
```

PostgreSQL exime del sistema de seguridad por filas, **siempre y sin excepción**, a tres figuras:

| Figura | Estado de la app |
|---|---|
| Superusuario | **Sí** (`rolsuper`) |
| Rol con `BYPASSRLS` | **Sí** (`rolbypassrls`) |
| Dueño de la tabla — salvo `FORCE ROW LEVEL SECURITY` | **Sí**, de las 111 |

**Las tres a la vez.** Escribir la migración que activa RLS, desplegarla y anotar en este corpus
«aislamiento garantizado a nivel de base de datos» habría producido un documento verdadero en su
letra y falso en su efecto: **cero filas filtradas**.

> Es exactamente el fallo que ADR-001 (VIO) existe para impedir, aplicado a nosotros mismos.
> `ALTER TABLE … ENABLE ROW LEVEL SECURITY` habría devuelto `ALTER TABLE` sin error. Aceptado no
> es materializado — tampoco cuando quien acepta es PostgreSQL.

### 2.2 Un hallazgo que vale por sí solo

**La aplicación se conecta a la base como superusuario.** Eso no es un detalle de RLS: es una
violación directa del mínimo privilegio. Cualquier inyección SQL que hoy alcance el motor lo hace
con permisos totales — `DROP`, lectura de `pg_authid`, `COPY … TO PROGRAM`. Se registra como
desviación propia (**B-15**), y es prerrequisito de todo lo demás.

### 2.3 Siete tablas con `empresa_id` nulable

Con una política `empresa_id = current_setting('app.empresa_id')`, **una fila con `empresa_id` en
NULL es invisible para todo el mundo**, incluida su dueña. No desaparece: deja de existir para la
aplicación. Hay que resolverlo *antes* de activar nada, no después.

### 2.4 El barrido: 204 sentencias, pero no 204 fugas

`backend/scripts/barrido-aislamiento.mjs`, escrito para esta fase:

| Clase | Nº | Qué significa |
|---|---|---|
| **ABIERTA** | **20** | Tocan una tabla de empresa sin acotación alguna. **Es la lista revisable** |
| **TRANSITIVA** | 171 | Acotadas por clave ajena (`cliente_id`, `contrato_id`…). Seguras **solo si** esa clave se validó más arriba |
| **GLOBAL** | 13 | Procesos de fondo que actúan sobre todas las empresas a propósito. Correcto |

**Presentar «204 infracciones» habría sido inútil y contraproducente**: una barrera que grita 204
veces el primer día es lo primero que alguien desactiva. La cifra accionable es **20**.

**Y las 171 transitivas son las peligrosas, no las abiertas.** El análisis estático no puede
resolverlas: dependen de si el identificador llegó de una ruta validada o de un parámetro de URL.
Es literalmente el incidente de `crm-nativo` (30/07): *«con un chatId ajeno, cualquier usuario con
sesión válida se llevaba la conversación completa de otra empresa»*. La consulta filtraba por
`chat_id` y parecía correcta.

---

## 3. Decisión

**A-1 no se cierra en esta fase. Se cierra el hueco que se puede cerrar sin mentir, y se declara
explícitamente el que no.**

### 3.1 Lo que se hace ahora

| # | Decisión |
|---|---|
| 1 | **El barrido entra en el repositorio** (`scripts/barrido-aislamiento.mjs`) con su clasificación, sus exenciones justificadas y su documentación de límites |
| 2 | **No falla el build todavía.** Informa. Falla cuando las 20 abiertas estén triadas y la cifra congelada — una barrera que se estrena en rojo no se adopta, se ignora |
| 3 | **Se registra B-15** (la app corre como superusuario) como desviación con entidad propia |

### 3.2 Lo que NO se hace, y por qué

**No se activa RLS.** Sería inerte, y peor que inerte: dejaría escrito que el problema está
resuelto.

**No se cambia el rol de base de datos por iniciativa propia.** Quitarle `SUPERUSER` y `BYPASSRLS`
a `datafast_db_user` y dejar de ser dueña de 111 tablas es un cambio de infraestructura cuyo modo
de fallo es que **al ERP le falte un permiso en producción**. Requiere inventario de privilegios
reales, un `GRANT` mínimo verificado, y probarlo sobre una instalación limpia — no sobre la que da
servicio. **Es decisión del propietario, no del arquitecto.**

### 3.3 La secuencia obligatoria, cuando se aborde

El orden importa: invertido, cada paso rompe producción.

1. **Inventariar** qué privilegios usa realmente la aplicación (DDL de migraciones incluido).
2. **Separar roles**: uno de migración (DDL) y otro de ejecución (DML), ninguno superusuario.
3. **Resolver los `empresa_id` nulables** — o excluir esas tablas de las políticas.
4. **`FORCE ROW LEVEL SECURITY`**, porque el rol seguirá siendo dueño de las tablas salvo que
   además se cambie la propiedad.
5. **Fijar `app.empresa_id` por transacción** (`SET LOCAL`), nunca por conexión: el *pool* reutiliza
   conexiones entre peticiones y una variable de sesión sobreviviría a la petición que la puso —
   sería una fuga creada por el propio mecanismo antifugas.
6. **Tabla por tabla**, empezando por una de bajo riesgo y verificando con la aplicación en marcha.
7. **Verificar como VIO manda**: no que el `ALTER TABLE` no diera error, sino que una consulta sin
   filtro **devuelve cero filas** ejecutándose con el rol de la aplicación.

---

## 4. Alternativas

| # | Alternativa | Por qué se descarta |
|---|---|---|
| A | Activar RLS ya | **Inerte** (§2.1), y con la peor consecuencia posible: la falsa constancia de que está resuelto |
| B | Quitar privilegios al rol en producción, ahora | Modo de fallo: al ERP le falta un permiso y deja de dar servicio. No es una decisión que se tome sin su dueño |
| C | Solo el barrido, y declarar A-1 cerrada | Un análisis estático **no puede** resolver las 171 transitivas. Declararlo cerrado sería la afirmación sin verificar que este corpus prohíbe |
| **D** | **Barrido ahora + RLS como proyecto con prerrequisito declarado, y A-1 abierta mientras tanto** | **Elegida** |

---

## 5. Consecuencias

**Positivas:** el hueco deja de ser invisible y pasa a tener una medida que se puede seguir en el
tiempo (20 / 171 / 13). Aparece B-15, que estaba oculto detrás de A-1 y es explotable por sí solo.
Y queda escrito por qué la solución evidente no funciona aquí — que es lo que evita que alguien la
reintente dentro de seis meses y crea haberla resuelto.

**Negativas:** **A-1 sigue abierta**, y el riesgo que describe sigue vivo. Se mitiga por el
contexto, no por el diseño: **esta instalación tiene una sola empresa**, así que hoy no hay entre
quién filtrar. Es una mitigación circunstancial y **desaparece con el primer cliente multi-empresa**
— exactamente el momento en que nadie estará mirando esto.

---

## 6. Estado

**Aceptada.** Cierra el sub-objetivo «barrido en CI» de A-1. **No cierra A-1.**

| Pendiente | Bloqueado por |
|---|---|
| Triar las 20 sentencias ABIERTA | Nada — es trabajo directo |
| Auditar las 171 TRANSITIVA (¿validan la pertenencia del id?) | Nada — es revisión, no herramienta |
| Que el barrido falle el build | Lo anterior |
| **Des-privilegiar el rol de base de datos (B-15)** | **Decisión del propietario** |
| RLS efectiva | B-15 + `empresa_id` nulables |
