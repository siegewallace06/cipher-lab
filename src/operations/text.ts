import {
  OperationFailure,
  type OperationContext,
  type OperationDefinition,
  type OperationError,
  type Parameters,
} from '@/engine/types';
import { decodeUtf8Fatal, encodeUtf8 } from '@/lib/bytes';
import {
  MAX_REGEX_INPUT_BYTES,
  MAX_REGEX_MATCHES,
  MAX_REGEX_PATTERN_BYTES,
  MAX_REGEX_REPLACEMENT_BYTES,
} from '@/lib/limits';
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

function toTitleCaseAsciiTokens(text: string): string {
  const parts = text.split(/(\s+)/);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.length === 0 || /^\s+$/.test(part)) continue;
    const lowered = part.toLowerCase();
    parts[i] = lowered.replace(/^[a-z]/, (ch) => ch.toUpperCase());
  }
  return parts.join('');
}

export const caseOperation: OperationDefinition = {
  id: 'case',
  label: 'Case Converter',
  category: 'text',
  description:
    'Convert UTF-8 text using locale-independent Unicode lowercase/uppercase or token-first ASCII title case.',
  inputKind: 'utf8',
  parameters: [
    {
      key: 'mode',
      label: 'Mode',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'lower',
      options: ['lower', 'upper', 'title'],
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
    const mode = (params.mode ?? 'lower') as 'lower' | 'upper' | 'title';
    const text = decodeUtf8Fatal(input);

    let result: string;
    if (mode === 'lower') {
      result = text.toLowerCase();
    } else if (mode === 'upper') {
      result = text.toUpperCase();
    } else {
      result = toTitleCaseAsciiTokens(text);
    }

    return ensureMaxOutput(encodeUtf8(result), context.maxOutputBytes);
  },
};

export const reverseOperation: OperationDefinition = {
  id: 'reverse',
  label: 'Reverse Text / Lines',
  category: 'text',
  description:
    'Reverse UTF-8 text by Unicode code points or reverse LF-normalized lines while preserving terminal newline.',
  inputKind: 'utf8',
  parameters: [
    {
      key: 'mode',
      label: 'Mode',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'code-points',
      options: ['code-points', 'lines'],
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
    const mode = (params.mode ?? 'code-points') as 'code-points' | 'lines';
    const text = decodeUtf8Fatal(input);

    if (text.length === 0) {
      return new Uint8Array(0);
    }

    if (mode === 'code-points') {
      const reversed = Array.from(text).reverse().join('');
      return ensureMaxOutput(encodeUtf8(reversed), context.maxOutputBytes);
    }

    const normalized = text.replace(/\r\n/g, '\n');
    const endsWithNewline = normalized.endsWith('\n');
    const body = endsWithNewline ? normalized.slice(0, -1) : normalized;
    const lines = body.split('\n');
    lines.reverse();
    const joined = lines.join('\n') + (endsWithNewline ? '\n' : '');
    return ensureMaxOutput(encodeUtf8(joined), context.maxOutputBytes);
  },
};

const ALLOWED_REGEX_FLAGS = new Set(['g', 'i', 'm', 's', 'u']);

function validateRegexFlags(flags: string): OperationError | null {
  const seen = new Set<string>();
  for (let i = 0; i < flags.length; i++) {
    const ch = flags[i];
    if (!ALLOWED_REGEX_FLAGS.has(ch)) {
      return {
        code: 'INVALID_PARAMETERS',
        message: 'Regex flags may only include g, i, m, s, and u.',
        field: 'flags',
      };
    }
    if (seen.has(ch)) {
      return {
        code: 'INVALID_PARAMETERS',
        message: `Duplicate regex flag "${ch}" is not allowed.`,
        field: 'flags',
      };
    }
    seen.add(ch);
  }
  return null;
}

function advanceStringIndex(
  text: string,
  index: number,
  unicode: boolean,
): number {
  if (!unicode || index + 1 >= text.length) {
    return index + 1;
  }
  const cp = text.codePointAt(index);
  return cp !== undefined && cp > 0xffff ? index + 2 : index + 1;
}

function applyReplacementTemplate(
  template: string,
  matched: string,
  captures: readonly (string | null)[],
  groups: Record<string, string | undefined> | undefined,
  start: number,
  fullText: string,
): string {
  let out = '';
  let i = 0;
  const len = template.length;

  while (i < len) {
    const ch = template[i];
    if (ch !== '$' || i + 1 >= len) {
      out += ch;
      i++;
      continue;
    }

    const next = template[i + 1];
    if (next === '$') {
      out += '$';
      i += 2;
      continue;
    }
    if (next === '&') {
      out += matched;
      i += 2;
      continue;
    }
    if (next === '`') {
      out += fullText.slice(0, start);
      i += 2;
      continue;
    }
    if (next === "'") {
      out += fullText.slice(start + matched.length);
      i += 2;
      continue;
    }
    if (next === '<') {
      const closeIdx = template.indexOf('>', i + 2);
      if (closeIdx !== -1 && groups) {
        const groupName = template.slice(i + 2, closeIdx);
        out += groups[groupName] ?? '';
        i = closeIdx + 1;
        continue;
      }
      out += '$<';
      i += 2;
      continue;
    }
    if (next >= '0' && next <= '9') {
      const twoDigit =
        i + 2 < len && template[i + 2] >= '0' && template[i + 2] <= '9'
          ? Number.parseInt(template.slice(i + 1, i + 3), 10)
          : -1;
      if (twoDigit >= 1 && twoDigit <= captures.length) {
        out += captures[twoDigit - 1] ?? '';
        i += 3;
        continue;
      }
      const oneDigit = Number.parseInt(next, 10);
      if (oneDigit >= 1 && oneDigit <= captures.length) {
        out += captures[oneDigit - 1] ?? '';
        i += 2;
        continue;
      }
    }

    out += '$' + next;
    i += 2;
  }

  return out;
}

export interface RegexMatchRecord {
  match: string;
  captures: (string | null)[];
  start: number;
  end: number;
}

export const regexOperation: OperationDefinition = {
  id: 'regex',
  label: 'Regex Find & Replace',
  category: 'text',
  description:
    'Search or replace UTF-8 text using regular expressions with bounded input (64 KiB), match cap (10,000), and worker watchdog isolation.',
  inputKind: 'utf8',
  parameters: [
    {
      key: 'pattern',
      label: 'Pattern',
      kind: 'text',
      required: true,
      secret: false,
      defaultValue: '',
      maxBytes: MAX_REGEX_PATTERN_BYTES,
      placeholder: 'Regular expression pattern',
    },
    {
      key: 'replacement',
      label: 'Replacement',
      kind: 'text',
      required: false,
      secret: false,
      defaultValue: '',
      maxBytes: MAX_REGEX_REPLACEMENT_BYTES,
      placeholder: 'Replacement string',
    },
    {
      key: 'mode',
      label: 'Mode',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'replace',
      options: ['replace', 'find'],
    },
    {
      key: 'flags',
      label: 'Flags (g/i/m/s/u)',
      kind: 'text',
      required: false,
      secret: false,
      defaultValue: 'g',
      maxBytes: 16,
    },
  ],
  validate(params: Parameters): readonly OperationError[] {
    const errors = validateParametersAgainstFields(this.parameters, params);
    if (errors.length > 0) return errors;

    const pattern = String(params.pattern ?? '');
    const flags = String(params.flags ?? 'g');

    const flagErr = validateRegexFlags(flags);
    if (flagErr) return [flagErr];

    try {
      new RegExp(pattern, flags);
    } catch {
      return [
        {
          code: 'INVALID_PARAMETERS',
          message: 'Invalid regular expression pattern syntax.',
          field: 'pattern',
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
    if (input.byteLength > MAX_REGEX_INPUT_BYTES) {
      throw new OperationFailure(
        'LIMIT_EXCEEDED',
        `Regex input exceeds the ${MAX_REGEX_INPUT_BYTES}-byte limit.`,
      );
    }

    const validationErrors = this.validate(params);
    if (validationErrors.length > 0) {
      const first = validationErrors[0];
      throw new OperationFailure(first.code, first.message, first.field);
    }

    const pattern = String(params.pattern ?? '');
    const replacement = String(params.replacement ?? '');
    const mode = (params.mode ?? 'replace') as 'replace' | 'find';
    const flags = String(params.flags ?? 'g');

    const text = decodeUtf8Fatal(input);
    const isGlobal = flags.includes('g');
    const isUnicode = flags.includes('u');
    const regex = new RegExp(pattern, flags);

    const matches: Array<{
      match: string;
      captures: (string | null)[];
      groups?: Record<string, string | undefined>;
      start: number;
      end: number;
    }> = [];

    if (isGlobal) {
      while (true) {
        if (context.signal.aborted) {
          throw new OperationFailure('CANCELLED', 'Regex execution cancelled.');
        }
        const execResult = regex.exec(text);
        if (execResult === null) break;

        matches.push({
          match: execResult[0],
          captures: execResult.slice(1).map((c) => c ?? null),
          groups: execResult.groups ? { ...execResult.groups } : undefined,
          start: execResult.index,
          end: execResult.index + execResult[0].length,
        });

        if (matches.length > MAX_REGEX_MATCHES) {
          throw new OperationFailure(
            'LIMIT_EXCEEDED',
            `Regex match count exceeded the maximum limit of ${MAX_REGEX_MATCHES}.`,
          );
        }

        if (execResult[0].length === 0) {
          const nextIdx = advanceStringIndex(
            text,
            regex.lastIndex,
            isUnicode,
          );
          if (nextIdx > text.length) break;
          regex.lastIndex = nextIdx;
        }
      }
    } else {
      const execResult = regex.exec(text);
      if (execResult !== null) {
        matches.push({
          match: execResult[0],
          captures: execResult.slice(1).map((c) => c ?? null),
          groups: execResult.groups ? { ...execResult.groups } : undefined,
          start: execResult.index,
          end: execResult.index + execResult[0].length,
        });
      }
    }

    if (mode === 'find') {
      const publicMatches: RegexMatchRecord[] = matches.map((m) => ({
        match: m.match,
        captures: m.captures,
        start: m.start,
        end: m.end,
      }));
      return ensureMaxOutput(
        encodeUtf8(JSON.stringify(publicMatches, null, 2)),
        context.maxOutputBytes,
      );
    }

    if (matches.length === 0) {
      return ensureMaxOutput(encodeUtf8(text), context.maxOutputBytes);
    }

    const pieces: string[] = [];
    let cursor = 0;
    let totalChars = 0;

    for (const m of matches) {
      const prefix = text.slice(cursor, m.start);
      const sub = applyReplacementTemplate(
        replacement,
        m.match,
        m.captures,
        m.groups,
        m.start,
        text,
      );
      pieces.push(prefix, sub);
      totalChars += prefix.length + sub.length;
      if (totalChars > context.maxOutputBytes) {
        const currentBytes = encodeUtf8(pieces.join(''));
        if (currentBytes.byteLength > context.maxOutputBytes) {
          throw new OperationFailure(
            'LIMIT_EXCEEDED',
            'Regex replacement output exceeds the maximum step byte limit.',
          );
        }
      }
      cursor = m.end;
    }

    pieces.push(text.slice(cursor));
    return ensureMaxOutput(
      encodeUtf8(pieces.join('')),
      context.maxOutputBytes,
    );
  },
};

function compareByCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const cpA = a.codePointAt(i)!;
    const cpB = b.codePointAt(j)!;
    if (cpA !== cpB) {
      return cpA - cpB;
    }
    i += cpA > 0xffff ? 2 : 1;
    j += cpB > 0xffff ? 2 : 1;
  }
  return a.length - b.length;
}

export const linesOperation: OperationDefinition = {
  id: 'lines',
  label: 'Line Sort / Deduplicate',
  category: 'text',
  description:
    'Sort and/or deduplicate LF-normalized lines using deterministic Unicode code-point order while preserving terminal newline.',
  inputKind: 'utf8',
  parameters: [
    {
      key: 'action',
      label: 'Action',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'both',
      options: ['both', 'sort', 'deduplicate'],
    },
    {
      key: 'order',
      label: 'Order',
      kind: 'select',
      required: true,
      secret: false,
      defaultValue: 'ascending',
      options: ['ascending', 'descending'],
    },
    {
      key: 'caseSensitive',
      label: 'Case Sensitive',
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
    const action = (params.action ?? 'both') as
      | 'both'
      | 'sort'
      | 'deduplicate';
    const order = (params.order ?? 'ascending') as 'ascending' | 'descending';
    const caseSensitive = Boolean(params.caseSensitive ?? true);

    const text = decodeUtf8Fatal(input);
    if (text.length === 0) {
      return new Uint8Array(0);
    }

    const normalized = text.replace(/\r\n/g, '\n');
    const endsWithNewline = normalized.endsWith('\n');
    const body = endsWithNewline ? normalized.slice(0, -1) : normalized;
    let lines = body.split('\n');

    if (action === 'deduplicate' || action === 'both') {
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const line of lines) {
        const key = caseSensitive ? line : line.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(line);
        }
      }
      lines = deduped;
    }

    if (action === 'sort' || action === 'both') {
      const indexed = lines.map((line, idx) => ({
        line,
        key: caseSensitive ? line : line.toLowerCase(),
        idx,
      }));
      const directionMultiplier = order === 'descending' ? -1 : 1;
      indexed.sort((a, b) => {
        const keyCmp = compareByCodePoints(a.key, b.key);
        if (keyCmp !== 0) return keyCmp * directionMultiplier;
        const rawCmp = compareByCodePoints(a.line, b.line);
        if (rawCmp !== 0) return rawCmp * directionMultiplier;
        return a.idx - b.idx;
      });
      lines = indexed.map((item) => item.line);
    }

    const outputText = lines.join('\n') + (endsWithNewline ? '\n' : '');
    return ensureMaxOutput(encodeUtf8(outputText), context.maxOutputBytes);
  },
};

export interface EntropyReport {
  byteCount: number;
  byteLength: number;
  entropyBitsPerByte: number;
  maxEntropyBitsPerByte: 8;
  frequencies: Array<{
    byte: number;
    hex: string;
    count: number;
    probability: number;
  }>;
  notice: string;
}

export function computeEntropyReport(input: Uint8Array): EntropyReport {
  const counts = new Uint32Array(256);
  const total = input.byteLength;

  for (let i = 0; i < total; i++) {
    counts[input[i]]++;
  }

  let entropy = 0;
  const frequencies: EntropyReport['frequencies'] = new Array(256);

  for (let b = 0; b < 256; b++) {
    const count = counts[b];
    const probability = total > 0 ? count / total : 0;
    if (count > 0 && total > 0) {
      entropy -= probability * Math.log2(probability);
    }
    frequencies[b] = {
      byte: b,
      hex: b.toString(16).padStart(2, '0'),
      count,
      probability: Number(probability.toFixed(8)),
    };
  }

  const normalizedEntropy =
    total === 0 ? 0 : Math.abs(entropy) < 1e-12 ? 0 : Number(entropy.toFixed(6));

  return {
    byteCount: total,
    byteLength: total,
    entropyBitsPerByte: normalizedEntropy,
    maxEntropyBitsPerByte: 8,
    frequencies,
    notice:
      'Informational statistical measure only; not a cryptographic randomness certification.',
  };
}

export const entropyOperation: OperationDefinition = {
  id: 'entropy',
  label: 'Shannon Entropy & Byte Frequency',
  category: 'text',
  description:
    'Compute byte count, Shannon entropy (0–8 bits/byte), and all 256 byte frequency counts and probabilities as JSON.',
  securityNote:
    'Statistical entropy is informational only and does not certify cryptographic randomness.',
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
    const report = computeEntropyReport(input);
    return ensureMaxOutput(
      encodeUtf8(JSON.stringify(report, null, 2)),
      context.maxOutputBytes,
    );
  },
};

export const textOperations: readonly OperationDefinition[] = [
  caseOperation,
  reverseOperation,
  regexOperation,
  linesOperation,
  entropyOperation,
];
