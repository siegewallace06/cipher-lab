# Cipher Lab implementation and verification tasks

## 1. Execution contract

This is the normative implementation plan for Engineer, QA, Reviewer, and Delivery Coordinator. Product scope lives in [prd.md](prd.md); module contracts and limits live in [technical-design.md](technical-design.md). No application checks have been executed at this documentation-only baseline. Commands below are required future gates, not reported results.

The Coordinator shall create staged tracker tasks from these milestones, preserving objective, references, boundaries, dependencies, criteria, verification, and deliverables. Do not create overlapping concurrent writes in one checkout. Implementation is sequential by default; isolated worktrees require explicit file ownership and an integration owner. QA and review begin against the same stable implementation commit. Documentation verdict files have separate owners.

## 2. Implementation milestones

### M1. Foundation and capability shell

- Owner: The Engineer. Dependencies: accepted design baseline.
- Objective: establish the single application, executable checks, semantic themes, and browser capability handling.
- References: PRD ch. 2 and 4; technical design ch. 1, 2, 4.
- Files: package/lock/config files, `src/app/`, `src/components/common/`, `src/components/workbench/ResponsiveShell`, `src/lib/limits.ts`, test bootstrap, CI, README setup instructions.
- Boundaries: no operation implementations or backend endpoints. Pin compatible stable dependencies. Configure a flat ESLint invocation rather than relying on removed framework lint commands.
- Required scripts: `lint` invokes ESLint, `type-check` invokes `tsc --noEmit`, `test` runs the unit/integration suite once without watch, `build` invokes `next build`, `test:e2e` invokes the browser suite. Browser dependencies and their install instructions must be explicit.
- Acceptance: shell works at 320/768/1366/1920 CSS px, both themes and system preference resolve without flash, unsupported worker/crypto environments have bounded fallbacks, empty test suite is not silently treated as coverage.
- Verify: all four core commands in ch. 5; browser shell smoke including console/hydration checks.
- Deliverables: code, lockfile, initial tests, setup/CI, commit and PR references with actual command output summaries.

### M2. Byte engine and safe worker lifecycle

- Owner: The Engineer. Dependencies: M1.
- Objective: implement exact bytes, immutable steps, result states, limits and responsive cancellation before UI integration.
- References: technical design ch. 3 and 4; PRD AC-4, AC-5, AC-6, AC-12.
- Files: `src/engine/`, `src/lib/bytes.ts`, `src/lib/parameter-schema.ts`, `tests/unit/engine*`, `tests/integration/worker*`.
- Boundaries: registry may use test-only fixture operations in tests, not public demo endpoints or arbitrary executable imports. No renderer work beyond integration adapter.
- Acceptance: empty/bypassed pipelines, stopped failure chains, copied buffers, identity preservation, cumulative output limits, obsolete revision discard, worker crash, timeout, cancel, unmount cleanup, and worker-count cap are tested.
- Verify: ch. 5 core commands plus browser worker lifecycle tests. Test invalid UTF-8, bytes 00/80/ff, and UTF-8 multibyte boundaries.
- Deliverables: engine types/implementation, worker protocol, unit and real-worker tests, evidence summary.

### M3. Complete operation registry

- Owner: The Engineer. Dependencies: M2.
- Objective: implement every catalog row without implicit string conversions or unsafe execution.
- References: PRD ch. 3 and AC-3/AC-11/AC-12; technical design ch. 3-5.
- Files: `src/operations/`, `src/engine/registry.ts`, `src/lib/crypto-envelope.ts`, `tests/unit/operations/`, crypto browser integration tests.
- Boundaries: no network API, configurable crypto weakening, dynamic scripts, or hidden format normalization.
- Acceptance: all 28 canonical operation IDs registered with validated defaults, field descriptors, and secret annotations; all paired directions present. Each PRD row has independently sourced or independently calculated expected vectors, malformed data, empty input, wrong parameter types and limits. Do not test by merely calling the same implementation twice.
- Required vectors: standard published encoding/digest/HMAC/CRC32 vectors with cited sources in tests; binary round trips; Unicode code points vs UTF-16 offsets; JSON precision warning; timestamp timezones/negative epochs; malformed padding/hex; XOR non-text bytes; Rail Fence short input; Morse unsupported input; regex empty matches and catastrophic patterns; all-zero and uniform byte entropy.
- Crypto tests: known envelope fixture with fixed test salt/IV isolated to tests, browser encrypt-to-decrypt and Node/browser cross-provider round trips, fresh randomness across two encryptions, wrong secret, modified ciphertext/tag/IV/salt, unsupported fields/version/KDF/iterations, empty plaintext, no plaintext on failure. Mock randomness only in deterministic unit fixtures, never production.
- Verify: core commands and actual browser crypto/regex worker tests. Record source and expected outputs for vectors.
- Deliverables: complete operations, documented sample vectors, tests and actual results.

### M4. Workbench interaction and byte views

- Owner: The Engineer. Dependencies: M3.
- Objective: deliver catalog, pipeline controls, exact intermediate inspector and input/output flows.
- References: PRD ch. 2.1-2.2, AC-2/AC-4-AC-7/AC-13; technical design ch. 2-4.
- Files: `src/components/catalog/`, `src/components/pipeline/`, `src/components/data/`, `src/components/workbench/`, `src/state/`, `src/app/page.tsx`, interaction tests.
- Boundaries: transformation logic stays in engine/operations; do not use UI text as a byte store.
- Acceptance: click and drag addition; keyboard alternatives; independent duplication; inline validation; selected-step inspection; debounce/manual Run; stale/running/error affordances; valid text and invalid UTF-8 display; exact downloads/promote; clipboard-denied error; focus restoration and status announcements.
- Verify: core commands and browser interaction suite across desktop/mobile, including rapid edits during AES and regex runs.
- Deliverables: usable workbench, deterministic populated/error/bypass fixtures in tests, interaction coverage and screenshots.

### M5. Detection, presets, and safe URL exchange

- Owner: The Engineer. Dependencies: M4.
- Objective: add discovery and reproducibility without automatic disclosure or execution.
- References: PRD ch. 2.3-2.5, AC-8-AC-10; technical design ch. 6-7.
- Files: `src/lib/detection.ts`, `src/lib/presets.ts`, `src/lib/url-state.ts`, `src/components/sharing/`, detector banner components, unit and browser tests.
- Boundaries: no workspace persistence, compression, query state, secret export, or auto-run on import. Keep detection off main thread.
- Acceptance: six format families with ranked ambiguity; no truncated-token classification; four presets with expected output; replacement confirmation; strict atomic schema restore; regenerated IDs; input opt-in; secret stripping for enabled/disabled steps and presets; malicious imports rejected before mutation.
- Negative tests: malformed Base64url/UTF-8/JSON, prototype-related keys, unknown root/step/param/version/operation, wrong types, extra fragment keys, over-limit encoded and decoded payloads, included secret keys, missing nonsecret settings, stale detection jobs. Verify exact limit and one-over for each resource.
- Verify: core commands, `npm run test:e2e`, network/storage assertions during processing, and round-trip URLs containing binary input. Confirm no input is emitted by default.
- Deliverables: detector, presets, exchange UI, tests and reproducible share fixtures with no secrets.

### M6. Integration hardening and documentation

- Owner: The Engineer. Dependencies: M5.
- Objective: resolve cross-module failures and prepare a stable acceptance candidate.
- References: PRD AC-1 and AC-12-AC-15; technical design ch. 4 and 8.
- Files: relevant implementation only, CI, README runtime/deployment instructions. Lead-owned docs change only to correct agreed clarifications; material design changes require escalation.
- Acceptance: production build starts locally; CSP works with workers/theme bootstrapping; no runtime remote requests; bounded memory and worker cleanup; all core and browser gates pass. State browser support limits honestly.
- Verify: ch. 5 complete gate plus production route smoke. Do not label development-server behavior production verification.
- Deliverables: pushed implementation branch, PR title with issue key, commit SHA, executed checks/results, known limitations, ready-for-QA/review handoff.

## 3. Independent QA task

- Owner: The QA. Stage: 3. Dependencies: M6 stable commit and install instructions. Do not accept Engineer's tests as independent execution.
- Objective: evaluate PRD AC-1-AC-15 against the same commit proposed for delivery.
- Files owned: `docs/qa-evidence.md`, test artifacts; no concurrent product edits. Defects return to Engineer with reproducible steps, expected/actual behavior, severity, environment and affected AC.
- Execute ch. 5 on clean install, operation positive/negative vectors, hostile regex, binary flows, malformed sharing, secret exclusion, authentication failures, cancellation/stale races, storage/network checks, limit boundaries, unsupported capabilities and XSS text-only probes.
- Rendered matrix: both themes at widths 320, 768, 1366 and 1920; common laptop at short height; 200% text zoom and reduced motion. Include empty, populated, pending, error, inspector, catalog drawer, share dialog, invalid import, and long unbroken data states. At least representative empty/populated/error/dialog states must be captured in each theme on mobile and laptop; test all remaining states mechanically and capture failures.
- Measure actual computed contrast for normal text, meaningful icons/boundaries/focus/status/chart series. Run automated accessibility scan plus live keyboard order, Escape/focus return, screen-reader announcements and drag alternatives. Inspect screenshots full size and thumbnail, not only DOM assertions. Record exact viewports and page overflow dimensions programmatically; internal hex scrolling is permitted, page overflow is not.
- Record search and 10-step 64 KiB timings with OS/browser/hardware and fixture; inspect production console/hydration. No claim of universal performance based on one machine.
- Deliverables: per-AC pass/fail evidence, commands with exit results, screenshots referenced or attached, limitations and overall `PASS` or `FAIL (Blocking Defects)` with blocking defect list. A missing gate is not PASS.

## 4. Independent review and remediation

- Owner: The Reviewer. Stage: 3, parallel with QA on stable diff; no edits to QA-owned evidence.
- Objective: review architectural alignment, security, maintainability, dependency choices, byte integrity, secret handling, resource limits, test independence and complete scope.
- Files owned: `docs/review-verdict.md`. Reference implementation files/lines for findings. Inspect worker cancellation and stale-message ordering, crypto envelope/KDF/AAD, secret metadata export/import, prototype handling, CSP and unsafe rendering, omitted catalog cases and unintended network/persistence.
- Verify: inspect diff against PRD/design and test evidence; execute targeted checks where needed and distinguish executed from inspected. Required deliverable: `APPROVED` with zero blockers or `CHANGES_REQUESTED`, severity-ranked reproducible findings and exact reviewed SHA.
- Fix loop: Engineer owns product fixes and regression tests; QA/Reviewer recheck affected work and update their own verdicts. Maximum three reasonable fix cycles per blocking issue. After three, or upon material requirements/architecture/security/compatibility decisions, Coordinator escalates to Lead with attempts, evidence, options and recommendation. Do not wake Lead for routine progress or final re-review.
- Final delivery: Coordinator checks all ACs, passing executed gates, QA PASS, Reviewer APPROVED, zero unresolved blockers, updated docs and disclosed limitations; writes `docs/delivery-summary.md` and posts parent handoff. A passing build alone is not completion.

## 5. Exact verification commands

Run from repository root after M1 defines scripts. Tests must fail on assertions, unhandled rejections and missing expected test coverage; use deterministic, invented fixtures only.

```sh
npm ci
npm run lint
npm run type-check
npm test
npm run build
npm run test:e2e
```

Engineer must document browser installation prerequisites and test-server lifecycle for `test:e2e`; the command must clean up owned servers/workers after completion. Browser suite must include a production-build smoke path. Use an automated CI job for the four required core gates; browser gates can be a separate job with explicit artifacts. Reports identify which commands actually ran, their result, the tested commit and remaining checks. Never fabricate successful output when tools or dependencies block execution.
