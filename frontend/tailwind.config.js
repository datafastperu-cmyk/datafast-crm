/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        /* ── Tokens semánticos (CSS vars) ───────────────────────────────── */
        border:     'hsl(var(--border))',
        input:      'hsl(var(--input))',
        ring:       'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',

        primary:     { DEFAULT: 'hsl(var(--primary))',     foreground: 'hsl(var(--primary-foreground))' },
        secondary:   { DEFAULT: 'hsl(var(--secondary))',   foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted:       { DEFAULT: 'hsl(var(--muted))',       foreground: 'hsl(var(--muted-foreground))' },
        accent:      { DEFAULT: 'hsl(var(--accent))',      foreground: 'hsl(var(--accent-foreground))' },
        card:        { DEFAULT: 'hsl(var(--card))',        foreground: 'hsl(var(--card-foreground))' },
        popover:     { DEFAULT: 'hsl(var(--popover))',     foreground: 'hsl(var(--popover-foreground))' },

        success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-fg))' },
        warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-fg))' },
        info:    { DEFAULT: 'hsl(var(--info))',    foreground: 'hsl(var(--info-fg))' },

        /* Estado operativo (alias de los tokens semánticos) */
        online:   { DEFAULT: 'hsl(var(--success))', dark: 'hsl(var(--success))' },
        offline:  { DEFAULT: 'hsl(var(--destructive))', dark: 'hsl(var(--destructive))' },
        degraded: { DEFAULT: 'hsl(var(--warning))',  dark: 'hsl(var(--warning))'  },

        /* Sidebar */
        sidebar: {
          bg:     'hsl(var(--sidebar-bg))',
          fg:     'hsl(var(--sidebar-fg))',
          active: 'hsl(var(--sidebar-active))',
          hover:  'hsl(var(--sidebar-hover))',
          border: 'hsl(var(--sidebar-border))',
        },

        /* ── Paleta Olive Green — color primario de marca ───────────────── */
        olive: {
          50:  '#f5f8ee',
          100: '#e8f0d4',
          200: '#d2e0aa',
          300: '#b5c977',
          400: '#99b24d',
          500: '#7d9435',   /* olive base */
          600: '#62762a',
          700: '#4c5c21',
          800: '#3c481b',
          900: '#303b16',
          950: '#191f0b',
        },

        /* ── Paleta Navy Blue — estructural / fondos / sidebar ──────────── */
        navy: {
          50:  '#f0f3fa',
          100: '#dce5f4',
          200: '#b9cbe9',
          300: '#8aaad8',
          400: '#5e86c2',
          500: '#3c65a8',
          600: '#2e4e8d',
          700: '#253d72',
          800: '#1c2e58',   /* navy medio */
          900: '#111b38',   /* navy profundo */
          925: '#0a1123',   /* deep navy */
          950: '#060c18',   /* ultra dark navy */
        },
      },

      borderRadius: {
        lg:    'var(--radius)',
        md:    'calc(var(--radius) - 2px)',
        sm:    'calc(var(--radius) - 4px)',
        xl:    'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
      },

      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },

      backdropBlur: {
        xs: '2px',
      },

      boxShadow: {
        'card':         '0 1px 3px 0 rgba(0,0,0,0.3), 0 1px 2px -1px rgba(0,0,0,0.3)',
        'card-hover':   '0 4px 16px -4px rgba(0,0,0,0.4)',
        /* glow shadows usan las vars del tema actual */
        'glow-primary': '0 0 24px -4px hsl(var(--primary) / 0.4)',
        'glow-success': '0 0 24px -4px hsl(var(--success) / 0.4)',
        'glow-danger':  '0 0 24px -4px hsl(var(--destructive) / 0.4)',
        'inner-glow':   'inset 0 1px 0 0 rgba(255,255,255,0.05)',
      },

      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up':   { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'pulse-dot':      { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.25' } },
        'slide-in':       { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'slide-up':       { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'fade-in':        { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'zoom-in':        { from: { opacity: '0', transform: 'scale(0.95)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 8px 2px hsl(var(--primary) / 0.30)' },
          '50%':       { boxShadow: '0 0 20px 6px hsl(var(--primary) / 0.55)' },
        },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
        'pulse-dot':      'pulse-dot 2s ease-in-out infinite',
        'slide-in':       'slide-in 0.3s ease-out',
        'slide-up':       'slide-up 0.25s ease-out',
        'fade-in':        'fade-in 0.2s ease-out',
        'zoom-in':        'zoom-in 0.2s ease-out',
        'glow-pulse':     'glow-pulse 2.5s ease-in-out infinite',
        shimmer:          'shimmer 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
};
