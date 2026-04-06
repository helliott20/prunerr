import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
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

function App() {
  return (
    <Layout>
      <Suspense fallback={<div className="p-6 text-surface-400">Loading...</div>}>
        <Routes>
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
      </Suspense>
    </Layout>
  );
}

export default App;
