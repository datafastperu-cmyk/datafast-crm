// ═══════════════════════════════════════════════════════════════
// DATAFAST ISP · Mock Data Central
// Todos los módulos usan este archivo como fuente de datos visual.
// Reemplazar imports con llamadas API cuando se integre el backend.
// ═══════════════════════════════════════════════════════════════

// ─── TIPOS EXTENDIDOS ─────────────────────────────────────────
export interface Tecnico {
  id: string; nombre: string; telefono: string; zona: string;
  estado: 'disponible' | 'en_trabajo' | 'descanso' | 'inactivo';
  trabajosHoy: number; trabajosMes: number;
  especialidad: string; fotoPerfil?: string;
}

export interface ItemInventario {
  id: string; nombre: string; codigo: string; categoria: string;
  cantidad: number; minimo: number; unidad: string;
  precioUnitario: number; proveedor: string;
  estado: 'disponible' | 'bajo_stock' | 'agotado' | 'reservado';
  ubicacion: string; ultimaEntrada: string;
}

export interface MovimientoCaja {
  id: string; tipo: 'ingreso' | 'egreso'; monto: number;
  descripcion: string; categoria: string; metodo: string;
  operador: string; hora: string; referencia?: string;
}

export interface SesionPppoe {
  id: string; usuario: string; ipAsignada: string; ipServicio: string;
  macAddress: string; interfaz: string; tiempo: string;
  rxMbps: number; txMbps: number; rxTotal: string; txTotal: string;
  routerNombre: string; estado: 'activa' | 'inactiva';
}

export interface LeaseDhcp {
  id: string; hostname: string; ipAsignada: string; macAddress: string;
  clienteId?: string; clienteNombre?: string;
  expira: string; estado: 'activo' | 'expirado' | 'estatico';
  servidor: string; interfaz: string;
}

export interface ColaSimple {
  id: string; nombre: string; objetivo: string; ipOrigen: string;
  limiteBajada: string; limitSubida: string;
  usoBajada: number; usoSubida: number;
  prioridad: number; estado: 'activa' | 'inactiva';
  clienteNombre?: string;
}

export interface CanalIptv {
  id: string; nombre: string; numero: number; categoria: string;
  url: string; logo: string; activo: boolean; hd: boolean;
}

export interface ClienteIptv {
  id: string; nombre: string; plan: string;
  dispositivos: number; estado: 'activo' | 'suspendido';
  fechaVencimiento: string; mac: string;
}

export interface EventoLog {
  id: string; nivel: 'info' | 'warning' | 'error' | 'debug';
  modulo: string; mensaje: string;
  usuario?: string; ip?: string;
  timestamp: string; detalles?: string;
}

export interface ContactoWhatsapp {
  id: string; nombre: string; telefono: string;
  estado: 'entregado' | 'leido' | 'error' | 'pendiente';
  mensaje: string; tipo: 'factura' | 'corte' | 'recordatorio' | 'bienvenida';
  enviado: string;
}

// ─── DASHBOARD STATS ────────────────────────────────────────────
export const mockDashboardStats = {
  clientes:    { total: 1_847, activos: 1_634, morosos: 127, nuevosHoy: 4, nuevosMes: 38 },
  contratos:   { total: 1_689, activos: 1_567, suspendidos: 89, porVencer: 23 },
  facturacion: { cobradoHoy: 4_280, cobradoMes: 62_450, cuentasPorCobrar: 18_320, tasaCobranza: 87.4, meta: 72_000 },
  nodos:       { total: 25, online: 22, offline: 2, degradado: 1 },
  alertas:     { activas: 5, criticas: 1, warnings: 4 },
  tickets:     { abiertos: 12, urgentes: 3, resueltosMes: 87 },
  pppoe:       { sesionesActivas: 1_247, pico24h: 1_389 },
  banda:       { totalRxMbps: 2_840, totalTxMbps: 384, capacidad: 4_000 },
};

export const mockTrafico24h = Array.from({ length: 24 }, (_, h) => {
  const base = 1200 + Math.sin((h / 24) * Math.PI * 2) * 600;
  const noise = Math.random() * 200 - 100;
  return {
    hora: `${String(h).padStart(2, '0')}:00`,
    rx: Math.max(80, Math.round(base + noise)),
    tx: Math.max(20, Math.round((base + noise) * 0.14)),
  };
});

export const mockTrafico7d = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((dia, i) => ({
  dia,
  rx: 1800 + Math.round(Math.random() * 600 + (i < 5 ? 400 : -200)),
  tx: 240 + Math.round(Math.random() * 80),
}));

// ─── NODOS / ROUTERS ────────────────────────────────────────────
export const mockNodos = [
  { id: 'n1', nombre: 'CORE-LIMA-01',     tipo: 'router', ipMonitoreo: '10.0.1.1',   estado: 'online',   latenciaMs: 1,   perdidaPct: 0,   cpuUsoPct: 34, memoriaUsoPct: 58, traficoRxBps: 312_000_000, traficoTxBps: 42_000_000, sesionesPppoe: 342, ultimoPing: new Date().toISOString() },
  { id: 'n2', nombre: 'DIST-SJL-01',      tipo: 'router', ipMonitoreo: '10.0.2.1',   estado: 'online',   latenciaMs: 4,   perdidaPct: 0,   cpuUsoPct: 22, memoriaUsoPct: 41, traficoRxBps: 198_000_000, traficoTxBps: 28_000_000, sesionesPppoe: 215, ultimoPing: new Date().toISOString() },
  { id: 'n3', nombre: 'DIST-CALLAO-01',   tipo: 'router', ipMonitoreo: '10.0.3.1',   estado: 'online',   latenciaMs: 3,   perdidaPct: 0,   cpuUsoPct: 45, memoriaUsoPct: 63, traficoRxBps: 245_000_000, traficoTxBps: 33_000_000, sesionesPppoe: 287, ultimoPing: new Date().toISOString() },
  { id: 'n4', nombre: 'DIST-ATE-01',      tipo: 'router', ipMonitoreo: '10.0.4.1',   estado: 'online',   latenciaMs: 6,   perdidaPct: 0,   cpuUsoPct: 18, memoriaUsoPct: 38, traficoRxBps: 156_000_000, traficoTxBps: 21_000_000, sesionesPppoe: 178, ultimoPing: new Date().toISOString() },
  { id: 'n5', nombre: 'DIST-VMT-01',      tipo: 'router', ipMonitoreo: '10.0.5.1',   estado: 'online',   latenciaMs: 5,   perdidaPct: 0,   cpuUsoPct: 29, memoriaUsoPct: 44, traficoRxBps: 134_000_000, traficoTxBps: 18_000_000, sesionesPppoe: 156, ultimoPing: new Date().toISOString() },
  { id: 'n6', nombre: 'DIST-SMP-01',      tipo: 'router', ipMonitoreo: '10.0.6.1',   estado: 'degradado',latenciaMs: 38,  perdidaPct: 4.2, cpuUsoPct: 87, memoriaUsoPct: 91, traficoRxBps: 98_000_000,  traficoTxBps: 13_000_000, sesionesPppoe: 92,  ultimoPing: new Date().toISOString() },
  { id: 'n7', nombre: 'ACCESS-SJL-02',    tipo: 'router', ipMonitoreo: '10.0.7.1',   estado: 'online',   latenciaMs: 8,   perdidaPct: 0,   cpuUsoPct: 31, memoriaUsoPct: 52, traficoRxBps: 87_000_000,  traficoTxBps: 12_000_000, sesionesPppoe: 98,  ultimoPing: new Date().toISOString() },
  { id: 'n8', nombre: 'ACCESS-CALLAO-02', tipo: 'router', ipMonitoreo: '10.0.8.1',   estado: 'online',   latenciaMs: 7,   perdidaPct: 0,   cpuUsoPct: 25, memoriaUsoPct: 47, traficoRxBps: 76_000_000,  traficoTxBps: 10_000_000, sesionesPppoe: 87,  ultimoPing: new Date().toISOString() },
  { id: 'n9', nombre: 'OLT-SJL-01',       tipo: 'olt',    ipMonitoreo: '10.0.9.1',   estado: 'online',   latenciaMs: 2,   perdidaPct: 0,   cpuUsoPct: 12, memoriaUsoPct: 28, traficoRxBps: 420_000_000, traficoTxBps: 60_000_000, sesionesPppoe: 0,   ultimoPing: new Date().toISOString() },
  { id:'n10', nombre: 'OLT-CALLAO-01',     tipo: 'olt',    ipMonitoreo: '10.0.10.1',  estado: 'online',   latenciaMs: 3,   perdidaPct: 0,   cpuUsoPct: 15, memoriaUsoPct: 31, traficoRxBps: 380_000_000, traficoTxBps: 52_000_000, sesionesPppoe: 0,   ultimoPing: new Date().toISOString() },
  { id:'n11', nombre: 'ACCESS-VMT-02',     tipo: 'router', ipMonitoreo: '10.0.11.1',  estado: 'offline',  latenciaMs: null as number | null,perdidaPct: 100, cpuUsoPct: 0,  memoriaUsoPct: 0,  traficoRxBps: 0,           traficoTxBps: 0,           sesionesPppoe: 0,   ultimoPing: new Date(Date.now() - 3600000).toISOString() },
  { id:'n12', nombre: 'ACCESS-ATE-02',     tipo: 'router', ipMonitoreo: '10.0.12.1',  estado: 'offline',  latenciaMs: null as number | null,perdidaPct: 100, cpuUsoPct: 0,  memoriaUsoPct: 0,  traficoRxBps: 0,           traficoTxBps: 0,           sesionesPppoe: 0,   ultimoPing: new Date(Date.now() - 1800000).toISOString() },
] as const;

// ─── CLIENTES ───────────────────────────────────────────────────
export const mockClientes = [
  { id:'c1',  nombres:'Juan Carlos',   apellidoPaterno:'Quispe',    apellidoMaterno:'Mamani',   nombreCompleto:'Juan Carlos Quispe Mamani',   tipoDocumento:'dni', numeroDocumento:'42381945', email:'jcquispe@gmail.com',    telefono:'944123456', direccion:'Jr. Huancayo 234, SJL',          estado:'activo',    plan:'Premium 100M', precio:89.00, deuda:0 },
  { id:'c2',  nombres:'María Elena',   apellidoPaterno:'Torres',    apellidoMaterno:'Vargas',   nombreCompleto:'María Elena Torres Vargas',   tipoDocumento:'dni', numeroDocumento:'38742156', email:'metorres@hotmail.com',  telefono:'956234567', direccion:'Av. Próceres 1240, SJL',         estado:'moroso',    plan:'Estándar 50M', precio:59.00, deuda:118.00 },
  { id:'c3',  nombres:'Roberto',       apellidoPaterno:'Chávez',    apellidoMaterno:'Luna',     nombreCompleto:'Roberto Chávez Luna',         tipoDocumento:'dni', numeroDocumento:'29847563', email:'rchavez@empresa.pe',    telefono:'921345678', direccion:'Cal. Los Álamos 78, Callao',      estado:'activo',    plan:'Empresarial 200M', precio:189.00, deuda:0 },
  { id:'c4',  nombres:'Lucía',         apellidoPaterno:'Mendoza',   apellidoMaterno:'Flores',   nombreCompleto:'Lucía Mendoza Flores',        tipoDocumento:'dni', numeroDocumento:'45623178', email:'lmendoza@gmail.com',    telefono:'978456789', direccion:'Av. Metropolitana 560, ATE',      estado:'activo',    plan:'Básico 20M', precio:35.00, deuda:0 },
  { id:'c5',  nombres:'Carlos Alberto',apellidoPaterno:'Rojas',     apellidoMaterno:'Herrera',  nombreCompleto:'Carlos Alberto Rojas Herrera',tipoDocumento:'dni', numeroDocumento:'33218745', email:'carojas@gmail.com',     telefono:'994567890', direccion:'Jr. Los Rosales 123, VMT',        estado:'suspendido', plan:'Estándar 50M', precio:59.00, deuda:177.00 },
  { id:'c6',  nombres:'Ana María',     apellidoPaterno:'Huanca',    apellidoMaterno:'Ccopa',    nombreCompleto:'Ana María Huanca Ccopa',      tipoDocumento:'dni', numeroDocumento:'47812356', email:'amhuanca@outlook.com',  telefono:'912678901', direccion:'Av. San Martín 890, SMP',         estado:'activo',    plan:'Premium 100M', precio:89.00, deuda:0 },
  { id:'c7',  nombres:'Pedro',         apellidoPaterno:'Sánchez',   apellidoMaterno:'Medina',   nombreCompleto:'Pedro Sánchez Medina',        tipoDocumento:'dni', numeroDocumento:'26543917', email:'psanchez@gmail.com',    telefono:'965789012', direccion:'Jr. Tupac Amaru 445, Callao',     estado:'activo',    plan:'Básico 20M', precio:35.00, deuda:0 },
  { id:'c8',  nombres:'Rosa',          apellidoPaterno:'Palomino',  apellidoMaterno:'Quispe',   nombreCompleto:'Rosa Palomino Quispe',        tipoDocumento:'dni', numeroDocumento:'31456289', email:'rpalomino@gmail.com',   telefono:'948901234', direccion:'Urb. Los Jardines 234, SJL',      estado:'activo',    plan:'Estándar 50M', precio:59.00, deuda:0 },
  { id:'c9',  nombres:'Jorge Luis',    apellidoPaterno:'Ccori',     apellidoMaterno:'Mamani',   nombreCompleto:'Jorge Luis Ccori Mamani',     tipoDocumento:'ruc', numeroDocumento:'20512345678', email:'jccori@empresa.pe', telefono:'981234567', direccion:'Av. Industrial 1200, ATE',        estado:'activo',    plan:'Empresarial 200M', precio:189.00, deuda:0 },
  { id:'c10', nombres:'Fiorella',      apellidoPaterno:'Castillo',  apellidoMaterno:'Ruiz',     nombreCompleto:'Fiorella Castillo Ruiz',      tipoDocumento:'dni', numeroDocumento:'53678923', email:'fcastillo@hotmail.com', telefono:'935678901', direccion:'Cal. Primavera 67, VMT',          estado:'moroso',    plan:'Estándar 50M', precio:59.00, deuda:59.00 },
  { id:'c11', nombres:'Miguel Ángel',  apellidoPaterno:'Vargas',    apellidoMaterno:'Torres',   nombreCompleto:'Miguel Ángel Vargas Torres',  tipoDocumento:'dni', numeroDocumento:'40123567', email:'mavargas@gmail.com',    telefono:'912345678', direccion:'Jr. Pachacútec 789, SJL',         estado:'activo',    plan:'Premium 100M', precio:89.00, deuda:0 },
  { id:'c12', nombres:'Carmen',        apellidoPaterno:'Huaylla',   apellidoMaterno:'Condori',  nombreCompleto:'Carmen Huaylla Condori',      tipoDocumento:'dni', numeroDocumento:'36789234', email:'chuaylla@gmail.com',    telefono:'956789012', direccion:'Av. Lima 2340, Callao',           estado:'activo',    plan:'Básico 20M', precio:35.00, deuda:0 },
  { id:'c13', nombres:'Luis Fernando', apellidoPaterno:'Gutiérrez', apellidoMaterno:'Ponce',    nombreCompleto:'Luis Fernando Gutiérrez Ponce',tipoDocumento:'dni', numeroDocumento:'28934561', email:'lfgutierrez@gmail.com', telefono:'994123456', direccion:'Urb. Santa Rosa 120, ATE',        estado:'activo',    plan:'Estándar 50M', precio:59.00, deuda:0 },
  { id:'c14', nombres:'Katherin',      apellidoPaterno:'Mamani',    apellidoMaterno:'Larico',   nombreCompleto:'Katherin Mamani Larico',      tipoDocumento:'dni', numeroDocumento:'61234897', email:'kmamani@outlook.com',   telefono:'978234567', direccion:'Jr. Los Pinos 456, SMP',          estado:'activo',    plan:'Premium 100M', precio:89.00, deuda:0 },
  { id:'c15', nombres:'Empresa',       apellidoPaterno:'DataTech',  apellidoMaterno:'SAC',      nombreCompleto:'DataTech SAC',                tipoDocumento:'ruc', numeroDocumento:'20678912345', email:'admin@datatech.pe', telefono:'014523678', direccion:'Av. Argentina 3400, Callao',      estado:'activo',    plan:'Dedicado 500M', precio:490.00, deuda:0 },
];

// ─── FACTURAS ───────────────────────────────────────────────────
const meses = ['Ene','Feb','Mar','Abr','May','Jun'];
export const mockFacturas = mockClientes.slice(0, 12).flatMap((c, ci) =>
  meses.slice(0, 3).map((mes, mi) => ({
    id: `f${ci * 3 + mi + 1}`,
    numeroCompleto: `B001-${String(ci * 3 + mi + 1001).padStart(6,'0')}`,
    clienteId: c.id, clienteNombre: c.nombreCompleto,
    descripcion: `Servicio Internet ${mes} 2025 - ${c.plan}`,
    total: c.precio,
    montoPagado: mi < 2 ? c.precio : (ci % 3 === 1 ? 0 : c.precio),
    estado: mi < 2 ? 'pagada' : (ci % 3 === 1 ? 'vencida' : 'pagada'),
    fechaEmision: `2025-${String(mi + 3).padStart(2,'0')}-01`,
    fechaVencimiento: `2025-${String(mi + 3).padStart(2,'0')}-15`,
    tipoComprobante: 'boleta',
  }))
);

// ─── PAGOS RECIENTES ────────────────────────────────────────────
export const mockPagos = [
  { id:'p1',  clienteId:'c1',  clienteNombre:'Juan Carlos Quispe',      monto:89.00,  metodoPago:'yape',                 estado:'verificado', fechaPago:'2025-05-15T08:23:00', banco:'' },
  { id:'p2',  clienteId:'c3',  clienteNombre:'Roberto Chávez Luna',     monto:189.00, metodoPago:'transferencia_bancaria',estado:'verificado', fechaPago:'2025-05-15T09:14:00', banco:'BCP' },
  { id:'p3',  clienteId:'c6',  clienteNombre:'Ana María Huanca',        monto:89.00,  metodoPago:'efectivo',             estado:'verificado', fechaPago:'2025-05-15T09:45:00', banco:'' },
  { id:'p4',  clienteId:'c8',  clienteNombre:'Rosa Palomino Quispe',    monto:59.00,  metodoPago:'plin',                 estado:'verificado', fechaPago:'2025-05-15T10:12:00', banco:'' },
  { id:'p5',  clienteId:'c11', clienteNombre:'Miguel Ángel Vargas',     monto:89.00,  metodoPago:'yape',                 estado:'verificado', fechaPago:'2025-05-15T10:38:00', banco:'' },
  { id:'p6',  clienteId:'c14', clienteNombre:'Katherin Mamani',         monto:89.00,  metodoPago:'yape',                 estado:'verificado', fechaPago:'2025-05-15T11:05:00', banco:'' },
  { id:'p7',  clienteId:'c15', clienteNombre:'DataTech SAC',            monto:490.00, metodoPago:'transferencia_bancaria',estado:'pendiente_verificacion', fechaPago:'2025-05-15T11:22:00', banco:'BBVA' },
  { id:'p8',  clienteId:'c13', clienteNombre:'Luis Fernando Gutiérrez', monto:59.00,  metodoPago:'efectivo',             estado:'verificado', fechaPago:'2025-05-15T12:00:00', banco:'' },
  { id:'p9',  clienteId:'c4',  clienteNombre:'Lucía Mendoza Flores',    monto:35.00,  metodoPago:'yape',                 estado:'verificado', fechaPago:'2025-05-15T12:35:00', banco:'' },
  { id:'p10', clienteId:'c7',  clienteNombre:'Pedro Sánchez Medina',    monto:35.00,  metodoPago:'plin',                 estado:'verificado', fechaPago:'2025-05-15T13:18:00', banco:'' },
];

// ─── ALERTAS ────────────────────────────────────────────────────
export const mockAlertas = [
  { id:'a1', nodoId:'n6', nodoNombre:'DIST-SMP-01',    nivel:'critical', estado:'activa',  metrica:'cpu',     mensaje:'CPU al 87% - posible sobrecarga',    valorActual:87, umbral:80, createdAt:'2025-05-15T10:20:00', duracionMinutos:35 },
  { id:'a2', nodoId:'n11',nodoNombre:'ACCESS-VMT-02',  nivel:'critical', estado:'activa',  metrica:'ping',    mensaje:'Equipo sin respuesta por 60 min',    valorActual:100,umbral:5,  createdAt:'2025-05-15T09:00:00', duracionMinutos:95 },
  { id:'a3', nodoId:'n12',nodoNombre:'ACCESS-ATE-02',  nivel:'warning',  estado:'activa',  metrica:'ping',    mensaje:'Alta pérdida de paquetes 4.2%',      valorActual:4.2,umbral:2,  createdAt:'2025-05-15T11:30:00', duracionMinutos:25 },
  { id:'a4', nodoId:'n6', nodoNombre:'DIST-SMP-01',    nivel:'warning',  estado:'activa',  metrica:'memoria', mensaje:'Memoria al 91% - limpiar caché',     valorActual:91, umbral:85, createdAt:'2025-05-15T10:25:00', duracionMinutos:30 },
  { id:'a5', nodoId:'n1', nodoNombre:'CORE-LIMA-01',   nivel:'info',     estado:'activa',  metrica:'trafico', mensaje:'Tráfico RX superior al 78% capacidad',valorActual:78, umbral:75, createdAt:'2025-05-15T12:00:00', duracionMinutos:15 },
];

// ─── TICKETS ────────────────────────────────────────────────────
export const mockTickets = [
  { id:'t1',  asunto:'Sin internet desde ayer tarde',      clienteId:'c2',  clienteNombre:'María Torres',    prioridad:'alta',   estado:'nuevo',      categoria:'falla_tecnica',  createdAt:'2025-05-15T07:30:00', operador:null },
  { id:'t2',  asunto:'Velocidad lenta en horas pico',      clienteId:'c5',  clienteNombre:'Carlos Rojas',    prioridad:'media',  estado:'en_progreso', categoria:'calidad',        createdAt:'2025-05-15T08:45:00', operador:'Técnico Lima' },
  { id:'t3',  asunto:'Factura con monto incorrecto',       clienteId:'c10', clienteNombre:'Fiorella Castillo',prioridad:'media', estado:'nuevo',       categoria:'facturacion',    createdAt:'2025-05-15T09:15:00', operador:null },
  { id:'t4',  asunto:'Solicitud de cambio de plan',        clienteId:'c4',  clienteNombre:'Lucía Mendoza',   prioridad:'baja',   estado:'nuevo',       categoria:'comercial',      createdAt:'2025-05-15T10:00:00', operador:null },
  { id:'t5',  asunto:'Instalación pendiente - nuevo',      clienteId:'c11', clienteNombre:'Miguel Vargas',   prioridad:'alta',   estado:'en_progreso', categoria:'instalacion',    createdAt:'2025-05-14T14:30:00', operador:'Carlos Técnico' },
  { id:'t6',  asunto:'Router WiFi no funciona',            clienteId:'c7',  clienteNombre:'Pedro Sánchez',   prioridad:'media',  estado:'contestado',  categoria:'falla_tecnica',  createdAt:'2025-05-14T11:20:00', operador:'Soporte L1' },
  { id:'t7',  asunto:'Solicitud de IP fija',               clienteId:'c9',  clienteNombre:'Jorge Ccori SAC', prioridad:'alta',   estado:'en_progreso', categoria:'configuracion',  createdAt:'2025-05-14T09:00:00', operador:'Redes' },
  { id:'t8',  asunto:'Corte de servicio - pago realizado', clienteId:'c5',  clienteNombre:'Carlos Rojas',    prioridad:'urgente',estado:'nuevo',       categoria:'facturacion',    createdAt:'2025-05-15T13:10:00', operador:null },
];

// ─── TÉCNICOS ───────────────────────────────────────────────────
export const mockTecnicos: Tecnico[] = [
  { id:'tech1', nombre:'Carlos Mamani Quispe',    telefono:'944 234 567', zona:'SJL - Este',    estado:'en_trabajo',  trabajosHoy:3, trabajosMes:47, especialidad:'FTTH/GPON' },
  { id:'tech2', nombre:'Roberto Silva Torres',    telefono:'956 345 678', zona:'Callao',         estado:'disponible',  trabajosHoy:5, trabajosMes:52, especialidad:'Wireless/WISP' },
  { id:'tech3', nombre:'Diego Flores Pariona',    telefono:'921 456 789', zona:'ATE - Vitarte',  estado:'disponible',  trabajosHoy:4, trabajosMes:38, especialidad:'FTTH/PPPoE' },
  { id:'tech4', nombre:'Jhon Ccori Mamani',       telefono:'978 567 890', zona:'VMT - Sur',      estado:'descanso',    trabajosHoy:2, trabajosMes:41, especialidad:'Wireless/OLT' },
  { id:'tech5', nombre:'Fernando Gutierrez Ruiz', telefono:'994 678 901', zona:'SMP - Norte',    estado:'en_trabajo',  trabajosHoy:6, trabajosMes:55, especialidad:'FTTH/Config' },
];

// ─── INVENTARIO ─────────────────────────────────────────────────
export const mockInventario: ItemInventario[] = [
  { id:'inv1',  nombre:'Router MikroTik hAP ac3',    codigo:'MT-HAP-AC3',   categoria:'Router',        cantidad:8,   minimo:3,  unidad:'und', precioUnitario:185.00, proveedor:'TechPeru SAC',    estado:'disponible', ubicacion:'Almacén A1', ultimaEntrada:'2025-05-02' },
  { id:'inv2',  nombre:'Router MikroTik RB750Gr3',   codigo:'MT-RB750',     categoria:'Router',        cantidad:2,   minimo:5,  unidad:'und', precioUnitario:145.00, proveedor:'TechPeru SAC',    estado:'bajo_stock',  ubicacion:'Almacén A1', ultimaEntrada:'2025-04-15' },
  { id:'inv3',  nombre:'ONU ZTE F660',               codigo:'ZTE-F660',     categoria:'ONU/ONT',       cantidad:45,  minimo:10, unidad:'und', precioUnitario:68.00,  proveedor:'DataNet SRL',     estado:'disponible', ubicacion:'Almacén B2', ultimaEntrada:'2025-05-10' },
  { id:'inv4',  nombre:'ONU ZTE F680',               codigo:'ZTE-F680',     categoria:'ONU/ONT',       cantidad:32,  minimo:10, unidad:'und', precioUnitario:89.00,  proveedor:'DataNet SRL',     estado:'disponible', ubicacion:'Almacén B2', ultimaEntrada:'2025-05-10' },
  { id:'inv5',  nombre:'Cable Fibra Óptica G.657 1m',codigo:'FO-G657-1M',   categoria:'Cable FO',      cantidad:0,   minimo:100,unidad:'m',   precioUnitario:1.20,   proveedor:'FiberMax Perú',   estado:'agotado',    ubicacion:'Almacén C3', ultimaEntrada:'2025-03-20' },
  { id:'inv6',  nombre:'Cable Fibra Óptica G.652 2km',codigo:'FO-G652-2K',  categoria:'Cable FO',      cantidad:4,   minimo:2,  unidad:'rollo',precioUnitario:380.00, proveedor:'FiberMax Perú',   estado:'disponible', ubicacion:'Almacén C3', ultimaEntrada:'2025-05-05' },
  { id:'inv7',  nombre:'Splitter PLC 1x8',           codigo:'SPL-1X8',      categoria:'Splitter',      cantidad:28,  minimo:10, unidad:'und', precioUnitario:22.00,  proveedor:'DataNet SRL',     estado:'disponible', ubicacion:'Almacén B3', ultimaEntrada:'2025-05-08' },
  { id:'inv8',  nombre:'Splitter PLC 1x16',          codigo:'SPL-1X16',     categoria:'Splitter',      cantidad:3,   minimo:5,  unidad:'und', precioUnitario:38.00,  proveedor:'DataNet SRL',     estado:'bajo_stock',  ubicacion:'Almacén B3', ultimaEntrada:'2025-04-22' },
  { id:'inv9',  nombre:'Fusionadora Fujikura FSM-11S',codigo:'FUSI-FSM11S',  categoria:'Herramienta',   cantidad:2,   minimo:1,  unidad:'und', precioUnitario:4200.00,proveedor:'OpticalTech',     estado:'disponible', ubicacion:'Herramientas', ultimaEntrada:'2025-01-10' },
  { id:'inv10', nombre:'OTDR Grandway FHO5000',      codigo:'OTDR-FHO5000', categoria:'Herramienta',   cantidad:1,   minimo:1,  unidad:'und', precioUnitario:3800.00,proveedor:'OpticalTech',     estado:'disponible', ubicacion:'Herramientas', ultimaEntrada:'2025-01-10' },
  { id:'inv11', nombre:'Patch cord SC/APC-SC/APC 1m',codigo:'PC-SCAPC-1M',  categoria:'Conectores',    cantidad:120, minimo:30, unidad:'und', precioUnitario:8.50,   proveedor:'FiberMax Perú',   estado:'disponible', ubicacion:'Almacén B4', ultimaEntrada:'2025-05-12' },
  { id:'inv12', nombre:'Bandeja de empalme 24 fibras',codigo:'BE-24F',       categoria:'Accesorios FO', cantidad:15,  minimo:5,  unidad:'und', precioUnitario:45.00,  proveedor:'DataNet SRL',     estado:'disponible', ubicacion:'Almacén B2', ultimaEntrada:'2025-05-01' },
];

// ─── CAJA (MOVIMIENTOS DEL DÍA) ─────────────────────────────────
export const mockMovimientosCaja: MovimientoCaja[] = [
  { id:'mc1',  tipo:'ingreso', monto:89.00,  descripcion:'Pago mensualidad - Juan Quispe',      categoria:'Cobranza', metodo:'Yape',         operador:'Recepción',  hora:'08:23' },
  { id:'mc2',  tipo:'ingreso', monto:189.00, descripcion:'Pago mensualidad - Roberto Chávez',   categoria:'Cobranza', metodo:'Transferencia',operador:'Recepción',  hora:'09:14' },
  { id:'mc3',  tipo:'ingreso', monto:89.00,  descripcion:'Pago mensualidad - Ana Huanca',       categoria:'Cobranza', metodo:'Efectivo',     operador:'Recepción',  hora:'09:45' },
  { id:'mc4',  tipo:'egreso',  monto:150.00, descripcion:'Compra cable FO 100m para SJL',       categoria:'Materiales',metodo:'Efectivo',    operador:'Almacén',    hora:'10:00' },
  { id:'mc5',  tipo:'ingreso', monto:59.00,  descripcion:'Pago mensualidad - Rosa Palomino',    categoria:'Cobranza', metodo:'Plin',         operador:'Recepción',  hora:'10:12' },
  { id:'mc6',  tipo:'egreso',  monto:80.00,  descripcion:'Viáticos técnico Carlos - SJL',       categoria:'Operativo',metodo:'Efectivo',    operador:'RRHH',       hora:'10:30' },
  { id:'mc7',  tipo:'ingreso', monto:89.00,  descripcion:'Pago mensualidad - Miguel Vargas',    categoria:'Cobranza', metodo:'Yape',         operador:'Recepción',  hora:'10:38' },
  { id:'mc8',  tipo:'ingreso', monto:89.00,  descripcion:'Pago mensualidad - Katherin Mamani',  categoria:'Cobranza', metodo:'Yape',         operador:'Recepción',  hora:'11:05' },
  { id:'mc9',  tipo:'egreso',  monto:35.00,  descripcion:'Gasolina moto técnico Diego',         categoria:'Operativo',metodo:'Efectivo',    operador:'Logística',  hora:'11:15' },
  { id:'mc10', tipo:'ingreso', monto:490.00, descripcion:'Pago mensualidad - DataTech SAC',     categoria:'Cobranza', metodo:'Transferencia',operador:'Recepción',  hora:'11:22' },
  { id:'mc11', tipo:'ingreso', monto:59.00,  descripcion:'Pago mensualidad - Luis Gutiérrez',   categoria:'Cobranza', metodo:'Efectivo',     operador:'Recepción',  hora:'12:00' },
  { id:'mc12', tipo:'ingreso', monto:35.00,  descripcion:'Pago conexión nueva - Prospecto',     categoria:'Instalación',metodo:'Efectivo',  operador:'Ventas',     hora:'12:20', referencia:'ORD-2025-089' },
  { id:'mc13', tipo:'egreso',  monto:220.00, descripcion:'Pago proveedor - FiberMax (facturas)',categoria:'Proveedores',metodo:'Transferencia',operador:'Contabilidad',hora:'12:45', referencia:'F001-00234' },
];

// ─── SESIONES PPPOE ─────────────────────────────────────────────
export const mockSesionesPppoe: SesionPppoe[] = [
  { id:'pp1',  usuario:'jcquispe',   ipAsignada:'192.168.1.10',  ipServicio:'10.0.1.10',  macAddress:'6C:3B:6B:AB:CD:01', interfaz:'ether2-LAN', tiempo:'2d 04:23:11', rxMbps:12.4, txMbps:1.2,  rxTotal:'24.8 GB', txTotal:'2.4 GB',  routerNombre:'DIST-SJL-01',    estado:'activa' },
  { id:'pp2',  usuario:'metorres',   ipAsignada:'192.168.1.11',  ipServicio:'10.0.1.11',  macAddress:'6C:3B:6B:AB:CD:02', interfaz:'ether3-LAN', tiempo:'0d 18:45:22', rxMbps:4.2,  txMbps:0.5,  rxTotal:'8.4 GB',  txTotal:'0.9 GB',  routerNombre:'DIST-SJL-01',    estado:'activa' },
  { id:'pp3',  usuario:'rchavez',    ipAsignada:'192.168.2.10',  ipServicio:'10.0.2.10',  macAddress:'AA:BB:CC:DD:EE:01', interfaz:'ether2-LAN', tiempo:'5d 12:01:44', rxMbps:48.7, txMbps:6.8,  rxTotal:'210 GB',  txTotal:'28.4 GB', routerNombre:'DIST-CALLAO-01', estado:'activa' },
  { id:'pp4',  usuario:'lmendoza',   ipAsignada:'192.168.3.10',  ipServicio:'10.0.3.10',  macAddress:'11:22:33:44:55:01', interfaz:'ether4-LAN', tiempo:'1d 02:10:30', rxMbps:2.8,  txMbps:0.3,  rxTotal:'5.6 GB',  txTotal:'0.6 GB',  routerNombre:'DIST-ATE-01',    estado:'activa' },
  { id:'pp5',  usuario:'ahuanca',    ipAsignada:'192.168.5.10',  ipServicio:'10.0.5.10',  macAddress:'55:66:77:88:99:01', interfaz:'ether2-LAN', tiempo:'3d 07:55:01', rxMbps:22.1, txMbps:3.1,  rxTotal:'68.4 GB', txTotal:'9.8 GB',  routerNombre:'DIST-VMT-01',    estado:'activa' },
  { id:'pp6',  usuario:'psanchez',   ipAsignada:'192.168.2.11',  ipServicio:'10.0.2.11',  macAddress:'AA:BB:CC:DD:EE:02', interfaz:'ether3-LAN', tiempo:'0d 06:12:44', rxMbps:1.4,  txMbps:0.2,  rxTotal:'2.8 GB',  txTotal:'0.4 GB',  routerNombre:'DIST-CALLAO-01', estado:'activa' },
  { id:'pp7',  usuario:'rpalomino',  ipAsignada:'192.168.1.12',  ipServicio:'10.0.1.12',  macAddress:'6C:3B:6B:AB:CD:03', interfaz:'ether4-LAN', tiempo:'1d 22:30:11', rxMbps:9.8,  txMbps:1.1,  rxTotal:'19.6 GB', txTotal:'2.2 GB',  routerNombre:'DIST-SJL-01',    estado:'activa' },
  { id:'pp8',  usuario:'jccori',     ipAsignada:'192.168.3.11',  ipServicio:'10.0.3.11',  macAddress:'11:22:33:44:55:02', interfaz:'ether2-LAN', tiempo:'7d 00:00:00', rxMbps:75.3, txMbps:12.4, rxTotal:'450 GB',  txTotal:'74.2 GB', routerNombre:'DIST-ATE-01',    estado:'activa' },
  { id:'pp9',  usuario:'fcastillo',  ipAsignada:'192.168.5.11',  ipServicio:'10.0.5.11',  macAddress:'55:66:77:88:99:02', interfaz:'ether3-LAN', tiempo:'0d 03:44:22', rxMbps:5.6,  txMbps:0.7,  rxTotal:'11.2 GB', txTotal:'1.4 GB',  routerNombre:'DIST-VMT-01',    estado:'activa' },
  { id:'pp10', usuario:'mavargas',   ipAsignada:'192.168.1.13',  ipServicio:'10.0.1.13',  macAddress:'6C:3B:6B:AB:CD:04', interfaz:'ether5-LAN', tiempo:'2d 11:28:55', rxMbps:18.9, txMbps:2.6,  rxTotal:'37.8 GB', txTotal:'5.2 GB',  routerNombre:'DIST-SJL-01',    estado:'activa' },
];

// ─── DHCP LEASES ────────────────────────────────────────────────
export const mockDhcpLeases: LeaseDhcp[] = [
  { id:'dh1',  hostname:'PC-QUISPE-01',   ipAsignada:'192.168.10.101', macAddress:'6C:3B:6B:AA:01:01', clienteNombre:'Juan Quispe',       expira:'2025-05-16 08:00', estado:'activo',   servidor:'DIST-SJL-01',    interfaz:'bridge-LAN' },
  { id:'dh2',  hostname:'TV-SMART-01',    ipAsignada:'192.168.10.102', macAddress:'6C:3B:6B:AA:01:02', clienteNombre:'Juan Quispe',       expira:'2025-05-16 08:00', estado:'activo',   servidor:'DIST-SJL-01',    interfaz:'bridge-LAN' },
  { id:'dh3',  hostname:'android-torres', ipAsignada:'192.168.10.103', macAddress:'AA:11:22:33:44:01', clienteNombre:'María Torres',      expira:'2025-05-15 18:30', estado:'activo',   servidor:'DIST-SJL-01',    interfaz:'bridge-LAN' },
  { id:'dh4',  hostname:'servidor-chav',  ipAsignada:'192.168.20.10',  macAddress:'AA:BB:CC:01:02:03', clienteNombre:'Roberto Chávez',   expira:'permanente',       estado:'estatico', servidor:'DIST-CALLAO-01', interfaz:'bridge-FTTH' },
  { id:'dh5',  hostname:'unknown-device', ipAsignada:'192.168.20.45',  macAddress:'FF:EE:DD:CC:BB:AA', clienteNombre:undefined,           expira:'2025-05-15 16:00', estado:'expirado', servidor:'DIST-CALLAO-01', interfaz:'bridge-FTTH' },
  { id:'dh6',  hostname:'PC-MENDOZA',     ipAsignada:'192.168.30.101', macAddress:'11:22:33:44:55:66', clienteNombre:'Lucía Mendoza',     expira:'2025-05-16 09:15', estado:'activo',   servidor:'DIST-ATE-01',    interfaz:'bridge-LAN' },
  { id:'dh7',  hostname:'router-home',    ipAsignada:'192.168.30.102', macAddress:'22:33:44:55:66:77', clienteNombre:'Lucía Mendoza',     expira:'2025-05-16 09:15', estado:'activo',   servidor:'DIST-ATE-01',    interfaz:'bridge-LAN' },
  { id:'dh8',  hostname:'EMPRESA-CCORI',  ipAsignada:'10.10.5.10',     macAddress:'AA:BB:CC:DD:EE:FF', clienteNombre:'Jorge Ccori SAC',   expira:'permanente',       estado:'estatico', servidor:'DIST-ATE-01',    interfaz:'bridge-EMPR' },
];

// ─── COLAS SIMPLES ──────────────────────────────────────────────
export const mockColas: ColaSimple[] = [
  { id:'q1',  nombre:'jcquispe-100M',   objetivo:'192.168.1.10',   ipOrigen:'192.168.1.10',   limiteBajada:'100M', limitSubida:'20M',  usoBajada:12.4, usoSubida:2.1,  prioridad:5, estado:'activa',  clienteNombre:'Juan Quispe' },
  { id:'q2',  nombre:'metorres-50M',    objetivo:'192.168.1.11',   ipOrigen:'192.168.1.11',   limiteBajada:'50M',  limitSubida:'10M',  usoBajada:4.2,  usoSubida:0.8,  prioridad:5, estado:'activa',  clienteNombre:'María Torres' },
  { id:'q3',  nombre:'rchavez-200M',    objetivo:'192.168.2.10',   ipOrigen:'192.168.2.10',   limiteBajada:'200M', limitSubida:'40M',  usoBajada:48.7, usoSubida:9.2,  prioridad:6, estado:'activa',  clienteNombre:'Roberto Chávez' },
  { id:'q4',  nombre:'lmendoza-20M',    objetivo:'192.168.3.10',   ipOrigen:'192.168.3.10',   limiteBajada:'20M',  limitSubida:'5M',   usoBajada:2.8,  usoSubida:0.5,  prioridad:4, estado:'activa',  clienteNombre:'Lucía Mendoza' },
  { id:'q5',  nombre:'crojas-MORA',     objetivo:'192.168.5.20',   ipOrigen:'192.168.5.20',   limiteBajada:'1M',   limitSubida:'512k', usoBajada:0.8,  usoSubida:0.2,  prioridad:1, estado:'activa',  clienteNombre:'Carlos Rojas (THROTTLED)' },
  { id:'q6',  nombre:'ahuanca-100M',    objetivo:'192.168.5.10',   ipOrigen:'192.168.5.10',   limiteBajada:'100M', limitSubida:'20M',  usoBajada:22.1, usoSubida:4.1,  prioridad:5, estado:'activa',  clienteNombre:'Ana Huanca' },
  { id:'q7',  nombre:'PCQ-RESIDENCIAL', objetivo:'192.168.0.0/24', ipOrigen:'192.168.0.0/24', limiteBajada:'50M',  limitSubida:'10M',  usoBajada:38.4, usoSubida:6.2,  prioridad:4, estado:'activa',  clienteNombre:undefined },
  { id:'q8',  nombre:'PCQ-EMPRESARIAL', objetivo:'10.10.0.0/24',   ipOrigen:'10.10.0.0/24',   limiteBajada:'200M', limitSubida:'50M',  usoBajada:124.3,usoSubida:28.4, prioridad:7, estado:'activa',  clienteNombre:undefined },
];

// ─── IPTV ───────────────────────────────────────────────────────
export const mockCanalesIptv: CanalIptv[] = [
  { id:'ch1',  nombre:'América Televisión', numero:4,   categoria:'Nacional', url:'udp://@239.1.1.4:1234', logo:'🎬', activo:true,  hd:false },
  { id:'ch2',  nombre:'Latina',             numero:2,   categoria:'Nacional', url:'udp://@239.1.1.2:1234', logo:'📺', activo:true,  hd:false },
  { id:'ch3',  nombre:'ATV',                numero:9,   categoria:'Nacional', url:'udp://@239.1.1.9:1234', logo:'🎭', activo:true,  hd:false },
  { id:'ch4',  nombre:'Willax TV',          numero:11,  categoria:'Nacional', url:'udp://@239.1.1.11:1234',logo:'🌟', activo:true,  hd:true },
  { id:'ch5',  nombre:'ESPN',               numero:101, categoria:'Deportes', url:'udp://@239.2.1.1:1234', logo:'⚽', activo:true,  hd:true },
  { id:'ch6',  nombre:'ESPN 2',             numero:102, categoria:'Deportes', url:'udp://@239.2.1.2:1234', logo:'🏈', activo:true,  hd:true },
  { id:'ch7',  nombre:'Fox Sports',         numero:103, categoria:'Deportes', url:'udp://@239.2.1.3:1234', logo:'🎯', activo:true,  hd:true },
  { id:'ch8',  nombre:'HBO',                numero:201, categoria:'Premium',  url:'udp://@239.3.1.1:1234', logo:'🎬', activo:true,  hd:true },
  { id:'ch9',  nombre:'Disney Channel',     numero:301, categoria:'Familiar', url:'udp://@239.4.1.1:1234', logo:'🦁', activo:true,  hd:true },
  { id:'ch10', nombre:'Cartoon Network',    numero:302, categoria:'Familiar', url:'udp://@239.4.1.2:1234', logo:'🦸', activo:false, hd:false },
];

export const mockClientesIptv: ClienteIptv[] = [
  { id:'ipc1', nombre:'Juan Quispe',       plan:'Básico (30 ch)',  dispositivos:2, estado:'activo',     fechaVencimiento:'2025-06-01', mac:'6C:3B:6B:AA:01:01' },
  { id:'ipc2', nombre:'Roberto Chávez',    plan:'Premium (100 ch)',dispositivos:4, estado:'activo',     fechaVencimiento:'2025-06-01', mac:'AA:BB:CC:01:02:03' },
  { id:'ipc3', nombre:'Ana Huanca',        plan:'Estándar (60 ch)',dispositivos:3, estado:'activo',     fechaVencimiento:'2025-06-01', mac:'55:66:77:88:99:01' },
  { id:'ipc4', nombre:'Lucía Mendoza',     plan:'Básico (30 ch)',  dispositivos:1, estado:'activo',     fechaVencimiento:'2025-06-01', mac:'11:22:33:44:55:01' },
  { id:'ipc5', nombre:'Carlos Rojas',      plan:'Estándar (60 ch)',dispositivos:2, estado:'suspendido', fechaVencimiento:'2025-05-01', mac:'33:44:55:66:77:01' },
];

// ─── LOGS DEL SISTEMA ────────────────────────────────────────────
export const mockLogs: EventoLog[] = [
  { id:'log1',  nivel:'info',    modulo:'Auth',        mensaje:'Usuario admin@datafast.pe inició sesión',              usuario:'admin',  ip:'192.168.1.5',  timestamp:'2025-05-15T13:45:00' },
  { id:'log2',  nivel:'warning', modulo:'Monitoreo',   mensaje:'DIST-SMP-01: CPU supera umbral 80% (87%)',             usuario:null,     ip:'10.0.6.1',     timestamp:'2025-05-15T13:40:00' },
  { id:'log3',  nivel:'error',   modulo:'Monitoreo',   mensaje:'ACCESS-VMT-02: Sin respuesta ping por 60 minutos',     usuario:null,     ip:'10.0.11.1',    timestamp:'2025-05-15T13:35:00' },
  { id:'log4',  nivel:'info',    modulo:'Pagos',       mensaje:'Pago registrado: DataTech SAC S/ 490.00 (BBVA)',       usuario:'admin',  ip:'192.168.1.5',  timestamp:'2025-05-15T13:22:00' },
  { id:'log5',  nivel:'info',    modulo:'Contratos',   mensaje:'Contrato CT-2025-1689 aprovisionado en DIST-SJL-01',   usuario:'redes',  ip:'192.168.1.12', timestamp:'2025-05-15T13:00:00' },
  { id:'log6',  nivel:'info',    modulo:'Facturación', mensaje:'Generación automática: 47 facturas Mayo 2025',         usuario:'system', ip:'127.0.0.1',    timestamp:'2025-05-15T12:00:00' },
  { id:'log7',  nivel:'warning', modulo:'MikroTik',    mensaje:'DIST-SJL-01: Sesión PPPoE jccori excede 7 días',       usuario:null,     ip:'10.0.2.1',     timestamp:'2025-05-15T11:55:00' },
  { id:'log8',  nivel:'info',    modulo:'Clientes',    mensaje:'Nuevo cliente registrado: Katherin Mamani (DNI 61234897)',usuario:'ventas',ip:'192.168.1.8', timestamp:'2025-05-15T11:30:00' },
  { id:'log9',  nivel:'error',   modulo:'API',         mensaje:'Error 502 consumiendo endpoint /mikrotik/queues',       usuario:null,     ip:'127.0.0.1',    timestamp:'2025-05-15T11:20:00', detalles:'Connection refused to 10.0.6.1:8728' },
  { id:'log10', nivel:'info',    modulo:'Auth',        mensaje:'Usuario tecnico1@datafast.pe inició sesión',           usuario:'tech1',  ip:'10.0.1.44',    timestamp:'2025-05-15T11:00:00' },
  { id:'log11', nivel:'debug',   modulo:'Crontab',     mensaje:'Job facturacion_diaria ejecutado OK (0.8s)',            usuario:'system', ip:'127.0.0.1',    timestamp:'2025-05-15T10:00:00' },
  { id:'log12', nivel:'info',    modulo:'Mensajería',  mensaje:'WhatsApp: 23 mensajes de recordatorio enviados',        usuario:'system', ip:'127.0.0.1',    timestamp:'2025-05-15T09:00:00' },
  { id:'log13', nivel:'warning', modulo:'DHCP',        mensaje:'IP pool "residencial" al 82% de capacidad',            usuario:null,     ip:'10.0.1.1',     timestamp:'2025-05-15T08:30:00' },
  { id:'log14', nivel:'info',    modulo:'Auth',        mensaje:'Password actualizado por usuario: soporte@datafast.pe',usuario:'soporte',ip:'192.168.1.7',  timestamp:'2025-05-15T08:15:00' },
  { id:'log15', nivel:'info',    modulo:'Backup',      mensaje:'Backup automático completado: datafast_20250515.sql.gz (4.2 MB)',usuario:'system',ip:'127.0.0.1',timestamp:'2025-05-15T03:00:00' },
];

// ─── MENSAJES WHATSAPP ───────────────────────────────────────────
export const mockMensajesWhatsapp: ContactoWhatsapp[] = [
  { id:'wa1',  nombre:'Juan Carlos Quispe',   telefono:'944123456', estado:'leido',      mensaje:'📄 Factura B001-001001 vence el 15/05. Total: S/ 89.00. Pague por Yape: 944000001',        tipo:'factura',      enviado:'2025-05-15T09:00:00' },
  { id:'wa2',  nombre:'María Elena Torres',   telefono:'956234567', estado:'entregado',  mensaje:'⚠️ Su servicio está suspendido por mora. Regularice su pago para restablecer el servicio.',  tipo:'corte',        enviado:'2025-05-15T09:01:00' },
  { id:'wa3',  nombre:'Roberto Chávez Luna',  telefono:'921345678', estado:'leido',      mensaje:'✅ Pago de S/ 189.00 recibido y verificado. Gracias por su puntualidad.',                    tipo:'factura',      enviado:'2025-05-15T09:02:00' },
  { id:'wa4',  nombre:'Lucía Mendoza Flores', telefono:'978456789', estado:'error',      mensaje:'📄 Recordatorio: Factura B001-001004 vence mañana. Total: S/ 35.00.',                       tipo:'recordatorio', enviado:'2025-05-15T09:03:00' },
  { id:'wa5',  nombre:'Carlos Rojas Herrera', telefono:'994567890', estado:'entregado',  mensaje:'⚠️ Mora de S/ 177.00. Tiene 48hs para regularizar antes del corte definitivo.',             tipo:'corte',        enviado:'2025-05-15T09:04:00' },
  { id:'wa6',  nombre:'Ana María Huanca',     telefono:'912678901', estado:'leido',      mensaje:'🎉 Bienvenida a DATAFAST. Su servicio fue activado. Velocidad: 100Mbps.',                   tipo:'bienvenida',   enviado:'2025-05-14T14:30:00' },
  { id:'wa7',  nombre:'Pedro Sánchez',        telefono:'965789012', estado:'leido',      mensaje:'📄 Recordatorio: Factura B001-001007 vence el 18/05. Total: S/ 35.00.',                    tipo:'recordatorio', enviado:'2025-05-14T09:00:00' },
  { id:'wa8',  nombre:'Rosa Palomino',        telefono:'948901234', estado:'entregado',  mensaje:'✅ Su pago de S/ 59.00 fue registrado exitosamente.',                                        tipo:'factura',      enviado:'2025-05-15T10:12:00' },
];

// Re-export helpers from utils so pages can import all from '@/mock-data' transitionally
export { formatBps, formatPEN } from '@/lib/utils';
