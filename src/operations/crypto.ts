import {
  OperationFailure,
  type OperationContext,
  type OperationDefinition,
  type OperationError,
  type Parameters,
} from '@/engine/types';
import { decodeHexStrict, encodeHex, encodeUtf8 } from '@/lib/bytes';
import {
  decryptAesGcmEnvelope,
  encryptAesGcmEnvelope,
} from '@/lib/crypto-envelope';
import { validateParametersAgainstFields } from '@/lib/parameter-schema';

function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function createDigestOperation(
  id: 'sha1' | 'sha256' | 'sha384' | 'sha512',
  label: string,
  webCryptoAlg: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512',
  description: string,
  securityNote: string,
): OperationDefinition {
  return {
    id,
    label,
    category: 'crypto',
    description,
    securityNote,
    inputKind: 'bytes',
    parameters: [],
    validate(params: Parameters) {
      return validateParametersAgainstFields(this.parameters, params);
    },
    async execute(
      input: Uint8Array,
      _params: Parameters,
      context: OperationContext,
    ): Promise<Uint8Array> {
      if (
        !context.crypto ||
        !context.crypto.subtle ||
        typeof context.crypto.subtle.digest !== 'function'
      ) {
        throw new OperationFailure(
          'UNSUPPORTED_ENVIRONMENT',
          'Web Crypto digest API is unavailable in this environment.',
        );
      }

      let digestBuffer: ArrayBuffer;
      try {
        digestBuffer = await context.crypto.subtle.digest(
          webCryptoAlg,
          toBufferSource(input),
        );
      } catch {
        throw new OperationFailure(
          'UNSUPPORTED_ENVIRONMENT',
          `Cryptographic provider failed to compute ${webCryptoAlg}.`,
        );
      }

      const hex = encodeHex(new Uint8Array(digestBuffer), 'lower');
      return encodeUtf8(hex);
    },
  };
}

export const sha1Operation = createDigestOperation(
  'sha1',
  'SHA-1 Digest (Legacy)',
  'SHA-1',
  'Compute 160-bit legacy SHA-1 digest as 40 lowercase hexadecimal characters.',
  'SHA-1 is a legacy digest vulnerable to collision attacks and is not a password-storage mechanism.',
);

export const sha256Operation = createDigestOperation(
  'sha256',
  'SHA-256 Digest',
  'SHA-256',
  'Compute 256-bit SHA-256 cryptographic digest as 64 lowercase hexadecimal characters.',
  'General-purpose cryptographic digest; not a password-hashing function.',
);

export const sha384Operation = createDigestOperation(
  'sha384',
  'SHA-384 Digest',
  'SHA-384',
  'Compute 384-bit SHA-384 cryptographic digest as 96 lowercase hexadecimal characters.',
  'General-purpose cryptographic digest; not a password-hashing function.',
);

export const sha512Operation = createDigestOperation(
  'sha512',
  'SHA-512 Digest',
  'SHA-512',
  'Compute 512-bit SHA-512 cryptographic digest as 128 lowercase hexadecimal characters.',
  'General-purpose cryptographic digest; not a password-hashing function.',
);

function parseHmacKeyBytes(
  key: string,
  keyEncoding: 'utf8' | 'hex',
): Uint8Array {
  if (key.length === 0) {
    throw new OperationFailure(
      'INVALID_PARAMETERS',
      'HMAC secret key is required.',
      'key',
    );
  }
  if (keyEncoding === 'hex') {
    let decoded: Uint8Array;
    try {
      decoded = decodeHexStrict(key);
    } catch {
      throw new OperationFailure(
        'INVALID_PARAMETERS',
        'HMAC hex key must contain valid two-digit hexadecimal byte pairs.',
        'key',
      );
    }
    if (decoded.byteLength === 0) {
      throw new OperationFailure(
        'INVALID_PARAMETERS',
        'HMAC hex key must decode to at least one byte.',
        'key',
      );
    }
    return decoded;
  }
  return encodeUtf8(key);
}

export const hmacSha256Operation: OperationDefinition = {
  id: 'hmac-sha256',
  label: 'HMAC-SHA256',
  category: 'crypto',
  description:
    'Compute keyed-hash message authentication code (HMAC-SHA256) using a UTF-8 or hexadecimal secret key.',
  inputKind: 'bytes',
  parameters: [
    {
      key: 'keyEncoding',
      label: 'Key Encoding',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'utf8',
      options: ['utf8', 'hex'],
    },
    {
      key: 'key',
      label: 'Secret Key',
      kind: 'secret',
      required: true,
      secret: true,
      placeholder: 'Secret HMAC key',
    },
  ],
  validate(params: Parameters): readonly OperationError[] {
    const errors = validateParametersAgainstFields(this.parameters, params);
    if (errors.length > 0) return errors;
    const keyEncoding = (params.keyEncoding ?? 'utf8') as 'utf8' | 'hex';
    const key = String(params.key ?? '');
    try {
      parseHmacKeyBytes(key, keyEncoding);
    } catch (err) {
      if (err instanceof OperationFailure) {
        return [err.operationError];
      }
      return [
        {
          code: 'INVALID_PARAMETERS',
          message: 'Invalid HMAC secret key.',
          field: 'key',
        },
      ];
    }
    return [];
  },
  async execute(
    input: Uint8Array,
    params: Parameters,
    context: OperationContext,
  ): Promise<Uint8Array> {
    if (
      !context.crypto ||
      !context.crypto.subtle ||
      typeof context.crypto.subtle.importKey !== 'function' ||
      typeof context.crypto.subtle.sign !== 'function'
    ) {
      throw new OperationFailure(
        'UNSUPPORTED_ENVIRONMENT',
        'Web Crypto HMAC API is unavailable in this environment.',
      );
    }

    const keyEncoding = (params.keyEncoding ?? 'utf8') as 'utf8' | 'hex';
    const key = String(params.key ?? '');
    const keyBytes = parseHmacKeyBytes(key, keyEncoding);

    let sigBuffer: ArrayBuffer;
    try {
      const cryptoKey = await context.crypto.subtle.importKey(
        'raw',
        toBufferSource(keyBytes),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      sigBuffer = await context.crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        toBufferSource(input),
      );
    } catch {
      throw new OperationFailure(
        'UNSUPPORTED_ENVIRONMENT',
        'Cryptographic provider failed to compute HMAC-SHA256.',
      );
    }

    return encodeUtf8(encodeHex(new Uint8Array(sigBuffer), 'lower'));
  },
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32Hex(input: Uint8Array): string {
  let crc = 0xffffffff;
  for (let i = 0; i < input.byteLength; i++) {
    crc = CRC32_TABLE[(crc ^ input[i]) & 0xff] ^ (crc >>> 8);
  }
  const finalCrc = (crc ^ 0xffffffff) >>> 0;
  return finalCrc.toString(16).padStart(8, '0');
}

export const crc32Operation: OperationDefinition = {
  id: 'crc32',
  label: 'CRC32 Checksum',
  category: 'crypto',
  description:
    'Compute IEEE 802.3 CRC-32 checksum (polynomial 0xEDB88320) as eight lowercase hexadecimal digits.',
  securityNote:
    'CRC32 detects accidental corruption only; it is not cryptographic integrity or authentication.',
  inputKind: 'bytes',
  parameters: [],
  validate(params: Parameters) {
    return validateParametersAgainstFields(this.parameters, params);
  },
  async execute(
    input: Uint8Array,
    _params: Parameters,
    _context: OperationContext,
  ): Promise<Uint8Array> {
    return encodeUtf8(computeCrc32Hex(input));
  },
};

export const aesGcmOperation: OperationDefinition = {
  id: 'aes-gcm',
  label: 'AES-GCM Encrypt / Decrypt',
  category: 'crypto',
  description:
    'Authenticated encryption and decryption using AES-256-GCM with PBKDF2-HMAC-SHA256 (600,000 iterations) and versioned v1 JSON envelope.',
  securityNote:
    'Passphrase strength remains the user’s responsibility. Browser memory cannot be guaranteed securely erased.',
  inputKind: 'bytes',
  parameters: [
    {
      key: 'direction',
      label: 'Direction',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'encrypt',
      options: ['encrypt', 'decrypt'],
    },
    {
      key: 'passphrase',
      label: 'Passphrase',
      kind: 'secret',
      required: true,
      secret: true,
      placeholder: 'Enter passphrase',
    },
  ],
  validate(params: Parameters) {
    return validateParametersAgainstFields(this.parameters, params);
  },
  async execute(
    input: Uint8Array,
    params: Parameters,
    context: OperationContext,
  ): Promise<Uint8Array> {
    const direction = (params.direction ?? 'encrypt') as 'encrypt' | 'decrypt';
    const passphrase = String(params.passphrase ?? '');
    if (passphrase.length === 0) {
      throw new OperationFailure(
        'INVALID_PARAMETERS',
        'Passphrase is required.',
        'passphrase',
      );
    }

    if (direction === 'encrypt') {
      return encryptAesGcmEnvelope(input, passphrase, context);
    }
    return decryptAesGcmEnvelope(input, passphrase, context);
  },
};

export const cryptoOperations: readonly OperationDefinition[] = [
  sha1Operation,
  sha256Operation,
  sha384Operation,
  sha512Operation,
  hmacSha256Operation,
  crc32Operation,
  aesGcmOperation,
];
