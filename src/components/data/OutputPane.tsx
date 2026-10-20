'use client';

import React, { useMemo, useState } from 'react';
import { StatusMessage } from '@/components/common/StatusMessage';
import type { PipelineExecutionResult } from '@/engine/types';
import {
  decodeUtf8LossyPreview,
  decodeUtf8OrNull,
  encodeHex,
} from '@/lib/bytes';
import type { DetectionCandidate, DetectionResult } from '@/lib/detection';
import type { DataViewMode, RunLifecycleStatus } from '@/state/workspace';
import { DetectionBanner } from './DetectionBanner';
import { HexView } from './HexView';
import { Statistics } from './Statistics';

export interface OutputPaneProps {
  executionResult: PipelineExecutionResult | null;
  currentRevision: number;
  resultRevision: number | null;
  runStatus: RunLifecycleStatus;
  viewMode: DataViewMode;
  detection: DetectionResult | null;
  dismissedDetectionRevision: number | null;
  stepCount: number;
  onChangeViewMode: (mode: DataViewMode) => void;
  onPromoteToInput: () => void;
  onApplyDetection: (candidate: DetectionCandidate) => void;
  onDismissDetection: () => void;
  onAnnounce: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

export function OutputPane({
  executionResult,
  currentRevision,
  resultRevision,
  runStatus,
  viewMode,
  detection,
  dismissedDetectionRevision,
  stepCount,
  onChangeViewMode,
  onPromoteToInput,
  onApplyDetection,
  onDismissDetection,
  onAnnounce,
}: OutputPaneProps) {
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  const isStale = resultRevision !== currentRevision;
  const isRunning = runStatus === 'running';
  const hasCurrentSuccess =
    executionResult !== null &&
    executionResult.status === 'success' &&
    !isStale &&
    !isRunning;

  const outputBytes = useMemo(() => {
    if (!executionResult || executionResult.status !== 'success') {
      return null;
    }
    return executionResult.output;
  }, [executionResult]);

  const utf8Decoded = useMemo(() => {
    if (!outputBytes) {
      return null;
    }
    return decodeUtf8OrNull(outputBytes);
  }, [outputBytes]);

  const lossyPreview = useMemo(() => {
    if (!outputBytes || utf8Decoded !== null) {
      return null;
    }
    return decodeUtf8LossyPreview(outputBytes);
  }, [outputBytes, utf8Decoded]);

  const isBinaryOutput = outputBytes !== null && utf8Decoded === null;

  const canActOnOutput = hasCurrentSuccess && outputBytes !== null;

  const handleCopy = async () => {
    setFeedback(null);
    if (!outputBytes) {
      return;
    }
    let textToCopy = '';
    if (viewMode === 'hex' || utf8Decoded === null) {
      textToCopy = encodeHex(outputBytes, 'lower');
    } else {
      textToCopy = utf8Decoded;
    }

    try {
      if (
        typeof navigator === 'undefined' ||
        !navigator.clipboard ||
        typeof navigator.clipboard.writeText !== 'function'
      ) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(textToCopy);
      const msg = `Copied ${viewMode === 'hex' || utf8Decoded === null ? 'hexadecimal' : 'UTF-8 text'} output to clipboard.`;
      setFeedback({ tone: 'success', message: msg });
      onAnnounce(msg, 'success');
    } catch {
      const errMsg =
        'Clipboard access was denied or is unavailable in this browser context.';
      setFeedback({ tone: 'error', message: errMsg });
      onAnnounce(errMsg, 'error');
    }
  };

  const handleDownload = (format: 'bin' | 'txt') => {
    setFeedback(null);
    if (!canActOnOutput || !outputBytes) {
      return;
    }
    if (format === 'txt' && utf8Decoded === null) {
      return;
    }

    try {
      const mimeType =
        format === 'bin'
          ? 'application/octet-stream'
          : 'text/plain;charset=utf-8';
      const filename =
        format === 'bin' ? 'cipher-lab-output.bin' : 'cipher-lab-output.txt';
      const copyBuffer = outputBytes.slice().buffer;
      const blob = new Blob([copyBuffer], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 0);
      const msg = `Downloaded output as ${filename} (${outputBytes.byteLength.toLocaleString()} bytes).`;
      setFeedback({ tone: 'success', message: msg });
      onAnnounce(msg, 'success');
    } catch {
      const errMsg = 'Download failed in this browser environment.';
      setFeedback({ tone: 'error', message: errMsg });
      onAnnounce(errMsg, 'error');
    }
  };

  return (
    <section
      aria-label="Output data"
      data-testid="output-pane"
      className="cl-surface flex flex-col gap-2.5 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--cl-border)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Output</h2>
          {isRunning ? (
            <span
              data-testid="output-status-badge"
              className="cl-badge-info rounded px-2 py-0.5 text-[11px] font-semibold"
            >
              [Running...]
            </span>
          ) : executionResult?.status === 'error' ? (
            <span
              data-testid="output-status-badge"
              className="cl-badge-error rounded px-2 py-0.5 text-[11px] font-semibold"
            >
              [Failed]
            </span>
          ) : executionResult?.status === 'cancelled' ? (
            <span
              data-testid="output-status-badge"
              className="cl-badge-warning rounded px-2 py-0.5 text-[11px] font-semibold"
            >
              [Cancelled]
            </span>
          ) : isStale ? (
            <span
              data-testid="output-status-badge"
              className="cl-badge-warning rounded px-2 py-0.5 text-[11px] font-semibold"
            >
              [Stale — Run Required]
            </span>
          ) : (
            <span
              data-testid="output-status-badge"
              className="cl-badge-success rounded px-2 py-0.5 text-[11px] font-semibold"
            >
              [Current · {executionResult?.durationMs.toFixed(1) ?? '0.0'} ms]
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div
            role="group"
            aria-label="Output display mode"
            className="flex items-center gap-1"
          >
            <button
              type="button"
              aria-pressed={viewMode === 'text'}
              onClick={() => onChangeViewMode('text')}
              data-testid="output-view-text"
              className={`${
                viewMode === 'text' ? 'cl-btn-primary' : 'cl-btn-secondary'
              } rounded px-2 py-0.5 text-[11px] font-medium`}
            >
              Text
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'hex'}
              onClick={() => onChangeViewMode('hex')}
              data-testid="output-view-hex"
              className={`${
                viewMode === 'hex' ? 'cl-btn-primary' : 'cl-btn-secondary'
              } rounded px-2 py-0.5 text-[11px] font-medium`}
            >
              Hex Dump
            </button>
          </div>

          <button
            type="button"
            disabled={!canActOnOutput}
            onClick={handleCopy}
            data-testid="output-copy-btn"
            className="cl-btn-secondary rounded px-2 py-0.5 text-[11px] font-medium"
          >
            Copy
          </button>
          <button
            type="button"
            disabled={!canActOnOutput || utf8Decoded === null}
            onClick={() => handleDownload('txt')}
            data-testid="output-download-txt-btn"
            className="cl-btn-secondary rounded px-2 py-0.5 text-[11px] font-medium"
          >
            Download .txt
          </button>
          <button
            type="button"
            disabled={!canActOnOutput}
            onClick={() => handleDownload('bin')}
            data-testid="output-download-bin-btn"
            className="cl-btn-secondary rounded px-2 py-0.5 text-[11px] font-medium"
          >
            Download .bin
          </button>
          <button
            type="button"
            disabled={!canActOnOutput}
            onClick={onPromoteToInput}
            data-testid="output-promote-btn"
            className="cl-btn-primary rounded px-2 py-0.5 text-[11px] font-medium"
          >
            Promote to Input
          </button>
        </div>
      </div>

      {feedback ? (
        <StatusMessage
          tone={feedback.tone}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
          testId="output-action-feedback"
        />
      ) : null}

      {executionResult?.status === 'error' ? (
        <div
          data-testid="output-error-unavailable"
          className="flex flex-col gap-2"
        >
          <StatusMessage
            tone="error"
            title="Pipeline execution failed"
            message={`${executionResult.error.message} Final output is unavailable; select earlier completed steps to inspect intermediate bytes.`}
            code={executionResult.error.code}
            testId="output-error-message"
          />
        </div>
      ) : executionResult?.status === 'cancelled' ? (
        <StatusMessage
          tone="warning"
          title="Pipeline run cancelled"
          message="Execution was cancelled before completion. Final output is unavailable until the pipeline runs again."
          code="CANCELLED"
          testId="output-cancelled-message"
        />
      ) : outputBytes === null ? (
        <div
          data-testid="output-pending-placeholder"
          className="cl-surface-alt cl-text-muted rounded border p-4 text-xs"
        >
          [Pending] Pipeline has not executed for the current state. Press{' '}
          <strong>Run</strong> to compute output.
        </div>
      ) : (
        <>
          {isStale ? (
            <StatusMessage
              tone="warning"
              title="Output is stale"
              message="Workspace settings or input changed since this result was computed. Run the pipeline to refresh output before downloading or promoting."
              live="off"
              testId="output-stale-warning"
            />
          ) : null}

          {isBinaryOutput ? (
            <StatusMessage
              tone="warning"
              title="Non-UTF-8 Binary Output"
              message="Output bytes are not valid UTF-8. Hex Dump is the authoritative representation; the text preview below replaces invalid sequences with U+FFFD () and is lossy."
              live="off"
              testId="output-binary-lossy-notice"
            />
          ) : null}

          {viewMode === 'hex' ? (
            <HexView
              bytes={outputBytes}
              emptyLabel="0 bytes in output buffer"
              testId="output-hex-view"
            />
          ) : (
            <div className="flex flex-col gap-2">
              <pre
                data-testid="output-text-view"
                className="cl-surface-alt cl-mono m-0 max-h-72 min-h-[6rem] w-full overflow-auto rounded border p-2.5 text-xs leading-relaxed break-all whitespace-pre-wrap"
              >
                {utf8Decoded !== null ? utf8Decoded : (lossyPreview ?? '')}
              </pre>
            </div>
          )}

          <Statistics bytes={outputBytes} testIdPrefix="output-stats" />

          {!isStale ? (
            <DetectionBanner
              sourceLabel="Output"
              detection={detection}
              dismissedRevision={dismissedDetectionRevision}
              currentRevision={resultRevision}
              stepCount={stepCount}
              onApplyCandidate={onApplyDetection}
              onDismiss={onDismissDetection}
              testIdPrefix="output-detection"
            />
          ) : null}
        </>
      )}
    </section>
  );
}
