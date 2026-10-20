# Cipher Lab architecture decisions

This append-only log owns the rationale for architecture choices. Requirements live in [prd.md](prd.md); exact interface and format contracts live in [technical-design.md](technical-design.md). These decisions are the Lead's design baseline, pending acceptance of the documentation deliverable, not evidence of implemented behavior. Accepted entries may only be superseded by a new decision.

## ADR-001: Share explicit versioned fragment state

| Field | Value |
| --- | --- |
| Status | Accepted as design baseline |
| Date | 2026-10-20 |
| Decider | Product and Technical Lead |

### Context

Users need bookmarks and shared workflows without server storage. User input and keys can be sensitive; browser URLs are not a secret store.

### Decision

Use the strict versioned JSON and canonical Base64url fragment contract in technical design ch. 7. Share is explicit, input is opt-in, and secret parameters never enter a share payload. Imports are validated atomically and remain paused until Run.

### Consequences

Positive: no share database or ordinary HTTP transmission of fragment contents; workflows remain inspectable and portable.

Negative: URL size limits restrict payloads; recipients, history and extensions can expose included input; omitted secrets require re-entry. Fragment use is not encryption or guaranteed privacy.

Neutral: instance IDs and results are reconstructed, not shared.

### Alternatives considered

Query state is easy to inspect and server-render, but transmits content to hosting infrastructure. A short-link database provides smaller links but violates backend-free scope. Compressed fragments fit more input but complicate bounded decoding and review. Uncompressed bounded fragments are sufficient for this scope.

### References

PRD ch. 2.5 and AC-10; technical design ch. 7.

## ADR-002: Keep pipeline payloads byte-accurate

| Field | Value |
| --- | --- |
| Status | Accepted as design baseline |
| Date | 2026-10-20 |
| Decider | Product and Technical Lead |

### Context

Encoding, XOR and encryption produce values that are not necessarily valid UTF-8. Intermediate inspection must show exact results, not repaired strings.

### Decision

Use Uint8Array between operations, immutable input snapshots, and explicit fatal UTF-8 boundaries for text operations. Keep UI drafts separate from committed byte buffers. Hex view and binary downloads preserve exact bytes when text cannot represent them.

### Consequences

Positive: arbitrary-byte chains and inspector/download/promote flows avoid silent corruption.

Negative: explicit conversions complicate text UI, and retained intermediate buffers require memory limits. Code-point semantics do not provide grapheme-aware editing.

Neutral: text statistics are unavailable for invalid UTF-8 rather than guessed.

### Alternatives considered

Strings simplify forms and debugging but force a hidden encoding for binary data. Base64 strings are portable but add expansion and repeated conversion. Bytes are the single internal representation; encoded strings exist only at named boundaries.

### References

PRD ch. 2.2; technical design ch. 3 and 4.

## ADR-003: Fix native authenticated-encryption parameters

| Field | Value |
| --- | --- |
| Status | Accepted as design baseline |
| Date | 2026-10-20 |
| Decider | Product and Technical Lead |

### Context

A passphrase-based encrypt/decrypt operation needs reproducible derivation metadata, integrity protection, and secure randomization without a remote key service.

### Decision

Use native SubtleCrypto with PBKDF2-HMAC-SHA256 and AES-256-GCM. Versioned envelope fields, fixed work factor, salt/IV/tag sizes, additional authenticated data and strict decode rules are owned by technical design ch. 5. Use browser crypto in production and Node webcrypto as an injected test provider, never a server processing path.

### Consequences

Positive: native authenticated encryption supports exact local round trips, tamper detection and independent provider tests.

Negative: PBKDF2 has CPU cost and does not fix weak passphrases; no secure browser memory-erasure guarantee exists; the custom envelope is not general interoperability with other tools. Fixed iterations require a new version for future changes.

Neutral: encryption is intentionally nondeterministic; deterministic fixtures must isolate randomness in tests.

### Alternatives considered

Unauthenticated encryption is simple but can release tampered plaintext. Raw ciphertext is smaller but loses derivation settings. A memory-hard KDF can resist password guessing better, but requires an additional implementation and compatibility burden outside the specified native-crypto approach.

### References

PRD ch. 3.4 and AC-11; technical design ch. 5.

## ADR-004: Ship one application without processing services

| Field | Value |
| --- | --- |
| Status | Accepted as design baseline |
| Date | 2026-10-20 |
| Decider | Product and Technical Lead |

### Context

The product requires a stateless single application and no backend data custody. The initial repository has no implementation to preserve.

### Decision

Use Next.js App Router, TypeScript and Tailwind CSS with all user transformations in browser module workers. No database, processing API, accounts, telemetry or runtime external service dependencies. Installable development dependencies are permitted; runtime CDN assets are not. Only theme preference may persist locally.

### Consequences

Positive: deployment is one application, processing works without a computation service, and sensitive input need not leave the browser.

Negative: browser capability and memory limits bound workloads; there is no central recovery, durable workspace history or cross-device synchronization.

Neutral: server rendering serves the shell; a static-only export is not a requirement. Deployment must provide HTTPS and enforce the security policy.

### Alternatives considered

A server transform endpoint offers centralized compute and broader algorithms but adds data transfer and service operations. A persisted workspace backend improves recovery and collaboration but violates the scoped stateless model.

### References

PRD ch. 4 and 6; technical design ch. 1-2 and 4.

## ADR-005: Terminate bounded workers rather than trust cancellation flags

| Field | Value |
| --- | --- |
| Status | Accepted as design baseline |
| Date | 2026-10-20 |
| Decider | Product and Technical Lead |

### Context

Synchronous regular expressions can block an event loop; async crypto may complete after a user edits a pipeline. An AbortSignal alone does not ensure either computation stops.

### Decision

Run one active pipeline per worker and cancel by worker termination. Main-thread watchdogs enforce per-step and total budgets; revision/run IDs prevent stale result publication. Detection has a separate bounded worker. Post successful step results incrementally so failure or timeout preserves earlier inspection.

### Consequences

Positive: hostile regex cannot block UI execution, and stale jobs cannot overwrite current results.

Negative: termination loses in-flight work and costs worker startup; background-tab timer throttling can delay wall-clock timeout enforcement. Byte and match limits remain necessary.

Neutral: incremental messages are internal progress state, not permission to publish a partial final result.

### Alternatives considered

Main-thread execution is simpler but can freeze interaction. Cooperative AbortSignal cancellation is cheap but cannot preempt synchronous regex or already-running native crypto. Persistent worker pools improve throughput but complicate ownership, cleanup and bounded concurrency for this single-user workbench.

### References

PRD AC-5/AC-6/AC-12; technical design ch. 3.3 and 4.
