'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Radio, Lock, Wifi, Eye, EyeOff } from 'lucide-react';
import { oltTr069ProfileApi, oltOnuPresetApi, type Tr069ProfileDto, type UpsertOltPresetDto } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const inputCls = cn(
  'w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground transition-colors outline-none',
  'focus:ring-2 focus:ring-primary/30 focus:border-primary border-border hover:border-muted-foreground/50',
);

const lockedInputCls = cn(
  'w-full px-3 py-2 text-sm rounded-lg border bg-muted/30 text-muted-foreground cursor-not-allowed',
  'border-border',
);

// Perfil TR-069 por OLT — equivalente al "TR069 Profile" de SmartOLT.
export function TabTr069({ oltId }: { oltId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['olt-tr069-profile', oltId],
    queryFn:  () => oltTr069ProfileApi.get(oltId),
  });

  const [enabled, setEnabled] = useState(false);
  const [mgmtVlan, setMgmtVlan] = useState('');
  const [mgmtGateway, setMgmtGateway] = useState('');
  const [mgmtMask, setMgmtMask] = useState('');

  // Precarga el formulario cuando llega el perfil.
  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setMgmtVlan(data.mgmtVlan != null ? String(data.mgmtVlan) : '');
    setMgmtGateway(data.mgmtGateway ?? '');
    setMgmtMask(data.mgmtMask ?? '');
  }, [data]);

  const mut = useMutation({
    mutationFn: () => {
      const dto: Tr069ProfileDto = {
        enabled,
        mgmtVlan: mgmtVlan.trim() ? Number(mgmtVlan) : undefined,
        mgmtGateway: mgmtGateway.trim(),
        mgmtMask: mgmtMask.trim(),
      };
      return oltTr069ProfileApi.set(oltId, dto);
    },
    onSuccess: () => {
      toast('Perfil TR-069 guardado', { type: 'success' });
      qc.invalidateQueries({ queryKey: ['olt-tr069-profile', oltId] });
    },
    onError: () => toast('No se pudo guardar el perfil TR-069', { type: 'error' }),
  });

  // ── Preset de auto-config (SSID/clave WiFi + admin web) ──
  const { data: preset } = useQuery({
    queryKey: ['olt-onu-preset', oltId],
    queryFn:  () => oltOnuPresetApi.get(oltId),
  });
  const [pEnabled, setPEnabled] = useState(false);
  const [pSsid, setPSsid] = useState('');
  const [pWifiPass, setPWifiPass] = useState('');
  const [pSsid5, setPSsid5] = useState('');
  const [pWifiPass5, setPWifiPass5] = useState('');
  const [pAdminUser, setPAdminUser] = useState('');
  const [pAdminPass, setPAdminPass] = useState('');
  const [showPass, setShowPass] = useState(true);
  useEffect(() => {
    if (preset === undefined) return;
    setPEnabled(preset?.enabled ?? false);
    setPSsid(preset?.wifiSsidTemplate ?? '');
    setPSsid5(preset?.wifi5gSsidTemplate ?? '');
    setPAdminUser(preset?.onuAdminUser ?? '');
    // Precarga las claves EN CLARO (el operador las ve y edita).
    setPWifiPass(preset?.wifiPassword ?? '');
    setPWifiPass5(preset?.wifi5gPassword ?? '');
    setPAdminPass(preset?.onuAdminPassword ?? '');
  }, [preset]);

  const presetMut = useMutation({
    mutationFn: () => {
      const dto: UpsertOltPresetDto = {
        enabled: pEnabled,
        wifiSsidTemplate: pSsid.trim(),
        wifi5gSsidTemplate: pSsid5.trim(),
        onuAdminUser: pAdminUser.trim(),
        // Secretos: solo se envían si el operador escribió uno nuevo (vacío = no tocar).
        ...(pWifiPass ? { wifiPassword: pWifiPass } : {}),
        ...(pWifiPass5 ? { wifi5gPassword: pWifiPass5 } : {}),
        ...(pAdminPass ? { onuAdminPassword: pAdminPass } : {}),
      };
      return oltOnuPresetApi.set(oltId, dto);
    },
    onSuccess: () => {
      toast('Preset de auto-config guardado', { type: 'success' });
      // El refetch re-precarga los campos (incluidas las claves en claro) desde el preset guardado.
      qc.invalidateQueries({ queryKey: ['olt-onu-preset', oltId] });
    },
    onError: () => toast('No se pudo guardar el preset', { type: 'error' }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Radio className="w-5 h-5 text-primary mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Perfil TR-069 de la OLT</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define la disponibilidad y los parámetros de red del carril de gestión TR-069 para
            las ONUs de esta OLT. Las credenciales del ACS son config del ERP (una sola instancia
            de GenieACS por instalación) — no se editan por OLT.
          </p>
        </div>
      </div>

      {/* Dos columnas responsive: izquierda lo editable por OLT, derecha la
          config ACS del ERP (solo lectura). Apila en pantallas menores. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <div className="rounded-xl border border-border p-4 space-y-4">
          {/* Habilitado */}
          <label className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 accent-primary" />
            <div>
              <span className="text-sm font-medium text-foreground">TR-069 habilitado en esta OLT</span>
              <p className="text-xs text-muted-foreground">Si está desactivado, el bootstrap TR-069 no se ofrece para sus ONUs.</p>
            </div>
          </label>

          {/* Parámetros de red — editables por OLT */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">VLAN de gestión</label>
              <input value={mgmtVlan} onChange={e => setMgmtVlan(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1600" inputMode="numeric" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Gateway de gestión (IP estática)</label>
              <input value={mgmtGateway} onChange={e => setMgmtGateway(e.target.value)} placeholder="10.16.0.1" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Máscara de gestión</label>
              <input value={mgmtMask} onChange={e => setMgmtMask(e.target.value)} placeholder="255.255.255.0" className={inputCls} />
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={() => mut.mutate()} disabled={mut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40">
              {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar perfil
            </button>
          </div>
        </div>

        {/* Config ACS — definida por el ERP, solo lectura */}
        <div className="rounded-xl border border-border p-4">
          <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Lock className="w-3 h-3" /> Config ACS (definida por el ERP)
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">
            Estos valores vienen del servidor (.env) y aplican a todas las OLTs de esta instalación.
            No son editables desde aquí — si necesitas cambiarlos, contacta al administrador del ERP.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">ACS URL (CWMP)</label>
              <input value={data?.acsUrl ?? ''} readOnly disabled className={lockedInputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Usuario ACS</label>
              <input value={data?.acsUsername ?? ''} readOnly disabled className={lockedInputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Clave ACS</label>
              <input value={data?.acsPassword ?? ''} readOnly disabled className={lockedInputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Usuario Connection Request</label>
              <input value={data?.connReqUsername ?? ''} readOnly disabled className={lockedInputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Clave Connection Request</label>
              <input value={data?.connReqPassword ?? ''} readOnly disabled className={lockedInputCls} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Preset de auto-config de ONUs ── */}
      <div className="flex items-start gap-3 pt-2 border-t border-border">
        <Wifi className="w-5 h-5 text-primary mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Auto-config de ONUs (preset)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Config que se inyecta automáticamente a cada ONU al aprovisionar y tras un
            restablecimiento de fábrica: nombre/clave WiFi y credenciales de acceso web. El SSID es
            una plantilla por cliente — usa <code className="px-1 rounded bg-muted">{'{cliente}'}</code> y
            se resuelve con el nombre del abonado (ej.: <code className="px-1 rounded bg-muted">DATAFAST-{'{cliente}'}</code>).
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20 cursor-pointer flex-1">
            <input type="checkbox" checked={pEnabled} onChange={e => setPEnabled(e.target.checked)} className="w-4 h-4 accent-primary" />
            <div>
              <span className="text-sm font-medium text-foreground">Inyección automática activada</span>
              <p className="text-xs text-muted-foreground">Al aprovisionar / tras factory-reset, la ONU recibe este preset por TR-069.</p>
            </div>
          </label>
          <button type="button" onClick={() => setShowPass(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:bg-accent whitespace-nowrap">
            {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {showPass ? 'Ocultar' : 'Mostrar'} claves
          </button>
        </div>

        {/* Dos columnas responsive (xl): WiFi 2.4 | WiFi 5; el admin abajo a lo ancho. */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {/* WiFi 2.4 GHz */}
          <div className="rounded-lg border border-border/60 p-3 space-y-3">
            <div className="text-xs font-semibold text-foreground">Red WiFi 2.4 GHz</div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre (SSID)</label>
              <input value={pSsid} onChange={e => setPSsid(e.target.value)} placeholder="DATAFAST-{cliente}" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Clave</label>
              <input type={showPass ? 'text' : 'password'} value={pWifiPass} onChange={e => setPWifiPass(e.target.value)}
                placeholder="mínimo 8 caracteres" className={inputCls} />
            </div>
          </div>

          {/* WiFi 5 GHz */}
          <div className="rounded-lg border border-border/60 p-3 space-y-3">
            <div className="text-xs font-semibold text-foreground">Red WiFi 5 GHz</div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre (SSID)</label>
              <input value={pSsid5} onChange={e => setPSsid5(e.target.value)} placeholder="DATAFAST-{cliente}-5G" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Clave</label>
              <input type={showPass ? 'text' : 'password'} value={pWifiPass5} onChange={e => setPWifiPass5(e.target.value)}
                placeholder="vacío = usa la clave de 2.4 GHz" className={inputCls} />
            </div>
          </div>

          {/* Acceso web admin — a lo ancho */}
          <div className="rounded-lg border border-border/60 p-3 space-y-3 xl:col-span-2">
            <div className="text-xs font-semibold text-foreground">Acceso web admin de la ONU</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Usuario</label>
                <input value={pAdminUser} onChange={e => setPAdminUser(e.target.value)} placeholder="telecomadmin" className={inputCls} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Clave</label>
                <input type={showPass ? 'text' : 'password'} value={pAdminPass} onChange={e => setPAdminPass(e.target.value)}
                  placeholder="mínimo 6 caracteres" className={inputCls} />
              </div>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">Placeholders del SSID: {'{cliente}'}, {'{contrato}'}, {'{sn}'} — se resuelven con los datos del abonado.</p>

        <div className="flex justify-end">
          <button onClick={() => presetMut.mutate()} disabled={presetMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40">
            {presetMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar preset
          </button>
        </div>
      </div>
    </div>
  );
}
