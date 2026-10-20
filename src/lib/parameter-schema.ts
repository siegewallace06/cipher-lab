import {
  type OperationError,
  type ParameterField,
  type Parameters,
  type ParameterValue,
} from '@/engine/types';
import { utf8ByteLength } from '@/lib/bytes';
import { MAX_PARAM_STRING_BYTES } from '@/lib/limits';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function createDefaultParameters(
  fields: readonly ParameterField[],
): Record<string, ParameterValue> {
  const out: Record<string, ParameterValue> = Object.create(null);
  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      out[field.key] = field.defaultValue;
    } else if (field.kind === 'text' || field.kind === 'secret') {
      out[field.key] = '';
    }
  }
  return Object.assign({}, out);
}

export const getDefaultParameters = createDefaultParameters;

export function stripSecretParameters(
  fields: readonly ParameterField[],
  params: Parameters,
): { stripped: Record<string, ParameterValue>; omittedSecretKeys: string[] } {
  const stripped: Record<string, ParameterValue> = {};
  const omittedSecretKeys: string[] = [];
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));

  for (const key of Object.getOwnPropertyNames(params)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const field = fieldByKey.get(key);
    if (!field) continue;
    if (field.secret) {
      omittedSecretKeys.push(key);
      continue;
    }
    stripped[key] = params[key];
  }

  for (const field of fields) {
    if (field.secret && !omittedSecretKeys.includes(field.key)) {
      omittedSecretKeys.push(field.key);
    }
  }

  return { stripped, omittedSecretKeys };
}

export interface SchemaValidationOptions {
  /**
   * When true (e.g., disabled pipeline step or URL state restoration), missing/empty secret parameters
   * do not produce an error, though non-secret required fields and type/byte limits are still enforced.
   */
  allowMissingSecrets?: boolean;
  /**
   * When true (e.g., URL state import), the presence of any secret key in params is rejected even if empty.
   */
  forbidSecretKeys?: boolean;
  /**
   * When true (e.g., URL state import), required non-secret parameters must be explicitly present in params.
   */
  requireExplicitRequiredNonSecret?: boolean;
}

export function validateParametersAgainstFields(
  fields: readonly ParameterField[],
  params: unknown,
  options: SchemaValidationOptions = {},
): OperationError[] {
  const errors: OperationError[] = [];

  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return [
      {
        code: 'INVALID_PARAMETERS',
        message: 'Step parameters must be a plain object.',
      },
    ];
  }

  const record = params as Record<string, unknown>;
  const fieldMap = new Map(fields.map((f) => [f.key, f]));
  const ownKeys = Object.getOwnPropertyNames(record);

  for (const key of ownKeys) {
    if (FORBIDDEN_KEYS.has(key)) {
      errors.push({
        code: 'INVALID_PARAMETERS',
        message: 'Prototype-related parameter keys are forbidden.',
        field: key,
      });
      continue;
    }
    const field = fieldMap.get(key);
    if (!field) {
      errors.push({
        code: 'INVALID_PARAMETERS',
        message: `Unknown parameter "${key}".`,
        field: key,
      });
      continue;
    }
    if (options.forbidSecretKeys && field.secret) {
      errors.push({
        code: 'INVALID_PARAMETERS',
        message: `Secret parameter "${field.label}" cannot be imported from a shared URL.`,
        field: key,
      });
    }
  }

  for (const field of fields) {
    const hasOwn = Object.prototype.hasOwnProperty.call(record, field.key);
    if (
      options.requireExplicitRequiredNonSecret &&
      field.required &&
      !field.secret &&
      !hasOwn
    ) {
      errors.push({
        code: 'INVALID_PARAMETERS',
        message: `${field.label} is required in shared step parameters.`,
        field: field.key,
      });
      continue;
    }
    const rawVal = hasOwn ? record[field.key] : field.defaultValue;

    if (rawVal === undefined) {
      if (field.required) {
        if (field.secret && options.allowMissingSecrets) {
          continue;
        }
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} is required.`,
          field: field.key,
        });
      }
      continue;
    }

    if (field.kind === 'text' || field.kind === 'secret') {
      if (typeof rawVal !== 'string') {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must be a string.`,
          field: field.key,
        });
        continue;
      }
      const maxBytes = field.maxBytes ?? MAX_PARAM_STRING_BYTES;
      const byteLen = utf8ByteLength(rawVal);
      if (byteLen > maxBytes) {
        errors.push({
          code: 'LIMIT_EXCEEDED',
          message: `${field.label} exceeds the ${maxBytes}-byte parameter limit.`,
          field: field.key,
        });
        continue;
      }
      if (field.required && rawVal.length === 0) {
        if (field.secret && options.allowMissingSecrets) {
          continue;
        }
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} is required.`,
          field: field.key,
        });
      }
    } else if (field.kind === 'number') {
      if (
        typeof rawVal !== 'number' ||
        !Number.isFinite(rawVal) ||
        !Number.isInteger(rawVal)
      ) {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must be a finite integer.`,
          field: field.key,
        });
        continue;
      }
      if (field.min !== undefined && rawVal < field.min) {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must be between ${field.min} and ${field.max ?? 'max'}.`,
          field: field.key,
        });
      }
      if (field.max !== undefined && rawVal > field.max) {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must be between ${field.min ?? 'min'} and ${field.max}.`,
          field: field.key,
        });
      }
    } else if (field.kind === 'boolean') {
      if (typeof rawVal !== 'boolean') {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must be a boolean.`,
          field: field.key,
        });
      }
    } else if (field.kind === 'select') {
      if (
        typeof rawVal !== 'string' &&
        typeof rawVal !== 'number' &&
        typeof rawVal !== 'boolean'
      ) {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must be a primitive option value.`,
          field: field.key,
        });
        continue;
      }
      if (field.options && !field.options.includes(rawVal)) {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} has an unsupported value.`,
          field: field.key,
        });
      }
    }
  }

  return errors;
}
