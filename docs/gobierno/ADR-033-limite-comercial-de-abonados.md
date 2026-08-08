# ADR-033 — Límite comercial: 5 000 abonados por instalación

**Estado:** **Aceptada** — 2026-08-08, Datafast (decisión **D14**, del propietario)
**Decide:** Datafast · **Relacionado:** ADR-031 (una instalación, una empresa)

---

## 1. Decisión

**Una instalación del ERP se comercializa hasta 5 000 abonados.**

Es un límite **estratégico**, no una medición: no dice que el sistema se rompa en 5 001. Dice que
Datafast no compromete servicio por encima de esa cifra.

Su razón es la que lo hace útil: **no exigirle al sistema más allá de capacidades que no están
documentadas.** Un techo declarado convierte una incógnita en una frontera conocida.

---

## 2. Qué NO afirma este documento

**No afirma que la capacidad esté validada.** No lo está.

Al fijar este límite, el volumen real en producción era de **16 abonados y 10 contratos**. Todo lo
que hay entre esa cifra y 5 000 es terreno sin medir.

Se deja escrito para que nadie lea «5 000» como una garantía técnica. Es un compromiso comercial
tomado a sabiendas de que la validación está pendiente — que es distinto de tomarlo creyendo que
existe.

---

## 3. Cómo se amplía

**Decisión del propietario.** Se registra en un ADR nuevo que sustituya a este, con la cifra nueva
y el motivo.

---

## 4. Consecuencias

Una instalación que se acerque al límite necesita una decisión antes de superarlo, no después. Un
operador que crezca por encima de 5 000 abonados se atiende con otra instalación (ADR-031: una
instalación, una empresa) o ampliando este límite de forma expresa.
