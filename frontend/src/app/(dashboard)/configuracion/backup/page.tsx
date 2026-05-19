'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  HardDrive, Play, Trash2, Settings, Cloud,
  CheckCircle, RefreshCw, Eye, X,
  Database, FolderOpen, Upload, Router,
  Shield,
} from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toaster';
import type { ApiRespuesta } from '@/types';

// ─── Tipos ────────────────────────────────────────────────────
interface BackupConfig {
  habilitado:      boolean;
  horario:         string;
  retencion:       number;
  directorioLocal: string;
  contenido:       string[];
  drive: {
    habilitado:       boolean;
    credencialesJson: string;
    carpetaId:        string;
  };
}

interface BackupRecord {
  id:           string;
  tipo:         'manual' | 'auto';
  estado:       'en_progreso' | 'completado' | 'error';
  archivoLocal?: string;
  tamanoBytes?: number;
  contenido:    string[];
  driveEstado:  string;
  errorMensaje?: string;
  logs:         string[];
  createdAt:    string;
  completadoEn?: string;
  creadoPor:    string;
}

interface BackupList {
  items: BackupRecord[];
  total: number;
}

// ─── API ──────────────────────────────────────────────────────
const fetchConfig = async (): Promise<BackupConfig> => {
  const res = await api.get<ApiRespuesta<BackupConfig>>('/admin/backup/config');
  return res.data.data;
};
const fetchBackups = async (): Promise<BackupList> => {
  const res = await api.get<ApiRespuesta<BackupList>>('/admin/backup', { params: { limit: 30 } });
  return res.data.data;
};
const fetchBackup = async (id: string): Promise<BackupRecord> => {
  const res = await api.get<ApiRespuesta<BackupRecord>>(`/admin/backup/${id}`);
  return res.data.data;
};

// ─── Helpers ──────────────────────────────────────────────────
function fmtBytes(bytes?: number) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' });
}
const CONTENIDO_OPTS = [
  { key: 'db',       label: 'Base de datos',      icon: Database },
  { key: 'config',   label: 'Configuraciones',    icon: FolderOpen },
  { key: 'uploads',  label: 'Archivos subidos',   icon: Upload },
  { key: 'mikrotik', label: 'Exports MikroTik',   icon: Router },
];

// ─── Badges ───────────────────────────────────────────────────
function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    completado:   'bg-green-100 text-green-700',
    error:        'bg-red-100 text-red-700',
    en_progreso:  'bg-blue-100 text-blue-700',
  };
  const labels: Record<string, string> = {
    completado:   'Completado',
    error:        'Error',
    en_progreso:  'En progreso',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[estado] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[estado] ?? estado}
    </span>
  );
}
function SubidaBadge({ estado }: { estado: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    subido:       { cls: 'text-green-600', label: '✓' },
    error:        { cls: 'text-red-500',   label: '✗' },
    pendiente:    { cls: 'text-yellow-500',label: '…' },
    deshabilitado:{ cls: 'text-gray-300',  label: '—' },
  };
  const { cls, label } = map[estado] ?? { cls: 'text-gray-400', label: '?' };
  return <span className={`font-bold text-base ${cls}`}>{label}</span>;
}

// ─── Modal de Logs ────────────────────────────────────────────
function LogsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['backup-detail', id],
    queryFn:  () => fetchBackup(id),
    refetchInterval: (q) =>
      q.state.data?.estado === 'en_progreso' ? 3000 : false,
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-sm text-gray-900">Logs del backup</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-gray-950 rounded-b-xl font-mono text-xs text-green-400 space-y-0.5">
          {isLoading && <p className="text-gray-500">Cargando...</p>}
          {data?.logs?.map((log, i) => <p key={i}>{log}</p>)}
          {data?.estado === 'en_progreso' && (
            <p className="text-yellow-400 animate-pulse">▌ En progreso...</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Panel de Configuración ───────────────────────────────────
function ConfigPanel({
  cfg,
  onSave,
  saving,
}: {
  cfg: BackupConfig;
  onSave: (c: Partial<BackupConfig>) => void;
  saving: boolean;
}) {
  const [tab, setTab] = useState<'general' | 'drive'>('general');
  const [form, setForm] = useState<BackupConfig>(cfg);

  useEffect(() => { setForm(cfg); }, [cfg]);

  const setNested = <K extends 'drive'>(
    section: K, key: keyof BackupConfig[K], value: any,
  ) => {
    setForm(prev => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
  };

  const toggleContenido = (key: string) =>
    setForm(prev => ({
      ...prev,
      contenido: prev.contenido.includes(key)
        ? prev.contenido.filter(c => c !== key)
        : [...prev.contenido, key],
    }));

  const tabs = [
    { key: 'general', label: 'General',      icon: Settings },
    { key: 'drive',   label: 'Google Drive', icon: Cloud },
  ] as const;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-gray-900 text-white px-5 py-3 font-semibold text-sm flex items-center gap-2">
        <Settings className="w-4 h-4" />
        Configuración
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
              tab === key
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-4">
        {/* ── GENERAL ─────────────────────────────────────────── */}
        {tab === 'general' && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Backup automático</p>
                <p className="text-xs text-gray-400">Ejecutar diariamente según el horario</p>
              </div>
              <button
                onClick={() => setForm(p => ({ ...p, habilitado: !p.habilitado }))}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  form.habilitado ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  form.habilitado ? 'translate-x-5' : ''
                }`} />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 w-28 font-medium">Hora de ejecución</label>
              <input
                type="time"
                value={form.horario}
                onChange={e => setForm(p => ({ ...p, horario: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 w-28 font-medium">Retención (backups)</label>
              <input
                type="number"
                min={1} max={50}
                value={form.retencion}
                onChange={e => setForm(p => ({ ...p, retencion: +e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Contenido a respaldar</p>
              <div className="grid grid-cols-2 gap-2">
                {CONTENIDO_OPTS.map(({ key, label, icon: Icon }) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 p-2 rounded-lg border cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={form.contenido.includes(key)}
                      onChange={() => toggleContenido(key)}
                      className="accent-blue-600"
                    />
                    <Icon className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 w-28 font-medium">Directorio</label>
              <input
                type="text"
                value={form.directorioLocal}
                onChange={e => setForm(p => ({ ...p, directorioLocal: e.target.value }))}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {/* ── DRIVE ───────────────────────────────────────────── */}
        {tab === 'drive' && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Subir a Google Drive</p>
                <p className="text-xs text-gray-400">Requiere una Cuenta de Servicio de Google</p>
              </div>
              <button
                onClick={() => setNested('drive', 'habilitado', !form.drive.habilitado)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  form.drive.habilitado ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  form.drive.habilitado ? 'translate-x-5' : ''
                }`} />
              </button>
            </div>

            <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700 space-y-1">
              <p className="font-semibold">Cómo configurar:</p>
              <p>1. Crea un proyecto en Google Cloud Console</p>
              <p>2. Activa la API de Google Drive</p>
              <p>3. Crea una Cuenta de Servicio y descarga el JSON de credenciales</p>
              <p>4. Comparte tu carpeta de Drive con el email de la cuenta de servicio</p>
              <p>5. Pega el contenido del JSON y el ID de la carpeta abajo</p>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">
                ID de carpeta en Drive
              </label>
              <input
                type="text"
                placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs..."
                value={form.drive.carpetaId}
                onChange={e => setNested('drive', 'carpetaId', e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">
                JSON de Cuenta de Servicio
              </label>
              <textarea
                rows={8}
                placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key": "...",\n  "client_email": "..."\n}'}
                value={form.drive.credencialesJson}
                onChange={e => setNested('drive', 'credencialesJson', e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </>
        )}

      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
        <button
          onClick={() => onSave(form)}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
          Guardar configuración
        </button>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────
export default function BackupPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [logsId, setLogsId] = useState<string | null>(null);

  const { data: cfg, isLoading: cfgLoading } = useQuery({
    queryKey: ['backup-config'],
    queryFn:  fetchConfig,
  });

  const { data: lista, isLoading: listaLoading } = useQuery({
    queryKey: ['backup-lista'],
    queryFn:  fetchBackups,
    refetchInterval: 10_000,
  });

  const saveMut = useMutation({
    mutationFn: (c: Partial<BackupConfig>) =>
      api.patch('/admin/backup/config', c).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backup-config'] });
      toast('Configuración guardada', { type: 'success' });
    },
    onError: () => toast('Error al guardar configuración', { type: 'error' }),
  });

  const createMut = useMutation({
    mutationFn: () => api.post('/admin/backup').then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backup-lista'] });
      toast('Backup iniciado en background', { type: 'success' });
    },
    onError: () => toast('Error al iniciar backup', { type: 'error' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/backup/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backup-lista'] });
      toast('Backup eliminado', { type: 'success' });
    },
    onError: () => toast('Error al eliminar backup', { type: 'error' }),
  });

  const backups  = lista?.items ?? [];
  const total    = lista?.total ?? 0;
  const ultimo   = backups.find(b => b.estado === 'completado');
  const enProgreso = backups.some(b => b.estado === 'en_progreso');

  const stats = [
    {
      label: 'Total backups',
      value: total,
      icon:  HardDrive,
      color: 'text-blue-600',
    },
    {
      label: 'Último completado',
      value: fmtDate(ultimo?.createdAt),
      icon:  CheckCircle,
      color: 'text-green-600',
    },
    {
      label: 'Tamaño último',
      value: fmtBytes(ultimo?.tamanoBytes),
      icon:  FolderOpen,
      color: 'text-purple-600',
    },
    {
      label: 'Estado',
      value: enProgreso ? 'En progreso' : (cfg?.habilitado ? 'Activo' : 'Manual'),
      icon:  enProgreso ? RefreshCw : Shield,
      color: enProgreso ? 'text-yellow-500' : (cfg?.habilitado ? 'text-green-600' : 'text-gray-500'),
    },
  ];

  if (cfgLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <>
      {logsId && <LogsModal id={logsId} onClose={() => setLogsId(null)} />}

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Copia de Seguridad</h1>
            <p className="text-sm text-gray-500 mt-1">
              Respaldos automáticos con subida a Google Drive.
            </p>
          </div>
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || enProgreso}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
          >
            {createMut.isPending || enProgreso
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Play className="w-4 h-4" />
            }
            Ejecutar ahora
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center flex-shrink-0">
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-500 truncate">{label}</p>
                <p className="text-sm font-semibold text-gray-900 truncate">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Config + Tabla */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Configuración */}
          {cfg && (
            <ConfigPanel
              cfg={cfg}
              onSave={c => saveMut.mutate(c)}
              saving={saveMut.isPending}
            />
          )}

          {/* Tabla de backups */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-gray-900 text-white px-5 py-3 font-semibold text-sm flex items-center gap-2">
              <HardDrive className="w-4 h-4" />
              Historial de backups
            </div>

            {listaLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : backups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <HardDrive className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">Sin backups aún</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium text-gray-500">Fecha</th>
                      <th className="px-4 py-2.5 text-left font-medium text-gray-500">Tipo</th>
                      <th className="px-4 py-2.5 text-left font-medium text-gray-500">Tamaño</th>
                      <th className="px-4 py-2.5 text-left font-medium text-gray-500">Estado</th>
                      <th className="px-4 py-2.5 text-center font-medium text-gray-500">Drive</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {backups.map(b => (
                      <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                          {fmtDate(b.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            b.tipo === 'manual'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            {b.tipo}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{fmtBytes(b.tamanoBytes)}</td>
                        <td className="px-4 py-2.5">
                          <EstadoBadge estado={b.estado} />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <SubidaBadge estado={b.driveEstado} />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => setLogsId(b.id)}
                              className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Ver logs"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {b.estado !== 'en_progreso' && (
                              <button
                                onClick={() => deleteMut.mutate(b.id)}
                                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                title="Eliminar"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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
          </div>
        </div>

        <p className="text-xs text-gray-400 text-center">
          Los backups se guardan en <code className="bg-gray-100 px-1 py-0.5 rounded">{cfg?.directorioLocal ?? '/opt/datafast/backups'}</code> en el servidor VPS.
        </p>
      </div>
    </>
  );
}
