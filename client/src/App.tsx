import { lazy, Suspense } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import Layout from './components/Layout/Layout';
import Dashboard from './components/Dashboard/Dashboard';
import Library from './components/Library/Library';
import Rules from './components/Rules/Rules';
import Queue from './components/Queue/Queue';
import History from './components/History/History';
import ActivityLog from './components/ActivityLog/ActivityLog';
import Settings from './components/Settings/Settings';
import Recommendations from './components/Recommendations/Recommendations';

const MediaItemDetail = lazy(() => import('./components/Library/MediaItemDetail'));
const Collections = lazy(() => import('./components/Collections/Collections'));
const CollectionDetail = lazy(() => import('./components/Collections/CollectionDetail'));

/**
 * AnimatedRoutes fades each page in as you navigate. We key on the first path
 * segment rather than the full pathname so that drilling into a detail page
 * (e.g. /library → /library/123) doesn't replay the transition.
 *
 * The key change remounts the subtree, so framer-motion plays `initial` →
 * `animate` on every navigation. An earlier version wrapped this in
 * `<AnimatePresence mode="wait">` to cross-fade the outgoing page as well, but
 * that only ever animated the first navigation — every page after it appeared
 * with no transition at all — so the enter animation is now driven by the
 * remount alone, which fires reliably every time.
 *
 * `prefers-reduced-motion` short-circuits the animation for users who have
 * asked the OS to keep things still.
 */
function AnimatedRoutes() {
  const location = useLocation();
  const reduce = useReducedMotion();
  const sectionKey = '/' + (location.pathname.split('/')[1] ?? '');

  return (
    <motion.div
      key={sectionKey}
      // Full height so pages that size themselves against the viewport (the
      // settings shell, whose panel is its own scroll container) have an
      // unbroken percentage-height chain. Taller content still overflows and
      // scrolls in <main> as before.
      className="h-full"
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      onAnimationStart={() => document.documentElement.classList.add('page-animating')}
      onAnimationComplete={() => document.documentElement.classList.remove('page-animating')}
    >
      <Routes location={location}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/library" element={<Library />} />
        <Route path="/library/:id" element={<MediaItemDetail />} />
        <Route path="/recommendations" element={<Recommendations />} />
        <Route path="/collections" element={<Collections />} />
        <Route path="/collections/:id" element={<CollectionDetail />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/history" element={<History />} />
        <Route path="/activity" element={<ActivityLog />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </motion.div>
  );
}

function App() {
  return (
    <Layout>
      <Suspense fallback={<div className="p-6 text-surface-400">Loading...</div>}>
        <AnimatedRoutes />
      </Suspense>
    </Layout>
  );
}

export default App;
