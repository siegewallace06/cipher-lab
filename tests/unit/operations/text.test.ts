import { describe, expect, it } from 'vitest';
import { getOperationById } from '@/engine/registry';
import { type OperationContext, type Parameters } from '@/engine/types';
import { decodeUtf8Fatal, encodeUtf8 } from '@/lib/bytes';
import { MAX_REGEX_INPUT_BYTES, MAX_STEP_BYTES } from '@/lib/limits';

function makeContext(): OperationContext {
  return {
    signal: new AbortController().signal,
    crypto: globalThis.crypto,
    maxOutputBytes: MAX_STEP_BYTES,
  };
}

async function runOp(
  operationId: string,
  input: string | Uint8Array,
  params: Parameters = {},
): Promise<Uint8Array> {
  const op = getOperationById(operationId);
  if (!op) throw new Error(`Missing operation ${operationId}`);
  const bytes = typeof input === 'string' ? encodeUtf8(input) : input;
  return op.execute(bytes, params, makeContext());
}

describe('Text & Analysis Operations', () => {
  it('case: converts lower, upper, and deterministic token-first ASCII title case', async () => {
    const lower = await runOp('case', 'Hello WORLD', { mode: 'lower' });
    expect(decodeUtf8Fatal(lower)).toBe('hello world');

    const upper = await runOp('case', 'Hello WORLD', { mode: 'upper' });
    expect(decodeUtf8Fatal(upper)).toBe('HELLO WORLD');

    const title = await runOp('case', 'hELLO, wORLD! 2nd_test', {
      mode: 'title',
    });
    expect(decodeUtf8Fatal(title)).toBe('Hello, World! 2nd_test');
  });

  it('reverse: reverses by Unicode code points (preserving astral pairs) or LF-normalized lines', async () => {
    // Code-point reversal preserves astral surrogate pairs ('😀') and follows code-point order for combining marks
    const cpOut = await runOp('reverse', 'A😀B\u0301', { mode: 'code-points' });
    expect(decodeUtf8Fatal(cpOut)).toBe('\u0301B😀A');

    // Line reversal normalizes CRLF to LF and preserves trailing newline
    const linesWithTrailing = await runOp('reverse', 'first\r\nsecond\r\nthird\n', {
      mode: 'lines',
    });
    expect(decodeUtf8Fatal(linesWithTrailing)).toBe('third\nsecond\nfirst\n');

    const linesWithoutTrailing = await runOp('reverse', 'first\nsecond', {
      mode: 'lines',
    });
    expect(decodeUtf8Fatal(linesWithoutTrailing)).toBe('second\nfirst');
  });

  it('regex: supports find (UTF-16 indices + null unmatched groups) and replace ($&, $1, $<name>) with strict limits', async () => {
    // UTF-16 code-unit start/end indices after astral emoji '😀' (length 2 in UTF-16)
    const findOut = await runOp('regex', '😀abc', {
      pattern: '(a)(z)?(?<last>bc)',
      replacement: '',
      mode: 'find',
      flags: 'g',
    });
    const matches = JSON.parse(decodeUtf8Fatal(findOut));
    expect(matches).toEqual([
      {
        match: 'abc',
        captures: ['a', null, 'bc'],
        start: 2,
        end: 5,
      },
    ]);

    // Replace with $1, $<name>, and $$
    const replaceOut = await runOp('regex', 'item-42 item-99', {
      pattern: 'item-(?<num>\\d+)',
      replacement: '$$[$<num>]',
      mode: 'replace',
      flags: 'g',
    });
    expect(decodeUtf8Fatal(replaceOut)).toBe('$[42] $[99]');

    // Zero-length match with 'gu' flag advances by full Unicode code point without splitting surrogates
    const zeroLenOut = await runOp('regex', '😀', {
      pattern: '^|(?=.)',
      replacement: '-',
      mode: 'replace',
      flags: 'gu',
    });
    expect(decodeUtf8Fatal(zeroLenOut)).toBe('-😀');

    // Negative: unsupported flag 'y'
    await expect(
      runOp('regex', 'abc', {
        pattern: 'a',
        replacement: 'b',
        mode: 'replace',
        flags: 'gy',
      }),
    ).rejects.toMatchObject({
      operationError: { code: 'INVALID_PARAMETERS' },
    });

    // Negative: input exceeding MAX_REGEX_INPUT_BYTES (65,536 bytes)
    const oversized = new Uint8Array(MAX_REGEX_INPUT_BYTES + 1).fill(0x61);
    await expect(
      runOp('regex', oversized, {
        pattern: 'a',
        replacement: 'b',
        mode: 'replace',
        flags: 'g',
      }),
    ).rejects.toMatchObject({
      operationError: { code: 'LIMIT_EXCEEDED' },
    });

    // Negative: match count exceeding MAX_REGEX_MATCHES (10,000)
    const manyAs = 'a'.repeat(10_005);
    await expect(
      runOp('regex', manyAs, {
        pattern: 'a',
        replacement: 'b',
        mode: 'find',
        flags: 'g',
      }),
    ).rejects.toMatchObject({
      operationError: { code: 'LIMIT_EXCEEDED' },
    });
  });

  it('lines: sorts and deduplicates by Unicode code-point order while preserving terminal newline', async () => {
    const input = 'b\r\na\r\nB\r\na\r\n';
    const bothCaseSensitive = await runOp('lines', input, {
      action: 'both',
      order: 'ascending',
      caseSensitive: true,
    });
    // In Unicode code points: 'B' (66) < 'a' (97) < 'b' (98), with terminal '\n' preserved
    expect(decodeUtf8Fatal(bothCaseSensitive)).toBe('B\na\nb\n');

    const dedupInsensitive = await runOp('lines', 'Alpha\nalpha\nBeta', {
      action: 'deduplicate',
      order: 'ascending',
      caseSensitive: false,
    });
    expect(decodeUtf8Fatal(dedupInsensitive)).toBe('Alpha\nBeta');
  });

  it('entropy: computes exact Shannon entropy for empty (0), constant (0), binary (1), and uniform 256-byte (8) inputs', async () => {
    const emptyReport = JSON.parse(
      decodeUtf8Fatal(await runOp('entropy', new Uint8Array(0))),
    );
    expect(emptyReport.byteCount).toBe(0);
    expect(emptyReport.entropyBitsPerByte).toBe(0);
    expect(emptyReport.frequencies).toHaveLength(256);

    const singleReport = JSON.parse(
      decodeUtf8Fatal(await runOp('entropy', new Uint8Array(64).fill(0x41))),
    );
    expect(singleReport.byteCount).toBe(64);
    expect(singleReport.entropyBitsPerByte).toBe(0);

    const twoBytes = new Uint8Array(100);
    for (let i = 0; i < 100; i++) twoBytes[i] = i % 2;
    const twoReport = JSON.parse(
      decodeUtf8Fatal(await runOp('entropy', twoBytes)),
    );
    expect(twoReport.entropyBitsPerByte).toBe(1);

    const full256 = new Uint8Array(256);
    for (let i = 0; i < 256; i++) full256[i] = i;
    const fullReport = JSON.parse(
      decodeUtf8Fatal(await runOp('entropy', full256)),
    );
    expect(fullReport.byteCount).toBe(256);
    expect(fullReport.entropyBitsPerByte).toBe(8);
  });
});
