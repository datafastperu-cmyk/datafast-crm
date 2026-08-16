# ⛔ Archivo — no se lee como diseño ni como norma

**Todo lo que hay en esta carpeta está congelado u obsoleto.** Se conserva por **trazabilidad**
(00-INDICE §7, estado 6: *«Reemplazado; se conserva por trazabilidad»*), no porque describa el
sistema.

> **Si buscas qué debe hacer el ERP, no estás en el sitio correcto.**
> Empieza por [`../gobierno/F-0.0-punto-de-entrada.md`](../gobierno/F-0.0-punto-de-entrada.md).

---

## Qué hay aquí y por qué no se usa

| Contenido | Qué fue | Por qué no se lee |
|---|---|---|
| **`auditoria/`** | Etapa I — auditoría del ERP | ⛔ Congelado el 2026-08-06. **Contenía tres afirmaciones falsas** verificadas como tales. Es evidencia fechada, no diagnóstico vigente |
| **`consolidacion/`** | Etapa II — consolidación | ⛔ Congelado el 2026-08-06. Su contenido vivo migró a **POL-001 Anexo B** y **RDM-001** |
| **`directrices/`** | Directrices y políticas previas | ⛔ Congelado el 2026-08-06. **Duplicaba POL-001**, que es la única fuente normativa |
| **`REC-001-evaluacion-recomendaciones.md`** | Evaluación de recomendaciones | ⛔ Obsoleto. Su contenido está en **POL-001**, **ADR-029** y **ADR-030** |
| **`Recomendaciones.docx`** | Documento origen de REC-001 | Idem |
| **`checklist-preproduccion.md`** | Checklist de pre-producción (2026-06-11) | Anterior a todo el cuerpo normativo y al diseño del Core |

---

## Por qué se archivó en lugar de borrarse

Dos razones, y la segunda es la que manda:

1. **Trazabilidad.** Una decisión de hoy puede tener que explicarse contra el diagnóstico que la
   motivó. Borrar la evidencia hace que el «por qué» deje de ser reconstruible.
2. **Porque el riesgo no era que existiera: era que se leyera mezclado con lo vigente.** Un
   implementador que abre `docs/` y encuentra una auditoría con afirmaciones falsas al lado del
   diseño vigente no tiene forma de distinguirlas. **Separarlo resuelve eso sin destruir nada.**

**Lo que sí se borró:** `estructura.txt` — un árbol de ficheros de mayo de 2026, regenerable en un
segundo y sin valor histórico. Sigue en el historial de git.

---

## Regla

**Nada de esta carpeta se cita como fuente en un documento vigente.** Si algo de aquí sigue siendo
cierto y hace falta, se **verifica de nuevo** y se escribe donde corresponda — nunca se cita desde
el archivo.
