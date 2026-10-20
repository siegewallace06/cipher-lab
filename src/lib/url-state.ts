import { getOperationById } from '../engine/registry';
import type {
  OperationError,
  Parameters,
  ParameterValue,
  PipelineStep,
} from '../engine/types';
import {
  decodeBase64,
  decodeUtf8OrNull,
  encodeBase64,
  encodeUtf8,
  validateJsonStructureLimits,
} from './bytes';
import {
  MAX_PIPELINE_STEPS,
  MAX_STEP_BYTES,
  MAX_URL_DECODED_JSON_BYTES,
  MAX_URL_FRAGMENT_CHARS,
} from './limits';
import {
  stripSecretParameters,
  validateParametersAgainstFields,
} from './parameter-schema';
import { generateStepId } from './presets';

export const URL_FRAGMENT_PREFIX = '#cl=';

export interface SharedStepPayload {
  operationId: string;
  enabled: boolean;
  params: Record<string, ParameterValue>;
}

export interface SharedInputPayload {
  encoding: 'base64url';
  data: string;
}

export interface SharedWorkspacePayload {
  v: 1;
  steps: SharedStepPayload[];
  input?: SharedInputPayload;
}

export interface OmittedSecretSummary {
  stepIndex: number;
  operationId: string;
  operationLabel: string;
  fieldKey: string;
  fieldLabel: string;
}

export interface SharePreviewSummary {
  stepCount: number;
  includesInput: boolean;
  inputByteLength: number;
  omittedSecrets: OmittedSecretSummary[];
  excludedRuntimeFields: readonly string[];
}

export type ShareExportResult =
  | {
      ok: true;
      fragment: string;
      fullUrl: string;
      encodedChars: number;
      decodedJsonBytes: number;
      preview: SharePreviewSummary;
    }
  | {
      ok: false;
      error: OperationError;
      preview: SharePreviewSummary;
    };

export type ShareImportResult =
  | { kind: 'none' }
  | {
      kind: 'ok';
      steps: PipelineStep[];
      inputBytes: Uint8Array | null;
      missingSecrets: OmittedSecretSummary[];
    }
  | {
      kind: 'error';
      error: OperationError;
    };

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const EXCLUDED_RUNTIME_FIELDS = [
  'step instance IDs',
  'theme preference',
  'intermediate & final outputs',
  'execution errors & durations',
  'auto-run setting',
  'secret keys & passphrases',
] as const;

export function buildSharePreview(
  steps: readonly PipelineStep[],
  inputBytes: Uint8Array,
  includeInput: boolean,
): SharePreviewSummary {
  const omittedSecrets: OmittedSecretSummary[] = [];

  steps.forEach((step, index) => {
    const op = getOperationById(step.operationId);
    if (!op) {
      return;
    }
    for (const field of op.parameters) {
      if (field.secret) {
        omittedSecrets.push({
          stepIndex: index + 1,
          operationId: op.id,
          operationLabel: op.label,
          fieldKey: field.key,
          fieldLabel: field.label,
        });
      }
    }
  });

  return {
    stepCount: steps.length,
    includesInput: includeInput,
    inputByteLength: includeInput ? inputBytes.byteLength : 0,
    omittedSecrets,
    excludedRuntimeFields: EXCLUDED_RUNTIME_FIELDS,
  };
}

export function exportWorkspaceToUrlFragment(options: {
  steps: readonly PipelineStep[];
  inputBytes: Uint8Array;
  includeInput: boolean;
  baseUrl?: string;
}): ShareExportResult {
  const { steps, inputBytes, includeInput, baseUrl = '' } = options;
  const preview = buildSharePreview(steps, inputBytes, includeInput);

  if (steps.length > MAX_PIPELINE_STEPS) {
    return {
      ok: false,
      preview,
      error: {
        code: 'LIMIT_EXCEEDED',
        message: `Pipeline exceeds maximum of ${MAX_PIPELINE_STEPS} steps for URL sharing.`,
      },
    };
  }

  if (includeInput && inputBytes.byteLength > MAX_STEP_BYTES) {
    return {
      ok: false,
      preview,
      error: {
        code: 'LIMIT_EXCEEDED',
        message: 'Input exceeds maximum byte size for URL sharing.',
      },
    };
  }

  const serializedSteps: SharedStepPayload[] = [];
  for (const step of steps) {
    const op = getOperationById(step.operationId);
    if (!op) {
      return {
        ok: false,
        preview,
        error: {
          code: 'INVALID_PARAMETERS',
          message: `Unknown operation "${step.operationId}" cannot be exported.`,
        },
      };
    }

    const { stripped } = stripSecretParameters(op.parameters, step.params);
    const orderedParams: Record<string, ParameterValue> = {};
    for (const field of op.parameters) {
      if (field.secret) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(stripped, field.key)) {
        orderedParams[field.key] = stripped[field.key];
      } else if (field.defaultValue !== undefined) {
        orderedParams[field.key] = field.defaultValue;
      }
    }

    serializedSteps.push({
      operationId: op.id,
      enabled: Boolean(step.enabled),
      params: orderedParams,
    });
  }

  const payload: SharedWorkspacePayload = {
    v: 1,
    steps: serializedSteps,
  };

  if (includeInput) {
    payload.input = {
      encoding: 'base64url',
      data: encodeBase64(inputBytes, 'url-safe', false),
    };
  }

  const jsonString = JSON.stringify(payload);
  const jsonBytes = encodeUtf8(jsonString);

  if (jsonBytes.byteLength > MAX_URL_DECODED_JSON_BYTES) {
    return {
      ok: false,
      preview,
      error: {
        code: 'LIMIT_EXCEEDED',
        message: `Shared state JSON (${jsonBytes.byteLength.toLocaleString()} bytes) exceeds the ${MAX_URL_DECODED_JSON_BYTES.toLocaleString()}-byte limit. Omit input or shorten the pipeline.`,
      },
    };
  }

  const encoded = encodeBase64(jsonBytes, 'url-safe', false);
  const fragment = `${URL_FRAGMENT_PREFIX}${encoded}`;

  if (fragment.length > MAX_URL_FRAGMENT_CHARS) {
    return {
      ok: false,
      preview,
      error: {
        code: 'LIMIT_EXCEEDED',
        message: `Shared URL fragment (${fragment.length.toLocaleString()} characters) exceeds the ${MAX_URL_FRAGMENT_CHARS.toLocaleString()}-character limit. Omit input or shorten the pipeline.`,
      },
    };
  }

  const cleanBase = baseUrl ? baseUrl.split('#')[0].split('?')[0] : '';
  const fullUrl = cleanBase ? `${cleanBase}${fragment}` : fragment;

  return {
    ok: true,
    fragment,
    fullUrl,
    encodedChars: fragment.length,
    decodedJsonBytes: jsonBytes.byteLength,
    preview,
  };
}

/**
 * Inspects a valid JSON string to reject duplicate keys within any object
 * and reject forbidden prototype keys (`__proto__`, `constructor`, `prototype`).
 */
function validateJsonObjectKeysStrict(jsonText: string): OperationError | null {
  type ContainerFrame =
    | { kind: 'object'; keys: Set<string>; expectingKey: boolean }
    | { kind: 'array' };

  const stack: ContainerFrame[] = [];
  let i = 0;
  const len = jsonText.length;

  const skipWhitespace = (): void => {
    while (i < len) {
      const ch = jsonText.charCodeAt(i);
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
        i += 1;
      } else {
        break;
      }
    }
  };

  const readJsonString = (): string | null => {
    const start = i;
    i += 1; // skip opening quote
    while (i < len) {
      const ch = jsonText.charCodeAt(i);
      if (ch === 0x5c) {
        // backslash escape
        if (i + 1 >= len) return null;
        if (jsonText.charCodeAt(i + 1) === 0x75) {
          i += 6;
        } else {
          i += 2;
        }
        continue;
      }
      if (ch === 0x22) {
        i += 1; // include closing quote
        try {
          return JSON.parse(jsonText.slice(start, i)) as string;
        } catch {
          return null;
        }
      }
      i += 1;
    }
    return null;
  };

  while (i < len) {
    skipWhitespace();
    if (i >= len) break;
    const ch = jsonText[i];

    if (ch === '{') {
      stack.push({ kind: 'object', keys: new Set<string>(), expectingKey: true });
      i += 1;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      i += 1;
      continue;
    }
    if (ch === '[') {
      stack.push({ kind: 'array' });
      i += 1;
      continue;
    }
    if (ch === ']') {
      stack.pop();
      i += 1;
      continue;
    }
    if (ch === ',') {
      const top = stack[stack.length - 1];
      if (top && top.kind === 'object') {
        top.expectingKey = true;
      }
      i += 1;
      continue;
    }
    if (ch === ':') {
      i += 1;
      continue;
    }
    if (ch === '"') {
      const top = stack[stack.length - 1];
      const strVal = readJsonString();
      if (strVal === null) {
        return {
          code: 'INVALID_INPUT',
          message: 'Malformed JSON string in shared URL fragment.',
        };
      }
      skipWhitespace();
      if (top && top.kind === 'object' && top.expectingKey && jsonText[i] === ':') {
        top.expectingKey = false;
        if (FORBIDDEN_OBJECT_KEYS.has(strVal)) {
          return {
            code: 'INVALID_PARAMETERS',
            message: 'Prototype-related keys are forbidden in shared URL state.',
          };
        }
        if (top.keys.has(strVal)) {
          return {
            code: 'INVALID_INPUT',
            message: `Duplicate JSON key "${strVal}" in shared URL state.`,
          };
        }
        top.keys.add(strVal);
      }
      continue;
    }

    // Primitive token (number, boolean, null)
    while (
      i < len &&
      jsonText[i] !== ',' &&
      jsonText[i] !== '}' &&
      jsonText[i] !== ']' &&
      jsonText[i] !== ' ' &&
      jsonText[i] !== '\t' &&
      jsonText[i] !== '\n' &&
      jsonText[i] !== '\r'
    ) {
      i += 1;
    }
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function importWorkspaceFromUrlFragment(
  rawFragment: string,
  searchParamsString = '',
): ShareImportResult {
  if (searchParamsString && searchParamsString.replace(/^\?/, '').trim().length > 0) {
    const query = searchParamsString.replace(/^\?/, '');
    const queryParts = query.split('&');
    for (const part of queryParts) {
      const key = part.split('=')[0];
      if (key === 'cl' || key === 'state' || key === 'pipeline' || key === 'input') {
        return {
          kind: 'error',
          error: {
            code: 'INVALID_INPUT',
            message:
              'Workspace state cannot be restored from URL query parameters; use #cl= fragment only.',
          },
        };
      }
    }
  }

  if (!rawFragment || rawFragment === '#') {
    return { kind: 'none' };
  }

  if (rawFragment.length > MAX_URL_FRAGMENT_CHARS) {
    return {
      kind: 'error',
      error: {
        code: 'LIMIT_EXCEEDED',
        message: `Shared URL fragment exceeds the ${MAX_URL_FRAGMENT_CHARS.toLocaleString()}-character limit.`,
      },
    };
  }

  if (!/^[\x20-\x7E]+$/.test(rawFragment)) {
    return {
      kind: 'error',
      error: {
        code: 'INVALID_INPUT',
        message: 'Shared URL fragment must contain only printable ASCII characters.',
      },
    };
  }

  const withoutHash = rawFragment.startsWith('#')
    ? rawFragment.slice(1)
    : rawFragment;

  if (withoutHash.length === 0) {
    return { kind: 'none' };
  }

  const parts = withoutHash.split('&');
  if (parts.length !== 1 || !parts[0].startsWith('cl=')) {
    return {
      kind: 'error',
      error: {
        code: 'INVALID_INPUT',
        message:
          'Invalid URL fragment format. Expected a single #cl=<base64url> fragment without extra keys.',
      },
    };
  }

  const encodedPayload = parts[0].slice(3);
  if (encodedPayload.length === 0 || encodedPayload.includes('=')) {
    return {
      kind: 'error',
      error: {
        code: 'INVALID_INPUT',
        message:
          'Shared URL fragment payload must be non-empty canonical unpadded Base64url.',
      },
    };
  }

  const decodedBytes = decodeBase64(encodedPayload, 'url-safe');
  if (
    !decodedBytes ||
    encodeBase64(decodedBytes, 'url-safe', false) !== encodedPayload
  ) {
    return {
      kind: 'error',
      error: {
        code: 'INVALID_INPUT',
        message: 'Shared URL fragment contains invalid Base64url encoding.',
      },
    };
  }

  if (decodedBytes.byteLength > MAX_URL_DECODED_JSON_BYTES) {
    return {
      kind: 'error',
      error: {
        code: 'LIMIT_EXCEEDED',
        message: `Decoded shared state (${decodedBytes.byteLength.toLocaleString()} bytes) exceeds the ${MAX_URL_DECODED_JSON_BYTES.toLocaleString()}-byte limit.`,
      },
    };
  }

  const jsonText = decodeUtf8OrNull(decodedBytes);
  if (jsonText === null) {
    return {
      kind: 'error',
      error: {
        code: 'INVALID_UTF8',
        message: 'Shared URL payload is not valid UTF-8.',
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      kind: 'error',
      error: {
        code: 'INVALID_INPUT',
        message: 'Shared URL payload could not be parsed as JSON.',
      },
    };
  }

  const keyScanError = validateJsonObjectKeysStrict(jsonText);
  if (keyScanError) {
    return { kind: 'error', error: keyScanError };
  }

  try {
    validateJsonStructureLimits(parsed);
  } catch {
    return {
      kind: 'error',
      error: {
        code: 'LIMIT_EXCEEDED',
        message: 'Shared URL JSON exceeds structural nesting or node limits.',
      },
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      kind: 'error',
      error: {
        code: 'INVALID_INPUT',
        message: 'Shared URL root value must be a JSON object.',
      },
    };
  }

  const rootKeys = Object.getOwnPropertyNames(parsed);
  for (const key of rootKeys) {
    if (key !== 'v' && key !== 'steps' && key !== 'input') {
      return {
        kind: 'error',
        error: {
          code: 'INVALID_INPUT',
          message: `Unknown root field "${key}" in shared URL state.`,
        },
      };
    }
  }

  if (parsed.v !== 1) {
    return {
      kind: 'error',
      error: {
        code: 'INVALID_INPUT',
        message: 'Unsupported or missing shared URL schema version.',
      },
    };
  }

  if (!Array.isArray(parsed.steps)) {
    return {
      kind: 'error',
      error: {
        code: 'INVALID_INPUT',
        message: 'Shared URL "steps" field must be an array.',
      },
    };
  }

  if (parsed.steps.length > MAX_PIPELINE_STEPS) {
    return {
      kind: 'error',
      error: {
        code: 'LIMIT_EXCEEDED',
        message: `Shared URL contains ${parsed.steps.length} steps, exceeding the ${MAX_PIPELINE_STEPS}-step maximum.`,
      },
    };
  }

  let restoredInputBytes: Uint8Array | null = null;
  if (Object.prototype.hasOwnProperty.call(parsed, 'input')) {
    const rawInput = parsed.input;
    if (!isPlainObject(rawInput)) {
      return {
        kind: 'error',
        error: {
          code: 'INVALID_INPUT',
          message: 'Shared URL "input" field must be an object.',
        },
      };
    }
    const inputKeys = Object.getOwnPropertyNames(rawInput);
    if (
      inputKeys.length !== 2 ||
      !inputKeys.includes('encoding') ||
      !inputKeys.includes('data')
    ) {
      return {
        kind: 'error',
        error: {
          code: 'INVALID_INPUT',
          message: 'Shared URL "input" object must contain only "encoding" and "data".',
        },
      };
    }
    if (rawInput.encoding !== 'base64url' || typeof rawInput.data !== 'string') {
      return {
        kind: 'error',
        error: {
          code: 'INVALID_INPUT',
          message: 'Shared URL input must use canonical base64url encoding.',
        },
      };
    }
    if (rawInput.data.includes('=')) {
      return {
        kind: 'error',
        error: {
          code: 'INVALID_INPUT',
          message: 'Shared URL input data must be unpadded Base64url.',
        },
      };
    }
    if (rawInput.data.length === 0) {
      restoredInputBytes = new Uint8Array(0);
    } else {
      const decodedInput = decodeBase64(rawInput.data, 'url-safe');
      if (
        !decodedInput ||
        encodeBase64(decodedInput, 'url-safe', false) !== rawInput.data
      ) {
        return {
          kind: 'error',
          error: {
            code: 'INVALID_INPUT',
            message: 'Shared URL input data is not canonical Base64url.',
          },
        };
      }
      if (decodedInput.byteLength > MAX_STEP_BYTES) {
        return {
          kind: 'error',
          error: {
            code: 'LIMIT_EXCEEDED',
            message: 'Shared URL input exceeds maximum allowed byte length.',
          },
        };
      }
      restoredInputBytes = decodedInput;
    }
  }

  const restoredSteps: PipelineStep[] = [];
  const missingSecrets: OmittedSecretSummary[] = [];

  for (let i = 0; i < parsed.steps.length; i += 1) {
    const rawStep: unknown = parsed.steps[i];
    if (!isPlainObject(rawStep)) {
      return {
        kind: 'error',
        error: {
          code: 'INVALID_INPUT',
          message: `Step ${i + 1} in shared URL state must be an object.`,
        },
      };
    }

    const stepKeys = Object.getOwnPropertyNames(rawStep);
    if (
      stepKeys.length !== 3 ||
      !stepKeys.includes('operationId') ||
      !stepKeys.includes('enabled') ||
      !stepKeys.includes('params')
    ) {
      return {
        kind: 'error',
        error: {
          code: 'INVALID_INPUT',
          message: `Step ${i + 1} must contain exact keys "operationId", "enabled", and "params".`,
        },
      };
    }

    if (typeof rawStep.operationId !== 'string') {
      return {
        kind: 'error',
        error: {
          code: 'INVALID_INPUT',
          message: `Step ${i + 1} operationId must be a string.`,
        },
      };
    }

    const op = getOperationById(rawStep.operationId);
    if (!op) {
      return {
        kind: 'error',
        error: {
          code: 'INVALID_PARAMETERS',
          message: `Step ${i + 1} references unknown operation "${rawStep.operationId}".`,
        },
      };
    }

    if (typeof rawStep.enabled !== 'boolean') {
      return {
        kind: 'error',
        error: {
          code: 'INVALID_PARAMETERS',
          message: `Step ${i + 1} "enabled" must be a boolean.`,
        },
      };
    }

    if (!isPlainObject(rawStep.params)) {
      return {
        kind: 'error',
        error: {
          code: 'INVALID_PARAMETERS',
          message: `Step ${i + 1} "params" must be a plain object.`,
        },
      };
    }

    const fieldErrors = validateParametersAgainstFields(
      op.parameters,
      rawStep.params,
      {
        allowMissingSecrets: true,
        forbidSecretKeys: true,
        requireExplicitRequiredNonSecret: true,
      },
    );

    if (fieldErrors.length > 0) {
      return {
        kind: 'error',
        error: fieldErrors[0],
      };
    }

    const cleanParams: Record<string, ParameterValue> = {};
    const secretFieldKeys = new Set<string>();
    for (const field of op.parameters) {
      if (field.secret) {
        cleanParams[field.key] = '';
        secretFieldKeys.add(field.key);
        missingSecrets.push({
          stepIndex: i + 1,
          operationId: op.id,
          operationLabel: op.label,
          fieldKey: field.key,
          fieldLabel: field.label,
        });
      } else if (Object.prototype.hasOwnProperty.call(rawStep.params, field.key)) {
        cleanParams[field.key] = rawStep.params[field.key] as ParameterValue;
      } else if (field.defaultValue !== undefined) {
        cleanParams[field.key] = field.defaultValue;
      }
    }

    const opValidationErrors = op
      .validate(cleanParams as Parameters)
      .filter((err) => !err.field || !secretFieldKeys.has(err.field));

    if (opValidationErrors.length > 0) {
      return {
        kind: 'error',
        error: opValidationErrors[0],
      };
    }

    restoredSteps.push({
      id: generateStepId(),
      operationId: op.id,
      enabled: rawStep.enabled,
      params: cleanParams,
    });
  }

  return {
    kind: 'ok',
    steps: restoredSteps,
    inputBytes: restoredInputBytes,
    missingSecrets,
  };
}
