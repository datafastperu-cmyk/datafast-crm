'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Mail, FileText, Edit2, RotateCcw, Save, X,
  Eye, ChevronDown, ChevronUp, Plus, Trash2, Variable,
} from 'lucide-react';
import { plantillasApi, type PlantillaDto, type TipoPlantilla } from '@/lib/api/plantillas';
import { useToast } from '@/components/ui/toaster';
import { parseApiError, cn } from '@/lib/utils';
import { Portal } from '@/components/ui/portal';

// ─── Variables disponibles por tipo ───────────────────────────
const VARS_COMUNES = [
  // ── Variables de egresos recurrentes (admin interno) ──────────
  { key: '{{nombre_gasto}}',    label: 'Nombre del gasto recurrente' },
  { key: '{{categoria}}',       label: 'Categoría del egreso' },
  { key: '{{monto}}',           label: 'Monto del egreso (S/.)' },
  { key: '{{dias_restantes}}',  label: 'Días para vencer (negativo = vencido)' },
  // ── Variables de abonados ──────────────────────────────────────
  { key: '{{nombre_cliente}}',    label: 'Nombre del abonado' },
  { key: '{{apellido_cliente}}',  label: 'Apellidos del abonado' },
  { key: '{{nombre_completo}}',   label: 'Nombre completo' },
  { key: '{{numero_documento}}',  label: 'DNI / RUC del abonado' },
  { key: '{{telefono_cliente}}',  label: 'Teléfono del abonado' },
  { key: '{{email_cliente}}',     label: 'Email del abonado' },
  { key: '{{direccion_cliente}}', label: 'Dirección del abonado' },
  { key: '{{plan_contratado}}',   label: 'Plan contratado' },
  { key: '{{fecha_pago}}',        label: 'Fecha límite de pago' },
  { key: '{{fecha_corte}}',       label: 'Fecha de corte' },
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
  { key: '{{fecha_emision}}',      label: 'Fecha de emisión' },
  { key: '{{subtotal}}',           label: 'Subtotal sin impuesto' },
  { key: '{{igv_porcentaje}}',     label: '% de IGV/IVA' },
  { key: '{{igv_monto}}',          label: 'Monto de IGV/IVA' },
  { key: '{{velocidad_bajada}}',   label: 'Velocidad de descarga' },
  { key: '{{velocidad_subida}}',   label: 'Velocidad de subida' },
  { key: '{{tecnico_nombre}}',     label: 'Nombre del técnico' },
  { key: '{{fecha_instalacion}}',  label: 'Fecha de instalación' },
  { key: '{{equipo_entregado}}',   label: 'Equipo entregado' },
  { key: '{{numero_serie}}',       label: 'N° de serie del equipo' },
];

function varsForTipo(tipo: TipoPlantilla) {
  return tipo === 'documento' ? VARS_DOCUMENTO : VARS_COMUNES;
}

// ─── Tabs ──────────────────────────────────────────────────────
const TABS = [
  { key: 'whatsapp'  as TipoPlantilla, label: 'Mensajería',  icon: MessageSquare, color: 'text-green-500'  },
  { key: 'documento' as TipoPlantilla, label: 'Documentos',  icon: FileText,       color: 'text-blue-500'   },
  { key: 'email'     as TipoPlantilla, label: 'Correos',     icon: Mail,           color: 'text-violet-500' },
];

// ─── Modal state ───────────────────────────────────────────────
interface ModalState {
  mode:      'create' | 'edit';
  plantilla: PlantillaDto | null;  // null for create
  title:     string;
  content:   string;
}

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
  const qc           = useQueryClient();
  const { toast }    = useToast();
  const vars         = varsForTipo(tipo);

  const [modal,      setModal]      = useState<ModalState | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  const { data: plantillas = [], isLoading } = useQuery({
    queryKey: ['plantillas', tipo],
    queryFn:  () => plantillasApi.listar(tipo),
  });

  const { mutate: guardar, isPending: saving } = useMutation({
    mutationFn: ({ codigo, contenido, nombre }: { codigo: string; contenido: string; nombre: string }) =>
      plantillasApi.guardar(tipo, codigo, contenido, nombre),
    onSuccess: () => {
      toast('Plantilla guardada', { type: 'success' });
      setModal(null);
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
      setModal(null);
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

  const openCreate = () => setModal({ mode: 'create', plantilla: null, title: '', content: '' });
  const openEdit   = (p: PlantillaDto) => setModal({ mode: 'edit', plantilla: p, title: p.nombre, content: p.contenido });
  const closeModal = () => setModal(null);

  const handleSave = () => {
    if (!modal) return;
    if (modal.mode === 'create') {
      crear({ nombre: modal.title.trim(), contenido: modal.content.trim() });
    } else if (modal.plantilla) {
      guardar({ codigo: modal.plantilla.codigo, contenido: modal.content, nombre: modal.title });
    }
  };

  if (isLoading) return <div className="text-sm text-muted-foreground p-4">Cargando plantillas...</div>;

  return (
    <>
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {tipo === 'whatsapp'  && 'Mensajes enviados por WhatsApp a los abonados.'}
          {tipo === 'email'     && 'Correos electrónicos enviados a los abonados. Soportan HTML.'}
          {tipo === 'documento' && 'Plantillas HTML para generar documentos: facturas, recibos, contratos.'}
        </p>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva Plantilla
        </button>
      </div>

      {/* Template list */}
      <div className="space-y-2">
        {plantillas.map((p) => (
          <PlantillaCard
            key={p.codigo}
            plantilla={p}
            tipo={tipo}
            isPreviewing={previewing === p.codigo}
            onEdit={() => openEdit(p)}
            onRestore={() => restaurar(p.codigo)}
            onPreview={() => setPreviewing(previewing === p.codigo ? null : p.codigo)}
            onDelete={() => eliminar(p.codigo)}
            showPreview={tipo !== 'whatsapp'}
          />
        ))}
      </div>

      <VariablesReference vars={vars} tipo={tipo} />

      {/* Modal */}
      {modal && (
        <PlantillaModal
          mode={modal.mode}
          plantilla={modal.plantilla}
          tipo={tipo}
          vars={vars}
          title={modal.title}
          content={modal.content}
          saving={modal.mode === 'create' ? creando : saving}
          onTitleChange={(v) => setModal((m) => m ? { ...m, title: v }   : m)}
          onContentChange={(v) => setModal((m) => m ? { ...m, content: v } : m)}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </>
  );
}

// ─── Modal flotante ────────────────────────────────────────────
function PlantillaModal({
  mode, plantilla, tipo, vars,
  title, content, saving,
  onTitleChange, onContentChange, onSave, onClose,
}: {
  mode:             'create' | 'edit';
  plantilla:        PlantillaDto | null;
  tipo:             TipoPlantilla;
  vars:             typeof VARS_COMUNES;
  title:            string;
  content:          string;
  saving:           boolean;
  onTitleChange:    (v: string) => void;
  onContentChange:  (v: string) => void;
  onSave:           () => void;
  onClose:          () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Cerrar con Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const insertVar = useCallback((variable: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? content.length;
    const end   = el.selectionEnd   ?? content.length;
    onContentChange(content.slice(0, start) + variable + content.slice(end));
    setTimeout(() => { el.selectionStart = el.selectionEnd = start + variable.length; el.focus(); }, 0);
  }, [content, onContentChange]);

  const isEdit      = mode === 'edit';
  const canSave     = title.trim().length > 0 && content.trim().length > 0;
  const tipoLabel   = tipo === 'whatsapp' ? 'Mensajería' : tipo === 'email' ? 'Correos' : 'Documentos';
  const rows        = tipo === 'documento' ? 14 : 8;

  return (
    <Portal>
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      {/* Modal box */}
      <div role="dialog" aria-modal="true" className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
            <div className="flex items-center gap-2 shrink-0">
              <FileText className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">
                {isEdit ? 'Editar plantilla' : 'Nueva plantilla'}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{tipoLabel}</span>
              {plantilla && !plantilla.isSystem && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">Personalizada</span>
              )}
            </div>
            {/* Título editable */}
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Nombre de la plantilla..."
              autoFocus
              className="flex-1 min-w-0 text-sm font-medium bg-muted/40 border border-input rounded-md px-3 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
            />
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — textarea + panel variables */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex gap-4 h-full">
            {/* Textarea */}
            <div className="flex-1 flex flex-col gap-1.5 min-w-0">
              <p className="text-xs text-muted-foreground font-medium">Contenido</p>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => onContentChange(e.target.value)}
                rows={rows}
                className="flex-1 w-full px-3 py-2.5 text-sm rounded-lg border border-input bg-background font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors resize-y"
                placeholder="Escribe el contenido de la plantilla..."
              />
            </div>

            {/* Panel lateral de variables */}
            <div className="w-56 flex-shrink-0 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <Variable className="w-3.5 h-3.5 text-primary" />
                <p className="text-xs font-medium text-muted-foreground">Variables disponibles</p>
              </div>
              <p className="text-[10px] text-muted-foreground">Clic en una variable para insertarla en el cursor</p>
              <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-muted/20 p-1.5 space-y-0.5 max-h-[400px]">
                {vars.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => insertVar(v.key)}
                    title={v.label}
                    className="w-full text-left px-2 py-1 rounded-md hover:bg-primary/10 hover:text-primary transition-colors group flex items-start gap-1.5"
                  >
                    <code className="font-mono text-[10px] shrink-0 bg-muted/60 px-1.5 py-0.5 rounded leading-tight group-hover:bg-primary/10">
                      {v.key}
                    </code>
                    <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{v.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
          <p className="text-xs text-muted-foreground">
            {isEdit
              ? 'Los cambios reemplazarán el contenido actual de la plantilla.'
              : 'La nueva plantilla quedará disponible en todos los módulos de mensajería.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={onSave}
              disabled={saving || !canSave}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? (isEdit ? 'Guardando...' : 'Creando...') : (isEdit ? 'Guardar cambios' : 'Crear plantilla')}
            </button>
          </div>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ─── Plantilla card (solo visualización) ──────────────────────
function PlantillaCard({
  plantilla, tipo, isPreviewing,
  onEdit, onRestore, onPreview, onDelete, showPreview,
}: {
  plantilla:   PlantillaDto;
  tipo:        TipoPlantilla;
  isPreviewing: boolean;
  onEdit:      () => void;
  onRestore:   () => void;
  onPreview:   () => void;
  onDelete:    () => void;
  showPreview: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card transition-colors hover:border-border/80">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-3">
          <span className="text-sm font-medium text-foreground truncate">{plantilla.nombre}</span>
          {plantilla.esDefault && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">Por defecto</span>
          )}
          {!plantilla.isSystem && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">Personalizada</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Restaurar — solo plantillas del sistema que fueron editadas */}
          {!plantilla.esDefault && plantilla.isSystem && (
            <button
              onClick={onRestore}
              title="Restaurar al valor por defecto"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {/* Vista previa — documentos y correos */}
          {showPreview && (
            <button
              onClick={onPreview}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-input hover:bg-muted transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              Vista previa
            </button>
          )}
          {/* Eliminar — solo plantillas personalizadas */}
          {!plantilla.isSystem && (
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
          {/* Editar — abre modal */}
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
          >
            <Edit2 className="w-3.5 h-3.5" />
            Editar
          </button>
        </div>
      </div>

      {/* Collapsed content preview */}
      {!isPreviewing && (
        <div className="px-4 pb-3">
          <p className="text-xs text-muted-foreground line-clamp-2 font-mono leading-relaxed">
            {plantilla.contenido.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}
          </p>
        </div>
      )}

      {/* Preview iframe (documentos/correos) */}
      {isPreviewing && (
        <div className="border-t border-border">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">Vista previa — {plantilla.nombre}</span>
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
    </div>
  );
}

// ─── Variables reference (collapsible al pie) ──────────────────
function VariablesReference({ vars, tipo }: { vars: typeof VARS_COMUNES; tipo: TipoPlantilla }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="font-medium">
          Referencia de variables — {tipo === 'whatsapp' ? 'mensajería' : tipo === 'email' ? 'correos' : 'documentos'}
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
