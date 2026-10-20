import type { Parameters, PipelineStep } from '../engine/types';
import { encodeUtf8 } from './bytes';

export interface PresetStepTemplate {
  operationId: string;
  enabled: boolean;
  params: Parameters;
}

export interface PipelinePreset {
  id: string;
  label: string;
  description: string;
  sampleText: string;
  hasDemoSecret: boolean;
  demoNotice?: string;
  steps: readonly PresetStepTemplate[];
}

export const DEMO_PASSPHRASE = 'demo-passphrase-not-for-production';
export const AES_DEMO_PASSPHRASE = DEMO_PASSPHRASE;
export const DEFAULT_SAMPLE_TEXT = 'Hello, Cipher Lab!';
export const DEFAULT_SAMPLE_INPUT_TEXT = DEFAULT_SAMPLE_TEXT;

export const PIPELINE_PRESETS: readonly PipelinePreset[] = [
  {
    id: 'text-base64-url',
    label: 'Text to Base64 to URL encoding',
    description:
      'Encode UTF-8 text into standard Base64, then percent-encode for URL component transport.',
    sampleText: 'Hello, Cipher Lab! ?mode=inspect&v=1',
    hasDemoSecret: false,
    steps: [
      {
        operationId: 'base64',
        enabled: true,
        params: { direction: 'encode', alphabet: 'standard', padding: true },
      },
      {
        operationId: 'url',
        enabled: true,
        params: { direction: 'encode' },
      },
    ],
  },
  {
    id: 'hex-bytes-sha256',
    label: 'Hex to bytes to SHA-256',
    description:
      'Decode hexadecimal byte pairs into raw bytes and compute their SHA-256 digest.',
    sampleText: '48656c6c6f2c20436970686572204c616221',
    hasDemoSecret: false,
    steps: [
      {
        operationId: 'hex',
        enabled: true,
        params: { direction: 'decode', case: 'lower' },
      },
      {
        operationId: 'sha256',
        enabled: true,
        params: {},
      },
    ],
  },
  {
    id: 'json-minify-base64',
    label: 'JSON minify to Base64',
    description:
      'Minify structured JSON and encode the compact UTF-8 representation as standard Base64.',
    sampleText: '{\n  "tool": "Cipher Lab",\n  "version": 1,\n  "stateless": true\n}',
    hasDemoSecret: false,
    steps: [
      {
        operationId: 'json',
        enabled: true,
        params: { mode: 'minify', indent: 2 },
      },
      {
        operationId: 'base64',
        enabled: true,
        params: { direction: 'encode', alphabet: 'standard', padding: true },
      },
    ],
  },
  {
    id: 'aes-encrypt-decrypt',
    label: 'AES encrypt to AES decrypt',
    description:
      'Authenticated AES-256-GCM round trip using a clearly labeled demonstration passphrase.',
    sampleText: DEFAULT_SAMPLE_TEXT,
    hasDemoSecret: true,
    demoNotice:
      'Uses demonstration passphrase "demo-passphrase-not-for-production". Do not use for real secrets; passphrases are excluded when sharing URLs.',
    steps: [
      {
        operationId: 'aes-gcm',
        enabled: true,
        params: {
          direction: 'encrypt',
          passphrase: DEMO_PASSPHRASE,
        },
      },
      {
        operationId: 'aes-gcm',
        enabled: true,
        params: {
          direction: 'decrypt',
          passphrase: DEMO_PASSPHRASE,
        },
      },
    ],
  },
];

let presetStepCounter = 0;

export function generateStepId(): string {
  presetStepCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `step-${crypto.randomUUID()}`;
  }
  return `step-${Date.now()}-${presetStepCounter}-${Math.random().toString(36).slice(2, 9)}`;
}

export function instantiatePreset(preset: PipelinePreset): {
  inputBytes: Uint8Array;
  inputText: string;
  steps: PipelineStep[];
} {
  return {
    inputBytes: encodeUtf8(preset.sampleText),
    inputText: preset.sampleText,
    steps: preset.steps.map((step) => ({
      id: generateStepId(),
      operationId: step.operationId,
      enabled: step.enabled,
      params: { ...step.params },
    })),
  };
}

export function getPresetById(id: string): PipelinePreset | undefined {
  return PIPELINE_PRESETS.find((preset) => preset.id === id);
}

export const PRESET_DEFINITIONS = PIPELINE_PRESETS;
