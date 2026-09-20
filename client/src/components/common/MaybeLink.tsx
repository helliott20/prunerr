import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface MaybeLinkProps {
  /** Destination, or null when this row has nothing to link to. */
  to: string | null;
  children: ReactNode;
  className?: string;
  title?: string;
  /** Applied only when the link renders — hover/focus affordances, usually. */
  linkClassName?: string;
  /** Stop the click reaching a clickable parent row. Defaults to true. */
  stopPropagation?: boolean;
}

/**
 * Renders its children as a router link when there is somewhere to go, and as
 * a plain wrapper when there isn't.
 *
 * Lists across the app show titles whose target is sometimes missing — a
 * history entry whose media row has since been pruned, an activity entry
 * pointing at something without a detail page. Rather than each list repeating
 * the same conditional, they hand the href (or null) to this component and get
 * identical markup either way.
 */
export function MaybeLink({
  to,
  children,
  className,
  title,
  linkClassName,
  stopPropagation = true,
}: MaybeLinkProps) {
  if (!to) {
    return (
      <span className={className} title={title}>
        {children}
      </span>
    );
  }

  return (
    <Link
      to={to}
      className={[className, linkClassName].filter(Boolean).join(' ') || undefined}
      title={title}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {children}
    </Link>
  );
}

export default MaybeLink;
