'use client';

import React, { useMemo } from 'react';
import { StatusMessage } from '@/components/common/StatusMessage';
import { getOperationById } from '@/engine/registry';
import type {
  ParameterValue,
  PipelineStep,
  StepResult,
} from '@/engine/types';
import { MAX_PIPELINE_STEPS } from '@/lib/limits';
import { validateStepParameters } from '@/state/workspace';
import { ParameterForm } from './ParameterForm';

export interface StepCardProps {
  step: PipelineStep;
  index: number;
  totalSteps: number;
  isSelected: boolean;
  stepResult: StepResult | undefined;
  isResultStale: boolean;
  onSelect: () => void;
  onToggleEnabled: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onChangeParam: (key: string, value: ParameterValue) => void;
}

export function StepCard({
  step,
  index,
  totalSteps,
  isSelected,
  stepResult,
  isResultStale,
  onSelect,
  onToggleEnabled,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
  onChangeParam,
}: StepCardProps) {
  const operation = getOperationById(step.operationId);
  const validationErrors = useMemo(() => validateStepParameters(step), [step]);

  const unassociatedErrors = validationErrors.filter(
    (err) =>
      !err.field ||
      !operation?.parameters.some((param) => param.key === err.field),
  );

  const renderStatusBadge = () => {
    if (!step.enabled) {
      return (
        <span
          data-testid={`step-status-${step.id}`}
          className="cl-badge-warning rounded px-2 py-0.5 text-[11px] font-semibold"
        >
          [Bypassed]
        </span>
      );
    }
    if (validationErrors.length > 0) {
      return (
        <span
          data-testid={`step-status-${step.id}`}
          className="cl-badge-error rounded px-2 py-0.5 text-[11px] font-semibold"
        >
          [Invalid Parameters]
        </span>
      );
    }
    if (!stepResult) {
      return (
        <span
          data-testid={`step-status-${step.id}`}
          className="cl-badge-info rounded px-2 py-0.5 text-[11px] font-semibold"
        >
          [Pending]
        </span>
      );
    }
    if (stepResult.status === 'error') {
      return (
        <span
          data-testid={`step-status-${step.id}`}
          className="cl-badge-error rounded px-2 py-0.5 text-[11px] font-semibold"
        >
          [Error · {stepResult.durationMs.toFixed(1)} ms]
        </span>
      );
    }
    if (stepResult.status === 'not-run') {
      return (
        <span
          data-testid={`step-status-${step.id}`}
          className="cl-badge-warning rounded px-2 py-0.5 text-[11px] font-semibold"
        >
          [Not Run]
        </span>
      );
    }
    if (stepResult.status === 'bypassed') {
      return (
        <span
          data-testid={`step-status-${step.id}`}
          className="cl-badge-warning rounded px-2 py-0.5 text-[11px] font-semibold"
        >
          [Bypassed · {stepResult.byteLength.toLocaleString()} B]
        </span>
      );
    }
    return (
      <span
        data-testid={`step-status-${step.id}`}
        className={`${
          isResultStale ? 'cl-badge-warning' : 'cl-badge-success'
        } rounded px-2 py-0.5 text-[11px] font-semibold`}
      >
        [{isResultStale ? 'Stale' : 'OK'} · {stepResult.byteLength.toLocaleString()} B ·{' '}
        {stepResult.durationMs.toFixed(1)} ms]
      </span>
    );
  };

  return (
    <article
      aria-label={`Step ${index + 1}: ${operation?.label ?? step.operationId}`}
      data-testid={`step-card-${step.id}`}
      data-step-index={index}
      className={`${
        isSelected ? 'cl-surface ring-2' : 'cl-surface-alt'
      } flex flex-col gap-2.5 rounded-lg border p-3`}
      style={
        isSelected
          ? {
              borderColor: 'var(--cl-focus)',
            }
          : undefined
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--cl-border)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="cl-mono cl-surface rounded border px-1.5 py-0.5 text-xs font-bold">
            #{index + 1}
          </span>
          <h3 className="text-xs font-bold">
            {operation?.label ?? step.operationId}
          </h3>
          {renderStatusBadge()}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            aria-pressed={isSelected}
            onClick={onSelect}
            data-testid={`step-inspect-${step.id}`}
            className={`${
              isSelected ? 'cl-btn-primary' : 'cl-btn-secondary'
            } rounded px-2 py-1 text-[11px] font-medium`}
          >
            {isSelected ? 'Inspecting' : 'Inspect'}
          </button>
          <button
            type="button"
            aria-pressed={!step.enabled}
            onClick={onToggleEnabled}
            aria-label={
              step.enabled
                ? `Bypass step ${index + 1}`
                : `Enable step ${index + 1}`
            }
            data-testid={`step-toggle-${step.id}`}
            className="cl-btn-secondary rounded px-2 py-1 text-[11px] font-medium"
          >
            {step.enabled ? 'Bypass' : 'Enable'}
          </button>
          <button
            type="button"
            disabled={index === 0}
            onClick={onMoveUp}
            aria-label={`Move step ${index + 1} up`}
            data-testid={`step-up-${step.id}`}
            className="cl-btn-secondary rounded px-2 py-1 text-[11px] font-medium"
          >
            ↑ Up
          </button>
          <button
            type="button"
            disabled={index === totalSteps - 1}
            onClick={onMoveDown}
            aria-label={`Move step ${index + 1} down`}
            data-testid={`step-down-${step.id}`}
            className="cl-btn-secondary rounded px-2 py-1 text-[11px] font-medium"
          >
            ↓ Down
          </button>
          <button
            type="button"
            disabled={totalSteps >= MAX_PIPELINE_STEPS}
            onClick={onDuplicate}
            aria-label={`Duplicate step ${index + 1}`}
            data-testid={`step-duplicate-${step.id}`}
            className="cl-btn-secondary rounded px-2 py-1 text-[11px] font-medium"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove step ${index + 1}`}
            data-testid={`step-remove-${step.id}`}
            className="cl-btn-secondary rounded px-2 py-1 text-[11px] font-medium"
          >
            Remove
          </button>
        </div>
      </div>

      {operation ? (
        <ParameterForm
          stepId={step.id}
          fields={operation.parameters}
          params={step.params}
          errors={validationErrors}
          onChangeParam={onChangeParam}
        />
      ) : null}

      {unassociatedErrors.map((err, i) => (
        <StatusMessage
          key={`${err.code}-${i}`}
          tone="error"
          title="Step validation error"
          message={err.message}
          code={err.code}
          testId={`step-validation-error-${step.id}`}
        />
      ))}

      {stepResult?.status === 'error' ? (
        <StatusMessage
          tone="error"
          title="Step execution error"
          message={stepResult.error.message}
          code={stepResult.error.code}
          testId={`step-exec-error-${step.id}`}
        />
      ) : null}
    </article>
  );
}
