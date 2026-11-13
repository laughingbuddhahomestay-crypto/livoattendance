import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: '📊' },
    { to: '/attendance', label: 'Attendance', icon: '📋' },
    { to: '/staff', label: 'Staff', icon: '👥' },
    { to: '/reports', label: 'Reports', icon: '📄' },
    { to: '/settings', label: 'Settings', icon: '⚙️' },
  ];

  if (user?.role === 'owner') {
    navItems.push({ to: '/audit', label: 'Audit Log', icon: '🔍' });
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-left">
          <button
            className="menu-toggle"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            ☰
          </button>
          <div className="header-brand" onClick={() => navigate('/dashboard')} style={{ cursor: 'pointer' }}>
            <div className="header-logo-badge">
              <img src="/logo-light.png" alt="Livotel" className="header-logo" />
            </div>
            <div className="header-brand-text">
              <span className="header-title">Livotel Premium Hotel</span>
              <span className="header-subtitle desktop-only">Staff Attendance</span>
            </div>
          </div>
        </div>
        <div className="header-right">
          {user ? (
            <>
              <span className="header-user">
                <span className="header-user-name">{user.name}</span>
                <span className={`role-badge role-${user.role || 'manager'}`}>
                  {user.role === 'owner' ? '★ Owner' : 'Manager'}
                </span>
              </span>
              <button className="btn btn-sm btn-header-logout" onClick={handleLogout}>
                Sign Out
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontWeight: 600,
                padding: '0.35rem 0.85rem',
                boxShadow: '0 2px 6px rgba(197, 160, 89, 0.3)',
              }}
              onClick={() => navigate('/login')}
            >
              <span>🔐</span>
              <span>Sign In</span>
            </button>
          )}
        </div>
      </header>

      <nav className={`app-nav ${menuOpen ? 'open' : ''}`}>
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => setMenuOpen(false)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
        {!user && (
          <NavLink
            to="/login"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => setMenuOpen(false)}
            style={{ marginTop: 'auto', borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: '0.75rem' }}
          >
            <span className="nav-icon">🔐</span>
            <span className="nav-label">Sign In</span>
          </NavLink>
        )}
      </nav>

      {menuOpen && <div className="nav-overlay" onClick={() => setMenuOpen(false)} />}

      <main className="app-main">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="bottom-nav">
        <NavLink
          to="/dashboard"
          className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">📊</span>
          <span className="nav-label">Dashboard</span>
        </NavLink>
        <NavLink
          to="/attendance"
          className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">📋</span>
          <span className="nav-label">Attendance</span>
        </NavLink>
        <NavLink
          to="/reports"
          className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">📄</span>
          <span className="nav-label">Reports</span>
        </NavLink>
        {user ? (
          <NavLink
            to="/settings"
            className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">⚙️</span>
            <span className="nav-label">Settings</span>
          </NavLink>
        ) : (
          <NavLink
            to="/login"
            className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">🔐</span>
            <span className="nav-label">Sign In</span>
          </NavLink>
        )}
      </nav>
    </div>
  );
}
