'use client';

import React, { useId, useState } from 'react';
import { StatusMessage } from '@/components/common/StatusMessage';
import type { OperationError } from '@/engine/types';
import { decodeUtf8OrNull, encodeHex } from '@/lib/bytes';
import type { DetectionCandidate, DetectionResult } from '@/lib/detection';
import type { DataViewMode, InputEntryMode } from '@/state/workspace';
import { DetectionBanner } from './DetectionBanner';
import { HexView } from './HexView';
import { Statistics } from './Statistics';

export interface InputPaneProps {
  inputBytes: Uint8Array;
  inputRevision: number;
  entryMode: InputEntryMode;
  draftText: string;
  draftError: OperationError | null;
  viewMode: DataViewMode;
  detection: DetectionResult | null;
  dismissedDetectionRevision: number | null;
  stepCount: number;
  onChangeText: (text: string) => void;
  onChangeHexDraft: (hex: string) => void;
  onChangeEntryMode: (mode: InputEntryMode) => void;
  onChangeViewMode: (mode: DataViewMode) => void;
  onLoadSample: () => void;
  onClearInput: () => void;
  onApplyDetection: (candidate: DetectionCandidate) => void;
  onDismissDetection: () => void;
  onAnnounce: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

export function InputPane({
  inputBytes,
  inputRevision,
  entryMode,
  draftText,
  draftError,
  viewMode,
  detection,
  dismissedDetectionRevision,
  stepCount,
  onChangeText,
  onChangeHexDraft,
  onChangeEntryMode,
  onChangeViewMode,
  onLoadSample,
  onClearInput,
  onApplyDetection,
  onDismissDetection,
  onAnnounce,
}: InputPaneProps) {
  const editorId = useId();
  const [copyStatus, setCopyStatus] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  const handleCopy = async () => {
    setCopyStatus(null);
    let textToCopy = '';
    if (viewMode === 'hex') {
      textToCopy = encodeHex(inputBytes, 'lower');
    } else {
      const utf8 = decodeUtf8OrNull(inputBytes);
      textToCopy = utf8 !== null ? utf8 : encodeHex(inputBytes, 'lower');
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
      const msg = `Copied ${viewMode === 'hex' ? 'hexadecimal' : 'text'} input to clipboard.`;
      setCopyStatus({ tone: 'success', message: msg });
      onAnnounce(msg, 'success');
    } catch {
      const errMsg =
        'Clipboard access was denied or is unavailable in this browser context.';
      setCopyStatus({ tone: 'error', message: errMsg });
      onAnnounce(errMsg, 'error');
    }
  };

  return (
    <section
      aria-label="Input data"
      data-testid="input-pane"
      className="cl-surface flex flex-col gap-2.5 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--cl-border)' }}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Input</h2>
          <div
            role="group"
            aria-label="Input entry format"
            className="flex items-center gap-1"
          >
            <button
              type="button"
              aria-pressed={entryMode === 'utf8'}
              onClick={() => onChangeEntryMode('utf8')}
              data-testid="input-entry-utf8"
              className={`${
                entryMode === 'utf8' ? 'cl-btn-primary' : 'cl-btn-secondary'
              } rounded px-2 py-0.5 text-[11px] font-medium`}
            >
              UTF-8 Entry
            </button>
            <button
              type="button"
              aria-pressed={entryMode === 'hex'}
              onClick={() => onChangeEntryMode('hex')}
              data-testid="input-entry-hex"
              className={`${
                entryMode === 'hex' ? 'cl-btn-primary' : 'cl-btn-secondary'
              } rounded px-2 py-0.5 text-[11px] font-medium`}
            >
              Hex Entry
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div
            role="group"
            aria-label="Input display mode"
            className="flex items-center gap-1"
          >
            <button
              type="button"
              aria-pressed={viewMode === 'text'}
              onClick={() => onChangeViewMode('text')}
              data-testid="input-view-text"
              className={`${
                viewMode === 'text' ? 'cl-btn-primary' : 'cl-btn-secondary'
              } rounded px-2 py-0.5 text-[11px] font-medium`}
            >
              Editor
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'hex'}
              onClick={() => onChangeViewMode('hex')}
              data-testid="input-view-hex"
              className={`${
                viewMode === 'hex' ? 'cl-btn-primary' : 'cl-btn-secondary'
              } rounded px-2 py-0.5 text-[11px] font-medium`}
            >
              Hex Dump
            </button>
          </div>

          <button
            type="button"
            onClick={onLoadSample}
            data-testid="input-sample-btn"
            className="cl-btn-secondary rounded px-2 py-0.5 text-[11px] font-medium"
          >
            Sample
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={inputBytes.byteLength === 0}
            data-testid="input-copy-btn"
            className="cl-btn-secondary rounded px-2 py-0.5 text-[11px] font-medium"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={onClearInput}
            disabled={
              inputBytes.byteLength === 0 && draftText.length === 0
            }
            data-testid="input-clear-btn"
            className="cl-btn-secondary rounded px-2 py-0.5 text-[11px] font-medium"
          >
            Clear
          </button>
        </div>
      </div>

      {copyStatus ? (
        <StatusMessage
          tone={copyStatus.tone}
          message={copyStatus.message}
          onDismiss={() => setCopyStatus(null)}
          testId="input-copy-feedback"
        />
      ) : null}

      {draftError ? (
        <StatusMessage
          tone="error"
          title="Input validation"
          message={draftError.message}
          code={draftError.code}
          testId="input-draft-error"
        />
      ) : null}

      {viewMode === 'text' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={editorId} className="cl-text-muted text-[11px] font-medium">
            {entryMode === 'utf8'
              ? 'Enter UTF-8 text payload'
              : 'Enter hexadecimal byte pairs (e.g., 48 65 6c 6c 6f)'}
          </label>
          <textarea
            id={editorId}
            rows={5}
            value={draftText}
            onChange={(e) => {
              if (entryMode === 'utf8') {
                onChangeText(e.target.value);
              } else {
                onChangeHexDraft(e.target.value);
              }
            }}
            placeholder={
              entryMode === 'utf8'
                ? 'Type or paste UTF-8 text here...'
                : 'Type or paste hex byte pairs (00-ff)...'
            }
            aria-invalid={draftError !== null}
            data-testid="input-textarea"
            className="cl-input cl-mono w-full resize-y rounded p-2.5 text-xs leading-relaxed"
          />
        </div>
      ) : (
        <HexView
          bytes={inputBytes}
          emptyLabel="0 bytes in committed input buffer"
          testId="input-hex-view"
        />
      )}

      <Statistics bytes={inputBytes} testIdPrefix="input-stats" />

      <DetectionBanner
        sourceLabel="Input"
        detection={detection}
        dismissedRevision={dismissedDetectionRevision}
        currentRevision={inputRevision}
        stepCount={stepCount}
        onApplyCandidate={onApplyDetection}
        onDismiss={onDismissDetection}
        testIdPrefix="input-detection"
      />
    </section>
  );
}
