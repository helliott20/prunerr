import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Eye, AlertCircle, Film, Shield, HardDrive } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { rulesApi } from '@/services/api';
import { formatBytes } from '@/lib/utils';
import type { ConditionNode } from '@/types';

interface LivePreviewProps {
  root: ConditionNode;
  mediaType?: 'all' | 'movie' | 'show' | 'tv';
  /** If false, shows an inert placeholder. */
  enabled?: boolean;
}

const DEBOUNCE_MS = 400;

/**
 * Live preview panel for the v2 rule builder. Calls POST /api/rules/preview
 * with the current condition tree (debounced) and renders stats + samples.
 */
export function LivePreview({ root, mediaType = 'all', enabled = true }: LivePreviewProps) {
  const [debouncedRoot, setDebouncedRoot] = useState<ConditionNode>(root);
  const [debouncedMediaType, setDebouncedMediaType] = useState(mediaType);

  const previewMutation = useMutation({
    mutationFn: rulesApi.previewV2,
  });

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedRoot(root);
      setDebouncedMediaType(mediaType);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [root, mediaType]);

  useEffect(() => {
    if (!enabled) return;
    if (!hasAnyCondition(debouncedRoot)) return;
    previewMutation.mutate({
      version: 2,
      root: debouncedRoot,
      mediaType: debouncedMediaType,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedRoot, debouncedMediaType, enabled]);

  const preview = previewMutation.data;
  const error = previewMutation.error as Error | null;

  return (
    <Card className="p-4 bg-surface-800/50 sticky top-0">
      <h4 className="text-sm font-medium text-surface-300 mb-4 flex items-center gap-2">
        <Eye className="w-4 h-4" />
        Live Preview
      </h4>

      {!hasAnyCondition(debouncedRoot) ? (
        <EmptyPreview />
      ) : previewMutation.isPending ? (
        <LoadingSkeleton />
      ) : error ? (
        <PreviewError message={error.message} />
      ) : preview ? (
        <PreviewStats preview={preview} />
      ) : (
        <EmptyPreview />
      )}
    </Card>
  );
}

// ────────────────────── Subcomponents ──────────────────────

function EmptyPreview() {
  return (
    <div className="text-center py-8 text-surface-500">
      <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
      <p className="text-sm">Add conditions to see a preview</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-20 bg-surface-700 rounded animate-pulse" />
      <div className="h-8 bg-surface-700 rounded animate-pulse" />
      <div className="h-32 bg-surface-700 rounded animate-pulse" />
    </div>
  );
}

function PreviewError({ message }: { message: string }) {
  return (
    <div className="text-center py-6 text-ruby-400">
      <AlertCircle className="w-6 h-6 mx-auto mb-2" />
      <p className="text-sm font-medium">Preview failed</p>
      <p className="text-xs text-surface-400 mt-1">{message}</p>
    </div>
  );
}

interface PreviewData {
  totalMatches?: number;
  wouldQueue?: number;
  wouldSkipProtected?: number;
  storageFreedGB?: number;
  samples?: Array<{ id: number; title: string; size: number; rating: number | null }>;
}

function PreviewStats({ preview }: { preview: PreviewData }) {
  const total = preview.totalMatches ?? 0;
  const queue = preview.wouldQueue ?? 0;
  const skipped = preview.wouldSkipProtected ?? 0;
  const freedGB = preview.storageFreedGB ?? 0;
  const samples = preview.samples ?? [];

  return (
    <div className="space-y-4">
      <div className="text-center py-4 bg-surface-700/60 rounded-lg">
        <div className="text-3xl font-bold text-white">{total}</div>
        <div className="text-sm text-surface-400">items would match</div>
        <div className="text-lg font-medium text-emerald-400 mt-1">
          {freedGB.toFixed(2)} GB reclaimable
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatPill
          icon={<HardDrive className="w-4 h-4" />}
          label="Queue"
          value={queue}
          tone="accent"
        />
        <StatPill
          icon={<Shield className="w-4 h-4" />}
          label="Protected"
          value={skipped}
          tone="neutral"
        />
      </div>

      {samples.length > 0 && (
        <div>
          <p className="text-xs text-surface-500 mb-2">Top matches by size:</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {samples.slice(0, 10).map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2 bg-surface-700/50 rounded text-sm"
              >
                <div className="w-8 h-8 bg-surface-600 rounded flex items-center justify-center flex-shrink-0">
                  <Film className="w-4 h-4 text-surface-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-surface-200 truncate">{item.title}</p>
                  <p className="text-xs text-surface-500">
                    {formatBytes(item.size)}
                    {item.rating !== null && ` • ${item.rating.toFixed(1)}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'accent' | 'neutral';
}) {
  const toneClass =
    tone === 'accent'
      ? 'bg-accent-500/10 text-accent-300 border-accent-500/20'
      : 'bg-surface-700/60 text-surface-300 border-surface-600/40';
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${toneClass}`}>
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-xs opacity-80">{label}</div>
        <div className="text-base font-semibold">{value}</div>
      </div>
    </div>
  );
}

// ────────────────────── Helpers ──────────────────────

function hasAnyCondition(node: ConditionNode): boolean {
  if (node.kind === 'condition') return true;
  return node.children.some(hasAnyCondition);
}

