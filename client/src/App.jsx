import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';
import { Spinner } from './components/ui/Feedback';
import { useAuth } from './context/AuthContext';

const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const Domains = lazy(() => import('./pages/domains/Domains'));
const DomainDetail = lazy(() => import('./pages/domains/DomainDetail'));
const Keywords = lazy(() => import('./pages/keywords/Keywords'));
const Settings = lazy(() => import('./pages/settings/Settings'));
const Users = lazy(() => import('./pages/users/Users'));
const PageAnalyzer = lazy(() => import('./pages/analyze/PageAnalyzer'));
const DomainReport = lazy(() => import('./pages/report/DomainReport'));

const Loader = () => (
  <div className="center-screen">
    <Spinner />
  </div>
);

function Protected({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function GuestOnly({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loader />;
  return user ? <Navigate to="/domains" replace /> : children;
}

export default function App() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
        {/* Rapor menüsüz tam sayfa (yazdırma için) */}
        <Route path="/domains/:id/report" element={<Protected><ErrorBoundary><DomainReport /></ErrorBoundary></Protected>} />
        <Route element={<Protected><AppLayout /></Protected>}>
          <Route path="/domains" element={<Domains />} />
          <Route path="/domains/:id/:tab?" element={<DomainDetail />} />
          <Route path="/keywords" element={<Keywords />} />
          <Route path="/analyze" element={<PageAnalyzer />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/users" element={<Users />} />
        </Route>
        <Route path="*" element={<Navigate to="/domains" replace />} />
      </Routes>
    </Suspense>
  );
}
