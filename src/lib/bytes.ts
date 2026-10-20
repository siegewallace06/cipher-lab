import { OperationFailure, type OperationError, type ParameterField, type Parameters } from '@/engine/types';
import {
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  MAX_STEP_BYTES,
} from '@/lib/limits';

const textEncoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true });
const lossyUtf8Decoder = new TextDecoder('utf-8', { fatal: false });

export function encodeUtf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

export function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

export function decodeUtf8Fatal(bytes: Uint8Array): string {
  try {
    return fatalUtf8Decoder.decode(bytes);
  } catch {
    throw new OperationFailure(
      'INVALID_UTF8',
      'Input contains invalid UTF-8 byte sequences and cannot be decoded as text.',
    );
  }
}

export function decodeUtf8OrNull(bytes: Uint8Array): string | null {
  try {
    return fatalUtf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

export function decodeUtf8LossyPreview(
  bytes: Uint8Array,
  maxBytes = 65_536,
): string {
  const slice =
    bytes.byteLength > maxBytes ? bytes.subarray(0, maxBytes) : bytes;
  return lossyUtf8Decoder.decode(slice);
}

export function tryDecodeUtf8(
  bytes: Uint8Array,
): { valid: true; text: string } | { valid: false; previewText: string } {
  try {
    const text = fatalUtf8Decoder.decode(bytes);
    return { valid: true, text };
  } catch {
    return { valid: false, previewText: lossyUtf8Decoder.decode(bytes) };
  }
}

export function cloneBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export interface ByteStatistics {
  byteCount: number;
  byteLength: number;
  isValidUtf8: boolean;
  isUtf8: boolean;
  codePointCount: number | null;
  charCount: number | null;
  lineCount: number | null;
}

export function computeByteStats(bytes: Uint8Array): ByteStatistics {
  const decoded = tryDecodeUtf8(bytes);
  if (!decoded.valid) {
    return {
      byteCount: bytes.byteLength,
      byteLength: bytes.byteLength,
      isValidUtf8: false,
      isUtf8: false,
      codePointCount: null,
      charCount: null,
      lineCount: null,
    };
  }
  const text = decoded.text;
  let codePoints = 0;
  for (const _ch of text) {
    codePoints++;
  }
  if (text.length === 0) {
    return {
      byteCount: bytes.byteLength,
      byteLength: bytes.byteLength,
      isValidUtf8: true,
      isUtf8: true,
      codePointCount: 0,
      charCount: 0,
      lineCount: 0,
    };
  }
  let lfCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lfCount++;
    }
  }
  return {
    byteCount: bytes.byteLength,
    byteLength: bytes.byteLength,
    isValidUtf8: true,
    isUtf8: true,
    codePointCount: codePoints,
    charCount: codePoints,
    lineCount: lfCount + 1,
  };
}

export const computeByteStatistics = computeByteStats;

function isAsciiWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function hexNibble(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

export function encodeHex(
  bytes: Uint8Array,
  letterCase: 'lower' | 'upper' = 'lower',
): string {
  const alphabet =
    letterCase === 'upper' ? '0123456789ABCDEF' : '0123456789abcdef';
  let out = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    const b = bytes[i];
    out += alphabet[(b >> 4) & 0x0f] + alphabet[b & 0x0f];
  }
  return out;
}

/**
 * Decodes hexadecimal text strictly:
 * Permits ASCII whitespace between byte pairs only; rejects odd digits, split pairs, or invalid symbols.
 */
export function decodeHexStrict(
  hexText: string,
  maxOutputBytes = MAX_STEP_BYTES,
): Uint8Array {
  const bytes: number[] = [];
  let i = 0;
  const len = hexText.length;

  while (i < len) {
    const code = hexText.charCodeAt(i);
    if (isAsciiWhitespace(code)) {
      i++;
      continue;
    }
    if (i + 1 >= len) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Hexadecimal input must contain an even number of hex digits grouped in pairs.',
      );
    }
    const n1 = hexNibble(code);
    const n2 = hexNibble(hexText.charCodeAt(i + 1));
    if (n1 < 0 || n2 < 0) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Hexadecimal input contains invalid characters or whitespace splitting a byte pair.',
      );
    }
    bytes.push((n1 << 4) | n2);
    if (bytes.length > maxOutputBytes) {
      throw new OperationFailure(
        'LIMIT_EXCEEDED',
        'Decoded byte length exceeds maximum step output limit.',
      );
    }
    i += 2;
  }

  return Uint8Array.from(bytes);
}

export function decodeHex(
  hexText: string,
  maxOutputBytes = MAX_STEP_BYTES,
): Uint8Array | null {
  try {
    return decodeHexStrict(hexText, maxOutputBytes);
  } catch {
    return null;
  }
}

export function formatHexDump(
  bytes: Uint8Array,
  bytesPerRow = 16,
  maxBytes?: number,
): string {
  const source =
    maxBytes !== undefined && bytes.byteLength > maxBytes
      ? bytes.subarray(0, maxBytes)
      : bytes;
  if (source.byteLength === 0) return '';
  const lines: string[] = [];
  for (let offset = 0; offset < source.byteLength; offset += bytesPerRow) {
    const rowEnd = Math.min(offset + bytesPerRow, source.byteLength);
    const offsetHex = offset.toString(16).padStart(8, '0');
    const hexParts: string[] = [];
    let asciiPart = '';

    for (let i = 0; i < bytesPerRow; i++) {
      const idx = offset + i;
      if (idx < rowEnd) {
        const b = source[idx];
        hexParts.push(b.toString(16).padStart(2, '0'));
        asciiPart += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
      } else {
        hexParts.push('  ');
      }
    }

    const leftHalf = hexParts.slice(0, 8).join(' ');
    const rightHalf = hexParts.slice(8).join(' ');
    lines.push(`${offsetHex}  ${leftHalf}  ${rightHalf}  |${asciiPart}|`);
  }
  return lines.join('\n');
}

const BASE64_STD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function encodeBase64(
  bytes: Uint8Array,
  optionsOrAlphabet:
    | { alphabet?: 'standard' | 'url-safe'; padding?: boolean }
    | 'standard'
    | 'url-safe' = {},
  paddingArg?: boolean,
): string {
  const options =
    typeof optionsOrAlphabet === 'string'
      ? { alphabet: optionsOrAlphabet, padding: paddingArg }
      : optionsOrAlphabet;
  const alphabet =
    options.alphabet === 'url-safe'
      ? BASE64_URL_ALPHABET
      : BASE64_STD_ALPHABET;
  const usePadding = options.padding ?? true;
  let out = '';
  const len = bytes.byteLength;
  let i = 0;

  while (i + 2 < len) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      alphabet[(n >> 18) & 63] +
      alphabet[(n >> 12) & 63] +
      alphabet[(n >> 6) & 63] +
      alphabet[n & 63];
    i += 3;
  }

  const rem = len - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
    if (usePadding) out += '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      alphabet[(n >> 18) & 63] +
      alphabet[(n >> 12) & 63] +
      alphabet[(n >> 6) & 63];
    if (usePadding) out += '=';
  }

  return out;
}

export function decodeBase64Strict(
  input: string,
  options: {
    alphabet?: 'standard' | 'url-safe';
    requireUnpadded?: boolean;
    maxOutputBytes?: number;
  } = {},
): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);

  const alphabet =
    options.alphabet === 'url-safe'
      ? BASE64_URL_ALPHABET
      : BASE64_STD_ALPHABET;
  const requireUnpadded = options.requireUnpadded ?? false;
  const maxOutputBytes = options.maxOutputBytes ?? MAX_STEP_BYTES;

  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) {
    lookup[alphabet.charCodeAt(i)] = i;
  }

  const firstPad = input.indexOf('=');
  let dataLen = input.length;
  if (firstPad !== -1) {
    if (requireUnpadded) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Base64url value must not include padding characters.',
      );
    }
    if (input.length % 4 !== 0) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Padded Base64 input length must be a multiple of 4.',
      );
    }
    const padCount = input.length - firstPad;
    if (padCount > 2) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Invalid Base64 padding length.',
      );
    }
    for (let i = firstPad; i < input.length; i++) {
      if (input.charCodeAt(i) !== 0x3d) {
        throw new OperationFailure(
          'INVALID_INPUT',
          'Base64 padding character appears before the end of input.',
        );
      }
    }
    dataLen = firstPad;
  }

  const rem = dataLen % 4;
  if (rem === 1) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Invalid Base64 quantum length.',
    );
  }

  const outLen = Math.floor((dataLen * 3) / 4);
  if (outLen > maxOutputBytes) {
    throw new OperationFailure(
      'LIMIT_EXCEEDED',
      'Decoded Base64 output exceeds the step byte limit.',
    );
  }

  const values = new Uint8Array(dataLen);
  for (let i = 0; i < dataLen; i++) {
    const code = input.charCodeAt(i);
    if (code >= 128 || lookup[code] < 0) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Base64 input contains characters outside the selected alphabet.',
      );
    }
    values[i] = lookup[code];
  }

  if (rem === 2 && (values[dataLen - 1] & 0x0f) !== 0) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Non-canonical Base64 trailing bits in 2-character quantum.',
    );
  }
  if (rem === 3 && (values[dataLen - 1] & 0x03) !== 0) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Non-canonical Base64 trailing bits in 3-character quantum.',
    );
  }

  const out = new Uint8Array(outLen);
  let outIdx = 0;
  let i = 0;
  while (i + 3 < dataLen) {
    const n =
      (values[i] << 18) |
      (values[i + 1] << 12) |
      (values[i + 2] << 6) |
      values[i + 3];
    out[outIdx++] = (n >> 16) & 0xff;
    out[outIdx++] = (n >> 8) & 0xff;
    out[outIdx++] = n & 0xff;
    i += 4;
  }

  if (rem === 2) {
    const n = (values[i] << 6) | values[i + 1];
    out[outIdx++] = (n >> 4) & 0xff;
  } else if (rem === 3) {
    const n = (values[i] << 12) | (values[i + 1] << 6) | values[i + 2];
    out[outIdx++] = (n >> 10) & 0xff;
    out[outIdx++] = (n >> 2) & 0xff;
  }

  return out;
}

export function decodeBase64(
  input: string,
  alphabet: 'standard' | 'url-safe' = 'standard',
  requireUnpadded = false,
): Uint8Array | null {
  try {
    return decodeBase64Strict(input, { alphabet, requireUnpadded });
  } catch {
    return null;
  }
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(bytes: Uint8Array, padding = true): string {
  if (bytes.byteLength === 0) return '';
  let out = '';
  let buffer = 0;
  let bitsLeft = 0;

  for (let i = 0; i < bytes.byteLength; i++) {
    buffer = (buffer << 8) | bytes[i];
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      out += BASE32_ALPHABET[(buffer >> bitsLeft) & 0x1f];
    }
  }

  if (bitsLeft > 0) {
    out += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  }

  if (padding) {
    while (out.length % 8 !== 0) {
      out += '=';
    }
  }

  return out;
}

export function decodeBase32Strict(
  input: string,
  maxOutputBytes = MAX_STEP_BYTES,
): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);

  const firstPad = input.indexOf('=');
  let dataLen = input.length;

  if (firstPad !== -1) {
    if (input.length % 8 !== 0) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Padded Base32 input length must be a multiple of 8.',
      );
    }
    const padCount = input.length - firstPad;
    if (
      padCount !== 1 &&
      padCount !== 3 &&
      padCount !== 4 &&
      padCount !== 6
    ) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Invalid Base32 padding length.',
      );
    }
    for (let i = firstPad; i < input.length; i++) {
      if (input.charCodeAt(i) !== 0x3d) {
        throw new OperationFailure(
          'INVALID_INPUT',
          'Base32 padding character appears before the end of input.',
        );
      }
    }
    dataLen = firstPad;
  }

  const rem = dataLen % 8;
  if (rem === 1 || rem === 3 || rem === 6) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Invalid Base32 quantum length.',
    );
  }

  const outLen = Math.floor((dataLen * 5) / 8);
  if (outLen > maxOutputBytes) {
    throw new OperationFailure(
      'LIMIT_EXCEEDED',
      'Decoded Base32 output exceeds the step byte limit.',
    );
  }

  const out = new Uint8Array(outLen);
  let outIdx = 0;
  let buffer = 0;
  let bitsLeft = 0;

  for (let i = 0; i < dataLen; i++) {
    const code = input.charCodeAt(i);
    let val = -1;
    if (code >= 0x41 && code <= 0x5a) {
      val = code - 0x41;
    } else if (code >= 0x61 && code <= 0x7a) {
      val = code - 0x61;
    } else if (code >= 0x32 && code <= 0x37) {
      val = code - 0x32 + 26;
    }
    if (val < 0) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Base32 input contains invalid characters.',
      );
    }
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      out[outIdx++] = (buffer >> bitsLeft) & 0xff;
    }
  }

  if (bitsLeft > 0) {
    const mask = (1 << bitsLeft) - 1;
    if ((buffer & mask) !== 0) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Non-canonical Base32 trailing bits.',
      );
    }
  }

  return out;
}

export function encodeBinary(
  bytes: Uint8Array,
  separator: 'space' | 'none' = 'space',
): string {
  if (bytes.byteLength === 0) return '';
  const parts: string[] = new Array(bytes.byteLength);
  for (let i = 0; i < bytes.byteLength; i++) {
    parts[i] = bytes[i].toString(2).padStart(8, '0');
  }
  return parts.join(separator === 'space' ? ' ' : '');
}

export function decodeBinaryStrict(
  input: string,
  maxOutputBytes = MAX_STEP_BYTES,
): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code !== 0x30 && code !== 0x31 && !isAsciiWhitespace(code)) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Binary input may contain only 0, 1, and ASCII whitespace between octets.',
      );
    }
  }

  const tokens = input.trim().split(/[ \t\n\r]+/).filter(Boolean);
  if (tokens.length === 0) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Binary input contains whitespace without bit octets.',
    );
  }

  const bytes: number[] = [];
  for (const token of tokens) {
    if (token.length % 8 !== 0) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Binary input must consist of complete 8-bit octets.',
      );
    }
    for (let i = 0; i < token.length; i += 8) {
      const octet = token.slice(i, i + 8);
      bytes.push( Number.parseInt(octet, 2) );
      if (bytes.length > maxOutputBytes) {
        throw new OperationFailure(
          'LIMIT_EXCEEDED',
          'Decoded binary output exceeds the step byte limit.',
        );
      }
    }
  }

  return Uint8Array.from(bytes);
}

const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface JsonInspectionResult {
  valid: boolean;
  depth: number;
  nodes: number;
  hasUnsafeInteger: boolean;
}

/**
 * Iteratively checks JSON depth and node count without call-stack recursion (technical-design.md ch. 4).
 */
export function validateJsonStructureLimits(
  root: unknown,
  maxDepth = MAX_JSON_DEPTH,
  maxNodes = MAX_JSON_NODES,
): JsonInspectionResult {
  let nodes = 0;
  let maxObservedDepth = 0;
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: root, depth: 1 },
  ];

  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes++;
    if (nodes > maxNodes) {
      throw new OperationFailure(
        'LIMIT_EXCEEDED',
        `JSON structure exceeds maximum allowed node count (${maxNodes}).`,
      );
    }
    if (current.depth > maxObservedDepth) {
      maxObservedDepth = current.depth;
    }
    if (current.depth > maxDepth) {
      throw new OperationFailure(
        'LIMIT_EXCEEDED',
        `JSON structure exceeds maximum allowed nesting depth (${maxDepth}).`,
      );
    }

    const val = current.value;
    if (Array.isArray(val)) {
      for (let i = val.length - 1; i >= 0; i--) {
        stack.push({ value: val[i], depth: current.depth + 1 });
      }
    } else if (typeof val === 'object' && val !== null) {
      const ownKeys = Object.getOwnPropertyNames(val);
      for (let i = ownKeys.length - 1; i >= 0; i--) {
        const key = ownKeys[i];
        if (FORBIDDEN_JSON_KEYS.has(key)) {
          throw new OperationFailure(
            'INVALID_INPUT',
            'Prototype-related property names are not permitted.',
          );
        }
        stack.push({
          value: (val as Record<string, unknown>)[key],
          depth: current.depth + 1,
        });
      }
    }
  }

  return {
    valid: true,
    depth: maxObservedDepth,
    nodes,
    hasUnsafeInteger: false,
  };
}

/**
 * Scans raw JSON text to detect unsafe large integers, forbidden prototype keys, or duplicate object keys.
 */
export function inspectRawJsonText(rawJson: string): {
  valid: boolean;
  hasUnsafeInteger: boolean;
  hasForbiddenKey: boolean;
  hasDuplicateKey: boolean;
} {
  let hasUnsafeInteger = false;
  let hasForbiddenKey = false;
  let hasDuplicateKey = false;

  const containerStack: Array<{
    type: 'object' | 'array';
    keys: Set<string>;
    lastString: string | null;
  }> = [];

  let i = 0;
  const len = rawJson.length;

  while (i < len) {
    const ch = rawJson[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '{') {
      containerStack.push({ type: 'object', keys: new Set(), lastString: null });
      i++;
      continue;
    }
    if (ch === '[') {
      containerStack.push({ type: 'array', keys: new Set(), lastString: null });
      i++;
      continue;
    }
    if (ch === '}' || ch === ']') {
      containerStack.pop();
      i++;
      continue;
    }
    if (ch === '"') {
      let str = '';
      i++;
      while (i < len) {
        const c = rawJson[i];
        if (c === '\\') {
          if (i + 1 < len) {
            const next = rawJson[i + 1];
            if (next === 'u' && i + 5 < len) {
              const hex = rawJson.slice(i + 2, i + 6);
              const code = Number.parseInt(hex, 16);
              if (!Number.isNaN(code)) {
                str += String.fromCharCode(code);
                i += 6;
                continue;
              }
            }
            str += next;
            i += 2;
            continue;
          }
          i++;
          continue;
        }
        if (c === '"') {
          i++;
          break;
        }
        str += c;
        i++;
      }
      // Look ahead for ':'
      let j = i;
      while (
        j < len &&
        (rawJson[j] === ' ' ||
          rawJson[j] === '\t' ||
          rawJson[j] === '\n' ||
          rawJson[j] === '\r')
      ) {
        j++;
      }
      const top = containerStack[containerStack.length - 1];
      if (top && top.type === 'object' && rawJson[j] === ':') {
        if (FORBIDDEN_JSON_KEYS.has(str)) {
          hasForbiddenKey = true;
        }
        if (top.keys.has(str)) {
          hasDuplicateKey = true;
        }
        top.keys.add(str);
      }
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const start = i;
      if (rawJson[i] === '-') i++;
      while (i < len && rawJson[i] >= '0' && rawJson[i] <= '9') i++;
      let isFloat = false;
      if (i < len && rawJson[i] === '.') {
        isFloat = true;
        i++;
        while (i < len && rawJson[i] >= '0' && rawJson[i] <= '9') i++;
      }
      if (i < len && (rawJson[i] === 'e' || rawJson[i] === 'E')) {
        isFloat = true;
        i++;
        if (i < len && (rawJson[i] === '+' || rawJson[i] === '-')) i++;
        while (i < len && rawJson[i] >= '0' && rawJson[i] <= '9') i++;
      }
      const numLiteral = rawJson.slice(start, i);
      if (!isFloat) {
        try {
          const big = BigInt(numLiteral);
          if (
            big > BigInt(Number.MAX_SAFE_INTEGER) ||
            big < BigInt(Number.MIN_SAFE_INTEGER)
          ) {
            hasUnsafeInteger = true;
          }
        } catch {
          hasUnsafeInteger = true;
        }
      }
      continue;
    }
    i++;
  }

  return {
    valid: !hasForbiddenKey && !hasDuplicateKey,
    hasUnsafeInteger,
    hasForbiddenKey,
    hasDuplicateKey,
  };
}

export function validateStepParametersBySchema(
  fields: readonly ParameterField[],
  params: Parameters,
  options: { allowEmptyRequiredSecrets?: boolean } = {},
): OperationError[] {
  const errors: OperationError[] = [];
  const allowedKeys = new Set(fields.map((f) => f.key));

  for (const key of Object.getOwnPropertyNames(params)) {
    if (!allowedKeys.has(key)) {
      errors.push({
        code: 'INVALID_PARAMETERS',
        message: `Unknown parameter "${key}".`,
        field: key,
      });
    }
  }

  for (const field of fields) {
    const hasOwn = Object.prototype.hasOwnProperty.call(params, field.key);
    const val = hasOwn ? params[field.key] : undefined;

    if (val === undefined) {
      if (field.required && field.defaultValue === undefined) {
        if (field.secret && options.allowEmptyRequiredSecrets) {
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
      if (typeof val !== 'string') {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must be a string.`,
          field: field.key,
        });
        continue;
      }
      if (field.required && val.length === 0) {
        if (field.secret && options.allowEmptyRequiredSecrets) {
          continue;
        }
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must not be empty.`,
          field: field.key,
        });
      }
    } else if (field.kind === 'number') {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must be a finite number.`,
          field: field.key,
        });
        continue;
      }
      if (field.min !== undefined && val < field.min) {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must be at least ${field.min}.`,
          field: field.key,
        });
      }
      if (field.max !== undefined && val > field.max) {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must be at most ${field.max}.`,
          field: field.key,
        });
      }
    } else if (field.kind === 'boolean') {
      if (typeof val !== 'boolean') {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} must be a boolean.`,
          field: field.key,
        });
      }
    } else if (field.kind === 'select') {
      if (field.options && !field.options.includes(val)) {
        errors.push({
          code: 'INVALID_PARAMETERS',
          message: `${field.label} has an unsupported option.`,
          field: field.key,
        });
      }
    }
  }

  return errors;
}
