'use client';

import React from 'react';
import type { OperationError } from '@/engine/types';
import type { RestoredStateNotice } from '@/state/workspace';

export interface RestoreNoticeProps {
  restoredNotice: RestoredStateNotice | null;
  importError: OperationError | null;
  onRunRestored: () => void;
  onClearRestored: () => void;
  onDismissNotice: () => void;
  onDismissError: () => void;
}

export function RestoreNotice({
  restoredNotice,
  importError,
  onRunRestored,
  onClearRestored,
  onDismissNotice,
  onDismissError,
}: RestoreNoticeProps) {
  if (!restoredNotice && !importError) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {importError ? (
        <div
          role="alert"
          data-testid="import-error-banner"
          className="cl-badge-error flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 text-xs"
        >
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              [Invalid Shared URL Rejected — {importError.code}]
            </p>
            <p className="mt-0.5">
              {importError.message} Your current workspace state was left
              unchanged.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClearRestored}
              data-testid="import-error-clear-fragment-btn"
              className="cl-btn-secondary rounded px-2.5 py-1 text-xs font-medium"
            >
              Remove URL Fragment
            </button>
            <button
              type="button"
              onClick={onDismissError}
              data-testid="import-error-dismiss-btn"
              className="cl-btn-secondary rounded px-2.5 py-1 text-xs font-medium"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {restoredNotice ? (
        <div
          role="region"
          aria-label="Restored shared workspace notice"
          data-testid="restore-notice-banner"
          className="cl-badge-warning flex flex-col gap-2 rounded-lg p-3 text-xs"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold">
                [Untrusted Shared URL Restored — Execution Paused]
              </p>
              <p className="mt-0.5">
                This pipeline{restoredNotice.includesInput ? ' and input buffer' : ''}{' '}
                was loaded from a URL fragment. Review the steps and parameters
                before running. Clearing removes the fragment from the current
                address bar (it does not erase browser history).
              </p>
              {restoredNotice.missingSecrets.length > 0 ? (
                <p
                  data-testid="restore-missing-secrets-warning"
                  className="mt-1 font-semibold"
                >
                  Required secrets were omitted from the share link and must be
                  entered before running:{' '}
                  {restoredNotice.missingSecrets
                    .map(
                      (s) =>
                        `Step #${s.stepIndex} (${s.operationLabel}: ${s.fieldLabel})`,
                    )
                    .join(', ')}
                  .
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onRunRestored}
                data-testid="restore-run-btn"
                className="cl-btn-primary rounded px-3 py-1 text-xs font-semibold"
              >
                Run Restored Pipeline
              </button>
              <button
                type="button"
                onClick={onClearRestored}
                data-testid="restore-clear-btn"
                className="cl-btn-secondary rounded px-2.5 py-1 text-xs font-medium"
              >
                Clear Shared State
              </button>
              <button
                type="button"
                onClick={onDismissNotice}
                data-testid="restore-dismiss-btn"
                className="cl-btn-secondary rounded px-2.5 py-1 text-xs font-medium"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
