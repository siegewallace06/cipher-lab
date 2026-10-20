import { executePipeline } from '@/engine/execute';
import type { WorkerOutboundMessage, WorkerRunMessage } from '@/engine/types';

export function attachPipelineWorkerScope(scope: {
  onmessage: ((event: MessageEvent<WorkerRunMessage>) => void) | null;
  postMessage: (message: WorkerOutboundMessage) => void;
}): void {
  let activeController: AbortController | null = null;

  scope.onmessage = async (event: MessageEvent<WorkerRunMessage>) => {
    const data = event.data;
    if (!data || data.type !== 'run') {
      return;
    }

    if (activeController) {
      activeController.abort();
    }
    const controller = new AbortController();
    activeController = controller;

    const { runId, revision, input, steps } = data;

    const result = await executePipeline({
      runId,
      revision,
      input,
      steps,
      signal: controller.signal,
      onStepStart(stepId, operationId) {
        scope.postMessage({
          type: 'step-start',
          runId,
          revision,
          stepId,
          operationId,
        });
      },
      onStepResult(stepResult) {
        scope.postMessage({
          type: 'step-result',
          runId,
          revision,
          result: stepResult,
        });
      },
    });

    scope.postMessage({
      type: 'complete',
      result,
    });
  };
}

if (
  typeof self !== 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage ===
    'function' &&
  typeof document === 'undefined'
) {
  attachPipelineWorkerScope(
    self as unknown as {
      onmessage: ((event: MessageEvent<WorkerRunMessage>) => void) | null;
      postMessage: (message: WorkerOutboundMessage) => void;
    },
  );
}
