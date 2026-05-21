'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Unplug, Plug,
  Calendar, Users, HardDrive, Map, Activity, Clock, ExternalLink,
  ChevronRight, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toaster';
import { googleApi, type GoogleStatus, type GoogleSyncLog } from '@/lib/api/google';

// ── Helpers ────────────────────────────────────────────────────

function formatBytes(bytes: string): string {
  const n = Number(bytes);
  if (!n) return '0 B';
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Nunca';
  return new Date(iso).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function ResultBadge({ result }: { result: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    success: { cls: 'text-emerald-500 bg-emerald-500/10', label: 'OK' },
    failed:  { cls: 'text-red-500 bg-red-500/10',         label: 'Error' },
    partial: { cls: 'text-amber-500 bg-amber-500/10',     label: 'Parcial' },
    skipped: { cls: 'text-slate-400 bg-slate-400/10',     label: 'Omitido' },
  };
  const { cls, label } = map[result] ?? map.skipped;
  return (
    <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', cls)}>{label}</span>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function ServiceToggle({
  label, icon: Icon, enabled, onChange, loading,
}: {
  label:    string;
  icon:     React.ElementType;
  enabled:  boolean;
  onChange: (v: boolean) => void;
  loading:  boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <button
        onClick={() => !loading && onChange(!enabled)}
        disabled={loading}
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
          enabled ? 'bg-primary' : 'bg-muted-foreground/30',
          loading && 'opacity-50 cursor-not-allowed',
        )}
      >
        <span
          className={cn(
            'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
            enabled ? 'translate-x-4' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}

function LogRow({ log }: { log: GoogleSyncLog }) {
  const serviceIcon: Record<string, string> = {
    contacts: '👥', calendar: '📅', drive: '💾', maps: '🗺️', oauth: '🔐',
  };
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0">
      <span className="text-base mt-0.5">{serviceIcon[log.service] ?? '⚙️'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground capitalize">{log.operation.replace(/_/g, ' ')}</span>
          <ResultBadge result={log.result} />
          {log.durationMs && (
            <span className="text-xs text-muted-foreground">{log.durationMs}ms</span>
          )}
        </div>
        {log.details && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{log.details}</p>
        )}
        {log.errorMessage && (
          <p className="text-xs text-red-500 truncate mt-0.5">{log.errorMessage}</p>
        )}
        <p className="text-xs text-muted-foreground/60 mt-0.5">{formatDate(log.createdAt)}</p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────

interface GoogleIntegrationDashboardProps {
  empresaId: string;
}

export function GoogleIntegrationDashboard({ empresaId }: GoogleIntegrationDashboardProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'calendar' | 'drive'>('overview');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const { data: status, isLoading: loadingStatus } = useQuery<GoogleStatus>({
    queryKey:    ['google-status', empresaId],
    queryFn:     () => googleApi.getStatus(empresaId),
    refetchInterval: 30_000,
  });

  const { data: logs, isLoading: loadingLogs } = useQuery<GoogleSyncLog[]>({
    queryKey: ['google-logs', empresaId],
    queryFn:  () => googleApi.getLogs(empresaId, 30),
    enabled:  activeTab === 'logs',
  });

  const { data: calendarEvents, isLoading: loadingCalendar } = useQuery({
    queryKey: ['google-calendar', empresaId],
    queryFn:  () => googleApi.listCalendarEvents(empresaId, 10),
    enabled:  activeTab === 'calendar' && !!status?.connected,
  });

  const { data: driveFiles, isLoading: loadingDrive } = useQuery({
    queryKey: ['google-drive', empresaId],
    queryFn:  () => googleApi.listDriveFiles(empresaId),
    enabled:  activeTab === 'drive' && !!status?.connected,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const url = await googleApi.getAuthUrl(empresaId);
      window.open(url, '_blank', 'width=600,height=700,noopener');
    },
    onError: () => toast('Error al generar URL de autorización', { type: 'error' }),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => googleApi.disconnect(empresaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['google-status', empresaId] });
      toast('Cuenta Google desconectada', { type: 'success' });
    },
    onError: () => toast('Error al desconectar', { type: 'error' }),
  });

  const servicesMutation = useMutation({
    mutationFn: (dto: Parameters<typeof googleApi.updateServices>[1]) =>
      googleApi.updateServices(empresaId, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-status', empresaId] }),
    onError: () => toast('Error al actualizar configuración', { type: 'error' }),
  });

  const syncBulkMutation = useMutation({
    mutationFn: () => googleApi.syncContactsBulk(empresaId),
    onSuccess: () => toast('Sincronización masiva encolada', { type: 'success' }),
    onError: () => toast('Error al encolar sincronización', { type: 'error' }),
  });

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  const connected = status?.connected ?? false;

  // ── Not connected ────────────────────────────────────────────
  if (!connected) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
            <Plug className="w-8 h-8 text-blue-500" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-1">Conectar Google Workspace</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
            Sincroniza clientes con Contacts, gestiona eventos en Calendar, almacena backups
            en Drive y geocodifica direcciones con Maps.
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto text-sm text-left mb-8">
            {[
              { icon: Users,    label: 'Google Contacts', desc: 'Sincronizar clientes' },
              { icon: Calendar, label: 'Google Calendar', desc: 'Eventos automáticos' },
              { icon: HardDrive, label: 'Google Drive',   desc: 'Backups en la nube' },
              { icon: Map,       label: 'Google Maps',    desc: 'Geocodificación' },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/40">
                <Icon className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-foreground text-xs">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {connectMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
            Conectar con Google
          </button>
        </div>
      </div>
    );
  }

  // ── Connected ────────────────────────────────────────────────
  const storageUsedPct = status?.driveStorageTotal && Number(status.driveStorageTotal) > 0
    ? Math.min(100, (Number(status.driveStorageUsed) / Number(status.driveStorageTotal)) * 100)
    : 0;

  const tabs = [
    { id: 'overview', label: 'Resumen' },
    { id: 'logs',     label: 'Actividad' },
    { id: 'calendar', label: 'Calendario' },
    { id: 'drive',    label: 'Drive' },
  ] as const;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{status?.email}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-medium">Conectado</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {status?.name} · Último sync: {formatDate(status?.lastSyncAt ?? null)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['google-status', empresaId] })}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            title="Actualizar estado"
          >
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
          {confirmDisconnect ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive">¿Confirmar?</span>
              <button
                onClick={() => { disconnectMutation.mutate(); setConfirmDisconnect(false); }}
                disabled={disconnectMutation.isPending}
                className="px-2 py-1 rounded text-xs bg-destructive text-destructive-foreground disabled:opacity-50"
              >
                Sí
              </button>
              <button
                onClick={() => setConfirmDisconnect(false)}
                className="px-2 py-1 rounded text-xs border border-border"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDisconnect(true)}
              disabled={disconnectMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors disabled:opacity-50"
            >
              <Unplug className="w-3.5 h-3.5" />
              Desconectar
            </button>
          )}
        </div>
      </div>

      {/* Error notice */}
      {(status?.errorCount ?? 0) > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-amber-500">{status?.errorCount} errores recientes</p>
            {status?.lastError && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{status.lastError}</p>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 text-xs font-medium py-1.5 rounded-md transition-colors',
              activeTab === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            {/* Drive storage */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <HardDrive className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-medium text-foreground">Google Drive</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatBytes(status?.driveStorageUsed ?? '0')} / {formatBytes(status?.driveStorageTotal ?? '0')}
              </p>
              <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${storageUsedPct}%` }}
                />
              </div>
            </div>

            {/* Last sync */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-medium text-foreground">Última sync</span>
              </div>
              <p className="text-xs text-muted-foreground">{formatDate(status?.lastSyncAt ?? null)}</p>
            </div>
          </div>

          {/* Services */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3">Servicios habilitados</h4>
            <div className="divide-y divide-border/50">
              <ServiceToggle
                label="Google Calendar"
                icon={Calendar}
                enabled={status?.services.calendar ?? false}
                onChange={(v) => servicesMutation.mutate({ calendarEnabled: v })}
                loading={servicesMutation.isPending}
              />
              <ServiceToggle
                label="Google Contacts"
                icon={Users}
                enabled={status?.services.contacts ?? false}
                onChange={(v) => servicesMutation.mutate({ contactsEnabled: v })}
                loading={servicesMutation.isPending}
              />
              <ServiceToggle
                label="Google Drive"
                icon={HardDrive}
                enabled={status?.services.drive ?? false}
                onChange={(v) => servicesMutation.mutate({ driveEnabled: v })}
                loading={servicesMutation.isPending}
              />
              <ServiceToggle
                label="Google Maps (geocodificación)"
                icon={Map}
                enabled={status?.services.maps ?? false}
                onChange={(v) => servicesMutation.mutate({ mapsEnabled: v })}
                loading={servicesMutation.isPending}
              />
            </div>
          </div>

          {/* Quick actions */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-xs font-semibold text-foreground mb-3">Acciones rápidas</h4>
            <div className="space-y-2">
              <button
                onClick={() => syncBulkMutation.mutate()}
                disabled={syncBulkMutation.isPending || !status?.services.contacts}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted transition-colors disabled:opacity-50 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-foreground">Sincronizar todos los contactos</span>
                </div>
                {syncBulkMutation.isPending
                  ? <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                  : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-foreground">Actividad reciente</h4>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['google-logs', empresaId] })}
              className="p-1 rounded hover:bg-muted transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          {loadingLogs ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
            </div>
          ) : !logs?.length ? (
            <p className="text-xs text-muted-foreground text-center py-8">Sin actividad registrada</p>
          ) : (
            <div>
              {logs.map((log) => <LogRow key={log.id} log={log} />)}
            </div>
          )}
        </div>
      )}

      {activeTab === 'calendar' && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h4 className="text-xs font-semibold text-foreground mb-3">Próximos eventos</h4>
          {loadingCalendar ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
            </div>
          ) : !calendarEvents?.length ? (
            <p className="text-xs text-muted-foreground text-center py-8">Sin eventos próximos</p>
          ) : (
            <div className="space-y-2">
              {calendarEvents.map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/30">
                  <Calendar className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{ev.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(ev.start?.dateTime)}
                    </p>
                  </div>
                  {ev.htmlLink && (
                    <a href={ev.htmlLink} target="_blank" rel="noopener noreferrer" className="shrink-0">
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'drive' && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h4 className="text-xs font-semibold text-foreground mb-3">Archivos recientes</h4>
          {loadingDrive ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
            </div>
          ) : !driveFiles?.length ? (
            <p className="text-xs text-muted-foreground text-center py-8">Sin archivos</p>
          ) : (
            <div className="space-y-2">
              {driveFiles.map((file) => (
                <div key={file.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30">
                  <HardDrive className="w-4 h-4 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.size)} · {formatDate(file.createdTime)}
                    </p>
                  </div>
                  {file.webViewLink && (
                    <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="shrink-0">
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
