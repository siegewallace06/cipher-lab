# Cipher Lab

Stateless, client-side data transformation, encoding, hashing, and cryptography pipeline workbench built with a single Next.js App Router application.

## Design Documents

- [Product Requirements](docs/prd.md)
- [Technical Design](docs/technical-design.md)
- [Implementation & Verification Tasks](docs/tasks.md)
- [Architecture Decision Log](docs/decisions.md)

## Key Capabilities

- **Authoritative Byte Pipeline**: Every pipeline step transforms `Uint8Array` to `Uint8Array` inside a dedicated Web Worker (`src/engine/`). Intermediate and final byte snapshots are preserved without lossy UTF-8 string round-tripping.
- **28 Canonical Operations Across 4 Categories**:
  - **Encoding & Formats (9)**: Base64 (`base64`, standard & URL-safe), Base32 (`base32`, RFC 4648), Hexadecimal (`hex`), Binary (`binary`, 8-bit groups), URL Percent-Encoding (`url`), HTML Entities (`html-entities`), JSON Prettify/Minify (`json`, with large-integer precision warning), JWT Decoder & Claims Inspector (`jwt`), and Unix Timestamp ↔ ISO-8601 (`timestamp`).
  - **Ciphers & Bitwise (7)**: Caesar Shift (`caesar`), ROT13 (`rot13`), Vigenere Cipher (`vigenere`), XOR (`xor`, hex/UTF-8 key), Atbash (`atbash`), Rail Fence (`rail-fence`), and Morse Code (`morse`).
  - **Hashing, Checksums & Crypto (7)**: SHA-1 (`sha1`, labeled legacy non-collision-resistant), SHA-256 (`sha256`), SHA-384 (`sha384`), SHA-512 (`sha512`), HMAC-SHA256 (`hmac-sha256`), CRC32 (`crc32`, IEEE 802.3), and AES-256-GCM Encrypt/Decrypt (`aes-gcm`, `v: 1` JSON envelope with PBKDF2-HMAC-SHA-256 600,000 iterations).
  - **Text & Byte Analysis (5)**: Case Transform (`case`), Reverse (`reverse`, Unicode code points, lines, or raw bytes), Regex Find & Replace (`regex`, worker-isolated), Line Sort / Deduplicate / Trim (`lines`), and Shannon Entropy & 256-Byte Frequency Distribution (`entropy`).
- **Format Detection & Starter Presets**: Off-main-thread format detection for Base64/Base64URL, Hex, URL percent-encoding, HTML entities, JSON, and JWT headers/claims, plus 4 curated starter presets.
- **Stateless `#cl=` URL Fragment Sharing**: Versioned (`v: 1`) URL fragment serializer (`src/lib/url-state.ts`) that strips secret parameters (`secret: true`) before export, excludes input data unless explicitly opted in, and validates imported fragments atomically without auto-running on restore.
- **Stateless Workspace & Zero Telemetry**: No `localStorage`, `sessionStorage`, `IndexedDB`, cookies, or remote network calls are used for workspace state, inputs, outputs, or secrets (only the optional `cipher-lab-theme` UI preference key is stored locally when selected).

## Prerequisites & Setup

- **Node.js**: v20.x or v22.x LTS
- **npm**: v10+

Install dependencies from the repository root:

```sh
npm ci
```

### Browser Prerequisites for `test:e2e`

Playwright E2E and accessibility tests run in headless Chromium. Before running `npm run test:e2e` for the first time on a machine or CI runner, install the Chromium browser binary:

```sh
npx playwright install chromium
# On Linux CI runners where OS dependencies are also needed:
npx playwright install --with-deps chromium
```

## Development & Verification Scripts

Run all verification commands from the repository root:

```sh
# Start local development server on http://localhost:3000
npm run dev

# Run ESLint flat config across src/, tests/, and config files
npm run lint

# Run TypeScript compiler type checking without emitting files
npm run type-check

# Run Vitest unit and integration test suite once (non-watch)
npm test

# Build the production Next.js application
npm run build

# Start the production server after building
npm run start

# Run the Playwright E2E and WCAG 2.1 AA accessibility test suite
npm run test:e2e
```

### Test Server Lifecycle (`npm run test:e2e`)

`playwright.config.ts` manages the production server lifecycle automatically:
1. If `.next/BUILD_ID` is not already present, the Playwright `webServer` hook runs `npm run build` first, then launches `npm run start -- -p 3100 -H 127.0.0.1`.
2. `reuseExistingServer` is set to `false` so tests always execute against a fresh production server instance owned by the Playwright run.
3. Upon test completion (pass or fail), Playwright terminates the server process and disposes all browser contexts and Web Workers.

## Resource Bounds & Known Browser Limitations

- **Input & Step Byte Limits**: Maximum input or single-step output size is 1 MiB (`1,048,576` bytes); maximum cumulative retained step output per run is 16 MiB (`16,777,216` bytes); maximum pipeline length is 32 steps; ordinary step timeout is 2,000 ms (15,000 ms per AES-GCM step, 100 ms per regex step, 30,000 ms total run budget).
- **Web Crypto API Requirement**: SHA digests, HMAC, and AES-256-GCM require `crypto.subtle` (`window.isSecureContext`, such as `https://` or `http://localhost` / `http://127.0.0.1`). In insecure HTTP origins where `crypto.subtle` is unavailable, the workbench displays a capability banner and returns a deterministic `WEB_CRYPTO_UNAVAILABLE` error on Web Crypto steps while keeping non-Web-Crypto operations functional.
- **Web Worker Requirement**: Pipeline execution and regex evaluation require browser `Worker` support so long-running or catastrophic regular expressions can be terminated on timeout without freezing the UI thread.
