import type { ReactNode } from 'react';

/**
 * The one empty-state idiom the redesign uses everywhere: dashed, centred, and
 * deliberately calm — an unconfigured optional service is not an error.
 */
export function SettingsEmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-surface-600/70 px-5 py-[22px] text-center">
      <p className="font-display text-[13.5px] font-semibold text-surface-200">{title}</p>
      <p className="max-w-md text-xs text-surface-400">{body}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
