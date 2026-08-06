# Adaptadores de cobro — ETAPA II, PENDIENTE

**Si vas a integrar una pasarela (Niubiz, Izipay, Culqi, Stripe, POS, QR), para y lee
primero [`docs/cobranza-plan-implementacion.md`](../../../../../docs/cobranza-plan-implementacion.md)
§"⛔ ETAPA II".**

Este directorio contiene el **contrato** (`adaptador-cobro.interface.ts`) y sus tests.
No contiene ninguna implementación, y eso es deliberado.

---

## Por qué el contrato existe pero los adaptadores no

El contrato se fijó en la Etapa I a propósito. Si se hubiera dejado para la Etapa II, **la
primera integración lo habría definido de facto** y las demás se habrían acomodado a las
peculiaridades de ese proveedor.

Los adaptadores no se construyeron porque la Etapa II tiene una **puerta de estabilidad**:
30 días de invariante de contabilidad limpio en producción, un extorno real revisado a mano
y un cierre de caja mensual cuadrado. Dos de esos tres criterios no dependen de escribir
código — dependen de que el ERP cobre dinero real durante unas semanas.

No es burocracia. Cada integración que se apile sobre una frontera no demostrada multiplica
el coste de descubrir que la base estaba mal, y ese descubrimiento llega con dinero de
clientes en juego.

## Antes de escribir el primer adaptador

1. **Comprueba la puerta.** Los cinco criterios están en el plan, con su estado.
2. **Construye F8 primero** (motor + `cobro_intento` + conciliador). Un adaptador sin la
   máquina de estados del cobro en vuelo no tiene dónde reportar un `indeterminado`, y
   entonces alguien lo va a reportar como fallo — que es la decisión incorrecta.
3. **Migra MercadoPago al contrato antes que ningún proveedor nuevo** (F9). Es el único
   que ya cobra dinero real: si la abstracción no lo absorbe, la abstracción está mal y se
   corrige con un proveedor, no con tres.

## Las tres cosas que ya salieron mal aquí

Están bloqueadas por tests. Si uno falla, la respuesta no es ajustar el test:

| Error | Qué pasó | Qué lo bloquea |
|---|---|---|
| Un segundo servicio que registra pagos | El registro ya existe (`PagosService.registrar`). Un paralelo nace sin el reconciliador ni los guards | `frontera-dinero.spec.ts` |
| Aplicar dinero fuera del aplicador | Había 4 copias del mismo UPDATE; la de `adelantos` había perdido el guard de estado y aplicaba saldo a favor contra facturas ANULADAS | `frontera-dinero.spec.ts` |
| Inferir reintentabilidad de un código HTTP | Un 409 de lock se leyó como veredicto definitivo y se descartó trabajo bueno; un no-op idempotente se leyó como fallo → 1788 reintentos contra el MA5800 en 4 días | `contrato-adaptador.spec.ts`, `resultado-operacion.spec.ts` |

## Regla que se olvida siempre

**Un timeout cobrando NO significa "no pasó nada".** Al cliente pudo cobrársele y la
respuesta perderse. Reintentar a ciegas le cobra dos veces; reportar fallo deja dinero
existiendo sin registro. Las dos opciones que parecen simples son las dos incorrectas: se
reporta `indeterminado` y lo resuelve el conciliador consultando al proveedor.
