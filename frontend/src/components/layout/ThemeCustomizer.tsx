'use client';

import { useEffect }     from 'react';
import { usePathname }   from 'next/navigation';
import * as RSwitch      from '@radix-ui/react-switch';
import {
  Settings2, X, RefreshCw,
  LayoutList, Sparkles, Square,
} from 'lucide-react';
import { cn }            from '@/lib/utils';
import {
  useThemeCustomizerStore,
  PALETTES,
  type PaletteId,
  type MenuStyle,
} from '@/store/theme-customizer.store';
import { useAuthStore }  from '@/store/auth.store';

// ── Menu style radio options ───────────────────────────────────────────────
const MENU_OPTIONS = [
  { value: 'default',  label: 'Fijo',      Icon: LayoutList },
  { value: 'gradient', label: 'Degradado', Icon: Sparkles   },
  { value: 'boxed',    label: 'Enmarcado', Icon: Square     },
] as const;

const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

// ── Main component ─────────────────────────────────────────────────────────
export function ThemeCustomizer() {
  const {
    palette, fixedTopbar, darkTopbar, menuStyle, open,
    setPalette, setFixedTopbar, setDarkTopbar, setMenuStyle, setOpen,
  } = useThemeCustomizerStore();

  /* Inject palette CSS vars into <head> */
  useEffect(() => {
    let el = document.getElementById('tc-palette-vars') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'tc-palette-vars';
      document.head.appendChild(el);
    }
    el.textContent = PALETTES.find((p) => p.id === palette)?.css ?? '';
  }, [palette]);

  /* Toggle layout classes on <html> */
  useEffect(() => {
    const h = document.documentElement;
    h.classList.toggle('tc-topbar-dark',       darkTopbar);
    h.classList.toggle('tc-topbar-borderless', !fixedTopbar);
    h.classList.toggle('tc-menu-gradient',     menuStyle === 'gradient');
    h.classList.toggle('tc-menu-boxed',        menuStyle === 'boxed');
  }, [darkTopbar, fixedTopbar, menuStyle]);

  const isAuth   = useAuthStore((s) => s.isAuth);
  const pathname = usePathname() ?? '';
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  const handleReset = () => {
    setPalette('olive-navy');
    setFixedTopbar(true);
    setDarkTopbar(false);
    setMenuStyle('default');
  };

  const isProd = process.env.NODE_ENV === 'production'
    && process.env.NEXT_PUBLIC_SHOW_DESIGN_PANEL !== 'true';

  if (!isAuth || isPublic || isProd) return null;

  return (
    /*
     * Outer wrapper slides as a unit (panel + trigger tab).
     * When closed: translate-x-full hides the panel but the tab's
     * absolute -translate-x-full keeps it visible at the right viewport edge.
     */
    <div
      className={cn(
        'fixed top-1/2 right-0 z-[60]',
        '-translate-y-1/2',
        'transition-transform duration-300 ease-in-out',
        !open && 'translate-x-full',
      )}
    >
      {/* ── Trigger tab ─────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? 'Cerrar panel de diseño' : 'Abrir panel de diseño'}
        className={cn(
          'absolute left-0 top-1/2',
          '-translate-x-full -translate-y-1/2',
          'flex flex-col items-center justify-center gap-0.5',
          'w-9 py-3.5 rounded-l-xl',
          'bg-primary text-primary-foreground shadow-lg',
          'hover:bg-primary/90 transition-colors',
          'select-none',
        )}
      >
        {open
          ? <X className="w-4 h-4" />
          : (
            <>
              <Settings2 className="w-4 h-4" />
              <span className="text-[7px] font-semibold tracking-widest uppercase opacity-75 leading-none mt-0.5">
                UI
              </span>
            </>
          )}
      </button>

      {/* ── Panel ───────────────────────────────────────────────────────── */}
      <div className="w-[280px] max-h-[88vh] flex flex-col bg-popover border-l border-border shadow-2xl rounded-l-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0 bg-popover">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Diseño y Colores</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Personaliza la apariencia</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* ── Color Palettes ─────────────────────────────────────────── */}
          <section>
            <SectionLabel>Paletas de Colores</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPalette(p.id as PaletteId)}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all text-left',
                    palette === p.id
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                      : 'border-border hover:border-primary/30 hover:bg-muted/40',
                  )}
                >
                  {/* Duo-color preview */}
                  <div className="flex-shrink-0 relative w-7 h-4">
                    <div
                      className="absolute left-0 top-0 w-4 h-4 rounded-full shadow-sm border border-white/10"
                      style={{ background: p.primaryColor }}
                    />
                    <div
                      className="absolute left-3 top-0 w-4 h-4 rounded-full shadow-sm border border-white/10"
                      style={{ background: p.secondaryColor }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-foreground leading-tight flex-1 truncate">
                    {p.name}
                  </span>
                  {palette === p.id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </section>

          <Divider />

          {/* ── Layout Toggles ─────────────────────────────────────────── */}
          <section>
            <SectionLabel>Opciones de Layout</SectionLabel>
            <div className="space-y-3.5">
              <ToggleRow
                label="Barra fija"
                description="Topbar siempre visible al scroll"
                checked={fixedTopbar}
                onCheckedChange={setFixedTopbar}
              />
              <ToggleRow
                label="Barra oscura"
                description="Topbar en fondo navy oscuro"
                checked={darkTopbar}
                onCheckedChange={setDarkTopbar}
              />
            </div>
          </section>

          <Divider />

          {/* ── Menu Style Radio ──────────────────────────────────────── */}
          <section>
            <SectionLabel>Estilo de Menú</SectionLabel>
            <div className="grid grid-cols-3 gap-2">
              {MENU_OPTIONS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => setMenuStyle(value as MenuStyle)}
                  className={cn(
                    'flex flex-col items-center gap-2 py-3 px-2 rounded-xl border transition-all',
                    menuStyle === value
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                      : 'border-border hover:border-primary/30 hover:bg-muted/40',
                  )}
                >
                  <Icon
                    className={cn(
                      'w-5 h-5 transition-colors',
                      menuStyle === value ? 'text-primary' : 'text-muted-foreground',
                    )}
                  />
                  <span
                    className={cn(
                      'text-[10px] font-medium leading-none',
                      menuStyle === value ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* ── Preview of active settings ──────────────────────────── */}
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
              Configuración activa
            </p>
            <ActiveBadge label={PALETTES.find((p) => p.id === palette)?.name ?? palette} />
            {darkTopbar && <ActiveBadge label="Barra oscura" />}
            {!fixedTopbar && <ActiveBadge label="Topbar minimal" />}
            {menuStyle !== 'default' && (
              <ActiveBadge label={menuStyle === 'gradient' ? 'Menú degradado' : 'Menú enmarcado'} />
            )}
          </div>

          {/* ── Reset ───────────────────────────────────────────────── */}
          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-[12px]
                       text-muted-foreground border border-dashed border-border rounded-xl
                       hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Restablecer predeterminados
          </button>

        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}

function Divider() {
  return <div className="border-t border-border" />;
}

function ActiveBadge({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
      <span className="text-[11px] text-foreground">{label}</span>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label:           string;
  description:     string;
  checked:         boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground leading-tight">{label}</p>
        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{description}</p>
      </div>
      <RSwitch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
          'border-2 border-transparent outline-none transition-colors duration-200',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <RSwitch.Thumb
          className={cn(
            'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-md',
            'transition-transform duration-200 ease-in-out will-change-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </RSwitch.Root>
    </div>
  );
}
