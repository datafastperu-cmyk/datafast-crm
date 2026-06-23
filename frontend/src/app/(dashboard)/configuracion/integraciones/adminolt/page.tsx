import type { Metadata } from 'next';
import { Wifi } from 'lucide-react';
import { IntegracionProveedorPage } from '@/components/red/IntegracionProveedorPage';

export const metadata: Metadata = { title: 'AdminOLT — Integración' };

export default function AdminOltIntegracionPage() {
  return (
    <IntegracionProveedorPage
      tipo="adminolt"
      titulo="AdminOLT"
      descripcion="Gestión de OLTs y ONUs FTTH vía API REST de AdminOLT"
      colorCls="bg-sky-500/15 text-sky-400"
      icono={<Wifi className="w-5 h-5" />}
    />
  );
}
