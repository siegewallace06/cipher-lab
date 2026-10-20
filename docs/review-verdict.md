# Code & Architecture Review Verdict — Cipher Lab

- **Review Issue**: `ALFRED-14` (`01a15826-5025-7b1c-8c6f-2fb0d2dce2c6`)
- **Parent Issue**: `ALFRED-10` (`01a15824-1bef-70a9-94b3-ecd913bcc2f7`)
- **Implementation Issue**: `ALFRED-12` (`01a15826-4e64-7697-825a-31019768b327`)
- **Pull Request**: [#1 (`feat/alfred-12-cipher-lab`)](https://github.com/siegewallace06/cipher-lab/pull/1)
- **Initial Reviewed Commit**: `c2118a25b6f6c03ec3a2c16503aea0d73afadee1`
- **Fix Cycle 1 Re-Reviewed Commit**: `3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`
- **Reviewer**: `The Reviewer` (`daf1890c-ac4a-46cd-bef5-15a40709bf43`)
- **Review Verdict**: **`APPROVED`**

---

## 1. Executive Summary

An independent diff, architecture, security, and test-quality audit was conducted on `feat/alfred-12-cipher-lab` (initial implementation commit `c2118a25b6f6c03ec3a2c16503aea0d73afadee1` and Fix Cycle 1 commit `3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`) against the normative requirements in [`docs/prd.md`](prd.md), [`docs/technical-design.md`](technical-design.md), [`docs/tasks.md`](tasks.md), and [`docs/decisions.md`](decisions.md).

- **Blocking Findings**: **0**
- **Non-Blocking Suggestions**: **0 open** (2 initial suggestions resolved in Fix Cycle 1 commit `3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`)
- **Review Verdict**: **`APPROVED`**

---

## 2. Architecture & Specification Alignment Audit

### 2.1 Single-Next.js Stateless Architecture & Module Boundaries
- **Verified**: `src/app/`, `src/components/`, `src/engine/`, `src/operations/`, `src/lib/`, `src/state/`, `src/middleware.ts`, `next.config.ts`.
- The codebase is a single Next.js 15 App Router TypeScript application with zero backend API routes, zero databases, zero external analytics/telemetry, and zero third-party UI or cryptography runtime dependencies (`package.json:15-19` includes only `next`, `react`, and `react-dom`).
- Browser storage is untouched for workspace data, inputs, outputs, or secrets. Only the optional UI theme preference key `cipher-lab-theme` is read/written in `window.localStorage` (`src/components/workbench/Workbench.tsx:146-155`, `358-365`), matching `docs/prd.md` ch. 4 and `docs/technical-design.md` ch. 5.

### 2.2 Authoritative `Uint8Array` Byte Pipeline & UTF-8 Fidelity
- **Verified**: `src/lib/bytes.ts`, `src/engine/execute.ts`, `src/state/workspace.ts`, `src/components/data/InputPane.tsx`, `src/components/data/OutputPane.tsx`, `src/components/pipeline/Inspector.tsx`.
- Every operation executes over `Uint8Array -> Promise<Uint8Array>` (`src/engine/types.ts:68-72`).
- `src/engine/execute.ts` clones the initial input (`cloneBytes(request.input)` at line 224) and clones each step's output (`cloneBytes` at lines 267, 304) so step buffers are never mutated in place.
- `src/lib/bytes.ts` strictly separates fatal UTF-8 decoding (`new TextDecoder('utf-8', { fatal: true })` at line 5) from lossy preview decoding (`new TextDecoder('utf-8', { fatal: false })` at line 6). Text-only operations fail deterministically with `INVALID_INPUT` on invalid UTF-8 bytes rather than silently corrupting bytes with `U+FFFD`.
- `src/state/workspace.ts:624-662` (`promote-output-to-input`) copies `executionResult.output` directly into `inputBytes` and automatically switches `inputEntryMode` to `'hex'` when the promoted bytes are not valid UTF-8, preventing round-trip corruption through a text editor.
- Empty pipelines (`steps.length === 0`) execute as an identity pass-through returning the exact input `Uint8Array` (`src/engine/execute.ts:226-235`).

### 2.3 Worker Isolation, Cancellation, and Watchdog Enforcement
- **Verified**: `src/engine/worker.ts`, `src/engine/worker-client.ts`, `src/lib/detection.ts`, `src/lib/detection-worker.ts`, `src/lib/limits.ts`.
- All resource and timeout constants in `src/lib/limits.ts:1-35` match `docs/technical-design.md` ch. 4 byte-for-byte (`MAX_STEP_BYTES = 1_048_576`, `MAX_CUMULATIVE_OUTPUT_BYTES = 16_777_216`, `MAX_PIPELINE_STEPS = 32`, `ORDINARY_STEP_TIMEOUT_MS = 2_000`, `AES_STEP_TIMEOUT_MS = 15_000`, `REGEX_STEP_TIMEOUT_MS = 100`, `TOTAL_RUN_TIMEOUT_MS = 30_000`, `WORKER_STARTUP_TIMEOUT_MS = 2_000`, `MAX_DETECTION_BYTES = 65_536`, `DETECTION_TIMEOUT_MS = 200`).
- `PipelineWorkerClient` (`src/engine/worker-client.ts:171-385`) enforces at most one active pipeline worker at a time (`terminateActiveWorker()` before starting a new run, on user cancel, on revision change in `Workbench.tsx:263`, and on watchdog expiry).
- Incremental `step-start` and `step-result` messages (`src/engine/worker.ts:25-40`) allow `PipelineWorkerClient` to arm operation-specific step watchdogs (`100 ms` for `regex`, `15,000 ms` for `aes-gcm`, `2,000 ms` for all other steps) and preserve completed earlier `StepResult` snapshots when a downstream step fails, times out, or is cancelled (`src/engine/worker-client.ts:388-464`).

### 2.4 All 28 Canonical Operations & Cryptographic Contracts
- **Verified**: `src/engine/registry.ts`, `src/operations/encoding.ts`, `src/operations/ciphers.ts`, `src/operations/crypto.ts`, `src/operations/text.ts`, `src/lib/crypto-envelope.ts`.
- All 28 canonical v1 operation IDs are registered in `src/engine/registry.ts:62-97` across `encoding` (9), `ciphers` (7), `crypto` (7), and `text` (5).
- **Encoding (`src/operations/encoding.ts`)**:
  - `base64` and `base32` enforce RFC 4648 canonical alphabets, strict padding rules, and zero-value unused trailing bits (`src/lib/bytes.ts:288-524`).
  - `hex` and `binary` reject odd nybbles, split byte pairs (`4 8`), and non-8-bit binary groups (`src/lib/bytes.ts:171-278`, `530-599`).
  - `url` implements byte-level RFC 3986 percent-encoding and preserves literal `'+'` on decode (`src/operations/encoding.ts:231-319`).
  - `html-entities` encodes `&`, `<`, `>`, `"`, `'` (`&#39;` / `&apos;`) and decodes the 10 named entities plus decimal/hex numeric references while rejecting surrogate (`0xD800..0xDFFF`), non-scalar (`> 0x10FFFF`), and NUL (`0`) code points (`src/operations/encoding.ts:328-446`).
  - `json` enforces iterative structural depth (`<= 64`) and node count (`<= 100,000`) via an explicit stack (`src/lib/bytes.ts:624-678`).
  - `jwt` (`src/operations/encoding.ts:563-748`) validates 3-segment compact tokens, rejects duplicate/prototype keys via `scanRawJsonSafety`, always emits `verified: false`, flags unsigned tokens (`alg: "none"` or empty signature), and formats `exp`, `nbf`, `iat` as UTC ISO-8601 strings without comparing against `Date.now()`.
  - `timestamp` (`src/operations/encoding.ts:756-881`) validates exact calendar dates via `Date.UTC` round-trip checks, requires explicit timezone offsets on ISO-8601 inputs, and enforces ECMAScript safe time bounds (`±8.64e15` ms).
- **Classical Ciphers (`src/operations/ciphers.ts`)**:
  - `caesar`, `rot13`, `vigenere`, `atbash` preserve case on ASCII letters, leave non-ASCII letters unchanged, and do not advance the Vigenère key index on non-letters (`src/operations/ciphers.ts:169-247`).
  - `xor` operates directly on raw `Uint8Array` bytes with repeating UTF-8 or hex keys (`src/operations/ciphers.ts:253-328`).
  - `rail-fence` operates on Unicode code points (`Array.from(text)`) and treats `rails >= codePointCount` as identity (`src/operations/ciphers.ts:352-447`).
  - `morse` implements the exact 54-entry ITU table and fails with `INVALID_INPUT` on unsupported characters or tokens (`src/operations/ciphers.ts:453-565`).
- **Hashing & Cryptography (`src/lib/crypto-envelope.ts`, `src/operations/crypto.ts`)**:
  - `sha1`, `sha256`, `sha384`, `sha512`, and `hmac-sha256` use `crypto.subtle` and return `UNSUPPORTED_ENVIRONMENT` when Web Crypto is unavailable (`src/operations/crypto.ts:27-44`). `sha1` is explicitly labeled legacy and non-collision-resistant (`src/operations/crypto.ts:63-66`).
  - `crc32` computes IEEE 802.3 CRC-32 (`0xEDB88320`) in pure TypeScript (`src/operations/crypto.ts:191-225`).
  - `aes-gcm` (`src/lib/crypto-envelope.ts`) implements the normative `v: 1` JSON envelope (`PBKDF2-SHA256`, `600000` iterations, 16-byte random salt, 12-byte random IV, 128-bit tag, fixed ASCII AAD `CipherLab:aes-gcm:v1:PBKDF2-SHA256:600000`). Envelope structure, version, KDF, iteration count, salt length, and IV length are validated prior to key derivation (`src/lib/crypto-envelope.ts:144-334`), and decryption failures return an indistinguishable `AUTHENTICATION_FAILED` error without echoing secrets (`src/lib/crypto-envelope.ts:404-415`).
- **Text & Analysis (`src/operations/text.ts`)**:
  - `case`, `reverse`, `regex`, `lines`, and `entropy` match all normative rules, including Unicode code-point advancement on zero-length regex matches (`src/operations/text.ts:269-289`), `null` for unmatched capture groups (`src/operations/text.ts:238`), safe replacement template parsing (`$$`, `$&`, `` $` ``, `$'`, `$n`, `$nn`, `$<name>`), LF normalization with terminal-newline preservation in `reverse` and `lines`, and 256-bucket Shannon entropy output.

---

## 3. Security, Privacy, and Accessibility Audit

### 3.1 Stateless `#cl=` URL Sharing, Secret Stripping, and Prototype-Pollution Defense
- **Verified**: `src/lib/url-state.ts`, `src/lib/parameter-schema.ts`, `src/components/sharing/ShareDialog.tsx`, `src/components/sharing/RestoreNotice.tsx`.
- `exportWorkspaceToUrlFragment` (`src/lib/url-state.ts:193-336`) strips every parameter marked `secret: true` (`vigenere.key`, `xor.key`, `hmac-sha256.key`, `aes-gcm.passphrase`) across both enabled and disabled steps, excludes `input` unless `includeInput: true` is explicitly checked, and refuses to truncate oversized payloads (`MAX_URL_DECODED_JSON_BYTES = 24_576`, `MAX_URL_FRAGMENT_CHARS = 32_768`).
- `importWorkspaceFromUrlFragment` (`src/lib/url-state.ts:346-733`) rejects query-parameter state (`?cl=`, `?state=`, etc.), validates canonical unpadded Base64url, runs `scanRawJsonSafety` to reject duplicate object keys and forbidden prototype keys (`__proto__`, `constructor`, `prototype`) before object construction, copies validated primitive parameters into `Object.create(null)` maps, and rejects any imported step that attempts to supply a `secret: true` parameter key (`src/lib/url-state.ts:575-586`).
- Restoring from `#cl=` sets `autoRun: false` (`src/state/workspace.ts:563-595`) and displays `RestoreNotice` warning the user before execution.

### 3.2 Content Security Policy & XSS Prevention
- **Verified**: `src/middleware.ts`, `next.config.ts`, `src/app/layout.tsx`.
- `src/middleware.ts` generates a 16-byte cryptographic nonce per request (`crypto.getRandomValues(new Uint8Array(16))`) and sets `Content-Security-Policy` with `default-src 'self'`, `script-src 'self' 'nonce-...'` in production, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, and `worker-src 'self' blob:`, alongside `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and `Permissions-Policy`.
- All user input, intermediate step buffers, final outputs, format-detection candidates, and error messages are rendered exclusively through React text nodes, `<textarea>`, `<input>`, and `<pre>` elements. The only `dangerouslySetInnerHTML` in `src/` is the static constant `THEME_INIT_SCRIPT` in `src/app/layout.tsx:28` protected by the request CSP nonce.

### 3.3 Branding & Prohibited Content Hygiene
- **Verified**: Full repository scan (`git grep -iE "batman|gotham|wayne|arkham|bruce|alfred|cyberchef|cryptii|dcode"`) confirmed zero prohibited fictional branding or third-party product references in application source, UI copy, presets, or tests.

---

## 4. Automated Test Audit & Executed Verification Gates

### 4.1 Test Meaningfulness Audit
- **Unit Tests (`tests/unit/*.test.ts`, `tests/unit/operations/*.test.ts`)**: 52 unit tests covering RFC 4648 Base64/Base32 vectors, FIPS 180-4 SHA-1/256/384/512 vectors, RFC 4231 HMAC-SHA256 vectors, IEEE 802.3 CRC-32 check value (`cbf43926`), deterministic AES-256-GCM envelope serialization + tamper/wrong-passphrase/unsupported-version/bad-iteration rejection, regex UTF-16 code-unit offsets and zero-length match advancement, 64-depth JSON boundary, and `#cl=` URL state secret stripping + prototype pollution + duplicate key rejection.
- **Integration Tests (`tests/integration/worker-and-workspace.test.ts`)**: 7 integration tests verifying worker progress events, single-active-worker cancellation on rapid edits, 100 ms regex watchdog timeout with `not-run` downstream steps, worker startup timeout and `onerror` crash handling, and reducer binary output promotion.
- **Browser E2E & Accessibility Tests (`tests/e2e/workbench.spec.ts`)**: 4 Playwright end-to-end scenarios verifying zero horizontal overflow across `1920x1080`, `1366x900`, `768x1024`, and `320x720`, `@axe-core/playwright` WCAG 2.2 AA compliance in both dark and light themes, zero external network requests, multi-step pipeline + inspector + entropy chart + hex input, format detection + preset confirmation + `#cl=` secret-stripped sharing, and XSS payload inertness.

### 4.2 Executed Verification Commands
The Reviewer independently executed the following verification commands on initial commit `c2118a25b6f6c03ec3a2c16503aea0d73afadee1` and re-executed the full verification suite on Fix Cycle 1 commit `3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`:
1. `npm ci` → **PASS** (0 errors)
2. `npm run lint` (`eslint .`) → **PASS** (0 errors, 0 warnings)
3. `npm run type-check` (`tsc --noEmit`) → **PASS** (0 errors)
4. `npm test` (`vitest run`) → **PASS** (8 test files, 59 tests passed)
5. `npm run build` (`next build`) → **PASS** (production build succeeded)
6. `npm run test:e2e` (`playwright test`) → **PASS** (4/4 E2E & WCAG 2.2 AA browser suites passed, including multi-viewport desktop `3+4+5=12` / tablet `5+7=12` grid row alignment assertions at `1920x1080`, `1366x900`, `1240x900`, `768x1024`, `320x720` and `inspector-json-precision-warning`)
7. Prohibited-terms scan (`git grep -iE "batman|gotham|wayne|arkham|bruce|alfred|cyberchef|cryptii|dcode"`) → **PASS** (0 matches)

---

## 5. Findings & Step 8 Fix Cycle 1 Re-Review (`3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`)

### 5.1 Blocking Findings
**None (0 blocking findings).**

### 5.2 Resolution of QA `DEFECT-01` & Non-Blocking Suggestions in Commit `3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`

1. **QA `DEFECT-01` (`AC-13` Desktop 3-Column Grid Layout & `Browse Catalog` Button Visibility) — `RESOLVED`**:
   - `src/components/workbench/ResponsiveShell.tsx:117-129`: Scoped the tablet column spans (`md:max-[1199px]:col-span-5` on `pipeline-column` and `md:max-[1199px]:col-span-7` on `data-column`) so they do not override `min-[1200px]:col-span-4` and `min-[1200px]:col-span-5` in Tailwind CSS v4 compiled output. Verified in compiled `.next/static/css/*.css` and Playwright E2E that at `1240x900`, `1366x900`, and `1920x1080`, `desktop-catalog-column` (`span 3 / span 3`), `pipeline-column` (`span 4 / span 4`), and `data-column` (`span 5 / span 5`) sum to 12 columns and align on the same top row (`Math.abs(catTop - pipeTop) <= 2` and `Math.abs(pipeTop - dataTop) <= 2`).
   - `src/components/pipeline/PipelineBuilder.tsx:122`: Changed `pipeline-open-catalog-btn` from `xl:hidden` (`1280px`) to `min-[1200px]:hidden` (`1200px`), matching `isDesktopCatalogVisible` so `Browse Catalog` is hidden whenever the inline desktop catalog column is rendered.
   - `tests/e2e/workbench.spec.ts:35-119`: Added Playwright E2E assertions verifying `gridColumn` spans, top-row alignment (`<= 2px`), and `pipeline-open-catalog-btn` visibility across `1920x1080`, `1366x900`, `1240x900`, `768x1024`, and `320x720`.

2. **Reviewer Suggestion 1 / QA `OBS-01` (`README.md:15-19` & `README.md:82` Canonical Operation Summary) — `RESOLVED`**:
   - `README.md:15-19` now lists the exact 28 canonical operations and IDs across the 4 categories (`Encoding & Formats (9)`, `Ciphers & Bitwise (7)`, `Hashing, Checksums & Crypto (7)`, `Text & Byte Analysis (5)`), removing all non-canonical draft names (`Base58`, `ASCII Decimal`, `Unicode Escape`, `ROT47`, `Beaufort`, `Affine`).

3. **Reviewer Suggestion 2 (`src/components/pipeline/Inspector.tsx:59-64, 246-254` Inline `checkJsonPrecisionNotice` Warning) — `RESOLVED`**:
   - `Inspector.tsx` now evaluates `checkJsonPrecisionNotice(utf8Text)` when inspecting a `json` step and renders an inline warning `<StatusMessage testId="inspector-json-precision-warning" />` when integers outside `Number.MAX_SAFE_INTEGER` (`±(2^53 - 1)`) are present, backed by an E2E assertion in `tests/e2e/workbench.spec.ts:212-220`.
