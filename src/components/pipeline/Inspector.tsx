'use client';

import React, { useMemo, useState } from 'react';
import { StatusMessage } from '@/components/common/StatusMessage';
import { HexView } from '@/components/data/HexView';
import { Statistics } from '@/components/data/Statistics';
import { getOperationById } from '@/engine/registry';
import type { PipelineStep, StepResult } from '@/engine/types';
import {
  decodeUtf8LossyPreview,
  decodeUtf8OrNull,
} from '@/lib/bytes';
import { checkJsonPrecisionNotice } from '@/operations/encoding';
import type { DataViewMode } from '@/state/workspace';

export interface InspectorProps {
  step: PipelineStep | null;
  stepIndex: number;
  stepResult: StepResult | null;
  isResultStale: boolean;
  onClose: () => void;
}

interface EntropySummary {
  byteLength: number;
  entropyBitsPerByte: number;
  topBytes: { byte: number; hex: string; count: number; probability: number }[];
}

export function Inspector({
  step,
  stepIndex,
  stepResult,
  isResultStale,
  onClose,
}: InspectorProps) {
  const [viewMode, setViewMode] = useState<DataViewMode>('text');

  const operation = step ? getOperationById(step.operationId) : undefined;

  const outputBytes = useMemo(() => {
    if (
      !stepResult ||
      (stepResult.status !== 'success' && stepResult.status !== 'bypassed')
    ) {
      return null;
    }
    return stepResult.output;
  }, [stepResult]);

  const utf8Text = useMemo(() => {
    if (!outputBytes) {
      return null;
    }
    return decodeUtf8OrNull(outputBytes);
  }, [outputBytes]);

  const lossyPreview = useMemo(() => {
    if (!outputBytes || utf8Text !== null) {
      return null;
    }
    return decodeUtf8LossyPreview(outputBytes);
  }, [outputBytes, utf8Text]);

  const entropySummary = useMemo((): EntropySummary | null => {
    if (!step || step.operationId !== 'entropy' || !utf8Text) {
      return null;
    }
    try {
      const parsed = JSON.parse(utf8Text) as {
        byteLength?: number;
        entropyBitsPerByte?: number;
        frequencies?: {
          byte: number;
          hex: string;
          count: number;
          probability: number;
        }[];
      };
      if (
        typeof parsed.byteLength !== 'number' ||
        typeof parsed.entropyBitsPerByte !== 'number' ||
        !Array.isArray(parsed.frequencies)
      ) {
        return null;
      }
      const nonZero = parsed.frequencies
        .filter((f) => f.count > 0)
        .sort((a, b) => b.count - a.count || a.byte - b.byte)
        .slice(0, 8);
      return {
        byteLength: parsed.byteLength,
        entropyBitsPerByte: parsed.entropyBitsPerByte,
        topBytes: nonZero,
      };
    } catch {
      return null;
    }
  }, [step, utf8Text]);

  const jsonPrecisionNotice = useMemo((): string | null => {
    if (!step || step.operationId !== 'json' || !utf8Text) {
      return null;
    }
    return checkJsonPrecisionNotice(utf8Text) ?? null;
  }, [step, utf8Text]);

  if (!step) {
    return null;
  }

  return (
    <section
      aria-label={`Step ${stepIndex + 1} intermediate inspector`}
      data-testid="step-inspector"
      className="cl-surface flex flex-col gap-2.5 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--cl-border)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-bold">
            Intermediate Inspector — Step #{stepIndex + 1}:{' '}
            {operation?.label ?? step.operationId}
          </h3>
          {stepResult ? (
            <span
              data-testid="inspector-status"
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                stepResult.status === 'error'
                  ? 'cl-badge-error'
                  : stepResult.status === 'not-run' ||
                      stepResult.status === 'bypassed'
                    ? 'cl-badge-warning'
                    : isResultStale
                      ? 'cl-badge-warning'
                      : 'cl-badge-success'
              }`}
            >
              Status: {stepResult.status}
              {isResultStale ? ' (stale)' : ''}
            </span>
          ) : (
            <span
              data-testid="inspector-status"
              className="cl-badge-info rounded px-2 py-0.5 text-[11px] font-semibold"
            >
              Status: pending
            </span>
          )}
          {stepResult && 'durationMs' in stepResult ? (
            <span
              data-testid="inspector-duration"
              className="cl-mono cl-surface-alt rounded border px-1.5 py-0.5 text-[11px]"
            >
              {stepResult.durationMs.toFixed(2)} ms
            </span>
          ) : null}
          {stepResult && 'byteLength' in stepResult ? (
            <span
              data-testid="inspector-byte-length"
              className="cl-mono cl-surface-alt rounded border px-1.5 py-0.5 text-[11px]"
            >
              {stepResult.byteLength.toLocaleString()} bytes
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {outputBytes !== null ? (
            <div
              role="group"
              aria-label="Inspector display mode"
              className="flex items-center gap-1"
            >
              <button
                type="button"
                aria-pressed={viewMode === 'text'}
                onClick={() => setViewMode('text')}
                data-testid="inspector-view-text"
                className={`${
                  viewMode === 'text' ? 'cl-btn-primary' : 'cl-btn-secondary'
                } rounded px-2 py-0.5 text-[11px] font-medium`}
              >
                Text
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'hex'}
                onClick={() => setViewMode('hex')}
                data-testid="inspector-view-hex"
                className={`${
                  viewMode === 'hex' ? 'cl-btn-primary' : 'cl-btn-secondary'
                } rounded px-2 py-0.5 text-[11px] font-medium`}
              >
                Hex Dump
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            data-testid="inspector-close-btn"
            className="cl-btn-secondary rounded px-2 py-0.5 text-[11px] font-medium"
          >
            Close Inspector
          </button>
        </div>
      </div>

      {!stepResult ? (
        <p
          data-testid="inspector-pending"
          className="cl-text-muted text-xs"
        >
          No execution result recorded for this step yet. Run the pipeline to
          inspect intermediate output.
        </p>
      ) : stepResult.status === 'not-run' ? (
        <StatusMessage
          tone="warning"
          title="Step not executed"
          message="An earlier step failed before execution reached this step."
          live="off"
          testId="inspector-not-run"
        />
      ) : stepResult.status === 'error' ? (
        <StatusMessage
          tone="error"
          title="Step failed"
          message={stepResult.error.message}
          code={stepResult.error.code}
          live="off"
          testId="inspector-error"
        />
      ) : outputBytes !== null ? (
        <>
          {utf8Text === null ? (
            <StatusMessage
              tone="warning"
              title="Non-UTF-8 Intermediate Bytes"
              message="Intermediate bytes are not valid UTF-8. Hex Dump is authoritative; text preview uses U+FFFD replacement characters and is lossy."
              live="off"
              testId="inspector-binary-warning"
            />
          ) : null}

          {jsonPrecisionNotice ? (
            <StatusMessage
              tone="warning"
              title="JSON Large-Integer Precision Notice"
              message={jsonPrecisionNotice}
              live="off"
              testId="inspector-json-precision-warning"
            />
          ) : null}

          {entropySummary ? (
            <div
              data-testid="inspector-entropy-chart"
              className="cl-surface-alt flex flex-col gap-2 rounded border p-2.5 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  Shannon Entropy:{' '}
                  <span className="cl-mono">
                    {entropySummary.entropyBitsPerByte.toFixed(4)} bits/byte
                  </span>{' '}
                  (informational only; not a randomness certification)
                </span>
              </div>
              {entropySummary.topBytes.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {entropySummary.topBytes.map((item) => (
                    <div
                      key={item.byte}
                      className="flex items-center gap-2 text-[11px]"
                    >
                      <span className="cl-mono w-10 font-semibold">
                        0x{item.hex}
                      </span>
                      <div className="cl-surface h-3 flex-1 overflow-hidden rounded border">
                        <div
                          data-testid={`entropy-bar-${item.hex}`}
                          className="h-full"
                          style={{
                            width: `${Math.max(4, Math.round(item.probability * 100))}%`,
                            backgroundColor: 'var(--cl-chart-bar)',
                          }}
                        />
                      </div>
                      <span className="cl-mono w-24 text-right">
                        {item.count} ({(item.probability * 100).toFixed(1)}%)
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {viewMode === 'hex' ? (
            <HexView
              bytes={outputBytes}
              emptyLabel="0 intermediate bytes"
              testId="inspector-hex-view"
            />
          ) : (
            <pre
              data-testid="inspector-text-view"
              className="cl-surface-alt cl-mono m-0 max-h-56 overflow-auto rounded border p-2.5 text-xs leading-relaxed break-all whitespace-pre-wrap"
            >
              {utf8Text !== null ? utf8Text : (lossyPreview ?? '')}
            </pre>
          )}

          <Statistics bytes={outputBytes} testIdPrefix="inspector-stats" />
        </>
      ) : null}
    </section>
  );
}
