import * as fs from 'fs';
import * as path from 'path';
import { EstadoContrato } from './entities/contrato.entity';

const SRC = path.join(__dirname, '..', '..');

const sinComentarios = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/^\s*--.*$/gm, '');

const ficheros: string[] = [];
(function recorrer(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'migrations') recorrer(p); }
    else if (e.name.endsWith('.ts') && !e.name.includes('.spec.')) ficheros.push(p);
  }
})(SRC);

/**
 * Fase 1 del plan del core — **tres estados y nada más** (2026-08-09).
 *
 * `cortado` no describía un estado distinto del servicio: el abonado está sin él tanto en
 * `suspendido` como en `cortado`. Describía **por qué** se llegó ahí —había roto una prórroga—, y
 * eso es la causa de una transición, no un estado.
 *
 * Mientras vivió como estado partía en dos todas las consultas que preguntan «¿tiene servicio?», y
 * cada autor tenía que acordarse de escribir `IN ('suspendido', 'cortado')`. Unas se acordaban y
 * otras no: el reconciliador de PPPoE, por ejemplo, solo marcaba inconsistencia para `cortado`.
 *
 * El valor sigue vivo en el enum de PostgreSQL —borrarlo es irreversible y no aporta nada, igual
 * que con `moroso`—, así que lo único que sostiene la decisión es esta barrera.
 */
describe('Fase 1 · Tres estados: cortado está retirado', () => {
  it('ninguna transición lleva a CORTADO', () => {
    const servicio = sinComentarios(
      fs.readFileSync(path.join(SRC, 'modules', 'contratos', 'contratos.service.ts'), 'utf8'),
    );
    const maquina = servicio.slice(
      servicio.indexOf('const TRANSICIONES'),
      servicio.indexOf('};', servicio.indexOf('const TRANSICIONES')),
    );
    // Puede figurar como ORIGEN (con destinos vacíos), nunca como destino de otro estado.
    const destinos = maquina
      .split('\n')
      .filter((l) => l.includes(':'))
      .map((l) => l.slice(l.indexOf(':') + 1));
    expect(destinos.join(' ')).not.toContain('CORTADO');
  });

  it('nadie ESCRIBE el estado en la base', () => {
    const infractores = ficheros.filter((f) => {
      const s = sinComentarios(fs.readFileSync(f, 'utf8'));
      return /estado\s*=\s*'cortado'/.test(s)          // UPDATE ... SET estado = 'cortado'
          || /estado\s*:\s*EstadoContrato\.CORTADO/.test(s)  // repo.save({ estado: ... })
          || /'cortado'\s*,\s*'[^']*',\s*TRUE\)/.test(s);    // INSERT de historial
    });
    expect(infractores.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('ninguna consulta vuelve a partir en dos «sin servicio»', () => {
    // El defecto original: cada autor decidiendo por su cuenta si acordarse del segundo estado.
    const infractores = ficheros.filter((f) => {
      const s = sinComentarios(fs.readFileSync(f, 'utf8'));
      return /'suspendido'\s*,\s*'cortado'/.test(s)
          || /'cortado'\s*,\s*'suspendido'/.test(s)
          || /SUSPENDIDO\s*,\s*EstadoContrato\.CORTADO/.test(s);
    });
    expect(infractores.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('el enum conserva el valor — retirarlo de PostgreSQL sería irreversible', () => {
    // Que exista no es el problema; el problema sería que alguien lo asignara.
    expect(EstadoContrato.CORTADO).toBe('cortado');
  });
});
