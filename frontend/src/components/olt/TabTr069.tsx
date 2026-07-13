'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Radio, ShieldCheck } from 'lucide-react';
import { oltTr069ProfileApi, type Tr069ProfileDto } from '@/lib/api/olt-nativo';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

const inputCls = cn(
  'w-full px-3 py-2 text-sm rounded-lg border bg-background text-foreground transition-colors outline-none',
  'focus:ring-2 focus:ring-primary/30 focus:border-primary border-border hover:border-muted-foreground/50',
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
  const [acsUrl, setAcsUrl] = useState('');
  const [mgmtVlan, setMgmtVlan] = useState('');
  const [acsUsername, setAcsUsername] = useState('');
  const [acsPassword, setAcsPassword] = useState('');

  // Precarga el formulario cuando llega el perfil.
  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setAcsUrl(data.acsUrl ?? '');
    setMgmtVlan(data.mgmtVlan != null ? String(data.mgmtVlan) : '');
    setAcsUsername(data.acsUsername ?? '');
    setAcsPassword('');
  }, [data]);

  const mut = useMutation({
    mutationFn: () => {
      const dto: Tr069ProfileDto = {
        enabled,
        acsUrl: acsUrl.trim(),
        acsUsername: acsUsername.trim(),
        mgmtVlan: mgmtVlan.trim() ? Number(mgmtVlan) : undefined,
      };
      if (acsPassword) dto.acsPassword = acsPassword;
      return oltTr069ProfileApi.set(oltId, dto);
    },
    onSuccess: () => {
      toast('Perfil TR-069 guardado', { type: 'success' });
      setAcsPassword('');
      qc.invalidateQueries({ queryKey: ['olt-tr069-profile', oltId] });
    },
    onError: () => toast('No se pudo guardar el perfil TR-069', { type: 'error' }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-start gap-3">
        <Radio className="w-5 h-5 text-primary mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Perfil TR-069 de la OLT</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define la disponibilidad del carril de gestión TR-069 para las ONUs de esta OLT.
            La ACS URL llega a la ONU por DHCP Option 43 (MikroTik). El usuario/clave CWMP son
            opcionales (endurecimiento: la ONU se autentica ante GenieACS).
          </p>
        </div>
      </div>

      {/* Habilitado */}
      <label className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 accent-primary" />
        <div>
          <span className="text-sm font-medium text-foreground">TR-069 habilitado en esta OLT</span>
          <p className="text-xs text-muted-foreground">Si está desactivado, el bootstrap TR-069 no se ofrece para sus ONUs.</p>
        </div>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">ACS URL (CWMP)</label>
          <input value={acsUrl} onChange={e => setAcsUrl(e.target.value)} placeholder="http://10.8.1.1:7547" className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">VLAN de gestión</label>
          <input value={mgmtVlan} onChange={e => setMgmtVlan(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1600" inputMode="numeric" className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Usuario ACS (CWMP)</label>
          <input value={acsUsername} onChange={e => setAcsUsername(e.target.value)} placeholder="opcional" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            Clave ACS (CWMP)
            {data?.hasPassword && <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400"><ShieldCheck className="w-3 h-3" /> configurada</span>}
          </label>
          <input type="password" value={acsPassword} onChange={e => setAcsPassword(e.target.value)}
            placeholder={data?.hasPassword ? '•••••••• (dejar vacío = sin cambio)' : 'opcional'} className={inputCls} />
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => mut.mutate()} disabled={mut.isPending}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40">
          {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar perfil
        </button>
      </div>
    </div>
  );
}
