import { ResultadoOperacion } from './resultado-operacion';

/**
 * Catálogo único de motivos de `rechazado_definitivo` declarados a propósito por una
 * operación (D-14, E-0.3 §10: «la lista de rechazos definitivos es explícita y corta»).
 *
 * Por qué existe (Ola 1, 2026-08-16): al convertir las dos primeras operaciones de frontera
 * (`ProvisionFtthService.actualizarWan()`, `.reaplicar()`) esa lista empezó a vivir dispersa
 * en el cuerpo de cada método — un rechazo aquí, otro allá. PA-03 lo prohíbe por la razón
 * exacta que aplica: **un criterio disperso no es auditable, y por eso no permite notar lo
 * que falta.** Dentro de seis meses, con 91 operaciones convertidas, nadie iba a poder
 * responder «¿qué rechaza este sistema de forma definitiva, y por qué?» leyendo el código.
 *
 * Cada entrada es una FUNCIÓN que construye el `ResultadoOperacion`, no una descripción
 * aparte de lo que el código realmente hace — para que no haya una segunda fuente que pueda
 * desincronizarse de la primera (R-3, Ola 0). El código de dominio llama a estas funciones;
 * no construye el literal `{ clase: 'rechazado_definitivo', ... }` a mano.
 *
 * Se añade una entrada aquí **solo** cuando una operación decide, de forma deliberada, que
 * reintentar la misma llamada produce el mismo veredicto. Un `throw` heredado que todavía no
 * se convirtió no entra aquí — pasa por `clasificarError()` hasta que se convierta. Y si una
 * operación nueva necesita rechazar algo que no encaja en ninguna entrada existente, **no se
 * inventa una clasificación sobre la marcha**: es una pregunta de diseño (R-6, F-0.1).
 */
export const RechazosDefinitivos = {
  // ── FTTH (olt-nativo) ────────────────────────────────────────────────────
  // Ola 1, grupo 1 — ProvisionFtthService.actualizarWan()

  /**
   * La VLAN del servicio (contrato) cambió respecto de la que tiene el registro FTTH.
   * `actualizarWan` solo re-inyecta la WAN; el service-port de la OLT sigue en la VLAN
   * vieja, así que la operación NUNCA alcanza el destino sin Re-Aprovisionar primero
   * (rehace service-port + WAN). Reintentar `actualizarWan` con la misma VLAN desalineada
   * produce el mismo rechazo siempre.
   */
  FTTH_VLAN_CAMBIADA: (vlanRegistro: number, vlanContrato: number): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: `La VLAN del servicio cambió (${vlanRegistro} → ${vlanContrato}). ` +
            `Usa "Re-Aprovisionar" para actualizar el service-port y la WAN.`,
  }),

  /**
   * `_buildWanInject` no pudo construir el payload: credenciales PPPoE ausentes, IP/máscara
   * ausente para amarre IP/MAC, o método de autenticación no soportado. Es un dato de
   * configuración del contrato, no una falla del hardware — no cambia por reintentar.
   */
  FTTH_CONFIG_WAN_INVALIDA: (detalle: string): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: detalle,
  }),

  // Ola 1, grupo 1 — ProvisionFtthService.reaplicar()

  /** No existe registro FTTH para el contrato: no hay nada que re-aplicar. */
  FTTH_SIN_REGISTRO: (): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: 'No hay registro FTTH para este contrato — no se puede re-aplicar.',
  }),

  /**
   * El registro no tiene perfiles GPON guardados (`lineprofileId`/`srvprofileId`). Sin ellos
   * `provisionarFtth` no puede reconstruir la config — hace falta re-aprovisionar desde cero,
   * no reintentar `reaplicar`.
   */
  FTTH_SIN_PERFILES_GPON: (): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: 'El registro no tiene perfiles GPON guardados — re-aprovisiona desde el modal del contrato.',
  }),

  // ── Mensajería (notificaciones) ─────────────────────────────────────────
  // Ola 1, grupo 2 — GatewayMensajeriaService.despachar()

  /** Ni el teléfono del cliente ni el `whatsapp_corporativo` de la empresa están configurados. */
  NOTIF_SIN_DESTINO: (): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: 'Sin número de destino configurado.',
  }),

  /** La empresa no tiene ningún proveedor de mensajería configurado (`proveedor_activo` nulo). */
  NOTIF_SIN_CONFIG: (): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: 'Sin configuración de mensajería activa.',
  }),

  /** El operador desactivó explícitamente el servicio de mensajería para esta empresa. */
  NOTIF_SERVICIO_INACTIVO: (): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: 'Servicio de mensajería inactivo.',
  }),

  /**
   * El proveedor (o su fallback) rechazó el envío por un problema de configuración o
   * contenido que no cambia solo: sin plantilla para el tipo, texto que excede el límite de
   * caracteres, sin credenciales del proveedor, o sin email del cliente (ruta SMTP).
   */
  NOTIF_CONFIG_INVALIDA: (detalle: string): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: detalle,
  }),

  // ── Mikrotik (control de acceso) ────────────────────────────────────────
  // Ola 1, grupo 3b — MikrotikService.crearReglasControl()

  /** El contrato no tiene usuario PPPoE asignado — dato de configuración, no falla el router. */
  MIKROTIK_SIN_USUARIO_PPPOE: (): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: 'El contrato no tiene usuario PPPoE asignado.',
  }),

  /** Amarre IP/MAC requiere ambos datos en el contrato; ninguno lo genera el router. */
  MIKROTIK_SIN_IP_O_MAC: (ip: string | null | undefined, mac: string | null | undefined): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: `Amarre IP/MAC requiere IP (${ip ?? 'sin asignar'}) y MAC (${mac ?? 'sin asignar'}) configuradas en el contrato.`,
  }),

  // ── FTTH (olt-nativo) ────────────────────────────────────────────────────
  // Ola 1, grupo 4 — ProvisionFtthService.activarCarril()

  /** No existe registro FTTH para el contrato: no hay carril que activar. */
  FTTH_ACTIVAR_CARRIL_SIN_REGISTRO: (): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: 'Contrato sin ONU FTTH — no hay carril que activar.',
  }),

  /** El carril solo se activa desde "activo"/"gpon_registrado"; cualquier otro estado
   *  del registro FTTH necesita re-aprovisionar primero, no reintentar esta operación. */
  FTTH_ACTIVAR_CARRIL_ESTADO_INVALIDO: (estadoActual: string): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: `El carril solo se activa en ONUs "activo"/"gpon_registrado" (actual: "${estadoActual}").`,
  }),

  // ── TR-069 (olt-nativo/ztp) ──────────────────────────────────────────────
  // Ola 1, grupo 4 — OnuTr069DetalleService.setWifi()/.setWifiAmbasBandas()

  /** El device-profile de la ONU declara un `parameter_map` que no está registrado: un
   *  hueco de configuración/código, no un fallo transitorio de la ONU o del ACS. */
  TR069_PARAMETER_MAP_NO_REGISTRADO: (detalle: string): ResultadoOperacion => ({
    clase: 'rechazado_definitivo',
    motivo: detalle,
  }),
} as const;
