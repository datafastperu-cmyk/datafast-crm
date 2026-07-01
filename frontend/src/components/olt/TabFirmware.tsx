'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { oltNativoApi } from '@/lib/api/olt-nativo';
import { FirmwarePanel } from '@/components/red/FirmwareUpgradeTab';

export function TabFirmware({ oltId }: { oltId: string }) {
  const { data: olt, isLoading } = useQuery({
    queryKey: ['olt-detalle', oltId],
    queryFn:  () => oltNativoApi.findOne(oltId),
    enabled:  !!oltId,
  });

  if (isLoading || !olt) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <FirmwarePanel olt={olt} />;
}
