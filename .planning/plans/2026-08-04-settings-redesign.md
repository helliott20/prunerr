# Settings Page Redesign Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Panel tasks (4–8) are built in parallel by one agent each; they share the contracts defined in Task 1–3, which land first.

**Goal:** Replace the 2,479-line single-scroll `Settings.tsx` with a six-category page — persistent rail, live search, staged save, status chips, mobile list→detail, and a real first-run state — matching the design handoff, while preserving the Jellyfin/Emby media-server work on this branch.

**Architecture:** `Settings.tsx` becomes a thin shell owning navigation, search, draft state and saving. Each category is a self-contained panel component under `Settings/panels/`, receiving a single `PanelProps` contract. Shared visual atoms (toggle, segmented control, status dot, section header, empty state) live in `Settings/components/` so six panels can be built independently without style drift.

**Tech Stack:** React 18 + TypeScript + Vite + TailwindCSS, `@tanstack/react-query` (existing `useApi` hooks), `framer-motion`, `lucide-react`, `react-i18next` (`settings` namespace).

## Global Constraints

- **Reference design:** `<scratchpad>/settings-redesign/design_handoff_settings_redesign/README.md` — the authority on layout, spacing, colour and copy. `Prunerr Settings.dc.html` is the visual prototype (serve it over HTTP; `file:` is blocked in Playwright).
- **Fidelity: high.** Recreate pixel-closely. Layout numbers are px and map to Tailwind's 4px scale (`14px ≈ p-3.5`, `16px = p-4`, `18px ≈ px-[18px]`).
- **Never hardcode copy.** All strings via `useTranslation('settings')`. Every key used by a panel is defined in Task 3 — if a key is missing, add it to **all seven** locales (`en, de, es, fr, it, nl, pt`), never to `en` alone.
- **Never hardcode hex.** Use Tailwind tokens (`surface-*`, `accent-*`, `accent-text`, `ruby`, `emerald`, `violet`, `cyan`) so light mode keeps working. Mapping table: handoff README § Design tokens.
- **Type scale:** Outfit (`font-display`) headings/numerals · DM Sans (`font-sans`) body · JetBrains Mono (`font-mono`) URLs, keys, times, counts. Nothing below 10px.
- **Radii:** 999px pills · 14px cards · 12px inset · 11px inputs/rail items · 10px small buttons · 9px chips · 5px checkbox.
- **Media server is not "Plex".** This branch supports Plex/Jellyfin/Emby. Wherever the design says "Plex", render the *selected backend's* name from `mediaServer.name`. Existing backend-aware keys already exist: `mediaServer.*`, `watchHistory.providers.mediaServer.*`, `libraryExclusions.*`.
- **No behaviour regressions.** Every capability in today's `Settings.tsx` must survive: test-connection states, Unraid API-key helper, exclusion-pattern editor, library exclusions, webhooks CRUD + test, Discord test, API-key reveal/copy/regenerate, backup export/import, display preferences, haptics, notification language.
- **Accessibility:** all hit targets ≥44px on mobile; toggles are `<button role="switch" aria-checked>`; rail is a `<nav>`; panels get `aria-labelledby`.
- **Reduced motion:** all framer-motion transitions disabled under `prefers-reduced-motion`.

---

## File Structure

```
client/src/components/Settings/
  Settings.tsx                  # shell: header, chips, rail, search, save pill, mobile nav  (Task 2)
  settingsNav.ts                # category + sub-item metadata, search keywords             (Task 1)
  types.ts                      # PanelProps, CategoryId, DraftState contracts             (Task 1)
  useSettingsDraft.ts           # staged-edit state, dirty counting, save/discard           (Task 2)
  components/
    Toggle.tsx                  # 42x24 desktop / 48x28 mobile switch                       (Task 1)
    SegmentedControl.tsx        # generic segmented picker                                  (Task 1)
    StatusDot.tsx               # 5/7px health dot                                          (Task 1)
    SettingsCard.tsx            # 14px-radius card idiom used by every panel                (Task 1)
    PanelSection.tsx            # H2 + description + anchor id for rail jump-to             (Task 1)
    SettingsEmptyState.tsx      # dashed first-run empty state idiom                         (Task 1)
  panels/
    ConnectionsPanel.tsx        # media server, Sonarr/Radarr, watch history, Seerr, Unraid (Task 4)
    AutomationPanel.tsx         # library sync, scan schedule, disk pressure                (Task 5)
    SafetyPanel.tsx             # library exclusions, exclusion patterns, protection stats  (Task 6)
    AlertsPanel.tsx             # Discord, outbound webhooks, notification language         (Task 7)
    InterfacePanel.tsx          # display preferences, haptics                              (Task 8)
    SystemPanel.tsx             # API key, backup & restore, version                        (Task 8)
```

Sub-components that only one panel uses (e.g. `WebhookRow`, `ExclusionPatternRow`, `UnraidHelper`) live inside that panel's file until it exceeds ~400 lines, then move to `panels/<name>/`.

---

## Task 1: Contracts and shared atoms

**Files:**
- Create: `client/src/components/Settings/types.ts`
- Create: `client/src/components/Settings/settingsNav.ts`
- Create: `client/src/components/Settings/components/{Toggle,SegmentedControl,StatusDot,SettingsCard,PanelSection,SettingsEmptyState}.tsx`
- Test: `client/src/components/Settings/components/__tests__/Toggle.test.tsx`, `SegmentedControl.test.tsx`

**Interfaces produced** — every panel task consumes these verbatim:

```ts
// types.ts
export type CategoryId = 'connections' | 'automation' | 'safety' | 'alerts' | 'interface' | 'system';

/** A single staged edit surface. Panels never write to the server directly. */
export interface PanelProps {
  /** Merged view: saved settings with staged edits applied. */
  draft: Partial<SettingsType>;
  /** Stage one leaf change. Increments the dirty counter in the shell. */
  onChange: <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => void;
  /** Stage a nested service credential, e.g. setService('sonarr', 'url', '...'). */
  onServiceChange: (service: ServiceKeyType, field: ServiceField, value: string) => void;
  /** True when no service has both a URL and a credential. Drives first-run copy. */
  fresh: boolean;
  /** Selected media server: type, display name, config namespace. */
  mediaServer: { type: MediaServerType; name: string; configKey: 'plex' | 'jellyfin' };
  /** Per-service connection-test state, keyed by ServiceKeyType. */
  testResults: Record<string, { status: 'success' | 'error' | 'loading'; message?: string }>;
  runTest: (service: ServiceKeyType) => Promise<void>;
  /** Registers a sub-section node so the rail can scroll to it. */
  registerSection: (id: string, node: HTMLElement | null) => void;
}
```

```ts
// settingsNav.ts
export interface NavSubItem { id: string; labelKey: string }
export interface NavCategory {
  id: CategoryId;
  labelKey: string;
  icon: LucideIcon;
  subItems: NavSubItem[];
  /** Extra search terms beyond label + sub-item names, e.g. 'grace reclaim observe'. */
  keywords: string;
}
export const SETTINGS_NAV: NavCategory[];
/** Case-insensitive match over label, sub-item labels and keywords. */
export function matchesQuery(category: NavCategory, query: string, t: TFunction): boolean;
```

Component signatures:

```tsx
export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; size?: 'sm' | 'lg'; disabled?: boolean }): JSX.Element;
export function SegmentedControl<T extends string>(props: { value: T | null; options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>; onChange: (v: T) => void; ariaLabel: string }): JSX.Element;
export function StatusDot(props: { state: 'healthy' | 'failed' | 'required-unset' | 'optional-unset'; size?: 5 | 7 }): JSX.Element;
export function SettingsCard(props: { children: ReactNode; tone?: 'default' | 'failing'; className?: string }): JSX.Element;
export function PanelSection(props: { id: string; title: string; description?: string; action?: ReactNode; register: PanelProps['registerSection']; children: ReactNode }): JSX.Element;
export function SettingsEmptyState(props: { title: string; body: string; action?: ReactNode }): JSX.Element;
```

- [ ] **Step 1:** Write `Toggle.test.tsx` — asserts `role="switch"`, `aria-checked` reflects `checked`, click calls `onChange` with the negation, `disabled` suppresses the call, and `size="lg"` renders the 48×28 track class.
- [ ] **Step 2:** Write `SegmentedControl.test.tsx` — asserts one `role="radio"` per option, `aria-checked` on the selected one, `value={null}` selects nothing (first-run), clicking calls `onChange`, `disabled` options don't fire and expose `title`.
- [ ] **Step 3:** Run `npm run test --workspace=client` — both files FAIL (modules not found).
- [ ] **Step 4:** Implement `types.ts` and `settingsNav.ts` exactly as specified above. Category order is fixed: connections, automation, safety, alerts, interface, system. Icons: `Plug`, `Clock`, `ShieldCheck`, `Bell`, `Palette`, `KeyRound`.
- [ ] **Step 5:** Implement the six atoms. Toggle: track `h-6 w-[42px] rounded-full`, off `bg-surface-600`, on `bg-accent-500`, 18px knob inset 3px, `transition-[background-color,transform] duration-[180ms]`; `size="lg"` → `h-7 w-12` with 22px knob.
- [ ] **Step 6:** Run `npm run test --workspace=client` — PASS.
- [ ] **Step 7:** Commit: `git add client/src/components/Settings && git commit -m "feat(settings): add redesign contracts and shared atoms"`

---

## Task 2: Shell — rail, search, staged save, mobile nav

**Files:**
- Modify: `client/src/components/Settings/Settings.tsx` (replaced wholesale; old body preserved in git history)
- Create: `client/src/components/Settings/useSettingsDraft.ts`
- Test: `client/src/components/Settings/__tests__/useSettingsDraft.test.ts`

**Interfaces produced:**

```ts
export function useSettingsDraft(saved: Partial<SettingsType> | undefined): {
  draft: Partial<SettingsType>;
  dirtyCount: number;                  // number of changed leaf fields
  set: PanelProps['onChange'];
  setService: PanelProps['onServiceChange'];
  discard: () => void;
  markSaved: () => void;
};
```

Behaviour, from handoff § Interactions:
- Category switch is instant and resets `panelRef.current.scrollTop = 0`. Staged edits survive the switch.
- Sub-item click sets `panelRef.current.scrollTop = node.offsetTop - 16`. **Never `scrollIntoView`.**
- Search narrows the rail only — it never changes the panel. `⌘K`/`Ctrl+K` focuses it. No matches → hint line with the three example terms.
- Active category persists in the URL as `/settings?section=automation`.
- Save pill renders only when `dirtyCount > 0`, fixed `right-7 bottom-[22px]`.
- Below `lg`, the rail is replaced by the mobile list→detail pattern with a sticky Cancel/Save bar — not a shrunken rail.

- [ ] **Step 1:** Write `useSettingsDraft.test.ts` — staging a change raises `dirtyCount` to 1; staging the same field twice keeps it at 1; staging back to the saved value returns it to 0; `discard()` empties the draft; `markSaved()` rebases onto the new saved payload; a `saved` payload arriving while edits are staged does not clobber them.
- [ ] **Step 2:** Run `npm run test --workspace=client -- useSettingsDraft` — FAIL.
- [ ] **Step 3:** Implement `useSettingsDraft.ts`.
- [ ] **Step 4:** Run the test — PASS.
- [ ] **Step 5:** Implement the shell: page header (eyebrow, H1, three live status chips from `useHealthStatus`/`useStats`/`useUnraidStats`), rail, panel container, save pill, mobile list/detail. Panels render as `<Suspense>`-free direct imports. Derive `fresh` per handoff § First-run: no service has both a URL and a credential.
- [ ] **Step 6:** Run `npm run build:client` — clean.
- [ ] **Step 7:** Commit: `git commit -m "feat(settings): add shell with rail, search and staged save"`

---

## Task 3: Locale keys for all seven languages

**Files:** Modify `client/src/locales/{en,de,es,fr,it,nl,pt}/settings.json`

Adds the key groups the redesign introduces — `header.eyebrow`, `nav.*` (six categories + sub-items), `search.*`, `chips.*`, `firstRun.*`, `connections.*`, `automation.*`, `safety.*`, `alerts.*`, `system.*` — while keeping every existing key, since panels reuse `services.*`, `watchHistory.*`, `webhooks.*`, `diskPressure.*`, `apiKey.*`, `backup.*`, `display.*`, `haptics.*`, `unraidHelper.*`, `savePill.*` unchanged.

- [ ] **Step 1:** Add the new groups to `en/settings.json`, using the exact copy from the handoff README.
- [ ] **Step 2:** Mirror the structure into the other six locales with real translations (not English placeholders).
- [ ] **Step 3:** Run `npm run i18n:check` — no missing keys in any locale.
- [ ] **Step 4:** Commit: `git commit -m "i18n(settings): add redesign copy across all locales"`

---

## Tasks 4–8: The six panels (parallel)

Each panel task is independent: it creates exactly one file (Task 8 creates two), consumes `PanelProps` from Task 1, uses only keys from Task 3, and must not modify the shell, another panel, or any locale file. Layout, spacing, colour and copy come from the named handoff section — read it before writing code.

Common acceptance criteria for every panel:
1. `npx tsc --noEmit -p client` clean.
2. Renders correctly in both the configured and first-run states (`fresh` true/false).
3. No hex literals, no hardcoded English, no `scrollIntoView`.
4. Every sub-section wrapped in `<PanelSection id="…" register={registerSection}>` so the rail can jump to it.
5. Light mode is not broken — check with `data-theme="light"` on the root.

### Task 4: ConnectionsPanel — handoff § "Panel: Connections"
Sub-sections: `media-server`, `sonarr-radarr`, `watch-history`, `overseerr`, `unraid`.
**This is the panel that reconciles the design with the branch.** The design's fixed Plex card becomes a **Media server** card: `SegmentedControl` over Plex/Jellyfin/Emby (from `MEDIA_SERVER_OPTIONS` in the current `Settings.tsx:102`), credential field following the choice (token for Plex, API key for Jellyfin/Emby), and card title/notes using `mediaServer.name`. Switching backend clears that backend's prior test verdict. Service grid stays `grid-cols-2` with Sonarr, Radarr, Seerr, Unraid; the Unraid API-key helper (`unraidHelper.*`) becomes a disclosure inside the Unraid card. Watch-history row: segmented control whose first option is labelled `"{{name}} direct"` for the selected backend.
**Also fix here (agreed separately):** Tautulli and Tracearr only resolve Plex-format item ids, so when `mediaServer.type !== 'plex'` those two options render `disabled` with a `title` explaining they need Plex — the user cannot silently select a provider that reports every item as unwatched.

### Task 5: AutomationPanel — handoff § "Panel: Automation"
Sub-sections: `library-sync`, `scan-schedule`, `disk-pressure`. Two cards: Scanning (toggle, 3-up Select/time Input grid, weekly day-of-week field when `interval === 'weekly'`, hourly hint, auto-process-queue sub-row) and Disk pressure (toggle, gauge block with amber fill + 2px ruby critical marker, 4-up numeric knob grid, violet observe-only row). "Plex sync" label uses `mediaServer.name`.

### Task 6: SafetyPanel — handoff § "Panel: Safety"
Sub-sections: `library-exclusions`, `exclusion-patterns`. Two-column: content + 264px right column ("Protected right now", "Effect of current rules"). Library exclusions is a 2-col checkbox grid over `useLibraries`; unchecked rows dim. Exclusion patterns keep the existing add/edit/delete editor, restyled as cyan field pill + operator + mono value + hit count. First run: both empty states plus `—`/`0` stats.

### Task 7: AlertsPanel — handoff § "Panel: Alerts"
Sub-sections: `discord`, `webhooks`, `language`. Discord card (toggle, URL field, Send test, seven wrapping event chips from `webhooks.events.*`), outbound webhooks list (health dot, mono URL, per-row meta, failing rows tinted ruby, add/edit/delete/test preserved), notification-language `Select` and the scan-notification radio group.

### Task 8: InterfacePanel + SystemPanel — handoff §§ "Panel: Interface", "Panel: System"
Interface: three `SegmentedControl` rows (date format, time format, file size unit) via `useDisplayPreferences`, plus the haptics toggle (stays `localStorage`, not a server setting). System: API key card (masked mono field, Reveal/Copy/Regenerate with the existing confirm modal and toast), Backup & restore (Export primary, Import with existing confirm modal), version row from `useVersion`.

---

## Task 9: Integration, mobile and verification

**Files:** Modify `Settings.tsx` (wire panels), `client/src/components/Settings/panels/*` (fixes only)

- [ ] **Step 1:** Import all six panels into the shell; confirm each category renders and the rail's sub-item jump lands on the right section.
- [ ] **Step 2:** Verify the mobile treatment at 390px: list screen with search + three status tiles + six category rows, detail screens with back chevron and sticky Cancel/Save bar, all targets ≥44px.
- [ ] **Step 3:** Exercise the first-run state by pointing at an unconfigured DB; confirm no optional service is styled as an error.
- [ ] **Step 4:** Run `npm run test --workspace=server && npm run test --workspace=client && npm run build && npm run i18n:check` — all clean.
- [ ] **Step 5:** Drive the real page with Playwright at 1600px and 390px, both themes; confirm zero console errors and capture screenshots against the prototype.
- [ ] **Step 6:** Commit: `git commit -m "feat(settings): wire panels into redesigned shell"`

---

## Verification Commands

```bash
npm run test --workspace=server     # expect 167 passing
npm run test --workspace=client
npm run build                       # server tsc + client vite
npm run i18n:check                  # no missing keys in any of 7 locales
```

Dev loop: `npm run dev` → UI http://localhost:5173, API http://localhost:3000.
Prototype for visual comparison: serve the handoff directory over HTTP (`python -m http.server 8899`) — Playwright blocks `file:`.
