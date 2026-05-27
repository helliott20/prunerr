import { lazy, Suspense } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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
 * AnimatedRoutes wraps the route tree in framer-motion so that navigating
 * between pages crossfades + rises subtly. We key on the first path segment
 * rather than the full pathname so that drilling into a detail page (e.g.
 * /library → /library/123) doesn't trigger the page-level transition.
 * `mode="wait"` lets the outgoing route fully exit before the next enters,
 * and `prefers-reduced-motion` short-circuits the animation for users who
 * have asked the OS to keep things still.
 */
function AnimatedRoutes() {
  const location = useLocation();
  const reduce = useReducedMotion();
  const sectionKey = '/' + (location.pathname.split('/')[1] ?? '');

  const transition = reduce
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={sectionKey}
        initial={reduce ? { opacity: 1 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? { opacity: 1 } : { opacity: 0, y: -4 }}
        transition={transition}
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
    </AnimatePresence>
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
