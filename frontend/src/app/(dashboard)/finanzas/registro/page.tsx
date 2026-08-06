'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientesApi }                           from '@/lib/api/clientes';
import { facturacionApi, pagosApi } from '@/lib/api/facturacion';
import { contratosApi }                           from '@/lib/api/contratos';
import { promesasApi }                            from '@/lib/api/promesas';
import type { PromesaRow, PromesaStats }           from '@/lib/api/promesas';
import { useToast }                              from '@/components/ui/toaster';
import { cn }                                    from '@/lib/utils';
import type { Cliente, Factura }                 from '@/types';
import {
  CreditCard, CalendarDays,
  X, Printer, CheckCircle, Loader2,
  UploadCloud, AlertCircle, FileText,
  RefreshCw, Clock, Ban, Wifi, WifiOff,
  ChevronLeft, ChevronRight,
} from 'lucide-react';

/* ── Helpers ──────────────────────────────────────────────────────── */
const fmt = (n: number | string | null | undefined) => (+(n ?? 0)).toFixed(2);

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(s => s[0] ?? '').join('').toUpperCase();
}

const ESTADO_LABEL: Record<string, string> = {
  pendiente_activacion: 'PENDIENTE', activo: 'ACTIVO',
  suspendido: 'SUSPENDIDO', baja_definitiva: 'BAJA',
};
const ESTADO_COLOR: Record<string, string> = {
  pendiente_activacion: 'bg-blue-500', activo: 'bg-emerald-500',
  suspendido: 'bg-yellow-500', baja_definitiva: 'bg-gray-600',
};

const TIPOS_PAGO = [
  { value: 'activar',   label: 'Registrar pago y Activar' },
  { value: 'registrar', label: 'Solo registrar' },
  { value: 'adelanto',  label: 'Registrar como adelanto' },
  { value: 'promesa',   label: 'Promesa de pago' },
];


const PENDIENTE_ESTADOS = new Set(['emitida', 'vencida', 'en_cobranza', 'pagada_parcial', 'borrador']);

/* ── TabBtn ───────────────────────────────────────────────────────── */
function TabBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
        active
          ? 'border-blue-500 text-blue-600 dark:text-blue-400'
          : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
      )}
    >
      {children}
    </button>
  );
}

/* ── RadioDot ─────────────────────────────────────────────────────── */
function RadioDot({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <div
      onClick={onChange}
      className={cn(
        'w-4 h-4 rounded-full border-2 flex items-center justify-center cursor-pointer flex-shrink-0',
        checked ? 'border-blue-500' : 'border-gray-300 dark:border-gray-600',
      )}
    >
      {checked && <div className="w-2 h-2 rounded-full bg-blue-500" />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Main Page                                                         */
/* ══════════════════════════════════════════════════════════════════ */
export default function RegistroPagosPage() {
  // Las promesas de pago y los adelantos viven en /finanzas/adelanto-prorroga: los dos son
  // compromisos a futuro y se gestionan juntos. Esta pantalla es solo el cobro.
  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-x-auto">
        <TabBtn active onClick={() => {}}>
          <CreditCard className="w-4 h-4" />
          Registrar pago
        </TabBtn>
      </div>

      <div className="flex-1 bg-gray-50 dark:bg-gray-950">
        <TabRegistrar />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Tab: Registrar Pago                                               */
/* ══════════════════════════════════════════════════════════════════ */
function TabRegistrar() {
  const [searchMode, setSearchMode]     = useState<'cliente' | 'comprobante'>('cliente');
  const [searchQuery, setSearchQuery]   = useState('');
  const [debouncedQ, setDebouncedQ]     = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [cliente, setCliente]           = useState<Cliente | null>(null);
  const [showAlert, setShowAlert]       = useState(true);
  const searchRef                       = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: ['clientes-search-pago', debouncedQ],
    queryFn:  () => clientesApi.list({ search: debouncedQ, limit: 8 }),
    enabled:  debouncedQ.length >= 2 && searchMode === 'cliente',
  });

  const { data: facturas = [], isLoading: loadingFacturas } = useQuery({
    queryKey: ['facturas-cliente-pago', cliente?.id],
    queryFn:  () => facturacionApi.getByCliente(cliente!.id),
    enabled:  !!cliente,
  });

  const pendientes     = facturas.filter(f => PENDIENTE_ESTADOS.has(f.estado));
  const totalPendiente = pendientes.reduce((s, f) => s + (+(f.saldo ?? 0)), 0);

  function handleSelectCliente(c: Cliente) {
    setCliente(c);
    setSearchQuery(c.nombreCompleto);
    setShowDropdown(false);
    setShowAlert(true);
  }

  function handleClear() {
    setCliente(null);
    setSearchQuery('');
    setDebouncedQ('');
  }

  return (
    <div>
      {/* Search bar */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center gap-6 justify-center flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <RadioDot checked={searchMode === 'cliente'} onChange={() => setSearchMode('cliente')} />
            <span className="text-sm text-gray-700 dark:text-gray-300">Buscar Cliente</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <RadioDot checked={searchMode === 'comprobante'} onChange={() => setSearchMode('comprobante')} />
            <span className="text-sm text-gray-700 dark:text-gray-300">Buscar N° comprobante</span>
          </label>

          <div ref={searchRef} className="relative w-96">
            <input
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setShowDropdown(true);
                if (!e.target.value) setCliente(null);
              }}
              onFocus={() => debouncedQ.length >= 2 && setShowDropdown(true)}
              placeholder={
                searchMode === 'cliente'
                  ? 'Nombre ó N° cliente ó Cédula/NIT/RUC/DNI'
                  : 'N° comprobante'
              }
              className="w-full px-3 py-2 pr-8 text-sm border border-gray-300 dark:border-gray-600 rounded
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                         focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {searching && (
              <Loader2 className="absolute right-2 top-2.5 w-4 h-4 animate-spin text-gray-400" />
            )}

            {showDropdown && searchResults?.data && searchResults.data.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800
                              border border-gray-200 dark:border-gray-600 rounded shadow-lg overflow-hidden">
                {searchResults.data.map(c => (
                  <button
                    key={c.id}
                    onMouseDown={() => handleSelectCliente(c)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left
                               hover:bg-blue-500 hover:text-white transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-purple-500 text-white text-xs font-bold
                                    flex items-center justify-center flex-shrink-0">
                      {initials(c.nombreCompleto)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{c.nombreCompleto}</div>
                      <div className="text-xs opacity-60 truncate">
                        {c.distrito ?? c.direccion ?? c.telefono}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Client header + form */}
      {cliente && (
        <div>
          <div className="bg-gray-900 text-white px-6 py-3 flex items-center gap-3">
            <a
              href={`/clientes/${cliente.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-bold tracking-wide uppercase hover:text-blue-300 transition-colors"
            >
              {cliente.nombreCompleto}
            </a>
            <span className={cn(
              'text-xs font-bold px-2 py-0.5 rounded text-white',
              ESTADO_COLOR[cliente.estado] ?? 'bg-gray-500',
            )}>
              {ESTADO_LABEL[cliente.estado] ?? cliente.estado.toUpperCase()}
            </span>
            <button onClick={handleClear} className="ml-auto text-gray-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {loadingFacturas ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : pendientes.length === 0 ? (
            <div className="mx-6 mt-6 flex items-center gap-3 px-4 py-3
                            bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800
                            rounded text-sm text-red-700 dark:text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>El cliente <strong>{cliente.nombreCompleto}</strong> no tiene deudas pendientes.</span>
            </div>
          ) : (
            <>
              {showAlert && (
                <div className="mx-6 mt-4 flex items-center justify-between px-4 py-2.5
                                bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800
                                rounded text-sm text-red-700 dark:text-red-400">
                  <span>
                    El cliente cuenta con <strong>{pendientes.length}</strong>{' '}
                    factura{pendientes.length !== 1 ? 's' : ''} por cobrar
                    {' '}(Total <strong>S/. {fmt(totalPendiente)}</strong>).
                  </span>
                  <button onClick={() => setShowAlert(false)} className="ml-4 hover:opacity-70">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <FormPago
                cliente={cliente}
                facturas={facturas}
                pendientes={pendientes}
                onSuccess={handleClear}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Payment Form                                                      */
/* ══════════════════════════════════════════════════════════════════ */
interface FormPagoProps {
  cliente:    Cliente;
  facturas:   Factura[];
  pendientes: Factura[];
  onSuccess:  () => void;
}

function FormPago({ cliente, facturas, pendientes, onSuccess }: FormPagoProps) {
  const qc          = useQueryClient();
  const { toast }   = useToast();

  const today = new Date().toISOString().split('T')[0];

  const defaultFechaProrroga = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toISOString().split('T')[0];
  })();

  // Ids de los comprobantes marcados para cobrar. El total sale de aquí.
  const [seleccion,      setSeleccion]      = useState<string[]>(pendientes.map(f => f.id));
  const [numOp,          setNumOp]          = useState('');
  const [notas,          setNotas]          = useState('');
  const [tipoPago,       setTipoPago]       = useState('activar');
  const puedeAutoverificar = useAuthStore(s => s.tienePermiso('pagos:autoverificar'));
  const [autoVerificar,  setAutoVerificar]  = useState(true);
  const [impresion,      setImpresion]      = useState<'normal' | 'pos' | 'factura' | 'ninguna'>('normal');
  const [monto,          setMonto]          = useState('');
  const [fechaPago,      setFechaPago]      = useState(today);
  const [fechaProrroga,  setFechaProrroga]  = useState(defaultFechaProrroga);
  const [voucherFile,    setVoucherFile]    = useState<File | null>(null);
  const [formaPago,      setFormaPago]      = useState('efectivo');
  const [canalPagoId,    setCanalPagoId]    = useState('');
  const [cuentaId,       setCuentaId]       = useState('');

  // Una clave por apertura del formulario: impide que un doble clic o un reintento del
  // navegador registren dos cobros. El efectivo no tiene número de operación, así que sin
  // esto no había nada que distinguiera un duplicado de un cobro legítimo.
  const [idempotencyKey] = useState(() =>
    (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  );

  // ── Los tres ejes: forma → canal → cuenta receptora ──────────────────────────
  //
  // Aquí estaban "Seleccionar Banco" y "Forma de Pago", leídos de `bancos_isp` y
  // `formas_pago_isp`. Ese par es la causa raíz de los dos defectos que midió el
  // diagnóstico F0 sobre los únicos pagos que existían:
  //
  //   · `metodo_pago = 'Efectivo'` capitalizado — se enviaba el RÓTULO del catálogo, no un
  //     valor de dominio, y como la columna era texto libre cualquier cosa cabía.
  //   · Un pago en EFECTIVO con `banco = 'Banco 01'`, porque el select de banco
  //     autoseleccionaba el primero de la lista y lo mandaba siempre, tuviera sentido o no.
  //
  // El banco no es un eje: es un canal de las formas bancarias. Y faltaba la pregunta que
  // de verdad importa para tesorería — en qué cuenta entró el dinero.
  const { data: formas = [] } = useQuery({
    queryKey: ['formas-pago'], queryFn: pagosApi.getFormas, staleTime: Infinity,
  });
  const { data: canales = [] } = useQuery({
    queryKey: ['canales-pago'], queryFn: () => pagosApi.getCanales(true), staleTime: 5 * 60_000,
  });
  const { data: cuentas = [] } = useQuery({
    queryKey: ['cuentas-bancarias'], queryFn: pagosApi.getCuentasBancarias, staleTime: 5 * 60_000,
  });

  const canalesDeLaForma = canales.filter(c => c.formaPago === formaPago);
  const canal            = canales.find(c => c.id === canalPagoId);
  const requiereNumOp    = !!canal?.requiereNumeroOperacion;

  // Al cambiar de forma el canal anterior deja de valer. Se preselecciona si solo hay uno:
  // pedirle al cajero que elija entre una opción es fricción sin motivo.
  useEffect(() => {
    if (canal && canal.formaPago === formaPago) return;
    setCanalPagoId(canalesDeLaForma.length === 1 ? canalesDeLaForma[0].id : '');
  }, [formaPago, canales.length]); // eslint-disable-line

  // La cuenta la propone el canal. A diferencia del banco de antes, aquí NO se
  // autoselecciona nada si el canal no la define: se deja vacía para que el operador diga
  // dónde entró el dinero, en vez de que el ERP lo invente.
  useEffect(() => {
    setCuentaId(canal?.cuentaReceptoraDefaultId ?? '');
  }, [canalPagoId]); // eslint-disable-line

  const esPromesa  = tipoPago === 'promesa';
  // Adelanto: dinero sin comprobante que queda como saldo a favor y se consume al emitir
  // el siguiente. Solo tiene sentido si el cliente NO debe nada.
  const esAdelanto = tipoPago === 'adelanto';
  // "Solo registrar": se cobra pero NO se devuelve el servicio. Es la baja voluntaria que
  // salda su último comprobante — reactivarlo sería devolverle internet a quien se va.
  const soloRegistrar = tipoPago === 'registrar';

  // Deuda total del cliente: la referencia para el adelanto (no se admite con deuda).
  const totalConsolidado = pendientes.reduce(
    (s, f) => s + (f.saldo > 0 ? +f.saldo : +f.total), 0,
  );

  // Importe de lo MARCADO: es el total a cobrar y se recalcula con cada casilla.
  const totalSeleccion = pendientes
    .filter(f => seleccion.includes(f.id))
    .reduce((s, f) => s + (f.saldo > 0 ? +f.saldo : +f.total), 0);

  const todosMarcados = pendientes.length > 0 && seleccion.length === pendientes.length;

  // El monto sigue a la selección. Con UN comprobante el operador puede editarlo (cobro
  // parcial); con varios el backend exige el total exacto, así que cambiarlo a mano solo
  // llevaría a un rechazo.
  useEffect(() => {
    setMonto(seleccion.length ? fmt(totalSeleccion) : '');
  }, [seleccion, facturas]); // eslint-disable-line

  // Al cargar el cliente se marcan todos sus pendientes: cobrar la deuda completa es lo
  // más frecuente, y desmarcar es más rápido que ir marcando uno a uno.
  useEffect(() => {
    setSeleccion(pendientes.map(f => f.id));
  }, [facturas]); // eslint-disable-line

  // Con un único comprobante marcado el pago se ata a él (y admite parcial); con varios
  // viaja la lista y el backend lo trata como consolidado.
  const esConsolidado    = seleccion.length > 1;
  const facturaUnicaId   = seleccion.length === 1 ? seleccion[0] : '';
  const selectedFactura  = facturas.find(f => f.id === facturaUnicaId);

  // Cuando es promesa, cargar contratos del cliente para obtener el contratoId aunque
  // la factura no lo tenga enlazado (contrato_id nullable en facturas)
  const { data: contratosData } = useQuery({
    queryKey: ['contratos-cliente-promesa', cliente.id],
    queryFn:  () => contratosApi.list({ clienteId: cliente.id, limit: 10 }),
    enabled:  esPromesa,
    staleTime: 60_000,
  });
  const contratoParaPromesa = contratosData?.data.find(c =>
    ['activo', 'moroso', 'cortado', 'suspendido'].includes(c.estado),
  );

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (esPromesa) {
        const contratoId = selectedFactura?.contratoId ?? contratoParaPromesa?.id;
        if (!contratoId)
          throw new Error('No se encontró un contrato activo para este cliente');
        return promesasApi.crear({
          contratoId,
          fechaVencimiento: fechaProrroga,
          motivo:           notas.trim() || 'Promesa de pago',
        });
      }

      const pago = await pagosApi.registrar({
        clienteId:       cliente.id,
        // Adelanto: cobro sin comprobante. El backend lo rechaza si el cliente tiene deuda
        // pendiente — con comprobantes impagos eso no es adelantar, es pagar.
        esAdelanto:      esAdelanto || undefined,
        // Solo se manda cuando es false: por defecto un cobro reactiva el servicio.
        reactivarServicio: soloRegistrar ? false : undefined,
        // Varios marcados: viaja la lista y el backend exige que el importe los cubra por
        // completo (es todo o nada). Uno solo: se ata a ese comprobante y admite parcial.
        facturaId:       esAdelanto || esConsolidado ? undefined : (facturaUnicaId || undefined),
        facturaIds:      esConsolidado ? seleccion : undefined,
        contratoId:      esAdelanto ? undefined : selectedFactura?.contratoId,
        monto:           parseFloat(monto) || 0,
        canalPagoId:     canalPagoId || undefined,
        cuentaReceptoraId: cuentaId || undefined,
        // Se sigue enviando: la columna se conserva escrita para leer el histórico tal
        // como se registró, y es lo que hace reversible la migración de catálogos. Ahora
        // lleva el CÓDIGO del canal, no el rótulo que el operador ve en pantalla.
        metodoPago:      canal?.codigo ?? formaPago,
        numeroOperacion: numOp  || undefined,
        notas:           notas  || undefined,
        autoVerificar:   puedeAutoverificar && autoVerificar,
        fechaPago,
        idempotencyKey,
      });
      if (voucherFile) {
        try {
          await pagosApi.uploadComprobante(pago.id, voucherFile);
        } catch {
          // upload falla silenciosamente — el pago ya fue registrado
        }
      }
      return pago;
    },
    onSuccess: (_data, _vars) => {
      if (esPromesa) {
        toast(`Promesa registrada — servicio habilitado hasta ${fechaProrroga}`, { type: 'success' });
        qc.invalidateQueries({ queryKey: ['promesas-activas'] });
      } else {
        toast('Pago registrado correctamente', { type: 'success' });
        qc.invalidateQueries({ queryKey: ['pagos-hoy'] });
      }
      // Invalidar todas las vistas del cliente afectado para que refresquen sin Ctrl+F5
      qc.invalidateQueries({ queryKey: ['facturas-cliente-pago',    cliente.id] });
      qc.invalidateQueries({ queryKey: ['cliente-facturas',         cliente.id] });
      qc.invalidateQueries({ queryKey: ['cliente-pagos',            cliente.id] });
      qc.invalidateQueries({ queryKey: ['facturas-cliente-resumen', cliente.id] });
      qc.invalidateQueries({ queryKey: ['cliente-contratos',        cliente.id] });
      qc.invalidateQueries({ queryKey: ['cliente',                  cliente.id] });
      qc.invalidateQueries({ queryKey: ['clientes'] });
      onSuccess();
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message ?? e?.message ?? 'Error inesperado';
      toast(msg, { type: 'error' });
    },
  });

  const inputCls = `w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded
                    bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                    focus:outline-none focus:ring-1 focus:ring-blue-500`;

  return (
    <div className="p-6 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 max-w-4xl">
      {/* ── Left column ── */}
      <div className="space-y-4">

        {/* Adelanto: no se elige comprobante — el dinero aún no pertenece a ninguno */}
        {esAdelanto ? (
          <div className={cn(
            'rounded-lg border p-3 text-xs',
            totalConsolidado > 0
              ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-900/20 text-red-700 dark:text-red-400'
              : 'border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
          )}>
            {totalConsolidado > 0 ? (
              <>
                <strong>No se puede adelantar:</strong> el cliente debe S/. {fmt(totalConsolidado)}.
                Entregar dinero con comprobantes impagos no es un adelanto — registra primero
                el pago de su deuda.
              </>
            ) : (
              <>
                El importe quedará como <strong>saldo a favor</strong> y se aplicará solo al
                emitir su siguiente comprobante.
              </>
            )}
          </div>
        ) : (
        <div>
          {/* Selección de comprobantes.
              El operador marca los que va a cobrar y el total sale de esa selección: uno,
              varios o todos. Antes era un desplegable de UNO o la opción "todas las
              deudas", que no cubría el caso normal de cobrar dos de tres comprobantes.
              Todos los marcados se saldan con un único pago y un único número de
              operación (ver pago_aplicaciones en el backend). */}
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-gray-500 dark:text-gray-400 font-medium">
              Comprobantes a pagar
            </label>
            {pendientes.length > 1 && (
              <button
                type="button"
                onClick={() => setSeleccion(
                  todosMarcados ? [] : pendientes.map(f => f.id),
                )}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                {todosMarcados ? 'Quitar todos' : 'Seleccionar todos'}
              </button>
            )}
          </div>

          {!pendientes.length ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-600 rounded p-3">
              Este cliente no tiene comprobantes pendientes.
            </p>
          ) : (
            <div className="border border-gray-300 dark:border-gray-600 rounded divide-y divide-gray-200 dark:divide-gray-700 max-h-56 overflow-y-auto">
              {pendientes.map(f => {
                const marcado = seleccion.includes(f.id);
                const saldoF  = f.saldo > 0 ? +f.saldo : +f.total;
                return (
                  <label
                    key={f.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
                      marcado
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => setSeleccion(
                        marcado
                          ? seleccion.filter(id => id !== f.id)
                          : [...seleccion, f.id],
                      )}
                      className="w-4 h-4 accent-blue-600 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                        N° {f.numeroCompleto}
                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-1.5">
                          {f.tipoComprobante} · vence {f.fechaVencimiento}
                        </span>
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex-shrink-0">
                      S/. {fmt(saldoF)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {soloRegistrar && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-400">
              <strong>El servicio NO se reactivará.</strong> El cobro queda registrado y la
              deuda saldada, pero el abonado seguirá sin servicio — es lo que corresponde a
              una baja que paga su último comprobante. Para devolverle el servicio, usa
              “Registrar pago y Activar”.
            </div>
          )}

          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {seleccion.length === 0
              ? 'Marca al menos un comprobante. Para cobrar dinero sin comprobante, elige “Registrar como adelanto” en Forma de Registro.'
              : seleccion.length === 1
                ? 'Un solo comprobante: puedes cobrar un importe parcial.'
                : `${seleccion.length} comprobantes con un único pago y un único N° de operación. El importe debe cubrir el total.`}
          </p>
        </div>
        )}

        {/* N° de operación — solo si el CANAL lo exige.
            Antes se pedía siempre, junto a un input de "Comisión S/." que no llevaba
            estado ni se enviaba: era decorativo. La comisión no la teclea el cajero, la
            define el canal, y se muestra abajo calculada sobre el importe real. */}
        {!esPromesa && requiereNumOp && (
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
              N° Transacción *
            </label>
            <input
              type="text"
              value={numOp}
              onChange={e => setNumOp(e.target.value)}
              placeholder="Número de operación"
              className={inputCls}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Es lo que impide cobrar dos veces la misma operación.
            </p>
          </div>
        )}

        {/* Forma → Canal → Cuenta receptora */}
        {!esPromesa && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                  Forma de Pago
                </label>
                <select
                  value={formaPago}
                  onChange={e => setFormaPago(e.target.value)}
                  className={inputCls}
                >
                  {formas.map(f => (
                    <option key={f.codigo} value={f.codigo}>{f.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                  Canal
                </label>
                {canalesDeLaForma.length === 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400 pt-2">
                    Sin canales para esta forma. Créalos en Finanzas → Ajustes de Cobranza.
                  </p>
                ) : (
                  <select
                    value={canalPagoId}
                    onChange={e => setCanalPagoId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">— Seleccionar —</option>
                    {canalesDeLaForma.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Dónde entró el dinero. Es la pregunta que este formulario no hacía. */}
            {canal && (
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                  Cuenta receptora
                </label>
                <select
                  value={cuentaId}
                  onChange={e => setCuentaId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">— Sin asignar —</option>
                  {cuentas.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nombre ?? c.banco}
                      {c.numeroCuenta ? ` ···${c.numeroCuenta.slice(-4)}` : ''} ({c.moneda})
                    </option>
                  ))}
                </select>
                {!canal.cuentaReceptoraDefaultId && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Este canal no tiene cuenta por defecto — indica dónde entró el dinero.
                  </p>
                )}
              </div>
            )}

            {/* La comisión se DERIVA del canal sobre el importe cobrado. El abonado paga
                el bruto y eso es lo que salda su factura; el neto es lo que llega a la
                cuenta, y por tanto lo que se busca en el extracto al conciliar. */}
            {canal && (Number(canal.comisionPorcentaje) > 0 || Number(canal.comisionFija) > 0) && (() => {
              const bruto    = parseFloat(monto) || 0;
              const comision = Number((
                (bruto * Number(canal.comisionPorcentaje)) / 100 + Number(canal.comisionFija)
              ).toFixed(2));
              return (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Comisión de «{canal.nombre}»: <strong>S/ {comision.toFixed(2)}</strong> —
                  el abonado paga S/ {bruto.toFixed(2)} y a la cuenta llegan
                  S/ {(bruto - comision).toFixed(2)}. La comisión se registra como gasto.
                </p>
              );
            })()}
          </>
        )}

        {/* Auto-verificar */}
        {!esPromesa && (
          <label className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer select-none transition-colors',
            puedeAutoverificar
              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
              : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 cursor-not-allowed opacity-60',
          )}>
            <input
              type="checkbox"
              checked={puedeAutoverificar ? autoVerificar : false}
              disabled={!puedeAutoverificar}
              onChange={e => puedeAutoverificar && setAutoVerificar(e.target.checked)}
              className="w-4 h-4 accent-emerald-600"
            />
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                Auto-verificar pago
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {puedeAutoverificar
                  ? 'El pago quedará verificado y aplicado de inmediato'
                  : 'Sin permiso — el pago quedará pendiente de verificación'}
              </p>
            </div>
          </label>
        )}

        {/* Fila 2: Fecha de pago | Forma de Registro — o Fecha límite en promesa */}
        <div className="grid grid-cols-2 gap-4">
          {esPromesa ? (
            <>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                  Fecha límite de pago
                </label>
                <input
                  type="date"
                  value={fechaProrroga}
                  min={(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })()}
                  onChange={e => setFechaProrroga(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                  Forma de Registro
                </label>
                <select value={tipoPago} onChange={e => setTipoPago(e.target.value)} className={inputCls}>
                  {TIPOS_PAGO.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                  Fecha de pago
                </label>
                <input
                  type="date"
                  value={fechaPago}
                  max={today}
                  onChange={e => setFechaPago(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                  Forma de Registro
                </label>
                <select value={tipoPago} onChange={e => setTipoPago(e.target.value)} className={inputCls}>
                  {TIPOS_PAGO.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {/* Total a pagar — oculto en promesa */}
        {!esPromesa && (
          <div className="pt-2">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium uppercase tracking-wide">
              Total a pagar
            </label>
            <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded overflow-hidden w-48">
              <span className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-sm font-semibold text-gray-500 border-r border-gray-300 dark:border-gray-600">
                S/.
              </span>
              <input
                type="number"
                value={monto}
                onChange={e => setMonto(e.target.value)}
                step="0.01"
                min="0"
                // Con varios comprobantes marcados el importe lo fija la selección: el
                // backend exige el total exacto, así que dejar teclear otra cifra solo
                // llevaría a un rechazo tras rellenar todo el formulario.
                readOnly={esConsolidado}
                className={cn(
                  'flex-1 px-3 py-2 text-lg font-bold text-emerald-600 dark:text-emerald-400',
                  'bg-white dark:bg-gray-800 focus:outline-none',
                  esConsolidado && 'cursor-not-allowed opacity-90',
                )}
              />
            </div>
            {esConsolidado && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Suma de los {seleccion.length} comprobantes marcados. Desmarca alguno para
                cambiar el total.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Right column ── */}
      <div className="space-y-5">

        {/* Notas */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
            Notas
          </label>
          <textarea
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Comentario del pago"
            rows={5}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Voucher — oculto en promesa */}
        {!esPromesa && (
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">
              Comprobante / Voucher
            </label>
            <VoucherDropzone file={voucherFile} onChange={setVoucherFile} />
          </div>
        )}

        {/* Imprimir */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">
            Imprimir
          </label>
          <div className="space-y-2">
            {[
              { value: 'normal',  label: 'Recibo normal', color: 'text-blue-500' },
              { value: 'pos',     label: 'Recibo POS',    color: 'text-emerald-500' },
              { value: 'factura', label: 'Factura',       color: 'text-emerald-500' },
              { value: 'ninguna', label: 'No imprimir',   color: 'text-red-400' },
            ].map(opt => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <RadioDot
                  checked={impresion === opt.value}
                  onChange={() => setImpresion(opt.value as typeof impresion)}
                />
                <Printer className={cn('w-3.5 h-3.5', opt.color)} />
                <span className={cn('text-sm', opt.color)}>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onSuccess}
            className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded
                       text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            × Cancelar
          </button>
          <button
            type="button"
            disabled={
              isPending
              || (!esPromesa && (!monto || parseFloat(monto) <= 0))
              // Con deuda pendiente no hay adelanto posible: el backend lo rechaza igual,
              // pero bloquearlo aquí evita que el cajero llegue al error tras teclear todo.
              || (esAdelanto && totalConsolidado > 0)
              // Un cobro que no es adelanto ni promesa tiene que aplicarse a algo.
              || (!esPromesa && !esAdelanto && seleccion.length === 0)
              // Sin canal el pago nace sin clasificar: desaparecería de todo reporte de
              // tesorería y nadie lo notaría. Se bloquea aquí, no al llegar al backend.
              || (!esPromesa && !canalPagoId)
              // Si el canal lo exige, el nº de operación es lo que impide cobrar dos veces
              // la misma transacción.
              || (!esPromesa && requiereNumOp && !numOp.trim())
            }
            onClick={() => mutate()}
            className={cn(
              'flex-1 px-4 py-2 text-sm font-semibold rounded text-white',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'flex items-center justify-center gap-2 transition-colors',
              esPromesa
                ? 'bg-amber-500 hover:bg-amber-600'
                : 'bg-blue-600 hover:bg-blue-700',
            )}
          >
            {isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <CheckCircle className="w-4 h-4" />}
            {esPromesa ? 'Registrar promesa' : 'Registrar pago'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Voucher Dropzone                                                   */
/* ══════════════════════════════════════════════════════════════════ */
const VOUCHER_ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const VOUCHER_MAX_MB = 5;

interface VoucherDropzoneProps {
  file:     File | null;
  onChange: (f: File | null) => void;
}

function VoucherDropzone({ file, onChange }: VoucherDropzoneProps) {
  const inputRef                    = useRef<HTMLInputElement>(null);
  const [dragging, setDragging]     = useState(false);
  const [error,    setError]        = useState<string>('');

  const validate = useCallback((f: File): string | null => {
    if (!VOUCHER_ACCEPT.includes(f.type))
      return 'Solo JPG, PNG o PDF';
    if (f.size > VOUCHER_MAX_MB * 1024 * 1024)
      return `El archivo supera ${VOUCHER_MAX_MB} MB`;
    return null;
  }, []);

  const handleFile = useCallback((f: File) => {
    const err = validate(f);
    if (err) { setError(err); return; }
    setError('');
    onChange(f);
  }, [validate, onChange]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  };

  if (file) {
    const isPdf = file.type === 'application/pdf';
    return (
      <div className="flex items-center gap-2.5 p-3 border border-gray-200 dark:border-gray-700
                      rounded-lg bg-gray-50 dark:bg-gray-800/50">
        <div className="w-8 h-8 rounded bg-blue-100 dark:bg-blue-900/40 flex items-center
                        justify-center flex-shrink-0">
          {isPdf
            ? <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            : <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{file.name}</p>
          <p className="text-[11px] text-gray-400">{(file.size / 1024).toFixed(0)} KB</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50
                     dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors select-none',
          dragging
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={VOUCHER_ACCEPT.join(',')}
          className="hidden"
          onChange={onInputChange}
        />
        <UploadCloud className={cn(
          'w-7 h-7 mx-auto mb-2 transition-colors',
          dragging ? 'text-blue-500' : 'text-gray-400',
        )} />
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
          Subir foto del voucher
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
          JPG, PNG o PDF · máx. {VOUCHER_MAX_MB}MB
        </p>
      </div>
      {error && (
        <p className="mt-1 text-[11px] text-red-500 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

