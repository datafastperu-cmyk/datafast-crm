// Entorno mínimo para los tests unitarios.
//
// Motivo (2026-07-28): varios servicios llaman a utilidades que exigen variables de
// entorno al importarse o al ejecutarse — `encrypt()` aborta si `ENCRYPTION_KEY` no mide
// 64 caracteres hex. Sin esto, un spec perfectamente válido falla por una razón que no
// tiene nada que ver con lo que prueba, y el mensaje de error apunta a un util genérico
// en vez de al problema real. Peor: invita a "arreglar" el test equivocado.
//
// Los valores son de juguete a propósito. Si alguna vez un test necesita una clave real,
// es señal de que está probando criptografía y no lógica de negocio: ese test va a otro
// sitio.
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);
process.env.JWT_SECRET     ??= 'test-jwt-secret';
process.env.NODE_ENV       ??= 'test';

// Los tests no deben ejecutar crons ni trabajo de fondo: son deterministas por
// definición, y un @Cron disparándose a mitad de una suite produce fallos que aparecen y
// desaparecen según la hora a la que se corran.
process.env.RUN_CRONS = 'false';
