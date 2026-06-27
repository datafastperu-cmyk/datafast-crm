'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  oltNativoApi,
  type OltProveedorConfig,
  type TipoProveedor,
  type UpsertProveedorDto,
} from '@/lib/api/olt-nativo';

// ─── Chips ────────────────────────────────────────────────────

const HEALTH_CHIP: Record<string, string> = {
  ok:       'bg-green-100 text-green-800',
  degraded: 'bg-yellow-100 text-yellow-800',
  down:     'bg-red-100 text-red-800',
  unknown:  'bg-gray-100 text-gray-600',
};

const CIRCUIT_CHIP: Record<string, string> = {
  closed:    'bg-green-100 text-green-800',
  half_open: 'bg-yellow-100 text-yellow-800',
  open:      'bg-red-100 text-red-800',
};

const TIPO_LABEL: Record<TipoProveedor, string> = {
  nativo_ssh:  'SSH Nativo',
  nativo_snmp: 'SNMP Nativo',
  smartolt:    'SmartOLT',
  adminolt:    'AdminOLT',
};

// ─── Form vacío ───────────────────────────────────────────────

const EMPTY_FORM: UpsertProveedorDto = {
  tipo:          'nativo_ssh',
  prioridad:     1,
  activo:        true,
  ip:            '',
  port:          23,
  username:      '',
  password:      '',
  brand:         'huawei',
  baseUrl:       '',
  apiKey:        '',
  oltIdExterno:  '',
};

// ─── Component ────────────────────────────────────────────────

export function ProveedoresTab({ oltId }: { oltId: string }) {
  const qc = useQueryClient();

  const { data: proveedores = [], isLoading } = useQuery({
    queryKey: ['olt-proveedores', oltId],
    queryFn:  () => oltNativoApi.listarProveedores(oltId),
  });

  const [showForm, setShowForm]     = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm]             = useState<UpsertProveedorDto>(EMPTY_FORM);
  const [error, setError]           = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['olt-proveedores', oltId] });

  const upsertMut = useMutation({
    mutationFn: (dto: UpsertProveedorDto) => oltNativoApi.upsertProveedor(oltId, dto),
    onSuccess: () => { invalidate(); setShowForm(false); setEditingId(null); setError(null); },
    onError:   (e: any) => setError(e?.response?.data?.message ?? e.message),
  });

  const resetMut = useMutation({
    mutationFn: (configId: string) => oltNativoApi.resetCircuit(configId),
    onSuccess: invalidate,
    onError:   (e: any) => setError(e?.response?.data?.message ?? e.message),
  });

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowForm(true);
  }

  function openEdit(cfg: OltProveedorConfig) {
    setEditingId(cfg.id);
    setForm({
      tipo:      cfg.tipo,
      prioridad: cfg.prioridad,
      activo:    cfg.activo,
      // Credenciales no se devuelven completas desde backend (cifradas)
      // Solo actualizamos lo que el usuario escriba explícitamente
    });
    setError(null);
    setShowForm(true);
  }

  function setField<K extends keyof UpsertProveedorDto>(k: K, v: UpsertProveedorDto[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  const isNativo = form.tipo === 'nativo_ssh' || form.tipo === 'nativo_snmp';

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-gray-400">Cargando proveedores…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Tabla de proveedores */}
      {proveedores.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Tipo', 'Prioridad', 'Activo', 'Health', 'Circuit', 'Latencia', ''].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {proveedores.map((cfg) => (
                <tr key={cfg.id}>
                  <td className="px-4 py-3 font-medium">{TIPO_LABEL[cfg.tipo]}</td>
                  <td className="px-4 py-3 text-gray-600">{cfg.prioridad}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.activo ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                      {cfg.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_CHIP[cfg.healthEstado] ?? HEALTH_CHIP.unknown}`}>
                      {cfg.healthEstado}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CIRCUIT_CHIP[cfg.circuitEstado] ?? CIRCUIT_CHIP.closed}`}>
                      {cfg.circuitEstado}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {cfg.healthLatenciaMs != null ? `${cfg.healthLatenciaMs}ms` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(cfg)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Editar
                      </button>
                      {cfg.circuitEstado !== 'closed' && (
                        <button
                          onClick={() => resetMut.mutate(cfg.id)}
                          disabled={resetMut.isPending}
                          className="text-xs text-amber-600 hover:underline disabled:opacity-50"
                        >
                          Reset circuit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {proveedores.length === 0 && !showForm && (
        <p className="text-sm text-gray-400">No hay proveedores configurados para esta OLT.</p>
      )}

      {/* Botón agregar */}
      {!showForm && (
        <button
          onClick={openNew}
          className="rounded-md btn-primary px-4 py-2 text-sm font-medium"
        >
          + Agregar proveedor
        </button>
      )}

      {/* Formulario inline */}
      {showForm && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">
            {editingId ? 'Editar proveedor' : 'Nuevo proveedor'}
          </h3>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
          )}

          <div className="grid grid-cols-3 gap-3">
            {/* Tipo */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
              <select
                value={form.tipo}
                onChange={(e) => setField('tipo', e.target.value as TipoProveedor)}
                disabled={!!editingId}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
              >
                <option value="nativo_ssh">SSH Nativo</option>
                <option value="nativo_snmp">SNMP Nativo</option>
                <option value="smartolt">SmartOLT</option>
                <option value="adminolt">AdminOLT</option>
              </select>
            </div>

            {/* Prioridad */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Prioridad</label>
              <input
                type="number"
                min={1}
                max={99}
                value={form.prioridad ?? 1}
                onChange={(e) => setField('prioridad', parseInt(e.target.value, 10))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>

            {/* Activo */}
            <div className="flex items-end pb-1.5">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.activo ?? true}
                  onChange={(e) => setField('activo', e.target.checked)}
                  className="rounded border-input"
                />
                Activo
              </label>
            </div>
          </div>

          {/* Campos específicos por tipo */}
          {isNativo ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">IP de gestión</label>
                <input
                  type="text"
                  value={form.ip ?? ''}
                  onChange={(e) => setField('ip', e.target.value)}
                  placeholder="10.0.50.2"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Puerto SSH</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port ?? 22}
                  onChange={(e) => setField('port', parseInt(e.target.value, 10))}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Usuario</label>
                <input
                  type="text"
                  value={form.username ?? ''}
                  onChange={(e) => setField('username', e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Contraseña {editingId && <span className="text-gray-400">(dejar vacío para no cambiar)</span>}
                </label>
                <input
                  type="password"
                  value={form.password ?? ''}
                  onChange={(e) => setField('password', e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Marca</label>
                <select
                  value={form.brand ?? 'huawei'}
                  onChange={(e) => setField('brand', e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="huawei">Huawei</option>
                  <option value="zte">ZTE</option>
                  <option value="vsol">V-SOL</option>
                  <option value="cdata">C-Data</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">URL base</label>
                <input
                  type="url"
                  value={form.baseUrl ?? ''}
                  onChange={(e) => setField('baseUrl', e.target.value)}
                  placeholder="https://app.smartolt.com"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  API Key {editingId && <span className="text-gray-400">(dejar vacío para no cambiar)</span>}
                </label>
                <input
                  type="password"
                  value={form.apiKey ?? ''}
                  onChange={(e) => setField('apiKey', e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">OLT ID externo</label>
                <input
                  type="text"
                  value={form.oltIdExterno ?? ''}
                  onChange={(e) => setField('oltIdExterno', e.target.value)}
                  placeholder="UUID de la OLT en la plataforma externa"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => upsertMut.mutate(form)}
              disabled={upsertMut.isPending}
              className="rounded-md btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {upsertMut.isPending ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); setError(null); }}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
