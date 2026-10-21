import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
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
      {/* Public routes */}
      <Route path="/invite" element={<AcceptInvitePage />} />

      {needsSetup && !user ? (
        <Route path="*" element={<SetupPage />} />
      ) : !user ? (
        <Route path="*" element={<LoginPage />} />
      ) : (
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/attendance" replace />} />
          <Route path="/dashboard" element={
            <ProtectedRoute><DashboardPage /></ProtectedRoute>
          } />
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
          <Route path="*" element={<Navigate to="/attendance" replace />} />
        </Route>
      )}
    </Routes>
  );
}
