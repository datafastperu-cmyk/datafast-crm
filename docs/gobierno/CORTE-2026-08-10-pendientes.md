# Corte de pendientes — 10 de agosto de 2026

**Qué es esto.** Una fotografía de todo lo que estaba abierto al cierre del 10/08/2026, congelada
antes de que entre el diseño definitivo del propietario.

**Para qué sirve.** Cuando el diseño nuevo aterrice, habrá que decidir para cada punto si sigue
vigente, si el diseño lo resuelve, si lo cambia de forma o si lo deja obsoleto. Sin un corte con
fecha eso no se puede hacer: los pendientes se mezclan con el trabajo nuevo y en dos semanas nadie
sabe qué se sabía antes y qué trajo el rediseño.

**Cómo se usa.** Cada punto lleva identificador `C10-nn`. Al adaptarlos, se marca uno de cuatro
destinos:

| Destino | Significa |
|---|---|
| **VIGENTE** | El diseño no lo toca; sigue como estaba |
| **ABSORBIDO** | El diseño lo resuelve por su cuenta; se cierra citando dónde |
| **CAMBIA** | Sigue siendo un problema pero con otra forma; se reescribe |
| **OBSOLETO** | El diseño elimina el terreno donde vivía |

**Estado del sistema en el corte:** 89 suites, 750 tests, cero fallos. 17 desviaciones abiertas,
ninguna de nivel A. Producción con 2 clientes, 1 servicio activo y 1 suspendido, 4 comprobantes.

---

## A · Esperan una decisión del propietario

| Id | Punto | Por qué está parado |
|---|---|---|
| **C10-01** | **Ítems de importe negativo** | Bloquea la fase 5. El cambio de plan a mitad de ciclo produce en el sector **dos apuntes de signo contrario** —crédito por el plan viejo, cargo por el nuevo—, y los ítems del comprobante no admiten importe negativo. El total seguiría siendo positivo, así que `facturas_total_check` no estorba |
| **C10-02** | **Vencimiento de la nota de crédito y de los cargos únicos** | Hoy conviven **tres reglas y ninguna está declarada** (ADR-035 §8.3) |
| **C10-03** | **Cinco campos de configuración inertes** | `aplicarMora`, `montoMora`, `aplicarReconexion`, `montoReconexion`, `esquemaImpuesto`, `impuesto1`: se guardan y no hacen nada. Se implementan o se retiran de la pantalla (ADR-035 §8.4) |
| **C10-04** | **B-15 — la app es superusuario de PostgreSQL** | `rolsuper`, `rolbypassrls` y dueña de las 111 tablas: RLS sería inerte y una inyección SQL da control del servidor. **No se toca sin el propietario.** Secuencia en ADR-017 §3.3 |
| **C10-05** | **Instalación limpia** | Cierra B-14 y habilita C10-04. Es la prueba de que una instalación nueva nace funcionando |
| **C10-06** | **H-11 — anular CI-34** | Verificado y concluyente: duplica un mes ya pagado. **Aparcado el 10/08** al confirmarse que James es cliente de prueba. Sin impacto en cliente real |

---

## B · Tienen fecha

| Id | Punto | Cuándo |
|---|---|---|
| **C10-07** | **La emisión real** | **El 23.** Primera vez que la generación corre sobre todo lo desplegado el 09-10/08: prorrateo `ACTUAL_360`, días entregados, auto-reparación, tramo del alta, nivel de contrato, acuerdo en la factura y autoridad única. Verificador listo en `backend/scripts/verificar-emision.sql` |
| **C10-08** | **Fase 4.2b** | **Después del 23.** Desbloqueada por H-10. La configuración de facturación baja al contrato y la generación agrupa por contrato. Se separó a propósito de la unificación de autoridad: cambiar las dos cosas a la vez impediría saber cuál falló |
| **C10-09** | **Cliente de prueba postpago** | **Antes del 23**, si se quiere que ese día mida algo. Los dos clientes son prepago, así que la corrección más grande del día —el prorrateo por días entregados, que es la rama de postpago— **no tiene ni un dato en producción que la ejercite** |

---

## C · Se pueden construir sin decisiones

| Id | Punto | Tamaño |
|---|---|---|
| **C10-10** | **PA-15 — los 8 lotes que crecen con el parque** | `facturas`, `pagos`, `servicios`, `notificaciones_logs`, `vpn_clientes`, `ftth_onu_registro`. No es poner `LIMIT`: hace falta `ORDER BY` estable y comprobar que lo procesado deja de casar con el filtro, o el lote mata de hambre al resto. Caso por caso |
| **C10-11** | **3c restante — el dinero al contrato** | `pagos`, `cargos_pendientes`, `promesas_pago`. Aplazado por 374 sitios y ningún consumidor que lo pidiera; el propietario avisó de que **dos acuerdos por abonado es frecuente**, así que llegará |
| **C10-12** | **PA-12 — 15 tablas con más de un escritor** | El mismo patrón que se cerró hoy dos veces (H-10 y la cola de A-4). Ya inventariadas en `propiedad-tablas.ts` |
| **C10-13** | **B-2 — 19 tablas sin entidad TypeORM** | Mecánico |
| **C10-14** | **C-7 — seis tablas de serie temporal sin retención** | Crecen solas, sin política ni particionado |
| **C10-15** | **Los crons de hardware consumen un quinto de su ventana** | Medido, no convertido en trabajo |
| **C10-16** | **El servidor lleva 1,9 GB en swap** | Medido, no convertido en trabajo |
| **C10-17** | **C-1 — `forbidNonWhitelisted: false`** | Los campos extra se descartan en silencio. Mordió el 09/08 con `costoInstalacion`. Activarlo puede producir 400 en llamadas que hoy pasan |
| **C10-18** | **B-4 — `/red/routers` sin outbox** | Operaciones interactivas síncronas, sin garantías |
| **C10-19** | **B-5 — el plano WISP sin máquina de estados** | Outbox parcial, sin saga, VIO solo como detección posterior |
| **C10-20** | **B-7 — el cambio de ONU no existe** | Se improvisa como baja + alta |
| **C10-21** | **B-8 — Mercado Pago no usa el contrato de cobro** | Es el único que cobra dinero real, así que la abstracción no está validada |
| **C10-22** | **B-10 — credenciales de connreq duplicadas** | En GenieACS y en el `.env`, sin verificación de coincidencia |
| **C10-23** | **B-11 — patrones en producción sin test que los ejercite** | |
| **C10-24** | **C-2 — el plano financiero lanza excepciones HTTP** | A consumidores que a veces son máquinas. El plano de red ya usa `ResultadoOperacion` |
| **C10-25** | **C-3 / C-6 — patrones sin mecanismo que los obligue** | Se cumplen por disciplina, no por construcción |
| **C10-26** | **C-4 — dependencias instaladas sin uso** | `telegraf`, `twilio`, `net-snmp`; cola `mikrotik-jobs` declarada y no usada |
| **C10-27** | **C-5 / B-1 — deuda del frontend y del tipado** | Tres convenciones simultáneas, `molecules/` vacío, 1,8 % reutilizable; `strict: false` en TypeScript |

---

## D · Aparcados por decisión del propietario

| Id | Punto | Razón |
|---|---|---|
| **C10-28** | **Gateway de mensajería** | **481 de 481 sin enviar**, nunca ha salido un mensaje. Marcado *no core* el 10/08. Por debajo bloquea las notificaciones de tareas |
| **C10-29** | **Programador de tareas y sus avisos** | Bloqueado bajo C10-28 |
| **C10-30** | **Inventario de almacén** | Sin él, «queda el equipo libre» no ocurre dentro del ERP |
| **C10-31** | **Cobranza Etapa II — pasarelas** | Pendiente a propósito, tras una puerta de 30 días |
| **C10-32** | **Planta Externa fases 2 y 3** | En pausa: el propietario tiene propuestas sobre diseño y ubicación del módulo |
| **C10-33** | **IPTV por XUI One** | Aparcado |
| **C10-34** | **Migración MikroWISP** | Delicada; requiere diseño detallado antes de empezar |

---

## Lo que se cerró el 09 y 10 de agosto

Se anota para que el diseño nuevo no lo reabra por desconocimiento.

**Modelo del core:** tres estados con el origen en el historial · catálogo abierto a cable y
streaming · `contratos` → `servicios` · el nivel de contrato existe y agrupa · `facturas` e
historial nombran el servicio · la factura registra su acuerdo.

**Facturación y cobranza:** anclaje 1-31 con recorte a fin de mes · el periodo es el ciclo del
abonado · prorrateo `ACTUAL_360` con la base congelada en el ítem (PD-14) · el primer comprobante
del alta lo emite el backend · se factura el tiempo entregado · el generador diario se auto-repara ·
el prepago paga el tramo que consume al activarse · la mora es etiqueta · reactivar mira la deuda
vencida · **una sola autoridad decide qué se factura** · la proyección de deuda tiene un solo
escritor.

**Seguridad y observabilidad:** los 317 endpoints mutantes tienen autorización · PA-15 medido con
barrera · verificador de la emisión real.

**Y tres cifras de fichas que resultaron infladas al medirlas:** «102 endpoints abiertos» eran 99,
«30 de 33 consultas sin cap» eran 16 de 74, y «87 referencias a `deuda_total`» eran tres escrituras
reales. Conviene desconfiar del resto de números de este documento hasta medirlos.
