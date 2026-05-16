'use client';

import { useState }              from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Download, Save, Loader2, Info,
  CheckCircle2, XCircle, Server, Router,
  RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';

import { openvpnApi }   from '@/lib/api/openvpn';
import { mikrotikApi }  from '@/lib/api/mikrotik';
import { useToast }     from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import type { UpsertOpenvpnDto } from '@/lib/api/openvpn';

const DEFAULTS: UpsertOpenvpnDto = {
  nombre:      'Servidor VPN',
  servidorIp:  '',
  puerto:      1194,
  protocolo:   'udp',
  dispositivo: 'tun',
  vpnNetwork:  '10.8.0.0',
  vpnNetmask:  '255.255.255.0',
};

export function VpnContent() {
  const { toast }   = useToast();
  const queryClient = useQueryClient();
  const [showCerts, setShowCerts] = useState(false);

  const { data: config, isLoading: loadingConfig } = useQuery({
    queryKey: ['openvpn-config'],
    queryFn:  openvpnApi.getConfig,
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

  const set = (key: keyof UpsertOpenvpnDto, val: any) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleSave = () => {
    if (!form.servidorIp) {
      toast('La IP del servidor es obligatoria', { type: 'error' });
      return;
    }
    saveMut.mutate(form);
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          Servidor OpenVPN
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Configura el túnel VPN para conectar los routers MikroTik al VPS de forma segura.
        </p>
      </div>

      {/* Info banner */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-sm text-blue-300">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <p className="font-medium mb-1">¿Cómo funciona?</p>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-300/80">
              <li>Configura los parámetros del servidor y guarda.</li>
              <li>Descarga el <code>server.conf</code> y copia los certificados al VPS.</li>
              <li>Para cada router MikroTik, descarga su archivo <code>.ovpn</code>, agrega los certificados y cárgalo en el router.</li>
              <li>Una vez conectado, registra la IP VPN asignada en la configuración del router.</li>
            </ol>
          </div>
        </div>
      </div>

      {loadingConfig ? (
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando configuración...
        </div>
      ) : (
        <>
          {/* Formulario de configuración */}
          <div className="bg-[hsl(var(--sidebar-bg))] border border-white/10 rounded-xl p-5 space-y-4">
            <h2 className="font-medium text-white text-sm flex items-center gap-2">
              <Server className="w-4 h-4 text-primary" />
              Parámetros del servidor
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-gray-400 mb-1 block">Nombre</label>
                <input
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                  value={form.nombre}
                  onChange={(e) => set('nombre', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">IP pública del VPS *</label>
                <input
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                  value={form.servidorIp}
                  onChange={(e) => set('servidorIp', e.target.value)}
                  placeholder="149.34.48.224"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Puerto</label>
                <input
                  type="number"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                  value={form.puerto}
                  onChange={(e) => set('puerto', parseInt(e.target.value))}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Protocolo</label>
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                  value={form.protocolo}
                  onChange={(e) => set('protocolo', e.target.value)}
                >
                  <option value="udp">UDP (recomendado)</option>
                  <option value="tcp">TCP</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Dispositivo</label>
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                  value={form.dispositivo}
                  onChange={(e) => set('dispositivo', e.target.value)}
                >
                  <option value="tun">TUN (enrutado)</option>
                  <option value="tap">TAP (bridged)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Red VPN</label>
                <input
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                  value={form.vpnNetwork}
                  onChange={(e) => set('vpnNetwork', e.target.value)}
                  placeholder="10.8.0.0"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Máscara VPN</label>
                <input
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                  value={form.vpnNetmask}
                  onChange={(e) => set('vpnNetmask', e.target.value)}
                  placeholder="255.255.255.0"
                />
              </div>
            </div>

            {/* Certificados (colapsable) */}
            <button
              onClick={() => setShowCerts(!showCerts)}
              className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
            >
              {showCerts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Certificados y claves (opcional — pegar para incluirlos en los .ovpn generados)
            </button>

            {showCerts && (
              <div className="space-y-3 pt-1">
                {[
                  { key: 'caCert',     label: 'CA Certificate (ca.crt)' },
                  { key: 'serverCert', label: 'Server Certificate (server.crt)' },
                  { key: 'serverKey',  label: 'Server Key (server.key)' },
                  { key: 'dhParams',   label: 'DH Parameters (dh.pem)' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs text-gray-400 mb-1 block">{label}</label>
                    <textarea
                      rows={3}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-primary/50 resize-none"
                      value={(form as any)[key] ?? ''}
                      onChange={(e) => set(key as any, e.target.value)}
                      placeholder={`-----BEGIN ${key === 'dhParams' ? 'DH PARAMETERS' : 'CERTIFICATE'}-----`}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={saveMut.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/80 disabled:opacity-50"
              >
                {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar configuración
              </button>

              {config && (
                <>
                  <button
                    onClick={() => openvpnApi.downloadServerConf().catch(() => toast('Error al descargar', { type: 'error' }))}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white/10 text-white rounded-lg hover:bg-white/15 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    server.conf
                  </button>
                  <button
                    onClick={() => openvpnApi.downloadInstrucciones().catch(() => toast('Error al descargar', { type: 'error' }))}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white/10 text-white rounded-lg hover:bg-white/15 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Instrucciones
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Clientes VPN — uno por router */}
          {config && routers.length > 0 && (
            <div className="bg-[hsl(var(--sidebar-bg))] border border-white/10 rounded-xl p-5">
              <h2 className="font-medium text-white text-sm flex items-center gap-2 mb-4">
                <Router className="w-4 h-4 text-primary" />
                Descargar configuración de cliente por router
              </h2>
              <div className="space-y-2">
                {routers.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-white/10 hover:border-white/20 transition-colors"
                  >
                    <div>
                      <div className="text-sm font-medium text-white">{r.nombre}</div>
                      <div className="text-xs text-gray-400">
                        {r.ipGestion}
                        {r.vpnIp && <span className="ml-2 text-blue-400">VPN: {r.vpnIp}</span>}
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
  );
}
