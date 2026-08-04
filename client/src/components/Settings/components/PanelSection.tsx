import { useCallback, type ReactNode } from 'react';
import type { PanelProps } from '../types';

/**
 * One addressable sub-section of a panel. Registering the node is what lets the
 * rail's sub-item list scroll the panel to it.
 */
export function PanelSection({
  id,
  title,
  description,
  action,
  register,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  register: PanelProps['registerSection'];
  children: ReactNode;
}) {
  const ref = useCallback(
    (node: HTMLElement | null) => {
      register(id, node);
    },
    [id, register]
  );

  const headingId = `settings-section-${id}`;

  return (
    <section ref={ref} aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="font-display text-[19px] font-semibold text-surface-50">
            {title}
          </h2>
          {description && <p className="text-[12.5px] text-surface-400">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
