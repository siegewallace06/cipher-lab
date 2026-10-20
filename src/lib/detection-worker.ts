import {
  detectFormats,
  type DetectionWorkerRequest,
  type DetectionWorkerResponse,
} from './detection';

interface WorkerScopeLike {
  postMessage(message: DetectionWorkerResponse): void;
  onmessage: ((event: MessageEvent<DetectionWorkerRequest>) => void) | null;
}

export function attachDetectionWorkerListener(scope: WorkerScopeLike): void {
  scope.onmessage = (event: MessageEvent<DetectionWorkerRequest>) => {
    const message = event.data;
    if (!message || message.type !== 'detect') {
      return;
    }
    const result = detectFormats(message.input, message.revision);
    scope.postMessage({
      type: 'detect-complete',
      jobId: message.jobId,
      revision: message.revision,
      result,
    });
  };
}

if (
  typeof self !== 'undefined' &&
  typeof (self as unknown as WorkerScopeLike).postMessage === 'function' &&
  typeof document === 'undefined'
) {
  attachDetectionWorkerListener(self as unknown as WorkerScopeLike);
}
