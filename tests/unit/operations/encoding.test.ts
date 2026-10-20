import { describe, expect, it } from 'vitest';
import { getOperationById } from '@/engine/registry';
import { OperationFailure, type OperationContext, type Parameters } from '@/engine/types';
import { decodeUtf8Fatal, encodeUtf8 } from '@/lib/bytes';
import { MAX_STEP_BYTES } from '@/lib/limits';
import { checkJsonPrecisionNotice } from '@/operations/encoding';

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

async function expectOpError(
  operationId: string,
  input: string | Uint8Array,
  params: Parameters,
  expectedErrorCode: string,
) {
  try {
    await runOp(operationId, input, params);
    expect.fail(`Expected ${operationId} to fail with ${expectedErrorCode}`);
  } catch (err) {
    expect(err).toBeInstanceOf(OperationFailure);
    expect((err as OperationFailure).operationError.code).toBe(expectedErrorCode);
  }
}

describe('Encoding Operations (RFC 4648 & specification vectors)', () => {
  it('base64: matches RFC 4648 §10 vectors and enforces strict alphabet, padding, and trailing bits', async () => {
    // Source: RFC 4648 Section 10 test vectors
    const rfcVectors: Array<[string, string]> = [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg=='],
      ['fooba', 'Zm9vYmE='],
      ['foobar', 'Zm9vYmFy'],
    ];

    for (const [plain, encoded] of rfcVectors) {
      const out = await runOp('base64', plain, {
        direction: 'encode',
        alphabet: 'standard',
        padding: true,
      });
      expect(decodeUtf8Fatal(out)).toBe(encoded);

      const back = await runOp('base64', encoded, {
        direction: 'decode',
        alphabet: 'standard',
        padding: true,
      });
      expect(decodeUtf8Fatal(back)).toBe(plain);
    }

    // URL-safe unpadded round-trip with binary bytes 0xfb, 0xff, 0xfe ('-__-')
    const rawBytes = new Uint8Array([0xfb, 0xff, 0xfe]);
    const b64Url = await runOp('base64', rawBytes, {
      direction: 'encode',
      alphabet: 'url-safe',
      padding: false,
    });
    expect(decodeUtf8Fatal(b64Url)).toBe('-__-');

    const decodedUrl = await runOp('base64', '-__-', {
      direction: 'decode',
      alphabet: 'url-safe',
      padding: false,
    });
    expect(Array.from(decodedUrl)).toEqual([0xfb, 0xff, 0xfe]);

    // Negative: non-canonical trailing bits in 2-char quantum ('Zh==' has non-zero low 4 bits)
    await expectOpError(
      'base64',
      'Zh==',
      { direction: 'decode', alphabet: 'standard', padding: true },
      'INVALID_INPUT',
    );
    // Negative: wrong alphabet character '_' in standard mode
    await expectOpError(
      'base64',
      '-__-',
      { direction: 'decode', alphabet: 'standard', padding: true },
      'INVALID_INPUT',
    );
    // Negative: invalid quantum length 1
    await expectOpError(
      'base64',
      'A',
      { direction: 'decode', alphabet: 'standard', padding: true },
      'INVALID_INPUT',
    );
  });

  it('base32: matches RFC 4648 §10 vectors and rejects non-canonical padding/bits', async () => {
    // Source: RFC 4648 Section 10 Base32 test vectors
    const rfcVectors: Array<[string, string]> = [
      ['', ''],
      ['f', 'MY======'],
      ['fo', 'MZXQ===='],
      ['foo', 'MZXW6==='],
      ['foob', 'MZXW6YQ='],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI======'],
    ];

    for (const [plain, encoded] of rfcVectors) {
      const out = await runOp('base32', plain, {
        direction: 'encode',
        padding: true,
      });
      expect(decodeUtf8Fatal(out)).toBe(encoded);

      const back = await runOp('base32', encoded.toLowerCase(), {
        direction: 'decode',
        padding: true,
      });
      expect(decodeUtf8Fatal(back)).toBe(plain);
    }

    // Negative: invalid Base32 character '8'
    await expectOpError(
      'base32',
      'MZXW8===',
      { direction: 'decode', padding: true },
      'INVALID_INPUT',
    );
    // Negative: non-canonical trailing bits ('MZ======' -> 'Z' is 25 = 11001, low 2 bits non-zero)
    await expectOpError(
      'base32',
      'MZ======',
      { direction: 'decode', padding: true },
      'INVALID_INPUT',
    );
  });

  it('hex: encodes lower/upper and decodes whitespace-separated byte pairs while rejecting split pairs', async () => {
    const outLower = await runOp('hex', 'Hi!', {
      direction: 'encode',
      case: 'lower',
    });
    expect(decodeUtf8Fatal(outLower)).toBe('486921');

    const outUpper = await runOp('hex', 'Hi!', {
      direction: 'encode',
      case: 'upper',
    });
    expect(decodeUtf8Fatal(outUpper)).toBe('486921'.toUpperCase());

    const decoded = await runOp('hex', '48 69\n21', {
      direction: 'decode',
      case: 'lower',
    });
    expect(decodeUtf8Fatal(decoded)).toBe('Hi!');

    // Negative: odd digit count
    await expectOpError(
      'hex',
      '486',
      { direction: 'decode', case: 'lower' },
      'INVALID_INPUT',
    );
    // Negative: whitespace splitting a byte pair
    await expectOpError(
      'hex',
      '4 8',
      { direction: 'decode', case: 'lower' },
      'INVALID_INPUT',
    );
  });

  it('binary: encodes 8-bit octets with space/none separator and rejects non-8-bit groups', async () => {
    const spaced = await runOp('binary', 'AB', {
      direction: 'encode',
      separator: 'space',
    });
    expect(decodeUtf8Fatal(spaced)).toBe('01000001 01000010');

    const compact = await runOp('binary', 'AB', {
      direction: 'encode',
      separator: 'none',
    });
    expect(decodeUtf8Fatal(compact)).toBe('0100000101000010');

    const decoded = await runOp('binary', '01000001 01000010', {
      direction: 'decode',
      separator: 'space',
    });
    expect(decodeUtf8Fatal(decoded)).toBe('AB');

    await expectOpError(
      'binary',
      '0100001',
      { direction: 'decode', separator: 'space' },
      'INVALID_INPUT',
    );
  });

  it('url: encodes and decodes RFC 3986 percent-encoding and preserves + literal on decode', async () => {
    const encoded = await runOp('url', 'a+b c?d=1&e=2', {
      direction: 'encode',
    });
    expect(decodeUtf8Fatal(encoded)).toBe('a%2Bb%20c%3Fd%3D1%26e%3D2');

    // Decode preserves '+' as '+' (RFC 3986, not application/x-www-form-urlencoded)
    const decodedPlus = await runOp('url', 'a+b%20c', {
      direction: 'decode',
    });
    expect(decodeUtf8Fatal(decodedPlus)).toBe('a+b c');

    // Negative: truncated escape
    await expectOpError('url', '100%2', { direction: 'decode' }, 'INVALID_INPUT');
    // Negative: invalid UTF-8 percent sequence (%FF)
    await expectOpError('url', '%FF', { direction: 'decode' }, 'INVALID_INPUT');
  });

  it('html-entities: encodes 5 core XML/HTML entities and decodes named/decimal/hex references while keeping unsupported named entities intact', async () => {
    const encoded = await runOp('html-entities', `<tag attr="a&b">'ok'</tag>`, {
      direction: 'encode',
    });
    expect(decodeUtf8Fatal(encoded)).toBe(
      '&lt;tag attr=&quot;a&amp;b&quot;&gt;&apos;ok&apos;&lt;/tag&gt;',
    );

    const decoded = await runOp(
      'html-entities',
      '&lt;div&gt;&#65;&#x42;&#x1F600;&nbsp;&unknown;&lt;/div&gt;',
      { direction: 'decode' },
    );
    expect(decodeUtf8Fatal(decoded)).toBe('<div>AB😀&nbsp;&unknown;</div>');

    // Negative: surrogate range &#xD800;
    await expectOpError(
      'html-entities',
      '&#xD800;',
      { direction: 'decode' },
      'INVALID_INPUT',
    );
    // Negative: above U+10FFFF
    await expectOpError(
      'html-entities',
      '&#x110000;',
      { direction: 'decode' },
      'INVALID_INPUT',
    );
  });

  it('json: prettifies, minifies, detects unsafe integer precision warnings, and enforces depth/node caps', async () => {
    const raw = '{"b":1,"a":[true,null]}';
    const pretty2 = await runOp('json', raw, { mode: 'pretty', indent: 2 });
    expect(decodeUtf8Fatal(pretty2)).toBe(
      '{\n  "b": 1,\n  "a": [\n    true,\n    null\n  ]\n}',
    );

    const minified = await runOp('json', decodeUtf8Fatal(pretty2), {
      mode: 'minify',
      indent: 2,
    });
    expect(decodeUtf8Fatal(minified)).toBe(raw);

    // Precision warning for integer outside ±(2^53 - 1)
    expect(checkJsonPrecisionNotice('{"id": 9007199254740993}')).toMatch(
      /9007199254740991/,
    );
    expect(checkJsonPrecisionNotice('{"id": 42}')).toBeUndefined();

    // Depth 64 passes, depth 65 fails with LIMIT_EXCEEDED
    const depth64 = '['.repeat(63) + '1' + ']'.repeat(63); // root array (1) + 62 nested arrays + scalar (depth 64)
    const ok64 = await runOp('json', depth64, { mode: 'minify', indent: 2 });
    expect(decodeUtf8Fatal(ok64)).toBe(depth64);

    const depth65 = '['.repeat(64) + '1' + ']'.repeat(64);
    await expectOpError(
      'json',
      depth65,
      { mode: 'minify', indent: 2 },
      'LIMIT_EXCEEDED',
    );
  });

  it('jwt: decodes compact 3-segment tokens with verified:false and timestamp annotations', async () => {
    // Header: {"alg":"HS256","typ":"JWT"} -> eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
    // Payload: {"sub":"1234567890","iat":1516239022,"exp":1893456000} -> eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE4OTM0NTYwMDB9
    // Signature: SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE4OTM0NTYwMDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

    const out = await runOp('jwt', token);
    const parsed = JSON.parse(decodeUtf8Fatal(out));
    expect(parsed.verified).toBe(false);
    expect(parsed.unsigned).toBe(false);
    expect(parsed.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(parsed.payload.sub).toBe('1234567890');
    expect(parsed.annotations.timestamps.iat).toBe('2018-01-18T01:30:22.000Z');
    expect(parsed.annotations.timestamps.exp).toBe('2030-01-01T00:00:00.000Z');

    // Unsigned token (empty 3rd segment)
    const unsignedToken =
      'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyLTEifQ.';
    const unsignedOut = JSON.parse(
      decodeUtf8Fatal(await runOp('jwt', unsignedToken)),
    );
    expect(unsignedOut.verified).toBe(false);
    expect(unsignedOut.unsigned).toBe(true);
    expect(unsignedOut.signature.status).toBe('unsigned');

    // Negative: 2 segments
    await expectOpError('jwt', 'a.b', {}, 'INVALID_INPUT');
  });

  it('timestamp: converts Unix epochs (seconds & ms, including negative) and timezone-qualified ISO-8601', async () => {
    const isoZero = await runOp('timestamp', '0', {
      direction: 'epoch-to-iso',
      unit: 'seconds',
    });
    expect(decodeUtf8Fatal(isoZero)).toBe('1970-01-01T00:00:00.000Z');

    const isoNeg = await runOp('timestamp', '-1', {
      direction: 'epoch-to-iso',
      unit: 'seconds',
    });
    expect(decodeUtf8Fatal(isoNeg)).toBe('1969-12-31T23:59:59.000Z');

    const epochSec = await runOp('timestamp', '2026-04-20T00:00:00Z', {
      direction: 'iso-to-epoch',
      unit: 'seconds',
    });
    expect(decodeUtf8Fatal(epochSec)).toBe('1776643200');

    const epochMs = await runOp('timestamp', '2026-04-20T02:00:00.250+02:00', {
      direction: 'iso-to-epoch',
      unit: 'milliseconds',
    });
    expect(decodeUtf8Fatal(epochMs)).toBe('1776643200250');

    // Negative: missing timezone
    await expectOpError(
      'timestamp',
      '2026-04-20T00:00:00',
      { direction: 'iso-to-epoch', unit: 'seconds' },
      'INVALID_INPUT',
    );
    // Negative: non-existent calendar date Feb 30
    await expectOpError(
      'timestamp',
      '2026-02-30T00:00:00Z',
      { direction: 'iso-to-epoch', unit: 'seconds' },
      'INVALID_INPUT',
    );
  });
});
