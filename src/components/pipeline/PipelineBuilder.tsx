'use client';

import React, { useState } from 'react';
import { isKnownOperationId } from '@/engine/registry';
import type {
  ParameterValue,
  PipelineExecutionResult,
  PipelineStep,
} from '@/engine/types';
import { MAX_PIPELINE_STEPS } from '@/lib/limits';
import { Inspector } from './Inspector';
import { StepCard } from './StepCard';

export interface PipelineBuilderProps {
  steps: readonly PipelineStep[];
  selectedStepId: string | null;
  executionResult: PipelineExecutionResult | null;
  isResultStale: boolean;
  onAddOperation: (operationId: string) => void;
  onSelectStep: (stepId: string | null) => void;
  onToggleStepEnabled: (stepId: string) => void;
  onMoveStep: (stepId: string, direction: 'up' | 'down') => void;
  onDuplicateStep: (stepId: string) => void;
  onRemoveStep: (stepId: string) => void;
  onChangeStepParam: (
    stepId: string,
    key: string,
    value: ParameterValue,
  ) => void;
  onOpenCatalogDrawer?: () => void;
}

export function PipelineBuilder({
  steps,
  selectedStepId,
  executionResult,
  isResultStale,
  onAddOperation,
  onSelectStep,
  onToggleStepEnabled,
  onMoveStep,
  onDuplicateStep,
  onRemoveStep,
  onChangeStepParam,
  onOpenCatalogDrawer,
}: PipelineBuilderProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const selectedIndex = selectedStepId
    ? steps.findIndex((s) => s.id === selectedStepId)
    : -1;
  const selectedStep = selectedIndex >= 0 ? steps[selectedIndex] : null;
  const selectedStepResult =
    selectedStep && executionResult
      ? (executionResult.steps.find((r) => r.stepId === selectedStep.id) ??
        null)
      : null;

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (steps.length >= MAX_PIPELINE_STEPS) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    if (steps.length >= MAX_PIPELINE_STEPS) {
      return;
    }
    const opId =
      event.dataTransfer.getData('application/x-cipher-lab-operation') ||
      event.dataTransfer.getData('text/plain');
    if (opId && isKnownOperationId(opId)) {
      onAddOperation(opId);
    }
  };

  return (
    <section
      aria-label="Transformation pipeline"
      data-testid="pipeline-builder"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`cl-surface flex flex-col gap-3 rounded-lg border p-3 ${
        isDragOver ? 'ring-2' : ''
      }`}
      style={
        isDragOver
          ? {
              borderColor: 'var(--cl-focus)',
            }
          : undefined
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--cl-border)' }}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Transformation Pipeline</h2>
          <span
            data-testid="pipeline-step-count"
            className="cl-mono cl-surface-alt rounded border px-1.5 py-0.5 text-xs font-semibold"
          >
            {steps.length}/{MAX_PIPELINE_STEPS}
          </span>
        </div>

        {onOpenCatalogDrawer ? (
          <button
            type="button"
            onClick={onOpenCatalogDrawer}
            data-testid="pipeline-open-catalog-btn"
            className="cl-btn-secondary xl:hidden rounded px-2.5 py-1 text-xs font-medium"
          >
            Browse Catalog
          </button>
        ) : null}
      </div>

      {steps.length === 0 ? (
        <div
          data-testid="pipeline-empty-state"
          className="cl-surface-alt flex flex-col items-center justify-center gap-2 rounded border border-dashed p-6 text-center text-xs"
        >
          <p className="font-semibold">Pipeline is empty (identity pass-through)</p>
          <p className="cl-text-muted max-w-md">
            Add operations using the <strong>+ Add</strong> buttons in the
            Operation Catalog, drag an operation card into this pane, or choose a
            starter preset from the toolbar. Empty pipelines return your input
            bytes unchanged.
          </p>
        </div>
      ) : (
        <div
          role="list"
          aria-label="Ordered pipeline steps"
          data-testid="pipeline-step-list"
          className="flex flex-col gap-3"
        >
          {steps.map((step, index) => {
            const stepResult = executionResult?.steps.find(
              (r) => r.stepId === step.id,
            );
            return (
              <div key={step.id} role="listitem">
                <StepCard
                  step={step}
                  index={index}
                  totalSteps={steps.length}
                  isSelected={selectedStepId === step.id}
                  stepResult={stepResult}
                  isResultStale={isResultStale}
                  onSelect={() =>
                    onSelectStep(selectedStepId === step.id ? null : step.id)
                  }
                  onToggleEnabled={() => onToggleStepEnabled(step.id)}
                  onMoveUp={() => onMoveStep(step.id, 'up')}
                  onMoveDown={() => onMoveStep(step.id, 'down')}
                  onDuplicate={() => onDuplicateStep(step.id)}
                  onRemove={() => onRemoveStep(step.id)}
                  onChangeParam={(key, val) =>
                    onChangeStepParam(step.id, key, val)
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      {selectedStep ? (
        <Inspector
          step={selectedStep}
          stepIndex={selectedIndex}
          stepResult={selectedStepResult}
          isResultStale={isResultStale}
          onClose={() => onSelectStep(null)}
        />
      ) : null}
    </section>
  );
}
