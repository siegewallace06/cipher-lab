import type {
  OperationCategory,
  OperationDefinition,
  PipelineStep,
} from '@/engine/types';
import { createDefaultParameters } from '@/lib/parameter-schema';
import { cipherOperations } from '@/operations/ciphers';
import { cryptoOperations } from '@/operations/crypto';
import { encodingOperations } from '@/operations/encoding';
import { textOperations } from '@/operations/text';

export const CANONICAL_OPERATION_IDS = [
  'base64',
  'base32',
  'hex',
  'binary',
  'url',
  'html-entities',
  'json',
  'jwt',
  'timestamp',
  'caesar',
  'rot13',
  'vigenere',
  'xor',
  'atbash',
  'rail-fence',
  'morse',
  'sha1',
  'sha256',
  'sha384',
  'sha512',
  'hmac-sha256',
  'crc32',
  'aes-gcm',
  'case',
  'reverse',
  'regex',
  'lines',
  'entropy',
] as const;

export type CanonicalOperationId = (typeof CANONICAL_OPERATION_IDS)[number];

export const CATEGORY_METADATA: Readonly<
  Record<
    OperationCategory,
    { id: OperationCategory; label: string; shortLabel: string }
  >
> = {
  encoding: {
    id: 'encoding',
    label: 'Encoding & Formats',
    shortLabel: 'Encoding',
  },
  ciphers: {
    id: 'ciphers',
    label: 'Ciphers & Bitwise',
    shortLabel: 'Ciphers',
  },
  crypto: {
    id: 'crypto',
    label: 'Hashing, Checksums & Crypto',
    shortLabel: 'Crypto',
  },
  text: {
    id: 'text',
    label: 'Text & Byte Analysis',
    shortLabel: 'Text & Bytes',
  },
};

export const ALL_OPERATIONS: readonly OperationDefinition[] = [
  ...encodingOperations,
  ...cipherOperations,
  ...cryptoOperations,
  ...textOperations,
];

const OPERATION_MAP: ReadonlyMap<string, OperationDefinition> = new Map(
  ALL_OPERATIONS.map((op) => [op.id, op]),
);

export function getOperationById(
  id: string,
): OperationDefinition | undefined {
  return OPERATION_MAP.get(id);
}

export function isKnownOperationId(id: string): id is CanonicalOperationId {
  return OPERATION_MAP.has(id);
}

let fallbackStepCounter = 0;

export function generateStepId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `step-${globalThis.crypto.randomUUID()}`;
  }
  fallbackStepCounter += 1;
  return `step-${Date.now().toString(36)}-${fallbackStepCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createPipelineStep(
  operationId: string,
  overrideParams?: Record<string, string | number | boolean>,
  enabled = true,
): PipelineStep {
  const def = getOperationById(operationId);
  const defaults = def ? createDefaultParameters(def.parameters) : {};
  return {
    id: generateStepId(),
    operationId,
    enabled,
    params: {
      ...defaults,
      ...(overrideParams ?? {}),
    },
  };
}

export function duplicatePipelineStep(step: PipelineStep): PipelineStep {
  return {
    id: generateStepId(),
    operationId: step.operationId,
    enabled: step.enabled,
    params: { ...step.params },
  };
}

export function filterOperations(
  operations: readonly OperationDefinition[],
  query: string,
  category: OperationCategory | 'all',
): readonly OperationDefinition[] {
  const normalizedQuery = query.trim().toLowerCase();
  return operations.filter((op) => {
    if (category !== 'all' && op.category !== category) {
      return false;
    }
    if (normalizedQuery.length === 0) {
      return true;
    }
    const categoryLabel =
      CATEGORY_METADATA[op.category]?.label.toLowerCase() ?? '';
    return (
      op.label.toLowerCase().includes(normalizedQuery) ||
      op.id.toLowerCase().includes(normalizedQuery) ||
      op.description.toLowerCase().includes(normalizedQuery) ||
      categoryLabel.includes(normalizedQuery)
    );
  });
}

export function getOperationsByCategory(
  category: OperationCategory,
): readonly OperationDefinition[] {
  return ALL_OPERATIONS.filter((op) => op.category === category);
}

export function searchOperations(
  query: string,
  category: OperationCategory | 'all' = 'all',
): readonly OperationDefinition[] {
  return filterOperations(ALL_OPERATIONS, query, category);
}
