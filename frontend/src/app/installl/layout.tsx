import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Instalación — CRM ISP DATAFAST',
  description: 'Asistente de instalación web de CRM ISP DATAFAST',
};

export default function InstalllLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-[#0a0a0f] text-white antialiased">
        {children}
      </body>
    </html>
  );
}
