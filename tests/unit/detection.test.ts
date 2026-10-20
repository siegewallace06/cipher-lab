import { describe, expect, it } from 'vitest';
import { detectFormats } from '@/lib/detection';
import { encodeUtf8 } from '@/lib/bytes';
import { MAX_DETECTION_BYTES } from '@/lib/limits';

describe('Bounded Format Detection (detection.ts)', () => {
  it('detects JWT with confidence 0.99 and action operationId "jwt"', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const res = detectFormats(encodeUtf8(jwt), 1);
    expect(res.status).toBe('ok');
    expect(res.candidates[0]).toMatchObject({
      format: 'jwt',
      confidence: 0.99,
      operationId: 'jwt',
    });
  });

  it('detects JSON object/array with confidence 0.95 and action operationId "json"', () => {
    const res = detectFormats(encodeUtf8('{"service":"cipher-lab","v":1}'), 2);
    expect(res.status).toBe('ok');
    expect(res.candidates[0]).toMatchObject({
      format: 'json',
      confidence: 0.95,
      operationId: 'json',
      params: { mode: 'pretty', indent: 2 },
    });
  });

  it('detects URL percent-encoded input with confidence 0.85', () => {
    const res = detectFormats(encodeUtf8('hello%20world%3Fkey%3Dvalue'), 3);
    expect(res.status).toBe('ok');
    expect(res.candidates[0]).toMatchObject({
      format: 'url',
      confidence: 0.85,
      operationId: 'url',
      params: { direction: 'decode' },
    });
  });

  it('detects Unix timestamps (10-digit seconds and 13-digit milliseconds) in UTC years 2000..2100 with confidence 0.75', () => {
    const secRes = detectFormats(encodeUtf8('1776643200'), 4);
    expect(secRes.candidates.find((c) => c.format === 'timestamp')).toMatchObject({
      format: 'timestamp',
      confidence: 0.75,
      operationId: 'timestamp',
      params: { direction: 'epoch-to-iso', unit: 'seconds' },
    });

    const msRes = detectFormats(encodeUtf8('1776643200000'), 5);
    expect(msRes.candidates.find((c) => c.format === 'timestamp')).toMatchObject({
      format: 'timestamp',
      confidence: 0.75,
      operationId: 'timestamp',
      params: { direction: 'epoch-to-iso', unit: 'milliseconds' },
    });

    // Out-of-range year (e.g., 1970: 0000000001) should not match timestamp
    const oldRes = detectFormats(encodeUtf8('0000000001'), 6);
    expect(oldRes.candidates.find((c) => c.format === 'timestamp')).toBeUndefined();
  });

  it('detects standard and URL-safe Base64 with confidence 0.65 and ranks ambiguous Hex (0.80) above Base64 (0.65)', () => {
    // '4142434445464748' is both valid 8-byte Hex and valid 16-char Base64
    const ambigRes = detectFormats(encodeUtf8('4142434445464748'), 7);
    expect(ambigRes.status).toBe('ok');
    expect(ambigRes.candidates.map((c) => c.format)).toEqual(['hex', 'base64']);
    expect(ambigRes.candidates[0].confidence).toBe(0.8);
    expect(ambigRes.candidates[1].confidence).toBe(0.65);

    // URL-safe Base64 containing '-' or '_' (canonical padded quantum: 'YWJjZGVm-_8=')
    const b64UrlRes = detectFormats(encodeUtf8('YWJjZGVm-_8='), 8);
    expect(b64UrlRes.candidates[0]).toMatchObject({
      format: 'base64',
      confidence: 0.65,
      params: { direction: 'decode', alphabet: 'url-safe', padding: true },
    });
  });

  it('returns empty candidates for plain prose, invalid UTF-8, or short strings', () => {
    expect(detectFormats(encodeUtf8('Hello, plain text!'), 9).candidates).toEqual(
      [],
    );
    expect(detectFormats(new Uint8Array([0xff, 0xfe, 0x00]), 10).candidates).toEqual(
      [],
    );
    expect(detectFormats(encodeUtf8('4142'), 11).candidates).toEqual([]);
  });

  it('enforces the 65,536-byte detection cap: 65,536 bytes succeeds and 65,537 bytes returns unavailable', () => {
    const exactCap = new Uint8Array(MAX_DETECTION_BYTES).fill(0x41);
    const okRes = detectFormats(exactCap, 12);
    expect(okRes.status).toBe('ok');

    const overCap = new Uint8Array(MAX_DETECTION_BYTES + 1).fill(0x41);
    const overRes = detectFormats(overCap, 13);
    expect(overRes.status).toBe('unavailable');
    expect(overRes.candidates).toEqual([]);
  });
});
