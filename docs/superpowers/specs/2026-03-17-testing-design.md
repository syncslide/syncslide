# Automated Testing Design

**Date:** 2026-03-17
**Project:** SyncSlide
**Status:** Approved

---

## Goal

Introduce automated testing to SyncSlide to catch functional regressions and accessibility violations before they reach production. Tests run automatically on every deploy and block the release if they fail.

---

## Constraints

- No local builds — all compilation and test execution happens on the VPS (`arch@clippycat.ca`)
- Windows local environment — no local Cargo or Node.js toolchain
- User is a screen reader user — accessibility correctness is critical and must be verified automatically
- WCAG 2.1 Level AAA conformance required on all pages

---

## Architecture

Two independent test layers, each testing at the appropriate level:

### Layer 1: Rust Tests (Phase 1)

**Location:** `syncslide-websocket/tests/` (integration tests) and `#[cfg(test)]` blocks in `src/db.rs` (unit tests)

**Tool:** Rust's built-in test framework + `axum-test` crate

**How it works:**
- Spins up the real Axum app in-process using `axum-test`
- Uses a fresh SQLite test database per test run — no shared state, no order dependency
- Makes real HTTP requests to real handlers against a real database
- No separate process or port required

**New dev-dependencies:**
- `axum-test` — HTTP test client for Axum apps
- `tokio` with `full` feature (for async test runtime, if not already present)

### Layer 2: Playwright Tests (Phase 2)

**Location:** `tests/` at the repository root

**Tool:** Node.js + Playwright + axe-core

**How it works:**
- Before tests: deploy script starts the compiled binary on port 5003 with a fresh `test.sqlite3`; seeds a known test user and one presentation via `tests/seed.sql`
- Tests run against the real binary in real browsers
- After tests: binary is killed, `test.sqlite3` is deleted
- **Port pre-check:** deploy script verifies port 5003 is free before starting; fails with a clear error if not
- **Browser targets:** Chromium and WebKit (Safari engine) — most relevant for VoiceOver users

---

## Deploy Integration

Tests are integrated into the existing `update.bat` SSH command. The deploy stops at the first failure — production is never restarted if tests fail.

### Phase 1 deploy flow:
1. `git pull --rebase`
2. `cargo build`
3. `cargo test` — stops here if any test fails
4. Copy Caddy config, reload Caddy, restart production service

### Phase 2 deploy flow (adds after step 3):
4. Check port 5003 is free
5. Start binary on port 5003 with `test.sqlite3`
6. Run `tests/seed.sql`
7. Run `npx playwright test`
8. Kill test binary, delete `test.sqlite3`
9. Copy Caddy config, reload Caddy, restart production service

Test output is written to `/tmp/syncslide-test.log` for post-failure review.

---

## Test Coverage Plan

### Phase 1 — Rust Tests (implement first)

**Starting point: Auth** — chosen because it has clear pass/fail conditions, covers both layers (unit + HTTP), and has no WebSocket complexity.

**Unit tests (`src/db.rs`):**
- Password hashing produces a valid Argon2id hash
- Password verification passes for correct password
- Password verification fails for wrong password

**Integration tests (`tests/auth.rs`):**
- `POST /login` with correct credentials → redirects to presentations page
- `POST /login` with wrong password → returns login page with error
- `GET /presentations` without session → redirects to login
- `GET /presentations` with valid session → returns 200

**Phase 1 expansion (after auth):**
1. Presentations — create, rename, delete, permissions
2. DB correctness — FK enforcement, `recording_slide` cascade deletes
3. Permission checks — admin-only routes reject non-admin users

### Phase 2 — Playwright Tests

**Starting point: Auth flows in browser** — login, logout, session persistence, error announcements to screen reader

**Expansion order:**
1. Presentations list — keyboard navigation, sort/pagination, confirm dialogs
2. WebSocket sync — presenter changes slide, audience context updates
3. Recordings — upload, cue editor, save timing
4. Accessibility — axe-core runs on every page; WCAG AAA violations fail the build

**Browser targets:** Chromium + WebKit. Firefox deferred.

### Out of scope (intentionally deferred)
- KaTeX rendering correctness
- Video playback sync
- Cross-browser beyond Chromium + WebKit

---

## Accessibility Testing Approach

Playwright tests use axe-core to audit every page for WCAG violations. Any violation at Level A, AA, or AAA fails the build.

Screen reader-specific checks (focus management, announcement order, dialog trapping) are tested via Playwright's keyboard interaction API — tab, Enter, Escape — asserting that the accessibility tree reflects the correct state at each step.

---

## File Structure

```
syncslide-websocket/
  Cargo.toml                  # add axum-test to [dev-dependencies]
  src/
    db.rs                     # add #[cfg(test)] unit tests here
  tests/
    auth.rs                   # Phase 1 integration tests
    presentations.rs          # Phase 1 expansion
    permissions.rs            # Phase 1 expansion

tests/                        # Phase 2 — repo root
  seed.sql                    # test database seed
  auth.spec.js                # Playwright auth tests
  presentations.spec.js       # Playwright presentation tests
  websocket.spec.js           # Playwright WebSocket sync tests
  recordings.spec.js          # Playwright recording tests
  accessibility.spec.js       # axe-core full-page audits
  playwright.config.js        # Playwright config (port 5003, Chromium + WebKit)

config/
  update.bat                  # updated to include test steps
  test.sh                     # test orchestration script (called by update.bat)
```
