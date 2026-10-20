import {
  OperationFailure,
  type OperationContext,
  type OperationDefinition,
  type OperationError,
  type PipelineExecutionResult,
  type PipelineStep,
  type StepResult,
} from '@/engine/types';
import { getOperationById } from '@/engine/registry';
import { cloneBytes } from '@/lib/bytes';
import {
  MAX_CUMULATIVE_OUTPUT_BYTES,
  MAX_PIPELINE_STEPS,
  MAX_STEP_BYTES,
} from '@/lib/limits';
import { validateParametersAgainstFields } from '@/lib/parameter-schema';

export interface ExecutePipelineOptions {
  runId: string;
  revision: number;
  input: Uint8Array;
  steps: readonly PipelineStep[];
  signal?: AbortSignal;
  crypto?: Pick<Crypto, 'subtle' | 'getRandomValues'>;
  registry?: (id: string) => OperationDefinition | undefined;
  maxStepBytes?: number;
  maxCumulativeBytes?: number;
  maxSteps?: number;
  onStepStart?: (stepId: string, operationId: string) => void;
  onStepResult?: (result: StepResult) => void;
}

function resolveDefaultCrypto(): Pick<Crypto, 'subtle' | 'getRandomValues'> {
  if (typeof globalThis.crypto !== 'undefined') {
    return globalThis.crypto;
  }
  return {
    subtle: undefined as unknown as SubtleCrypto,
    getRandomValues: undefined as unknown as Crypto['getRandomValues'],
  };
}

function normalizeUnknownError(err: unknown): OperationError {
  if (err instanceof OperationFailure) {
    return err.operationError;
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected internal error occurred during operation execution.',
  };
}

function markRemainingNotRun(
  steps: readonly PipelineStep[],
  fromIndex: number,
  target: StepResult[],
): void {
  for (let i = fromIndex; i < steps.length; i++) {
    target.push({
      stepId: steps[i].id,
      status: 'not-run',
    });
  }
}

export async function executePipeline(
  options: ExecutePipelineOptions,
): Promise<PipelineExecutionResult> {
  const startTime = performance.now();
  const {
    runId,
    revision,
    signal = new AbortController().signal,
    crypto = resolveDefaultCrypto(),
    registry = getOperationById,
    maxStepBytes = MAX_STEP_BYTES,
    maxCumulativeBytes = MAX_CUMULATIVE_OUTPUT_BYTES,
    maxSteps = MAX_PIPELINE_STEPS,
    onStepStart,
    onStepResult,
  } = options;

  // Snapshot input and step parameters so external mutations cannot affect the active run
  const snapshotInput = cloneBytes(options.input);
  const snapshotSteps: PipelineStep[] = options.steps.map((s) => ({
    id: s.id,
    operationId: s.operationId,
    enabled: Boolean(s.enabled),
    params: { ...s.params },
  }));

  if (snapshotInput.byteLength > maxStepBytes) {
    const error: OperationError = {
      code: 'LIMIT_EXCEEDED',
      message: `Input size (${snapshotInput.byteLength} bytes) exceeds the ${maxStepBytes}-byte limit.`,
    };
    const notRunSteps: StepResult[] = [];
    markRemainingNotRun(snapshotSteps, 0, notRunSteps);
    return {
      runId,
      revision,
      status: 'error',
      steps: notRunSteps,
      error,
      durationMs: Math.max(0, performance.now() - startTime),
    };
  }

  if (snapshotSteps.length > maxSteps) {
    const error: OperationError = {
      code: 'LIMIT_EXCEEDED',
      message: `Pipeline step count (${snapshotSteps.length}) exceeds the maximum limit of ${maxSteps} steps.`,
    };
    const notRunSteps: StepResult[] = [];
    markRemainingNotRun(snapshotSteps, 0, notRunSteps);
    return {
      runId,
      revision,
      status: 'error',
      steps: notRunSteps,
      error,
      durationMs: Math.max(0, performance.now() - startTime),
    };
  }

  if (snapshotSteps.length === 0) {
    return {
      runId,
      revision,
      status: 'success',
      steps: [],
      output: cloneBytes(snapshotInput),
      durationMs: Math.max(0, performance.now() - startTime),
    };
  }

  const stepResults: StepResult[] = [];
  let currentBytes = snapshotInput;
  let cumulativeRetainedBytes = 0;

  for (let i = 0; i < snapshotSteps.length; i++) {
    const step = snapshotSteps[i];

    if (signal.aborted) {
      const cancelError: OperationError = {
        code: 'CANCELLED',
        message: 'Pipeline execution was cancelled.',
      };
      markRemainingNotRun(snapshotSteps, i, stepResults);
      return {
        runId,
        revision,
        status: 'cancelled',
        steps: stepResults,
        error: cancelError,
        durationMs: Math.max(0, performance.now() - startTime),
      };
    }

    const opDef = registry(step.operationId);
    if (!opDef) {
      const unknownErr: OperationError = {
        code: 'INVALID_PARAMETERS',
        message: `Unknown operation identifier "${step.operationId}".`,
      };
      const errStep: StepResult = {
        stepId: step.id,
        status: 'error',
        error: unknownErr,
        durationMs: 0,
      };
      stepResults.push(errStep);
      onStepResult?.(errStep);
      markRemainingNotRun(snapshotSteps, i + 1, stepResults);
      return {
        runId,
        revision,
        status: 'error',
        steps: stepResults,
        error: unknownErr,
        durationMs: Math.max(0, performance.now() - startTime),
      };
    }

    if (!step.enabled) {
      // Disabled steps do not validate required secrets, but parameter types and byte caps must still be valid
      const disabledErrors = validateParametersAgainstFields(
        opDef.parameters,
        step.params,
        { allowMissingSecrets: true },
      );
      if (disabledErrors.length > 0) {
        const err = disabledErrors[0];
        const errStep: StepResult = {
          stepId: step.id,
          status: 'error',
          error: err,
          durationMs: 0,
        };
        stepResults.push(errStep);
        onStepResult?.(errStep);
        markRemainingNotRun(snapshotSteps, i + 1, stepResults);
        return {
          runId,
          revision,
          status: 'error',
          steps: stepResults,
          error: err,
          durationMs: Math.max(0, performance.now() - startTime),
        };
      }

      if (cumulativeRetainedBytes + currentBytes.byteLength > maxCumulativeBytes) {
        const capErr: OperationError = {
          code: 'LIMIT_EXCEEDED',
          message: `Cumulative retained intermediate outputs exceed the ${maxCumulativeBytes}-byte limit.`,
        };
        const errStep: StepResult = {
          stepId: step.id,
          status: 'error',
          error: capErr,
          durationMs: 0,
        };
        stepResults.push(errStep);
        onStepResult?.(errStep);
        markRemainingNotRun(snapshotSteps, i + 1, stepResults);
        return {
          runId,
          revision,
          status: 'error',
          steps: stepResults,
          error: capErr,
          durationMs: Math.max(0, performance.now() - startTime),
        };
      }

      const bypassedCopy = cloneBytes(currentBytes);
      cumulativeRetainedBytes += bypassedCopy.byteLength;
      const bypassedResult: StepResult = {
        stepId: step.id,
        status: 'bypassed',
        output: bypassedCopy,
        byteLength: bypassedCopy.byteLength,
        durationMs: 0,
      };
      stepResults.push(bypassedResult);
      onStepResult?.(bypassedResult);
      continue;
    }

    onStepStart?.(step.id, step.operationId);
    const stepStart = performance.now();

    const validationErrors = opDef.validate(step.params);
    if (validationErrors.length > 0) {
      const firstError = validationErrors[0];
      const stepDuration = Math.max(0, performance.now() - stepStart);
      const errStep: StepResult = {
        stepId: step.id,
        status: 'error',
        error: firstError,
        durationMs: stepDuration,
      };
      stepResults.push(errStep);
      onStepResult?.(errStep);
      markRemainingNotRun(snapshotSteps, i + 1, stepResults);
      return {
        runId,
        revision,
        status: 'error',
        steps: stepResults,
        error: firstError,
        durationMs: Math.max(0, performance.now() - startTime),
      };
    }

    const opContext: OperationContext = {
      signal,
      crypto,
      maxOutputBytes: maxStepBytes,
    };

    try {
      const stepInput = cloneBytes(currentBytes);
      const rawOutput = await opDef.execute(stepInput, step.params, opContext);
      const stepDuration = Math.max(0, performance.now() - stepStart);

      if (signal.aborted) {
        const cancelError: OperationError = {
          code: 'CANCELLED',
          message: 'Pipeline execution was cancelled.',
        };
        markRemainingNotRun(snapshotSteps, i, stepResults);
        return {
          runId,
          revision,
          status: 'cancelled',
          steps: stepResults,
          error: cancelError,
          durationMs: Math.max(0, performance.now() - startTime),
        };
      }

      if (rawOutput.byteLength > maxStepBytes) {
        throw new OperationFailure(
          'LIMIT_EXCEEDED',
          `Step output (${rawOutput.byteLength} bytes) exceeds the ${maxStepBytes}-byte limit.`,
        );
      }

      if (cumulativeRetainedBytes + rawOutput.byteLength > maxCumulativeBytes) {
        throw new OperationFailure(
          'LIMIT_EXCEEDED',
          `Cumulative retained intermediate outputs exceed the ${maxCumulativeBytes}-byte limit.`,
        );
      }

      const ownedOutput = cloneBytes(rawOutput);
      cumulativeRetainedBytes += ownedOutput.byteLength;
      currentBytes = ownedOutput;

      const successStep: StepResult = {
        stepId: step.id,
        status: 'success',
        output: ownedOutput,
        byteLength: ownedOutput.byteLength,
        durationMs: stepDuration,
      };
      stepResults.push(successStep);
      onStepResult?.(successStep);
    } catch (err) {
      const stepDuration = Math.max(0, performance.now() - stepStart);
      const normalized = normalizeUnknownError(err);

      if (normalized.code === 'CANCELLED' || signal.aborted) {
        markRemainingNotRun(snapshotSteps, i, stepResults);
        return {
          runId,
          revision,
          status: 'cancelled',
          steps: stepResults,
          error: {
            code: 'CANCELLED',
            message: 'Pipeline execution was cancelled.',
          },
          durationMs: Math.max(0, performance.now() - startTime),
        };
      }

      const errStep: StepResult = {
        stepId: step.id,
        status: 'error',
        error: normalized,
        durationMs: stepDuration,
      };
      stepResults.push(errStep);
      onStepResult?.(errStep);
      markRemainingNotRun(snapshotSteps, i + 1, stepResults);
      return {
        runId,
        revision,
        status: 'error',
        steps: stepResults,
        error: normalized,
        durationMs: Math.max(0, performance.now() - startTime),
      };
    }
  }

  return {
    runId,
    revision,
    status: 'success',
    steps: stepResults,
    output: cloneBytes(currentBytes),
    durationMs: Math.max(0, performance.now() - startTime),
  };
}
