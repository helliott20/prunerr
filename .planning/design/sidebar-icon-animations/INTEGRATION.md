# Wiring the animated icons into Prunerr

Three steps. Nothing outside the Menu list changes, and no new state, props or
dependencies are introduced.

## 1. Add the files

- `client/src/components/Layout/NavIcons.tsx` (from `handoff/NavIcons.tsx`)
- Append `handoff/navIcons.css` to the end of `client/src/index.css`

## 2. Swap the nav icons in `Sidebar.tsx`

The eight Menu icons come from `NavIcons` instead of `lucide-react`. Every other
lucide import in the file stays exactly as it is — `Scissors`, `Sparkles`, `X`,
`Github`, `MessageCircle`, `Container`, `Globe`, `Sun`, `Moon`.

```diff
-import {
-  LayoutDashboard,
-  Library,
-  Layers,
-  ListFilter,
-  Trash2,
-  History,
-  Activity,
-  Settings,
-  Scissors,
+import {
+  Scissors,
   Sparkles,
   X,
   Github,
   MessageCircle,
   Container,
   Globe,
   Sun,
   Moon,
 } from 'lucide-react';
+import {
+  DashboardIcon,
+  LibraryIcon,
+  CollectionsIcon,
+  RulesIcon,
+  QueueIcon,
+  HistoryIcon,
+  ActivityIcon,
+  SettingsIcon,
+} from './NavIcons';
```

Then the `navItems` icon references:

```diff
   const navItems = [
-    { id: 'dashboard', label: t('nav.dashboard', 'Dashboard'), href: '/', icon: LayoutDashboard },
-    { id: 'library', label: t('nav.library', 'Library'), href: '/library', icon: Library },
-    { id: 'collections', label: t('nav.collections', 'Collections'), href: '/collections', icon: Layers },
-    { id: 'rules', label: t('nav.rules', 'Rules'), href: '/rules', icon: ListFilter },
-    { id: 'queue', label: t('nav.queue', 'Queue'), href: '/queue', icon: Trash2 },
-    { id: 'history', label: t('nav.history', 'History'), href: '/history', icon: History },
-    { id: 'activity', label: t('nav.activity', 'Activity'), href: '/activity', icon: Activity },
-    { id: 'settings', label: t('nav.settings', 'Settings'), href: '/settings', icon: Settings },
+    { id: 'dashboard', label: t('nav.dashboard', 'Dashboard'), href: '/', icon: DashboardIcon },
+    { id: 'library', label: t('nav.library', 'Library'), href: '/library', icon: LibraryIcon },
+    { id: 'collections', label: t('nav.collections', 'Collections'), href: '/collections', icon: CollectionsIcon },
+    { id: 'rules', label: t('nav.rules', 'Rules'), href: '/rules', icon: RulesIcon },
+    { id: 'queue', label: t('nav.queue', 'Queue'), href: '/queue', icon: QueueIcon },
+    { id: 'history', label: t('nav.history', 'History'), href: '/history', icon: HistoryIcon },
+    { id: 'activity', label: t('nav.activity', 'Activity'), href: '/activity', icon: ActivityIcon },
+    { id: 'settings', label: t('nav.settings', 'Settings'), href: '/settings', icon: SettingsIcon },
   ];
```

The render call is unchanged — the components take the same `className`:

```tsx
<item.icon className={cn(
  'w-5 h-5 transition-colors',
  isActive ? 'text-accent-text' : 'text-surface-500 group-hover:text-surface-300'
)} />
```

## 3. Nothing to do for the footer links

The Globe / GitHub / Docker / Unraid / theme icons in the prototype animate the
same way, but their buttons have no `group` class today. If you want those too,
add `group` to each footer `<a>`/`<button>` and move them into `NavIcons.tsx`
following the same pattern — say the word and I'll write that file as well.

## Notes

- **Why not animate the lucide components directly?** `lucide-react` renders the
  paths for you, so there is no handle on the individual rect/path/circle that
  each animation moves. The geometry in `NavIcons.tsx` is copied verbatim from
  lucide 0.562 (matching your pinned `^0.562.0`), so the icons are identical at
  rest — only the parts are addressable.
- **Cost:** transform and opacity only, so every animation is compositor-driven.
  No layout, no paint, and nothing that fights the `.nav-animating` /
  `.page-animating` backdrop-filter suspension in `index.css`.
- **`:active` on iOS:** Safari only applies `:active` on touch when the element
  or an ancestor has a touch handler. The rows already have `onClick`
  (`handleNavClick`), so this works — worth a device check anyway.
- **Haptics:** if you want the press to tick on mobile, call your existing
  `lib/haptics.ts` helper from `handleNavClick`.
