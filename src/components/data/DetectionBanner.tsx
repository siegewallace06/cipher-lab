'use client';

import React from 'react';
import type { ParameterValue } from '@/engine/types';
import type { DetectionCandidate, DetectionResult } from '@/lib/detection';
import { MAX_PIPELINE_STEPS } from '@/lib/limits';

export interface DetectionBannerProps {
  sourceLabel: 'Input' | 'Output';
  detection: DetectionResult | null;
  dismissedRevision: number | null;
  currentRevision: number | null;
  stepCount: number;
  onApplyCandidate: (candidate: DetectionCandidate) => void;
  onDismiss: () => void;
  testIdPrefix: string;
}

export function DetectionBanner({
  sourceLabel,
  detection,
  dismissedRevision,
  currentRevision,
  stepCount,
  onApplyCandidate,
  onDismiss,
  testIdPrefix,
}: DetectionBannerProps) {
  if (
    !detection ||
    currentRevision === null ||
    detection.revision !== currentRevision ||
    dismissedRevision === currentRevision
  ) {
    return null;
  }

  if (detection.status === 'unavailable') {
    return (
      <div
        role="region"
        aria-label={`${sourceLabel} format detection notice`}
        data-testid={`${testIdPrefix}-unavailable`}
        className="cl-badge-info flex items-center justify-between gap-2 rounded px-3 py-2 text-xs"
      >
        <span>[Detection Unavailable] {detection.reason}</span>
        <button
          type="button"
          onClick={onDismiss}
          data-testid={`${testIdPrefix}-dismiss`}
          className="cl-btn-secondary shrink-0 rounded px-2 py-0.5 text-[11px] font-medium"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (detection.status !== 'ok' || detection.candidates.length === 0) {
    return null;
  }

  const atStepCap = stepCount >= MAX_PIPELINE_STEPS;

  const formatParamsSummary = (
    params: Readonly<Record<string, ParameterValue>>,
  ): string => {
    const entries = Object.entries(params);
    if (entries.length === 0) {
      return 'default settings';
    }
    return entries.map(([k, v]) => `${k}=${String(v)}`).join(', ');
  };

  return (
    <div
      role="region"
      aria-label={`${sourceLabel} format suggestions`}
      data-testid={`${testIdPrefix}-banner`}
      className="cl-badge-info flex flex-col gap-2 rounded p-2.5 text-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-bold">
            [Format Hint — {sourceLabel}]
          </span>{' '}
          <span>
            Heuristic format suggestions based on buffer structure. Guesses may
            be inaccurate and do not verify authenticity.
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss ${sourceLabel.toLowerCase()} format suggestions`}
          data-testid={`${testIdPrefix}-dismiss`}
          className="cl-btn-secondary shrink-0 rounded px-2 py-0.5 text-[11px] font-medium"
        >
          Dismiss
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {detection.candidates.map((cand) => (
          <div
            key={`${cand.format}-${cand.operationId}`}
            data-testid={`${testIdPrefix}-candidate-${cand.format}`}
            className="cl-surface flex flex-wrap items-center justify-between gap-2 rounded border px-2.5 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">{cand.label}</span>
                <span className="cl-mono cl-surface-alt rounded border px-1.5 py-0.5 text-[10px] font-semibold">
                  score {cand.confidence.toFixed(2)}
                </span>
              </div>
              <p className="cl-text-muted mt-0.5 text-[11px]">
                {cand.reason} Appends <code>{cand.operationId}</code> (
                {formatParamsSummary(cand.params)}).
              </p>
            </div>
            <button
              type="button"
              disabled={atStepCap}
              onClick={() => onApplyCandidate(cand)}
              data-testid={`${testIdPrefix}-apply-${cand.format}`}
              className="cl-btn-primary shrink-0 rounded px-2.5 py-1 text-xs font-medium"
            >
              + {cand.actionLabel}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
