import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@/components/Settings/components/SegmentedControl';
import { useSetStorageSource } from '@/hooks/useApi';
import type { StorageSource, StorageStats } from '@/types';

/**
 * Unraid | Sonarr/Radarr switch, shown wherever storage is when both are
 * connected. Choosing one saves it, and every storage view (and disk-pressure
 * cleanup) follows at once.
 */
export function StorageSourceSwitch({ stats, className }: { stats: StorageStats | undefined; className?: string }) {
  const { t } = useTranslation('common');
  const setSource = useSetStorageSource();
  if (!stats?.available?.unraid || !stats.available.arr) return null;

  return (
    <SegmentedControl<StorageSource>
      value={stats.source}
      options={[
        { value: 'unraid', label: t('storageSource.unraid', 'Unraid') },
        { value: 'arr', label: t('storageSource.arr', 'Sonarr/Radarr') },
      ]}
      onChange={(source) => setSource.mutate(source)}
      ariaLabel={t('storageSource.label', 'Storage source')}
      className={className}
    />
  );
}

