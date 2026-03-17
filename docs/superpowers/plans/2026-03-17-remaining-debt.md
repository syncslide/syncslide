# Remaining Debt Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 2 remaining technical debt items catalogued in `docs/superpowers/specs/2026-03-16-system-spec-design.md` section 10.

**Architecture:** Two independent one-line or one-comment fixes — no structural changes, no new files. Each task is self-contained and can be deployed individually.

**Tech Stack:** Vanilla JS (`audience.js`), Rust (`main.rs`). No JS test framework exists — verification is done by deploying to VPS and checking in browser. Rust changes require `cargo build` on VPS via `config/update.bat`.

**Deployment workflow:**
- JS changes: commit + push + `config/update.bat`
- Rust changes: commit + push + `config/update.bat` (triggers `cargo build` on VPS)
- Never run the server or `cargo build` locally.
- No SQL queries change — `cargo sqlx prepare` is not needed.

---

## Files Modified

| File | Task |
|------|------|
| `syncslide-websocket/js/audience.js` | 1 |
| `syncslide-websocket/src/main.rs` | 2 |

---

## Task 1: Fix `getH2s` coupling in audience.js (#1)

**Spec ref:** Tech debt #1 — `audience.js` guards the `getH2s` call with `isStage()` (checks for `#goTo` element) instead of checking whether `getH2s` is actually defined. The intent is "only call this if handlers.js loaded", but the current guard conflates that with a DOM query.

**Files:**
- Modify: `syncslide-websocket/js/audience.js` — inside `handleUpdate`

- [ ] **Step 1: Apply fix**

In `syncslide-websocket/js/audience.js`, inside `handleUpdate`, find:
```js
	if (isStage()) {
		getH2s(allHtml)
	}
```

Replace with:
```js
	if (typeof getH2s === 'function') {
		getH2s(allHtml)
	}
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/js/audience.js
git commit -m "fix: guard getH2s call with typeof check instead of isStage DOM query"
```

---

## Task 2: Add explanatory comment for `with_secure(false)` (#2)

**Spec ref:** Tech debt #2 — `SessionManagerLayer::with_secure(false)` in `main.rs` is intentional (Caddy terminates TLS; app binds to localhost only) but has no comment, making it look like a security oversight.

**Files:**
- Modify: `syncslide-websocket/src/main.rs:1073–1075`

- [ ] **Step 1: Apply fix**

In `src/main.rs`, find:
```rust
    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(false)
        .with_expiry(Expiry::OnInactivity(Duration::days(1)));
```

Replace with:
```rust
    let session_layer = SessionManagerLayer::new(session_store)
        // with_secure(false): Caddy terminates TLS; this binary binds to localhost:5002 only.
        // Session cookies are never sent over plain HTTP in production.
        .with_secure(false)
        .with_expiry(Expiry::OnInactivity(Duration::days(1)));
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "docs: explain why session cookie has with_secure(false)"
```

---

## Task 3: Deploy, verify, and close out spec

- [ ] **Step 1: Push to remote**

```bash
git push
```

- [ ] **Step 2: Deploy on VPS**

```bash
config\update.bat
```

- [ ] **Step 3: Verify task 1 — stage page, no console errors**

Open the stage page in the browser. Open DevTools console. Navigate slides with the dropdown and F8. Confirm no `ReferenceError` or `TypeError` related to `getH2s`.

- [ ] **Step 4: Verify task 2 — server starts cleanly**

```bash
ssh arch@clippycat.ca "journalctl -u syncSlide -n 20"
```
Expected: clean startup, no errors.

- [ ] **Step 5: Mark resolved items in spec**

In `docs/superpowers/specs/2026-03-16-system-spec-design.md`, update section 10 to mark both items as resolved:

Replace the "Known Issues & Remaining Technical Debt" section with:
```markdown
## 10. Known Issues & Remaining Technical Debt

All previously catalogued items are resolved as of 2026-03-17. See git history for details.
```

```bash
git add docs/superpowers/specs/2026-03-16-system-spec-design.md
git commit -m "docs: mark all remaining tech debt as resolved"
```
