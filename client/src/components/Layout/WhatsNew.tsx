import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Sparkles, X, RefreshCw, ExternalLink, WifiOff } from 'lucide-react';

import { cn, formatDate } from '@/lib/utils';
import { useAnnouncements, useRefreshAnnouncements, useTelemetry } from '@/hooks/useApi';
import type { AnnouncementItem, AnnouncementType } from '@/services/api';

/**
 * The "What's new" button and panel.
 *
 * Sits in the sidebar foot. Opens a floating panel, anchored to the sidebar on
 * desktop and a bottom sheet on phones, listing announcements from the remote
 * feed above the changelog compiled into the release. Which ids have been
 * seen lives in this browser only: nothing about reading is sent anywhere.
 *
 * It opens itself once — never on a first visit while the telemetry notice
 * is still up — when the changelog entry for the running version has not
 * been seen (so an upgrade announces itself) or a pinned announcement is new.
 */

const SEEN_KEY = 'prunerr:whatsnew:seen';
const AUTO_OPENED_KEY = 'prunerr:whatsnew:autoOpened';

function readList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key: string, value: string[]) {
  try {
    // Cap it: an install that has been through a hundred releases does not
    // need to remember all of them to know the latest is unread.
    window.localStorage.setItem(key, JSON.stringify(value.slice(-200)));
  } catch {
    /* private mode or blocked storage: the dot just never clears */
  }
}

const TYPE_STYLES: Record<AnnouncementType, { pill: string; wash: string }> = {
  feature: { pill: 'bg-accent-500/15 text-accent-text', wash: 'from-accent-500/40 via-accent-600/15' },
  improvement: { pill: 'bg-cyan-500/15 text-cyan-text', wash: 'from-cyan-500/40 via-cyan-600/15' },
  fix: { pill: 'bg-emerald-500/15 text-emerald-text', wash: 'from-emerald-500/40 via-emerald-600/15' },
  feedback: { pill: 'bg-violet-500/15 text-violet-text', wash: 'from-violet-500/40 via-violet-600/15' },
  announcement: { pill: 'bg-surface-700/80 text-surface-200', wash: 'from-surface-500/40 via-surface-600/15' },
  release: { pill: 'bg-surface-700/80 text-surface-200', wash: 'from-accent-500/30 via-surface-600/10' },
};

/** Plain text → paragraphs and bullet lists. No markdown parser, on purpose. */
function Body({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const out: Array<{ kind: 'p'; text: string } | { kind: 'ul'; items: string[] }> = [];
    for (const raw of text.split(/\n{2,}/)) {
      const lines = raw.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0);
      if (lines.length === 0) continue;
      if (lines.every((l) => l.startsWith('- '))) {
        out.push({ kind: 'ul', items: lines.map((l) => l.slice(2)) });
        continue;
      }
      // A paragraph followed by bullets inside one block: split at the first bullet.
      const firstBullet = lines.findIndex((l) => l.startsWith('- '));
      if (firstBullet > 0 && lines.slice(firstBullet).every((l) => l.startsWith('- '))) {
        out.push({ kind: 'p', text: lines.slice(0, firstBullet).join(' ') });
        out.push({ kind: 'ul', items: lines.slice(firstBullet).map((l) => l.slice(2)) });
        continue;
      }
      out.push({ kind: 'p', text: lines.join(' ') });
    }
    return out;
  }, [text]);

  return (
    <div className="space-y-2 text-[12.5px] leading-relaxed text-surface-300">
      {blocks.map((block, i) =>
        block.kind === 'p' ? (
          <p key={i}>{block.text}</p>
        ) : (
          <ul key={i} className="space-y-1 pl-4">
            {block.items.map((item, j) => (
              <li key={j} className="list-disc marker:text-surface-500">
                {item}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function Card({ item, unread }: { item: AnnouncementItem; unread: boolean }) {
  const { t } = useTranslation('layout');
  const [imageFailed, setImageFailed] = useState(false);
  const style = TYPE_STYLES[item.type] ?? TYPE_STYLES.announcement;

  const typeLabel: Record<AnnouncementType, string> = {
    feature: t('whatsNew.type.feature', 'New'),
    improvement: t('whatsNew.type.improvement', 'Improved'),
    fix: t('whatsNew.type.fix', 'Fixed'),
    feedback: t('whatsNew.type.feedback', 'Your feedback'),
    announcement: t('whatsNew.type.announcement', 'Announcement'),
    release: t('whatsNew.type.release', 'Release'),
  };

  const showImage = Boolean(item.imageUrl) && !imageFailed;

  return (
    <article className="overflow-hidden rounded-2xl border border-surface-700/70 bg-surface-800/60">
      {showImage ? (
        <div className="relative aspect-[16/9] w-full bg-surface-900">
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        item.source === 'remote' && (
          <div className={cn('relative h-14 w-full bg-gradient-to-br to-transparent', style.wash)} aria-hidden="true" />
        )
      )}

      <div className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide', style.pill)}>
            {item.version ? `v${item.version}` : typeLabel[item.type]}
          </span>
          <span className="text-[11px] text-surface-500">{formatDate(item.publishedAt)}</span>
          {unread && (
            <span className="ml-auto flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-accent-text">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
              {t('whatsNew.unread', 'New')}
            </span>
          )}
        </div>

        <h3 className="font-display text-[14.5px] font-semibold leading-snug text-surface-50">{item.title}</h3>
        <div className="mt-2">
          <Body text={item.body} />
        </div>

        {item.link && (
          <a
            href={item.link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-surface-700/70 px-3 py-1.5 text-[12px] font-semibold text-surface-100 transition-colors hover:bg-surface-600/80 hover:text-surface-50"
          >
            {item.link.label ?? t('whatsNew.readMore', 'Read more')}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </article>
  );
}

export function WhatsNew() {
  const { t } = useTranslation('layout');
  const reduce = useReducedMotion();
  const { data, isError } = useAnnouncements();
  const { data: telemetry } = useTelemetry();
  const refresh = useRefreshAnnouncements();

  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string[]>(() => readList(SEEN_KEY));
  // The ids that were unread when the panel opened, so they keep their "New"
  // marker for the rest of this viewing even though they are now recorded.
  const [freshOnOpen, setFreshOnOpen] = useState<Set<string>>(() => new Set());
  const autoOpenChecked = useRef(false);

  const items = useMemo(() => data?.items ?? [], [data]);
  const unread = useMemo(() => items.filter((i) => !seen.includes(i.id)), [items, seen]);

  const markAllSeen = useCallback(() => {
    if (items.length === 0) return;
    const next = Array.from(new Set([...seen, ...items.map((i) => i.id)]));
    setSeen(next);
    writeList(SEEN_KEY, next);
  }, [items, seen]);

  const openPanel = useCallback(() => {
    setFreshOnOpen(new Set(unread.map((i) => i.id)));
    setOpen(true);
    markAllSeen();
  }, [unread, markAllSeen]);

  const close = useCallback(() => setOpen(false), []);

  // Auto-open once per trigger, and never on top of the telemetry notice.
  useEffect(() => {
    if (autoOpenChecked.current || !data || !telemetry) return;
    if (telemetry.enabled && !telemetry.noticeSeen) return;
    autoOpenChecked.current = true;

    const autoOpened = readList(AUTO_OPENED_KEY);
    const trigger = items.find(
      (i) =>
        !seen.includes(i.id) &&
        !autoOpened.includes(i.id) &&
        ((i.source === 'changelog' && i.version === data.version) || (i.source === 'remote' && i.pinned))
    );
    if (!trigger) return;

    writeList(AUTO_OPENED_KEY, [...autoOpened, trigger.id]);
    const timer = window.setTimeout(openPanel, 1200);
    return () => window.clearTimeout(timer);
  }, [data, telemetry, items, seen, openPanel]);

  // Escape closes; the page keeps scrolling underneath since this is a
  // popover, not a modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const label = t('whatsNew.title', "What's new");
  const offline = Boolean(data && data.remote.enabled && data.remote.lastError && !data.remote.lastFetchedAt);

  return (
    <>
      <button
        type="button"
        onClick={open ? close : openPanel}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'sidebar-foot-link group relative p-2.5 rounded-lg transition-all',
          open ? 'text-accent-text bg-surface-800/60' : 'text-surface-500 hover:text-accent-text-hover hover:bg-surface-800/60'
        )}
        title={label}
        aria-label={unread.length > 0 ? t('whatsNew.buttonUnread', "What's new, {{count}} unread", { count: unread.length }) : label}
      >
        <Sparkles className="w-4 h-4" />
        {unread.length > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-500" />
          </span>
        )}
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              {/* Click-away layer. Transparent so the page stays readable. */}
              <div className="fixed inset-0 z-[60]" onClick={close} aria-hidden="true" />
              <motion.div
                role="dialog"
                aria-label={label}
                initial={reduce ? { opacity: 1 } : { opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                className={cn(
                  'fixed z-[61] flex flex-col overflow-hidden rounded-t-2xl border border-surface-700/80 bg-surface-900/95 shadow-2xl backdrop-blur',
                  // Phone: bottom sheet. Desktop: floats beside the sidebar foot.
                  'inset-x-0 bottom-0 max-h-[80vh]',
                  'lg:inset-x-auto lg:bottom-4 lg:left-[calc(18rem+0.75rem)] lg:w-[400px] lg:max-h-[min(80vh,720px)] lg:rounded-2xl'
                )}
              >
                <header className="flex items-center gap-2 border-b border-surface-800/70 px-4 py-3">
                  <Sparkles className="h-4 w-4 text-accent-text" />
                  <h2 className="font-display text-[14px] font-semibold text-surface-50">{label}</h2>
                  <span className="text-[11px] text-surface-500 font-mono">v{data?.version ?? '…'}</span>
                  <div className="ml-auto flex items-center gap-1">
                    {data?.remote.enabled && (
                      <button
                        type="button"
                        onClick={() => refresh.mutate()}
                        disabled={refresh.isPending}
                        className="rounded-lg p-1.5 text-surface-500 transition-colors hover:bg-surface-800/60 hover:text-surface-200 disabled:opacity-50"
                        title={t('whatsNew.refresh', 'Check for announcements')}
                        aria-label={t('whatsNew.refresh', 'Check for announcements')}
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-lg p-1.5 text-surface-500 transition-colors hover:bg-surface-800/60 hover:text-surface-200"
                      aria-label={t('whatsNew.close', 'Close')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </header>

                <div className="flex-1 space-y-3 overflow-y-auto p-3">
                  {isError && (
                    <p className="rounded-xl border border-surface-700/80 bg-surface-800/50 px-3.5 py-3 text-xs text-surface-400">
                      {t('whatsNew.loadFailed', 'Could not load what’s new.')}
                    </p>
                  )}

                  {offline && (
                    <p className="flex items-start gap-2 rounded-xl border border-surface-700/80 bg-surface-800/50 px-3.5 py-3 text-xs text-surface-400">
                      <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {t('whatsNew.offline', 'Announcements could not be fetched. Release notes are still shown.')}
                    </p>
                  )}

                  {items.map((item) => (
                    <Card key={item.id} item={item} unread={freshOnOpen.has(item.id)} />
                  ))}

                  {data && items.length === 0 && (
                    <p className="px-3 py-6 text-center text-xs text-surface-500">
                      {t('whatsNew.empty', 'Nothing to show yet.')}
                    </p>
                  )}
                </div>

                {data && !data.remote.enabled && (
                  <footer className="border-t border-surface-800/70 px-4 py-2.5 text-[11px] leading-relaxed text-surface-500">
                    {data.remote.lockedByEnv
                      ? t('whatsNew.disabledByEnv', 'Announcements are off for this container (TELEMETRY_ENABLED=false). Only built-in release notes are shown.')
                      : t('whatsNew.disabled', 'Announcements are off because the anonymous install count is off. Turn it on under Settings → Privacy to receive them.')}
                  </footer>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
