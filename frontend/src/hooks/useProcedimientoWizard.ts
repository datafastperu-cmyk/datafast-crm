'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { oltNativoApi } from '@/lib/api/olt-nativo';

type TipoWizard = 'ftth_provision' | 'router_vpn' | 'olt_wizard';

// ─────────────────────────────────────────────────────────────
// useProcedimientoWizard — ciclo de vida del procedimiento operativo (Fase 3).
//
// Contrato con el servidor (ver CLAUDE.md § Wizards y Modales):
//  · `abrir`     al empezar trabajo mutante — NO al montar el modal. Abrir un modal solo
//                para mirar no debe crear un procedimiento ni, por tanto, anular nada.
//  · `heartbeat` mientras el operador está a cargo: SUPRIME el barrido del servidor para
//                que no le deshaga el trabajo mientras lee un error en pantalla.
//  · `confirmar` SOLO cuando el recurso alcanzó su estado terminal verificado. A partir de
//                ahí el trabajo es irrevocable por cierre.
//  · `cerrar`    en cualquier desmontaje. Si ya se confirmó, el servidor lo ignora.
//
// El navegador NUNCA es la fuente de verdad: `beforeunload` no puede ejecutar trabajo
// asíncrono fiable, así que el mecanismo real de anulación es la expiración del TTL en el
// servidor. Estas llamadas solo aceleran lo que el servidor haría igual.
// ─────────────────────────────────────────────────────────────
export function useProcedimientoWizard(tipo: TipoWizard, recursoRef: string) {
  const [operacionId, setOperacionId] = useState<string | null>(null);
  const [confirmado, setConfirmado]   = useState(false);

  // Refs para que el cleanup de desmontaje vea SIEMPRE el valor actual: el closure del
  // efecto de limpieza se congela con el valor del primer render si se usa el estado.
  const opRef          = useRef<string | null>(null);
  const confirmadoRef  = useRef(false);

  const abrir = useCallback(async (): Promise<string | null> => {
    if (opRef.current) return opRef.current;
    try {
      const op = await oltNativoApi.wizardAbrir(tipo, recursoRef);
      opRef.current = op.id;
      setOperacionId(op.id);
      return op.id;
    } catch {
      // Si no se puede abrir el procedimiento NO se bloquea al operador: el sistema
      // degrada al comportamiento histórico (la red de seguridad sigue siendo el barrido).
      return null;
    }
  }, [tipo, recursoRef]);

  const confirmar = useCallback(async () => {
    const id = opRef.current;
    if (!id || confirmadoRef.current) return;
    confirmadoRef.current = true;
    setConfirmado(true);
    await oltNativoApi.wizardConfirmar(id).catch(() => { /* best-effort */ });
  }, []);

  const cerrar = useCallback(async (motivo: string) => {
    const id = opRef.current;
    if (!id || confirmadoRef.current) return;   // confirmado ⇒ nada que anular
    opRef.current = null;
    setOperacionId(null);
    await oltNativoApi.wizardCerrar(id, motivo).catch(() => { /* el TTL lo cubre igual */ });
  }, []);

  // Heartbeat: suprime el barrido mientras el operador está presente.
  useEffect(() => {
    if (!operacionId || confirmado) return undefined;
    const t = setInterval(() => {
      oltNativoApi.wizardHeartbeat(operacionId).catch(() => { /* el TTL decide */ });
    }, 60_000);
    return () => clearInterval(t);
  }, [operacionId, confirmado]);

  // Aviso nativo al cerrar pestaña/recargar. Solo advierte: el trabajo real de anulación
  // lo hace el servidor al expirar el TTL (aquí no se puede garantizar un request).
  useEffect(() => {
    if (!operacionId || confirmado) return undefined;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [operacionId, confirmado]);

  // Desmontaje por CUALQUIER motivo — incluida la navegación interna del ERP, que no
  // dispara ningún diálogo. Cubre la tercera vía de cierre que el diálogo no alcanza.
  useEffect(() => {
    return () => {
      const id = opRef.current;
      if (id && !confirmadoRef.current) {
        oltNativoApi.wizardCerrar(id, 'Modal desmontado sin confirmar').catch(() => { /* TTL */ });
      }
    };
  }, []);

  return {
    operacionId,
    confirmado,
    /** ¿Hay trabajo iniciado que se anulará si se cierra ahora? */
    hayTrabajoSinConfirmar: Boolean(operacionId) && !confirmado,
    abrir,
    confirmar,
    cerrar,
  };
}
