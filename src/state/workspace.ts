import { getOperationById } from '../engine/registry';
import type {
  OperationError,
  ParameterValue,
  PipelineExecutionResult,
  PipelineStep,
  StepResult,
} from '../engine/types';
import {
  decodeHex,
  decodeUtf8OrNull,
  encodeHex,
  encodeUtf8,
} from '../lib/bytes';
import type { DetectionResult } from '../lib/detection';
import { MAX_PIPELINE_STEPS, MAX_STEP_BYTES } from '../lib/limits';
import {
  createDefaultParameters,
  validateParametersAgainstFields,
} from '../lib/parameter-schema';
import {
  DEFAULT_SAMPLE_TEXT,
  generateStepId,
  instantiatePreset,
  type PipelinePreset,
} from '../lib/presets';
import type { OmittedSecretSummary } from '../lib/url-state';

export type InputEntryMode = 'utf8' | 'hex';
export type DataViewMode = 'text' | 'hex';
export type ThemePreference = 'system' | 'light' | 'dark';
export type RunLifecycleStatus = 'idle' | 'running' | 'error' | 'cancelled';

export interface RestoredStateNotice {
  includesInput: boolean;
  missingSecrets: OmittedSecretSummary[];
}

export interface WorkspaceState {
  inputBytes: Uint8Array;
  inputRevision: number;
  inputEntryMode: InputEntryMode;
  inputDraftText: string;
  inputDraftError: OperationError | null;
  inputViewMode: DataViewMode;
  outputViewMode: DataViewMode;
  steps: PipelineStep[];
  selectedStepId: string | null;
  autoRun: boolean;
  revision: number;
  runStatus: RunLifecycleStatus;
  activeRunId: string | null;
  activeRunRevision: number | null;
  executionResult: PipelineExecutionResult | null;
  resultRevision: number | null;
  inputDetection: DetectionResult | null;
  dismissedInputDetectionRevision: number | null;
  outputDetection: DetectionResult | null;
  dismissedOutputDetectionRevision: number | null;
  restoredNotice: RestoredStateNotice | null;
  importError: OperationError | null;
  theme: ThemePreference;
}

export type WorkspaceAction =
  | { type: 'set-input-text'; text: string }
  | { type: 'set-input-hex-draft'; hexDraft: string }
  | { type: 'set-input-bytes'; bytes: Uint8Array }
  | { type: 'set-input-entry-mode'; mode: InputEntryMode }
  | { type: 'set-input-view-mode'; mode: DataViewMode }
  | { type: 'set-output-view-mode'; mode: DataViewMode }
  | { type: 'load-sample-input'; sampleText?: string }
  | {
      type: 'add-step';
      operationId: string;
      params?: Record<string, ParameterValue>;
      stepId?: string;
    }
  | { type: 'duplicate-step'; stepId: string; newStepId?: string }
  | { type: 'remove-step'; stepId: string }
  | { type: 'move-step'; stepId: string; direction: 'up' | 'down' }
  | { type: 'toggle-step-enabled'; stepId: string }
  | {
      type: 'update-step-param';
      stepId: string;
      key: string;
      value: ParameterValue;
    }
  | { type: 'select-step'; stepId: string | null }
  | { type: 'set-auto-run'; autoRun: boolean }
  | { type: 'run-started'; runId: string; revision: number }
  | { type: 'run-completed'; result: PipelineExecutionResult }
  | { type: 'run-cancelled'; revision: number }
  | { type: 'set-input-detection'; result: DetectionResult }
  | { type: 'dismiss-input-detection' }
  | { type: 'set-output-detection'; result: DetectionResult }
  | { type: 'dismiss-output-detection' }
  | { type: 'load-preset'; preset: PipelinePreset }
  | {
      type: 'restore-from-url';
      steps: PipelineStep[];
      inputBytes: Uint8Array | null;
      missingSecrets: OmittedSecretSummary[];
    }
  | { type: 'set-import-error'; error: OperationError | null }
  | { type: 'dismiss-restore-notice' }
  | { type: 'clear-workspace' }
  | { type: 'promote-output-to-input' }
  | { type: 'set-theme'; theme: ThemePreference };

export function createInitialWorkspaceState(): WorkspaceState {
  return {
    inputBytes: new Uint8Array(0),
    inputRevision: 1,
    inputEntryMode: 'utf8',
    inputDraftText: '',
    inputDraftError: null,
    inputViewMode: 'text',
    outputViewMode: 'text',
    steps: [],
    selectedStepId: null,
    autoRun: true,
    revision: 1,
    runStatus: 'idle',
    activeRunId: null,
    activeRunRevision: null,
    executionResult: null,
    resultRevision: null,
    inputDetection: null,
    dismissedInputDetectionRevision: null,
    outputDetection: null,
    dismissedOutputDetectionRevision: null,
    restoredNotice: null,
    importError: null,
    theme: 'system',
  };
}

function syncDraftFromBytes(
  bytes: Uint8Array,
  mode: InputEntryMode,
): { draftText: string; effectiveMode: InputEntryMode } {
  if (mode === 'hex') {
    return {
      draftText: encodeHex(bytes, 'lower'),
      effectiveMode: 'hex',
    };
  }
  const utf8 = decodeUtf8OrNull(bytes);
  if (utf8 !== null) {
    return {
      draftText: utf8,
      effectiveMode: 'utf8',
    };
  }
  return {
    draftText: encodeHex(bytes, 'lower'),
    effectiveMode: 'hex',
  };
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case 'set-input-text': {
      const encoded = encodeUtf8(action.text);
      if (encoded.byteLength > MAX_STEP_BYTES) {
        return {
          ...state,
          inputDraftText: action.text,
          inputDraftError: {
            code: 'LIMIT_EXCEEDED',
            message: `Input exceeds the maximum size of ${MAX_STEP_BYTES.toLocaleString()} bytes.`,
          },
        };
      }
      const nextRevision = state.revision + 1;
      const nextInputRevision = state.inputRevision + 1;
      return {
        ...state,
        inputEntryMode: 'utf8',
        inputDraftText: action.text,
        inputDraftError: null,
        inputBytes: encoded,
        inputRevision: nextInputRevision,
        revision: nextRevision,
      };
    }

    case 'set-input-hex-draft': {
      const raw = action.hexDraft;
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        const nextRevision = state.revision + 1;
        const nextInputRevision = state.inputRevision + 1;
        return {
          ...state,
          inputEntryMode: 'hex',
          inputDraftText: raw,
          inputDraftError: null,
          inputBytes: new Uint8Array(0),
          inputRevision: nextInputRevision,
          revision: nextRevision,
        };
      }
      const decoded = decodeHex(raw);
      if (!decoded) {
        // Keep previous committed inputBytes intact and do not increment revision
        return {
          ...state,
          inputEntryMode: 'hex',
          inputDraftText: raw,
          inputDraftError: {
            code: 'INVALID_INPUT',
            message:
              'Invalid hexadecimal input: enter complete two-digit hex byte pairs separated only by optional whitespace.',
          },
        };
      }
      if (decoded.byteLength > MAX_STEP_BYTES) {
        return {
          ...state,
          inputEntryMode: 'hex',
          inputDraftText: raw,
          inputDraftError: {
            code: 'LIMIT_EXCEEDED',
            message: `Decoded hex input exceeds the maximum size of ${MAX_STEP_BYTES.toLocaleString()} bytes.`,
          },
        };
      }
      const nextRevision = state.revision + 1;
      const nextInputRevision = state.inputRevision + 1;
      return {
        ...state,
        inputEntryMode: 'hex',
        inputDraftText: raw,
        inputDraftError: null,
        inputBytes: decoded,
        inputRevision: nextInputRevision,
        revision: nextRevision,
      };
    }

    case 'set-input-bytes': {
      if (action.bytes.byteLength > MAX_STEP_BYTES) {
        return {
          ...state,
          inputDraftError: {
            code: 'LIMIT_EXCEEDED',
            message: `Input exceeds the maximum size of ${MAX_STEP_BYTES.toLocaleString()} bytes.`,
          },
        };
      }
      const copy = action.bytes.slice();
      const synced = syncDraftFromBytes(copy, state.inputEntryMode);
      const nextRevision = state.revision + 1;
      const nextInputRevision = state.inputRevision + 1;
      return {
        ...state,
        inputBytes: copy,
        inputEntryMode: synced.effectiveMode,
        inputDraftText: synced.draftText,
        inputDraftError: null,
        inputRevision: nextInputRevision,
        revision: nextRevision,
      };
    }

    case 'set-input-entry-mode': {
      if (action.mode === state.inputEntryMode) {
        return state;
      }
      if (action.mode === 'utf8') {
        const decoded = decodeUtf8OrNull(state.inputBytes);
        if (decoded === null) {
          return {
            ...state,
            inputDraftError: {
              code: 'INVALID_UTF8',
              message:
                'Current input bytes are not valid UTF-8 and cannot be edited in UTF-8 text mode without data loss.',
            },
          };
        }
        return {
          ...state,
          inputEntryMode: 'utf8',
          inputDraftText: decoded,
          inputDraftError: null,
        };
      }
      return {
        ...state,
        inputEntryMode: 'hex',
        inputDraftText: encodeHex(state.inputBytes, 'lower'),
        inputDraftError: null,
      };
    }

    case 'set-input-view-mode': {
      return {
        ...state,
        inputViewMode: action.mode,
      };
    }

    case 'set-output-view-mode': {
      return {
        ...state,
        outputViewMode: action.mode,
      };
    }

    case 'load-sample-input': {
      const sample = action.sampleText ?? DEFAULT_SAMPLE_TEXT;
      const bytes = encodeUtf8(sample);
      const nextRevision = state.revision + 1;
      const nextInputRevision = state.inputRevision + 1;
      return {
        ...state,
        inputEntryMode: 'utf8',
        inputDraftText: sample,
        inputDraftError: null,
        inputBytes: bytes,
        inputRevision: nextInputRevision,
        revision: nextRevision,
      };
    }

    case 'add-step': {
      if (state.steps.length >= MAX_PIPELINE_STEPS) {
        return state;
      }
      const op = getOperationById(action.operationId);
      if (!op) {
        return state;
      }
      const defaults = createDefaultParameters(op.parameters);
      const mergedParams: Record<string, ParameterValue> = {
        ...defaults,
        ...(action.params ?? {}),
      };
      const newStep: PipelineStep = {
        id: action.stepId ?? generateStepId(),
        operationId: op.id,
        enabled: true,
        params: mergedParams,
      };
      const nextRevision = state.revision + 1;
      return {
        ...state,
        steps: [...state.steps, newStep],
        selectedStepId: state.selectedStepId ?? newStep.id,
        revision: nextRevision,
      };
    }

    case 'duplicate-step': {
      if (state.steps.length >= MAX_PIPELINE_STEPS) {
        return state;
      }
      const index = state.steps.findIndex((s) => s.id === action.stepId);
      if (index === -1) {
        return state;
      }
      const source = state.steps[index];
      const duplicate: PipelineStep = {
        id: action.newStepId ?? generateStepId(),
        operationId: source.operationId,
        enabled: source.enabled,
        params: { ...source.params },
      };
      const nextSteps = [
        ...state.steps.slice(0, index + 1),
        duplicate,
        ...state.steps.slice(index + 1),
      ];
      return {
        ...state,
        steps: nextSteps,
        selectedStepId: duplicate.id,
        revision: state.revision + 1,
      };
    }

    case 'remove-step': {
      const index = state.steps.findIndex((s) => s.id === action.stepId);
      if (index === -1) {
        return state;
      }
      const nextSteps = state.steps.filter((s) => s.id !== action.stepId);
      let nextSelected = state.selectedStepId;
      if (state.selectedStepId === action.stepId) {
        nextSelected =
          nextSteps[index]?.id ?? nextSteps[index - 1]?.id ?? null;
      }
      return {
        ...state,
        steps: nextSteps,
        selectedStepId: nextSelected,
        revision: state.revision + 1,
      };
    }

    case 'move-step': {
      const index = state.steps.findIndex((s) => s.id === action.stepId);
      if (index === -1) {
        return state;
      }
      const targetIndex =
        action.direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= state.steps.length) {
        return state;
      }
      const nextSteps = [...state.steps];
      const [moved] = nextSteps.splice(index, 1);
      nextSteps.splice(targetIndex, 0, moved);
      return {
        ...state,
        steps: nextSteps,
        revision: state.revision + 1,
      };
    }

    case 'toggle-step-enabled': {
      const index = state.steps.findIndex((s) => s.id === action.stepId);
      if (index === -1) {
        return state;
      }
      const nextSteps = state.steps.map((step, i) =>
        i === index ? { ...step, enabled: !step.enabled } : step,
      );
      return {
        ...state,
        steps: nextSteps,
        revision: state.revision + 1,
      };
    }

    case 'update-step-param': {
      const index = state.steps.findIndex((s) => s.id === action.stepId);
      if (index === -1) {
        return state;
      }
      const nextSteps = state.steps.map((step, i) =>
        i === index
          ? {
              ...step,
              params: {
                ...step.params,
                [action.key]: action.value,
              },
            }
          : step,
      );
      return {
        ...state,
        steps: nextSteps,
        revision: state.revision + 1,
      };
    }

    case 'select-step': {
      return {
        ...state,
        selectedStepId: action.stepId,
      };
    }

    case 'set-auto-run': {
      return {
        ...state,
        autoRun: action.autoRun,
      };
    }

    case 'run-started': {
      if (action.revision !== state.revision) {
        return state;
      }
      return {
        ...state,
        runStatus: 'running',
        activeRunId: action.runId,
        activeRunRevision: action.revision,
      };
    }

    case 'run-completed': {
      // Never allow a stale revision result to become current output
      if (action.result.revision !== state.revision) {
        return state;
      }
      const nextStatus: RunLifecycleStatus =
        action.result.status === 'success'
          ? 'idle'
          : action.result.status === 'cancelled'
            ? 'cancelled'
            : 'error';
      return {
        ...state,
        runStatus: nextStatus,
        activeRunId: null,
        activeRunRevision: null,
        executionResult: action.result,
        resultRevision: action.result.revision,
      };
    }

    case 'run-cancelled': {
      if (action.revision !== state.revision) {
        return state;
      }
      return {
        ...state,
        runStatus: 'cancelled',
        activeRunId: null,
        activeRunRevision: null,
      };
    }

    case 'set-input-detection': {
      if (action.result.revision !== state.inputRevision) {
        return state;
      }
      return {
        ...state,
        inputDetection: action.result,
      };
    }

    case 'dismiss-input-detection': {
      return {
        ...state,
        dismissedInputDetectionRevision: state.inputRevision,
      };
    }

    case 'set-output-detection': {
      if (action.result.revision !== state.resultRevision) {
        return state;
      }
      return {
        ...state,
        outputDetection: action.result,
      };
    }

    case 'dismiss-output-detection': {
      return {
        ...state,
        dismissedOutputDetectionRevision: state.resultRevision,
      };
    }

    case 'load-preset': {
      const instantiated = instantiatePreset(action.preset);
      const nextRevision = state.revision + 1;
      const nextInputRevision = state.inputRevision + 1;
      return {
        ...state,
        inputBytes: instantiated.inputBytes,
        inputEntryMode: 'utf8',
        inputDraftText: instantiated.inputText,
        inputDraftError: null,
        inputRevision: nextInputRevision,
        steps: instantiated.steps,
        selectedStepId: instantiated.steps[0]?.id ?? null,
        revision: nextRevision,
        restoredNotice: null,
        importError: null,
      };
    }

    case 'restore-from-url': {
      const nextBytes = action.inputBytes
        ? action.inputBytes.slice()
        : new Uint8Array(0);
      const synced = syncDraftFromBytes(nextBytes, 'utf8');
      const nextRevision = state.revision + 1;
      const nextInputRevision = state.inputRevision + 1;
      return {
        ...state,
        inputBytes: nextBytes,
        inputEntryMode: synced.effectiveMode,
        inputDraftText: synced.draftText,
        inputDraftError: null,
        inputRevision: nextInputRevision,
        steps: action.steps,
        selectedStepId: action.steps[0]?.id ?? null,
        autoRun: false,
        revision: nextRevision,
        runStatus: 'idle',
        activeRunId: null,
        activeRunRevision: null,
        executionResult: null,
        resultRevision: null,
        outputDetection: null,
        restoredNotice: {
          includesInput: action.inputBytes !== null,
          missingSecrets: action.missingSecrets,
        },
        importError: null,
      };
    }

    case 'set-import-error': {
      return {
        ...state,
        importError: action.error,
      };
    }

    case 'dismiss-restore-notice': {
      return {
        ...state,
        restoredNotice: null,
      };
    }

    case 'clear-workspace': {
      const nextRevision = state.revision + 1;
      const nextInputRevision = state.inputRevision + 1;
      return {
        ...state,
        inputBytes: new Uint8Array(0),
        inputEntryMode: 'utf8',
        inputDraftText: '',
        inputDraftError: null,
        inputRevision: nextInputRevision,
        steps: [],
        selectedStepId: null,
        revision: nextRevision,
        runStatus: 'idle',
        activeRunId: null,
        activeRunRevision: null,
        executionResult: null,
        resultRevision: null,
        inputDetection: null,
        outputDetection: null,
        restoredNotice: null,
        importError: null,
      };
    }

    case 'promote-output-to-input': {
      if (
        !state.executionResult ||
        state.executionResult.status !== 'success' ||
        state.resultRevision !== state.revision ||
        state.runStatus === 'running'
      ) {
        return state;
      }
      const promotedBytes = state.executionResult.output.slice();
      if (promotedBytes.byteLength > MAX_STEP_BYTES) {
        return state;
      }
      const synced = syncDraftFromBytes(promotedBytes, state.inputEntryMode);
      const nextRevision = state.revision + 1;
      const nextInputRevision = state.inputRevision + 1;
      return {
        ...state,
        inputBytes: promotedBytes,
        inputEntryMode: synced.effectiveMode,
        inputDraftText: synced.draftText,
        inputDraftError: null,
        inputRevision: nextInputRevision,
        revision: nextRevision,
      };
    }

    case 'set-theme': {
      return {
        ...state,
        theme: action.theme,
      };
    }

    default:
      return state;
  }
}

export function isResultStale(state: WorkspaceState): boolean {
  return state.resultRevision !== state.revision;
}

export function canPromoteOrDownloadOutput(state: WorkspaceState): boolean {
  return (
    state.runStatus !== 'running' &&
    !isResultStale(state) &&
    state.executionResult !== null &&
    state.executionResult.status === 'success'
  );
}

export function isWorkspaceNonEmpty(state: WorkspaceState): boolean {
  return (
    state.steps.length > 0 ||
    state.inputBytes.byteLength > 0 ||
    state.inputDraftText.length > 0
  );
}

export function validateStepParameters(step: PipelineStep): OperationError[] {
  const op = getOperationById(step.operationId);
  if (!op) {
    return [
      {
        code: 'INVALID_PARAMETERS',
        message: `Unknown operation "${step.operationId}".`,
      },
    ];
  }
  const schemaErrors = validateParametersAgainstFields(
    op.parameters,
    step.params,
    {
      allowMissingSecrets: !step.enabled,
    },
  );
  if (schemaErrors.length > 0) {
    return schemaErrors;
  }
  if (!step.enabled) {
    return [];
  }
  return [...op.validate(step.params)];
}

export function getSelectedStepResult(
  state: WorkspaceState,
): StepResult | null {
  if (!state.selectedStepId || !state.executionResult) {
    return null;
  }
  return (
    state.executionResult.steps.find(
      (s) => s.stepId === state.selectedStepId,
    ) ?? null
  );
}
