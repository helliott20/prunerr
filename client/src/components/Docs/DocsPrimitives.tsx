import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowUpRight, Check, ChevronRight, Copy, Info, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Building blocks for the in-app docs. The guides themselves live in
 * docsContent.tsx and are written with these, so every page shares one look:
 * prose, inline code, env var tables, copyable code blocks and callouts.
 */

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[14.5px] leading-relaxed text-surface-300">{children}</p>;
}

/** Inline code: variable names, paths, values. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border border-surface-700/60 bg-surface-800/80 px-1.5 py-0.5 font-mono text-[12.5px] text-accent-text">
      {children}
    </code>
  );
}

/** Bold UI label, for buttons and fields that aren't worth linking. */
export function Ui({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-surface-100">{children}</span>;
}

/**
 * A breadcrumb into the app itself, e.g. Settings › Watch history. The one
 * thing in-app docs can do that a wiki can't: take you straight there.
 */
export function AppLink({ to, path }: { to: string; path: string[] }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-accent-500/25 bg-accent-500/10 px-1.5 py-0.5 align-baseline',
        'text-[13px] font-medium text-accent-text transition-colors hover:border-accent-500/40 hover:bg-accent-500/15'
      )}
    >
      {path.map((part, i) => (
        <span key={part} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight aria-hidden className="h-3 w-3 opacity-60" />}
          {part}
        </span>
      ))}
    </Link>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 font-medium text-accent-text underline decoration-accent-500/30 underline-offset-2 hover:decoration-accent-500"
    >
      {children}
      <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
    </a>
  );
}

export function List({ children, ordered = false }: { children: ReactNode; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag
      className={cn(
        'space-y-1.5 pl-5 text-[14.5px] leading-relaxed text-surface-300',
        ordered ? 'list-decimal marker:font-semibold marker:text-accent-text' : 'list-disc marker:text-surface-500'
      )}
    >
      {children}
    </Tag>
  );
}

/** Numbered walkthrough with a rail joining the steps. */
export function Steps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="relative space-y-4">
      {steps.map((step, i) => (
        <li key={i} className="relative flex gap-4">
          {i < steps.length - 1 && (
            <span aria-hidden className="absolute left-[13px] top-8 bottom-[-12px] w-px bg-surface-700/70" />
          )}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent-500/30 bg-accent-500/10 font-mono text-xs font-semibold text-accent-text">
            {i + 1}
          </span>
          <div className="pt-0.5 text-[14.5px] leading-relaxed text-surface-300">{step}</div>
        </li>
      ))}
    </ol>
  );
}

const CALLOUTS = {
  note: { icon: Info, className: 'border-sky-500/25 bg-sky-500/[0.07]', iconClass: 'text-sky-400' },
  tip: { icon: Lightbulb, className: 'border-accent-500/25 bg-accent-500/[0.07]', iconClass: 'text-accent-text' },
  warning: { icon: AlertTriangle, className: 'border-ruby-500/25 bg-ruby-500/[0.07]', iconClass: 'text-ruby-text' },
} as const;

export function Callout({
  type = 'note',
  title,
  children,
}: {
  type?: keyof typeof CALLOUTS;
  title?: string;
  children: ReactNode;
}) {
  const { icon: Icon, className, iconClass } = CALLOUTS[type];
  return (
    <div className={cn('flex gap-3 rounded-xl border px-4 py-3.5', className)}>
      <Icon aria-hidden className={cn('mt-0.5 h-4 w-4 shrink-0', iconClass)} />
      <div className="space-y-1 text-[14px] leading-relaxed text-surface-300">
        {title && <p className="font-semibold text-surface-100">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = useTranslation('docs');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access is blocked on plain-http origins in some browsers;
      // the code is still selectable, so there's nothing else to do.
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-surface-700/60 bg-surface-950/60">
      <div className="flex items-center justify-between border-b border-surface-700/50 bg-surface-800/50 px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-surface-500">{language}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-surface-400 transition-colors hover:bg-surface-700/60 hover:text-surface-100"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-text" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('code.copied', 'Copied') : t('code.copy', 'Copy')}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-surface-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export interface EnvVar {
  name: string;
  description: ReactNode;
  /** Shown as a small badge, e.g. the default value. */
  badge?: string;
}

export function EnvTable({ vars }: { vars: EnvVar[] }) {
  const { t } = useTranslation('docs');
  return (
    <div className="overflow-hidden rounded-xl border border-surface-700/60">
      <table className="w-full text-left text-[13.5px]">
        <thead className="hidden bg-surface-800/60 text-[11px] uppercase tracking-wider text-surface-500 sm:table-header-group">
          <tr>
            <th className="px-4 py-2.5 font-semibold">{t('table.variable', 'Variable')}</th>
            <th className="px-4 py-2.5 font-semibold">{t('table.description', 'What it is')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-700/50">
          {vars.map((v) => (
            // Stacked on phones, where two columns leave the description a word wide.
            <tr key={v.name} className="flex flex-col align-top transition-colors hover:bg-surface-800/30 sm:table-row">
              <td className="whitespace-nowrap px-4 pb-1 pt-3 sm:py-3">
                <code className="font-mono text-[12.5px] font-medium text-accent-text">{v.name}</code>
              </td>
              <td className="px-4 pb-3 leading-relaxed text-surface-300 sm:pt-3">
                {v.description}
                {v.badge && (
                  <span className="ml-2 inline-block whitespace-nowrap rounded-full border border-surface-600/60 bg-surface-800/80 px-2 py-px font-mono text-[11px] text-surface-400">
                    {v.badge}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="pt-1 text-[15px] font-semibold text-surface-100">{children}</h3>;
}

/** Link to another section of the docs by its anchor id. */
export function DocLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={{ hash: to }}
      className="font-medium text-accent-text underline decoration-accent-500/30 underline-offset-2 hover:decoration-accent-500"
    >
      {children}
    </Link>
  );
}
