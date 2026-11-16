import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import type { UserRole } from '../types';

interface Props {
  children: React.ReactNode;
  requiredRole?: UserRole;
  allowedRoles?: UserRole[];
}

export default function ProtectedRoute({ children, requiredRole, allowedRoles }: Props) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-page">
        <div className="spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isPermitted = allowedRoles
    ? allowedRoles.includes(user.role)
    : requiredRole
    ? (requiredRole === 'admin' || requiredRole === 'owner')
      ? (user.role === 'admin' || user.role === 'owner')
      : user.role === requiredRole
    : true;

  if (!isPermitted) {
    return (
      <div className="error-page">
        <h2>Access Denied</h2>
        <p>You do not have permission to view this page.</p>
      </div>
    );
  }

  return <>{children}</>;
}
