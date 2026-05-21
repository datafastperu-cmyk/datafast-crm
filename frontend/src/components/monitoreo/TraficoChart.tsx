'use client';
import type { Nodo, WsEventDashboard } from '@/types';
export function TraficoChart(_props: { nodos: Nodo[]; wsStats: WsEventDashboard | null }) {
  return <div className="p-4 text-sm text-muted-foreground">Gráfico de tráfico</div>;
}
