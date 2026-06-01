'use client';

import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Mail, FileText, Edit2, RotateCcw, Save, X,
  Eye, ChevronDown, ChevronUp, Plus, Trash2,
} from 'lucide-react';
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

const TABS = [
  { key: 'whatsapp'  as TipoPlantilla, label: 'Mensajería',  icon: MessageSquare, color: 'text-green-500' },
  { key: 'documento' as TipoPlantilla, label: 'Documentos',  icon: FileText,       color: 'text-blue-500'  },
  { key: 'email'     as TipoPlantilla, label: 'Correos',     icon: Mail,           color: 'text-violet-500' },
];

// ─── Main ──────────────────────────────────────────────────────
export function PlantillasEditor() {
  const [activeTab, setActiveTab] = useState<TipoPlantilla>('whatsapp');

  return (
    <div className="space-y-5">
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
      <PlantillasTabContent tipo={activeTab} />
    </div>
  );
}

// ─── Tab content ───────────────────────────────────────────────
function PlantillasTabContent({ tipo }: { tipo: TipoPlantilla }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [editing,      setEditing]      = useState<string | null>(null);
  const [previewing,   setPreviewing]   = useState<string | null>(null);
  const [drafts,       setDrafts]       = useState<Record<string, string>>({});
  const [draftTitles,  setDraftTitles]  = useState<Record<string, string>>({});
  const [creating,     setCreating]     = useState(false);
  const [newTitle,     setNewTitle]     = useState('');
  const [newContent,   setNewContent]   = useState('');

  const { data: plantillas = [], isLoading } = useQuery({
    queryKey: ['plantillas', tipo],
    queryFn: () => plantillasApi.listar(tipo),
  });

  const { mutate: guardar, isPending: saving } = useMutation({
    mutationFn: ({ codigo, contenido, nombre }: { codigo: string; contenido: string; nombre: string }) =>
      plantillasApi.guardar(tipo, codigo, contenido, nombre),
    onSuccess: (_, { codigo }) => {
      toast('Plantilla guardada', { type: 'success' });
      setEditing(null);
      setDrafts((d)       => { const n = { ...d }; delete n[codigo]; return n; });
      setDraftTitles((d)  => { const n = { ...d }; delete n[codigo]; return n; });
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

  const { mutate: crear, isPending: creando } = useMutation({
    mutationFn: ({ nombre, contenido }: { nombre: string; contenido: string }) =>
      plantillasApi.crear(tipo, nombre, contenido),
    onSuccess: () => {
      toast('Plantilla creada', { type: 'success' });
      setCreating(false);
      setNewTitle('');
      setNewContent('');
      qc.invalidateQueries({ queryKey: ['plantillas', tipo] });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const { mutate: eliminar } = useMutation({
    mutationFn: (codigo: string) => plantillasApi.eliminar(tipo, codigo),
    onSuccess: () => {
      toast('Plantilla eliminada', { type: 'success' });
      qc.invalidateQueries({ queryKey: ['plantillas', tipo] });
    },
    onError: (e) => toast(parseApiError(e), { type: 'error' }),
  });

  const vars = tipo === 'documento' ? VARS_DOCUMENTO : VARS_COMUNES;

  const startEdit = (p: PlantillaDto) => {
    setEditing(p.codigo);
    setPreviewing(null);
    setDrafts((d)      => ({ ...d, [p.codigo]: p.contenido }));
    setDraftTitles((d) => ({ ...d, [p.codigo]: p.nombre }));
  };

  const cancelEdit = (codigo: string) => {
    setEditing(null);
    setDrafts((d)      => { const n = { ...d }; delete n[codigo]; return n; });
    setDraftTitles((d) => { const n = { ...d }; delete n[codigo]; return n; });
  };

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Cargando plantillas...</div>;

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {tipo === 'whatsapp'  && 'Mensajes enviados por WhatsApp a los abonados.'}
          {tipo === 'email'     && 'Correos electrónicos enviados a los abonados. Soportan HTML.'}
          {tipo === 'documento' && 'Plantillas HTML para generar documentos: facturas, recibos, contratos.'}
        </p>
        {!creating && (
          <button
            onClick={() => { setCreating(true); setEditing(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Nueva Plantilla
          </button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <CrearPlantillaCard
          tipo={tipo}
          vars={vars}
          saving={creando}
          title={newTitle}
          content={newContent}
          onTitleChange={setNewTitle}
          onContentChange={setNewContent}
          onSave={() => crear({ nombre: newTitle.trim(), contenido: newContent.trim() })}
          onCancel={() => { setCreating(false); setNewTitle(''); setNewContent(''); }}
        />
      )}

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
            draftTitle={draftTitles[p.codigo] ?? p.nombre}
            saving={saving && editing === p.codigo}
            onEdit={() => startEdit(p)}
            onCancel={() => cancelEdit(p.codigo)}
            onSave={() => guardar({
              codigo:   p.codigo,
              contenido: drafts[p.codigo] ?? p.contenido,
              nombre:    draftTitles[p.codigo] ?? p.nombre,
            })}
            onDraftChange={(v) => setDrafts((d)      => ({ ...d, [p.codigo]: v }))}
            onTitleChange={(v) => setDraftTitles((d) => ({ ...d, [p.codigo]: v }))}
            onRestore={() => restaurar(p.codigo)}
            onPreview={() => setPreviewing(previewing === p.codigo ? null : p.codigo)}
            onDelete={() => eliminar(p.codigo)}
            vars={vars}
            showPreview={tipo !== 'whatsapp'}
          />
        ))}
      </div>

      <VariablesReference vars={vars} tipo={tipo} />
    </div>
  );
}

// ─── Crear plantilla card ──────────────────────────────────────
function CrearPlantillaCard({
  tipo, vars, saving, title, content,
  onTitleChange, onContentChange, onSave, onCancel,
}: {
  tipo: TipoPlantilla;
  vars: typeof VARS_COMUNES;
  saving: boolean;
  title: string;
  content: string;
  onTitleChange: (v: string) => void;
  onContentChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertVar = useCallback((variable: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? content.length;
    const end   = el.selectionEnd   ?? content.length;
    const next  = content.slice(0, start) + variable + content.slice(end);
    onContentChange(next);
    setTimeout(() => { el.selectionStart = el.selectionEnd = start + variable.length; el.focus(); }, 0);
  }, [content, onContentChange]);

  return (
    <div className="rounded-xl border border-primary/50 bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Nueva plantilla</span>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Nombre de la plantilla..."
            className="text-sm font-medium bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground w-64"
            autoFocus
          />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving || !title.trim() || !content.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Creando...' : 'Crear Plantilla'}
          </button>
        </div>
      </div>
      <div className="p-4">
        <EditorLayout
          textareaRef={textareaRef}
          content={content}
          onContentChange={onContentChange}
          vars={vars}
          onInsertVar={insertVar}
          rows={tipo === 'documento' ? 12 : 6}
        />
      </div>
    </div>
  );
}

// ─── Layout compartido textarea + variables panel ──────────────
function EditorLayout({
  textareaRef, content, onContentChange, vars, onInsertVar, rows,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  onContentChange: (v: string) => void;
  vars: typeof VARS_COMUNES;
  onInsertVar: (v: string) => void;
  rows: number;
}) {
  return (
    <div className="flex gap-3">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        rows={rows}
        className="flex-1 px-3 py-2 text-sm rounded-lg border border-input bg-background font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors resize-y"
        placeholder="Escribe el contenido de la plantilla..."
      />
      <div className="w-52 flex-shrink-0">
        <p className="text-xs font-medium text-muted-foreground mb-2">Variables disponibles</p>
        <p className="text-[10px] text-muted-foreground mb-1.5">Clic para insertar en el cursor</p>
        <div className="space-y-0.5 max-h-[260px] overflow-y-auto pr-1 scrollbar-thin">
          {vars.map((v) => (
            <button
              key={v.key}
              onClick={() => onInsertVar(v.key)}
              title={`Insertar ${v.key}`}
              className="w-full text-left px-2 py-1 rounded-md text-[10px] hover:bg-primary/10 hover:text-primary transition-colors group flex items-start gap-1.5"
            >
              <code className="font-mono shrink-0 bg-muted px-1 py-0.5 rounded group-hover:bg-primary/10 leading-tight">
                {v.key}
              </code>
              <span className="text-muted-foreground mt-0.5 leading-tight">{v.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Plantilla card ────────────────────────────────────────────
function PlantillaCard({
  plantilla, tipo, isEditing, isPreviewing, draft, draftTitle, saving,
  onEdit, onCancel, onSave, onDraftChange, onTitleChange, onRestore, onPreview, onDelete, vars, showPreview,
}: {
  plantilla:      PlantillaDto;
  tipo:           TipoPlantilla;
  isEditing:      boolean;
  isPreviewing:   boolean;
  draft:          string;
  draftTitle:     string;
  saving:         boolean;
  onEdit:         () => void;
  onCancel:       () => void;
  onSave:         () => void;
  onDraftChange:  (v: string) => void;
  onTitleChange:  (v: string) => void;
  onRestore:      () => void;
  onPreview:      () => void;
  onDelete:       () => void;
  vars:           typeof VARS_COMUNES;
  showPreview:    boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const insertVar = useCallback((variable: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? draft.length;
    const end   = el.selectionEnd   ?? draft.length;
    const next  = draft.slice(0, start) + variable + draft.slice(end);
    onDraftChange(next);
    setTimeout(() => { el.selectionStart = el.selectionEnd = start + variable.length; el.focus(); }, 0);
  }, [draft, onDraftChange]);

  return (
    <div className={cn(
      'rounded-xl border transition-colors',
      isEditing ? 'border-primary/50 bg-card' : 'border-border bg-card',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-3">
          {isEditing ? (
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              className="text-sm font-medium bg-transparent border-b border-border focus:border-primary outline-none text-foreground flex-1 min-w-0"
            />
          ) : (
            <span className="text-sm font-medium text-foreground truncate">{plantilla.nombre}</span>
          )}
          {/* Badges */}
          {plantilla.esDefault && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">Por defecto</span>
          )}
          {!plantilla.isSystem && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">Personalizada</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Restore — solo si fue editada */}
          {!isEditing && !plantilla.esDefault && plantilla.isSystem && (
            <button
              onClick={onRestore}
              title="Restaurar al valor por defecto"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {/* Preview — documentos/correos */}
          {showPreview && !isEditing && (
            <button
              onClick={onPreview}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-muted transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              Vista previa
            </button>
          )}
          {/* Delete — solo para plantillas personalizadas */}
          {!plantilla.isSystem && !isEditing && (
            confirmDelete ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">¿Eliminar?</span>
                <button
                  onClick={() => { onDelete(); setConfirmDelete(false); }}
                  className="px-2 py-1 text-xs rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                >
                  Sí
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 text-xs rounded-lg border border-input hover:bg-muted transition-colors"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                title="Eliminar plantilla"
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )
          )}
          {/* Edit / Save+Cancel */}
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
        <div className="px-4 pb-4">
          <EditorLayout
            textareaRef={textareaRef}
            content={draft}
            onContentChange={onDraftChange}
            vars={vars}
            onInsertVar={insertVar}
            rows={tipo === 'documento' ? 12 : 5}
          />
        </div>
      )}

      {/* Preview iframe (documentos/correos) */}
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

      {/* Collapsed content preview */}
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

// ─── Variables reference (collapsible, pie de página) ──────────
function VariablesReference({ vars, tipo }: { vars: typeof VARS_COMUNES; tipo: TipoPlantilla }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="font-medium">
          Referencia de variables para {tipo === 'whatsapp' ? 'mensajería' : tipo === 'email' ? 'correos' : 'documentos'}
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {vars.map((v) => (
            <div key={v.key} className="flex items-start gap-2 py-1">
              <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-primary shrink-0">{v.key}</code>
              <span className="text-xs text-muted-foreground">{v.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
