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
    navigate('/login');
  };

  const navItems = [
    { to: '/attendance', label: 'Attendance', icon: '📋' },
    { to: '/dashboard', label: 'Dashboard', icon: '📊' },
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
          <img src="/logo-light.png" alt="Livotel" className="header-logo" />
          <span className="header-title">Livotel Attendance</span>
        </div>
        <div className="header-right">
          <span className="header-user">
            {user?.name}
            <span className="role-badge">{user?.role === 'owner' ? 'Owner' : 'Manager'}</span>
          </span>
          <button className="btn btn-sm btn-outline" onClick={handleLogout}>
            Sign Out
          </button>
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
      </nav>

      {menuOpen && <div className="nav-overlay" onClick={() => setMenuOpen(false)} />}

      <main className="app-main">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="bottom-nav">
        {navItems.slice(0, 4).map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
        <NavLink
          to="/settings"
          className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="nav-icon">⚙️</span>
          <span className="nav-label">More</span>
        </NavLink>
      </nav>
    </div>
  );
}
