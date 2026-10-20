# Cipher Lab product requirements

## 1. Purpose and status

Cipher Lab shall be an original, modern developer and security engineering workbench for composing local data transformations and understanding their intermediate results. This document is normative product scope, not a claim that the application exists. The audience is implementation, QA, and review. The technical contract lives in [technical-design.md](technical-design.md); execution ownership lives in [tasks.md](tasks.md).

Developers, security analysts, and students need to decode unfamiliar data, reproduce transformation sequences, and inspect failures without sending sensitive material to a remote service. Cipher Lab provides a single browser workspace rather than accounts, persistent projects, or a hosted processing API.

## 2. Journeys and interaction requirements

### 2.1 Build and execute

The initial workspace shows operation catalog, ordered pipeline, input, and output. A user searches instantly across names, descriptions, and category labels, filters by category, and adds an operation by click or drag. Every drag action has a keyboard-accessible button alternative. Empty pipelines return the input unchanged.

Each step has inline parameters, enable/bypass, duplicate, remove, move up, and move down controls. Duplicates have independent identities and parameter objects. Disabled steps retain settings and pass bytes unchanged. Reordering preserves identity. Parameter validation appears at the field and step; invalid configuration cannot silently use defaults.

Auto-run defaults on, debounces edits, and is suspended during URL restoration. Run remains available when auto-run is off. Editing while a run is pending invalidates that run; stale results must never become current output. Cancel stops worker execution. Editing marks displayed results stale until the current revision completes.

### 2.2 Inspect and reuse

Input supports UTF-8 text entry and strict hexadecimal byte entry, with a sample button. Both panes expose text, offset-based hex dump, byte count, Unicode code-point count when valid UTF-8, and line count when valid UTF-8. Hex is the authoritative display for invalid UTF-8; replacement-character text previews must be labeled lossy and must never replace stored bytes.

Selecting a step opens its exact intermediate bytes, elapsed duration in milliseconds, byte length, status, and any structured error. A failing step stops execution: prior successful results remain inspectable, later enabled steps are marked not-run, and final output is unavailable. Never show a previous successful output as a current success.

Copy copies the active text or hexadecimal representation, with accessible success/failure feedback. Binary output downloads as bytes with an inert `.bin` filename and `application/octet-stream`; text output can download as UTF-8 `.txt`. Download and promote are disabled for failed, running, or stale results. Promote copies final bytes into input without rerunning until state is committed.

### 2.3 Recognize formats

Detection runs on valid current input and successful output. A non-blocking banner lists ranked format suggestions and explains that guesses may be wrong. A quick action appends the corresponding decoder/formatter with explicit parameters; it never mutates input automatically. Ambiguous data can yield several suggestions. Dismissing the banner affects only that buffer revision.

### 2.4 Start from presets

Provide curated, deterministic presets: text to Base64 to URL encoding; Hex to bytes to SHA-256; JSON minify to Base64; and AES encrypt to AES decrypt with a clearly labeled demonstration passphrase. Loading replaces pipeline and optional sample input only after confirmation when work is nonempty. Samples use invented, non-sensitive data such as `Hello, Cipher Lab!`. Presets with secrets never become shareable with those secrets populated.

### 2.5 Share and restore

Share previews what will be included, excludes input by default, and excludes all keys/passphrases. Input inclusion requires an explicit warning and opt-in on each share. Only the URL fragment carries workspace data. Restoring validates the entire payload before changing current state, warns that content is untrusted, and leaves execution paused until Run. Missing secrets require re-entry. Import errors leave the current workspace intact. Sharing never updates browser history on each edit.

## 3. Operation catalog

### 3.1 Common rules

Every row is required. Paired directions may use separate operation IDs or one definition with a direction parameter; the registry must expose each listed capability. The design fixes canonical IDs. Byte operations consume arbitrary bytes; text operations require fatal UTF-8 decoding. Unless specified, outputs described as text are UTF-8 bytes. Empty input succeeds unless a row requires a structured value or key. Error codes and size limits are defined in technical design ch. 3 and 4. Each row requires positive, negative, Unicode, and boundary tests as applicable.

### 3.2 Encoding and formats

| Operation | Input and parameters (defaults) | Output | Errors and edge behavior |
| --- | --- | --- | --- |
| Base64 | Encode bytes or decode ASCII; direction encode; alphabet standard or URL-safe (standard); padding on | ASCII encoding or decoded bytes | Reject mixed alphabets, invalid padding, noncanonical trailing bits; decoding accepts canonical padded or unpadded input, no whitespace |
| Base32 | Encode bytes or decode ASCII; direction encode; padding on | Uppercase alphabet A-Z and 2-7, or bytes | Decoder accepts letter case and optional canonical padding; reject illegal symbols and trailing bits |
| Hex | Encode bytes or decode ASCII; direction encode; letter case lower | Two digits per byte or bytes | Decoder permits ASCII whitespace between pairs only; reject odd digits or bad characters |
| Binary | Encode bytes or decode ASCII; direction encode; separator space | Eight bits per byte or bytes | Decode accepts contiguous octets or whitespace-separated octets; reject incomplete octets and non-bits |
| URL | UTF-8 text; direction encode | Percent-encoded component or decoded UTF-8 text | Use component semantics, not whole URL; plus remains plus on decode; malformed escapes or invalid decoded UTF-8 fail |
| HTML entities | UTF-8 text; direction encode | Escaped text or decoded text | Encode ampersand, angle brackets, double and single quotes; decode numeric scalar references and amp/lt/gt/quot/apos only; unsupported named entities unchanged; invalid numeric scalar fails; never render as markup |
| JSON format | UTF-8 JSON; mode pretty or minify (pretty); indentation 2 or 4 (2) | JSON text | Reject malformed JSON; preserve parser number semantics, warn that large integers can lose precision; do not claim lossless numeric formatting |
| JWT inspect | Compact UTF-8 token; no parameters | Pretty JSON containing decoded header, payload, signature encoding, and `verified: false` | Require three segments, valid Base64url, JSON object header/payload; allow empty signature but label unsigned; never verify signatures or trust claims; show timestamp claims as annotations without changing values |
| Timestamp | UTF-8 text; direction epoch-to-ISO or ISO-to-epoch; unit seconds or milliseconds (seconds) | UTC ISO string or integer epoch text | Epoch integer only, seconds are integral; ISO requires timezone; fractional seconds truncated toward zero for seconds output; reject invalid dates and out-of-range values |

### 3.3 Ciphers and bitwise operations

Classical ciphers are educational transformations, not secure encryption. Preserve non-target characters and case unless the row explicitly defines a restricted alphabet.

| Operation | Input and parameters (defaults) | Output | Errors and edge behavior |
| --- | --- | --- | --- |
| Caesar / ROT-N | UTF-8; direction encode; integer shift 0-25 (13) | Rotate ASCII letters, preserving case | Reject noninteger/out-of-range shift; decode subtracts shift |
| ROT13 | UTF-8; no parameters | Rotate ASCII letters by 13 | Self-inverse; other code points unchanged |
| Vigenère | UTF-8; direction encode; nonempty ASCII-letter passphrase | ASCII letters transformed, case preserved | Reject nonletter key; only letters advance key index; other code points unchanged |
| XOR | Arbitrary bytes; key encoding hex or UTF-8 (UTF-8); required nonempty key | Bytes XOR repeated key bytes | Strict hex key parsing; reject empty/invalid key; same operation reverses transformation |
| Atbash | UTF-8; no parameters | ASCII A-Z/a-z mirrored | Self-inverse; other code points unchanged |
| Rail fence | UTF-8; direction encode; rails integer 2-64 (3) | Code-point zigzag transposition or inverse | Reject invalid rail count; empty/one-code-point input preserved; rails exceeding length behave as identity |
| Morse | UTF-8; direction encode | Encode ASCII letters/digits to dot/dash tokens with single-space character separator and ` / ` word separator; decode to uppercase text | Encode case-insensitive, whitespace runs become word boundary; reject unsupported characters; decode rejects unknown tokens and malformed separators |

### 3.4 Hashing, checksums, and crypto

| Operation | Input and parameters (defaults) | Output | Errors and edge behavior |
| --- | --- | --- | --- |
| SHA-1, SHA-256, SHA-384, SHA-512 | Arbitrary bytes; algorithm SHA-256 | Lowercase hex digest | SHA-1 labeled legacy; not a password-storage mechanism; provider failure is explicit |
| HMAC-SHA256 | Arbitrary bytes; required nonempty key, UTF-8 or hex (UTF-8) | Lowercase hex MAC | Reject empty/invalid key; never display or serialize secret as diagnostic data |
| CRC32 | Arbitrary bytes; no parameters | Eight lowercase hex digits | IEEE CRC-32 with reflected polynomial 0xEDB88320, initial/final XOR 0xffffffff; checksum is not authentication |
| AES-GCM | Encrypt arbitrary bytes or decrypt UTF-8 envelope; direction encrypt; required nonempty passphrase | Versioned JSON authenticated-encryption envelope or exact decrypted bytes | Fixed envelope contract in technical design ch. 5; reject invalid envelope and unsupported version; wrong passphrase, tamper, or tag failure yields one generic authentication error; no partial plaintext |

### 3.5 Text and byte analysis

| Operation | Input and parameters (defaults) | Output | Errors and edge behavior |
| --- | --- | --- | --- |
| Case converter | UTF-8; mode lower, upper, title (lower) | Locale-independent Unicode lower/upper; title uppercases first ASCII letter of each whitespace-delimited token and lowercases rest | No locale selection; length can change under Unicode case mapping |
| Reverse | UTF-8; mode code-points or lines (code-points) | Reverse Unicode code points or LF-delimited lines | Not grapheme reversal; line mode normalizes CRLF to LF and preserves whether input ended in newline |
| Regex find/replace | UTF-8; pattern, replacement; mode find or replace (replace); flags subset g/i/m/s/u (g) | Replacement text or JSON array of matches with matched text, captures, and UTF-16 start/end offsets | Invalid pattern/flags fail; zero-length matches advance correctly; execution isolated and time-bounded; no arbitrary code replacement |
| Line sort/deduplicate | UTF-8; action sort, deduplicate, both (both); order ascending/descending (ascending); case sensitive true | LF text, deterministic code-point lexical sort; dedupe stable first occurrence before optional sort | Normalize CRLF; preserve terminal newline; case-insensitive key is Unicode lowercase; no locale sort |
| Entropy/frequency | Arbitrary bytes; no parameters | JSON object with byte count, Shannon entropy bits per byte, and 256 frequency counts plus probabilities | Empty input entropy 0, all counts/probabilities 0; informational, not a cryptographic randomness certification |

## 4. Quality and product constraints

- No accounts, database, server processing API, analytics, outbound network requests, or automatic workspace persistence. Refresh without a share fragment clears work. Theme preference alone may persist locally.
- Runtime stack: one Next.js App Router application, TypeScript, Tailwind CSS; computation stays in browser workers. Build tooling and installed packages are not runtime backend services.
- Visual direction: restrained technical workspace, compact readable controls, monospaced data, clear pane titles, and strong action hierarchy. Use semantic canvas/surface/text/border/action/focus/status/chart tokens in both themes. System preference defaults; explicit light/dark choice overrides it without hydration flash.
- Support current stable desktop Chrome, Firefox, Safari, and mobile Safari/Chrome with Web Crypto, workers, and TextEncoder/TextDecoder. Unsupported environments show an actionable capability error rather than failing silently. HTTPS required outside localhost.
- WCAG 2.2 AA: keyboard access, visible focus, accessible names, field errors, status live regions, non-color-only errors, reduced-motion support, 4.5:1 normal text and 3:1 large text/meaningful control boundaries/focus contrast. No drag-only capability.
- Desktop >=1200 CSS px: catalog/pipeline/data panes visible together. Tablet: collapsible catalog. Mobile: Input/Pipeline/Output tabs and catalog drawer. At 320 CSS px and 200% text zoom there is no page-level horizontal overflow; hex data may scroll inside its pane. Focus returns to the launching control when drawers close.
- Performance targets, not measured claims: edit-to-pending feedback <=100 ms; search response <=100 ms for shipped catalog; typical non-crypto pipeline of 10 steps over 64 KiB completes <=500 ms on QA's recorded laptop/browser. Crypto has no fixed latency promise; pending/cancel remains responsive. QA records hardware and representative timings.
- Bound computation and memory per technical design. Enforce limits before allocation where possible. Never log input, output, keys, URLs, or crypto exceptions containing data. Explain that browser memory cannot be guaranteed securely erased.

## 5. Acceptance criteria

| ID | Independently observable pass condition | Evidence owner |
| --- | --- | --- |
| AC-1 | Clean install runs one application; processing and presets generate no network requests, storage writes, or server mutations except explicit theme preference | QA |
| AC-2 | All four categories and every ch. 3 capability are searchable, filterable, and addable by pointer and keyboard | QA |
| AC-3 | Every catalog row passes documented vectors, round trips where reversible, invalid parameters, empty input, and Unicode/byte boundaries appropriate to its domain | Engineer, QA |
| AC-4 | Add, independent duplicate, remove, up/down reorder, bypass, and parameter edit preserve expected identities and produce correct bytes | QA |
| AC-5 | Auto-run debounces; manual mode waits for Run; rapid edits/cancel cannot publish stale output; failed and stale download/promote are disabled | QA |
| AC-6 | Inspector shows exact bytes, size, duration, bypass/error/not-run statuses; failure retains prior steps and clears final output | QA |
| AC-7 | Text/hex entry and views, correct statistics, sample, copy failure handling, byte-exact download, and promote work including invalid UTF-8 bytes | QA |
| AC-8 | All six detection families have positive/negative/ambiguous fixtures; ranked quick actions append explicit steps without automatic execution on restore | QA |
| AC-9 | All four presets run to their documented result; destructive replacement confirms; crypto preset round trip works without shared secrets | QA |
| AC-10 | Share/restore round trip preserves nonsecret steps and optional exact input bytes; default omits input; secrets excluded; malformed, oversized, unknown-version and unknown-operation fragments reject atomically | QA |
| AC-11 | AES encrypt/decrypt round trips arbitrary bytes; fresh random salt/IV per encryption; tamper/wrong secret yields identical generic failure and no plaintext | QA, Reviewer |
| AC-12 | Input, output, step-count, payload, regex and run limits reject or cancel predictably; repeated hostile regex does not freeze UI or exhaust workers | QA |
| AC-13 | Both themes pass computed contrast, live keyboard/focus/announcements, accessibility scan, reduced motion, and rendered responsive checks specified in tasks | QA |
| AC-14 | Search and execution targets in ch. 4 are measured on recorded environment; production build serves without console/hydration errors | QA |
| AC-15 | Lint, type-check, tests, build pass; durable QA PASS, reviewer APPROVED with zero unresolved blockers, and delivery summary disclose limitations | Coordinator |

## 6. Non-goals

No backend storage, authentication, collaboration, uploaded files, remote URL fetching, plugin code execution, signature verification, key vault, production key management, password hashing service, encryption interoperability beyond the specified envelope, arbitrary HTML rendering, unlimited workloads, grapheme-aware editing, or guaranteed secret memory erasure. Classical ciphers, SHA-1, CRC32, and entropy output must not imply modern security guarantees.
