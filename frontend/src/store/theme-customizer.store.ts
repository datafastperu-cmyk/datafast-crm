import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PaletteId =
  | 'olive-navy'
  | 'blue-navy'
  | 'violet-dark'
  | 'teal-dark'
  | 'rose-dark'
  | 'amber-dark';

export type MenuStyle = 'default' | 'gradient' | 'boxed';

interface ThemeCustomizerState {
  palette:     PaletteId;
  fixedTopbar: boolean;
  darkTopbar:  boolean;
  menuStyle:   MenuStyle;
  open:        boolean;
  setPalette:     (p: PaletteId)   => void;
  setFixedTopbar: (v: boolean)     => void;
  setDarkTopbar:  (v: boolean)     => void;
  setMenuStyle:   (s: MenuStyle)   => void;
  setOpen:        (v: boolean)     => void;
}

export const useThemeCustomizerStore = create<ThemeCustomizerState>()(
  persist(
    (set) => ({
      palette:        'olive-navy',
      fixedTopbar:    true,
      darkTopbar:     false,
      menuStyle:      'default',
      open:           false,
      setPalette:     (palette)     => set({ palette }),
      setFixedTopbar: (fixedTopbar) => set({ fixedTopbar }),
      setDarkTopbar:  (darkTopbar)  => set({ darkTopbar }),
      setMenuStyle:   (menuStyle)   => set({ menuStyle }),
      setOpen:        (open)        => set({ open }),
    }),
    {
      name: 'datafast-theme-customizer',
      /* panel state (open) never persists — always starts closed */
      partialize: (s) => ({
        palette:     s.palette,
        fixedTopbar: s.fixedTopbar,
        darkTopbar:  s.darkTopbar,
        menuStyle:   s.menuStyle,
      }),
    },
  ),
);

// ── Palette definitions ────────────────────────────────────────────────────

export interface PaletteOption {
  id:             PaletteId;
  name:           string;
  primaryColor:   string;  // hex, for preview circles
  secondaryColor: string;
  css:            string;  // CSS vars to inject into <style>
}

export const PALETTES: PaletteOption[] = [
  {
    id: 'olive-navy', name: 'Oliva / Marino',
    primaryColor: '#7d9435', secondaryColor: '#111b38',
    css: `
      :root {
        --primary: 82 38% 38%; --ring: 82 38% 38%;
        --sidebar-bg: 226 58% 11%; --sidebar-active: 82 38% 56%;
        --sidebar-hover: 226 50% 16%; --sidebar-border: 226 46% 16%;
      }
      .dark {
        --primary: 82 34% 50%; --ring: 82 34% 50%;
        --sidebar-bg: 226 68% 4%; --sidebar-active: 82 34% 50%;
        --sidebar-hover: 224 55% 9%; --sidebar-border: 224 55% 9%;
      }
    `,
  },
  {
    id: 'blue-navy', name: 'Azul / Marino',
    primaryColor: '#3b82f6', secondaryColor: '#1e3a5f',
    css: `
      :root {
        --primary: 217 91% 45%; --ring: 217 91% 45%;
        --sidebar-bg: 222 52% 10%; --sidebar-active: 217 91% 58%;
        --sidebar-hover: 222 45% 16%; --sidebar-border: 222 45% 15%;
      }
      .dark {
        --primary: 217 91% 60%; --ring: 217 91% 60%;
        --sidebar-bg: 222 80% 4%; --sidebar-active: 217 91% 60%;
        --sidebar-hover: 222 65% 8%; --sidebar-border: 222 65% 8%;
      }
    `,
  },
  {
    id: 'violet-dark', name: 'Violeta / Oscuro',
    primaryColor: '#8b5cf6', secondaryColor: '#2d1b69',
    css: `
      :root {
        --primary: 263 70% 50%; --ring: 263 70% 50%;
        --sidebar-bg: 265 60% 10%; --sidebar-active: 263 70% 60%;
        --sidebar-hover: 265 50% 16%; --sidebar-border: 265 50% 15%;
      }
      .dark {
        --primary: 263 70% 62%; --ring: 263 70% 62%;
        --sidebar-bg: 265 75% 4%; --sidebar-active: 263 70% 62%;
        --sidebar-hover: 265 60% 8%; --sidebar-border: 265 60% 8%;
      }
    `,
  },
  {
    id: 'teal-dark', name: 'Verde / Oscuro',
    primaryColor: '#10b981', secondaryColor: '#064e3b',
    css: `
      :root {
        --primary: 160 84% 39%; --ring: 160 84% 39%;
        --sidebar-bg: 162 72% 8%; --sidebar-active: 160 84% 50%;
        --sidebar-hover: 162 55% 14%; --sidebar-border: 162 55% 13%;
      }
      .dark {
        --primary: 160 84% 46%; --ring: 160 84% 46%;
        --sidebar-bg: 162 80% 4%; --sidebar-active: 160 84% 46%;
        --sidebar-hover: 162 65% 8%; --sidebar-border: 162 65% 8%;
      }
    `,
  },
  {
    id: 'rose-dark', name: 'Rosa / Oscuro',
    primaryColor: '#f43f5e', secondaryColor: '#4c0519',
    css: `
      :root {
        --primary: 347 77% 50%; --ring: 347 77% 50%;
        --sidebar-bg: 348 70% 9%; --sidebar-active: 347 77% 60%;
        --sidebar-hover: 346 55% 15%; --sidebar-border: 346 55% 14%;
      }
      .dark {
        --primary: 347 77% 62%; --ring: 347 77% 62%;
        --sidebar-bg: 348 80% 4%; --sidebar-active: 347 77% 62%;
        --sidebar-hover: 346 65% 8%; --sidebar-border: 346 65% 8%;
      }
    `,
  },
  {
    id: 'amber-dark', name: 'Ámbar / Café',
    primaryColor: '#f59e0b', secondaryColor: '#451a03',
    css: `
      :root {
        --primary: 38 92% 45%; --ring: 38 92% 45%;
        --sidebar-bg: 30 65% 9%; --sidebar-active: 38 92% 55%;
        --sidebar-hover: 34 50% 15%; --sidebar-border: 34 50% 14%;
      }
      .dark {
        --primary: 38 92% 56%; --ring: 38 92% 56%;
        --sidebar-bg: 30 80% 4%; --sidebar-active: 38 92% 56%;
        --sidebar-hover: 34 65% 8%; --sidebar-border: 34 65% 8%;
      }
    `,
  },
];
