import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Sparkles,
  X,
  RefreshCw,
  ExternalLink,
  WifiOff,
  Wand2,
  Wrench,
  MessageSquareHeart,
  Megaphone,
  type LucideIcon,
} from 'lucide-react';

import { cn, formatDate } from '@/lib/utils';
import { useAnnouncements, useRefreshAnnouncements, useTelemetry } from '@/hooks/useApi';
import type { AnnouncementItem, AnnouncementType } from '@/services/api';

/**
 * The "What's new" button and panel.
 *
 * The sparkle button in the sidebar foot signals unread items by turning
 * solid amber, with a single glint, instead of a dot. Opening shows a single teaser card
 * bottom-right — the newest item, picture first, like a launch toast. Clicking
 * it expands into the full panel (a bottom sheet on phones) listing every
 * published announcement. Which ids have been seen lives in this browser
 * only: nothing about reading is sent anywhere.
 *
 * It opens itself once per pinned announcement — never on a first visit while
 * the telemetry notice is still up.
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

const TYPE_STYLES: Record<AnnouncementType, { pill: string; glow: string; icon: string }> = {
  feature: { pill: 'bg-accent-500/15 text-accent-text', glow: 'rgba(245,158,11,0.55)', icon: 'text-accent-400' },
  improvement: { pill: 'bg-cyan-500/15 text-cyan-text', glow: 'rgba(6,182,212,0.5)', icon: 'text-cyan-400' },
  fix: { pill: 'bg-emerald-500/15 text-emerald-text', glow: 'rgba(16,185,129,0.5)', icon: 'text-emerald-400' },
  feedback: { pill: 'bg-violet-500/15 text-violet-text', glow: 'rgba(139,92,246,0.55)', icon: 'text-violet-400' },
  announcement: { pill: 'bg-surface-700/80 text-surface-200', glow: 'rgba(148,163,184,0.4)', icon: 'text-surface-300' },
};

const TYPE_ICONS: Record<AnnouncementType, LucideIcon> = {
  feature: Sparkles,
  improvement: Wand2,
  fix: Wrench,
  feedback: MessageSquareHeart,
  announcement: Megaphone,
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
    <div className="space-y-2 text-[13px] leading-relaxed text-surface-300">
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

/** The first sentence or two, flattened, for the collapsed teaser. */
function teaser(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/^- /, '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * One announcement, Featurebase-style: the picture is the card, sitting on a
 * soft glow; a dark block underneath carries a bold title and a two-line
 * teaser. Clicking anywhere expands it to the full body and link.
 */
interface CardProps {
  item: AnnouncementItem;
  unread: boolean;
  expanded: boolean;
  onExpand: () => void;
  onCollapse?: () => void;
  /** Rendered in the hero's top-right, e.g. a close button on the teaser. */
  corner?: ReactNode;
  className?: string;
}

function Card({ item, unread, expanded, onExpand, onCollapse, corner, className }: CardProps) {
  const { t } = useTranslation('layout');
  const [imageFailed, setImageFailed] = useState(false);
  const style = TYPE_STYLES[item.type] ?? TYPE_STYLES.announcement;
  const Icon = TYPE_ICONS[item.type] ?? Megaphone;

  const typeLabel: Record<AnnouncementType, string> = {
    feature: t('whatsNew.type.feature', 'New'),
    improvement: t('whatsNew.type.improvement', 'Improved'),
    fix: t('whatsNew.type.fix', 'Fixed'),
    feedback: t('whatsNew.type.feedback', 'Your feedback'),
    announcement: t('whatsNew.type.announcement', 'Announcement'),
  };

  const showImage = Boolean(item.imageUrl) && !imageFailed;

  return (
    <article
      className={cn(
        'group overflow-hidden rounded-[18px] border border-surface-700/70 bg-surface-950 shadow-lg shadow-black/20 transition-colors',
        !expanded && 'cursor-pointer hover:border-surface-600/80',
        className
      )}
      onClick={() => !expanded && onExpand()}
    >
      {/* Hero: the image floats on a radial glow, the way a product screenshot
          sits on a launch graphic. Without an image the type icon does the job. */}
      <div
        className={cn('relative flex items-center justify-center overflow-hidden', showImage ? 'aspect-[16/10]' : 'h-24')}
        style={{
          background: `radial-gradient(ellipse at 50% 60%, ${style.glow} 0%, rgba(15,23,42,0) 70%), linear-gradient(180deg, rgb(var(--surface-800)) 0%, rgb(var(--surface-900)) 100%)`,
        }}
      >
        {showImage ? (
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-[84%] w-[84%] rounded-xl object-cover shadow-2xl shadow-black/50 ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-950/70 ring-1 ring-white/10 shadow-xl">
            <Icon className={cn('h-6 w-6', style.icon)} />
          </div>
        )}
        {unread && (
          <span className="absolute left-3 top-3 rounded-full bg-accent-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950 shadow">
            {t('whatsNew.unread', 'New')}
          </span>
        )}
        {corner && <div className="absolute right-2 top-2">{corner}</div>}
      </div>

      <div className="px-4 pb-4 pt-3.5">
        <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide">
          <span className={cn('rounded-full px-2 py-0.5', style.pill)}>
            {typeLabel[item.type]}
          </span>
          <span className="font-normal normal-case tracking-normal text-surface-500">{formatDate(item.publishedAt)}</span>
        </div>

        <h3 className="font-display text-[15.5px] font-bold leading-snug text-surface-50">{item.title}</h3>

        {expanded ? (
          <div className="mt-2">
            <Body text={item.body} />
          </div>
        ) : (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-surface-400">{teaser(item.body)}</p>
        )}

        {expanded && item.link && (
          <a
            href={item.link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-[12.5px] font-semibold text-amber-950 transition-colors hover:bg-accent-400"
          >
            {item.link.label ?? t('whatsNew.readMore', 'Read more')}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}

        {expanded && onCollapse && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCollapse();
            }}
            className="mt-3 block text-[12px] font-medium text-surface-500 hover:text-surface-300"
          >
            {t('whatsNew.showLess', 'Show less')}
          </button>
        )}
      </div>
    </article>
  );
}

type View = 'closed' | 'teaser' | 'panel';

interface WhatsNewContextValue {
  unreadCount: number;
  open: boolean;
  toggle: () => void;
}

const WhatsNewContext = createContext<WhatsNewContextValue>({ unreadCount: 0, open: false, toggle: () => {} });

/** Read the panel's state from anywhere inside the sidebar (logo, foot button). */
export function useWhatsNew(): WhatsNewContextValue {
  return useContext(WhatsNewContext);
}

/**
 * The sparkle button in the sidebar foot.
 *
 * With something unread the sparkle turns from a grey outline into a solid
 * amber one, and a single glint sweeps across it the moment it lights up.
 * Nothing loops and there is no badge. Seen everything: back to the outline.
 */
export function WhatsNewButton() {
  const { t } = useTranslation('layout');
  const { unreadCount, open, toggle } = useWhatsNew();
  const label = t('whatsNew.title', "What's new");
  const live = unreadCount > 0;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={cn(
        'sidebar-foot-link whatsnew-btn group relative p-2.5 rounded-lg transition-all',
        open ? 'text-accent-text bg-surface-800/60' : 'hover:bg-surface-800/60',
        live ? 'text-accent-text hover:text-accent-text-hover whatsnew-live' : 'text-surface-500 hover:text-accent-text-hover'
      )}
      title={label}
      aria-label={live ? t('whatsNew.buttonUnread', "What's new, {{count}} unread", { count: unreadCount }) : label}
    >
      <Sparkles className="whatsnew-icon w-4 h-4" fill={live ? 'currentColor' : 'none'} />
    </button>
  );
}

/**
 * Owns the What's new state and renders the floating card or panel through a
 * portal. Wrap the sidebar in it, then use `useWhatsNew` or `WhatsNewButton`.
 */
export function WhatsNewProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('layout');
  const reduce = useReducedMotion();
  const { data, isError } = useAnnouncements();
  const { data: telemetry } = useTelemetry();
  const refresh = useRefreshAnnouncements();

  const [view, setView] = useState<View>('closed');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [seen, setSeen] = useState<string[]>(() => readList(SEEN_KEY));
  // The ids that were unread when the panel opened, so they keep their "New"
  // marker for the rest of this viewing even though they are now recorded.
  const [freshOnOpen, setFreshOnOpen] = useState<Set<string>>(() => new Set());
  const autoOpenChecked = useRef(false);

  const items = useMemo(() => data?.items ?? [], [data]);
  const unread = useMemo(() => items.filter((i) => !seen.includes(i.id)), [items, seen]);
  const top = items[0];

  const markSeen = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const next = Array.from(new Set([...seen, ...ids]));
      setSeen(next);
      writeList(SEEN_KEY, next);
    },
    [seen]
  );

  /**
   * The single-card teaser: just the newest item, like a launch toast.
   * Showing it counts everything current as seen, so the logo signal means
   * "something arrived since you last looked" rather than lingering.
   */
  const showTeaser = useCallback(() => {
    setFreshOnOpen(new Set(unread.map((i) => i.id)));
    setExpandedId(null);
    // With nothing published there is no card to tease; open the panel so
    // the click still does something and the empty state explains itself.
    setView(items.length > 0 ? 'teaser' : 'panel');
    markSeen(items.map((i) => i.id));
  }, [unread, items, markSeen]);

  /** The full list. `focus` is the card to open expanded, if any. */
  const showPanel = useCallback(
    (focus: string | null = null) => {
      setFreshOnOpen((prev) => (prev.size > 0 ? prev : new Set(unread.map((i) => i.id))));
      setExpandedId(focus);
      setView('panel');
      markSeen(items.map((i) => i.id));
    },
    [unread, items, markSeen]
  );

  const close = useCallback(() => {
    setView('closed');
    setExpandedId(null);
  }, []);

  // Auto-show the teaser once per pinned announcement, and never on top of
  // the telemetry notice.
  useEffect(() => {
    if (autoOpenChecked.current || !data || !telemetry) return;
    if (telemetry.enabled && !telemetry.noticeSeen) return;
    autoOpenChecked.current = true;

    const autoOpened = readList(AUTO_OPENED_KEY);
    const trigger = items.find((i) => i.pinned && !seen.includes(i.id) && !autoOpened.includes(i.id));
    if (!trigger) return;

    writeList(AUTO_OPENED_KEY, [...autoOpened, trigger.id]);
    const timer = window.setTimeout(showTeaser, 1200);
    return () => window.clearTimeout(timer);
  }, [data, telemetry, items, seen, showTeaser]);

  // Escape closes; the page keeps scrolling underneath since this is a
  // popover, not a modal.
  useEffect(() => {
    if (view === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view, close]);

  const label = t('whatsNew.title', "What's new");
  const offline = Boolean(data && data.remote.enabled && data.remote.lastError && !data.remote.lastFetchedAt);
  const open = view !== 'closed';

  const closeButton = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        close();
      }}
      className="rounded-full bg-surface-950/60 p-1.5 text-surface-300 backdrop-blur transition-colors hover:bg-surface-950/90 hover:text-surface-50"
      aria-label={t('whatsNew.close', 'Close')}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );

  const toggle = useCallback(() => (open ? close() : showTeaser()), [open, close, showTeaser]);
  const ctx = useMemo(() => ({ unreadCount: unread.length, open, toggle }), [unread.length, open, toggle]);

  return (
    <WhatsNewContext.Provider value={ctx}>
      {children}

      {createPortal(
        <AnimatePresence>
          {view === 'teaser' && top && (
            <motion.div
              key="teaser"
              role="dialog"
              aria-label={label}
              initial={reduce ? { opacity: 1 } : { opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="fixed inset-x-3 bottom-3 z-[61] sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[360px]"
            >
              <Card
                item={top}
                unread={freshOnOpen.has(top.id)}
                expanded={false}
                onExpand={() => showPanel(top.id)}
                corner={closeButton}
                className="shadow-2xl shadow-black/50"
              />
            </motion.div>
          )}

          {view === 'panel' && (
            <>
              {/* Click-away layer. Transparent so the page stays readable. */}
              <div key="scrim" className="fixed inset-0 z-[60]" onClick={close} aria-hidden="true" />
              <motion.div
                key="panel"
                role="dialog"
                aria-label={label}
                initial={reduce ? { opacity: 1 } : { opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
                transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                className={cn(
                  'fixed z-[61] flex flex-col overflow-hidden rounded-t-2xl border border-surface-700/80 bg-surface-900/95 shadow-2xl shadow-black/40 backdrop-blur',
                  // Phone: bottom sheet. Desktop: floats bottom-right, clear of the page.
                  'inset-x-0 bottom-0 max-h-[80vh]',
                  'sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px] sm:max-h-[min(78vh,720px)] sm:rounded-[22px]'
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
                      {t('whatsNew.offline', 'Announcements could not be fetched. Check back later.')}
                    </p>
                  )}

                  {items.map((item) => (
                    <Card
                      key={item.id}
                      item={item}
                      unread={freshOnOpen.has(item.id)}
                      expanded={expandedId === item.id}
                      onExpand={() => setExpandedId(item.id)}
                      onCollapse={() => setExpandedId(null)}
                    />
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
                      ? t('whatsNew.disabledByEnv', 'Announcements are off for this container (TELEMETRY_ENABLED=false).')
                      : t('whatsNew.disabled', 'Announcements are off because the anonymous install count is off. Turn it on under Settings → Privacy to receive them.')}
                  </footer>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </WhatsNewContext.Provider>
  );
}
