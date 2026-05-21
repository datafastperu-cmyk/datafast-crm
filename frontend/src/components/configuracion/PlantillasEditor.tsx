'use client';

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Mail, FileText, Edit2, RotateCcw, Save, X, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { plantillasApi, type PlantillaDto, type TipoPlantilla } from '@/lib/api/plantillas';
import { useToast } from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';

// ─── Variables disponibles ─────────────────────────────────────
const VARS_COMUNES = [
  { key: '{{nombre_cliente}}',    label: 'Nombre del abonado' },
  { key: '{{apellido_cliente}}',  label: 'Apellidos del abonado' },
  { key: '{{nombre_completo}}',   label: 'Nombre completo' },
  { key: '{{numero_documento}}',  label: 'DNI / RUC del abonado' },
  { key: '{{telefono_cliente}}',  label: 'Teléfono del abonado' },
  { key: '{{email_cliente}}',     label: 'Email del abonado' },
  { key: '{{direccion_cliente}}', label: 'Dirección del abonado' },
  { key: '{{plan_contratado}}',   label: 'Plan contratado' },
  { key: '{{fecha_pago}}',        label: 'Fecha límite de pago' },
  { key: '{{fecha_corte}}',       label: 'Fecha de corte del servicio' },
  { key: '{{fecha_activacion}}',  label: 'Fecha de activación' },
  { key: '{{monto_factura}}',     label: 'Monto de la factura' },
  { key: '{{numero_factura}}',    label: 'N° de factura' },
  { key: '{{dias_vencimiento}}',  label: 'Días para el vencimiento' },
  { key: '{{usuario_pppoe}}',     label: 'Usuario PPPoE' },
  { key: '{{ip_asignada}}',       label: 'IP asignada' },
  { key: '{{empresa}}',           label: 'Nombre de la empresa' },
  { key: '{{telefono_empresa}}',  label: 'Teléfono de la empresa' },
  { key: '{{nodo_nombre}}',       label: 'Nombre del nodo/emisor' },
  { key: '{{router_nombre}}',     label: 'Nombre del router' },
];

const VARS_DOCUMENTO = [
  ...VARS_COMUNES,
  { key: '{{empresa_ruc}}',        label: 'RUC de la empresa' },
  { key: '{{empresa_direccion}}',  label: 'Dirección de la empresa' },
  { key: '{{fecha_emision}}',      label: 'Fecha de emisión del documento' },
  { key: '{{subtotal}}',           label: 'Subtotal sin impuesto' },
  { key: '{{igv_porcentaje}}',     label: '% de IGV/IVA' },
  { key: '{{igv_monto}}',          label: 'Monto de IGV/IVA' },
  { key: '{{velocidad_bajada}}',   label: 'Velocidad de descarga' },
  { key: '{{velocidad_subida}}',   label: 'Velocidad de subida' },
  { key: '{{tecnico_nombre}}',     label: 'Nombre del técnico' },
  { key: '{{fecha_instalacion}}',  label: 'Fecha de instalación' },
  { key: '{{equipo_entregado}}',   label: 'Equipo entregado al abonado' },
  { key: '{{numero_serie}}',       label: 'N° de serie del equipo' },
];

// ─── Tabs config ───────────────────────────────────────────────
const TABS = [
  { key: 'whatsapp' as TipoPlantilla, label: 'Mensajería',  icon: MessageSquare, color: 'text-green-600' },
  { key: 'documento' as TipoPlantilla, label: 'Documentos', icon: FileText,       color: 'text-blue-600'  },
  { key: 'email' as TipoPlantilla,    label: 'Correos',     icon: Mail,           color: 'text-violet-600' },
];

// ─── Main ──────────────────────────────────────────────────────
export function PlantillasEditor() {
  const [activeTab, setActiveTab] = useState<TipoPlantilla>('whatsapp');

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              )}
            >
              <Icon className={cn('w-4 h-4', activeTab === t.key ? t.color : '')} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <PlantillasTabContent tipo={activeTab} />
    </div>
  );
}

// ─── Tab content ───────────────────────────────────────────────
function PlantillasTabContent({ tipo }: { tipo: TipoPlantilla }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data: plantillas = [], isLoading } = useQuery({
    queryKey: ['plantillas', tipo],
    queryFn: () => plantillasApi.listar(tipo),
  });

  const { mutate: guardar, isPending: saving } = useMutation({
    mutationFn: ({ codigo, contenido }: { codigo: string; contenido: string }) =>
      plantillasApi.guardar(tipo, codigo, contenido),
    onSuccess: (_, { codigo }) => {
      toast('Plantilla guardada', { type: 'success' });
      setEditing(null);
      setDrafts((d) => { const n = { ...d }; delete n[codigo]; return n; });
      qc.invalidateQueries({ queryKey: ['plantillas', tipo] });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: restaurar } = useMutation({
    mutationFn: (codigo: string) => plantillasApi.restaurar(tipo, codigo),
    onSuccess: () => {
      toast('Plantilla restaurada al valor por defecto', { type: 'success' });
      qc.invalidateQueries({ queryKey: ['plantillas', tipo] });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const vars = tipo === 'documento' ? VARS_DOCUMENTO : VARS_COMUNES;

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Cargando plantillas...</div>;

  return (
    <div className="space-y-3">
      {/* Description */}
      <p className="text-sm text-muted-foreground">
        {tipo === 'whatsapp' && 'Mensajes enviados por WhatsApp a los abonados. Usa variables para personalizar el contenido.'}
        {tipo === 'email' && 'Correos electrónicos enviados a los abonados. Soportan HTML para un diseño enriquecido.'}
        {tipo === 'documento' && 'Plantillas HTML para generar documentos: facturas, recibos, contratos, etc.'}
      </p>

      {/* Template cards */}
      <div className="space-y-2">
        {plantillas.map((p) => (
          <PlantillaCard
            key={p.codigo}
            plantilla={p}
            tipo={tipo}
            isEditing={editing === p.codigo}
            isPreviewing={previewing === p.codigo}
            draft={drafts[p.codigo] ?? p.contenido}
            saving={saving && editing === p.codigo}
            onEdit={() => {
              setEditing(p.codigo);
              setPreviewing(null);
              setDrafts((d) => ({ ...d, [p.codigo]: p.contenido }));
            }}
            onCancel={() => {
              setEditing(null);
              setDrafts((d) => { const n = { ...d }; delete n[p.codigo]; return n; });
            }}
            onSave={() => guardar({ codigo: p.codigo, contenido: drafts[p.codigo] ?? p.contenido })}
            onDraftChange={(v) => setDrafts((d) => ({ ...d, [p.codigo]: v }))}
            onRestore={() => restaurar(p.codigo)}
            onPreview={() => setPreviewing(previewing === p.codigo ? null : p.codigo)}
            vars={vars}
            showPreview={tipo !== 'whatsapp'}
          />
        ))}
      </div>

      {/* Variables reference */}
      <VariablesReference vars={vars} tipo={tipo} />
    </div>
  );
}

// ─── Plantilla card ────────────────────────────────────────────
function PlantillaCard({
  plantilla, tipo, isEditing, isPreviewing, draft, saving,
  onEdit, onCancel, onSave, onDraftChange, onRestore, onPreview, vars, showPreview,
}: {
  plantilla: PlantillaDto;
  tipo: TipoPlantilla;
  isEditing: boolean;
  isPreviewing: boolean;
  draft: string;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDraftChange: (v: string) => void;
  onRestore: () => void;
  onPreview: () => void;
  vars: typeof VARS_COMUNES;
  showPreview: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertVar = useCallback((variable: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + variable + draft.slice(end);
    onDraftChange(next);
    setTimeout(() => {
      el.selectionStart = el.selectionEnd = start + variable.length;
      el.focus();
    }, 0);
  }, [draft, onDraftChange]);

  return (
    <div className={cn(
      'rounded-xl border transition-colors',
      isEditing ? 'border-primary/50 bg-card' : 'border-border bg-card',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{plantilla.nombre}</span>
          {plantilla.esDefault && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Por defecto</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!plantilla.esDefault && (
            <button
              onClick={onRestore}
              title="Restaurar al valor por defecto"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {showPreview && !isEditing && (
            <button
              onClick={onPreview}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-muted transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              Vista previa
            </button>
          )}
          {!isEditing ? (
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Editar
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={onSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Editor */}
      {isEditing && (
        <div className="px-4 pb-4 space-y-3">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={tipo === 'documento' ? 12 : 5}
            className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors resize-y"
            placeholder="Escribe el contenido de la plantilla..."
          />
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Clic en una variable para insertarla en el cursor:</p>
            <div className="flex flex-wrap gap-1.5">
              {vars.map((v) => (
                <button
                  key={v.key}
                  onClick={() => insertVar(v.key)}
                  title={v.label}
                  className="px-2 py-1 text-xs rounded-md bg-muted hover:bg-primary/10 hover:text-primary border border-border transition-colors font-mono"
                >
                  {v.key}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Preview (documentos/correos) */}
      {isPreviewing && !isEditing && (
        <div className="border-t border-border">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">Vista previa</span>
            <button onClick={onPreview} className="p-1 rounded hover:bg-muted transition-colors">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          <div className="p-4">
            <iframe
              srcDoc={plantilla.contenido}
              className="w-full min-h-[400px] rounded-lg border border-border bg-white"
              sandbox="allow-same-origin"
              title={`Vista previa — ${plantilla.nombre}`}
            />
          </div>
        </div>
      )}

      {/* Collapsed preview (when not editing) */}
      {!isEditing && !isPreviewing && (
        <div className="px-4 pb-3">
          <p className="text-xs text-muted-foreground line-clamp-2 font-mono leading-relaxed">
            {plantilla.contenido.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Variables reference ───────────────────────────────────────
function VariablesReference({ vars, tipo }: { vars: typeof VARS_COMUNES; tipo: TipoPlantilla }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="font-medium">Variables disponibles para {tipo === 'whatsapp' ? 'mensajería' : tipo === 'email' ? 'correos' : 'documentos'}</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {vars.map((v) => (
            <div key={v.key} className="flex items-start gap-2 py-1">
              <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-primary shrink-0">
                {v.key}
              </code>
              <span className="text-xs text-muted-foreground">{v.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
