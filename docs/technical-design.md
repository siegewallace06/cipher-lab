# Cipher Lab technical design

| Field | Value |
| --- | --- |
| Status | Design baseline for implementation; not implemented behavior |
| Owner | Product and Technical Lead |
| Audience | Engineer, QA, Reviewer |
| Scope | Browser execution, workspace UI, safe sharing, bounded processing |
| Related | [Requirements](prd.md), [tasks](tasks.md), [decisions](decisions.md) |

## 1. Summary and grounding

Build one Next.js App Router application with client-side workspace state and a dedicated module worker for each active execution. No processing route or remote service is required. Server rendering supplies the shell, not user data processing. Types and paths below are proposed contracts, not discovered code.

| Grounded fact | Evidence |
| --- | --- |
| Repository starts with only a title README, no manifest or implementation | Git tree at `6f62be4e66316c7e2d7406ccb0e2a277c0fafa9f` |
| Product scope and stack are mandated | Stage 1 Specification (`01a15826-4d9a-72ea-bc9a-168ca9484ff3`); normative scope in PRD |
| Build commands do not exist at this baseline | Same tree; tasks ch. 2 requires their creation |

Non-goals remain owned by PRD ch. 6. There are no unresolved product questions required to begin implementation. Package versions are implementation choices: Engineer must use compatible stable versions, pin via lockfile, and record them in evidence rather than treating this design as a claim of current versions.

> **Why & What - local single-app execution**
>
> **What:** Execute transforms in browser workers and ship a single application with no runtime service dependencies.
>
> **Why:** Data stays local and deployment needs no processing backend. This does not prevent browser extensions or a compromised device from observing data.
>
> **Alternatives considered:** Server execution centralizes resource controls but transmits sensitive data and introduces backend state and operations outside scope.
>
> **Fallback:** Show capability errors on unsupported browsers; do not silently send computation remotely.

## 2. Proposed module and component boundaries

```text
src/app/layout.tsx                metadata, theme bootstrap, shell
src/app/page.tsx                  workspace host
src/app/globals.css               Tailwind entry, semantic theme tokens
src/components/workbench/         Workbench, ResponsiveShell, RunToolbar
src/components/catalog/           OperationCatalog, CategoryTabs, Search
src/components/pipeline/          PipelineBuilder, StepCard, ParameterForm, Inspector
src/components/data/              InputPane, OutputPane, HexView, Statistics
src/components/sharing/           ShareDialog, RestoreNotice
src/components/common/            Dialog, StatusMessage, ErrorBoundary
src/state/workspace.ts            reducer, revisions, selectors
src/engine/types.ts               engine contract and discriminated results
src/engine/registry.ts            static definitions and allowlist
src/engine/execute.ts             sequential bounded execution
src/engine/worker.ts              worker message adapter
src/engine/worker-client.ts       lifecycle, cancellation, revision checks
src/operations/encoding.ts        encoding and format definitions
src/operations/ciphers.ts         classical cipher and XOR definitions
src/operations/crypto.ts          digest, HMAC, CRC32, AES definitions
src/operations/text.ts            text and analysis definitions
src/lib/bytes.ts                  fatal UTF-8, strict codecs, byte accounting
src/lib/crypto-envelope.ts        envelope validation and derivation
src/lib/detection.ts              bounded ranked suggestions
src/lib/url-state.ts              versioned fragment import/export
src/lib/limits.ts                 single source of resource limits
src/lib/presets.ts                starter preset definitions
src/lib/parameter-schema.ts       primitive validation, secret annotations
tests/unit/                       vector, boundary, schema tests
tests/integration/                worker and workspace tests
tests/e2e/                        browser interaction and accessibility
```

Bootstrap also creates `package.json`, lockfile, TypeScript/Next/Tailwind/lint/test configurations and CI. Do not import Node-only modules into browser bundles. Use global `crypto.subtle` in browser workers; Node tests inject `node:crypto` webcrypto through a provider interface.

Workbench owns one reducer, not a global persistence framework. State includes input bytes and editor draft, steps, autoRun, revision, run status, selected step ID, result revision, detection candidates, and theme. Draft text is separate from committed bytes so incomplete hex does not overwrite valid bytes or trigger a run. Reducer actions commit validated byte buffers and increment revision atomically. Parameters are primitive objects; do not store closures or crypto keys in reducer state.

Component-level error boundaries isolate unexpected rendering exceptions and offer reset without logging data. Expected operation errors are structured state, not thrown through the component tree. Keep input and settings on recoverable rendering failure. Root fallback offers a full reset. Live regions announce completion/error once, not each keystroke or step duration update.

## 3. Engine and byte contract

### 3.1 Types

The following is the intended TypeScript interface, to be implemented and exported from `src/engine/types.ts`.

```ts
type ParameterValue = string | number | boolean;
type Parameters = Readonly<Record<string, ParameterValue>>;
type ErrorCode = 'INVALID_PARAMETERS' | 'INVALID_UTF8' | 'INVALID_INPUT'
  | 'LIMIT_EXCEEDED' | 'UNSUPPORTED_ENVIRONMENT' | 'AUTHENTICATION_FAILED'
  | 'CANCELLED' | 'TIMEOUT' | 'INTERNAL_ERROR';
interface OperationError {
  code: ErrorCode;
  message: string; // static, safe user message, never input or secret values
  field?: string;
}
interface ParameterField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'boolean' | 'select' | 'secret';
  required: boolean;
  secret: boolean;
  defaultValue?: ParameterValue;
  options?: readonly ParameterValue[];
  min?: number;
  max?: number;
}
interface OperationContext {
  signal: AbortSignal;
  crypto: Pick<Crypto, 'subtle' | 'getRandomValues'>;
  maxOutputBytes: number;
}
interface OperationDefinition {
  id: string;
  label: string;
  category: 'encoding' | 'ciphers' | 'crypto' | 'text';
  description: string;
  inputKind: 'bytes' | 'utf8';
  parameters: readonly ParameterField[];
  validate(params: Parameters): readonly OperationError[];
  execute(input: Uint8Array, params: Parameters,
    context: OperationContext): Promise<Uint8Array>;
}
interface PipelineStep {
  id: string; // random instance identity, independent of operation ID
  operationId: string;
  enabled: boolean;
  params: Parameters;
}
type StepResult =
  | { stepId: string; status: 'success' | 'bypassed'; output: Uint8Array;
      byteLength: number; durationMs: number }
  | { stepId: string; status: 'error'; error: OperationError; durationMs: number }
  | { stepId: string; status: 'not-run' };
type PipelineExecutionResult =
  | { runId: string; revision: number; status: 'success'; steps: StepResult[];
      output: Uint8Array; durationMs: number }
  | { runId: string; revision: number; status: 'error' | 'cancelled';
      steps: StepResult[]; error: OperationError; durationMs: number };
```

Operations may throw an internal typed OperationFailure carrying OperationError; execute.ts catches and normalizes every rejection. Unknown exceptions map to static INTERNAL_ERROR without raw stack or exception text. Field errors produced by validate block execution; missing secret on an enabled step is INVALID_PARAMETERS. Disabled steps do not validate required secrets, but imported parameter types and sizes still must pass schema validation.

### 3.2 Registry and execution

Canonical operation IDs: `base64`, `base32`, `hex`, `binary`, `url`, `html-entities`, `json`, `jwt`, `timestamp`, `caesar`, `rot13`, `vigenere`, `xor`, `atbash`, `rail-fence`, `morse`, `sha1`, `sha256`, `sha384`, `sha512`, `hmac-sha256`, `crc32`, `aes-gcm`, `case`, `reverse`, `regex`, `lines`, `entropy`. Registry IDs are stable URL schema identifiers, never dynamic imports selected by untrusted text. Unknown IDs fail import and execution. User-facing paired directions use a `direction` parameter where PRD defines one; hash variants have distinct IDs and no algorithm parameter.

Use TextEncoder once at a text boundary and TextDecoder('utf-8', {fatal:true}) only for text operations. Never implicitly decode/re-encode binary between steps. Code-point counts use string iteration, not JS UTF-16 length. Display line count is 0 for empty text and otherwise LF count plus 1, including a terminal empty line; CRLF counts as one delimiter. Invalid UTF-8 has unavailable character/line statistics.

The executor snapshots buffers/parameters, validates registry/limits, then runs enabled steps sequentially. It must not mutate input or previous output buffers. It records performance.now() durations without a minimum fake duration; bypass duration is 0. Bypass output aliases are acceptable internally if immutable; worker transport copies only once per distinct buffer where practical. Count retained result bytes even for aliases conservatively. Empty pipelines return an owned copy of input. Any failure prevents final output and marks subsequent steps not-run. Results contain no secrets or parameter dumps.

> **Why & What - byte-first pipeline data**
>
> **What:** Uint8Array is the only operation payload; strings are explicit views or format boundaries.
>
> **Why:** Binary ciphertext, digest input, and XOR output survive arbitrary chains without UTF-8 corruption. This costs explicit conversions and makes invalid-text failures visible.
>
> **Alternatives considered:** Strings make text UI simpler but cannot represent arbitrary bytes reliably without hidden encoding conventions.
>
> **Fallback:** Hex display and byte download remain available when text decoding fails.

### 3.3 Async, worker protocol, and cancellation

Worker receives `{type:'run', runId, revision, input, steps}` via structured clone. Each job creates an AbortController and calls execute. It returns `{type:'complete', result}` only; errors are normalized. UI validates runId and revision on every received message and discards stale jobs. Input buffers remain owned by UI; transfer a copied buffer if transferring to worker.

On edits, debounce 200 ms, terminate the previous worker immediately, and start at most one replacement when eligible. Manual Run follows the same lifecycle. Cancel terminates worker and marks the active run cancelled. Main-thread watchdog enforces deadlines even when regex blocks the worker event loop. worker error/messageerror also ends the job safely. Termination, not AbortSignal alone, is essential because Web Crypto and synchronous regex cannot reliably be interrupted in flight. Destroy worker/listeners/timers on replacement and component unmount.

Use a separate bounded worker job for detection so typing never waits for regex or crypto. At most one execution worker and one detection worker exist. Detection jobs also carry buffer revisions, have 200 ms watchdog, and cancel on superseding input.

## 4. Guardrails and security

Limits below are product defaults, not measured performance results. Keep values exported in limits.ts and assert exact boundaries in tests.

| Resource | Limit and behavior |
| --- | --- |
| Input / each step output | 1,048,576 bytes; reject larger before commit/next step |
| Retained intermediate outputs | 16,777,216 bytes cumulative; fail with LIMIT_EXCEEDED before retaining excess |
| Steps | 32 including bypassed; disable add/duplicate at cap |
| Scalar parameter string | 4,096 UTF-8 bytes, except regex pattern 512 and replacement 4,096; keys/passphrases also capped |
| Single ordinary step | 2,000 ms watchdog |
| AES step / entire run | 15,000 ms per AES step; 30,000 ms total run |
| Regex input / match count | 65,536 bytes / 10,000 matches; fail rather than truncate |
| Regex execution | 100 ms watchdog, measured from operation start notification; worker startup has ordinary 2,000 ms budget |
| Detection | 65,536 bytes; larger buffers show detection unavailable, never classify a truncated token |
| JWT/JSON structured parsing | Input cap applies; parsed structure max depth 64, node count 100,000 checked iteratively after parse; reject overage |
| URL fragment / decoded JSON | 32,768 ASCII characters / 24,576 UTF-8 bytes; enforce before Base64 decoding and before JSON parse |

Regex cannot be secured by a pattern blacklist alone. Run it only inside execution worker, reject unsupported/duplicate flags, bound input and match collection, and terminate from main thread on timeout. Send `{type:'step-start',runId,revision,stepId,operationId}` before each step so the parent can arm correct watchdogs. Timeout creates an error result for that step plus not-run statuses; retain prior step outputs by posting `{type:'step-result',runId,revision,result}` as steps finish, with cumulative-byte validation on both sides. Main thread combines these for timeout/cancel results. Empty match progression follows ECMAScript Unicode-aware advancement when `u` is active. No eval, new Function, replacement callback code, or custom operation scripts.

Render all data as text nodes. Do not use innerHTML, executable previews, embedded remote resources, or token-triggered links. Clipboard and downloads require explicit user gesture and error feedback. Revoke download object URLs after click. No secrets or payloads in logs, telemetry, error reporting, query strings, local/session storage, or service workers. Theme may use a single local preference key. A strict content security policy must restrict scripts/resources to the deployed app, set object-src none, base-uri self, and frame-ancestors none. Engineer must configure a Next-compatible nonce/hash strategy if needed, not weaken policy globally to fix development tooling; document dev-only exceptions separately.

## 5. Authenticated-encryption envelope

AES encrypt treats passphrase as exact UTF-8, without trimming or Unicode normalization. Derive a nonextractable AES-256-GCM key with PBKDF2-HMAC-SHA256, 600,000 iterations, fresh 16-byte random salt, fresh 12-byte random IV, and 128-bit authentication tag. `getRandomValues` is the only entropy source. Do not allow user-supplied encryption IV/salt, iteration sliders, or weak fallback algorithms.

The UTF-8 JSON envelope has exactly these fields:

```json
{"v":1,"kdf":"PBKDF2-SHA256","iterations":600000,"cipher":"AES-256-GCM","salt":"BASE64URL","iv":"BASE64URL","ciphertext":"BASE64URL"}
```

Placeholders above describe encoding, not a usable fixture. All three binary fields are canonical unpadded Base64url. Ciphertext includes Web Crypto's appended 16-byte tag. Fixed additionalData is UTF-8 `CipherLab:aes-gcm:v1:PBKDF2-SHA256:600000`. JSON serialization order is fixed as shown for output; import field order is irrelevant. Decryption validates exact field set, v, constants, salt/IV lengths, tag minimum, canonical encoding, and total output/input caps before deriving the key. Iterations must equal the supported constant, not attacker-selected work. Future tuning requires envelope version change, not relaxed bounds. Parse/type errors are INVALID_INPUT; after a structurally valid envelope, wrong secret and authentication failure are indistinguishable AUTHENTICATION_FAILED. Never expose partial plaintext. Encrypted JSON expands data; output-size caps apply to the serialized envelope, so near-cap plaintext can fail with a clear size error.

> **Why & What - versioned authenticated envelope**
>
> **What:** Fix PBKDF2/AES parameters in a strict v1 envelope and authenticate with fixed version-specific additional data.
>
> **Why:** Portable local round trips avoid hidden settings and unauthenticated decryption. Passphrase strength remains the user's responsibility; PBKDF2 costs latency and does not turn weak phrases into strong secrets.
>
> **Alternatives considered:** Raw ciphertext is compact but loses derivation metadata; a memory-hard KDF can improve guessing resistance but adds implementation/dependency complexity beyond the mandated native crypto approach.
>
> **Fallback:** Unsupported crypto environments fail explicitly; keep noncrypto operations available.

## 6. Format detection

Return `DetectionCandidate {format, confidence, reason, operationId, params}` with confidence 0-1 as a heuristic score, not probability. Use full bounded buffers, fatal UTF-8 and anchored validation. Never auto-apply or interpret a hint as authenticity.

| Format | Test | Score / action |
| --- | --- | --- |
| JWT | Three segments, valid Base64url, first two parse to JSON objects | 0.99 / jwt |
| JSON | Complete parse of object/array (not primitive), depth/node limits | 0.95 / json pretty |
| URL encoding | At least one valid %HH escape, all escapes valid, decoding succeeds and changes input | 0.85 / url decode |
| Hex | At least 4 complete pairs, strict hex decoder passes | 0.80 / hex decode |
| Unix epoch | Optional minus plus exactly 10 or 13 decimal digits; resulting UTC year 2000-2100 inclusive | 0.75 / timestamp with matching unit |
| Base64 | At least 8 symbols, strict standard or URL-safe decode then canonical re-encode matches modulo allowed padding | 0.65 / base64 decode with matching alphabet |

Preserve all qualifying candidates; sort descending score then fixed format ID lexicographically. ASCII hex may also be Base64; show both. Base64 strings consisting solely of digits/letters still qualify but are low confidence. Blank input and invalid UTF-8 have no text-format suggestions. Invalid escapes, padding, partial JSON, or malformed JWT must not get corresponding suggestion. Input and output banners are separate, revision-bound state.

## 7. Stateless URL state

> **Why & What - fragment-only explicit sharing**
>
> **What:** Export a versioned, uncompressed UTF-8 JSON document as canonical unpadded Base64url in `#cl=...`.
>
> **Why:** Fragments are not sent in ordinary HTTP requests and uncompressed bounded data avoids decompression bombs. URLs remain visible to recipients, browser history, extensions, and screenshots; this is not encrypted storage.
>
> **Alternatives considered:** Query parameters are easy to inspect but transmitted to hosting servers; compressed fragments hold more data but add complexity and hidden expansion risk.
>
> **Fallback:** Oversized export fails with advice to omit input or shorten the pipeline, never silently truncates.

Schema: `{v:1,steps:[{operationId:string,enabled:boolean,params:object}],input?:{encoding:'base64url',data:string}}`. Input stores exact bytes, not lossy text. Exclude instance IDs, theme, results, errors, timestamps, autorun, and all fields marked secret in registry metadata. On restoration generate fresh step IDs; missing secret fields become empty UI values, never defaults containing actual secrets. Secret stripping must use registry metadata for XOR keys, Vigenère passphrase, HMAC key and AES passphrase, including disabled steps and presets. Sharing preview explicitly lists omitted fields.

Accept only exact root/step/input keys and known operation-specific parameter keys with correct primitive types, enum/range checks, string limits and no nested objects. Copy allowed keys into fresh objects; reject prototype-related keys rather than merging arbitrary JSON. Reject unknown version/operation, duplicate fragment keys, extra fragment fields, invalid canonical Base64url/UTF-8, oversized payloads, and invalid parameter values. Missing required secret parameters alone is a valid import; missing required nonsecret parameters is invalid unless a documented registry default applies. Reject imported secret keys, even if empty: valid exporters omit them. Import validates all steps before reducer commit, pauses auto-run, and displays a warning with Run and Clear actions. Never fetch a URL or run script from state. Query parameters cannot restore workspace state.

Use an explicit Share button to build the URL, not automatic history synchronization. Copy success/failure is visible. No automatic URL rewrite on restore; Clear removes the fragment using replaceState so sensitive shared input can be removed from the visible address (without claiming to erase browser history).

## 8. Testing, tradeoffs, and residual risks

[Tasks](tasks.md) owns test commands and assignment boundaries. Pure functions require independent vectors, byte-level assertions, malformed inputs and boundary limits. Use browser tests for worker termination, clipboard/download, URL restoration, crypto provider capability, responsiveness, focus, theme and XSS text rendering. Node tests alone do not verify browser worker delivery or SubtleCrypto interoperability.

Benefits: reproducible byte-preserving pipelines, no backend data custody, explicit limits, and independently testable modules. Costs: full intermediate copies consume memory; regex worker termination loses in-flight state; URL length restricts shared inputs; authenticated encryption is slower than elementary transforms; hex output may require explicit UTF-8 interpretation. No partial final output is a deliberate correctness choice.

Residual risks: browser/OS memory may retain secrets; recipients can disclose shared content; very large but permitted JSON can still allocate memory before structural checks; a hung worker may exceed budgets under background-tab timer throttling. QA owns recording browser differences. Engineer must not add persistence, downgrade crypto, relax byte integrity, render untrusted markup, or change acceptance criteria to work around implementation difficulty. Material deviations go to Lead; routine defects stay with the execution team.
