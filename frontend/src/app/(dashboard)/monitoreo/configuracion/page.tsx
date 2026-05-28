import type { Metadata } from 'next';
import { UmbralesContent } from '@/components/monitoreo/UmbralesContent';
export const metadata: Metadata = { title: 'Umbrales de Alerta' };
export default function ConfiguracionAlertasPage() { return <UmbralesContent />; }
