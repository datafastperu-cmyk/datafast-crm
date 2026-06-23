/**
 * Único punto de verdad para z-index en toda la aplicación.
 * Nunca usar z-index arbitrarios en JSX (z-[100], z-[9999]).
 * Para agregar un nivel nuevo: agregarlo aquí primero.
 */
export const Z = {
  base:     0,    // contenido normal del flujo
  raised:   10,   // cards en hover, elementos elevados
  sticky:   100,  // cabeceras de tabla sticky
  sidebar:  200,  // sidebar en mobile (drawer)
  topbar:   300,  // barra superior
  dropdown: 400,  // menús desplegables, selects, popovers
  modal:    500,  // modales y overlays de confirmación
  toast:    600,  // notificaciones
  tooltip:  700,  // tooltips (siempre encima de todo)
} as const;

export type ZLevel = keyof typeof Z;
