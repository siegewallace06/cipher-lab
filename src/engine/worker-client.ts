import { executePipeline } from '@/engine/execute';
import type {
  OperationError,
  PipelineExecutionResult,
  PipelineStep,
  StepResult,
  WorkerOutboundMessage,
  WorkerRunMessage,
} from '@/engine/types';
import { cloneBytes } from '@/lib/bytes';
import {
  AES_STEP_TIMEOUT_MS,
  MAX_CUMULATIVE_OUTPUT_BYTES,
  ORDINARY_STEP_TIMEOUT_MS,
  REGEX_STEP_TIMEOUT_MS,
  TOTAL_RUN_TIMEOUT_MS,
  WORKER_STARTUP_TIMEOUT_MS,
} from '@/lib/limits';

export interface WorkerLike {
  onmessage: ((event: MessageEvent<WorkerOutboundMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
  postMessage: (message: WorkerRunMessage, transfer: Transferable[]) => void;
  terminate: () => void;
}

export type WorkerFactory = () => WorkerLike;

export interface StepTimeoutBudgets {
  startupMs: number;
  ordinaryStepMs: number;
  aesStepMs: number;
  regexStepMs: number;
  totalRunMs: number;
}

const DEFAULT_BUDGETS: StepTimeoutBudgets = {
  startupMs: WORKER_STARTUP_TIMEOUT_MS,
  ordinaryStepMs: ORDINARY_STEP_TIMEOUT_MS,
  aesStepMs: AES_STEP_TIMEOUT_MS,
  regexStepMs: REGEX_STEP_TIMEOUT_MS,
  totalRunMs: TOTAL_RUN_TIMEOUT_MS,
};

function getStepBudgetMs(
  operationId: string,
  budgets: StepTimeoutBudgets,
): number {
  if (operationId === 'regex') return budgets.regexStepMs;
  if (operationId === 'aes-gcm') return budgets.aesStepMs;
  return budgets.ordinaryStepMs;
}

function defaultWorkerFactory(): WorkerLike {
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are not supported in this environment.');
  }
  return new Worker(new URL('./worker.ts', import.meta.url));
}

/**
 * Creates an in-process simulated WorkerLike for unit/integration environments where native
 * browser module workers are unavailable, while preserving the exact message protocol.
 */
export function createInProcessWorker(): WorkerLike {
  let terminated = false;
  const controller = new AbortController();

  const workerLike: WorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message: WorkerRunMessage) {
      if (terminated || message.type !== 'run') return;
      const { runId, revision, input, steps } = message;

      queueMicrotask(async () => {
        if (terminated) return;
        const result = await executePipeline({
          runId,
          revision,
          input,
          steps,
          signal: controller.signal,
          onStepStart(stepId, operationId) {
            if (terminated) return;
            workerLike.onmessage?.({
              data: {
                type: 'step-start',
                runId,
                revision,
                stepId,
                operationId,
              },
            } as MessageEvent<WorkerOutboundMessage>);
          },
          onStepResult(stepResult) {
            if (terminated) return;
            workerLike.onmessage?.({
              data: {
                type: 'step-result',
                runId,
                revision,
                result: stepResult,
              },
            } as MessageEvent<WorkerOutboundMessage>);
          },
        });

        if (terminated) return;
        workerLike.onmessage?.({
          data: {
            type: 'complete',
            result,
          },
        } as MessageEvent<WorkerOutboundMessage>);
      });
    },
    terminate() {
      terminated = true;
      controller.abort();
      workerLike.onmessage = null;
      workerLike.onerror = null;
      workerLike.onmessageerror = null;
    },
  };

  return workerLike;
}

export interface PipelineRunRequest {
  runId?: string;
  revision: number;
  input: Uint8Array;
  steps: readonly PipelineStep[];
  onProgress?: (partialSteps: readonly StepResult[]) => void;
}

interface ActiveJob {
  runId: string;
  revision: number;
  steps: readonly PipelineStep[];
  worker: WorkerLike;
  startTime: number;
  stepStartTime: number;
  activeStepId: string | null;
  activeOperationId: string | null;
  partialResults: Map<string, StepResult>;
  cumulativeBytes: number;
  stepTimer: ReturnType<typeof setTimeout> | null;
  totalTimer: ReturnType<typeof setTimeout> | null;
  resolve: (result: PipelineExecutionResult) => void;
  settled: boolean;
}

let runCounter = 0;
function nextRunId(): string {
  runCounter += 1;
  return `run-${Date.now().toString(36)}-${runCounter.toString(36)}`;
}

export class PipelineWorkerClient {
  private activeJob: ActiveJob | null = null;
  private latestRevision = 0;
  private activeWorkerCount = 0;
  private readonly createWorker: WorkerFactory;
  private readonly budgets: StepTimeoutBudgets;
  private readonly maxCumulativeBytes: number;

  constructor(options?: {
    workerFactory?: WorkerFactory;
    budgets?: Partial<StepTimeoutBudgets>;
    maxCumulativeBytes?: number;
  }) {
    this.createWorker = options?.workerFactory ?? defaultWorkerFactory;
    this.budgets = { ...DEFAULT_BUDGETS, ...(options?.budgets ?? {}) };
    this.maxCumulativeBytes =
      options?.maxCumulativeBytes ?? MAX_CUMULATIVE_OUTPUT_BYTES;
  }

  public getActiveWorkerCount(): number {
    return this.activeWorkerCount;
  }

  public getActiveRunId(): string | null {
    return this.activeJob?.runId ?? null;
  }

  private clearJobTimers(job: ActiveJob): void {
    if (job.stepTimer !== null) {
      clearTimeout(job.stepTimer);
      job.stepTimer = null;
    }
    if (job.totalTimer !== null) {
      clearTimeout(job.totalTimer);
      job.totalTimer = null;
    }
  }

  private terminateJobWorker(job: ActiveJob): void {
    this.clearJobTimers(job);
    job.worker.onmessage = null;
    job.worker.onerror = null;
    if ('onmessageerror' in job.worker) {
      job.worker.onmessageerror = null;
    }
    try {
      job.worker.terminate();
    } finally {
      this.activeWorkerCount = Math.max(0, this.activeWorkerCount - 1);
    }
    if (this.activeJob === job) {
      this.activeJob = null;
    }
  }

  private assembleSynthesizedSteps(
    job: ActiveJob,
    terminalStepError?: { stepId: string; error: OperationError; durationMs: number },
  ): StepResult[] {
    const out: StepResult[] = [];
    let failedSeen = false;

    for (const step of job.steps) {
      if (failedSeen) {
        out.push({ stepId: step.id, status: 'not-run' });
        continue;
      }
      const existing = job.partialResults.get(step.id);
      if (existing) {
        out.push(existing);
        if (existing.status === 'error') {
          failedSeen = true;
        }
        continue;
      }
      if (terminalStepError && terminalStepError.stepId === step.id) {
        out.push({
          stepId: step.id,
          status: 'error',
          error: terminalStepError.error,
          durationMs: terminalStepError.durationMs,
        });
        failedSeen = true;
        continue;
      }
      out.push({ stepId: step.id, status: 'not-run' });
    }

    return out;
  }

  private settleWithSyntheticResult(
    job: ActiveJob,
    status: 'error' | 'cancelled',
    error: OperationError,
    terminalStepError?: { stepId: string; error: OperationError; durationMs: number },
  ): void {
    if (job.settled) return;
    job.settled = true;
    const durationMs = Math.max(0, performance.now() - job.startTime);
    this.terminateJobWorker(job);
    const steps = this.assembleSynthesizedSteps(job, terminalStepError);
    job.resolve({
      runId: job.runId,
      revision: job.revision,
      status,
      steps,
      error,
      durationMs,
    });
  }

  private armStepWatchdog(job: ActiveJob, timeoutMs: number, reason: string): void {
    if (job.stepTimer !== null) {
      clearTimeout(job.stepTimer);
    }
    job.stepTimer = setTimeout(() => {
      const error: OperationError = {
        code: 'TIMEOUT',
        message: reason,
      };
      const stepDuration = Math.max(0, performance.now() - job.stepStartTime);
      const terminalStep =
        job.activeStepId !== null
          ? { stepId: job.activeStepId, error, durationMs: stepDuration }
          : undefined;
      this.settleWithSyntheticResult(job, 'error', error, terminalStep);
    }, timeoutMs);
  }

  public cancelActiveRun(): PipelineExecutionResult | null {
    const job = this.activeJob;
    if (!job || job.settled) return null;

    const cancelError: OperationError = {
      code: 'CANCELLED',
      message: 'Execution cancelled by user.',
    };
    const durationMs = Math.max(0, performance.now() - job.startTime);
    const steps = this.assembleSynthesizedSteps(job);
    const result: PipelineExecutionResult = {
      runId: job.runId,
      revision: job.revision,
      status: 'cancelled',
      steps,
      error: cancelError,
      durationMs,
    };

    job.settled = true;
    this.terminateJobWorker(job);
    job.resolve(result);
    return result;
  }

  public destroy(): void {
    if (this.activeJob) {
      this.cancelActiveRun();
    }
  }

  public run(request: PipelineRunRequest): Promise<PipelineExecutionResult> {
    const runId = request.runId ?? nextRunId();
    const revision = request.revision;
    this.latestRevision = Math.max(this.latestRevision, revision);

    // Immediately terminate any previous running worker before starting replacement
    if (this.activeJob && !this.activeJob.settled) {
      this.cancelActiveRun();
    }

    const copiedInput = cloneBytes(request.input);
    const copiedSteps: PipelineStep[] = request.steps.map((s) => ({
      id: s.id,
      operationId: s.operationId,
      enabled: Boolean(s.enabled),
      params: { ...s.params },
    }));

    return new Promise<PipelineExecutionResult>((resolve) => {
      let worker: WorkerLike;
      try {
        worker = this.createWorker();
        this.activeWorkerCount += 1;
      } catch {
        const notRunSteps: StepResult[] = copiedSteps.map((s) => ({
          stepId: s.id,
          status: 'not-run',
        }));
        resolve({
          runId,
          revision,
          status: 'error',
          steps: notRunSteps,
          error: {
            code: 'UNSUPPORTED_ENVIRONMENT',
            message: 'Web Workers are unavailable in this browser environment.',
          },
          durationMs: 0,
        });
        return;
      }

      const now = performance.now();
      const job: ActiveJob = {
        runId,
        revision,
        steps: copiedSteps,
        worker,
        startTime: now,
        stepStartTime: now,
        activeStepId: null,
        activeOperationId: null,
        partialResults: new Map(),
        cumulativeBytes: 0,
        stepTimer: null,
        totalTimer: null,
        resolve,
        settled: false,
      };

      this.activeJob = job;

      // Arm initial worker startup watchdog
      this.armStepWatchdog(
        job,
        this.budgets.startupMs,
        `Worker failed to respond within the ${this.budgets.startupMs} ms startup budget.`,
      );

      // Arm total run deadline
      job.totalTimer = setTimeout(() => {
        const error: OperationError = {
          code: 'TIMEOUT',
          message: `Pipeline execution exceeded the ${this.budgets.totalRunMs} ms total runtime limit.`,
        };
        const stepDuration = Math.max(0, performance.now() - job.stepStartTime);
        const terminalStep =
          job.activeStepId !== null
            ? { stepId: job.activeStepId, error, durationMs: stepDuration }
            : undefined;
        this.settleWithSyntheticResult(job, 'error', error, terminalStep);
      }, this.budgets.totalRunMs);

      worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
        if (job.settled) return;
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'step-start') {
          if (msg.runId !== job.runId || msg.revision !== job.revision) {
            return;
          }
          job.activeStepId = msg.stepId;
          job.activeOperationId = msg.operationId;
          job.stepStartTime = performance.now();
          const stepBudget = getStepBudgetMs(msg.operationId, this.budgets);
          this.armStepWatchdog(
            job,
            stepBudget,
            `Step "${msg.operationId}" exceeded its ${stepBudget} ms execution limit.`,
          );
          return;
        }

        if (msg.type === 'step-result') {
          if (msg.runId !== job.runId || msg.revision !== job.revision) {
            return;
          }
          const stepRes = msg.result;
          if (
            stepRes.status === 'success' ||
            stepRes.status === 'bypassed'
          ) {
            const addedBytes = stepRes.output.byteLength;
            if (job.cumulativeBytes + addedBytes > this.maxCumulativeBytes) {
              const limitErr: OperationError = {
                code: 'LIMIT_EXCEEDED',
                message: `Cumulative retained intermediate outputs exceed the ${this.maxCumulativeBytes}-byte limit.`,
              };
              this.settleWithSyntheticResult(job, 'error', limitErr, {
                stepId: stepRes.stepId,
                error: limitErr,
                durationMs: stepRes.durationMs,
              });
              return;
            }
            job.cumulativeBytes += addedBytes;
          }
          job.partialResults.set(stepRes.stepId, stepRes);
          job.activeStepId = null;
          job.activeOperationId = null;
          request.onProgress?.(this.assembleSynthesizedSteps(job));
          return;
        }

        if (msg.type === 'complete') {
          const result = msg.result;
          if (
            !result ||
            result.runId !== job.runId ||
            result.revision !== job.revision
          ) {
            return;
          }
          job.settled = true;
          this.terminateJobWorker(job);
          job.resolve(result);
        }
      };

      worker.onerror = () => {
        if (job.settled) return;
        const crashErr: OperationError = {
          code: 'INTERNAL_ERROR',
          message: 'Worker terminated unexpectedly due to a runtime error.',
        };
        const terminalStep =
          job.activeStepId !== null
            ? {
                stepId: job.activeStepId,
                error: crashErr,
                durationMs: Math.max(0, performance.now() - job.stepStartTime),
              }
            : undefined;
        this.settleWithSyntheticResult(job, 'error', crashErr, terminalStep);
      };

      if ('onmessageerror' in worker) {
        worker.onmessageerror = () => {
          if (job.settled) return;
          const msgErr: OperationError = {
            code: 'INTERNAL_ERROR',
            message: 'Worker message deserialization failed.',
          };
          this.settleWithSyntheticResult(job, 'error', msgErr);
        };
      }

      const transferBuffer = copiedInput.buffer;
      worker.postMessage(
        {
          type: 'run',
          runId,
          revision,
          input: copiedInput,
          steps: copiedSteps,
        },
        transferBuffer instanceof ArrayBuffer ? [transferBuffer] : [],
      );
    });
  }
}
