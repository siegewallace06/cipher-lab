/**
 * Single source of truth for resource and execution guardrails (technical-design.md ch. 4).
 */
export const MAX_STEP_BYTES = 1_048_576; // 1 MiB per input or single step output
export const MAX_CUMULATIVE_OUTPUT_BYTES = 16_777_216; // 16 MiB cumulative retained step outputs
export const MAX_PIPELINE_STEPS = 32; // Maximum steps in a pipeline including bypassed

export const MAX_PARAM_STRING_BYTES = 4_096; // Default UTF-8 byte cap for scalar string/secret params
export const MAX_REGEX_PATTERN_BYTES = 512; // UTF-8 byte cap for regex pattern
export const MAX_REGEX_REPLACEMENT_BYTES = 4_096; // UTF-8 byte cap for regex replacement

export const ORDINARY_STEP_TIMEOUT_MS = 2_000; // 2,000 ms watchdog for ordinary steps
export const AES_STEP_TIMEOUT_MS = 15_000; // 15,000 ms watchdog per AES-GCM step
export const TOTAL_RUN_TIMEOUT_MS = 30_000; // 30,000 ms watchdog for entire pipeline run
export const WORKER_STARTUP_TIMEOUT_MS = 2_000; // 2,000 ms worker startup budget

export const MAX_REGEX_INPUT_BYTES = 65_536; // 64 KiB input cap for regex operation
export const MAX_REGEX_MATCHES = 10_000; // Max regex matches before failing with LIMIT_EXCEEDED
export const REGEX_STEP_TIMEOUT_MS = 100; // 100 ms watchdog from regex step-start

export const MAX_DETECTION_BYTES = 65_536; // 64 KiB cap for format detection
export const DETECTION_TIMEOUT_MS = 200; // 200 ms watchdog for format detection

export const MAX_JSON_DEPTH = 64; // Maximum nesting depth for JSON / JWT structured parsing
export const MAX_JSON_NODES = 100_000; // Maximum node count for JSON / JWT structured parsing

export const MAX_URL_FRAGMENT_CHARS = 32_768; // Max ASCII characters in URL fragment
export const MAX_URL_JSON_BYTES = 24_576; // Max decoded UTF-8 JSON bytes in URL fragment
export const MAX_URL_DECODED_JSON_BYTES = MAX_URL_JSON_BYTES;

export const AUTORUN_DEBOUNCE_MS = 200; // 200 ms edit debounce before starting worker run
export const AUTO_RUN_DEBOUNCE_MS = AUTORUN_DEBOUNCE_MS;

export const THEME_STORAGE_KEY = 'cipher-lab-theme';

