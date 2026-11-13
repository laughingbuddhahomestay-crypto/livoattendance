import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import ResetPasswordPage from './auth/ResetPasswordPage';
import SetupPage from './auth/SetupPage';
import AcceptInvitePage from './auth/AcceptInvitePage';
import ProtectedRoute from './auth/ProtectedRoute';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import AttendancePage from './pages/AttendancePage';
import StaffPage from './pages/StaffPage';
import StaffFormPage from './pages/StaffFormPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import AuditPage from './pages/AuditPage';

export default function App() {
  const { user, loading, needsSetup } = useAuth();

  if (loading) {
    return (
      <div className="loading-page">
        <img src="/logo-light.png" alt="Livotel" className="loading-logo" />
        <div className="spinner" />
        <p>Loading Livotel Attendance…</p>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public invite & login routes */}
      <Route path="/invite" element={<AcceptInvitePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {needsSetup && <Route path="/setup" element={<SetupPage />} />}

      {/* Main app shell */}
      <Route element={<Layout />}>
        {/* Dashboard is the default landing viewable immediately without login */}
        <Route index element={<DashboardPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Operational views requiring Owner / Manager authentication */}
        <Route path="/attendance" element={
          <ProtectedRoute><AttendancePage /></ProtectedRoute>
        } />
        <Route path="/staff" element={
          <ProtectedRoute><StaffPage /></ProtectedRoute>
        } />
        <Route path="/staff/new" element={
          <ProtectedRoute><StaffFormPage /></ProtectedRoute>
        } />
        <Route path="/staff/:id/edit" element={
          <ProtectedRoute><StaffFormPage /></ProtectedRoute>
        } />
        <Route path="/reports" element={
          <ProtectedRoute><ReportsPage /></ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute><SettingsPage /></ProtectedRoute>
        } />
        <Route path="/audit" element={
          <ProtectedRoute requiredRole="owner"><AuditPage /></ProtectedRoute>
        } />

        {/* Fallback to live dashboard */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
