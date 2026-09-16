import type { SVGProps } from 'react';

/**
 * Animated nav icons for the sidebar.
 *
 * These replace the lucide-react components for the eight Menu items. The
 * geometry is lucide 0.562 verbatim — the only addition is a per-path
 * transform driven by the `--h` custom property, which navIcons.css flips
 * from 0 to 1 on `.group:hover` / `.group:active` / `:focus-visible`.
 *
 * Because `--h` inherits, hover state needs no React state: the row's own
 * `group` class does the work, the transforms interpolate, and
 * `prefers-reduced-motion` can switch every icon off in one CSS rule.
 *
 * Drop-in compatible with the current call site:
 *   <item.icon className={cn('w-5 h-5 transition-colors', ...)} />
 */

type IconProps = SVGProps<SVGSVGElement>;

const SPRING = 'cubic-bezier(0.34, 1.4, 0.64, 1)';

/** transform transition, optionally staggered */
const t = (ms: number, delay = 0) => ({
  transition: `transform ${ms}ms ${SPRING} ${delay}ms`,
});

/** local bounding box, so scale/translate read relative to the part itself */
const fillBox = { transformBox: 'fill-box', transformOrigin: 'center' } as const;
const fromBottom = { transformBox: 'fill-box', transformOrigin: 'bottom' } as const;
/** viewBox coordinates, for rotations that need a specific centre */
const atCenter = { transformBox: 'view-box', transformOrigin: '12px 12px' } as const;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      {...props}
      className={['nav-anim', props.className].filter(Boolean).join(' ')}
    >
      {children}
    </svg>
  );
}

/** Info — the stem draws up from the dot and the ring breathes outward. */
export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10"
        style={{ ...t(420), ...atCenter, transform: 'scale(calc(1 + var(--h, 0) * 0.08))' }} />
      <path d="M12 16v-4"
        style={{ ...t(440, 60), ...fromBottom, transform: 'scaleY(calc(1 + var(--h, 0) * 0.28))' }} />
      <path d="M12 8h.01"
        style={{ ...t(420, 120), ...fillBox, transform: 'translateY(calc(var(--h, 0) * -0.9px))' }} />
    </Svg>
  );
}

/** List tree — the branches reach further right, one after the other. */
export function EpisodesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5h13"
        style={{ ...t(400), transform: 'translateX(calc(var(--h, 0) * 1.4px))' }} />
      <path d="M13 12h8"
        style={{ ...t(400, 70), transform: 'translateX(calc(var(--h, 0) * 1.4px))' }} />
      <path d="M13 19h8"
        style={{ ...t(400, 140), transform: 'translateX(calc(var(--h, 0) * 1.4px))' }} />
      <path d="M3 10a2 2 0 0 0 2 2h3"
        style={{ ...t(420, 70), ...fillBox, transform: 'scaleX(calc(1 + var(--h, 0) * 0.12))' }} />
      <path d="M3 5v12a2 2 0 0 0 2 2h3"
        style={{ ...t(420, 140), ...fillBox, transform: 'scaleX(calc(1 + var(--h, 0) * 0.12))' }} />
    </Svg>
  );
}

/** Dashboard — the four tiles fan outward from the centre, staggered. */
export function DashboardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect width="7" height="9" x="3" y="3" rx="1"
        style={{ ...t(420), transform: 'translate(calc(var(--h, 0) * -0.8px), calc(var(--h, 0) * -0.8px))' }} />
      <rect width="7" height="5" x="14" y="3" rx="1"
        style={{ ...t(420, 55), transform: 'translate(calc(var(--h, 0) * 0.8px), calc(var(--h, 0) * -0.8px))' }} />
      <rect width="7" height="9" x="14" y="12" rx="1"
        style={{ ...t(420, 110), transform: 'translate(calc(var(--h, 0) * 0.8px), calc(var(--h, 0) * 0.8px))' }} />
      <rect width="7" height="5" x="3" y="16" rx="1"
        style={{ ...t(420, 165), transform: 'translate(calc(var(--h, 0) * -0.8px), calc(var(--h, 0) * 0.8px))' }} />
    </Svg>
  );
}

/** Library — the shelf rises in a wave; the leaning book lifts out. */
export function LibraryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m16 6 4 14"
        style={{ ...t(440, 150), ...fromBottom, transform: 'translateY(calc(var(--h, 0) * -1.6px))' }} />
      <path d="M12 6v14"
        style={{ ...t(440, 100), ...fromBottom, transform: 'scaleY(calc(1 + var(--h, 0) * 0.16))' }} />
      <path d="M8 8v12"
        style={{ ...t(440, 50), ...fromBottom, transform: 'scaleY(calc(1 - var(--h, 0) * 0.12))' }} />
      <path d="M4 4v16"
        style={{ ...t(440), ...fromBottom, transform: 'scaleY(calc(1 + var(--h, 0) * 0.1))' }} />
    </Svg>
  );
}

/** Collections — the three layers separate. */
export function CollectionsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"
        style={{ ...t(420), transform: 'translateY(calc(var(--h, 0) * -1.8px))' }} />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"
        style={{ ...t(420, 60), transform: 'translateY(calc(var(--h, 0) * 0.3px))' }} />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"
        style={{ ...t(420, 120), transform: 'translateY(calc(var(--h, 0) * 1.4px))' }} />
    </Svg>
  );
}

/** Rules — the filter lines shuffle as if re-sorting. */
export function RulesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 5h20"
        style={{ ...t(400), ...fillBox, transform: 'scaleX(calc(1 - var(--h, 0) * 0.08))' }} />
      <path d="M6 12h12"
        style={{ ...t(400, 70), ...fillBox, transform: 'translateX(calc(var(--h, 0) * 2.4px))' }} />
      <path d="M9 19h6"
        style={{ ...t(400, 140), ...fillBox, transform: 'translateX(calc(var(--h, 0) * -2.4px))' }} />
    </Svg>
  );
}

/** Queue — the lid swings open and the contents sink. */
export function QueueIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <g style={{
        ...t(460),
        transformBox: 'view-box',
        transformOrigin: '4px 6px',
        transform: 'rotate(calc(var(--h, 0) * -17deg)) translateY(calc(var(--h, 0) * -0.7px))',
      }}>
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </g>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6"
        style={{ ...t(420, 80), ...fromBottom, transform: 'scaleY(calc(1 - var(--h, 0) * 0.32))' }} />
      <path d="M14 11v6"
        style={{ ...t(420, 150), ...fromBottom, transform: 'scaleY(calc(1 - var(--h, 0) * 0.32))' }} />
    </Svg>
  );
}

/** History — the hand rewinds and the arrow pulls back. */
export function HistoryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5"
        style={{ ...t(420), transform: 'translate(calc(var(--h, 0) * -1px), calc(var(--h, 0) * -1px))' }} />
      <path d="M12 7v5l4 2"
        style={{ ...t(560), ...atCenter, transform: 'rotate(calc(var(--h, 0) * -50deg))' }} />
    </Svg>
  );
}

const PULSE = 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2';

/** Activity — the trace stretches while a highlight sweeps along it. */
export function ActivityIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <g style={{ ...t(460), ...fillBox, transform: 'scaleY(calc(1 + var(--h, 0) * 0.18))' }}>
        <path d={PULSE} />
        {/* Overlay copy: invisible at rest, so the icon never looks broken.
            navIcons.css only runs the sweep while the row is hovered — a
            dashoffset animation repaints, so leaving it looping at opacity 0
            would cost paint on every frame for nothing. */}
        <path
          d={PULSE}
          className="nav-sweep"
          style={{
            strokeWidth: 2.6,
            strokeDasharray: '9 55',
            opacity: 'calc(var(--h, 0) * 0.9)',
            transition: 'opacity 240ms ease',
          }}
        />
      </g>
    </Svg>
  );
}

/** Settings — the cog turns an eighth turn and the hub swells. */
export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
        style={{ transition: `transform 620ms cubic-bezier(0.34, 1.2, 0.64, 1)`, ...atCenter, transform: 'rotate(calc(var(--h, 0) * 45deg))' }} />
      <circle cx="12" cy="12" r="3"
        style={{ ...t(420, 60), ...fillBox, transform: 'scale(calc(1 + var(--h, 0) * 0.16))' }} />
    </Svg>
  );
}

/* -------------------------------------------------------------------------
   Footer links.

   Same mechanism as the nav icons above — `--h`, flipped by the row's own
   `group` class — so the footer buttons in Sidebar.tsx each need `group`
   adding. The spring is a touch livelier here (1.5 vs 1.4) because these are
   16px rather than 20px, so the same displacement reads as less motion.
   ------------------------------------------------------------------------- */

const FOOTER_SPRING = 'cubic-bezier(0.34, 1.5, 0.64, 1)';

/** transform transition on the footer spring, optionally staggered */
const f = (ms: number, delay = 0, curve = FOOTER_SPRING) => ({
  transition: `transform ${ms}ms ${curve} ${delay}ms`,
});

/** Theme toggle (dark mode) — the rays wheel round and the core swells. */
export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4"
        style={{ ...f(420), ...fillBox, transform: 'scale(calc(1 + var(--h, 0) * 0.22))' }} />
      <g style={{ ...f(620, 0, 'cubic-bezier(0.34, 1.2, 0.64, 1)'), ...atCenter, transform: 'rotate(calc(var(--h, 0) * 60deg))' }}>
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </g>
    </Svg>
  );
}

/** Website — the meridian flattens, which reads as the globe turning. */
export function GlobeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"
        style={{ ...f(560, 0, 'cubic-bezier(0.34, 1.3, 0.64, 1)'), ...fillBox, transform: 'scaleX(calc(1 - var(--h, 0) * 0.62))' }} />
      <path d="M2 12h20" />
    </Svg>
  );
}

/** GitHub — the cat hops and its tail flicks after it. */
export function GithubIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"
        style={{ ...f(420, 0, 'cubic-bezier(0.34, 1.45, 0.64, 1)'), transform: 'translateY(calc(var(--h, 0) * -1.6px))' }} />
      <path d="M9 18c-4.51 2-5-2-7-2"
        style={{ ...f(460, 60, 'cubic-bezier(0.34, 1.45, 0.64, 1)'), transform: 'translateX(calc(var(--h, 0) * -1.9px))' }} />
    </Svg>
  );
}

/** Unraid support — the bubble swells from its tail. */
export function MessageCircleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"
        style={{
          ...f(460),
          transformBox: 'fill-box',
          transformOrigin: 'bottom left',
          transform: 'scale(calc(1 + var(--h, 0) * 0.16))',
        }} />
    </Svg>
  );
}

/** Docker Hub — the two stacked fins lift out of the container. */
export function ContainerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z" />
      <path d="M10 21.9V14L2.1 9.1" />
      <path d="m10 14 11.9-6.9" />
      <path d="M14 19.8v-8.1"
        style={{ ...f(420, 60), transform: 'translateY(calc(var(--h, 0) * -1.5px))' }} />
      <path d="M18 17.5V9.4"
        style={{ ...f(420), transform: 'translateY(calc(var(--h, 0) * -1.5px))' }} />
    </Svg>
  );
}
