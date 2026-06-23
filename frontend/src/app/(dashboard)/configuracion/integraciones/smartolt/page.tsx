import type { Metadata } from 'next';
import { Wifi } from 'lucide-react';
import { IntegracionProveedorPage } from '@/components/red/IntegracionProveedorPage';

export const metadata: Metadata = { title: 'SmartOLT — Integración' };

export default function SmartOltIntegracionPage() {
  return (
    <IntegracionProveedorPage
      tipo="smartolt"
      titulo="SmartOLT"
      descripcion="Gestión de OLTs y ONUs FTTH vía API REST de SmartOLT"
      colorCls="bg-purple-500/15 text-purple-400"
      icono={<Wifi className="w-5 h-5" />}
    />
  );
}
