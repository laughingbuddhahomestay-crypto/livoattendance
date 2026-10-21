import React from 'react';
import { STATUS_LABELS, STATUS_COLORS } from '../types';
import type { AttendanceStatus } from '../types';

interface Props {
  status: AttendanceStatus | 'not_marked' | string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: Props) {
  const label =
    status === 'not_marked'
      ? 'Not Marked'
      : (STATUS_LABELS[status as AttendanceStatus] || status || 'Unknown');
  const color = STATUS_COLORS[status as AttendanceStatus] || '#718096';

  return (
    <span
      className={`status-badge status-badge-${size}`}
      style={{
        backgroundColor: `${color}18`,
        color: color,
        borderColor: `${color}40`,
      }}
    >
      {label}
    </span>
  );
}
