// Config ACS TR-069 — definida por el ERP a nivel de instalación (una sola vez
// por VPS), NO por OLT. Antes vivía en olt_dispositivos (editable por OLT), pero
// el ACS (GenieACS) es una única instancia por instalación del ERP, así que
// tiene sentido como config de plataforma, no como dato editable por el
// operador desde el panel — el tab TR-069 la muestra de solo lectura.
//
// Portabilidad multi-VPS: lazy getters (nunca constantes de módulo) porque estas
// se evalúan antes de que ConfigModule cargue el .env si se leyeran al importar.
export const getTr069AcsUrl = () => process.env.TR069_ACS_URL || '';
export const getTr069AcsUsername = () => process.env.TR069_ACS_USERNAME || '';
export const getTr069AcsPassword = () => process.env.TR069_ACS_PASSWORD || '';
export const getTr069ConnReqUsername = () => process.env.TR069_CONNREQ_USERNAME || '';
export const getTr069ConnReqPassword = () => process.env.TR069_CONNREQ_PASSWORD || '';
