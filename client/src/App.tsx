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

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/library" element={<Library />} />
        <Route path="/recommendations" element={<Recommendations />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/history" element={<History />} />
        <Route path="/activity" element={<ActivityLog />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
}

export default App;
