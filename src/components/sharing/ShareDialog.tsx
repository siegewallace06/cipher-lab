'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import { Dialog } from '@/components/common/Dialog';
import { StatusMessage } from '@/components/common/StatusMessage';
import type { PipelineStep } from '@/engine/types';
import {
  MAX_URL_DECODED_JSON_BYTES,
  MAX_URL_FRAGMENT_CHARS,
} from '@/lib/limits';
import { exportWorkspaceToUrlFragment } from '@/lib/url-state';

export interface ShareDialogProps {
  open: boolean;
  steps: readonly PipelineStep[];
  inputBytes: Uint8Array;
  onClose: () => void;
  onAnnounce: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

export function ShareDialog({
  open,
  steps,
  inputBytes,
  onClose,
  onAnnounce,
}: ShareDialogProps) {
  const optInId = useId();
  const urlFieldId = useId();
  const [includeInput, setIncludeInput] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  // Reset input opt-in and feedback on each dialog open per PRD ch. 2.5
  useEffect(() => {
    if (open) {
      setIncludeInput(false);
      setCopyFeedback(null);
    }
  }, [open]);

  const baseUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://localhost/';

  const exportResult = useMemo(
    () =>
      exportWorkspaceToUrlFragment({
        steps,
        inputBytes,
        includeInput,
        baseUrl,
      }),
    [steps, inputBytes, includeInput, baseUrl],
  );

  const handleCopyLink = async () => {
    setCopyFeedback(null);
    if (!exportResult.ok) {
      return;
    }
    try {
      if (
        typeof navigator === 'undefined' ||
        !navigator.clipboard ||
        typeof navigator.clipboard.writeText !== 'function'
      ) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(exportResult.fullUrl);
      const msg = 'Copied shareable workspace URL to clipboard.';
      setCopyFeedback({ tone: 'success', message: msg });
      onAnnounce(msg, 'success');
    } catch {
      const errMsg =
        'Failed to copy URL to clipboard. You can select and copy the URL text manually.';
      setCopyFeedback({ tone: 'error', message: errMsg });
      onAnnounce(errMsg, 'error');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Share Stateless Pipeline URL"
      description="Workspace configuration is encoded into a #cl= URL fragment. Fragments are not sent in standard HTTP requests, but remain visible in browser history, screenshots, and to link recipients."
      maxWidthClass="max-w-xl"
      testId="share-dialog"
    >
      <div className="flex flex-col gap-3 text-xs">
        <div className="cl-surface-alt flex flex-col gap-2 rounded border p-3">
          <p className="font-semibold">Share Payload Summary</p>
          <ul className="m-0 list-disc space-y-1 pl-4">
            <li>
              <strong>Pipeline steps included:</strong>{' '}
              {exportResult.preview.stepCount} (enabled and bypassed states +
              non-secret parameters)
            </li>
            <li>
              <strong>Input payload included:</strong>{' '}
              {includeInput
                ? `Yes (${inputBytes.byteLength.toLocaleString()} exact bytes encoded as Base64url)`
                : 'No (excluded by default)'}
            </li>
            <li>
              <strong>Always excluded:</strong>{' '}
              {exportResult.preview.excludedRuntimeFields.join(', ')}
            </li>
          </ul>

          {exportResult.preview.omittedSecrets.length > 0 ? (
            <div
              data-testid="share-omitted-secrets-list"
              className="cl-badge-warning mt-1 rounded p-2"
            >
              <p className="font-semibold">
                [Secrets Omitted] The following secret parameters are stripped
                and will require manual entry by recipients:
              </p>
              <ul className="m-0 mt-1 list-disc pl-4">
                {exportResult.preview.omittedSecrets.map((sec) => (
                  <li key={`${sec.stepIndex}-${sec.fieldKey}`}>
                    Step #{sec.stepIndex} ({sec.operationLabel}):{' '}
                    <strong>{sec.fieldLabel}</strong> (<code>{sec.fieldKey}</code>)
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="cl-surface-alt flex flex-col gap-1.5 rounded border p-3">
          <div className="flex items-start gap-2">
            <input
              id={optInId}
              type="checkbox"
              checked={includeInput}
              onChange={(e) => {
                setIncludeInput(e.target.checked);
                setCopyFeedback(null);
              }}
              data-testid="share-include-input-checkbox"
              className="mt-0.5 h-4 w-4 rounded"
            />
            <label htmlFor={optInId} className="font-semibold">
              Include current input bytes ({inputBytes.byteLength.toLocaleString()}{' '}
              bytes) in shared URL
            </label>
          </div>
          {includeInput ? (
            <StatusMessage
              tone="warning"
              title="Sensitive Input Disclosure Warning"
              message="Anyone with this link, browser history access, or screen visibility can decode the embedded input bytes directly from the URL fragment. Do not include confidential data."
              live="off"
              testId="share-input-warning"
            />
          ) : null}
        </div>

        {exportResult.ok ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor={urlFieldId} className="font-semibold">
                Shareable URL
              </label>
              <span className="cl-mono cl-text-muted text-[11px]">
                {exportResult.encodedChars.toLocaleString()}/
                {MAX_URL_FRAGMENT_CHARS.toLocaleString()} chars ·{' '}
                {exportResult.decodedJsonBytes.toLocaleString()}/
                {MAX_URL_DECODED_JSON_BYTES.toLocaleString()} JSON bytes
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                id={urlFieldId}
                type="text"
                readOnly
                value={exportResult.fullUrl}
                onFocus={(e) => e.currentTarget.select()}
                data-testid="share-url-output"
                className="cl-input cl-mono min-w-0 flex-1 rounded px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                data-testid="share-copy-btn"
                className="cl-btn-primary shrink-0 rounded px-3 py-1.5 text-xs font-semibold"
              >
                Copy Link
              </button>
            </div>
          </div>
        ) : (
          <StatusMessage
            tone="error"
            title="Cannot generate share URL"
            message={exportResult.error.message}
            code={exportResult.error.code}
            testId="share-export-error"
          />
        )}

        {copyFeedback ? (
          <StatusMessage
            tone={copyFeedback.tone}
            message={copyFeedback.message}
            onDismiss={() => setCopyFeedback(null)}
            testId="share-copy-feedback"
          />
        ) : null}
      </div>
    </Dialog>
  );
}
