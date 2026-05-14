import type { Metadata } from 'next';
import { ConfiguracionAlertas } from '@/components/monitoreo/ConfiguracionAlertas';
export const metadata: Metadata = { title: 'Configuración de Alertas' };
export default function ConfiguracionAlertasPage() { return <ConfiguracionAlertas />; }
