import { OperationFailure, type OperationContext } from '@/engine/types';
import {
  decodeBase64Strict,
  decodeUtf8Fatal,
  encodeBase64,
  encodeUtf8,
  inspectRawJsonText,
} from '@/lib/bytes';
import { MAX_STEP_BYTES } from '@/lib/limits';

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_KDF = 'PBKDF2-SHA256';
export const ENVELOPE_ITERATIONS = 600_000;
export const ENVELOPE_CIPHER = 'AES-256-GCM';
export const ENVELOPE_SALT_BYTES = 16;
export const ENVELOPE_IV_BYTES = 12;
export const ENVELOPE_TAG_BYTES = 16;
export const ENVELOPE_TAG_BITS = 128;
export const ENVELOPE_AAD_TEXT =
  'CipherLab:aes-gcm:v1:PBKDF2-SHA256:600000';

const ENVELOPE_AAD_BYTES = encodeUtf8(ENVELOPE_AAD_TEXT);
const EXPECTED_ENVELOPE_KEYS = [
  'v',
  'kdf',
  'iterations',
  'cipher',
  'salt',
  'iv',
  'ciphertext',
] as const;

export interface AesGcmEnvelopeV1 {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: 600000;
  cipher: 'AES-256-GCM';
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface ParsedAesGcmEnvelope {
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

function assertCryptoAvailable(
  cryptoProvider: OperationContext['crypto'] | undefined,
): Pick<Crypto, 'subtle' | 'getRandomValues'> {
  if (
    !cryptoProvider ||
    !cryptoProvider.subtle ||
    typeof cryptoProvider.getRandomValues !== 'function'
  ) {
    throw new OperationFailure(
      'UNSUPPORTED_ENVIRONMENT',
      'Web Crypto API (SubtleCrypto and getRandomValues) is unavailable in this environment.',
    );
  }
  return cryptoProvider;
}

function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

async function deriveAesGcmKey(
  cryptoProvider: Pick<Crypto, 'subtle' | 'getRandomValues'>,
  passphraseBytes: Uint8Array,
  saltBytes: Uint8Array,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  try {
    const baseKey = await cryptoProvider.subtle.importKey(
      'raw',
      toBufferSource(passphraseBytes),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return await cryptoProvider.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: toBufferSource(saltBytes),
        iterations: ENVELOPE_ITERATIONS,
      },
      baseKey,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      [usage],
    );
  } catch {
    throw new OperationFailure(
      'UNSUPPORTED_ENVIRONMENT',
      'Cryptographic key derivation failed in the current runtime environment.',
    );
  }
}

export function serializeEnvelopeV1(envelope: AesGcmEnvelopeV1): string {
  // Fixed field serialization order per technical-design.md ch. 5
  return JSON.stringify({
    v: envelope.v,
    kdf: envelope.kdf,
    iterations: envelope.iterations,
    cipher: envelope.cipher,
    salt: envelope.salt,
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
  });
}

export function parseAndValidateEnvelopeV1(
  inputBytes: Uint8Array,
  maxOutputBytes = MAX_STEP_BYTES,
): ParsedAesGcmEnvelope {
  if (inputBytes.byteLength > maxOutputBytes) {
    throw new OperationFailure(
      'LIMIT_EXCEEDED',
      'Encrypted envelope input exceeds maximum step size limit.',
    );
  }

  let rawText: string;
  try {
    rawText = decodeUtf8Fatal(inputBytes);
  } catch {
    throw new OperationFailure(
      'INVALID_INPUT',
      'AES-GCM decryption requires a valid UTF-8 JSON envelope.',
    );
  }

  const rawCheck = inspectRawJsonText(rawText);
  if (rawCheck.hasForbiddenKey || rawCheck.hasDuplicateKey) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'AES-GCM envelope contains prohibited or duplicate JSON properties.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new OperationFailure(
      'INVALID_INPUT',
      'AES-GCM decryption input is not valid JSON.',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'AES-GCM envelope must be a JSON object.',
    );
  }

  const obj = parsed as Record<string, unknown>;
  const ownKeys = Object.getOwnPropertyNames(obj);

  if (ownKeys.length !== EXPECTED_ENVELOPE_KEYS.length) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'AES-GCM envelope must contain the exact v1 field set.',
    );
  }

  for (const requiredKey of EXPECTED_ENVELOPE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(obj, requiredKey)) {
      throw new OperationFailure(
        'INVALID_INPUT',
        `AES-GCM envelope is missing required field "${requiredKey}".`,
      );
    }
  }

  if (obj.v !== ENVELOPE_VERSION) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Unsupported AES-GCM envelope version.',
    );
  }
  if (obj.kdf !== ENVELOPE_KDF) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Unsupported AES-GCM key derivation function.',
    );
  }
  if (obj.iterations !== ENVELOPE_ITERATIONS) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Unsupported PBKDF2 iteration count in envelope.',
    );
  }
  if (obj.cipher !== ENVELOPE_CIPHER) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Unsupported cipher identifier in envelope.',
    );
  }

  if (
    typeof obj.salt !== 'string' ||
    typeof obj.iv !== 'string' ||
    typeof obj.ciphertext !== 'string'
  ) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Envelope binary fields must be Base64url strings.',
    );
  }

  const decodeCanonicalField = (
    value: string,
    fieldName: string,
    maxBytes: number,
  ): Uint8Array => {
    if (value.length === 0) {
      throw new OperationFailure(
        'INVALID_INPUT',
        `Envelope field "${fieldName}" must not be empty.`,
      );
    }
    const bytes = decodeBase64Strict(value, {
      alphabet: 'url-safe',
      requireUnpadded: true,
      maxOutputBytes: maxBytes,
    });
    const reencoded = encodeBase64(bytes, {
      alphabet: 'url-safe',
      padding: false,
    });
    if (reencoded !== value) {
      throw new OperationFailure(
        'INVALID_INPUT',
        `Envelope field "${fieldName}" is not canonical unpadded Base64url.`,
      );
    }
    return bytes;
  };

  const saltBytes = decodeCanonicalField(
    obj.salt,
    'salt',
    ENVELOPE_SALT_BYTES,
  );
  if (saltBytes.byteLength !== ENVELOPE_SALT_BYTES) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Envelope salt must be exactly 16 bytes.',
    );
  }

  const ivBytes = decodeCanonicalField(obj.iv, 'iv', ENVELOPE_IV_BYTES);
  if (ivBytes.byteLength !== ENVELOPE_IV_BYTES) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Envelope IV must be exactly 12 bytes.',
    );
  }

  const ciphertextBytes = decodeCanonicalField(
    obj.ciphertext,
    'ciphertext',
    maxOutputBytes + ENVELOPE_TAG_BYTES,
  );
  if (ciphertextBytes.byteLength < ENVELOPE_TAG_BYTES) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Envelope ciphertext is shorter than the required 16-byte authentication tag.',
    );
  }

  const plaintextLen = ciphertextBytes.byteLength - ENVELOPE_TAG_BYTES;
  if (plaintextLen > maxOutputBytes) {
    throw new OperationFailure(
      'LIMIT_EXCEEDED',
      'Decrypted plaintext length would exceed the step output size limit.',
    );
  }

  return {
    salt: saltBytes,
    iv: ivBytes,
    ciphertext: ciphertextBytes,
  };
}

export async function encryptAesGcmEnvelope(
  plaintext: Uint8Array,
  passphrase: string,
  context: OperationContext,
): Promise<Uint8Array> {
  const cryptoProvider = assertCryptoAvailable(context.crypto);
  if (plaintext.byteLength > context.maxOutputBytes) {
    throw new OperationFailure(
      'LIMIT_EXCEEDED',
      'Plaintext exceeds maximum step size limit.',
    );
  }

  // Pre-estimate serialized envelope size before expensive PBKDF2 derivation
  const estimatedCiphertextBytes = plaintext.byteLength + ENVELOPE_TAG_BYTES;
  const estimatedB64Len = Math.ceil((estimatedCiphertextBytes * 4) / 3);
  const estimatedJsonBytes = estimatedB64Len + 180;
  if (estimatedJsonBytes > context.maxOutputBytes) {
    throw new OperationFailure(
      'LIMIT_EXCEEDED',
      'Encrypted JSON envelope would exceed the maximum step output size limit.',
    );
  }

  const passphraseBytes = encodeUtf8(passphrase);
  const salt = cryptoProvider.getRandomValues(
    new Uint8Array(ENVELOPE_SALT_BYTES),
  );
  const iv = cryptoProvider.getRandomValues(new Uint8Array(ENVELOPE_IV_BYTES));

  const key = await deriveAesGcmKey(
    cryptoProvider,
    passphraseBytes,
    salt,
    'encrypt',
  );

  let encryptedBuffer: ArrayBuffer;
  try {
    encryptedBuffer = await cryptoProvider.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toBufferSource(iv),
        additionalData: toBufferSource(ENVELOPE_AAD_BYTES),
        tagLength: ENVELOPE_TAG_BITS,
      },
      key,
      toBufferSource(plaintext),
    );
  } catch {
    throw new OperationFailure(
      'INTERNAL_ERROR',
      'AES-GCM encryption failed unexpectedly.',
    );
  }

  const ciphertextBytes = new Uint8Array(encryptedBuffer);
  const jsonString = serializeEnvelopeV1({
    v: ENVELOPE_VERSION,
    kdf: ENVELOPE_KDF,
    iterations: ENVELOPE_ITERATIONS,
    cipher: ENVELOPE_CIPHER,
    salt: encodeBase64(salt, { alphabet: 'url-safe', padding: false }),
    iv: encodeBase64(iv, { alphabet: 'url-safe', padding: false }),
    ciphertext: encodeBase64(ciphertextBytes, {
      alphabet: 'url-safe',
      padding: false,
    }),
  });

  const outputBytes = encodeUtf8(jsonString);
  if (outputBytes.byteLength > context.maxOutputBytes) {
    throw new OperationFailure(
      'LIMIT_EXCEEDED',
      'Encrypted JSON envelope exceeds the maximum step output size limit.',
    );
  }

  return outputBytes;
}

export async function decryptAesGcmEnvelope(
  envelopeBytes: Uint8Array,
  passphrase: string,
  context: OperationContext,
): Promise<Uint8Array> {
  const cryptoProvider = assertCryptoAvailable(context.crypto);
  const parsed = parseAndValidateEnvelopeV1(
    envelopeBytes,
    context.maxOutputBytes,
  );

  const passphraseBytes = encodeUtf8(passphrase);
  const key = await deriveAesGcmKey(
    cryptoProvider,
    passphraseBytes,
    parsed.salt,
    'decrypt',
  );

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await cryptoProvider.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toBufferSource(parsed.iv),
        additionalData: toBufferSource(ENVELOPE_AAD_BYTES),
        tagLength: ENVELOPE_TAG_BITS,
      },
      key,
      toBufferSource(parsed.ciphertext),
    );
  } catch {
    throw new OperationFailure(
      'AUTHENTICATION_FAILED',
      'Authentication failed: invalid passphrase or tampered ciphertext.',
    );
  }

  const outputBytes = new Uint8Array(decryptedBuffer);
  if (outputBytes.byteLength > context.maxOutputBytes) {
    throw new OperationFailure(
      'LIMIT_EXCEEDED',
      'Decrypted output exceeds the maximum step output size limit.',
    );
  }

  return outputBytes;
}
