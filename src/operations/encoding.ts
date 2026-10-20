import {
  OperationFailure,
  type OperationContext,
  type OperationDefinition,
  type Parameters,
} from '@/engine/types';
import {
  decodeBase32Strict,
  decodeBase64Strict,
  decodeBinaryStrict,
  decodeHexStrict,
  decodeUtf8Fatal,
  encodeBase32,
  encodeBase64,
  encodeBinary,
  encodeHex,
  encodeUtf8,
  inspectRawJsonText,
  validateJsonStructureLimits,
} from '@/lib/bytes';
import { validateParametersAgainstFields } from '@/lib/parameter-schema';

function ensureMaxOutput(bytes: Uint8Array, maxOutputBytes: number): Uint8Array {
  if (bytes.byteLength > maxOutputBytes) {
    throw new OperationFailure(
      'LIMIT_EXCEEDED',
      'Operation output exceeds the maximum step byte limit.',
    );
  }
  return bytes;
}

export const base64Operation: OperationDefinition = {
  id: 'base64',
  label: 'Base64',
  category: 'encoding',
  description:
    'Encode arbitrary bytes to Base64 ASCII or decode strict standard/URL-safe Base64 to bytes.',
  inputKind: 'bytes',
  parameters: [
    {
      key: 'direction',
      label: 'Direction',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'encode',
      options: ['encode', 'decode'],
    },
    {
      key: 'alphabet',
      label: 'Alphabet',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'standard',
      options: ['standard', 'url-safe'],
    },
    {
      key: 'padding',
      label: 'Padding (=)',
      kind: 'boolean',
      required: true,
      secret: false,
      defaultValue: true,
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
    const direction = (params.direction ?? 'encode') as 'encode' | 'decode';
    const alphabet = (params.alphabet ?? 'standard') as
      | 'standard'
      | 'url-safe';
    const padding = Boolean(params.padding ?? true);

    if (direction === 'encode') {
      const encoded = encodeBase64(input, { alphabet, padding });
      return ensureMaxOutput(encodeUtf8(encoded), context.maxOutputBytes);
    }

    const text = decodeUtf8Fatal(input);
    return decodeBase64Strict(text, {
      alphabet,
      maxOutputBytes: context.maxOutputBytes,
    });
  },
};

export const base32Operation: OperationDefinition = {
  id: 'base32',
  label: 'Base32',
  category: 'encoding',
  description:
    'Encode arbitrary bytes to RFC 4648 Base32 (A-Z, 2-7) or decode Base32 text to bytes.',
  inputKind: 'bytes',
  parameters: [
    {
      key: 'direction',
      label: 'Direction',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'encode',
      options: ['encode', 'decode'],
    },
    {
      key: 'padding',
      label: 'Padding (=)',
      kind: 'boolean',
      required: true,
      secret: false,
      defaultValue: true,
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
    const direction = (params.direction ?? 'encode') as 'encode' | 'decode';
    const padding = Boolean(params.padding ?? true);

    if (direction === 'encode') {
      const encoded = encodeBase32(input, padding);
      return ensureMaxOutput(encodeUtf8(encoded), context.maxOutputBytes);
    }

    const text = decodeUtf8Fatal(input);
    return decodeBase32Strict(text, context.maxOutputBytes);
  },
};

export const hexOperation: OperationDefinition = {
  id: 'hex',
  label: 'Hex',
  category: 'encoding',
  description:
    'Encode bytes to hexadecimal digits or decode strict hexadecimal byte pairs.',
  inputKind: 'bytes',
  parameters: [
    {
      key: 'direction',
      label: 'Direction',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'encode',
      options: ['encode', 'decode'],
    },
    {
      key: 'case',
      label: 'Letter Case',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'lower',
      options: ['lower', 'upper'],
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
    const direction = (params.direction ?? 'encode') as 'encode' | 'decode';
    const letterCase = (params.case ?? 'lower') as 'lower' | 'upper';

    if (direction === 'encode') {
      if (input.byteLength * 2 > context.maxOutputBytes) {
        throw new OperationFailure(
          'LIMIT_EXCEEDED',
          'Encoded hexadecimal output exceeds the maximum step byte limit.',
        );
      }
      return ensureMaxOutput(
        encodeUtf8(encodeHex(input, letterCase)),
        context.maxOutputBytes,
      );
    }

    const text = decodeUtf8Fatal(input);
    return decodeHexStrict(text, context.maxOutputBytes);
  },
};

export const binaryOperation: OperationDefinition = {
  id: 'binary',
  label: 'Binary',
  category: 'encoding',
  description:
    'Encode bytes as 8-bit binary octets or decode binary octet strings to bytes.',
  inputKind: 'bytes',
  parameters: [
    {
      key: 'direction',
      label: 'Direction',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'encode',
      options: ['encode', 'decode'],
    },
    {
      key: 'separator',
      label: 'Separator',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'space',
      options: ['space', 'none'],
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
    const direction = (params.direction ?? 'encode') as 'encode' | 'decode';
    const separator = (params.separator ?? 'space') as 'space' | 'none';

    if (direction === 'encode') {
      const estimatedLen =
        input.byteLength === 0
          ? 0
          : input.byteLength * 8 +
            (separator === 'space' ? input.byteLength - 1 : 0);
      if (estimatedLen > context.maxOutputBytes) {
        throw new OperationFailure(
          'LIMIT_EXCEEDED',
          'Encoded binary output exceeds the maximum step byte limit.',
        );
      }
      return ensureMaxOutput(
        encodeUtf8(encodeBinary(input, separator)),
        context.maxOutputBytes,
      );
    }

    const text = decodeUtf8Fatal(input);
    return decodeBinaryStrict(text, context.maxOutputBytes);
  },
};

export const urlOperation: OperationDefinition = {
  id: 'url',
  label: 'URL Encode / Decode',
  category: 'encoding',
  description:
    'Percent-encode UTF-8 text using component semantics or decode percent-encoded UTF-8 components (+ stays +).',
  inputKind: 'utf8',
  parameters: [
    {
      key: 'direction',
      label: 'Direction',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'encode',
      options: ['encode', 'decode'],
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
    const direction = (params.direction ?? 'encode') as 'encode' | 'decode';
    const text = decodeUtf8Fatal(input);

    if (direction === 'encode') {
      const encoded = encodeURIComponent(text).replace(
        /[!'()*]/g,
        (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase(),
      );
      return ensureMaxOutput(encodeUtf8(encoded), context.maxOutputBytes);
    }

    try {
      const decoded = decodeURIComponent(text);
      return ensureMaxOutput(encodeUtf8(decoded), context.maxOutputBytes);
    } catch {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Malformed percent-encoding or invalid decoded UTF-8 sequence.',
      );
    }
  },
};

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeHtmlEntitiesStrict(text: string): string {
  let out = '';
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (ch !== '&') {
      out += ch;
      i++;
      continue;
    }

    if (i + 1 < len && text[i + 1] === '#') {
      const semi = text.indexOf(';', i + 2);
      if (semi === -1) {
        throw new OperationFailure(
          'INVALID_INPUT',
          'Unterminated numeric HTML character reference.',
        );
      }
      const body = text.slice(i + 2, semi);
      if (body.length === 0) {
        throw new OperationFailure(
          'INVALID_INPUT',
          'Empty numeric HTML character reference.',
        );
      }

      let codePoint = -1;
      if (body[0] === 'x' || body[0] === 'X') {
        const hexDigits = body.slice(1);
        if (!/^[0-9a-fA-F]+$/.test(hexDigits) || hexDigits.length > 6) {
          throw new OperationFailure(
            'INVALID_INPUT',
            'Invalid hexadecimal HTML character reference.',
          );
        }
        codePoint = Number.parseInt(hexDigits, 16);
      } else {
        if (!/^\d+$/.test(body) || body.length > 7) {
          throw new OperationFailure(
            'INVALID_INPUT',
            'Invalid decimal HTML character reference.',
          );
        }
        codePoint = Number.parseInt(body, 10);
      }

      if (
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        throw new OperationFailure(
          'INVALID_INPUT',
          'Numeric HTML entity is outside valid Unicode scalar range.',
        );
      }

      out += String.fromCodePoint(codePoint);
      i = semi + 1;
      continue;
    }

    const semi = text.indexOf(';', i + 1);
    if (semi !== -1 && semi - i <= 12) {
      const entityName = text.slice(i + 1, semi);
      if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, entityName)) {
        out += NAMED_ENTITIES[entityName];
        i = semi + 1;
        continue;
      }
    }

    out += '&';
    i++;
  }

  return out;
}

export const htmlEntitiesOperation: OperationDefinition = {
  id: 'html-entities',
  label: 'HTML Entities',
  category: 'encoding',
  description:
    'Escape &, <, >, ", and \' to safe HTML entities or decode core named and numeric scalar references.',
  inputKind: 'utf8',
  parameters: [
    {
      key: 'direction',
      label: 'Direction',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'encode',
      options: ['encode', 'decode'],
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
    const direction = (params.direction ?? 'encode') as 'encode' | 'decode';
    const text = decodeUtf8Fatal(input);

    if (direction === 'encode') {
      let encoded = '';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        switch (ch) {
          case '&':
            encoded += '&amp;';
            break;
          case '<':
            encoded += '&lt;';
            break;
          case '>':
            encoded += '&gt;';
            break;
          case '"':
            encoded += '&quot;';
            break;
          case "'":
            encoded += '&apos;';
            break;
          default:
            encoded += ch;
        }
      }
      return ensureMaxOutput(encodeUtf8(encoded), context.maxOutputBytes);
    }

    const decoded = decodeHtmlEntitiesStrict(text);
    return ensureMaxOutput(encodeUtf8(decoded), context.maxOutputBytes);
  },
};

export function checkJsonPrecisionNotice(rawJson: string): string | undefined {
  const { hasUnsafeInteger } = inspectRawJsonText(rawJson);
  if (hasUnsafeInteger) {
    return 'Warning: Input contains integers outside IEEE-754 safe integer bounds (±9007199254740991) which may lose precision during standard JSON parsing.';
  }
  return undefined;
}

export const jsonOperation: OperationDefinition = {
  id: 'json',
  label: 'JSON Prettify / Minify',
  category: 'encoding',
  description:
    'Validate and format UTF-8 JSON with bounded depth/node checks. Large integers outside ±2^53-1 follow standard IEEE-754 number parsing.',
  securityNote:
    'Uses standard ECMAScript JSON parser number semantics; integers exceeding ±9,007,199,254,740,991 can lose precision.',
  inputKind: 'utf8',
  parameters: [
    {
      key: 'mode',
      label: 'Mode',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'pretty',
      options: ['pretty', 'minify'],
    },
    {
      key: 'indent',
      label: 'Indentation',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 2,
      options: [2, 4],
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
    const mode = (params.mode ?? 'pretty') as 'pretty' | 'minify';
    const indent = (params.indent ?? 2) as 2 | 4;
    const text = decodeUtf8Fatal(input);

    if (text.trim().length === 0) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'JSON input must not be empty.',
      );
    }

    const rawInspection = inspectRawJsonText(text);
    if (rawInspection.hasForbiddenKey) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Prototype-related JSON keys are not permitted.',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new OperationFailure('INVALID_INPUT', 'Malformed JSON input.');
    }

    validateJsonStructureLimits(parsed);

    const formatted =
      mode === 'minify'
        ? JSON.stringify(parsed)
        : JSON.stringify(parsed, null, indent);

    return ensureMaxOutput(encodeUtf8(formatted), context.maxOutputBytes);
  },
};

const JWT_TIMESTAMP_CLAIMS = ['exp', 'nbf', 'iat', 'auth_time'] as const;

export const jwtOperation: OperationDefinition = {
  id: 'jwt',
  label: 'JWT Decoder & Claims Inspector',
  category: 'encoding',
  description:
    'Decode compact 3-segment JWT header and payload as pretty JSON with timestamp claim annotations. Never verifies cryptographic signatures.',
  securityNote:
    'Does not verify cryptographic signatures or trust token claims (verified: false).',
  inputKind: 'utf8',
  parameters: [],
  validate(params: Parameters) {
    return validateParametersAgainstFields(this.parameters, params);
  },
  async execute(
    input: Uint8Array,
    _params: Parameters,
    context: OperationContext,
  ): Promise<Uint8Array> {
    const text = decodeUtf8Fatal(input);
    if (text.length === 0 || /\s/.test(text)) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'JWT input must be a compact token without whitespace.',
      );
    }

    const segments = text.split('.');
    if (segments.length !== 3) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'JWT must contain exactly three dot-separated segments (header.payload.signature).',
      );
    }

    const [headerSeg, payloadSeg, signatureSeg] = segments;
    if (headerSeg.length === 0 || payloadSeg.length === 0) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'JWT header and payload segments must not be empty.',
      );
    }

    const parseJwtJsonSegment = (
      segment: string,
      segmentLabel: string,
    ): Record<string, unknown> => {
      const bytes = decodeBase64Strict(segment, {
        alphabet: 'url-safe',
        requireUnpadded: true,
        maxOutputBytes: context.maxOutputBytes,
      });
      const canonical = encodeBase64(bytes, {
        alphabet: 'url-safe',
        padding: false,
      });
      if (canonical !== segment) {
        throw new OperationFailure(
          'INVALID_INPUT',
          `JWT ${segmentLabel} is not canonical unpadded Base64url.`,
        );
      }
      const jsonText = decodeUtf8Fatal(bytes);
      const rawCheck = inspectRawJsonText(jsonText);
      if (rawCheck.hasForbiddenKey) {
        throw new OperationFailure(
          'INVALID_INPUT',
          `JWT ${segmentLabel} contains prohibited property names.`,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        throw new OperationFailure(
          'INVALID_INPUT',
          `JWT ${segmentLabel} is not valid JSON.`,
        );
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new OperationFailure(
          'INVALID_INPUT',
          `JWT ${segmentLabel} must decode to a JSON object.`,
        );
      }
      validateJsonStructureLimits(parsed);
      return parsed as Record<string, unknown>;
    };

    const headerObj = parseJwtJsonSegment(headerSeg, 'header');
    const payloadObj = parseJwtJsonSegment(payloadSeg, 'payload');

    let sigBytes: Uint8Array = new Uint8Array(0);
    if (signatureSeg.length > 0) {
      sigBytes = decodeBase64Strict(signatureSeg, {
        alphabet: 'url-safe',
        requireUnpadded: true,
        maxOutputBytes: context.maxOutputBytes,
      });
      const canonicalSig = encodeBase64(sigBytes, {
        alphabet: 'url-safe',
        padding: false,
      });
      if (canonicalSig !== signatureSeg) {
        throw new OperationFailure(
          'INVALID_INPUT',
          'JWT signature segment is not canonical unpadded Base64url.',
        );
      }
    }

    const timestampAnnotations: Record<string, string> = {};
    for (const claim of JWT_TIMESTAMP_CLAIMS) {
      if (Object.prototype.hasOwnProperty.call(payloadObj, claim)) {
        const val = payloadObj[claim];
        if (typeof val === 'number' && Number.isFinite(val)) {
          const date = new Date(val * 1000);
          if (!Number.isNaN(date.getTime())) {
            timestampAnnotations[claim] = date.toISOString();
          }
        }
      }
    }

    const unsigned = sigBytes.byteLength === 0;
    const outputObj = {
      verified: false,
      unsigned,
      header: headerObj,
      payload: payloadObj,
      signature: {
        encoding: 'base64url',
        value: signatureSeg,
        byteLength: sigBytes.byteLength,
        status: unsigned ? 'unsigned' : 'unverified',
      },
      annotations: {
        timestamps: timestampAnnotations,
        notice: unsigned
          ? 'Unsigned token (empty signature segment). Claims are unverified.'
          : 'Signature is not cryptographically verified by this inspector.',
      },
    };

    return ensureMaxOutput(
      encodeUtf8(JSON.stringify(outputObj, null, 2)),
      context.maxOutputBytes,
    );
  },
};

const ISO_WITH_TZ_REGEX =
  /^([+-]?\d{4,6})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|([+-])(\d{2}):?(\d{2}))$/;

const MAX_DATE_MS = 8_640_000_000_000_000n;

function parseIsoWithTimezoneToMs(input: string): number {
  const match = ISO_WITH_TZ_REGEX.exec(input);
  if (!match) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'ISO-8601 input must include a complete date, time, and explicit timezone (e.g., Z or +00:00).',
    );
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const second = Number.parseInt(match[6], 10);
  const fractionRaw = match[7] ?? '';
  const tzPart = match[8];
  const tzSign = match[9];
  const tzHourStr = match[10];
  const tzMinStr = match[11];

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'ISO-8601 date/time components are out of valid calendar range.',
    );
  }

  const msPart =
    fractionRaw.length > 0
      ? Number.parseInt(fractionRaw.slice(0, 3).padEnd(3, '0'), 10)
      : 0;

  const checkDate = new Date(0);
  checkDate.setUTCFullYear(year, month - 1, day);
  checkDate.setUTCHours(hour, minute, second, msPart);

  if (
    Number.isNaN(checkDate.getTime()) ||
    checkDate.getUTCFullYear() !== year ||
    checkDate.getUTCMonth() !== month - 1 ||
    checkDate.getUTCDate() !== day
  ) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'ISO-8601 date does not exist in the Gregorian calendar.',
    );
  }

  let offsetMinutes = 0;
  if (tzPart !== 'Z' && tzPart !== 'z') {
    const tzHours = Number.parseInt(tzHourStr, 10);
    const tzMinutes = Number.parseInt(tzMinStr, 10);
    if (tzHours > 23 || tzMinutes > 59) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Invalid timezone offset in ISO-8601 timestamp.',
      );
    }
    offsetMinutes = (tzHours * 60 + tzMinutes) * (tzSign === '-' ? -1 : 1);
  }

  const epochMs = checkDate.getTime() - offsetMinutes * 60_000;
  if (
    !Number.isFinite(epochMs) ||
    Math.abs(epochMs) > Number(MAX_DATE_MS)
  ) {
    throw new OperationFailure(
      'INVALID_INPUT',
      'Timestamp is outside the supported ECMAScript Date range.',
    );
  }

  return epochMs;
}

export const timestampOperation: OperationDefinition = {
  id: 'timestamp',
  label: 'Unix Timestamp ↔ ISO-8601',
  category: 'encoding',
  description:
    'Convert integer Unix epochs (seconds or milliseconds) to UTC ISO-8601 strings or parse timezone-qualified ISO-8601 strings to integer epochs.',
  inputKind: 'utf8',
  parameters: [
    {
      key: 'direction',
      label: 'Direction',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'epoch-to-iso',
      options: ['epoch-to-iso', 'iso-to-epoch'],
    },
    {
      key: 'unit',
      label: 'Unit',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'seconds',
      options: ['seconds', 'milliseconds'],
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
    const direction = (params.direction ?? 'epoch-to-iso') as
      | 'epoch-to-iso'
      | 'iso-to-epoch';
    const unit = (params.unit ?? 'seconds') as 'seconds' | 'milliseconds';
    const text = decodeUtf8Fatal(input).trim();

    if (text.length === 0) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Timestamp input must not be empty.',
      );
    }

    if (direction === 'epoch-to-iso') {
      if (!/^-?\d+$/.test(text)) {
        throw new OperationFailure(
          'INVALID_INPUT',
          'Unix epoch input must be an integer without fractional digits.',
        );
      }
      let rawBig: bigint;
      try {
        rawBig = BigInt(text);
      } catch {
        throw new OperationFailure('INVALID_INPUT', 'Invalid integer epoch.');
      }

      const msBig = unit === 'seconds' ? rawBig * 1000n : rawBig;
      if (msBig < -MAX_DATE_MS || msBig > MAX_DATE_MS) {
        throw new OperationFailure(
          'INVALID_INPUT',
          'Epoch timestamp is outside the supported Date range.',
        );
      }

      const date = new Date(Number(msBig));
      if (Number.isNaN(date.getTime())) {
        throw new OperationFailure('INVALID_INPUT', 'Invalid epoch date.');
      }

      return ensureMaxOutput(
        encodeUtf8(date.toISOString()),
        context.maxOutputBytes,
      );
    }

    const epochMs = parseIsoWithTimezoneToMs(text);
    const resultValue =
      unit === 'milliseconds'
        ? Math.trunc(epochMs) || 0
        : Math.trunc(epochMs / 1000) || 0;

    return ensureMaxOutput(
      encodeUtf8(String(resultValue)),
      context.maxOutputBytes,
    );
  },
};

export const encodingOperations: readonly OperationDefinition[] = [
  base64Operation,
  base32Operation,
  hexOperation,
  binaryOperation,
  urlOperation,
  htmlEntitiesOperation,
  jsonOperation,
  jwtOperation,
  timestampOperation,
];
