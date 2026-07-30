import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider }     from '@/components/shared/ThemeProvider';
import { Toaster }           from '@/components/ui/toaster';
import { QueryProvider }     from '@/components/shared/QueryProvider';
import { LicenciaProvider }  from '@/components/licencia/LicenciaProvider';
import { ErrorBoundary }     from '@/components/ui/error-boundary';
import { ConfirmProvider }   from '@/components/ui/confirm-dialog';
import { ThemeCustomizer }   from '@/components/layout/ThemeCustomizer';
import '@/styles/globals.css';

const inter = Inter({
  subsets:   ['latin'],
  variable:  '--font-inter',
  display:   'swap',
});

export const metadata: Metadata = {
  title: {
    template: '%s | CRM ISP DATAFAST',
    default:  'CRM ISP DATAFAST',
  },
  description: 'Sistema de gestión para proveedores de internet',
  manifest:    '/manifest.json',
  icons:       { icon: '/favicon.ico', apple: '/favicon.ico' },
  appleWebApp: {
    capable:        true,
    statusBarStyle: 'default',
    title:          'DataFast ISP',
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <LicenciaProvider>
              <ErrorBoundary>
                {/* Las confirmaciones se piden con el diseño del ERP, no con el diálogo
                    nativo del navegador (que antepone la IP del servidor al mensaje). */}
                <ConfirmProvider>
                  {children}
                </ConfirmProvider>
              </ErrorBoundary>
              <ThemeCustomizer />
            </LicenciaProvider>
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
