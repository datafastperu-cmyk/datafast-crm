import { clasificarErrorMikrotik } from './connection-pool.service';

// Ola 1, grupo 3b (2026-08-17) — clasificador de borde para RouterConnectionPool.execute().
// PC-02/PC-04: nombra el caso real. Un timeout de CONEXIÓN y un timeout de COMANDO no son
// el mismo hecho — tratarlos igual (lo que clasificarError() genérico haría) es el mismo
// defecto que leer un 409 como veredicto definitivo, en espejo: perder la distinción que la
// clase existe para conservar. El caso malo (PC-04) es el que un clasificador ingenuo
// confundiría: un timeout de conexión NO produce indeterminado.
describe('clasificarErrorMikrotik() — distingue timeout de conexión de timeout de comando', () => {
  it('un timeout de CONEXIÓN es reintentable, NO indeterminado — nada se envió al router', () => {
    const r = clasificarErrorMikrotik(new Error('Timeout conectando a 10.0.0.1:8728'));
    expect(r.clase).toBe('reintentable');
  });

  it('el mismo criterio aplica cuando el pool agota reintentos y envuelve el error', () => {
    // Forma real que produce RouterConnectionPool.execute() tras agotar sus reintentos de
    // conexión: "Error persistente en router <id>: <lastError.message>".
    const r = clasificarErrorMikrotik(new Error('Error persistente en router r-1: Timeout conectando a 10.0.0.1:8728'));
    expect(r.clase).toBe('reintentable');
  });

  it('un timeout de COMANDO sí es indeterminado — el comando se envió, no hubo respuesta (D-14 §2)', () => {
    const r = clasificarErrorMikrotik(new Error('Timeout de comando en 10.0.0.1 (20s)'));
    expect(r.clase).toBe('indeterminado');
  });

  it('cualquier otro error (permiso denegado, etc.) se delega a clasificarError() sin más', () => {
    const r = clasificarErrorMikrotik(new Error('no such item'));
    expect(r.clase).toBe('reintentable'); // default de clasificarError() para Error genérico
  });
});
