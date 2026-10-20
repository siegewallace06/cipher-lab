import {
  OperationFailure,
  type OperationContext,
  type OperationDefinition,
  type OperationError,
  type Parameters,
} from '@/engine/types';
import { decodeHexStrict, decodeUtf8Fatal, encodeUtf8 } from '@/lib/bytes';
import { validateParametersAgainstFields } from '@/lib/parameter-schema';

function rotateAsciiText(text: string, shift: number): string {
  const normalizedShift = ((shift % 26) + 26) % 26;
  if (normalizedShift === 0 || text.length === 0) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x41 && code <= 0x5a) {
      out += String.fromCharCode(
        0x41 + ((code - 0x41 + normalizedShift) % 26),
      );
    } else if (code >= 0x61 && code <= 0x7a) {
      out += String.fromCharCode(
        0x61 + ((code - 0x61 + normalizedShift) % 26),
      );
    } else {
      out += text[i];
    }
  }
  return out;
}

export const caesarOperation: OperationDefinition = {
  id: 'caesar',
  label: 'Caesar / ROT-N',
  category: 'ciphers',
  description:
    'Rotate ASCII letters by a configurable shift (0–25), preserving case and non-alphabetic characters.',
  securityNote:
    'Classical substitution cipher for educational/analysis use only; provides no cryptographic security.',
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
    {
      key: 'shift',
      label: 'Shift (0–25)',
      kind: 'number',
      required: true,
      secret: false,
      defaultValue: 13,
      min: 0,
      max: 25,
    },
  ],
  validate(params: Parameters) {
    return validateParametersAgainstFields(this.parameters, params);
  },
  async execute(
    input: Uint8Array,
    params: Parameters,
    _context: OperationContext,
  ): Promise<Uint8Array> {
    const direction = (params.direction ?? 'encode') as 'encode' | 'decode';
    const shift = Number(params.shift ?? 13);
    const text = decodeUtf8Fatal(input);
    const effectiveShift = direction === 'decode' ? 26 - shift : shift;
    return encodeUtf8(rotateAsciiText(text, effectiveShift));
  },
};

export const rot13Operation: OperationDefinition = {
  id: 'rot13',
  label: 'ROT13',
  category: 'ciphers',
  description:
    'Self-inverse rotation of ASCII letters by 13 positions, preserving case and non-letter characters.',
  securityNote: 'Educational transformation only; not encryption.',
  inputKind: 'utf8',
  parameters: [],
  validate(params: Parameters) {
    return validateParametersAgainstFields(this.parameters, params);
  },
  async execute(
    input: Uint8Array,
    _params: Parameters,
    _context: OperationContext,
  ): Promise<Uint8Array> {
    const text = decodeUtf8Fatal(input);
    return encodeUtf8(rotateAsciiText(text, 13));
  },
};

export const vigenereOperation: OperationDefinition = {
  id: 'vigenere',
  label: 'Vigenère Cipher',
  category: 'ciphers',
  description:
    'Polyalphabetic ASCII letter shift using an alphabetic passphrase. Only letters advance the key index.',
  securityNote:
    'Classical cipher for analysis and education only; do not use to protect sensitive data.',
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
    {
      key: 'key',
      label: 'Passphrase (A–Z)',
      kind: 'secret',
      required: true,
      secret: true,
      placeholder: 'ASCII letters only',
    },
  ],
  validate(params: Parameters): readonly OperationError[] {
    const errors = validateParametersAgainstFields(this.parameters, params);
    if (errors.length > 0) return errors;
    const key = String(params.key ?? '');
    if (!/^[A-Za-z]+$/.test(key)) {
      return [
        {
          code: 'INVALID_PARAMETERS',
          message:
            'Vigenère passphrase must contain only ASCII letters (A–Z, a–z).',
          field: 'key',
        },
      ];
    }
    return [];
  },
  async execute(
    input: Uint8Array,
    params: Parameters,
    _context: OperationContext,
  ): Promise<Uint8Array> {
    const direction = (params.direction ?? 'encode') as 'encode' | 'decode';
    const key = String(params.key ?? '');
    if (!/^[A-Za-z]+$/.test(key)) {
      throw new OperationFailure(
        'INVALID_PARAMETERS',
        'Vigenère passphrase must contain only ASCII letters (A–Z, a–z).',
        'key',
      );
    }

    const text = decodeUtf8Fatal(input);
    const keyShifts = new Uint8Array(key.length);
    for (let i = 0; i < key.length; i++) {
      const c = key.charCodeAt(i);
      keyShifts[i] = c >= 0x61 ? c - 0x61 : c - 0x41;
    }

    let out = '';
    let keyIdx = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x41 && code <= 0x5a) {
        const shift = keyShifts[keyIdx % keyShifts.length];
        keyIdx++;
        const delta = direction === 'decode' ? 26 - shift : shift;
        out += String.fromCharCode(0x41 + ((code - 0x41 + delta) % 26));
      } else if (code >= 0x61 && code <= 0x7a) {
        const shift = keyShifts[keyIdx % keyShifts.length];
        keyIdx++;
        const delta = direction === 'decode' ? 26 - shift : shift;
        out += String.fromCharCode(0x61 + ((code - 0x61 + delta) % 26));
      } else {
        out += text[i];
      }
    }

    return encodeUtf8(out);
  },
};

function parseXorKeyBytes(key: string, keyEncoding: 'utf8' | 'hex'): Uint8Array {
  if (key.length === 0) {
    throw new OperationFailure(
      'INVALID_PARAMETERS',
      'XOR key is required and must not be empty.',
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
        'XOR hex key must contain valid two-digit hexadecimal byte pairs.',
        'key',
      );
    }
    if (decoded.byteLength === 0) {
      throw new OperationFailure(
        'INVALID_PARAMETERS',
        'XOR hex key must decode to at least one byte.',
        'key',
      );
    }
    return decoded;
  }
  return encodeUtf8(key);
}

export const xorOperation: OperationDefinition = {
  id: 'xor',
  label: 'XOR Cipher',
  category: 'ciphers',
  description:
    'Bitwise XOR arbitrary bytes against a repeating UTF-8 or hexadecimal key. Self-inverse with the same key.',
  securityNote:
    'Repeating-key XOR is an obfuscation/analysis primitive, not authenticated encryption.',
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
      label: 'Key',
      kind: 'secret',
      required: true,
      secret: true,
      placeholder: 'Repeating key',
    },
  ],
  validate(params: Parameters): readonly OperationError[] {
    const errors = validateParametersAgainstFields(this.parameters, params);
    if (errors.length > 0) return errors;
    const keyEncoding = (params.keyEncoding ?? 'utf8') as 'utf8' | 'hex';
    const key = String(params.key ?? '');
    try {
      parseXorKeyBytes(key, keyEncoding);
    } catch (err) {
      if (err instanceof OperationFailure) {
        return [err.operationError];
      }
      return [
        {
          code: 'INVALID_PARAMETERS',
          message: 'Invalid XOR key.',
          field: 'key',
        },
      ];
    }
    return [];
  },
  async execute(
    input: Uint8Array,
    params: Parameters,
    _context: OperationContext,
  ): Promise<Uint8Array> {
    const keyEncoding = (params.keyEncoding ?? 'utf8') as 'utf8' | 'hex';
    const key = String(params.key ?? '');
    const keyBytes = parseXorKeyBytes(key, keyEncoding);

    const out = new Uint8Array(input.byteLength);
    const keyLen = keyBytes.byteLength;
    for (let i = 0; i < input.byteLength; i++) {
      out[i] = input[i] ^ keyBytes[i % keyLen];
    }
    return out;
  },
};

export const atbashOperation: OperationDefinition = {
  id: 'atbash',
  label: 'Atbash Cipher',
  category: 'ciphers',
  description:
    'Mirror ASCII letters (A↔Z, a↔z), preserving case and leaving non-alphabetic characters unchanged.',
  securityNote: 'Classical monoalphabetic substitution; not encryption.',
  inputKind: 'utf8',
  parameters: [],
  validate(params: Parameters) {
    return validateParametersAgainstFields(this.parameters, params);
  },
  async execute(
    input: Uint8Array,
    _params: Parameters,
    _context: OperationContext,
  ): Promise<Uint8Array> {
    const text = decodeUtf8Fatal(input);
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x41 && code <= 0x5a) {
        out += String.fromCharCode(0x5a - (code - 0x41));
      } else if (code >= 0x61 && code <= 0x7a) {
        out += String.fromCharCode(0x7a - (code - 0x61));
      } else {
        out += text[i];
      }
    }
    return encodeUtf8(out);
  },
};

function railFenceIndexSequence(length: number, rails: number): Uint8Array {
  const railForPos = new Uint8Array(length);
  let rail = 0;
  let step = 1;
  for (let i = 0; i < length; i++) {
    railForPos[i] = rail;
    if (rail === 0) {
      step = 1;
    } else if (rail === rails - 1) {
      step = -1;
    }
    rail += step;
  }
  return railForPos;
}

export const railFenceOperation: OperationDefinition = {
  id: 'rail-fence',
  label: 'Rail Fence Cipher',
  category: 'ciphers',
  description:
    'Zigzag transposition cipher operating on Unicode code points across 2 to 64 rails.',
  securityNote: 'Classical transposition cipher for educational/analysis use.',
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
    {
      key: 'rails',
      label: 'Rails (2–64)',
      kind: 'number',
      required: true,
      secret: false,
      defaultValue: 3,
      min: 2,
      max: 64,
    },
  ],
  validate(params: Parameters) {
    return validateParametersAgainstFields(this.parameters, params);
  },
  async execute(
    input: Uint8Array,
    params: Parameters,
    _context: OperationContext,
  ): Promise<Uint8Array> {
    const direction = (params.direction ?? 'encode') as 'encode' | 'decode';
    const rails = Number(params.rails ?? 3);
    const text = decodeUtf8Fatal(input);
    const codePoints = Array.from(text);
    const len = codePoints.length;

    if (len <= 1 || rails >= len) {
      return encodeUtf8(text);
    }

    const railForPos = railFenceIndexSequence(len, rails);

    if (direction === 'encode') {
      const buckets: string[][] = Array.from({ length: rails }, () => []);
      for (let i = 0; i < len; i++) {
        buckets[railForPos[i]].push(codePoints[i]);
      }
      return encodeUtf8(buckets.map((b) => b.join('')).join(''));
    }

    // Decode: determine how many code points land on each rail, slice, then reconstruct
    const counts = new Uint32Array(rails);
    for (let i = 0; i < len; i++) {
      counts[railForPos[i]]++;
    }

    const railSlices: string[][] = new Array(rails);
    let offset = 0;
    for (let r = 0; r < rails; r++) {
      const count = counts[r];
      railSlices[r] = codePoints.slice(offset, offset + count);
      offset += count;
    }

    const railReadIdx = new Uint32Array(rails);
    const out: string[] = new Array(len);
    for (let i = 0; i < len; i++) {
      const r = railForPos[i];
      out[i] = railSlices[r][railReadIdx[r]++];
    }

    return encodeUtf8(out.join(''));
  },
};

const CHAR_TO_MORSE: Readonly<Record<string, string>> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
};

const MORSE_TO_CHAR: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CHAR_TO_MORSE).map(([ch, code]) => [code, ch]),
);

export const morseOperation: OperationDefinition = {
  id: 'morse',
  label: 'Morse Code',
  category: 'ciphers',
  description:
    'Encode ASCII letters and digits to ITU Morse dot/dash tokens separated by spaces and " / " word boundaries, or decode back to uppercase text.',
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

    if (text.length === 0) {
      return new Uint8Array(0);
    }

    if (direction === 'encode') {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return new Uint8Array(0);
      }
      const words = trimmed.split(/\s+/);
      const encodedWords: string[] = [];

      for (const word of words) {
        const tokens: string[] = [];
        for (let i = 0; i < word.length; i++) {
          const upper = word[i].toUpperCase();
          const morse = CHAR_TO_MORSE[upper];
          if (!morse) {
            throw new OperationFailure(
              'INVALID_INPUT',
              'Morse encode supports only ASCII letters (A–Z) and digits (0–9) plus whitespace.',
            );
          }
          tokens.push(morse);
        }
        encodedWords.push(tokens.join(' '));
      }

      const outBytes = encodeUtf8(encodedWords.join(' / '));
      if (outBytes.byteLength > context.maxOutputBytes) {
        throw new OperationFailure(
          'LIMIT_EXCEEDED',
          'Morse output exceeds the maximum step byte limit.',
        );
      }
      return outBytes;
    }

    // Decode strict validation:
    // Reject leading/trailing whitespace, tabs/newlines, multiple consecutive spaces, or unspaced slashes
    if (
      text !== text.trim() ||
      /[\t\r\n]/.test(text) ||
      / {2,}/.test(text)
    ) {
      throw new OperationFailure(
        'INVALID_INPUT',
        'Malformed Morse separator: use single spaces between characters and " / " between words.',
      );
    }

    const wordGroups = text.split(' / ');
    const decodedWords: string[] = [];

    for (const group of wordGroups) {
      if (group.length === 0 || group.includes('/')) {
        throw new OperationFailure(
          'INVALID_INPUT',
          'Malformed Morse word separator.',
        );
      }
      const charTokens = group.split(' ');
      let decodedWord = '';
      for (const token of charTokens) {
        if (token.length === 0 || !Object.prototype.hasOwnProperty.call(MORSE_TO_CHAR, token)) {
          throw new OperationFailure(
            'INVALID_INPUT',
            'Morse input contains an unknown dot/dash token.',
          );
        }
        decodedWord += MORSE_TO_CHAR[token];
      }
      decodedWords.push(decodedWord);
    }

    return encodeUtf8(decodedWords.join(' '));
  },
};

export const cipherOperations: readonly OperationDefinition[] = [
  caesarOperation,
  rot13Operation,
  vigenereOperation,
  xorOperation,
  atbashOperation,
  railFenceOperation,
  morseOperation,
];
