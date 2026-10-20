'use client';

import React from 'react';

export type StatusTone = 'info' | 'success' | 'warning' | 'error';

export interface StatusMessageProps {
  tone: StatusTone;
  title?: string;
  message: string;
  code?: string;
  onDismiss?: () => void;
  live?: 'polite' | 'assertive' | 'off';
  testId?: string;
}

const TONE_STYLES: Record<StatusTone, { badgeClass: string; prefix: string }> = {
  info: { badgeClass: 'cl-badge-info', prefix: 'Info' },
  success: { badgeClass: 'cl-badge-success', prefix: 'Success' },
  warning: { badgeClass: 'cl-badge-warning', prefix: 'Warning' },
  error: { badgeClass: 'cl-badge-error', prefix: 'Error' },
};

export function StatusMessage({
  tone,
  title,
  message,
  code,
  onDismiss,
  live = 'polite',
  testId,
}: StatusMessageProps) {
  const { badgeClass, prefix } = TONE_STYLES[tone];
  const role = tone === 'error' ? 'alert' : 'status';

  return (
    <div
      role={live === 'off' ? undefined : role}
      aria-live={live === 'off' ? undefined : live}
      data-testid={testId}
      className={`${badgeClass} flex items-start justify-between gap-3 rounded-md px-3 py-2 text-xs`}
    >
      <div className="min-w-0 flex-1 break-words">
        <span className="font-bold">[{prefix}]</span>{' '}
        {title ? <span className="font-semibold">{title}: </span> : null}
        <span>{message}</span>
        {code ? (
          <span className="cl-mono ml-1.5 inline-block rounded border px-1 py-0.5 text-[11px] font-semibold">
            {code}
          </span>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="cl-btn-secondary shrink-0 rounded px-2 py-0.5 text-[11px] font-medium"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
