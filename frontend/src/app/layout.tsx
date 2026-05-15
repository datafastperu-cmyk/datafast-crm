import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider }  from '@/components/shared/ThemeProvider';
import { Toaster }        from '@/components/ui/toaster';
import { QueryProvider }     from '@/components/shared/QueryProvider';
import { LicenciaProvider }  from '@/components/licencia/LicenciaProvider';
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
  icons:       { icon: '/favicon.ico' },
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
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <LicenciaProvider>
              {children}
            </LicenciaProvider>
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
