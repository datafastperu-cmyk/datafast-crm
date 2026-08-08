import { analizar, EndpointMutante } from '../analisis/autorizacion-endpoints';

// ═══════════════════════════════════════════════════════════════════════════
// Desviación B-3 · política PS-05.
//
// `RolesGuard` deja pasar a cualquier usuario autenticado cuando el endpoint no declara ni
// `@Roles` ni `@RequirePermission`:
//
//     if (!requiredRoles?.length && !requiredPermissions?.length) return true;
//
// Un POST o un DELETE sin decorar **no está «protegido por rol al módulo»: no está protegido
// en absoluto** más allá de estar autenticado. Medido el 2026-08-08: de 317 endpoints
// mutantes, **106 estaban así** — y entre ellos `undo`, `redo` y las dos restauraciones de
// `auditoria`, que alcanzan CUALQUIER tabla del sistema.
//
// Esta barrera no exige arreglar los 102 que quedan: los congela. Lo que impide es el 103.
// ═══════════════════════════════════════════════════════════════════════════
describe('Autorización en endpoints mutantes (B-3 · PS-05)', () => {
  const hallazgos = analizar();
  const por = (c: string) => hallazgos.filter((h: EndpointMutante) => h.clase === c);

  /**
   * Techo congelado el 2026-08-08. **Puede bajar, nunca subir.**
   *
   * Se congela en vez de exigir cero porque 102 endpoints es un trabajo de semanas y una
   * barrera que se estrena en rojo es lo primero que alguien desactiva. Y hay una razón de
   * fondo para no hacerlo de golpe: añadir `@Roles` a un endpoint cuyo permiso no esté
   * concedido al rol produce un **403 en producción** — el operador se queda sin poder
   * trabajar y sin entender por qué.
   *
   * 79 de los 102 están en `olt-nativo.controller.ts`. Bajará de golpe cuando se aborde R9
   * (partir ese controlador), que es el momento natural para decidir quién puede provisionar.
   */
  const TECHO_ABIERTOS = 102;

  it('ningún endpoint mutante nuevo se queda sin autorización', () => {
    const abiertos = por('ABIERTO');

    // Si esto falla en un endpoint NUEVO: declara `@RequirePermission` (preferido) o
    // `@Roles`. Subir el techo NO es la salida.
    expect(abiertos.length).toBeLessThanOrEqual(TECHO_ABIERTOS);
  });

  // Un rol que no existe hace el endpoint inalcanzable para todo el mundo. Falla cerrado
  // —dirección segura— pero deja una función muerta sin que nada lo diga: `papelera/eliminar`
  // exigía 'admin' y 'superadmin', y los roles reales se llaman 'Administrador' y
  // 'Super Administrador'. Nadie podía purgar la papelera.
  it('ningún endpoint exige un rol que no existe', () => {
    const fantasmas = por('ROL-FANTASMA').map((h) => `${h.fichero}:${h.linea} → ${h.fantasmas.join(', ')}`);
    expect(fantasmas).toEqual([]);
  });

  // Las operaciones que alcanzan CUALQUIER tabla del sistema. Se nombran una a una: si
  // alguien les quita la autorización, no basta con que el techo global no suba.
  it('deshacer y restaurar siguen exigiendo rol de administración', () => {
    const sinProteger = hallazgos
      .filter((h) => h.fichero.endsWith('auditoria/auditoria.controller.ts') && h.clase === 'ABIERTO')
      .map((h) => `${h.verbo} ${h.ruta}:${h.linea}`);

    expect(sinProteger).toEqual([]);
  });
});
