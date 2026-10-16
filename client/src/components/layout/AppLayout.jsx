import { Globe, KeyRound, LineChart, LogOut, Menu, Moon, ScanSearch, Settings, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AlertBell from '../AlertBell';
import ErrorBoundary from '../ErrorBoundary';

const NAV = [
  { to: '/domains', label: 'Alan Adları', icon: Globe },
  { to: '/keywords', label: 'Organik Anahtar Kelimeler', icon: KeyRound },
  { to: '/analyze', label: 'Sayfa Analizi', icon: ScanSearch },
];

function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* yok say */
    }
    setTheme(next);
  };
  return [theme, toggle];
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><LineChart size={18} /></div>
          <div>
            CR SEO Panel
            <small>CrabsMedia</small>
          </div>
        </div>
        <div className="nav-section">Panel</div>
        <nav style={{ display: 'grid', gap: 2 }}>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="nav-section">Hesap</div>
        <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <Settings size={18} /> Ayarlar & Entegrasyonlar
        </NavLink>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{user?.name?.[0]?.toUpperCase() || '?'}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="truncate" style={{ fontWeight: 500 }}>{user?.name}</div>
              <div className="truncate muted" style={{ fontSize: 12 }}>{user?.email}</div>
            </div>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={logout} title="Çıkış yap" aria-label="Çıkış yap">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className={`backdrop ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-btn" onClick={() => setOpen(true)} aria-label="Menüyü aç">
            <Menu size={20} />
          </button>
          <div className="topbar-actions">
            <AlertBell />
            <button className="btn btn-ghost btn-icon" onClick={toggleTheme} aria-label="Temayı değiştir" title="Temayı değiştir">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        <main className="content">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
