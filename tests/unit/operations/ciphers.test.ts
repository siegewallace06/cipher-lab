import { describe, expect, it } from 'vitest';
import { getOperationById } from '@/engine/registry';
import { OperationFailure, type OperationContext, type Parameters } from '@/engine/types';
import { decodeUtf8Fatal, encodeUtf8 } from '@/lib/bytes';
import { MAX_STEP_BYTES } from '@/lib/limits';

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

describe('Classical Cipher & Byte Transform Operations', () => {
  it('caesar: shifts ASCII letters preserving case and non-ASCII characters', async () => {
    const sample = 'Attack at dawn! 123 🌐';
    const enc = await runOp('caesar', sample, {
      direction: 'encode',
      shift: 3,
    });
    expect(decodeUtf8Fatal(enc)).toBe('Dwwdfn dw gdzq! 123 🌐');

    const dec = await runOp('caesar', enc, {
      direction: 'decode',
      shift: 3,
    });
    expect(decodeUtf8Fatal(dec)).toBe(sample);
  });

  it('rot13: is self-inverse over ASCII letters and preserves symbols/Unicode', async () => {
    const sample = 'Why did the chicken cross the road? 42!';
    const rot = await runOp('rot13', sample);
    expect(decodeUtf8Fatal(rot)).toBe(
      'Jul qvq gur puvpxra pebff gur ebnq? 42!',
    );
    const back = await runOp('rot13', rot);
    expect(decodeUtf8Fatal(back)).toBe(sample);
  });

  it('rail-fence: transposes Unicode code points across rails and inverts cleanly', async () => {
    // Classical 3-rail vector: 'WEAREDISCOVEREDFLEEATONCE' -> 'WECRLTEERDSOEEFEAOCAIVDEN'
    const sample = 'WEAREDISCOVEREDFLEEATONCE';
    const enc = await runOp('rail-fence', sample, {
      direction: 'encode',
      rails: 3,
    });
    expect(decodeUtf8Fatal(enc)).toBe('WECRLTEERDSOEEFEAOCAIVDEN');

    const dec = await runOp('rail-fence', enc, {
      direction: 'decode',
      rails: 3,
    });
    expect(decodeUtf8Fatal(dec)).toBe(sample);

    // Unicode astral code-point preservation & rails >= length identity behavior
    const emojiText = 'A😀B🚀C';
    const emojiEnc = await runOp('rail-fence', emojiText, {
      direction: 'encode',
      rails: 2,
    });
    expect(decodeUtf8Fatal(emojiEnc)).toBe('ABC😀🚀');
    const emojiDec = await runOp('rail-fence', emojiEnc, {
      direction: 'decode',
      rails: 2,
    });
    expect(decodeUtf8Fatal(emojiDec)).toBe(emojiText);

    const identityOut = await runOp('rail-fence', 'Hi', {
      direction: 'encode',
      rails: 5,
    });
    expect(decodeUtf8Fatal(identityOut)).toBe('Hi');
  });

  it('atbash: mirrors A-Z and a-z and is self-inverse', async () => {
    const sample = 'AbCdEfGhIjKlMnOpQrStUvWxYz!';
    const mir = await runOp('atbash', sample);
    expect(decodeUtf8Fatal(mir)).toBe('ZyXwVuTsRqPoNmLkJiHgFeDcBa!');
    const back = await runOp('atbash', mir);
    expect(decodeUtf8Fatal(back)).toBe(sample);
  });

  it('vigenere: encodes/decodes using alphabetic key without advancing key on non-letters', async () => {
    // Classical vector: 'ATTACKATDAWN' with key 'LEMON' -> 'LXFOPVEFRNHR'
    const enc = await runOp('vigenere', 'Attack at dawn!', {
      direction: 'encode',
      key: 'LEMON',
    });
    expect(decodeUtf8Fatal(enc)).toBe('Lxfopv ef rnhr!');

    const dec = await runOp('vigenere', enc, {
      direction: 'decode',
      key: 'lemon',
    });
    expect(decodeUtf8Fatal(dec)).toBe('Attack at dawn!');

    // Negative: non-alphabetic key or empty key
    await expectOpError(
      'vigenere',
      'hello',
      { direction: 'encode', key: 'KEY123' },
      'INVALID_PARAMETERS',
    );
    await expectOpError(
      'vigenere',
      'hello',
      { direction: 'encode', key: '' },
      'INVALID_PARAMETERS',
    );
  });

  it('xor: applies repeating key bytes in hex or utf8 encoding over raw bytes', async () => {
    const plain = new Uint8Array([0x00, 0xff, 0x55, 0xaa]);
    const xored = await runOp('xor', plain, {
      key: 'ff00',
      keyEncoding: 'hex',
    });
    expect(Array.from(xored)).toEqual([0xff, 0xff, 0xaa, 0xaa]);

    const restored = await runOp('xor', xored, {
      key: 'ff00',
      keyEncoding: 'hex',
    });
    expect(Array.from(restored)).toEqual(Array.from(plain));

    // Negative: invalid hex key
    await expectOpError(
      'xor',
      plain,
      { key: 'xyz', keyEncoding: 'hex' },
      'INVALID_PARAMETERS',
    );
  });

  it('morse: encodes and decodes ITU Morse table and fails on unsupported characters', async () => {
    const encoded = await runOp('morse', 'SOS 2026', { direction: 'encode' });
    expect(decodeUtf8Fatal(encoded)).toBe(
      '... --- ... / ..--- ----- ..--- -....',
    );

    const decoded = await runOp(
      'morse',
      '... --- ... / ..--- ----- ..--- -....',
      { direction: 'decode' },
    );
    expect(decodeUtf8Fatal(decoded)).toBe('SOS 2026');

    // Negative: unsupported character '#'
    await expectOpError(
      'morse',
      'HELLO #1',
      { direction: 'encode' },
      'INVALID_INPUT',
    );
    // Negative: unknown Morse token
    await expectOpError(
      'morse',
      '........',
      { direction: 'decode' },
      'INVALID_INPUT',
    );
  });
});
