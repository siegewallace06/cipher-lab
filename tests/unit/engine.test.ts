import { describe, expect, it } from 'vitest';
import { executePipeline } from '@/engine/execute';
import {
  ALL_OPERATIONS,
  getOperationById,
   getOperationsByCategory,
  searchOperations,
} from '@/engine/registry';
import type { PipelineStep } from '@/engine/types';
import {
  bytesEqual,
  cloneBytes,
  computeByteStats,
  decodeUtf8Fatal,
  decodeUtf8LossyPreview,
  decodeUtf8OrNull,
  encodeUtf8,
  formatHexDump,
  tryDecodeUtf8,
  utf8ByteLength,
} from '@/lib/bytes';
import * as limits from '@/lib/limits';
import {
  getDefaultParameters,
  stripSecretParameters,
  validateParametersAgainstFields,
} from '@/lib/parameter-schema';

describe('Resource and execution limits (limits.ts)', () => {
  it('matches all specification constants from technical-design.md ch. 4', () => {
    expect(limits.MAX_STEP_BYTES).toBe(1_048_576);
    expect(limits.MAX_CUMULATIVE_OUTPUT_BYTES).toBe(16_777_216);
    expect(limits.MAX_PIPELINE_STEPS).toBe(32);
    expect(limits.MAX_PARAM_STRING_BYTES).toBe(4_096);
    expect(limits.MAX_REGEX_PATTERN_BYTES).toBe(512);
    expect(limits.MAX_REGEX_REPLACEMENT_BYTES).toBe(4_096);
    expect(limits.ORDINARY_STEP_TIMEOUT_MS).toBe(2_000);
    expect(limits.AES_STEP_TIMEOUT_MS).toBe(15_000);
    expect(limits.TOTAL_RUN_TIMEOUT_MS).toBe(30_000);
    expect(limits.WORKER_STARTUP_TIMEOUT_MS).toBe(2_000);
    expect(limits.MAX_REGEX_INPUT_BYTES).toBe(65_536);
    expect(limits.MAX_REGEX_MATCHES).toBe(10_000);
    expect(limits.REGEX_STEP_TIMEOUT_MS).toBe(100);
    expect(limits.MAX_DETECTION_BYTES).toBe(65_536);
    expect(limits.DETECTION_TIMEOUT_MS).toBe(200);
    expect(limits.MAX_JSON_DEPTH).toBe(64);
    expect(limits.MAX_JSON_NODES).toBe(100_000);
    expect(limits.MAX_URL_FRAGMENT_CHARS).toBe(32_768);
    expect(limits.MAX_URL_JSON_BYTES).toBe(24_576);
    expect(limits.AUTORUN_DEBOUNCE_MS).toBe(200);
  });
});

describe('Byte utilities and UTF-8 helpers (bytes.ts)', () => {
  it('encodes and decodes valid UTF-8 and rejects invalid UTF-8 in fatal mode', () => {
    const sample = 'Hello, Cipher Lab! 🌐';
    const encoded = encodeUtf8(sample);
    expect(utf8ByteLength(sample)).toBe(encoded.byteLength);
    expect(decodeUtf8Fatal(encoded)).toBe(sample);
    expect(decodeUtf8OrNull(encoded)).toBe(sample);

    const invalid = new Uint8Array([0xff, 0xfe, 0xfd]);
    expect(() => decodeUtf8Fatal(invalid)).toThrowError(/invalid UTF-8/i);
    expect(decodeUtf8OrNull(invalid)).toBeNull();
    expect(tryDecodeUtf8(invalid).valid).toBe(false);
    expect(decodeUtf8LossyPreview(invalid)).toContain('\uFFFD');
  });

  it('computes accurate byte, Unicode code-point, and line statistics', () => {
    const emptyStats = computeByteStats(new Uint8Array(0));
    expect(emptyStats).toEqual({
      byteCount: 0,
      byteLength: 0,
      isValidUtf8: true,
      isUtf8: true,
      codePointCount: 0,
      charCount: 0,
      lineCount: 0,
    });

    // 'A😀\nB' has 4 Unicode code points ('A', '😀', '\n', 'B'), 7 UTF-8 bytes, and 2 lines
    const textBytes = encodeUtf8('A😀\nB');
    const textStats = computeByteStats(textBytes);
    expect(textStats.byteCount).toBe(7);
    expect(textStats.isValidUtf8).toBe(true);
    expect(textStats.codePointCount).toBe(4);
    expect(textStats.lineCount).toBe(2);

    const binaryStats = computeByteStats(new Uint8Array([0x80, 0xff]));
    expect(binaryStats.byteCount).toBe(2);
    expect(binaryStats.isValidUtf8).toBe(false);
    expect(binaryStats.codePointCount).toBeNull();
    expect(binaryStats.lineCount).toBeNull();
  });

  it('formats 16-byte rows in hex dump and respects maxBytes', () => {
    const bytes = encodeUtf8('0123456789abcdefXYZ');
    const dump = formatHexDump(bytes, 16);
    const lines = dump.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('00000000');
    expect(lines[0]).toContain('|0123456789abcdef|');
    expect(lines[1]).toContain('00000010');
    expect(lines[1]).toContain('|XYZ|');

    const truncated = formatHexDump(bytes, 16, 16);
    expect(truncated.split('\n')).toHaveLength(1);
  });

  it('clones and compares Uint8Arrays without sharing backing memory', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = cloneBytes(a);
    expect(bytesEqual(a, b)).toBe(true);
    b[0] = 9;
    expect(a[0]).toBe(1);
    expect(bytesEqual(a, b)).toBe(false);
  });
});

describe('Operation Registry & Parameter Schema', () => {
  it('registers all 28 canonical v1 operations across 4 categories', () => {
    expect(ALL_OPERATIONS).toHaveLength(28);
    expect(getOperationsByCategory('encoding')).toHaveLength(9);
    expect(getOperationsByCategory('ciphers')).toHaveLength(7);
    expect(getOperationsByCategory('crypto')).toHaveLength(7);
    expect(getOperationsByCategory('text')).toHaveLength(5);

    const expectedIds = [
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
    ];
    for (const id of expectedIds) {
      expect(getOperationById(id)).toBeDefined();
    }
  });

  it('filters operations by search query and category', () => {
    const shaMatches = searchOperations('sha', 'crypto');
    expect(shaMatches.map((op) => op.id)).toEqual(
      expect.arrayContaining(['sha1', 'sha256', 'sha384', 'sha512', 'hmac-sha256']),
    );
  });

  it('strips secret parameters and validates parameter schemas strictly', () => {
    const aesOp = getOperationById('aes-gcm')!;
    const defaults = getDefaultParameters(aesOp.parameters);
    expect(defaults).toEqual({ direction: 'encrypt', passphrase: '' });

    const { stripped, omittedSecretKeys } = stripSecretParameters(
      aesOp.parameters,
      {
        direction: 'encrypt',
        passphrase: 'super-secret-value',
      },
    );
    expect(stripped).toEqual({ direction: 'encrypt' });
    expect(stripped).not.toHaveProperty('passphrase');
    expect(omittedSecretKeys).toEqual(['passphrase']);

    const unknownErrors = validateParametersAgainstFields(aesOp.parameters, {
      direction: 'encrypt',
      passphrase: 'ok',
      extraField: 'nope',
    });
    expect(unknownErrors[0]?.code).toBe('INVALID_PARAMETERS');
  });
});

describe('Pipeline Execution Engine (execute.ts)', () => {
  it('returns input unchanged when pipeline has 0 steps', async () => {
    const input = encodeUtf8('unchanged payload');
    const res = await executePipeline({
      runId: 'run-empty',
      revision: 1,
      input,
      steps: [],
    });
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.steps).toHaveLength(0);
      expect(decodeUtf8Fatal(res.output)).toBe('unchanged payload');
    }
  });

  it('executes multi-step pipelines sequentially and skips bypassed steps', async () => {
    const steps: PipelineStep[] = [
      {
        id: 'step-1',
        operationId: 'base64',
        enabled: true,
        params: { direction: 'encode', alphabet: 'standard', padding: true },
      },
      {
        id: 'step-2',
        operationId: 'reverse',
        enabled: false, // bypassed
        params: { mode: 'code-points' },
      },
      {
        id: 'step-3',
        operationId: 'url',
        enabled: true,
        params: { direction: 'encode' },
      },
    ];

    const res = await executePipeline({
      runId: 'run-seq',
      revision: 2,
      input: encodeUtf8('Hello?'),
      steps,
    });

    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.steps).toHaveLength(3);
      expect(res.steps[0].status).toBe('success');
      expect(res.steps[1].status).toBe('bypassed');
      expect(res.steps[2].status).toBe('success');
      // 'Hello?' -> Base64 'SGVsbG8/' -> URL encoded 'SGVsbG8%2F'
      expect(decodeUtf8Fatal(res.output)).toBe('SGVsbG8%2F');
    }
  });

  it('stops on first failing step and marks subsequent steps as not-run', async () => {
    const steps: PipelineStep[] = [
      {
        id: 's1',
        operationId: 'hex',
        enabled: true,
        params: { direction: 'decode', case: 'lower' },
      },
      {
        id: 's2',
        operationId: 'base64',
        enabled: true,
        params: { direction: 'encode', alphabet: 'standard', padding: true },
      },
    ];

    const res = await executePipeline({
      runId: 'run-err',
      revision: 3,
      input: encodeUtf8('not-valid-hex!'),
      steps,
    });

    expect(res.status).toBe('error');
    if (res.status === 'error') {
      expect(res.error.code).toBe('INVALID_INPUT');
      expect(res.steps[0].status).toBe('error');
      expect(res.steps[1]).toEqual({ stepId: 's2', status: 'not-run' });
    }
  });

  it('enforces MAX_PIPELINE_STEPS (32) and MAX_STEP_BYTES (1,048,576)', async () => {
    const tooManySteps: PipelineStep[] = Array.from({ length: 33 }, (_, idx) => ({
      id: `s-${idx}`,
      operationId: 'rot13',
      enabled: true,
      params: {},
    }));

    const stepCapRes = await executePipeline({
      runId: 'run-step-cap',
      revision: 4,
      input: encodeUtf8('test'),
      steps: tooManySteps,
    });
    expect(stepCapRes.status).toBe('error');
    if (stepCapRes.status === 'error') {
      expect(stepCapRes.error.code).toBe('LIMIT_EXCEEDED');
    }

    const oversizedInput = new Uint8Array(limits.MAX_STEP_BYTES + 1);
    const inputCapRes = await executePipeline({
      runId: 'run-input-cap',
      revision: 5,
      input: oversizedInput,
      steps: [],
    });
    expect(inputCapRes.status).toBe('error');
    if (inputCapRes.status === 'error') {
      expect(inputCapRes.error.code).toBe('LIMIT_EXCEEDED');
    }
  });

  it('enforces MAX_CUMULATIVE_OUTPUT_BYTES (16 MiB) across retained step outputs', async () => {
    // 17 bypassed/passthrough steps each retaining 1 MiB (17 * 1 MiB > 16 MiB)
    const oneMiB = new Uint8Array(limits.MAX_STEP_BYTES);
    const steps: PipelineStep[] = Array.from({ length: 17 }, (_, idx) => ({
      id: `mem-${idx}`,
      operationId: 'rot13',
      enabled: false,
      params: {},
    }));

    const res = await executePipeline({
      runId: 'run-cum-cap',
      revision: 6,
      input: oneMiB,
      steps,
    });
    expect(res.status).toBe('error');
    if (res.status === 'error') {
      expect(res.error.code).toBe('LIMIT_EXCEEDED');
      expect(res.steps[15].status).toBe('bypassed');
      expect(res.steps[16].status).toBe('error');
    }
  });
});
