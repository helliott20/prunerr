import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'framer-motion';
import { BookOpen, Link2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/common/Toast';
import { DOC_GUIDES } from './docsContent';

/**
 * In-app documentation: Installation, Configuration and Troubleshooting,
 * shipped with the build so the docs always match the running version.
 *
 * Every section has a stable anchor (/docs#config-from-env), so other screens
 * can deep-link to the exact paragraph that explains them.
 */
export default function Docs() {
  const { t } = useTranslation('docs');
  const { addToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const [query, setQuery] = useState('');
  /** Ids of the sections matching the query, or null when not searching. */
  const [visible, setVisible] = useState<Set<string> | null>(null);
  const [activeId, setActiveId] = useState<string>(DOC_GUIDES[0].sections[0].id);
  const sectionNodes = useRef<Map<string, HTMLElement>>(new Map());
  const suppressSpyUntil = useRef(0);
  /**
   * Lowercased rendered text of each section, so search sees table cells and
   * code blocks too. Built on the first keystroke; the guides are static.
   */
  const searchIndex = useRef<Map<string, string> | null>(null);

  const search = (value: string) => {
    setQuery(value);
    const needle = value.trim().toLowerCase();
    if (!needle) {
      setVisible(null);
      return;
    }
    if (!searchIndex.current) {
      searchIndex.current = new Map();
      sectionNodes.current.forEach((node, id) => searchIndex.current!.set(id, (node.textContent ?? '').toLowerCase()));
    }
    const ids = new Set<string>();
    searchIndex.current.forEach((text, id) => {
      if (text.includes(needle)) ids.add(id);
    });
    setVisible(ids);
  };

  const isShown = (id: string) => !visible || visible.has(id);
  const resultCount = visible?.size ?? 0;

  // --- anchors --------------------------------------------------------------

  const scrollTo = useCallback(
    (id: string, smooth: boolean) => {
      const node = document.getElementById(id);
      if (!node) return;
      // Keep the clicked item marked while the scroll settles; near the end of
      // the page a short section can't reach the top, and the spy would
      // otherwise mark whatever is above it.
      suppressSpyUntil.current = Date.now() + 1000;
      node.scrollIntoView({ block: 'start', behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
      setActiveId(id);
    },
    [reduceMotion]
  );

  // Land on the anchor in the URL. Deferred: the layout resets <main> to the
  // top when a page opens, and that runs after this page's effects.
  const hasScrolled = useRef(false);
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    // On arrival, also wait out the page's enter animation, which shifts
    // everything while it plays. The flag is only set once a scroll has run,
    // so a cancelled first attempt still counts as arriving.
    const arriving = !hasScrolled.current;
    const timer = window.setTimeout(() => {
      hasScrolled.current = true;
      scrollTo(id, !arriving);
    }, arriving ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [location.hash, scrollTo]);

  const jump = (id: string) => {
    // Same anchor again: no navigation happens, so scroll directly. A frame
    // later, so a section un-hidden by clearing the search has a box by then.
    if (location.hash === `#${id}`) requestAnimationFrame(() => scrollTo(id, true));
    else navigate({ hash: id }, { replace: true });
  };

  const copyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/docs#${id}`);
      addToast({ type: 'success', title: t('toast.linkCopied', 'Link copied') });
    } catch {
      addToast({ type: 'error', title: t('toast.copyFailed', 'Couldn’t copy the link') });
    }
  };

  // --- scrollspy ------------------------------------------------------------

  useEffect(() => {
    // Marks the section nearest the top of the viewport. The observer's root
    // is the viewport, which also works for <main>, the actual scroller.
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < suppressSpyUntil.current) return;
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveId(top.target.id);
      },
      { rootMargin: '-80px 0px -65% 0px' }
    );
    sectionNodes.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const activeGuide = DOC_GUIDES.find((g) => g.sections.some((s) => s.id === activeId))?.id;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <header className="relative overflow-hidden rounded-3xl border border-surface-700/50 bg-surface-900/80 px-5 py-6 sm:px-8 sm:py-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-500/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-accent-600/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 shadow-lg shadow-accent-500/20">
              <BookOpen className="h-6 w-6 text-amber-950" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-50 sm:text-3xl">{t('header.title', 'Docs')}</h1>
              <p className="mt-1 max-w-xl text-surface-400">
                {t('header.subtitle', 'Set up Prunerr, connect your services and fix the problems people hit most.')}
              </p>
            </div>
          </div>
          <div className="relative w-full lg:w-80">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder={t('search.placeholder', 'Search the docs…')}
              aria-label={t('search.placeholder', 'Search the docs…')}
              className={cn(
                'w-full rounded-xl border border-surface-600/60 bg-surface-800/70 py-3 pl-10 pr-10',
                // Our own clear button replaces the browser's.
                '[&::-webkit-search-cancel-button]:appearance-none',
                'text-sm text-surface-100 placeholder:text-surface-500',
                'focus:border-accent-500/50 focus:bg-surface-800/95 focus:outline-none'
              )}
            />
            {query && (
              <button
                type="button"
                onClick={() => search('')}
                aria-label={t('search.clear', 'Clear search')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-surface-500 hover:bg-surface-700/60 hover:text-surface-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Guide cards */}
        <div className="relative mt-6 grid gap-2 sm:mt-8 sm:grid-cols-3 sm:gap-3">
          {DOC_GUIDES.map((guide) => (
            <button
              key={guide.id}
              type="button"
              onClick={() => {
                search('');
                jump(guide.sections[0].id);
              }}
              className={cn(
                'group flex items-center gap-3 rounded-2xl border p-3 text-left transition-all duration-200',
                'sm:items-start sm:p-4',
                activeGuide === guide.id
                  ? 'border-accent-500/30 bg-accent-500/[0.08]'
                  : 'border-surface-700/50 bg-surface-800/40 hover:-translate-y-0.5 hover:border-surface-600/70 hover:bg-surface-800/70'
              )}
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                  activeGuide === guide.id
                    ? 'border-accent-500/30 bg-accent-500/15 text-accent-text'
                    : 'border-surface-700/60 bg-surface-900/60 text-surface-400 group-hover:text-accent-text'
                )}
              >
                <guide.icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-surface-100">
                  {guide.title}
                </span>
                <span className="mt-0.5 hidden text-[13px] leading-snug text-surface-400 sm:block">
                  {guide.summary}
                </span>
              </span>
            </button>
          ))}
        </div>
      </header>

      {visible && (
        <p className="text-sm text-surface-400" aria-live="polite">
          {resultCount === 0
            ? t('search.none', 'Nothing matches “{{query}}”.', { query: query.trim() })
            : t('search.count', '{{count}} sections match “{{query}}”', { count: resultCount, query: query.trim() })}
        </p>
      )}

      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        {/* Table of contents */}
        <nav aria-label={t('toc.ariaLabel', 'Docs contents')} className="hidden lg:block">
          <div className="sticky top-8 max-h-[calc(100vh-4rem)] space-y-6 overflow-y-auto pb-8 pt-1">
            {DOC_GUIDES.map((guide) => {
              const sections = guide.sections.filter((s) => isShown(s.id));
              if (sections.length === 0) return null;
              return (
                <div key={guide.id}>
                  <p className="mb-2 flex items-center gap-2 px-3 text-2xs font-semibold uppercase tracking-widest text-surface-500">
                    <guide.icon className="h-3.5 w-3.5" />
                    {guide.title}
                  </p>
                  <ul className="space-y-0.5 border-l border-surface-700/60">
                    {sections.map((section) => (
                      <li key={section.id}>
                        <button
                          type="button"
                          onClick={() => jump(section.id)}
                          className={cn(
                            '-ml-px block w-full border-l-2 py-1.5 pl-3 pr-2 text-left text-[13px] transition-colors',
                            activeId === section.id
                              ? 'border-accent-500 font-medium text-accent-text'
                              : 'border-transparent text-surface-400 hover:border-surface-500 hover:text-surface-100'
                          )}
                        >
                          {section.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </nav>

        {/* Guides */}
        <div className="min-w-0 space-y-12">
          {DOC_GUIDES.map((guide) => {
            const anyShown = guide.sections.some((s) => isShown(s.id));
            return (
              <section key={guide.id} aria-labelledby={`guide-${guide.id}`} hidden={!anyShown}>
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent-500/25 bg-accent-500/10 text-accent-text">
                    <guide.icon className="h-4 w-4" />
                  </span>
                  <h2 id={`guide-${guide.id}`} className="text-xl font-bold text-surface-50">
                    {guide.title}
                  </h2>
                </div>
                <div className="space-y-4">
                  {guide.sections.map((section) => (
                    <article
                      key={section.id}
                      id={section.id}
                      ref={(node) => {
                        if (node) sectionNodes.current.set(section.id, node);
                        else sectionNodes.current.delete(section.id);
                      }}
                      hidden={!isShown(section.id)}
                      className="group/section scroll-mt-20 rounded-2xl lg:scroll-mt-6 border border-surface-700/50 bg-surface-900/80 p-5 backdrop-blur-sm sm:p-6"
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <h3 className="text-[17px] font-semibold text-surface-50">{section.title}</h3>
                        <button
                          type="button"
                          onClick={() => copyLink(section.id)}
                          aria-label={t('section.copyLink', 'Copy link to this section')}
                          title={t('section.copyLink', 'Copy link to this section')}
                          className="rounded-md p-1 text-surface-500 opacity-0 transition-opacity hover:bg-surface-800 hover:text-accent-text focus-visible:opacity-100 group-hover/section:opacity-100"
                        >
                          <Link2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="space-y-4">{section.body}</div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
