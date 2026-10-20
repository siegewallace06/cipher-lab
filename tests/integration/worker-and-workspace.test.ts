import { describe, expect, it } from 'vitest';
import {
  PipelineWorkerClient,
  createInProcessWorker,
  type WorkerLike,
} from '@/engine/worker-client';
import type { WorkerOutboundMessage, WorkerRunMessage } from '@/engine/types';
import { decodeUtf8Fatal, encodeUtf8 } from '@/lib/bytes';
import { DetectionWorkerClient } from '@/lib/detection';
import { getPresetById } from '@/lib/presets';
import {
  canPromoteOrDownloadOutput,
  createInitialWorkspaceState,
  isResultStale,
  validateStepParameters,
  workspaceReducer,
} from '@/state/workspace';

describe('PipelineWorkerClient & DetectionWorkerClient Integration', () => {
  it('executes pipelines via in-process worker protocol and emits step progress', async () => {
    const client = new PipelineWorkerClient({
      workerFactory: createInProcessWorker,
    });
    const progressLengths: number[] = [];

    const result = await client.run({
      revision: 1,
      input: encodeUtf8('Hello'),
      steps: [
        {
          id: 'step-1',
          operationId: 'base64',
          enabled: true,
          params: { direction: 'encode', alphabet: 'standard', padding: true },
        },
        {
          id: 'step-2',
          operationId: 'hex',
          enabled: true,
          params: { direction: 'encode', case: 'lower' },
        },
      ],
      onProgress(steps) {
        progressLengths.push(steps.filter((s) => s.status === 'success').length);
      },
    });

    expect(client.getActiveWorkerCount()).toBe(0);
    expect(progressLengths).toEqual([1, 2]);
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      // 'Hello' -> Base64 'SGVsbG8=' -> Hex '534756736247383d'
      expect(decodeUtf8Fatal(result.output)).toBe('534756736247383d');
    }
  });

  it('enforces single-active-worker invariant and cancels older run when a newer run starts', async () => {
    let terminatedCount = 0;

    const slowWorkerFactory = (): WorkerLike => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const w: WorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage(msg: WorkerRunMessage) {
          timer = setTimeout(() => {
            w.onmessage?.(
              new MessageEvent<WorkerOutboundMessage>('message', {
                data: {
                  type: 'complete',
                  result: {
                    runId: msg.runId,
                    revision: msg.revision,
                    status: 'success',
                    steps: [],
                    output: msg.input,
                    durationMs: 10,
                  },
                },
              }),
            );
          }, 50);
        },
        terminate() {
          terminatedCount++;
          if (timer) clearTimeout(timer);
        },
      };
      return w;
    };

    const client = new PipelineWorkerClient({
      workerFactory: slowWorkerFactory,
    });

    const run1Promise = client.run({
      runId: 'run-1',
      revision: 1,
      input: encodeUtf8('first'),
      steps: [],
    });
    expect(client.getActiveWorkerCount()).toBe(1);

    const run2Promise = client.run({
      runId: 'run-2',
      revision: 2,
      input: encodeUtf8('second'),
      steps: [],
    });
    // Still at most 1 active worker
    expect(client.getActiveWorkerCount()).toBe(1);

    const [res1, res2] = await Promise.all([run1Promise, run2Promise]);
    expect(res1.status).toBe('cancelled');
    expect(res2.status).toBe('success');
    expect(terminatedCount).toBeGreaterThanOrEqual(2);
    expect(client.getActiveWorkerCount()).toBe(0);
  });

  it('terminates stalled regex step with TIMEOUT when 100 ms regex watchdog fires', async () => {
    const stalledRegexWorkerFactory = (): WorkerLike => {
      const w: WorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage(msg: WorkerRunMessage) {
          // Emit step-start for regex and then hang indefinitely (simulating catastrophic backtracking)
          w.onmessage?.({
            data: {
              type: 'step-start',
              runId: msg.runId,
              revision: msg.revision,
              stepId: 'regex-step',
              operationId: 'regex',
            },
          } as MessageEvent<WorkerOutboundMessage>);
        },
        terminate() {},
      };
      return w;
    };

    const client = new PipelineWorkerClient({
      workerFactory: stalledRegexWorkerFactory,
      budgets: {
        regexStepMs: 40, // fast test budget (production default is 100 ms)
      },
    });

    const result = await client.run({
      revision: 10,
      input: encodeUtf8('aaaaaaaaaaaaaaaaaaaaaaaa!'),
      steps: [
        {
          id: 'regex-step',
          operationId: 'regex',
          enabled: true,
          params: {
            pattern: '(a+)+$',
            replacement: 'x',
            mode: 'replace',
            flags: 'g',
          },
        },
        {
          id: 'downstream-step',
          operationId: 'rot13',
          enabled: true,
          params: {},
        },
      ],
    });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('TIMEOUT');
      expect(result.steps[0].status).toBe('error');
      expect(result.steps[1]).toEqual({
        stepId: 'downstream-step',
        status: 'not-run',
      });
    }
    expect(client.getActiveWorkerCount()).toBe(0);
  });

  it('handles worker startup timeout and worker runtime crash cleanly', async () => {
    // 1. Startup timeout (worker never posts step-start or complete)
    const silentWorkerClient = new PipelineWorkerClient({
      workerFactory: () => ({
        onmessage: null,
        onerror: null,
        postMessage() {},
        terminate() {},
      }),
      budgets: { startupMs: 30 },
    });

    const timeoutRes = await silentWorkerClient.run({
      revision: 1,
      input: encodeUtf8('test'),
      steps: [{ id: 's1', operationId: 'rot13', enabled: true, params: {} }],
    });
    expect(timeoutRes.status).toBe('error');
    if (timeoutRes.status === 'error') {
      expect(timeoutRes.error.code).toBe('TIMEOUT');
    }

    // 2. Worker crash via onerror
    const crashWorkerClient = new PipelineWorkerClient({
      workerFactory: () => {
        const w: WorkerLike = {
          onmessage: null,
          onerror: null,
          postMessage() {
            queueMicrotask(() => {
              w.onerror?.({} as ErrorEvent);
            });
          },
          terminate() {},
        };
        return w;
      },
    });

    const crashRes = await crashWorkerClient.run({
      revision: 2,
      input: encodeUtf8('test'),
      steps: [{ id: 's1', operationId: 'rot13', enabled: true, params: {} }],
    });
    expect(crashRes.status).toBe('error');
    if (crashRes.status === 'error') {
      expect(crashRes.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('DetectionWorkerClient falls back or times out cleanly and keeps active worker count <= 1', async () => {
    // Fallback when Worker constructor throws
    const fallbackClient = new DetectionWorkerClient(() => {
      throw new Error('No Worker');
    });
    const res = await fallbackClient.detect(
      encodeUtf8('{"hello":"world"}'),
      1,
    );
    expect(res.status).toBe('ok');
    expect(res.candidates[0]?.format).toBe('json');
    expect(fallbackClient.getActiveWorkerCount()).toBe(0);
  });
});

describe('Workspace State Reducer & Selectors (workspace.ts)', () => {
  it('manages input editing, hex draft validation, step mutations, and output promotion', () => {
    let state = createInitialWorkspaceState();
    expect(state.revision).toBe(1);

    // 1. Set UTF-8 text input
    state = workspaceReducer(state, {
      type: 'set-input-text',
      text: 'Hello',
    });
    expect(state.revision).toBe(2);
    expect(decodeUtf8Fatal(state.inputBytes)).toBe('Hello');

    // 2. Invalid hex draft preserves last committed inputBytes and does not bump revision
    state = workspaceReducer(state, {
      type: 'set-input-hex-draft',
      hexDraft: '486', // odd digits
    });
    expect(state.revision).toBe(2);
    expect(state.inputDraftError?.code).toBe('INVALID_INPUT');
    expect(decodeUtf8Fatal(state.inputBytes)).toBe('Hello');

    // 3. Valid hex draft updates inputBytes and bumps revision
    state = workspaceReducer(state, {
      type: 'set-input-hex-draft',
      hexDraft: '41 42',
    });
    expect(state.revision).toBe(3);
    expect(state.inputDraftError).toBeNull();
    expect(decodeUtf8Fatal(state.inputBytes)).toBe('AB');

    // 4. Add, duplicate, reorder, toggle, and update steps
    state = workspaceReducer(state, {
      type: 'add-step',
      operationId: 'caesar',
      stepId: 'step-caesar',
    });
    expect(state.steps).toHaveLength(1);
    expect(state.selectedStepId).toBe('step-caesar');

    state = workspaceReducer(state, {
      type: 'duplicate-step',
      stepId: 'step-caesar',
      newStepId: 'step-caesar-copy',
    });
    expect(state.steps.map((s) => s.id)).toEqual([
      'step-caesar',
      'step-caesar-copy',
    ]);

    state = workspaceReducer(state, {
      type: 'move-step',
      stepId: 'step-caesar-copy',
      direction: 'up',
    });
    expect(state.steps.map((s) => s.id)).toEqual([
      'step-caesar-copy',
      'step-caesar',
    ]);

    state = workspaceReducer(state, {
      type: 'toggle-step-enabled',
      stepId: 'step-caesar-copy',
    });
    expect(state.steps[0].enabled).toBe(false);

    // 5. Complete run at current revision and promote binary output to input
    const currentRev = state.revision;
    state = workspaceReducer(state, {
      type: 'run-completed',
      result: {
        runId: 'r-1',
        revision: currentRev,
        status: 'success',
        steps: [],
        output: new Uint8Array([0xff, 0x00, 0xfe]), // non-UTF8 binary bytes
        durationMs: 5,
      },
    });
    expect(isResultStale(state)).toBe(false);
    expect(canPromoteOrDownloadOutput(state)).toBe(true);

    // Promoting non-UTF8 output switches inputEntryMode to 'hex' automatically
    state = workspaceReducer(state, { type: 'promote-output-to-input' });
    expect(state.inputEntryMode).toBe('hex');
    expect(state.inputDraftText).toBe('ff00fe');
    expect(Array.from(state.inputBytes)).toEqual([0xff, 0x00, 0xfe]);
  });

  it('loads presets and validates disabled steps with missing secrets without error', () => {
    let state = createInitialWorkspaceState();
    const preset = getPresetById('text-base64-url')!;
    state = workspaceReducer(state, { type: 'load-preset', preset });
    expect(state.steps).toHaveLength(2);

    // Disabled AES step with missing passphrase should not report validation error
    const disabledAes = {
      id: 'aes-1',
      operationId: 'aes-gcm',
      enabled: false,
      params: { direction: 'encrypt' },
    };
    expect(validateStepParameters(disabledAes)).toEqual([]);

    // Enabled AES step with missing passphrase reports INVALID_PARAMETERS
    const enabledAes = { ...disabledAes, enabled: true };
    expect(validateStepParameters(enabledAes)[0]?.code).toBe(
      'INVALID_PARAMETERS',
    );
  });
});
