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
| 2.1 | **Congelar** `docs/auditoria/` y `docs/consolidacion/` como evidencia fechada | Dejan de mantenerse. Ya contenían 3 afirmaciones falsas |
| 2.2 | **Resolver la duplicación** `docs/directrices/` ↔ POL-001 | Hoy hay dos fuentes para las mismas reglas — lo que R-006 prohíbe |
| 2.3 | Marcar qué documentos **se generan del código** y cuáles se escriben a mano | Los inventarios (módulos, endpoints, tablas, crons, tests) se extraen en un minuto. Generados no mienten; escritos mienten en seis meses |
| 2.4 | Aplicar las **14 adopciones de Fase 1 de REC-001** a POL-001, CON-001, EST-001 y GUI-001 | Incorpora tus recomendaciones a la norma |
| 2.5 | Declarar **REC-001 Obsoleto** al terminar 2.4 | Un documento de recomendaciones que sobrevive a las políticas que generó crea dos verdades |

**Salida:** un cuerpo normativo de ~12 documentos vivos, el resto congelado o generado.

---

### FASE 3 — Cerrar las desviaciones críticas · *técnico*

En este orden, por relación seguridad/coste:

| # | Desviación | Trabajo | Decisión previa |
|---|---|---|---|
| 3.1 | **A-3** — el worker puede morir en silencio | Alarma de latido: el proceso que responde denuncia al que no late. Cap y presupuesto por cron | ADR-020 |
| 3.2 | **A-4** — la deuda se calcula en 4 sitios | Una sola definición; los cuatro consumidores pasan por ella; test que verifica que coinciden | **D11** |
| 3.3 | **A-1** — aislamiento multi-tenant por convención | RLS en PostgreSQL + barrido en CI. **El más delicado: mal configurado devuelve cero filas** | ADR-017 |

**Salida:** cero desviaciones de nivel A. Es el hito que más cambia el perfil de riesgo del ERP.

---

### FASE 4 — Brechas estructurales · *técnico*

| # | Trabajo | Por qué en este orden |
|---|---|---|
| 4.1 | **R8** — observabilidad mínima (colas, edad del outbox, latido, duración de crons) | Multiplicador: sin medir no se verifica que 3.1 funcionó |
| 4.2 | **R7** — entidades para las tablas de coordinación y dinero | Barato; el compilador empieza a proteger el outbox y la saga |
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
| 0 — Cerrar lo hecho | **En ejecución** — despliegue en curso | — |
| **1 — Decisiones** | **✅ CERRADA** | **2026-08-06** |
| 2 — Poda del corpus | **Desbloqueada** — siguiente | — |
| 3 — Desviaciones críticas | No iniciada | — |
| 4 — Brechas estructurales | No iniciada | — |
| 5 — Brechas funcionales | No iniciada | — |

---

## Anexo — Lo que este plan NO incluye, y por qué

| Elemento | Motivo |
|---|---|
| Especificar los 41 módulos restantes (MOD) | Se documentan **cuando se tocan** (MOD-000 §8.4) |
| Manuales con capturas | Requieren producto estable y validación con usuarios (H2-9) |
| Gap analysis formal contra normas | Consecuencia de D3, no requisito |
| Certificación ISO | Descartada mientras haya desviaciones críticas abiertas |
| Consolidación del frontend (R13) | Real, pero no bloquea nada. Después de la Fase 4 |
