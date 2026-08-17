import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginView from './components/LoginView';
import ErrorBoundary from './components/ErrorBoundary';

const DashboardApp = lazy(() => import('./pages/DashboardApp'));
const RoadmapPage = lazy(() => import('./pages/RoadmapPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));

function BootScreen({ label = 'Starting dashboard…' }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-950 p-6">
      <p className="text-center text-sm text-slate-300">{label}</p>
    </div>
  );
}

function ProtectedDashboard() {
  const { isLoading, requiresLogin, error, user } = useAuth();

  if (isLoading) {
    return <BootScreen />;
  }

  if (requiresLogin) {
    return <LoginView />;
  }

  if (!user) {
    return (
      <BootScreen
        label={error || 'Could not start a local session. Close the app and open it again.'}
      />
    );
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<BootScreen />}>
        <DashboardApp />
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<BootScreen />}>
          <Routes>
            <Route path="/" element={<ProtectedDashboard />} />
            <Route path="/terms" element={<LegalPage />} />
            <Route path="/privacy" element={<LegalPage />} />
            <Route path="/roadmap/:token" element={<RoadmapPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
