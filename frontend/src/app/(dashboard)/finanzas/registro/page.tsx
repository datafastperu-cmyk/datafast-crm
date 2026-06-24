'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientesApi }                           from '@/lib/api/clientes';
import { facturacionApi, pagosApi, METODOS_PAGO } from '@/lib/api/facturacion';
import { contratosApi }                           from '@/lib/api/contratos';
import { promesasApi }                            from '@/lib/api/promesas';
import type { PromesaRow, PromesaStats }           from '@/lib/api/promesas';
import { useToast }                              from '@/components/ui/toaster';
import { cn }                                    from '@/lib/utils';
import type { Cliente, Factura }                 from '@/types';
import {
  CreditCard, ShoppingCart, CalendarDays,
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

const PAGO_BADGE: Record<string, string> = {
  verificado:             'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  pendiente_verificacion: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  rechazado:              'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  devuelto:               'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};
const PAGO_LABEL: Record<string, string> = {
  verificado: 'VERIFICADO', pendiente_verificacion: 'PENDIENTE',
  rechazado: 'RECHAZADO', devuelto: 'DEVUELTO',
};

const TIPOS_PAGO = [
  { value: 'activar',   label: 'Registrar pago y Activar' },
  { value: 'registrar', label: 'Solo registrar' },
  { value: 'adelanto',  label: 'Registrar como adelanto' },
  { value: 'promesa',   label: 'Promesa de pago' },
];

const DIAS_MES = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1} de cada mes`,
}));

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
  const [tab, setTab] = useState<'registrar' | 'hoy' | 'promesas'>('registrar');

  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-x-auto">
        <TabBtn active={tab === 'registrar'} onClick={() => setTab('registrar')}>
          <CreditCard className="w-4 h-4" />
          Registrar pago
        </TabBtn>
        <TabBtn active={tab === 'hoy'} onClick={() => setTab('hoy')}>
          <ShoppingCart className="w-4 h-4" />
          Pagos registrados
          <span className="text-xs text-blue-500 dark:text-blue-400">(hoy)</span>
        </TabBtn>
        <TabBtn active={tab === 'promesas'} onClick={() => setTab('promesas')}>
          <CalendarDays className="w-4 h-4" />
          Promesas de pago
          <span className="text-xs text-blue-500 dark:text-blue-400">(activos)</span>
        </TabBtn>
      </div>

      <div className="flex-1 bg-gray-50 dark:bg-gray-950">
        {tab === 'registrar' && <TabRegistrar />}
        {tab === 'hoy'       && <TabPagosHoy />}
        {tab === 'promesas'  && <TabPromesas />}
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
            <span className="text-sm font-bold tracking-wide uppercase">
              {cliente.nombreCompleto}
            </span>
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

  const [facturaId,      setFacturaId]      = useState<string>(pendientes[0]?.id ?? '');
  const [metodoPago,     setMetodoPago]     = useState('efectivo');
  const [numOp,          setNumOp]          = useState('');
  const [notas,          setNotas]          = useState('');
  const [tipoPago,       setTipoPago]       = useState('activar');
  const [diaPago,        setDiaPago]        = useState('28');
  const [impresion,      setImpresion]      = useState<'normal' | 'pos' | 'factura' | 'ninguna'>('normal');
  const [monto,          setMonto]          = useState('');
  const [fechaPago,      setFechaPago]      = useState(today);
  const [fechaProrroga,  setFechaProrroga]  = useState(defaultFechaProrroga);
  const [voucherFile,    setVoucherFile]    = useState<File | null>(null);

  const esPromesa = tipoPago === 'promesa';

  // Auto-fill monto from selected factura
  useEffect(() => {
    const f = facturas.find(f => f.id === facturaId);
    if (f) setMonto(fmt(f.saldo > 0 ? f.saldo : f.total));
    else    setMonto('');
  }, [facturaId, facturas]);

  // Default to first pending on load
  useEffect(() => {
    if (pendientes[0] && !facturaId) setFacturaId(pendientes[0].id);
  }, [pendientes]); // eslint-disable-line

  const selectedFactura = facturas.find(f => f.id === facturaId);

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
        facturaId:       facturaId   || undefined,
        contratoId:      selectedFactura?.contratoId,
        monto:           parseFloat(monto) || 0,
        metodoPago,
        numeroOperacion: numOp  || undefined,
        notas:           notas  || undefined,
        autoVerificar:   tipoPago === 'activar',
        fechaPago,
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
      qc.invalidateQueries({ queryKey: ['facturas-cliente-pago', cliente.id] });
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

        {/* Comprobante */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
            Comprobante a pagar
          </label>
          <select
            value={facturaId}
            onChange={e => setFacturaId(e.target.value)}
            className={inputCls}
          >
            <option value="">— Sin comprobante (adelanto) —</option>
            {facturas
              .filter(f => f.estado !== 'anulada')
              .map(f => (
                <option key={f.id} value={f.id}>
                  N° {f.numeroCompleto} — (S/. {fmt(f.saldo > 0 ? f.saldo : f.total)}{' '}
                  {f.tipoComprobante} — {f.fechaVencimiento})
                </option>
              ))}
          </select>
        </div>

        {/* Comisión + N° Transacción — oculto en promesa */}
        {!esPromesa && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                Comisión S/.
              </label>
              <input type="number" defaultValue="0" min="0" step="0.01" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                N° Transacción
              </label>
              <input
                type="text"
                value={numOp}
                onChange={e => setNumOp(e.target.value)}
                placeholder="Número de operación"
                className={inputCls}
              />
            </div>
          </div>
        )}

        {/* Forma de Pago — oculto en promesa · Forma de Registro */}
        <div className="grid grid-cols-2 gap-4">
          {!esPromesa && (
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                Forma de Pago
              </label>
              <select
                value={metodoPago}
                onChange={e => setMetodoPago(e.target.value)}
                className={inputCls}
              >
                {METODOS_PAGO.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className={esPromesa ? 'col-span-2' : ''}>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
              Forma de Registro
            </label>
            <select
              value={tipoPago}
              onChange={e => setTipoPago(e.target.value)}
              className={inputCls}
            >
              {TIPOS_PAGO.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Día pago + Fecha pago — o Fecha límite en promesa */}
        <div className="grid grid-cols-2 gap-4">
          {esPromesa ? (
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
          ) : (
            <>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                  Día pago
                </label>
                <select
                  value={diaPago}
                  onChange={e => setDiaPago(e.target.value)}
                  className={inputCls}
                >
                  {DIAS_MES.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
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
                className="flex-1 px-3 py-2 text-lg font-bold text-emerald-600 dark:text-emerald-400
                           bg-white dark:bg-gray-800 focus:outline-none"
              />
            </div>
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
            disabled={isPending || (!esPromesa && (!monto || parseFloat(monto) <= 0))}
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

/* ══════════════════════════════════════════════════════════════════ */
/*  Tab: Pagos Hoy                                                    */
/* ══════════════════════════════════════════════════════════════════ */
function TabPagosHoy() {
  const { data, isLoading } = useQuery({
    queryKey:       ['pagos-hoy'],
    queryFn:        () => pagosApi.list({ soloHoy: true, limit: 200 }),
    refetchInterval: 30_000,
  });

  const pagos     = data?.data ?? [];
  const totalHoy  = pagos.reduce((s, p) => s + (+(p.monto ?? 0)), 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Pagos registrados hoy
        </h2>
        <div className="text-sm text-gray-500">
          Total:{' '}
          <strong className="text-emerald-600 dark:text-emerald-400">
            S/. {fmt(totalHoy)}
          </strong>
          {' · '}
          {pagos.length} pago{pagos.length !== 1 ? 's' : ''}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : pagos.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          No hay pagos registrados hoy
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2.5 text-left">Cliente</th>
                <th className="px-4 py-2.5 text-left">Método</th>
                <th className="px-4 py-2.5 text-left">N° Operación</th>
                <th className="px-4 py-2.5 text-right">Monto</th>
                <th className="px-4 py-2.5 text-center">Estado</th>
                <th className="px-4 py-2.5 text-left">Hora</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {pagos.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                    {p.clienteNombre ?? p.cliente_nombre ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                    {METODOS_PAGO.find(m => m.value === p.metodoPago)?.label ?? p.metodoPago}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {p.numeroOperacion ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                    S/. {fmt(p.monto)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={cn(
                      'text-[10px] font-bold px-1.5 py-0.5 rounded',
                      PAGO_BADGE[p.estado] ?? 'bg-gray-100 text-gray-500',
                    )}>
                      {PAGO_LABEL[p.estado] ?? p.estado.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {new Date(p.fechaPago).toLocaleTimeString('es-PE', {
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Tab: Promesas de Pago                                             */
/* ══════════════════════════════════════════════════════════════════ */

const PROMESA_ESTADO_BADGE: Record<string, string> = {
  activa:            'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  vencida_pendiente: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  vencida:           'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cumplida:          'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelada:         'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};
const PROMESA_ESTADO_LABEL: Record<string, string> = {
  activa: 'ACTIVA', vencida_pendiente: 'PEND.CORTE',
  vencida: 'VENCIDA', cumplida: 'CUMPLIDA', cancelada: 'CANCELADA',
};

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={cn('rounded-lg border p-4 flex flex-col gap-1', color)}>
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs font-medium opacity-70">{label}</span>
    </div>
  );
}

function TabPromesas() {
  const qc                                   = useQueryClient();
  const { toast }                            = useToast();
  const [filtroEstado, setFiltroEstado]      = useState('');
  const [page, setPage]                      = useState(1);
  const [confirmCancel, setConfirmCancel]    = useState<string | null>(null);

  const { data: statsData, isLoading: statsLoading } = useQuery<PromesaStats>({
    queryKey: ['promesas-stats'],
    queryFn:  () => promesasApi.stats(),
    refetchInterval: 30_000,
  });

  const { data: listData, isLoading: listLoading, refetch } = useQuery({
    queryKey: ['promesas-lista', filtroEstado, page],
    queryFn:  () => promesasApi.listar({ estado: filtroEstado || undefined, page, limit: 20 }),
    refetchInterval: 30_000,
  });

  const cancelarMut = useMutation({
    mutationFn: (id: string) => promesasApi.cancelar(id),
    onSuccess: () => {
      toast('Promesa cancelada', { type: 'success' });
      setConfirmCancel(null);
      void qc.invalidateQueries({ queryKey: ['promesas-lista'] });
      void qc.invalidateQueries({ queryKey: ['promesas-stats'] });
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast(err?.response?.data?.message ?? 'Error al cancelar', { type: 'error' });
      setConfirmCancel(null);
    },
  });

  const promesas: PromesaRow[] = listData?.data ?? [];
  const meta                   = listData?.meta;
  const stats: PromesaStats    = statsData ?? { activas: 0, vencenHoy: 0, vencidas: 0, cumplidas: 0 };

  const fmtFecha = (iso: string) => {
    const [y, m, d] = iso.split('T')[0].split('-');
    return `${d}/${m}/${y}`;
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4 h-20 animate-pulse bg-gray-100 dark:bg-gray-800" />
            ))
          : <>
              <StatCard label="Activas"    value={stats.activas}   color="border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300" />
              <StatCard label="Vencen hoy" value={stats.vencenHoy} color="border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300" />
              <StatCard label="Vencidas"   value={stats.vencidas}  color="border-red-200 dark:border-red-800 text-red-700 dark:text-red-300" />
              <StatCard label="Cumplidas"  value={stats.cumplidas} color="border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300" />
            </>
        }
      </div>

      {/* Filters + refresh */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filtroEstado}
          onChange={e => { setFiltroEstado(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded
                     bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Todos los estados</option>
          <option value="activa">Activa</option>
          <option value="vencida_pendiente">Pendiente corte</option>
          <option value="vencida">Vencida</option>
          <option value="cumplida">Cumplida</option>
          <option value="cancelada">Cancelada</option>
        </select>
        <button
          onClick={() => void refetch()}
          className="p-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-gray-700
                     dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          title="Actualizar"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        {meta && (
          <span className="text-xs text-gray-400 ml-auto">{meta.total} promesa{meta.total !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cliente / Contrato</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">IP / Router</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Vencimiento</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Deuda</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Estado</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">MikroTik</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {listLoading && (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              )}
              {!listLoading && promesas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">
                    <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No hay promesas de pago registradas
                  </td>
                </tr>
              )}
              {promesas.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  {/* Cliente / Contrato */}
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[180px]">{p.clienteNombre}</p>
                    <p className="text-xs text-gray-400">{p.numeroContrato}</p>
                  </td>
                  {/* IP / Router */}
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-gray-700 dark:text-gray-300">{p.ipAsignada ?? '—'}</p>
                    <p className="text-xs text-gray-400 truncate max-w-[120px]">{p.routerNombre ?? '—'}</p>
                  </td>
                  {/* Vencimiento */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className={cn(
                        'text-sm',
                        p.estado === 'activa' && p.fechaVencimiento <= new Date().toISOString().split('T')[0]
                          ? 'text-red-600 dark:text-red-400 font-semibold'
                          : 'text-gray-700 dark:text-gray-300',
                      )}>
                        {fmtFecha(p.fechaVencimiento)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">Creada {fmtFecha(p.creadaEn)}</p>
                  </td>
                  {/* Deuda */}
                  <td className="px-4 py-3 text-right">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      S/ {fmt(p.deudaAlCrear)}
                    </span>
                  </td>
                  {/* Estado */}
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      'inline-flex px-2 py-0.5 rounded-full text-xs font-semibold',
                      PROMESA_ESTADO_BADGE[p.estado] ?? 'bg-gray-100 text-gray-500',
                    )}>
                      {PROMESA_ESTADO_LABEL[p.estado] ?? p.estado.toUpperCase()}
                    </span>
                  </td>
                  {/* MikroTik */}
                  <td className="px-4 py-3 text-center">
                    {p.mikrotikAplicado ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        <Wifi className="w-3.5 h-3.5" /> OK
                      </span>
                    ) : p.mikrotikReintentos >= 5 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400 font-medium">
                        <WifiOff className="w-3.5 h-3.5" /> Fallido
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pendiente
                      </span>
                    )}
                  </td>
                  {/* Acciones */}
                  <td className="px-4 py-3 text-center">
                    {p.estado === 'activa' && (
                      confirmCancel === p.id ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => cancelarMut.mutate(p.id)}
                            disabled={cancelarMut.isPending}
                            className="px-2 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                          >
                            {cancelarMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : '¿Confirmar?'}
                          </button>
                          <button
                            onClick={() => setConfirmCancel(null)}
                            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmCancel(p.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600
                                     dark:text-red-400 border border-red-200 dark:border-red-800 rounded
                                     hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Ban className="w-3 h-3" /> Cancelar
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Página {meta.page} de {meta.totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                disabled={page >= meta.totalPages}
                className="p-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
