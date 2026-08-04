import { DominiosService, dominioErp, dominioWeb } from './dominios.service';

/**
 * Esquema de hosts por rol.
 *
 * La propiedad que estos tests protegen es la que más fácil se rompe sin querer: **el ERP
 * no está atado a ningún dominio, subdominio ni IP**. Una instalación en una LAN sin DNS
 * es tan válida como una con tres subdominios y certificado, y ninguna de las dos puede
 * ser un caso especial en el código.
 */
describe('DominiosService', () => {
  let service: DominiosService;
  const entornoOriginal = { ...process.env };

  beforeEach(() => {
    service = new DominiosService();
    delete process.env.ERP_DOMAIN;
    delete process.env.APP_DOMAIN;
    delete process.env.PORTAL_DOMAIN;
    delete process.env.WEB_DOMAIN;
  });

  afterAll(() => { process.env = entornoOriginal; });

  const estadoDe = (rol: string, declarados: any = {}) =>
    service.evaluar(declarados).find((e) => e.rol === rol)!;

  // ───────────────────────────────────────────────────────────────
  describe('una instalación sin dominios es válida', () => {

    it('sin ninguna variable, los tres roles son coherentes', () => {
      // Es el caso de una instalación servida por IP, en una LAN o en un VPS sin DNS.
      // Que esto genere advertencias sería empujar a configurar algo que no hace falta.
      const estados = service.evaluar({});
      expect(estados.every((e) => e.coherente)).toBe(true);
      expect(estados.every((e) => e.configurado === null)).toBe(true);
    });

    it('lo dice explícitamente en vez de callarlo', () => {
      expect(estadoDe('erp').mensaje).toContain('por IP');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('periodo de gracia del renombrado', () => {

    it('ERP_DOMAIN es el nombre nuevo', () => {
      process.env.ERP_DOMAIN = 'erp.miempresa.pe';
      expect(dominioErp()).toBe('erp.miempresa.pe');
    });

    it('APP_DOMAIN sigue funcionando: una instalación vieja no se rompe al actualizar', () => {
      // Sin este respaldo, actualizar dejaría a nginx sin `server_name` — es decir, el
      // ERP inaccesible— en toda instalación que aún use el nombre anterior.
      process.env.APP_DOMAIN = 'app.miempresa.pe';
      expect(dominioErp()).toBe('app.miempresa.pe');
    });

    it('ERP_DOMAIN gana cuando están los dos', () => {
      process.env.ERP_DOMAIN = 'erp.miempresa.pe';
      process.env.APP_DOMAIN = 'viejo.miempresa.pe';
      expect(dominioErp()).toBe('erp.miempresa.pe');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('el marcador de web sin configurar', () => {

    it('web.invalid se traduce a "no configurado"', () => {
      // docker-compose lo pasa cuando no hay WEB_DOMAIN: nginx no admite plantillas
      // condicionales, así que el vhost existe siempre con un nombre que ningún DNS
      // resuelve (TLD reservado por la RFC 2606).
      process.env.WEB_DOMAIN = 'web.invalid';
      expect(dominioWeb()).toBeNull();
    });

    it('un dominio real de web sí se reconoce', () => {
      process.env.WEB_DOMAIN = 'miempresa.pe';
      expect(dominioWeb()).toBe('miempresa.pe');
    });
  });

  // ───────────────────────────────────────────────────────────────
  describe('discrepancia entre lo que se sirve y lo que el ERP dice', () => {

    it('detecta que el ERP enviaría enlaces a un host que no se sirve', () => {
      // Es el fallo silencioso que esta clase existe para evitar: nadie se entera hasta
      // que un abonado llama porque el enlace del aviso no abre.
      process.env.PORTAL_DOMAIN = 'cliente.miempresa.pe';
      const e = estadoDe('portal', { portal: 'portal.otracosa.pe' });

      expect(e.coherente).toBe(false);
      expect(e.mensaje).toContain('DISCREPANCIA');
      expect(e.mensaje).toContain('cliente.miempresa.pe');
      expect(e.mensaje).toContain('portal.otracosa.pe');
    });

    it('coinciden → coherente', () => {
      process.env.ERP_DOMAIN = 'erp.miempresa.pe';
      expect(estadoDe('erp', { erp: 'erp.miempresa.pe' }).coherente).toBe(true);
    });

    it('normaliza lo que el operador haya escrito: esquema, puerto y barra final', () => {
      // El campo del panel es texto libre; rechazar "https://erp.miempresa.pe/" por un
      // detalle de formato sería hacerle perder el tiempo por nada.
      process.env.ERP_DOMAIN = 'erp.miempresa.pe';
      for (const escrito of [
        'https://erp.miempresa.pe',
        'http://erp.miempresa.pe/',
        'ERP.MiEmpresa.PE',
        'erp.miempresa.pe:443',
      ]) {
        expect(estadoDe('erp', { erp: escrito }).coherente).toBe(true);
      }
    });

    it('un dominio guardado sin publicar avisa, pero NO se marca incoherente', () => {
      // Es un estado de transición legítimo: alguien lo guardó antes de tocar el .env.
      // Marcarlo como error obligaría a hacer las dos cosas en el mismo minuto.
      const e = estadoDe('erp', { erp: 'erp.miempresa.pe' });
      expect(e.coherente).toBe(true);
      expect(e.mensaje).toContain('no lo publica');
    });

    it('publicado pero sin guardar: avisa para que los enlaces se construyan bien', () => {
      process.env.ERP_DOMAIN = 'erp.miempresa.pe';
      const e = estadoDe('erp', {});
      expect(e.coherente).toBe(true);
      expect(e.mensaje).toContain('Falta guardarlo');
    });
  });

  // ───────────────────────────────────────────────────────────────
  it('las variables se leen en cada llamada, no al cargar el módulo', () => {
    // Las constantes de nivel de módulo en NestJS se evalúan ANTES de que ConfigModule
    // lea el .env, así que quedarían vacías para siempre. Directriz de portabilidad
    // multi-VPS: lazy getters, nunca constantes.
    expect(dominioErp()).toBeNull();
    process.env.ERP_DOMAIN = 'tardio.miempresa.pe';
    expect(dominioErp()).toBe('tardio.miempresa.pe');
  });
});
