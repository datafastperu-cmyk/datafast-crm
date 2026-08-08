# ADR-031 — El ERP es mono-empresa por diseño: una instalación, una empresa

**Estado:** **Aceptada** — 2026-08-08, Datafast (decisión **D12**)
**Decide:** Datafast (propietario del producto)
**Deja sin efecto:** el objetivo de RLS de **ADR-017** · **Reclasifica:** desviación **A-1**
**No afecta:** desviación **B-15**, ADR-012

---

## 1. Problema

La base de datos tiene **`empresa_id` en 100 tablas** y **492 sentencias** que deben acordarse de
filtrarlo. La desviación **A-1** llevaba semanas clasificada como **crítica** por la consecuencia
obvia: una consulta que lo omita devuelve datos de otra empresa, sin error y sin síntoma.

Toda esa maquinaria descansaba sobre una premisa que **nunca se había escrito ni verificado**:
que el ERP alojaría varias empresas.

---

## 2. Contexto

### 2.1 Lo que se midió antes de preguntar

| Comprobación | Resultado |
|---|---|
| Filas en `empresas` (producción) | **1** |
| Rutas en el ERP para crear una segunda | **Ninguna** — ni controlador, ni servicio, ni script del instalador |
| Origen de la única fila | El *seed* de la migración `1700000010000`, con datos placeholder que se configuran en el primer acceso |

No había una empresa por casualidad: **el ERP no ofrece forma de crear otra.** La capacidad
multi-empresa estaba construida en el esquema y ausente en la aplicación.

### 2.2 La respuesta del propietario

> *«El ERP no se ata a ningún VPS, a ninguna empresa, a ninguna IP ni a ningún dominio. Con
> respecto a multi-empresa, al parecer está instalado un servicio que nunca se va a utilizar; el
> ERP es para una empresa. Si otra empresa quiere utilizar el ERP, debe instalarlo en otro
> servidor y empezar desde cero.»*

### 2.3 Dos conceptos que se estaban confundiendo

| | Qué es | Aislamiento |
|---|---|---|
| **Multi-VPS** — lo que se hace | Una instalación por ISP: su servidor, su base de datos, su `.env` | **Físico.** Es ADR-012 y la regla PA-11 |
| **Multi-empresa** — lo que NO se hará | Varias filas en `empresas` compartiendo las mismas tablas | Lógico, por columna. **Descartado** |

La portabilidad multi-VPS **sigue siendo obligatoria y no se relaja en nada**: ninguna IP, dominio
ni URL de servidor en el repositorio. Es una propiedad distinta y ADR-012 la gobierna.

---

## 3. Decisión

**Una instalación del ERP sirve a exactamente una empresa.** Un segundo operador implica una
instalación nueva: otro servidor, otra base de datos, desde cero.

### 3.1 La decisión se convierte en barrera, no se queda en declaración

Un índice único sobre una expresión constante permite **una sola fila** en `empresas`:

```sql
CREATE UNIQUE INDEX unica_empresa_por_instalacion ON empresas ((TRUE));
```

Sin esto, ADR-031 sería una intención escrita en un documento, y un `INSERT` de una «empresa de
pruebas» dentro de producción reabriría en silencio el riesgo entero de A-1 — sobre 492 consultas
que ya nadie estaría vigilando, porque el documento diría que el problema no existe.

> Es la regla del propio corpus: *una garantía que nadie sostiene es peor que ninguna, porque el
> siguiente lector construye encima.*

### 3.2 `empresa_id` se conserva, y deja de ser una frontera de seguridad

**No se elimina la columna.** Quitarla de 100 tablas y 492 consultas es un refactor enorme, sin
ganancia funcional, y CON-001 §8.11.3 lo prohíbe mientras haya desviaciones críticas abiertas.

Lo que cambia es **qué significa**: pasa de ser un *control de aislamiento* a ser una **clave de
partición vestigial**. Omitirla en una consulta deja de ser un fallo de seguridad; sigue siendo mal
estilo y puede ser un defecto funcional, pero **no puede filtrar datos ajenos porque no hay ajenos**.

---

## 4. Consecuencias

### 4.1 Lo que se retira

| Qué | Por qué |
|---|---|
| **El objetivo de RLS** (ADR-017) | Protegía de una fuga que ya no puede ocurrir. Y de todos modos era inerte (B-15) |
| **El barrido de aislamiento en CI** | Guardaba el mismo invariante. Se conserva el script como herramienta latente (§4.2), **fuera del CI** |
| **A-1 como desviación crítica** | Su consecuencia queda anulada por esta decisión + la barrera de §3.1 |

**Se retira trabajo terminado el mismo día en que se terminó.** Es lo correcto: la premisa cambió,
y una barrera que no protege de nada es exactamente la clase de definición muerta que este corpus
manda borrar — alguien la encontraría dentro de un año y la creería autorizada.

### 4.2 Lo que se conserva, y qué lo despertaría

`backend/scripts/barrido-aislamiento.mjs` se queda en el repositorio, **documentado como latente**.
Vuelve al CI si alguna vez se decide cualquiera de estos cuatro:

1. Vender el ERP como SaaS con varios ISP sobre la misma infraestructura.
2. Operar bajo **dos razones sociales** — plausible en un ISP peruano que factura con dos RUC.
3. Que la migración de MikroWISP traiga el parque de otro operador a la misma instancia.
4. Cualquier motivo para retirar el índice único de §3.1.

**Retirar ese índice es la señal.** Quien lo haga tiene que leer esto.

### 4.3 Lo que NO cambia

**B-15 sigue intacta y sigue siendo la prioridad.** Que la aplicación se conecte a PostgreSQL como
superusuario con `BYPASSRLS` **no tiene nada que ver con multi-tenancy**: es una violación del
mínimo privilegio, explotable hoy en una instalación de una sola empresa. Cualquier inyección SQL
que alcance el motor lo hace con permisos totales — `DROP`, lectura de `pg_authid`,
`COPY … TO PROGRAM`.

Que A-1 se desactive **no rebaja B-15 ni un punto**. Al contrario: deja de estar tapada por ella.

**ADR-012 (portabilidad multi-VPS) tampoco cambia.** Sigue prohibido cualquier literal de IP,
dominio o URL de servidor.

---

## 5. Lo que esto enseña sobre el propio proceso

A-1 estuvo clasificada como **crítica** desde la auditoría, y se planificó una fase entera para
cerrarla con RLS. La consecuencia era real *si la premisa era cierta*, y **nadie había verificado
la premisa** — ni la auditoría, ni el roadmap, ni yo, hasta preguntar.

Se llegó a comprobar que RLS sería inerte (§2.1 de ADR-017), que es un buen hallazgo, **pero seguía
siendo la respuesta a la pregunta equivocada**. La pregunta correcta no era *«¿cómo aislamos las
empresas?»* sino ***«¿va a haber más de una?»***, y costaba una consulta y una frase.

Verificar el mecanismo antes de construirlo evitó una garantía falsa. Verificar la **premisa** antes
de planificar habría evitado la fase entera.
