import type { Metadata } from 'next';
import { ConfiguracionContent } from '@/components/configuracion/ConfiguracionContent';
export const metadata: Metadata = { title: 'Configuración' };
export default function ConfiguracionPage() { return <ConfiguracionContent />; }
