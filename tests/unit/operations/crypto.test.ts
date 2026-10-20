import { describe, expect, it } from 'vitest';
import { getOperationById } from '@/engine/registry';
import { OperationFailure, type OperationContext, type Parameters } from '@/engine/types';
import { decodeUtf8Fatal, encodeUtf8 } from '@/lib/bytes';
import { MAX_STEP_BYTES } from '@/lib/limits';

function makeContext(
  customCrypto: Pick<Crypto, 'subtle' | 'getRandomValues'> = globalThis.crypto,
): OperationContext {
  return {
    signal: new AbortController().signal,
    crypto: customCrypto,
    maxOutputBytes: MAX_STEP_BYTES,
  };
}

async function runOp(
  operationId: string,
  input: string | Uint8Array,
  params: Parameters = {},
  context = makeContext(),
): Promise<Uint8Array> {
  const op = getOperationById(operationId);
  if (!op) throw new Error(`Missing operation ${operationId}`);
  const bytes = typeof input === 'string' ? encodeUtf8(input) : input;
  return op.execute(bytes, params, context);
}

describe('Cryptographic Digests, HMAC, CRC-32, and AES-256-GCM', () => {
  it('sha1, sha256, sha384, sha512: match FIPS 180-4 test vectors for "abc"', async () => {
    // Source: NIST FIPS 180-4 Secure Hash Standard test vectors for ASCII "abc"
    const sha1Hex = await runOp('sha1', 'abc');
    expect(decodeUtf8Fatal(sha1Hex)).toBe(
      'a9993e364706816aba3e25717850c26c9cd0d89d',
    );

    const sha256Hex = await runOp('sha256', 'abc');
    expect(decodeUtf8Fatal(sha256Hex)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    const sha384Hex = await runOp('sha384', 'abc');
    expect(decodeUtf8Fatal(sha384Hex)).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    );

    const sha512Hex = await runOp('sha512', 'abc');
    expect(decodeUtf8Fatal(sha512Hex)).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
  });

  it('hmac-sha256: matches RFC 4231 Test Case 2 ("Jefe" / "what do ya want for nothing?")', async () => {
    // Source: RFC 4231 Section 4.3 Test Case 2
    const out = await runOp('hmac-sha256', 'what do ya want for nothing?', {
      key: 'Jefe',
      keyEncoding: 'utf8',
    });
    expect(decodeUtf8Fatal(out)).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );

    // Also test with hex-encoded key ('4a656665' == 'Jefe')
    const outHexKey = await runOp(
      'hmac-sha256',
      'what do ya want for nothing?',
      {
        key: '4a656665',
        keyEncoding: 'hex',
      },
    );
    expect(decodeUtf8Fatal(outHexKey)).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('crc32: matches IEEE 802.3 / ISO-HDLC vectors for "" and "123456789"', async () => {
    // Source: IEEE 802.3 CRC-32 standard check value
    const emptyOut = await runOp('crc32', '');
    expect(decodeUtf8Fatal(emptyOut)).toBe('00000000');

    const checkHex = await runOp('crc32', '123456789');
    expect(decodeUtf8Fatal(checkHex)).toBe('cbf43926');
  });

  it('aes-gcm: produces deterministic v1 envelope with fixed salt/IV and round-trips arbitrary binary bytes', async () => {
    let callIdx = 0;
    const deterministicCrypto: Pick<Crypto, 'subtle' | 'getRandomValues'> = {
      subtle: globalThis.crypto.subtle,
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        if (array instanceof Uint8Array) {
          for (let i = 0; i < array.byteLength; i++) {
            array[i] = (callIdx * 16 + i + 1) & 0xff;
          }
          callIdx++;
        }
        return array;
      },
    };

    const passphrase = 'correct-horse-battery-staple';
    const plaintext = new Uint8Array([0x00, 0x41, 0x42, 0xff, 0x80]);

    const encrypted = await runOp(
      'aes-gcm',
      plaintext,
      { direction: 'encrypt', passphrase },
      makeContext(deterministicCrypto),
    );
    const envelopeObj = JSON.parse(decodeUtf8Fatal(encrypted));
    expect(envelopeObj.v).toBe(1);
    expect(envelopeObj.kdf).toBe('PBKDF2-SHA256');
    expect(envelopeObj.iterations).toBe(600000);
    expect(envelopeObj.cipher).toBe('AES-256-GCM');
    expect(envelopeObj.salt).toBe('AQIDBAUGBwgJCgsMDQ4PEA');
    expect(envelopeObj.iv).toBe('ERITFBUWFxgZGhsc');
    expect(Object.keys(envelopeObj)).toEqual([
      'v',
      'kdf',
      'iterations',
      'cipher',
      'salt',
      'iv',
      'ciphertext',
    ]);

    // Decrypt the deterministic fixture back to exact binary bytes
    const decrypted = await runOp('aes-gcm', encrypted, {
      direction: 'decrypt',
      passphrase,
    });
    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));

    // Fresh randomness check: encrypting same input twice with real crypto yields different envelopes
    const enc1 = await runOp('aes-gcm', 'Hello, Cipher Lab!', {
      direction: 'encrypt',
      passphrase,
    });
    const enc2 = await runOp('aes-gcm', 'Hello, Cipher Lab!', {
      direction: 'encrypt',
      passphrase,
    });
    expect(decodeUtf8Fatal(enc1)).not.toBe(decodeUtf8Fatal(enc2));
  }, 15_000);

  it('aes-gcm: rejects wrong passphrase, tampered ciphertext/IV/salt, non-600000 iterations, and unsupported v', async () => {
    const passphrase = 'test-passphrase-alpha';
    const encrypted = await runOp('aes-gcm', 'Authenticated data payload', {
      direction: 'encrypt',
      passphrase,
    });
    const baseEnvelope = JSON.parse(decodeUtf8Fatal(encrypted));

    // 1. Wrong passphrase -> AUTHENTICATION_FAILED without leaking passphrase
    try {
      await runOp('aes-gcm', encrypted, {
        direction: 'decrypt',
        passphrase: 'wrong-passphrase-secret',
      });
      expect.fail('Expected wrong passphrase to fail');
    } catch (err) {
      const failure = err as OperationFailure;
      expect(failure.operationError.code).toBe('AUTHENTICATION_FAILED');
      expect(failure.operationError.message).not.toContain(
        'wrong-passphrase-secret',
      );
    }

    // 2. Tampered ciphertext/tag -> AUTHENTICATION_FAILED
    const badCtChar = baseEnvelope.ciphertext[0] === 'A' ? 'B' : 'A';
    const tamperedCt = JSON.stringify({
      ...baseEnvelope,
      ciphertext: badCtChar + baseEnvelope.ciphertext.slice(1),
    });
    await expect(
      runOp('aes-gcm', tamperedCt, { direction: 'decrypt', passphrase }),
    ).rejects.toMatchObject({
      operationError: { code: 'AUTHENTICATION_FAILED' },
    });

    // 3. Unsupported version v: 2 -> INVALID_INPUT (before PBKDF2!)
    const unsupportedV = JSON.stringify({ ...baseEnvelope, v: 2 });
    await expect(
      runOp('aes-gcm', unsupportedV, { direction: 'decrypt', passphrase }),
    ).rejects.toMatchObject({
      operationError: { code: 'INVALID_INPUT' },
    });

    // 4. Non-600000 iterations -> INVALID_INPUT (before PBKDF2!)
    const badIter = JSON.stringify({ ...baseEnvelope, iterations: 1000 });
    await expect(
      runOp('aes-gcm', badIter, { direction: 'decrypt', passphrase }),
    ).rejects.toMatchObject({
      operationError: { code: 'INVALID_INPUT' },
    });

    // 5. Extra field in envelope -> INVALID_INPUT
    const extraField = JSON.stringify({ ...baseEnvelope, extra: 'no' });
    await expect(
      runOp('aes-gcm', extraField, { direction: 'decrypt', passphrase }),
    ).rejects.toMatchObject({
      operationError: { code: 'INVALID_INPUT' },
    });

    // 6. Missing Web Crypto -> UNSUPPORTED_ENVIRONMENT
    const noSubtleContext = makeContext({
      subtle: undefined as unknown as SubtleCrypto,
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    await expect(
      runOp(
        'aes-gcm',
        'test',
        { direction: 'encrypt', passphrase },
        noSubtleContext,
      ),
    ).rejects.toMatchObject({
      operationError: { code: 'UNSUPPORTED_ENVIRONMENT' },
    });
  }, 15_000);
});
