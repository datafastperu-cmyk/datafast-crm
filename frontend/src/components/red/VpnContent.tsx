'use client';

import { useState }              from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Download, Save, Loader2, Info,
  CheckCircle2, XCircle, Server, Router,
  RefreshCw, ChevronDown, ChevronUp,
  Play, Square, RotateCcw, Terminal,
  Users, Key, Trash2, Plus, AlertTriangle,
  Wifi, WifiOff, Database,
} from 'lucide-react';

import { openvpnApi }   from '@/lib/api/openvpn';
import { mikrotikApi }  from '@/lib/api/mikrotik';
import { useToast }     from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import { Portal } from '@/components/ui/portal';
import type { UpsertOpenvpnDto } from '@/lib/api/openvpn';

const DEFAULTS: UpsertOpenvpnDto = {
  nombre:      'Servidor VPN',
  servidorIp:  '',
  puerto:      1194,
  protocolo:   'tcp',
  dispositivo: 'tun',
  vpnNetwork:  '10.8.0.0',
  vpnNetmask:  '255.255.255.0',
};

type Tab = 'config' | 'status' | 'clients' | 'logs';

export function VpnContent() {
  const { toast }   = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab]           = useState<Tab>('status');
  const [showCerts, setShowCerts] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  const { data: config, isLoading: loadingConfig } = useQuery({
    queryKey: ['openvpn-config'],
    queryFn:  openvpnApi.getConfig,
  });

  const { data: status, isLoading: loadingStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['openvpn-status'],
    queryFn:  openvpnApi.getSystemStatus,
    refetchInterval: tab === 'status' ? 15000 : false,
  });

  const { data: clients = [], isLoading: loadingClients, refetch: refetchClients } = useQuery({
    queryKey: ['openvpn-clients'],
    queryFn:  openvpnApi.listClients,
    enabled:  tab === 'clients',
  });

  const { data: logs = '', isLoading: loadingLogs, refetch: refetchLogs } = useQuery({
    queryKey: ['openvpn-logs'],
    queryFn:  () => openvpnApi.getLogs(150),
    enabled:  tab === 'logs',
  });

  const { data: routers = [] } = useQuery({
    queryKey: ['routers'],
    queryFn:  mikrotikApi.listar,
  });

  const [form, setForm] = useState<UpsertOpenvpnDto>(DEFAULTS);
  const [initialized, setInitialized] = useState(false);

  if (config && !initialized) {
    setForm({
      nombre:      config.nombre,
      servidorIp:  config.servidorIp,
      puerto:      config.puerto,
      protocolo:   config.protocolo,
      dispositivo: config.dispositivo,
      vpnNetwork:  config.vpnNetwork,
      vpnNetmask:  config.vpnNetmask,
      caCert:      config.caCert ?? '',
      serverCert:  config.serverCert ?? '',
      serverKey:   config.serverKey ?? '',
      dhParams:    config.dhParams ?? '',
      taKey:       config.taKey ?? '',
    });
    setInitialized(true);
  }

  const saveMut = useMutation({
    mutationFn: (dto: UpsertOpenvpnDto) => openvpnApi.upsertConfig(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['openvpn-config'] });
      toast('Configuración OpenVPN guardada', { type: 'success' });
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const syncMut = useMutation({
    mutationFn: openvpnApi.syncCerts,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['openvpn-config'] });
      setInitialized(false);
      toast('Certificados sincronizados desde el servidor', { type: 'success' });
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const controlMut = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart' | 'reload') =>
      openvpnApi.controlService(action),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['openvpn-status'] });
      toast(result.ok ? 'Servicio actualizado' : `Error: ${result.output}`, {
        type: result.ok ? 'success' : 'error',
      });
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const generateMut = useMutation({
    mutationFn: (nombre: string) => openvpnApi.generateClient(nombre),
    onSuccess: (_, nombre) => {
      queryClient.invalidateQueries({ queryKey: ['openvpn-clients'] });
      toast(`Certificado generado para "${nombre}"`, { type: 'success' });
      setNewClientName('');
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const revokeMut = useMutation({
    mutationFn: (nombre: string) => openvpnApi.revokeClient(nombre),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['openvpn-clients'] });
      toast('Certificado revocado', { type: 'success' });
    },
    onError: (err) => toast(parseApiError(err), { type: 'error' }),
  });

  const set = (key: keyof UpsertOpenvpnDto, val: any) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleSave = () => {
    if (!form.servidorIp) {
      toast('La IP del servidor es obligatoria', { type: 'error' });
      return;
    }
    saveMut.mutate(form);
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'status',  label: 'Estado',       icon: <Server className="w-3.5 h-3.5" /> },
    { id: 'config',  label: 'Configuración', icon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'clients', label: 'Certificados',  icon: <Key className="w-3.5 h-3.5" /> },
    { id: 'logs',    label: 'Logs',          icon: <Terminal className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Servidor OpenVPN
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            VPN de gestión para routers MikroTik, Huawei OLT, ZTE, VSOL, Ubiquiti.
          </p>
        </div>
        {status && (
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
            status.serviceActive
              ? 'bg-green-100 text-green-700 border border-green-300 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20'
              : 'bg-red-100 text-red-700 border border-red-300 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20',
          )}>
            {status.serviceActive
              ? <><Wifi className="w-3.5 h-3.5" /> Activo</>
              : <><WifiOff className="w-3.5 h-3.5" /> Inactivo</>}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-xl p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors',
              tab === t.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Estado ──────────────────────────────────────────── */}
      {tab === 'status' && (
        <div className="space-y-4">
          {loadingStatus ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Consultando estado...
            </div>
          ) : !status?.installed ? (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-5 text-sm">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-yellow-700 dark:text-yellow-300 mb-1">OpenVPN no está instalado</p>
                  <p className="text-yellow-600/80 dark:text-yellow-400/80 text-xs">
                    El instalador del sistema ejecuta <code className="bg-muted/60 px-1 rounded">scripts/openvpn-setup.sh</code> automáticamente.
                    Si instalaste manualmente, ejecuta ese script en el VPS.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Cards de estado */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatusCard
                  label="Servicio"
                  value={status.serviceActive ? 'Activo' : 'Detenido'}
                  icon={status.serviceActive ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                  ok={status.serviceActive}
                />
                <StatusCard
                  label="Versión"
                  value={status.openvpnVersion || '—'}
                  icon={<Server className="w-4 h-4 text-blue-500" />}
                  ok
                />
                <StatusCard
                  label="Clientes conectados"
                  value={String(status.connectedClients.length)}
                  icon={<Users className="w-4 h-4 text-purple-500" />}
                  ok
                />
                <StatusCard
                  label="Interfaz TUN"
                  value={status.tunIp ? `tun0 — ${status.tunIp}` : (status.tunInterface ?? 'No disponible')}
                  icon={<Router className="w-4 h-4 text-cyan-500" />}
                  ok={!!status.tunInterface}
                />
              </div>

              {/* Info adicional */}
              <div className="bg-card border border-border rounded-xl p-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                <InfoRow label="Puerto"      value={`${status.port}/${status.protocol.toUpperCase()}`} />
                <InfoRow label="Red VPN"     value={status.network} />
                <InfoRow label="IP servidor" value={status.serverIp || '—'} />
                <InfoRow label="CA expira"   value={status.caExpiry ?? '—'} />
                <InfoRow label="Cert server" value={status.serverExpiry ?? '—'} />
                <InfoRow label="Instalado"   value={status.installedAt ? new Date(status.installedAt).toLocaleDateString('es-PE') : '—'} />
              </div>

              {/* Controles del servicio */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-xs font-medium text-muted-foreground mb-3">Control del servicio</h3>
                <div className="flex flex-wrap gap-2">
                  <ServiceBtn
                    label="Iniciar"
                    icon={<Play className="w-3.5 h-3.5" />}
                    color="green"
                    disabled={status.serviceActive || controlMut.isPending}
                    loading={controlMut.isPending}
                    onClick={() => controlMut.mutate('start')}
                  />
                  <ServiceBtn
                    label="Detener"
                    icon={<Square className="w-3.5 h-3.5" />}
                    color="red"
                    disabled={!status.serviceActive || controlMut.isPending}
                    loading={controlMut.isPending}
                    onClick={() => controlMut.mutate('stop')}
                  />
                  <ServiceBtn
                    label="Reiniciar"
                    icon={<RotateCcw className="w-3.5 h-3.5" />}
                    color="yellow"
                    disabled={controlMut.isPending}
                    loading={controlMut.isPending}
                    onClick={() => controlMut.mutate('restart')}
                  />
                  <button
                    onClick={() => refetchStatus()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted/40 rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Actualizar
                  </button>
                </div>
              </div>

              {/* Clientes conectados ahora */}
              {status.connectedClients.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <h3 className="text-xs font-medium text-muted-foreground mb-3">
                    Clientes conectados ahora ({status.connectedClients.length})
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground/70 border-b border-border/40">
                          <th className="text-left pb-2 pr-4">Nombre</th>
                          <th className="text-left pb-2 pr-4">IP Real</th>
                          <th className="text-left pb-2 pr-4">IP VPN</th>
                          <th className="text-left pb-2 pr-4">Recibido</th>
                          <th className="text-left pb-2">Enviado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {status.connectedClients.map((c) => (
                          <tr key={c.commonName} className="border-b border-border/40 last:border-0">
                            <td className="py-2 pr-4 font-mono text-foreground">{c.commonName}</td>
                            <td className="py-2 pr-4 text-muted-foreground">{c.realAddress}</td>
                            <td className="py-2 pr-4 text-emerald-600 dark:text-emerald-400 font-mono">{c.vpnAddress}</td>
                            <td className="py-2 pr-4 text-muted-foreground">{formatBytes(c.bytesReceived)}</td>
                            <td className="py-2 text-muted-foreground">{formatBytes(c.bytesSent)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── TAB: Configuración ───────────────────────────────────── */}
      {tab === 'config' && (
        <div className="space-y-4">
          {loadingConfig ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
            </div>
          ) : (
            <>
              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium text-foreground text-sm flex items-center gap-2">
                    <Server className="w-4 h-4 text-primary" />
                    Parámetros del servidor
                  </h2>
                  {config && (
                    <button
                      onClick={() => syncMut.mutate()}
                      disabled={syncMut.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                    >
                      {syncMut.isPending
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Database className="w-3.5 h-3.5" />}
                      Sincronizar certs desde servidor
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">Nombre</label>
                    <input
                      className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={form.nombre}
                      onChange={(e) => set('nombre', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">IP pública del VPS *</label>
                    <input
                      className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={form.servidorIp}
                      onChange={(e) => set('servidorIp', e.target.value)}
                      placeholder="149.34.48.224"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Puerto</label>
                    <input
                      type="number"
                      className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={form.puerto}
                      onChange={(e) => set('puerto', parseInt(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Protocolo</label>
                    <select
                      className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={form.protocolo}
                      onChange={(e) => set('protocolo', e.target.value)}
                    >
                      <option value="tcp">TCP (RouterOS 6.x compatible)</option>
                      <option value="udp">UDP (mejor rendimiento)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Dispositivo</label>
                    <select
                      className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={form.dispositivo}
                      onChange={(e) => set('dispositivo', e.target.value)}
                    >
                      <option value="tun">TUN (enrutado)</option>
                      <option value="tap">TAP (bridged)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Red VPN</label>
                    <input
                      className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={form.vpnNetwork}
                      onChange={(e) => set('vpnNetwork', e.target.value)}
                      placeholder="10.8.0.0"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Máscara VPN</label>
                    <input
                      className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={form.vpnNetmask}
                      onChange={(e) => set('vpnNetmask', e.target.value)}
                      placeholder="255.255.255.0"
                    />
                  </div>
                </div>

                {/* Certificados colapsables */}
                <button
                  onClick={() => setShowCerts(!showCerts)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showCerts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  Certificados y claves PKI
                </button>

                {showCerts && (
                  <div className="space-y-3 pt-1">
                    {[
                      { key: 'caCert',     label: 'CA Certificate (ca.crt)' },
                      { key: 'serverCert', label: 'Server Certificate (server.crt)' },
                      { key: 'serverKey',  label: 'Server Key (server.key)' },
                      { key: 'dhParams',   label: 'DH Parameters (dh.pem)' },
                      { key: 'taKey',      label: 'TLS-Crypt Key (ta.key)' },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
                        <textarea
                          rows={3}
                          className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                          value={(form as any)[key] ?? ''}
                          onChange={(e) => set(key as any, e.target.value)}
                          placeholder="-----BEGIN ..."
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    onClick={handleSave}
                    disabled={saveMut.isPending}
                    className="btn-primary"
                  >
                    {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Guardar configuración
                  </button>

                  {config && (
                    <>
                      <button
                        onClick={() => openvpnApi.downloadServerConf().catch(() => toast('Error al descargar', { type: 'error' }))}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        server.conf
                      </button>
                      <button
                        onClick={() => openvpnApi.downloadInstrucciones().catch(() => toast('Error al descargar', { type: 'error' }))}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Instrucciones
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Descarga por router (legacy inline) */}
              {config && routers.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-5">
                  <h2 className="font-medium text-foreground text-sm flex items-center gap-2 mb-4">
                    <Router className="w-4 h-4 text-primary" />
                    .ovpn inline por router (certs de BD)
                  </h2>
                  <div className="space-y-2">
                    {routers.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-muted-foreground/40 transition-colors"
                      >
                        <div>
                          <div className="text-sm font-medium text-foreground">{r.nombre}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.ipGestion}
                            {r.vpnIp && <span className="ml-2 text-blue-600 dark:text-blue-400">VPN: {r.vpnIp}</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => openvpnApi.downloadClienteOvpn(r.nombre).catch(() => toast('Error al descargar', { type: 'error' }))}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/20 text-primary rounded-lg hover:bg-primary/30 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          .ovpn
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── TAB: Certificados ────────────────────────────────────── */}
      {tab === 'clients' && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-medium text-foreground text-sm flex items-center gap-2">
                <Key className="w-4 h-4 text-primary" />
                Certificados de clientes
              </h2>
              <button
                onClick={() => refetchClients()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Actualizar
              </button>
            </div>

            {/* Generar nuevo */}
            <div className="flex gap-2 mb-4">
              <input
                className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Nombre del cliente (ej: router-sucursal-norte)"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newClientName && generateMut.mutate(newClientName)}
              />
              <button
                onClick={() => newClientName && generateMut.mutate(newClientName)}
                disabled={!newClientName || generateMut.isPending}
                className="btn-primary"
              >
                {generateMut.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Plus className="w-4 h-4" />}
                Generar
              </button>
            </div>

            <p className="text-xs text-muted-foreground/70 mb-4">
              El nombre debe tener 2-64 caracteres alfanuméricos, guión o guión bajo. Ejemplo: <code className="bg-muted px-1 rounded">mikrotik-ccb-norte</code>
            </p>

            {/* Lista */}
            {loadingClients ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
              </div>
            ) : clients.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No hay certificados generados todavía.
              </p>
            ) : (
              <div className="space-y-2">
                {clients.map((name) => (
                  <div
                    key={name}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-muted-foreground/40 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Key className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                      <span className="text-sm font-mono text-foreground">{name}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openvpnApi.downloadClient(name).catch(() => toast('Error al descargar', { type: 'error' }))}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/20 text-primary rounded-lg hover:bg-primary/30 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        .ovpn
                      </button>
                      <button
                        onClick={() => setPendingRevoke(name)}
                        disabled={revokeMut.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Revocar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: Logs ────────────────────────────────────────────── */}
      {tab === 'logs' && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium text-foreground text-sm flex items-center gap-2">
              <Terminal className="w-4 h-4 text-primary" />
              Log del servidor OpenVPN
            </h2>
            <button
              onClick={() => refetchLogs()}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Actualizar
            </button>
          </div>

          {loadingLogs ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando logs...
            </div>
          ) : !logs ? (
            <p className="text-sm text-muted-foreground/70 text-center py-6">
              Log no disponible. El servicio debe estar instalado y con logs activos.
            </p>
          ) : (
            <pre className="text-xs font-mono text-foreground/80 bg-muted/60 rounded-lg p-4 overflow-x-auto max-h-[500px] overflow-y-auto leading-relaxed whitespace-pre-wrap">
              {logs}
            </pre>
          )}
        </div>
      )}

      {pendingRevoke && (
        <Portal>
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <p className="font-semibold text-foreground">Revocar certificado</p>
            <p className="text-sm text-muted-foreground">
              ¿Revocar el certificado de <strong>{pendingRevoke}</strong>? El cliente perderá acceso a la VPN.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setPendingRevoke(null)}
                disabled={revokeMut.isPending}
                className="flex-1 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => { revokeMut.mutate(pendingRevoke); setPendingRevoke(null); }}
                disabled={revokeMut.isPending}
                className="flex-1 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-60"
              >
                Revocar
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

// ── Componentes auxiliares ────────────────────────────────────

function StatusCard({
  label, value, icon, ok,
}: {
  label: string; value: string; icon: React.ReactNode; ok: boolean;
}) {
  return (
    <div className={cn(
      'rounded-xl border p-4 space-y-2',
      ok
        ? 'bg-muted/30 border-border'
        : 'bg-destructive/5 border-destructive/20',
    )}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-sm font-medium text-foreground truncate">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground/70 mb-0.5">{label}</div>
      <div className="text-foreground font-mono">{value}</div>
    </div>
  );
}

function ServiceBtn({
  label, icon, color, disabled, loading, onClick,
}: {
  label: string; icon: React.ReactNode; color: 'green' | 'red' | 'yellow';
  disabled: boolean; loading: boolean; onClick: () => void;
}) {
  const colors = {
    green:  'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/25 hover:bg-green-500/20',
    red:    'bg-red-500/10   text-red-700   dark:text-red-400   border-red-500/25   hover:bg-red-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/25 hover:bg-yellow-500/20',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors disabled:opacity-40',
        colors[color],
      )}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
