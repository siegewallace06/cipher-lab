import { describe, expect, it } from 'vitest';
import type { PipelineStep } from '@/engine/types';
import { bytesEqual, encodeBase64, encodeUtf8 } from '@/lib/bytes';
import { MAX_URL_DECODED_JSON_BYTES, MAX_URL_FRAGMENT_CHARS } from '@/lib/limits';
import {
  AES_DEMO_PASSPHRASE,
  DEFAULT_SAMPLE_INPUT_TEXT,
  PRESET_DEFINITIONS,
  getPresetById,
  instantiatePreset,
} from '@/lib/presets';
import { exportWorkspaceToUrlFragment, importWorkspaceFromUrlFragment } from '@/lib/url-state';

function makeFragmentFromJson(rawJson: string): string {
  const bytes = encodeUtf8(rawJson);
  return `#cl=${encodeBase64(bytes, 'url-safe', false)}`;
}

describe('Starter Presets & Shareable URL State (#cl=)', () => {
  it('defines all 4 neutral starter presets without comic or third-party product references', () => {
    expect(PRESET_DEFINITIONS.map((p) => p.id)).toEqual([
      'text-base64-url',
      'hex-bytes-sha256',
      'json-minify-base64',
      'aes-encrypt-decrypt',
    ]);
    expect(DEFAULT_SAMPLE_INPUT_TEXT).toBe('Hello, Cipher Lab!');
    expect(AES_DEMO_PASSPHRASE).toBe('demo-passphrase-not-for-production');

    for (const preset of PRESET_DEFINITIONS) {
      const instantiated = instantiatePreset(preset);
      expect(instantiated.steps.length).toBeGreaterThan(0);
      expect(instantiated.inputBytes.byteLength).toBeGreaterThan(0);
    }
  });

  it('round-trips arbitrary binary input and multi-step pipelines via #cl= fragment', () => {
    const binaryInput = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0x41]);
    const steps: PipelineStep[] = [
      {
        id: 'step-a',
        operationId: 'base64',
        enabled: true,
        params: { direction: 'encode', alphabet: 'url-safe', padding: false },
      },
      {
        id: 'step-b',
        operationId: 'rot13',
        enabled: false,
        params: {},
      },
    ];

    const exported = exportWorkspaceToUrlFragment({
      steps,
      includeInput: true,
      inputBytes: binaryInput,
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    expect(exported.fragment.startsWith('#cl=')).toBe(true);
    expect(exported.preview.omittedSecrets).toEqual([]);

    const imported = importWorkspaceFromUrlFragment(exported.fragment);
    expect(imported.kind).toBe('ok');
    if (imported.kind === 'ok') {
      expect(imported.inputBytes).not.toBeNull();
      expect(bytesEqual(imported.inputBytes!, binaryInput)).toBe(true);
      expect(imported.steps).toHaveLength(2);
      expect(imported.steps[0].operationId).toBe('base64');
      expect(imported.steps[0].params).toEqual({
        direction: 'encode',
        alphabet: 'url-safe',
        padding: false,
      });
      expect(imported.steps[1].enabled).toBe(false);
    }
  });

  it('omits input bytes by default when includeInput is false', () => {
    const exported = exportWorkspaceToUrlFragment({
      steps: [
        {
          id: 's1',
          operationId: 'sha256',
          enabled: true,
          params: {},
        },
      ],
      includeInput: false,
      inputBytes: encodeUtf8('Sensitive local input'),
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    const imported = importWorkspaceFromUrlFragment(exported.fragment);
    expect(imported.kind).toBe('ok');
    if (imported.kind === 'ok') {
      expect(imported.inputBytes).toBeNull();
    }
  });

  it('strips secret parameters (HMAC key & AES passphrase) on enabled, disabled, and preset steps', () => {
    const aesPreset = getPresetById('aes-encrypt-decrypt')!;
    const instantiated = instantiatePreset(aesPreset);
    // Also add a disabled HMAC step with a secret key
    const stepsWithSecrets = [
      ...instantiated.steps,
      {
        id: 'hmac-disabled',
        operationId: 'hmac-sha256',
        enabled: false,
        params: {
          key: 'never-export-this-hmac-key',
          keyEncoding: 'utf8',
        },
      },
    ];

    const exported = exportWorkspaceToUrlFragment({
      steps: stepsWithSecrets,
      includeInput: false,
      inputBytes: instantiated.inputBytes,
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    // Neither the demo passphrase nor the HMAC key may appear in the fragment
    expect(exported.preview.omittedSecrets).toHaveLength(3);

    const imported = importWorkspaceFromUrlFragment(exported.fragment);
    expect(imported.kind).toBe('ok');
    if (imported.kind === 'ok') {
      expect(imported.missingSecrets).toHaveLength(3);
      for (const step of imported.steps) {
        if ('passphrase' in step.params) {
          expect(step.params.passphrase).toBe('');
        }
        if ('key' in step.params) {
          expect(step.params.key).toBe('');
        }
      }
    }
  });

  it('rejects malformed, prototype-polluting, duplicate-key, secret-bearing, or invalid-schema fragments', () => {
    // 1. Empty or unrelated fragment
    expect(importWorkspaceFromUrlFragment('').kind).toBe('none');
    expect(importWorkspaceFromUrlFragment('#section-2').kind).toBe('error');

    // 2. Extra fragment parameter after #cl=
    expect(importWorkspaceFromUrlFragment('#cl=e30&extra=1').kind).toBe('error');

    // 3. Padded Base64url
    expect(importWorkspaceFromUrlFragment('#cl=e30=').kind).toBe('error');

    // 4. Prototype keys (__proto__, constructor, prototype) including unicode-escaped \u005f
    const protoFragment = makeFragmentFromJson(
      '{"v":1,"steps":[],"\\u005f_proto__":{}}',
    );
    expect(importWorkspaceFromUrlFragment(protoFragment).kind).toBe('error');

    // 5. Duplicate object keys
    const dupKeyFragment = makeFragmentFromJson(
      '{"v":1,"v":1,"steps":[]}',
    );
    expect(importWorkspaceFromUrlFragment(dupKeyFragment).kind).toBe('error');

    // 6. Unknown version v: 2
    const v2Fragment = makeFragmentFromJson('{"v":2,"steps":[]}');
    expect(importWorkspaceFromUrlFragment(v2Fragment).kind).toBe('error');

    // 7. Unknown root key
    const unknownRootFragment = makeFragmentFromJson(
      '{"v":1,"steps":[],"extra":true}',
    );
    expect(importWorkspaceFromUrlFragment(unknownRootFragment).kind).toBe(
      'error',
    );

    // 8. Secret parameter included in shared URL step must be rejected!
    const secretIncludedFragment = makeFragmentFromJson(
      JSON.stringify({
        v: 1,
        steps: [
          {
            operationId: 'aes-gcm',
            enabled: true,
            params: { direction: 'encrypt', passphrase: 'leaked' },
          },
        ],
      }),
    );
    expect(importWorkspaceFromUrlFragment(secretIncludedFragment).kind).toBe(
      'error',
    );

    // 9. Invalid non-secret parameter value (e.g., rails out of 2..64 range on rail-fence)
    const invalidParamFragment = makeFragmentFromJson(
      JSON.stringify({
        v: 1,
        steps: [
          {
            operationId: 'rail-fence',
            enabled: true,
            params: { direction: 'encode', rails: 99 },
          },
        ],
      }),
    );
    expect(importWorkspaceFromUrlFragment(invalidParamFragment).kind).toBe(
      'error',
    );

    // 10. Missing non-secret setting (e.g., caesar missing shift or aes-gcm missing direction)
    const missingNonSecretFragment = makeFragmentFromJson(
      JSON.stringify({
        v: 1,
        steps: [
          {
            operationId: 'caesar',
            enabled: true,
            params: { direction: 'encode' },
          },
        ],
      }),
    );
    expect(importWorkspaceFromUrlFragment(missingNonSecretFragment).kind).toBe(
      'error',
    );

    // 11. Unknown step key, unknown param key, and unknown operation
    expect(
      importWorkspaceFromUrlFragment(
        makeFragmentFromJson(
          JSON.stringify({
            v: 1,
            steps: [
              {
                operationId: 'rot13',
                enabled: true,
                params: {},
                extraStepKey: true,
              },
            ],
          }),
        ),
      ).kind,
    ).toBe('error');

    expect(
      importWorkspaceFromUrlFragment(
        makeFragmentFromJson(
          JSON.stringify({
            v: 1,
            steps: [
              {
                operationId: 'rot13',
                enabled: true,
                params: { unknownParam: 'x' },
              },
            ],
          }),
        ),
      ).kind,
    ).toBe('error');

    expect(
      importWorkspaceFromUrlFragment(
        makeFragmentFromJson(
          JSON.stringify({
            v: 1,
            steps: [
              {
                operationId: 'nonexistent-op',
                enabled: true,
                params: {},
              },
            ],
          }),
        ),
      ).kind,
    ).toBe('error');

    // 12. Malformed UTF-8 in decoded fragment bytes
    const invalidUtf8Fragment = `#cl=${encodeBase64(new Uint8Array([0xff, 0xfe, 0x80]), 'url-safe', false)}`;
    const utf8Res = importWorkspaceFromUrlFragment(invalidUtf8Fragment);
    expect(utf8Res.kind).toBe('error');
    if (utf8Res.kind === 'error') {
      expect(utf8Res.error.code).toBe('INVALID_UTF8');
    }

    // 13. Query parameter state rejected
    expect(importWorkspaceFromUrlFragment('', '?cl=e30').kind).toBe('error');
  });

  it('enforces exact 32,768-char and 24,576-byte URL fragment caps (exact limit vs one-over)', () => {
    // Exact 32,768-char fragment (24,573 JSON bytes = 32,764 Base64url chars + 4 chars '#cl=' = 32,768 chars) succeeds
    const exactJsonBytesTarget = 24573;
    const prefix = '{"v":1,"steps":[],"input":{"encoding":"base64url","data":"';
    const suffix = '"}}';
    const baseLen = prefix.length + suffix.length;
    const exactDataLen = exactJsonBytesTarget - baseLen;
    const validB64Len = Math.floor(exactDataLen / 4) * 4;
    const remainderSpaces = exactDataLen - validB64Len;
    const exactJson =
      prefix +
      'A'.repeat(validB64Len) +
      '"}}' +
      ' '.repeat(remainderSpaces);
    expect(encodeUtf8(exactJson).byteLength).toBe(exactJsonBytesTarget);
    const exactFragment = makeFragmentFromJson(exactJson);
    expect(exactFragment.length).toBe(MAX_URL_FRAGMENT_CHARS);
    expect(importWorkspaceFromUrlFragment(exactFragment).kind).toBe('ok');

    // 1 character over MAX_URL_FRAGMENT_CHARS (32,769 chars) fails
    const overCharFragment = '#cl=' + 'A'.repeat(MAX_URL_FRAGMENT_CHARS - 3);
    expect(overCharFragment.length).toBe(MAX_URL_FRAGMENT_CHARS + 1);
    const charRes = importWorkspaceFromUrlFragment(overCharFragment);
    expect(charRes.kind).toBe('error');
    if (charRes.kind === 'error') {
      expect(charRes.error.code).toBe('LIMIT_EXCEEDED');
    }

    // Export over MAX_URL_DECODED_JSON_BYTES (24,576 bytes) fails with LIMIT_EXCEEDED
    const oversizedInput = new Uint8Array(MAX_URL_DECODED_JSON_BYTES);
    const exportOverRes = exportWorkspaceToUrlFragment({
      steps: [],
      inputBytes: oversizedInput,
      includeInput: true,
    });
    expect(exportOverRes.ok).toBe(false);
    if (!exportOverRes.ok) {
      expect(exportOverRes.error.code).toBe('LIMIT_EXCEEDED');
    }
  });
});
