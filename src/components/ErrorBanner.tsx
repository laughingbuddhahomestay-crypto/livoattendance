import React from 'react';

interface Props {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export default function ErrorBanner({ message, onRetry, onDismiss }: Props) {
  return (
    <div className="alert alert-error" role="alert">
      <span>{message}</span>
      <div className="alert-actions">
        {onRetry && (
          <button className="btn btn-sm btn-outline" onClick={onRetry}>
            Retry
          </button>
        )}
        {onDismiss && (
          <button className="btn btn-sm btn-ghost" onClick={onDismiss}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
