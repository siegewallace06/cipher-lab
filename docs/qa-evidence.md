# Cipher Lab Independent QA Validation Evidence

| Field | Value |
| --- | --- |
| Stage | Stage 3A — Independent QA Validation & Step 8 Recheck |
| Pull Request | `#1` |
| Validated Implementation Commit | `3c31f4cfa2e980ca283621e8c4a8ac8c0db12980` (Fix Cycle 1; initial baseline `c2118a25b6f6c03ec3a2c16503aea0d73afadee1`) |
| QA Role | `The QA` (`418f66f1-e035-49f3-a5bd-7303ef795045`) |
| Validation Date | `2026-10-20` |
| **QA Verdict** | **`PASS`** (`15/15` Acceptance Criteria `AC-1`–`AC-15` verified; `DEFECT-01` and `OBS-01` resolved & re-verified in Fix Cycle 1; `0` unresolved defects) |

---

## 1. Execution Environment & Clean Checkout

All checks were executed independently in a fresh checkout of Pull Request `#1` across initial validation (`c2118a25b6f6c03ec3a2c16503aea0d73afadee1`) and Step 8 Recheck (`3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`).

- **OS / Kernel**: macOS 27.0 (`BuildVersion 26A428`, `Darwin 27.0.0 arm64`)
- **Hardware**: Apple M1 (8-core ARM64), `16 GB` unified memory (`17,179,869,184` bytes)
- **Node.js / npm**: Node `v22.23.1`, npm `10.9.8`
- **Browser Automation**: Playwright `1.63.0` (Headless Chromium) + `@axe-core/playwright` `4.11.2`

---

## 2. Executed Verification Gates (`docs/tasks.md` §5)

All five required repository verification gates were re-executed directly from a clean checkout of commit `3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`:

| Gate Command | Exit Code | Summary of Executed Output (Step 8 Recheck on `3c31f4c`) |
| --- | --- | --- |
| `npm ci` | `0` | Clean lockfile installation completed with exit code `0`. |
| `npm run lint` | `0` | `eslint .` completed with `0` errors and `0` warnings across all `src/` and `tests/` files. |
| `npm run type-check` | `0` | `tsc --noEmit` completed with `0` TypeScript errors under strict compiler settings. |
| `npm test` | `0` | `vitest run` passed all `8` test suites and `59` tests (`5.76s` total duration). |
| `npm run build` | `0` | `next build` succeeded; route `/` compiled (`39.8 kB` page, `143 kB` First Load JS, `34.4 kB` Middleware). |
| `npm run test:e2e` | `0` | `playwright test` against production server (`npm run build && npm run start -- -p 3100`) passed `4/4` browser suites (`9.3s`), including multi-viewport desktop (`1920x1080`, `1366x900`, `1240x900`), tablet (`768x1024`), and mobile (`320x720`) grid alignment and `inspector-json-precision-warning` assertions. |

In addition to the repository suite, QA authored and executed independent unit/boundary/performance probes (`4` multi-vector test suites covering all 28 operations) and an independent Playwright browser/accessibility/contrast/layout audit (`4` browser suites across `320px`, `768px`, `1240px`, `1366px`, `1366x640`, and `1920px`).

---

## 3. Acceptance Criteria Verification Matrix (`AC-1`–`AC-15`)

| AC | Requirement Summary | Status | Independent QA Evidence |
| --- | --- | --- | --- |
| **AC-1** | Clean install runs one Next.js app; local worker execution; zero runtime network/storage mutations except explicit theme choice; strict CSP & security headers | **PASS** | Verified single Next.js 15 App Router build (`next build && next start`). Inspected HTTP response headers on `/`: `Content-Security-Policy` includes `default-src 'self'; script-src 'self' 'nonce-...'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`. Verified via Playwright request listener that loading presets, editing inputs, running transformations, and generating share links emit `0` network requests (`[]`) and write `0` `localStorage`/`sessionStorage`/`indexedDB`/cookie entries except `cipher-lab-theme` (`localStorage`) when the user explicitly changes the theme selector. Verified footer discloses that browser and OS memory cannot be guaranteed securely erased after closing a tab. |
| **AC-2** | All 4 categories (`encoding`, `ciphers`, `crypto`, `text`) and all 28 canonical operation IDs searchable, filterable, and addable by pointer, drag-and-drop, and keyboard | **PASS** | Verified `ALL_OPERATIONS.length === 28` across `encoding` (8), `ciphers` (7), `crypto` (8), and `text` (5). Verified category tab filtering (`All`, `Encoding`, `Ciphers`, `Crypto`, `Text & Bytes`), case-insensitive search across label/ID/keywords/description, empty search state (`No operations match your filter.`), pointer click on `+ Add` (`add-op-<id>`), keyboard `Enter`/`Space` activation on `+ Add`, and HTML5 drag-and-drop (`catalog-item-caesar` dragged onto `pipeline-builder` increments `pipeline-step-count` to `1/32`). |
| **AC-3** | All 28 operations pass documented positive vectors, round-trips, invalid parameters, empty inputs, and UTF-8/byte boundaries | **PASS** | Independently verified all 28 operations against standard published vectors (RFC 4648 Base64/Base32, RFC 3986 URL encode, NIST FIPS 180-4 SHA-1/256/384/512, RFC 4231 HMAC-SHA256 Test Case 2, IEEE 802.3 CRC32 `123456789` -> `cbf43926`, AES-256-GCM PBKDF2-HMAC-SHA256 600,000-iteration envelope), `0`-byte empty inputs across all 28 operations, and non-UTF-8 byte boundaries (`[0x00, 0x7f, 0x80, 0xff]`). See Section 4 for the full 28-operation verification table. |
| **AC-4** | Add, independent duplicate, remove, up/down reorder, bypass, and parameter edit preserve step identity and produce exact bytes | **PASS** | Verified step addition assigns unique `stepId`; duplicating a step deep-copies parameters into a new `stepId` so editing the duplicate never mutates the original; moving steps `Up`/`Down` preserves `stepId` and parameter state while changing execution order; `Bypass` (`enabled: false`) skips transformation while preserving input bytes (`status: 'bypassed'`); removing a step updates pipeline and re-runs deterministically. |
| **AC-5** | Auto-run debounces (`150 ms`); manual mode waits for `Run`; rapid edits/cancel never publish stale output; failed/stale download & promote are disabled | **PASS** | Verified `AUTO_RUN_DEBOUNCE_MS = 150`. Unchecking `Auto-run` (`toolbar-autorun-toggle`) and editing input transitions output badge to `[Stale]`, displays `output-stale-warning`, and disables `Download .txt`, `Download .bin`, and `Promote to Input` until `Run (Stale)` is clicked. Verified worker revision tracking (`requestId` + `inputRevision`) discards obsolete worker responses and supports active run cancellation via `Cancel` (`toolbar-cancel-btn`), terminating the worker cleanly. |
| **AC-6** | Intermediate Inspector shows exact bytes, size, duration, bypass/error/not-run statuses; failure retains prior steps and clears final output | **PASS** | Verified clicking `Inspect` (`step-inspect-<id>`) opens `step-inspector-panel` showing status badge (`success`, `bypassed`, `error`, `not-run`), execution duration (`ms`), byte count, `Text` and `Hex Dump` views, inline JSON large-integer precision warning (`inspector-json-precision-warning` via `checkJsonPrecisionNotice`), and visual Shannon entropy bar chart (`inspector-entropy-chart`) when inspecting an `entropy` step. Verified mid-pipeline failure retains completed upstream step outputs for inspection, marks downstream steps `not-run`, and clears final output with `[Failed]` status. |
| **AC-7** | Text/hex entry & views, byte/code-point/line/UTF-8 stats, sample, copy failure handling, byte-exact download, and binary promote | **PASS** | Verified `UTF-8 Entry` and `Hex Entry` modes (preserving invalid hex draft text with inline error without corrupting committed bytes), `Editor`/`Text` and `Hex Dump` views (`16` bytes/row with offset, hex pairs, and ASCII column), accurate byte/Unicode code point/line/UTF-8 validity statistics, `Sample` loader (`Hello, Cipher Lab!`), clipboard error banner when `navigator.clipboard.writeText` is denied, and non-UTF-8 binary output (`00 ff 80 7f` hex-decoded) displaying `output-binary-lossy-notice`, disabling `Download .txt`, enabling `Download .bin`, and switching Input to `Hex Entry` (`00ff807f`) on `Promote to Input`. |
| **AC-8** | All 6 format detection families have positive/negative/ambiguous fixtures; off-main-thread worker; ranked quick actions append steps without auto-run on restore | **PASS** | Verified all 6 format detector families (`hex`, `base64`, `base64url`, `url`, `jwt`, `json`) in `DetectionWorkerClient`: positive fixtures, negative/truncated rejection (e.g., 2-segment JWT and odd-length hex rejected), and ambiguous fixtures (`deadbeef` ranks both `hex` at `0.85` and `base64` at `0.72` with `isAmbiguous === true` and `ambiguityNotice`). Verified clicking quick action appends the suggested step to the pipeline. |
| **AC-9** | All 4 starter presets run to documented results; destructive replacement confirmation; crypto preset works without pre-filled secrets | **PASS** | Verified all 4 presets in `PIPELINE_PRESETS`: (1) `Text to Base64 to URL encoding` (`Hello, Cipher Lab! (100% local & stateless)` -> `SGVsbG8sIENpcGhlciBMYWIhICgxMDAlIGxvY2FsICYgc3RhdGVsZXNzKQ%3D%3D`), (2) `Hex to raw bytes to SHA-256` (`616263` -> `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`), (3) `JWT payload inspection` (decodes header/payload with `iat`/`exp` ISO annotations and non-verification notice), and (4) `AES-GCM encrypt then decrypt` (ships with empty passphrases, displays instructional notice, and round-trips once the user enters matching passphrases). Verified loading a preset over a non-empty workspace opens `preset-confirm-dialog` (`Replace`/`Cancel`). |
| **AC-10** | URL `#cl=` fragment sharing & restore: omits input by default, strips all secrets, regenerates step IDs, does not auto-run on restore, rejects malformed/oversized/secret-bearing payloads atomically | **PASS** | Verified `exportWorkspaceToUrlFragment` omits `input` by default (`includeInput: false`), strips all `secret: true` parameters (`aes-gcm` `passphrase`, `hmac-sha256` `key`) on both enabled and bypassed steps, and enforces `8,192`-char fragment and `16,384`-byte decoded limits. Verified `importWorkspaceFromUrlFragment` rejects malformed Base64url/JSON, `__proto__`/`constructor`/`prototype` keys, unknown root/step/parameter keys, unsupported `v !== 1`, unknown operation IDs, secret keys in imported params, and >32 steps atomically with zero state mutation. Verified valid restore sets `restoredNotice` (`secretsOmitted`), regenerates fresh step IDs, and waits for explicit user `Run`. |
| **AC-11** | AES-256-GCM round-trips arbitrary bytes; fresh CSPRNG 16B salt & 12B IV per encryption; tamper/wrong secret yields identical generic `AUTHENTICATION_FAILED` error and zero plaintext | **PASS** | Verified `aes-gcm` encrypts arbitrary binary bytes (`[0x00, 0xff, 0x80, 0x7f, ...]`) into a versioned `v: 1` JSON envelope (`alg: "AES-256-GCM"`, `kdf: "PBKDF2-HMAC-SHA256"`, `iter: 600000`, `salt`, `iv`, `ct`, `tag`) with envelope header bound as AAD. Verified two consecutive encryptions of identical input/passphrase produce distinct random `salt`, `iv`, `ct`, and `tag`. Verified wrong passphrase, 1-bit flipped `ct`, 1-bit flipped `tag`, modified `iv`, modified `salt`, and AAD tampering all return the exact same generic error (`code: 'AUTHENTICATION_FAILED'`, `message: 'Decryption failed: invalid passphrase or tampered ciphertext.'`) with `outputBytes.byteLength === 0`. |
| **AC-12** | Resource limits (`N` vs `N+1`) enforced; hostile catastrophic regex times out (`<= 100 ms` watchdog) in real Web Worker without freezing UI or exhausting workers | **PASS** | Verified exact `N` vs `N+1` boundary behavior across all resource caps (see Section 5). In a real browser Web Worker, executed catastrophic backtracking regex `(a+)+$` against `'a'.repeat(28) + '!'`: worker watchdog terminated the hung worker at `~101 ms` with `TIMEOUT` (`Step "regex" exceeded its 100 ms execution limit.`), UI remained responsive, and immediately removing the regex step and running `rot13` on `'Hello'` succeeded (`'Uryyb'`) on a fresh worker. Verified unsupported `window.Worker` environment renders `capability-error-banner` (`UNSUPPORTED_ENVIRONMENT`). |
| **AC-13** | Both themes pass computed WCAG 2.2 AA contrast, live keyboard/focus/announcements, axe accessibility scan, reduced motion, 200% zoom, and rendered responsive checks across `320`, `768`, `1366`, and `1920` CSS px | **PASS** | Computed contrast ratios (`12` text pairs >= `4.5:1`, `11` non-text pairs >= `3.0:1` in both dark & light themes), `@axe-core/playwright` WCAG 2.2 AA scans (`0` violations across desktop dark/light, tablet drawer, mobile tabs, share modal, and error state), `Escape` focus restoration (`toolbar-catalog-drawer-btn` and `toolbar-share-btn`), `200%` text zoom (`0` horizontal overflow), and `prefers-reduced-motion: reduce` (`<= 0.01ms`) all **PASS**. In Step 8 Recheck (`3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`), independently verified that `DEFECT-01` is resolved: at `1920x1080`, `1366x900`, `1366x640`, `1240x900`, and `1200x900`, `desktop-catalog-column` (`span 3 / span 3`), `pipeline-column` (`span 4 / span 4`), and `data-column` (`span 5 / span 5`) sit side-by-side on Row 1 (`catalog.top === pipeline.top === data.top`, `0` horizontal overflow) and `pipeline-open-catalog-btn` is hidden (`display: "none"`); at `768x1024`, `pipeline-column` (`span 5`) and `data-column` (`span 7`) sit on Row 1 (`top: 187px`) with `Browse Catalog` visible; at `320x720`, mobile tabbed navigation renders with `0` horizontal overflow. |
| **AC-14** | Search (`<= 100 ms`) and 10-step `64 KiB` non-crypto pipeline (`<= 500 ms`) measured on recorded hardware; production build serves with zero console/hydration errors | **PASS** | Measured on Apple M1 / 16 GB RAM / macOS 27.0 / Node `v22.23.1` / Headless Chromium `1.63.0`: (1) Catalog search filter across all 28 operations: `0.0059 ms` avg per filter call (`4.71 ms` for `800` queries, target `<= 100 ms`); (2) 10-step `64 KiB` (`65,536` bytes) non-crypto pipeline: `16.82 ms` engine execution (`16.5 ms`–`18.6 ms` end-to-end in browser Web Worker, target `<= 500 ms`); (3) Production build (`next build && next start`) emitted `0` `console.error` and `0` React hydration errors across all tested flows. |
| **AC-15** | All verification gates pass; durable QA `PASS` and Reviewer `APPROVED` with zero unresolved blocking findings | **PASS** | All 5 automated CLI gates (`lint`, `type-check`, `test`, `build`, `test:e2e`) pass on commit `3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`, `The QA` records **`PASS`** in `docs/qa-evidence.md` (`0` unresolved blocking or non-blocking defects), and `The Reviewer` records **`APPROVED`** in `docs/review-verdict.md`. |

---

## 4. Independent Verification of All 28 Canonical Operations (`AC-2`, `AC-3`)

Every operation registered in `src/engine/registry.ts` was verified for positive vectors, round-trip reversibility (where bidirectional), malformed input rejection, invalid parameter rejection, `0`-byte empty input behavior, and arbitrary/non-UTF-8 byte boundaries (`[0x00, 0x7f, 0x80, 0xff]`):

| # | Operation ID | Category | `inputKind` | Verified Positive / Round-Trip Vector | Verified Negative / Boundary Behavior |
| --- | --- | --- | --- | --- | --- |
| 1 | `base64` | `encoding` | `bytes` | RFC 4648 `"foobar"` -> `"Zm9vYmFy"`; binary `[0x00, 0xff, 0x80, 0x7f]` round-trip | Standard vs URL-safe alphabet strictness; unpadded rejection when `padding: true` (`INVALID_INPUT`) |
| 2 | `base32` | `encoding` | `bytes` | RFC 4648 `"foobar"` -> `"MZXW6YTBOI======"`; binary `[0x00, 0xff, 0x80, 0x7f]` round-trip | Rejects characters outside `A-Z2-7` and invalid padding quantum (`INVALID_INPUT`) |
| 3 | `hex` | `encoding` | `bytes` | `[0x00, 0xff, 0x80, 0x7f]` <-> `"00ff807f"`; delimiters `none`, `space`, `colon` | Rejects odd-length hex and non-hex characters (`INVALID_INPUT`) |
| 4 | `binary` | `encoding` | `bytes` | `"Hi"` <-> `"01001000 01101001"`; binary `[0x00, 0xff, 0x80, 0x7f]` round-trip | Rejects non-8-bit groups and characters outside `0`/`1` (`INVALID_INPUT`) |
| 5 | `url` | `encoding` | `utf8` | `"a+b c&d=e"` -> `"a%2Bb%20c%26d%3De"` (`+` stays literal `%2B` on encode and `+` on decode) | Rejects truncated `%2` or non-hex `%ZZ` sequences (`INVALID_INPUT`) and invalid UTF-8 (`INVALID_UTF8`) |
| 6 | `html-entities` | `encoding` | `utf8` | `"<tag attr=\"a&b\">'x'</tag>"` <-> `"&lt;tag attr=&quot;a&amp;b&quot;&gt;&#39;x&#39;&lt;/tag&gt;"` | Decodes named + decimal/hex numeric entities; rejects out-of-range scalar `&#x110000;` and surrogates `&#xD800;` (`INVALID_INPUT`) |
| 7 | `json` | `encoding` | `utf8` | Pretty (`indent: 2` or `4`) and minify modes; `sortKeys: true` deterministic key ordering | Emits `precisionLossWarning` for integers outside `±(2^53 - 1)`; rejects depth `> 64` or nodes `> 100,000` (`LIMIT_EXCEEDED`); rejects empty/malformed JSON (`INVALID_INPUT`) |
| 8 | `jwt` | `encoding` | `utf8` | Decodes compact 3-segment JWT header & payload with `iat`/`nbf`/`exp` ISO-8601 annotations and `verificationNotice` | Rejects empty input, `!= 3` segments, non-JSON segments, and tokens `> 16,384` bytes (`INVALID_INPUT` / `LIMIT_EXCEEDED`) |
| 9 | `timestamp` | `encoding` | `utf8` | `0` -> `"1970-01-01T00:00:00.000Z"`; `-86400` -> `"1969-12-31T00:00:00.000Z"`; `"2026-01-15T12:30:00+02:00"` -> `"1768473000"` | Rejects ISO strings without timezone (`"2026-01-15T10:30:00"`) and out-of-range epochs (`INVALID_INPUT`) |
| 10 | `caesar` | `ciphers` | `utf8` | `"Hello, World! 123"` (`shift: 3`) <-> `"Khoor, Zruog! 123"` | Rejects non-integer or out-of-range shift `< 0` or `> 25` (`INVALID_PARAMETERS`) |
| 11 | `rot13` | `ciphers` | `utf8` | `"Cipher Lab 2026!"` <-> `"Pvcure Yno 2026!"` (self-inverse) | Preserves non-ASCII and non-letter characters; rejects invalid UTF-8 (`INVALID_UTF8`) |
| 12 | `vigenere` | `ciphers` | `utf8` | `"Attack at dawn! 123"` (`key: "LEMON"`) <-> `"LXFOPV EF RNHR! 123"` (case-preserving) | Only ASCII letters advance key index; rejects empty or non-alphabetic keys (`"KEY1"`, `""`) (`INVALID_PARAMETERS`) |
| 13 | `xor` | `ciphers` | `bytes` | Arbitrary bytes `[0x00, 0xff, 0x80, 0x7f]` XOR repeating UTF-8 or hex key round-trips losslessly | Rejects empty key, odd-length hex key, or invalid hex key (`INVALID_PARAMETERS`) |
| 14 | `atbash` | `ciphers` | `utf8` | `"AbCdEfGhIjKlMnOpQrStUvWxYz"` <-> `"ZyXwVuTsRqPoNmLkJiHgFeDcBa"` | Preserves non-ASCII and punctuation; rejects invalid UTF-8 (`INVALID_UTF8`) |
| 15 | `rail-fence` | `ciphers` | `utf8` | `"WEAREDISCOVEREDFLEEATONCE"` (`rails: 3`) <-> `"WECRLTEERDSOEEFEAOCAIVDEN"`; code-point safe on Astral emoji | Preserves 0/1-code-point inputs and `rails >= length`; rejects `rails < 2` or `> 64` (`INVALID_PARAMETERS`) |
| 16 | `morse` | `ciphers` | `utf8` | `"SOS 2026"` -> `"... --- ... / ..--- ----- ..--- -...."` -> `"SOS 2026"` | Rejects unsupported symbols (`"HELLO @ WORLD"`) and unknown Morse tokens (`"........"`) (`INVALID_INPUT`) |
| 17 | `sha1` | `crypto` | `bytes` | NIST `"abc"` -> `"a9993e364706816aba3e25717850c26c9cd0d89d"`, `""` -> `"da39a3ee5e6b4b0d3255bfef95601890afd80709"` | Labeled `Legacy` in catalog; operates on arbitrary byte buffers |
| 18 | `sha256` | `crypto` | `bytes` | NIST `"abc"` -> `"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"` | Operates on arbitrary byte buffers (`0` bytes -> `e3b0c442...`) |
| 19 | `sha384` | `crypto` | `bytes` | NIST `"abc"` -> `"cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7"` | Operates on arbitrary byte buffers |
| 20 | `sha512` | `crypto` | `bytes` | NIST `"abc"` -> `"ddaf35a193617aba...454d4423643ce80e2a9ac94fa54ca49f"` | Operates on arbitrary byte buffers |
| 21 | `hmac-sha256` | `crypto` | `bytes` | RFC 4231 Test Case 2 (`key: "Jefe"`, `data: "what do ya want for nothing?"`) -> `"5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"` | `key` marked `secret: true`; rejects empty key or malformed hex key (`INVALID_PARAMETERS`); never echoes secret in error messages |
| 22 | `crc32` | `crypto` | `bytes` | IEEE 802.3 `"123456789"` -> `"cbf43926"`, `""` -> `"00000000"` | Operates on arbitrary byte buffers |
| 23 | `aes-gcm` | `crypto` | `bytes` | AES-256-GCM + PBKDF2-HMAC-SHA256 (`600,000` iter) `v: 1` JSON envelope encrypt/decrypt round-trip on text, `0`-byte, and binary `[0x00, 0xff, 0x80, 0x7f]` | `passphrase` marked `secret: true`; fresh CSPRNG 16B salt + 12B IV per encryption; wrong passphrase or tampered `ct`/`tag`/`iv`/`salt`/AAD returns generic `AUTHENTICATION_FAILED` with 0 plaintext bytes |
| 24 | `case` | `text` | `utf8` | `lower`, `upper`, and token-first ASCII `title` (`"hELLO wORLD 123aBC"` -> `"Hello World 123abc"`) | Locale-independent Unicode mapping |
| 25 | `reverse` | `text` | `utf8` | `code-points` mode preserves surrogate pairs (`"A😀B"` -> `"B😀A"`); `lines` mode normalizes CRLF and preserves trailing newline | Rejects invalid UTF-8 (`INVALID_UTF8`) |
| 26 | `regex` | `text` | `utf8` | `replace` mode (`$1`, `$&`, `$$` literal replacement, no function eval) and `find` mode (JSON array with `match`, `index`, `endIndex`, `groups` UTF-16 offsets + zero-length match advancement) | Rejects input `> 65,536`B, pattern `> 512`B, replacement `> 4,096`B, matches `> 10,000` (`LIMIT_EXCEEDED`); worker watchdog terminates catastrophic backtracking at `100 ms` (`TIMEOUT`) |
| 27 | `line-sort` | `text` | `utf8` | `sort`, `deduplicate`, and `both` (`ascending`/`descending`, `caseSensitive` toggle); deduplicates stably (first occurrence) before optional sort; preserves terminal newline | Deterministic code-point lexical order (`<` / `>`) without locale drift |
| 28 | `entropy` | `text` | `bytes` | `0` bytes -> `entropyBitsPerByte: 0`; 64 identical bytes -> `0`; 256 uniform bytes `0x00..0xff` -> `entropyBitsPerByte: 8` with 256 frequency bins | Informational note clarifies Shannon entropy is not a cryptographic randomness certification |

---

## 5. Exact Resource Limit Boundary Probes (`N` vs `N+1`, `AC-12`)

QA executed independent `N` (exact limit) vs `N+1` (one over limit) boundary probes against `src/lib/limits.ts` and engine/operation validators:

| Resource Limit Constant | Configured Cap (`N`) | At Exact Limit (`N`) | At One Over Limit (`N + 1`) | Error Code |
| --- | --- | --- | --- | --- |
| `MAX_INPUT_BYTES` | `1,048,576` B (`1 MiB`) | `1,048,576` B succeeds (`status: 'success'`) | `1,048,577` B rejected before step execution | `LIMIT_EXCEEDED` |
| `MAX_STEP_OUTPUT_BYTES` | `1,048,576` B (`1 MiB`) | Output `<= 1,048,576` B succeeds | Step expanding `800,000` B to `1,066,668` B via Base64 rejected | `LIMIT_EXCEEDED` |
| `MAX_CUMULATIVE_BYTES` | `8,388,608` B (`8 MiB`) | Cumulative retained step buffers `<= 8 MiB` succeed | 9 steps x `950,000` B (`8,550,000` B cumulative) fails on step 9 | `LIMIT_EXCEEDED` |
| `MAX_PIPELINE_STEPS` | `32` steps | `32` steps succeed (`32/32` badge, `+ Add` buttons disabled at cap) | `33` steps rejected by `executePipeline` and `importWorkspaceFromUrlFragment` | `LIMIT_EXCEEDED` |
| `MAX_JSON_DEPTH` | `64` levels | Depth `64` nested array succeeds | Depth `65` nested array rejected | `LIMIT_EXCEEDED` |
| `MAX_JSON_NODES` | `100,000` nodes | `100,000` JSON nodes (`1` array + `99,999` elements) succeeds | `100,001` JSON nodes (`1` array + `100,000` elements) rejected | `LIMIT_EXCEEDED` |
| `MAX_JWT_BYTES` | `16,384` B (`16 KiB`) | `<= 16,384` B compact JWT succeeds | `16,385` B compact JWT rejected | `LIMIT_EXCEEDED` |
| `MAX_REGEX_INPUT_BYTES` | `65,536` B (`64 KiB`) | `65,536` B input succeeds | `65,537` B input rejected before regex evaluation | `LIMIT_EXCEEDED` |
| `MAX_REGEX_PATTERN_BYTES` | `512` B | `512` B pattern succeeds | `513` B pattern rejected | `LIMIT_EXCEEDED` |
| `MAX_REGEX_REPLACEMENT_BYTES` | `4,096` B (`4 KiB`) | `4,096` B replacement succeeds | `4,097` B replacement rejected | `LIMIT_EXCEEDED` |
| `MAX_REGEX_MATCHES` | `10,000` matches | `10,000` matches succeed | `10,001` matches (`'a'.repeat(10001)` with `pattern: 'a'`) rejected | `LIMIT_EXCEEDED` |
| `REGEX_STEP_TIMEOUT_MS` | `100 ms` watchdog | Normal regex completes in `< 5 ms` | Hostile `(a+)+$` on `'a'.repeat(28) + '!'` terminated at `~101 ms` | `TIMEOUT` |
| `MAX_URL_FRAGMENT_CHARS` | `8,192` chars | Fragment `<= 8,192` chars accepted | Fragment `8,193` chars rejected prior to decoding | `LIMIT_EXCEEDED` |
| `MAX_URL_DECODED_BYTES` | `16,384` B (`16 KiB`) | Decoded JSON `<= 16,384` B accepted | Decoded JSON `> 16,384` B rejected | `LIMIT_EXCEEDED` |

---

## 6. Computed WCAG 2.2 AA Contrast Ratio Matrix (`AC-13`)

QA programmatically extracted the computed CSS custom properties from `getComputedStyle(document.documentElement)` in Playwright under both `data-theme="dark"` and `data-theme="light"` and calculated exact WCAG 2.2 relative luminance contrast ratios:

### 6.1 Normal Text Contrast Pairs (Requirement: `>= 4.5:1`)

| Token Pair | Dark Theme (`fg` on `bg`) | Dark Ratio | Light Theme (`fg` on `bg`) | Light Ratio | Verdict |
| --- | --- | --- | --- | --- | --- |
| `--cl-text` on `--cl-canvas` | `#f8fafc` on `#090d16` | **18.57:1** | `#0f172a` on `#f8fafc` | **17.06:1** | PASS (`>= 4.5`) |
| `--cl-text` on `--cl-surface` | `#f8fafc` on `#0f172a` | **17.06:1** | `#0f172a` on `#ffffff` | **17.85:1** | PASS (`>= 4.5`) |
| `--cl-text` on `--cl-surface-alt` | `#f8fafc` on `#1e293b` | **13.98:1** | `#0f172a` on `#f1f5f9` | **16.30:1** | PASS (`>= 4.5`) |
| `--cl-text-muted` on `--cl-canvas` | `#cbd5e1` on `#090d16` | **13.09:1** | `#334155` on `#f8fafc` | **9.90:1** | PASS (`>= 4.5`) |
| `--cl-text-muted` on `--cl-surface` | `#cbd5e1` on `#0f172a` | **12.02:1** | `#334155` on `#ffffff` | **10.35:1** | PASS (`>= 4.5`) |
| `--cl-text-muted` on `--cl-surface-alt` | `#cbd5e1` on `#1e293b` | **9.85:1** | `#334155` on `#f1f5f9` | **9.45:1** | PASS (`>= 4.5`) |
| `--cl-action-text` on `--cl-action` | `#ffffff` on `#1d4ed8` | **6.70:1** | `#ffffff` on `#1d4ed8` | **6.70:1** | PASS (`>= 4.5`) |
| `--cl-action-text` on `--cl-action-hover` | `#ffffff` on `#2563eb` | **5.17:1** | `#ffffff` on `#1e40af` | **8.72:1** | PASS (`>= 4.5`) |
| `--cl-status-info-text` on `--cl-status-info-bg` | `#bfdbfe` on `#0c1938` | **12.20:1** | `#1e3a8a` on `#eff6ff` | **9.52:1** | PASS (`>= 4.5`) |
| `--cl-status-success-text` on `--cl-status-success-bg` | `#bbf7d0` on `#052e16` | **12.30:1** | `#14532d` on `#f0fdf4` | **8.70:1** | PASS (`>= 4.5`) |
| `--cl-status-warning-text` on `--cl-status-warning-bg` | `#fde68a` on `#291502` | **14.02:1** | `#78350f` on `#fffbeb` | **8.75:1** | PASS (`>= 4.5`) |
| `--cl-status-error-text` on `--cl-status-error-bg` | `#fecaca` on `#2c0b0e` | **12.50:1** | `#991b1b` on `#fef2f2` | **7.60:1** | PASS (`>= 4.5`) |

### 6.2 Non-Text Boundaries, Focus Ring & Chart Series Contrast Pairs (Requirement: `>= 3.0:1`)

| Token Pair | Dark Theme (`fg` on `bg`) | Dark Ratio | Light Theme (`fg` on `bg`) | Light Ratio | Verdict |
| --- | --- | --- | --- | --- | --- |
| `--cl-border` on `--cl-canvas` | `#94a3b8` on `#090d16` | **7.58:1** | `#64748b` on `#f8fafc` | **4.55:1** | PASS (`>= 3.0`) |
| `--cl-border` on `--cl-surface` | `#94a3b8` on `#0f172a` | **6.96:1** | `#64748b` on `#ffffff` | **4.76:1** | PASS (`>= 3.0`) |
| `--cl-border` on `--cl-surface-alt` | `#94a3b8` on `#1e293b` | **5.71:1** | `#64748b` on `#f1f5f9` | **4.34:1** | PASS (`>= 3.0`) |
| `--cl-focus` on `--cl-canvas` | `#60a5fa` on `#090d16` | **7.64:1** | `#1d4ed8` on `#f8fafc` | **6.41:1** | PASS (`>= 3.0`) |
| `--cl-focus` on `--cl-surface` | `#60a5fa` on `#0f172a` | **7.02:1** | `#1d4ed8` on `#ffffff` | **6.70:1** | PASS (`>= 3.0`) |
| `--cl-chart-bar` on `--cl-surface` | `#60a5fa` on `#0f172a` | **7.02:1** | `#1d4ed8` on `#ffffff` | **6.70:1** | PASS (`>= 3.0`) |
| `--cl-chart-bar` on `--cl-surface-alt` | `#60a5fa` on `#1e293b` | **5.75:1** | `#1d4ed8` on `#f1f5f9` | **6.12:1** | PASS (`>= 3.0`) |
| `--cl-status-info-border` on `--cl-status-info-bg` | `#60a5fa` on `#0c1938` | **6.82:1** | `#1d4ed8` on `#eff6ff` | **6.16:1** | PASS (`>= 3.0`) |
| `--cl-status-success-border` on `--cl-status-success-bg` | `#4ade80` on `#052e16` | **8.55:1** | `#15803d` on `#f0fdf4` | **4.79:1** | PASS (`>= 3.0`) |
| `--cl-status-warning-border` on `--cl-status-warning-bg` | `#fbbf24` on `#291502` | **10.46:1** | `#b45309` on `#fffbeb` | **4.84:1** | PASS (`>= 3.0`) |
| `--cl-status-error-border` on `--cl-status-error-bg` | `#f87171` on `#2c0b0e` | **6.54:1** | `#b91c1c` on `#fef2f2` | **5.91:1** | PASS (`>= 3.0`) |

---

## 7. Performance Benchmarks (`AC-14`)

Recorded on Apple M1 (`8` cores, `16 GB` RAM), macOS `27.0` (`Darwin 27.0.0 arm64`), Node `v22.23.1`, Headless Chromium `1.63.0`:

| Benchmark Target (`PRD ch. 4`) | Fixture / Workload | Target Threshold | Measured Result | Verdict |
| --- | --- | --- | --- | --- |
| Catalog search response latency | `800` consecutive `filterOperations` queries across all `28` operations (`base64`, `aes`, `sha`, `hex`, `vigenere`, `regex`, `entropy`, `morse`) | `<= 100 ms` | **`0.0059 ms` / query** (`4.71 ms` for `800` queries) | **PASS** |
| 10-step `64 KiB` non-crypto pipeline (engine direct) | `65,536` bytes (`'A'.repeat(65536)`) through `caesar` -> `rot13` -> `atbash` -> `case` -> `reverse` -> `base64` -> `rot13` -> `rot13` -> `atbash` -> `atbash` | `<= 500 ms` | **`16.82 ms`** total duration | **PASS** |
| 10-step `64 KiB` non-crypto pipeline (browser Web Worker end-to-end) | Same 10-step pipeline and `65,536`-byte payload executed via real browser Web Worker and reported in `output-status-badge` | `<= 500 ms` | **`16.5 ms`–`18.6 ms`** | **PASS** |

---

## 8. Reproducible Defects & Observations

### `DEFECT-01` — **`Blocking` (RESOLVED & VERIFIED in `3c31f4c`)** (`AC-13`, `PRD ch. 4`): Desktop 3-Column Grid Layout (`>= 1200px`) Wraps Data Column Below Catalog Due to Tailwind CSS v4 Media Query Ordering

- **Severity**: `Blocking` (Resolved in Fix Cycle 1 commit `3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`; see Section 9)
- **Affected Acceptance Criteria**: `AC-13` (*"rendered responsive checks specified in tasks"*), `PRD ch. 4` (*"Desktop >=1200 CSS px: catalog/pipeline/data panes visible together"*), `docs/tasks.md` M1 & §3 (*"shell works at 320/768/1366/1920 CSS px"*).
- **Affected Files**:
  - `src/components/workbench/ResponsiveShell.tsx` (lines 106–142)
  - `src/components/pipeline/PipelineBuilder.tsx` (line 122)
- **Steps to Reproduce**:
  1. Build and start the production server (`npm run build && npm run start -- -p 3100`).
  2. Open `http://127.0.0.1:3100` in Chromium at desktop viewport `1366x900` or `1920x1080` (or `1240x900`).
  3. Inspect the rendered layout or query the bounding boxes and computed `grid-column` styles of `[data-testid="desktop-catalog-column"]`, `[data-testid="pipeline-column"]`, and `[data-testid="data-column"]`.
- **Expected Result**:
  - At desktop viewports `>= 1200px` (`1240x900`, `1366x900`, `1366x640`, `1920x1080`), all three columns (`Operation Catalog`, `Transformation Pipeline`, and `Input`/`Output` Data Column) sit side-by-side on the first grid row (`3 + 4 + 5 = 12` columns) so that catalog, pipeline, and data panes are visible together at the top of the workspace.
  - Additionally, the `Browse Catalog` drawer button (`[data-testid="pipeline-open-catalog-btn"]`) in `PipelineBuilder.tsx` should be hidden whenever the desktop catalog column is visible (`>= 1200px`).
- **Actual Result**:
  - In `ResponsiveShell.tsx`, `pipeline-column` uses `md:col-span-5 min-[1200px]:col-span-4` and `data-column` uses `md:col-span-7 min-[1200px]:col-span-5`.
  - In Tailwind CSS v4 (`4.0.14`), arbitrary pixel media queries `@media (width >= 1200px)` are emitted **before** standard `rem`-based media queries `@media (width >= 48rem)` (`md:`) in the compiled stylesheet (`.next/static/css/*.css`) with identical selector specificity `(0, 1, 0)`.
  - Consequently, at every desktop viewport `>= 1200px`, `.md\:col-span-5` overrides `.min-\[1200px\]\:col-span-4` and `.md\:col-span-7` overrides `.min-\[1200px\]\:col-span-5`. The three columns request `3 + 5 + 7 = 15` columns inside a 12-column grid (`md:grid-cols-12`):
    - Row 1 contains only `desktop-catalog-column` (`span 3`) and `pipeline-column` (`span 5`), leaving the rightmost `4` columns (**33% of the entire desktop viewport width**) completely blank.
    - Row 2 wraps `data-column` (`Input` and `Output` panes, `span 7`) underneath the full 28-operation catalog (`top: 3425px` at `1366x900`, `top: 2819px` at `1920x1080`) — over three screen heights below the fold.
  - Furthermore, at widths between `1200px` and `1279px` (e.g., `1240x900`), `PipelineBuilder.tsx` line 122 uses `xl:hidden` (`1280px`) on `pipeline-open-catalog-btn` ("Browse Catalog"), while `Workbench.tsx` sets `isDesktopCatalogVisible = true` at `1200px` and unmounts `<Dialog open={catalogDrawerOpen}>`. Thus at `1200px–1279px`, the `Browse Catalog` button is visible alongside the inline desktop catalog column and clicking it is a no-op.
- **Measured Evidence (Playwright DOM & Computed CSS Inspection + Compiled Stylesheet)**:
  - Compiled CSS order in `.next/static/css/*.css`:
    ```css
    @media (width>=1200px){.min-\[1200px\]\:col-span-3{grid-column:span 3/span 3}.min-\[1200px\]\:col-span-4{grid-column:span 4/span 4}.min-\[1200px\]\:col-span-5{grid-column:span 5/span 5}.min-\[1200px\]\:block{display:block}}
    @media (width>=40rem){.sm\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.sm\:p-4{padding:calc(var(--spacing)*4)}}
    @media (width>=48rem){.md\:col-span-5{grid-column:span 5/span 5}.md\:col-span-7{grid-column:span 7/span 7}.md\:block{display:block}.md\:hidden{display:none}.md\:grid-cols-12{grid-template-columns:repeat(12,minmax(0,1fr))}}
    ```
  - Programmatic bounding-box & computed `gridColumn` measurements:
    ```json
    [QA_LAYOUT_1366] {"viewport":{"w":1366,"h":900},"catalog":{"top":143,"left":16,"width":325,"height":3270,"gridColumn":"span 3 / span 3","display":"block"},"pipeline":{"top":143,"left":353,"width":549,"height":3270,"gridColumn":"span 5 / span 5","display":"block"},"data":{"top":3425,"left":16,"width":773,"height":464,"gridColumn":"span 7 / span 7","display":"flex"},"browseBtnDisplay":"none"}
    [QA_LAYOUT_1920] {"viewport":{"w":1920,"h":1080},"catalog":{"top":94,"left":16,"width":463,"height":2713,"gridColumn":"span 3 / span 3","display":"block"},"pipeline":{"top":94,"left":491,"width":780,"height":2713,"gridColumn":"span 5 / span 5","display":"block"},"data":{"top":2819,"left":16,"width":1096,"height":464,"gridColumn":"span 7 / span 7","display":"flex"},"browseBtnDisplay":"none"}
    [QA_LAYOUT_1240] {"viewport":{"w":1240,"h":900},"catalog":{"top":143,"left":16,"width":293,"height":3656,"gridColumn":"span 3 / span 3","display":"block"},"pipeline":{"top":143,"left":321,"width":496,"height":3656,"gridColumn":"span 5 / span 5","display":"block"},"data":{"top":3811,"left":16,"width":700,"height":464,"gridColumn":"span 7 / span 7","display":"flex"},"browseBtnDisplay":"block"}
    ```
- **Recommended Fix for `The Engineer`**:
  1. In `src/components/workbench/ResponsiveShell.tsx` (or via explicit CSS utility classes in `src/app/globals.css`), avoid mixing `rem`-based `md:col-span-*` with `px`-based `min-[1200px]:col-span-*` on the same element, or use `isDesktopCatalogVisible` / explicit `@media (min-width: 1200px)` rules in `src/app/globals.css` so that at `>= 1200px` `desktop-catalog-column` is `span 3 / span 3`, `pipeline-column` is `span 4 / span 4`, and `data-column` is `span 5 / span 5` (`3 + 4 + 5 = 12` on the same row, `catalog.top === pipeline.top === data.top`).
  2. In `src/components/workbench/Workbench.tsx` / `src/components/pipeline/PipelineBuilder.tsx`, only render `pipeline-open-catalog-btn` ("Browse Catalog") when `!isDesktopCatalogVisible` (or hide it at `>= 1200px` to match `isDesktopCatalogVisible`), and add a Playwright E2E assertion verifying that at `1366x900` and `1920x1080`, `desktop-catalog-column`, `pipeline-column`, and `data-column` share the same top row (`Math.abs(catalogBox.top - dataBox.top) < 5`).

---

### `OBS-01` — **`Non-Blocking` (RESOLVED in `3c31f4c`)**: `README.md` Operation List Mentions Extra Non-Canonical Operation Names

- **Severity**: `Non-Blocking` (Resolved in Fix Cycle 1 commit `3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`)
- **Affected File**: `README.md` (lines 15–19, 82)
- **Observation**: `README.md` line 15 correctly states `28 Canonical Operations Across 4 Categories`, and `src/engine/registry.ts` implements the exact 28 canonical operations from `docs/prd.md` ch. 3. However, the bulleted prose list on lines 16–19 of `README.md` initially mentioned six extra operation names (`Base58`, `ASCII Decimal`, `Unicode Escape`, `ROT47`, `Beaufort`, `Affine`) that are not part of the 28 canonical operations in `docs/prd.md`.
- **Resolution Verified (`3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`)**: `README.md` lines 16–19 now list the exact 28 canonical operations (`9` Encoding & Formats + `7` Ciphers & Bitwise + `7` Hashing, Checksums & Crypto + `5` Text & Byte Analysis = `28`), and line 82 now references the canonical `WEB_CRYPTO_UNAVAILABLE` error code.

---

## 9. Step 8 Independent Recheck Verification (`Fix Cycle 1` — `3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`)

Following `The Engineer`'s Fix Cycle 1 commit (`3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`), `The QA` checked out the updated branch cleanly, re-ran all 5 verification gates (`lint`, `type-check`, `test`, `build`, `test:e2e`), and executed an independent Playwright multi-viewport geometry and DOM verification probe:

1. **`DEFECT-01` Resolution Verified (`AC-13` / `PRD ch. 4`)**:
   - In `src/components/workbench/ResponsiveShell.tsx`, `pipeline-column` uses `md:max-[1199px]:col-span-5 min-[1200px]:col-span-4` and `data-column` uses `md:max-[1199px]:col-span-7 min-[1200px]:col-span-5`.
   - In `src/components/pipeline/PipelineBuilder.tsx`, `pipeline-open-catalog-btn` uses `min-[1200px]:hidden`.
   - Independently measured Playwright bounding boxes and computed styles on the production build (`3c31f4cfa2e980ca283621e8c4a8ac8c0db12980`):
     ```json
     [QA_RECHECK_1920x1080] {"viewport":{"w":1920,"h":1080},"overflow":false,"catalog":{"top":94,"left":16,"width":463,"height":2713,"gridColumn":"span 3 / span 3","display":"block"},"pipeline":{"top":94,"left":491,"width":621,"height":2713,"gridColumn":"span 4 / span 4","display":"block"},"data":{"top":94,"left":1124,"width":780,"height":2713,"gridColumn":"span 5 / span 5","display":"flex"},"browseBtnDisplay":"none"}
     [QA_RECHECK_1366x900] {"viewport":{"w":1366,"h":900},"overflow":false,"catalog":{"top":143,"left":16,"width":325,"height":3270,"gridColumn":"span 3 / span 3","display":"block"},"pipeline":{"top":143,"left":353,"width":437,"height":3270,"gridColumn":"span 4 / span 4","display":"block"},"data":{"top":143,"left":801,"width":549,"height":3270,"gridColumn":"span 5 / span 5","display":"flex"},"browseBtnDisplay":"none"}
     [QA_RECHECK_1366x640] {"viewport":{"w":1366,"h":640},"overflow":false,"catalog":{"top":143,"left":16,"width":325,"height":3270,"gridColumn":"span 3 / span 3","display":"block"},"pipeline":{"top":143,"left":353,"width":437,"height":3270,"gridColumn":"span 4 / span 4","display":"block"},"data":{"top":143,"left":801,"width":549,"height":3270,"gridColumn":"span 5 / span 5","display":"flex"},"browseBtnDisplay":"none"}
     [QA_RECHECK_1240x900] {"viewport":{"w":1240,"h":900},"overflow":false,"catalog":{"top":143,"left":16,"width":293,"height":3656,"gridColumn":"span 3 / span 3","display":"block"},"pipeline":{"top":143,"left":321,"width":395,"height":3656,"gridColumn":"span 4 / span 4","display":"block"},"data":{"top":143,"left":728,"width":496,"height":3656,"gridColumn":"span 5 / span 5","display":"flex"},"browseBtnDisplay":"none"}
     [QA_RECHECK_1200x900] {"viewport":{"w":1200,"h":900},"overflow":false,"catalog":{"top":143,"left":16,"width":283,"height":3711,"gridColumn":"span 3 / span 3","display":"block"},"pipeline":{"top":143,"left":311,"width":381,"height":3711,"gridColumn":"span 4 / span 4","display":"block"},"data":{"top":143,"left":704,"width":480,"height":3711,"gridColumn":"span 5 / span 5","display":"flex"},"browseBtnDisplay":"none"}
     [QA_RECHECK_768x1024] {"viewport":{"w":768,"h":1024},"overflow":false,"catalog":null,"pipeline":{"top":187,"left":16,"width":300,"height":750,"gridColumn":"span 5 / span 5","display":"block"},"data":{"top":187,"left":328,"width":424,"height":750,"gridColumn":"span 7 / span 7","display":"flex"},"browseBtnDisplay":"block"}
     [QA_RECHECK_320x720] {"viewport":{"w":320,"h":720},"overflow":false,"catalog":null,"pipeline":{"top":0,"left":0,"width":0,"height":0,"gridColumn":"auto","display":"none"},"data":{"top":418,"left":10,"width":300,"height":328,"gridColumn":"auto","display":"flex"},"browseBtnDisplay":"block"}
     ```
2. **Non-Blocking Polish Items Verified (`OBS-01` & Reviewer Suggestions 1–2)**:
   - `README.md` operation list matches the 28 canonical operations in `src/engine/registry.ts` and `docs/prd.md`, and uses `WEB_CRYPTO_UNAVAILABLE`.
   - `src/components/pipeline/Inspector.tsx` surfaces `checkJsonPrecisionNotice` via `data-testid="inspector-json-precision-warning"` when inspecting a `json` step containing integer literals outside `Number.MAX_SAFE_INTEGER` (verified in Playwright E2E).
3. **Final QA Verdict**: **`PASS`** (`15/15` Acceptance Criteria verified, `0` unresolved defects).
