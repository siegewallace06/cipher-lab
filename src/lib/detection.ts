import type { Parameters } from '../engine/types';
import {
  decodeBase64,
  decodeHex,
  decodeUtf8OrNull,
  encodeBase64,
  inspectRawJsonText,
  validateJsonStructureLimits,
} from './bytes';
import { DETECTION_TIMEOUT_MS, MAX_DETECTION_BYTES } from './limits';

export type DetectedFormatId =
  | 'jwt'
  | 'json'
  | 'url'
  | 'hex'
  | 'timestamp'
  | 'base64';

export interface DetectionCandidate {
  format: DetectedFormatId;
  label: string;
  confidence: number;
  reason: string;
  actionLabel: string;
  operationId: string;
  params: Parameters;
}

export interface DetectionResult {
  revision: number;
  status: 'ok' | 'unavailable' | 'timeout' | 'error';
  reason?: string;
  candidates: DetectionCandidate[];
}

export interface DetectionWorkerRequest {
  type: 'detect';
  jobId: string;
  revision: number;
  input: Uint8Array;
}

export interface DetectionWorkerResponse {
  type: 'detect-complete';
  jobId: string;
  revision: number;
  result: DetectionResult;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function detectJwt(text: string): DetectionCandidate | null {
  if (/\s/.test(text)) {
    return null;
  }
  const segments = text.split('.');
  if (segments.length !== 3) {
    return null;
  }
  const [headerSeg, payloadSeg, signatureSeg] = segments;
  if (!headerSeg || !payloadSeg) {
    return null;
  }

  const headerBytes = decodeBase64(headerSeg, 'url-safe');
  const payloadBytes = decodeBase64(payloadSeg, 'url-safe');
  if (!headerBytes || !payloadBytes) {
    return null;
  }
  if (signatureSeg.length > 0 && !decodeBase64(signatureSeg, 'url-safe')) {
    return null;
  }

  const headerText = decodeUtf8OrNull(headerBytes);
  const payloadText = decodeUtf8OrNull(payloadBytes);
  if (headerText === null || payloadText === null) {
    return null;
  }
  if (
    !inspectRawJsonText(headerText).valid ||
    !inspectRawJsonText(payloadText).valid
  ) {
    return null;
  }

  try {
    const headerObj: unknown = JSON.parse(headerText);
    const payloadObj: unknown = JSON.parse(payloadText);
    if (!isPlainJsonObject(headerObj) || !isPlainJsonObject(payloadObj)) {
      return null;
    }
    if (
      !validateJsonStructureLimits(headerObj).valid ||
      !validateJsonStructureLimits(payloadObj).valid
    ) {
      return null;
    }
    return {
      format: 'jwt',
      label: 'JSON Web Token (JWT)',
      confidence: 0.99,
      reason: 'Three Base64url segments with JSON object header and payload.',
      actionLabel: 'Inspect JWT',
      operationId: 'jwt',
      params: {},
    };
  } catch {
    return null;
  }
}

function detectJson(text: string): DetectionCandidate | null {
  const trimmed = text.trim();
  if (
    !(trimmed.startsWith('{') && trimmed.endsWith('}')) &&
    !(trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return null;
  }
  if (!inspectRawJsonText(trimmed).valid) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    if (!validateJsonStructureLimits(parsed).valid) {
      return null;
    }
    return {
      format: 'json',
      label: 'JSON Document',
      confidence: 0.95,
      reason: 'Complete valid JSON object or array within structure bounds.',
      actionLabel: 'Pretty-print JSON',
      operationId: 'json',
      params: { mode: 'pretty', indent: 2 },
    };
  } catch {
    return null;
  }
}

function detectUrlEncoding(text: string): DetectionCandidate | null {
  if (!/%[0-9A-Fa-f]{2}/.test(text)) {
    return null;
  }
  if (/%(?![0-9A-Fa-f]{2})/.test(text)) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(text);
    if (decoded === text) {
      return null;
    }
    return {
      format: 'url',
      label: 'URL Percent-Encoded',
      confidence: 0.85,
      reason: 'Contains valid %HH percent-escaped sequences.',
      actionLabel: 'URL Decode',
      operationId: 'url',
      params: { direction: 'decode' },
    };
  } catch {
    return null;
  }
}

function detectHex(text: string): DetectionCandidate | null {
  const decoded = decodeHex(text);
  if (!decoded || decoded.byteLength < 4) {
    return null;
  }
  return {
    format: 'hex',
    label: 'Hexadecimal Bytes',
    confidence: 0.8,
    reason: `Valid hexadecimal byte encoding (${decoded.byteLength} bytes).`,
    actionLabel: 'Hex Decode',
    operationId: 'hex',
    params: { direction: 'decode', case: 'lower' },
  };
}

function detectTimestamp(text: string): DetectionCandidate | null {
  if (!/^-?(?:\d{10}|\d{13})$/.test(text)) {
    return null;
  }
  const digitCount = text.startsWith('-') ? text.length - 1 : text.length;
  const unit: 'seconds' | 'milliseconds' =
    digitCount === 10 ? 'seconds' : 'milliseconds';
  const numeric = Number(text);
  if (!Number.isSafeInteger(numeric)) {
    return null;
  }
  const ms = unit === 'seconds' ? numeric * 1000 : numeric;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const utcYear = date.getUTCFullYear();
  if (utcYear < 2000 || utcYear > 2100) {
    return null;
  }
  return {
    format: 'timestamp',
    label: `Unix Epoch (${unit})`,
    confidence: 0.75,
    reason: `Integer ${unit} timestamp in UTC year ${utcYear}.`,
    actionLabel: `Convert Epoch (${unit}) to ISO`,
    operationId: 'timestamp',
    params: { direction: 'epoch-to-iso', unit },
  };
}

function detectBase64(text: string): DetectionCandidate | null {
  if (text.length < 8 || /\s/.test(text)) {
    return null;
  }

  const hasPadding = text.endsWith('=');
  const standardDecoded = decodeBase64(text, 'standard');
  if (standardDecoded && standardDecoded.byteLength > 0) {
    const canonical = encodeBase64(standardDecoded, 'standard', hasPadding);
    if (canonical === text) {
      return {
        format: 'base64',
        label: 'Base64 (Standard)',
        confidence: 0.65,
        reason: 'Matches canonical standard Base64 encoding.',
        actionLabel: 'Base64 Decode',
        operationId: 'base64',
        params: { direction: 'decode', alphabet: 'standard', padding: true },
      };
    }
  }

  const urlSafeDecoded = decodeBase64(text, 'url-safe');
  if (urlSafeDecoded && urlSafeDecoded.byteLength > 0) {
    const canonical = encodeBase64(urlSafeDecoded, 'url-safe', hasPadding);
    if (canonical === text) {
      return {
        format: 'base64',
        label: 'Base64url (URL-Safe)',
        confidence: 0.65,
        reason: 'Matches canonical URL-safe Base64 encoding.',
        actionLabel: 'Base64url Decode',
        operationId: 'base64',
        params: { direction: 'decode', alphabet: 'url-safe', padding: true },
      };
    }
  }

  return null;
}

export function detectFormats(
  input: Uint8Array,
  revision = 0,
): DetectionResult {
  if (input.byteLength > MAX_DETECTION_BYTES) {
    return {
      revision,
      status: 'unavailable',
      reason: `Format detection is unavailable for buffers exceeding ${MAX_DETECTION_BYTES.toLocaleString()} bytes.`,
      candidates: [],
    };
  }

  if (input.byteLength === 0) {
    return {
      revision,
      status: 'ok',
      candidates: [],
    };
  }

  const text = decodeUtf8OrNull(input);
  if (text === null || text.trim().length === 0) {
    return {
      revision,
      status: 'ok',
      candidates: [],
    };
  }

  const candidates: DetectionCandidate[] = [];
  const detectors = [
    detectJwt,
    detectJson,
    detectUrlEncoding,
    detectHex,
    detectTimestamp,
    detectBase64,
  ];

  for (const detector of detectors) {
    const match = detector(text);
    if (match) {
      candidates.push(match);
    }
  }

  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return a.format.localeCompare(b.format);
  });

  return {
    revision,
    status: 'ok',
    candidates,
  };
}

export type DetectionWorkerFactory = () => Worker;

interface ActiveDetectionJob {
  jobId: string;
  revision: number;
  worker: Worker | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  resolve: (result: DetectionResult) => void;
}

export class DetectionWorkerClient {
  private readonly createWorker: DetectionWorkerFactory;
  private activeJob: ActiveDetectionJob | null = null;
  private destroyed = false;

  constructor(createWorker?: DetectionWorkerFactory) {
    this.createWorker =
      createWorker ??
      (() => new Worker(new URL('./detection-worker.ts', import.meta.url)));
  }

  detect(input: Uint8Array, revision: number): Promise<DetectionResult> {
    if (this.destroyed) {
      return Promise.resolve({
        revision,
        status: 'error',
        candidates: [],
      });
    }

    // Cancel any existing job immediately so at most 1 detection worker exists
    this.cancelActiveJob();

    if (input.byteLength > MAX_DETECTION_BYTES) {
      return Promise.resolve({
        revision,
        status: 'unavailable',
        reason: `Format detection is unavailable for buffers exceeding ${MAX_DETECTION_BYTES.toLocaleString()} bytes.`,
        candidates: [],
      });
    }

    if (input.byteLength === 0) {
      return Promise.resolve({
        revision,
        status: 'ok',
        candidates: [],
      });
    }

    const jobId = `det-${revision}-${Date.now()}`;

    return new Promise<DetectionResult>((resolve) => {
      let worker: Worker;
      try {
        worker = this.createWorker();
      } catch {
        // Fallback when Worker constructor is unavailable in environment
        resolve(detectFormats(input, revision));
        return;
      }

      const job: ActiveDetectionJob = {
        jobId,
        revision,
        worker,
        timeoutId: null,
        settled: false,
        resolve,
      };
      this.activeJob = job;

      job.timeoutId = setTimeout(() => {
        if (job.settled || this.activeJob !== job) {
          return;
        }
        this.cleanupJob(job);
        resolve({
          revision,
          status: 'timeout',
          reason: 'Format detection timed out.',
          candidates: [],
        });
      }, DETECTION_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<DetectionWorkerResponse>) => {
        const message = event.data;
        if (
          job.settled ||
          this.activeJob !== job ||
          !message ||
          message.type !== 'detect-complete' ||
          message.jobId !== jobId ||
          message.revision !== revision
        ) {
          return;
        }
        this.cleanupJob(job);
        resolve(message.result);
      };

      worker.onerror = () => {
        if (job.settled || this.activeJob !== job) {
          return;
        }
        this.cleanupJob(job);
        resolve({
          revision,
          status: 'error',
          candidates: [],
        });
      };

      worker.onmessageerror = () => {
        if (job.settled || this.activeJob !== job) {
          return;
        }
        this.cleanupJob(job);
        resolve({
          revision,
          status: 'error',
          candidates: [],
        });
      };

      const inputCopy = input.slice();
      const request: DetectionWorkerRequest = {
        type: 'detect',
        jobId,
        revision,
        input: inputCopy,
      };
      worker.postMessage(request, [inputCopy.buffer]);
    });
  }

  cancelActiveJob(): void {
    if (!this.activeJob) {
      return;
    }
    const job = this.activeJob;
    this.cleanupJob(job);
    job.resolve({
      revision: job.revision,
      status: 'error',
      candidates: [],
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelActiveJob();
  }

  getActiveWorkerCount(): number {
    return this.activeJob && !this.activeJob.settled ? 1 : 0;
  }

  private cleanupJob(job: ActiveDetectionJob): void {
    job.settled = true;
    if (job.timeoutId !== null) {
      clearTimeout(job.timeoutId);
      job.timeoutId = null;
    }
    if (job.worker) {
      job.worker.onmessage = null;
      job.worker.onerror = null;
      job.worker.onmessageerror = null;
      job.worker.terminate();
      job.worker = null;
    }
    if (this.activeJob === job) {
      this.activeJob = null;
    }
  }
}
