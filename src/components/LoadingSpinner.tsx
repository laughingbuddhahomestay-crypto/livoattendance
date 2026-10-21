import React from 'react';

export default function LoadingSpinner({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="loading-container">
      <div className="spinner" />
      <p>{message}</p>
    </div>
  );
}
