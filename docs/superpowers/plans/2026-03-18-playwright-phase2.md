# Playwright Testing — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser-level tests using Playwright + axe-core that run on every deploy and verify auth flows and WCAG compliance on all pages.

**Architecture:** A Node.js Playwright project lives in `tests/` at the repo root. `config/test.sh` starts the compiled binary on port 5003 against a temporary `test.sqlite3` database (selected via a new `APP_DB` env var), waits for readiness, runs Playwright, then cleans up unconditionally via `trap`. The deploy pipeline (`update.bat`) gains a `bash ../config/test.sh` step after `cargo test` — if Playwright fails, the service does not restart. No seed data is needed: SQLx migrations already create an `admin` user (password: `admin`) and a Demo presentation on startup.

**Tech Stack:** Node.js ≥18, Playwright ^1.x, @axe-core/playwright ^4.x, Chromium + WebKit browser targets.

**Phase scope:** Auth flows + axe-core WCAG audits on all pages. Presentations keyboard navigation, WebSocket sync, and recordings are deferred to separate plans.

---

## VPS Prerequisite Check (do this manually before Task 1)

SSH into the VPS and verify Node.js is installed:

```bash
ssh arch@clippycat.ca "node --version && npm --version"
```

Expected: Node.js 18.x or later, npm 9.x or later. If `node` is not found:

```bash
ssh arch@clippycat.ca "sudo pacman -S nodejs npm"
```

Do not proceed until `node --version` works on the VPS.

---

## Files Created or Modified

| File | Status | Purpose |
|------|--------|---------|
| `syncslide-websocket/src/main.rs` | Modify | Read `APP_DB` env var for database path (required by test.sh) |
| `tests/package.json` | Create | Playwright + axe-core dependencies |
| `tests/playwright.config.js` | Create | Browser targets, base URL, reporter |
| `tests/.gitignore` | Create | Exclude `node_modules/`, `playwright-report/`, `test-results/` |
| `tests/auth.spec.js` | Create | Auth flow browser tests |
| `tests/accessibility.spec.js` | Create | axe-core WCAG audits for all pages |
| `config/test.sh` | Create | Orchestration: start binary → wait → run Playwright → cleanup |
| `config/update.bat` | Modify | Add `bash ../config/test.sh` step after `cargo test` |

---

## Task 1: Playwright project scaffold

**Files:**
- Create: `tests/package.json`
- Create: `tests/playwright.config.js`
- Create: `tests/.gitignore`

- [ ] **Step 1: Create `tests/package.json`**

```json
{
  "name": "syncslide-playwright",
  "private": true,
  "scripts": {
    "test": "playwright test"
  },
  "dependencies": {
    "@axe-core/playwright": "^4.10.0",
    "@playwright/test": "^1.50.0"
  }
}
```

> **Version note:** Before committing, check [npmjs.com/@playwright/test](https://www.npmjs.com/package/@playwright/test) and [npmjs.com/@axe-core/playwright](https://www.npmjs.com/package/@axe-core/playwright) for the latest stable versions and update accordingly.

- [ ] **Step 2: Create `tests/playwright.config.js`**

```js
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5003',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
```

- [ ] **Step 3: Create `tests/.gitignore`**

```
node_modules/
playwright-report/
test-results/
```

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "chore: scaffold Playwright test project"
```

---

## Task 2: Add `APP_DB` env var to `main.rs`

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

`main()` currently hardcodes `"sqlite://db.sqlite3"` in two places. `test.sh` needs to start the binary against a temporary `test.sqlite3` database instead — the same way `APP_PORT` already lets tests use port 5003 instead of 5002. This task adds a parallel `APP_DB` env var.

**No SQL query changes.** No `cargo sqlx prepare` needed — this only touches the connection string passed to `SqliteConnectOptions::from_str`, not any query.

> **TDD note:** The test for this change is implicit — `test.sh` passing in Task 5 confirms `APP_DB` works correctly. There is no meaningful unit test to write for "reads an env var correctly".

- [ ] **Step 1: Locate the two `"sqlite://db.sqlite3"` strings in `main()`**

In `src/main.rs`, find `async fn main()`. There are exactly two `SqliteConnectOptions::from_str("sqlite://db.sqlite3")` calls — one for the migration pool (`foreign_keys(false)`) and one for the runtime pool (`foreign_keys(true)`). Both must be updated.

- [ ] **Step 2: Replace both hardcoded paths with an env-var lookup**

Find this block:

```rust
#[tokio::main(flavor = "current_thread")]
async fn main() {
    let port = std::env::var("APP_PORT").unwrap_or_else(|_| "5002".to_string());
    let mut signals = Signals::new([SIGUSR1]).unwrap();
    let sig_handle = signals.handle();
    let migrate_pool = SqlitePool::connect_with(
        SqliteConnectOptions::from_str("sqlite://db.sqlite3")
            .unwrap()
            .foreign_keys(false),
    )
    .await
    .unwrap();
    sqlx::migrate!("./migrations").run(&migrate_pool).await.unwrap();
    migrate_pool.close().await;
    let db_pool = SqlitePool::connect_with(
        SqliteConnectOptions::from_str("sqlite://db.sqlite3")
            .unwrap()
            .foreign_keys(true),
    )
```

Replace it with:

```rust
#[tokio::main(flavor = "current_thread")]
async fn main() {
    let port = std::env::var("APP_PORT").unwrap_or_else(|_| "5002".to_string());
    let db_url = std::env::var("APP_DB").unwrap_or_else(|_| "sqlite://db.sqlite3".to_string());
    let mut signals = Signals::new([SIGUSR1]).unwrap();
    let sig_handle = signals.handle();
    let migrate_pool = SqlitePool::connect_with(
        SqliteConnectOptions::from_str(&db_url)
            .unwrap()
            .foreign_keys(false),
    )
    .await
    .unwrap();
    sqlx::migrate!("./migrations").run(&migrate_pool).await.unwrap();
    migrate_pool.close().await;
    let db_pool = SqlitePool::connect_with(
        SqliteConnectOptions::from_str(&db_url)
            .unwrap()
            .foreign_keys(true),
    )
```

- [ ] **Step 3: Deploy and verify the app still starts normally**

```bash
config\update.bat
```

No `APP_DB` is set in production, so it defaults to `"sqlite://db.sqlite3"` — identical to the previous behaviour. The app must load at its URL. If the build fails, check that both `from_str` calls were updated and that `&db_url` is correctly referenced.

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "feat: read APP_DB env var for database path (test isolation)"
```

---

## Task 3: Create `config/test.sh`

**Files:**
- Create: `config/test.sh`

`test.sh` is designed to be called from `syncslide-websocket/` (the same directory `cargo build` and `cargo test` run from). All paths are relative to that working directory.

The `trap cleanup EXIT` ensures the binary is killed and `test.sqlite3` is deleted whether tests pass or fail. Without this, a failed test run would leave the binary running and block port 5003 on the next deploy.

**Key:** `ORIG_DIR` is captured before any `cd` so that `rm -f "$ORIG_DIR/$DB"` in the trap works correctly even after `cd ../tests`. The `DATABASE_URL` env var is **not** read by the binary — only `APP_DB` is, which is why `APP_DB="sqlite://$DB"` is used here instead.

- [ ] **Step 1: Create `config/test.sh`**

```bash
#!/usr/bin/env bash
set -e

PORT=5003
DB=test.sqlite3
# Capture CWD now so the trap cleanup can find test.sqlite3 correctly
# even after 'cd ../tests' changes the working directory for Playwright.
ORIG_DIR="$(pwd)"
PID=""

cleanup() {
    if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; fi
    rm -f "$ORIG_DIR/$DB"
}
trap cleanup EXIT

# Port pre-check: fail clearly rather than having the binary silently not bind
if ss -tlnp | grep -q ":$PORT "; then
    echo "ERROR: port $PORT is already in use. Aborting." >&2
    exit 1
fi

# Start binary from syncslide-websocket/ so relative paths (templates/, js/, css/) resolve correctly.
# APP_DB tells the binary to open test.sqlite3 instead of db.sqlite3.
# Migrations run automatically on startup and create admin/admin + the Demo presentation.
APP_PORT=$PORT APP_DB="sqlite://$DB" ./target/release/syncslide-websocket &
PID=$!

# Retry loop: more reliable than a fixed sleep when the binary startup time varies.
# '|| true' prevents set -e from exiting when curl fails on an early iteration.
for i in $(seq 1 20); do
    curl -sf "http://localhost:$PORT/" > /dev/null && break || true
    sleep 1
done
# Final check outside the loop: this one is allowed to fail, exiting the script.
curl -sf "http://localhost:$PORT/" > /dev/null || {
    echo "ERROR: binary did not become ready on port $PORT after 20s" >&2
    exit 1
}

# Run Playwright from tests/ directory (where package.json and playwright.config.js live).
cd ../tests && npx playwright test

# cleanup() runs here via trap regardless of exit code.
```

- [ ] **Step 2: Commit**

```bash
git add config/test.sh
git commit -m "chore: add Playwright orchestration script (config/test.sh)"
```

---

## Task 4: Install Playwright on VPS (one-time manual setup)

This task is run once on the VPS. It is not part of the automated deploy.

- [ ] **Step 1: Push the scaffold commits**

```bash
config\update.bat
```

Wait for the deploy to complete. The new `tests/` directory is now on the VPS.

- [ ] **Step 2: Install npm dependencies on VPS**

```bash
ssh arch@clippycat.ca "cd ~/syncSlide/tests && npm install"
```

Expected: `node_modules/` populated, no errors.

- [ ] **Step 3: Install browser binaries on VPS**

```bash
ssh arch@clippycat.ca "cd ~/syncSlide/tests && npx playwright install --with-deps chromium webkit"
```

This downloads Chromium and WebKit binaries plus their OS-level dependencies (takes a few minutes). Expected output ends with `Playwright build of chromium ... downloaded` and `Playwright build of webkit ... downloaded`.

- [ ] **Step 4: Commit `package-lock.json`**

`npm install` generates `tests/package-lock.json`. Commit it so all future `npm install` runs use reproducible versions:

```bash
git add tests/package-lock.json
git commit -m "chore: add Playwright lockfile"
config\update.bat
```

- [ ] **Step 5: Verify Playwright can run on VPS**

```bash
ssh arch@clippycat.ca "cd ~/syncSlide/tests && npx playwright --version"
```

Expected: `Version 1.x.x`

---

## Task 5: Write `tests/auth.spec.js`

**Files:**
- Create: `tests/auth.spec.js`

These tests exercise real browser auth flows against the running binary. Each test navigates to a real page, interacts via keyboard-compatible selectors (labels, names, roles), and asserts the result.

**Credential note:** The `admin` user (password `admin`) is created by migrations on every fresh database. No seed file is needed.

**TDD cycle for each test:**
1. Write the test
2. Run it on VPS (`bash ../config/test.sh`) — confirm it passes or reveals a real bug
3. If a test fails because the app behaves differently than expected, investigate before changing the assertion — the failure might be a real bug

- [ ] **Step 1: Create `tests/auth.spec.js`**

```js
// @ts-check
const { test, expect } = require('@playwright/test');

// Reusable helper — logs in as admin/admin and returns after the redirect to /.
async function loginAsAdmin(page) {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
}

// Correct credentials → redirected to /.
test('login with correct credentials redirects to home', async ({ page }) => {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
    // First element announced on arrival: the page's h1.
    await expect(page.locator('main h1')).toBeVisible();
});

// Wrong password → stays on login page, login form is still present.
// The app currently re-renders the login page without an explicit error message.
// This is a WCAG 3.3.1 (Error Identification, Level A) violation — the user is
// given no feedback about what went wrong. The accessibility.spec.js axe audit
// may not catch this automatically (axe cannot detect absent text). A separate
// task should add an error message to the login template; once that is done,
// this test should be updated to assert the error is present.
test('login with wrong password stays on login page', async ({ page }) => {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/auth/login');
    // Login form must remain visible so the user can try again.
    await expect(page.locator('form[action="/auth/login"]')).toBeVisible();
});

// No session → visiting a protected route redirects to login.
test('accessing protected page without session redirects to login', async ({ page }) => {
    await page.goto('/user/presentations');
    await expect(page).toHaveURL('/auth/login');
});

// Valid session → protected page loads.
test('valid session grants access to presentations page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/user/presentations');
    await expect(page).toHaveURL('/user/presentations');
    await expect(page.locator('main h1')).toHaveText('Your Presentations');
});

// Logout → session ended → login link visible in nav.
test('logout ends session and login link appears in nav', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('nav a[href="/auth/logout"]');
    // Wait for the redirect to complete before asserting nav state.
    await page.waitForURL('/');
    // After logout, the login link must appear in the navigation.
    await expect(page.locator('nav a[href="/auth/login"]')).toBeVisible();
});

// After logout, protected pages redirect to login again.
test('after logout, protected pages redirect to login', async ({ page }) => {
    await loginAsAdmin(page);
    await page.click('nav a[href="/auth/logout"]');
    await page.waitForURL('/');
    await page.goto('/user/presentations');
    await expect(page).toHaveURL('/auth/login');
});
```

- [ ] **Step 2: Push and run on VPS to verify all pass**

```bash
git add tests/auth.spec.js
git commit -m "test: add Playwright auth flow tests"
config\update.bat
```

Then run on VPS:
```bash
ssh arch@clippycat.ca "cd ~/syncSlide/syncslide-websocket && bash ../config/test.sh"
```

Expected: 6 tests × 2 browsers = 12 passed, 0 failed.

**If a test fails:** Read the error message first. Common causes:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `TimeoutError: waiting for URL` | Logout doesn't redirect to `/`, or redirect goes elsewhere | Check actual redirect target; update `waitForURL` assertion to match |
| `Locator not found: nav a[href="/auth/logout"]` | Logout link only renders when logged in — page not logged in | Check `loginAsAdmin` actually redirected to `/` before clicking logout |
| Port 5003 busy | Previous test binary not killed | SSH to VPS, run `kill $(lsof -ti:5003)` then retry |

---

## Task 6: Write `tests/accessibility.spec.js`

**Files:**
- Create: `tests/accessibility.spec.js`

Each test loads a page in a real browser and runs axe-core with all WCAG 2.x tags (A, AA, and AAA). **Any violation at any level fails the build.**

**axe-core AAA coverage note:** axe-core implements a subset of WCAG AAA rules — it cannot detect all AAA criteria programmatically (e.g. 1.4.6 Enhanced Contrast requires a human judgement call). The audit is a necessary baseline, not a complete AAA guarantee. Violations it does catch must be fixed.

**What to do when violations are found:** The `results.violations` array contains objects with `id`, `impact`, `description`, `nodes` (the failing HTML elements), and `helpUrl`. Read the `helpUrl` for guidance. Fix the violation in the template before committing the test.

**Framing for screen reader users:** axe-core checks things like: missing labels, incorrect ARIA usage, heading hierarchy, landmark regions, focus order issues. These are exactly the things that break screen reader experience. Treat all violations as blocking.

- [ ] **Step 1: Create `tests/accessibility.spec.js`**

```js
// @ts-check
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

// WCAG A and AA (both 2.0 and 2.1), plus AAA additions from WCAG 2.1,
// plus best-practice rules. Note: axe-core does not have a 'wcag2aaa' tag —
// its AAA coverage is under 'wcag21aaa'. Not all AAA criteria are automatable;
// this catches what axe-core can detect.
const WCAG_TAGS = [
    'wcag2a', 'wcag2aa', 'wcag21aa',
    'wcag21aaa',
    'best-practice',
];

// Helper: logs in as admin/admin and resolves when on /.
async function loginAsAdmin(page) {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
}

// Helper: runs axe on the current page and asserts no violations.
// On failure, formats the violations list for readable output.
async function assertNoViolations(page) {
    const results = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();

    if (results.violations.length > 0) {
        const report = results.violations.map(v =>
            `[${v.impact}] ${v.id}: ${v.description}\n  Help: ${v.helpUrl}\n  Elements: ${v.nodes.map(n => n.html).join(', ')}`
        ).join('\n\n');
        throw new Error(`axe-core found ${results.violations.length} violation(s):\n\n${report}`);
    }
}

// Public pages — no auth needed.
for (const url of ['/', '/auth/login', '/join', '/demo']) {
    test(`${url} has no axe violations`, async ({ page }) => {
        await page.goto(url);
        await assertNoViolations(page);
    });
}

// Protected pages — require a valid session.
test.describe('authenticated pages', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test('/user/presentations has no axe violations', async ({ page }) => {
        await page.goto('/user/presentations');
        await assertNoViolations(page);
    });

    test('/create has no axe violations', async ({ page }) => {
        await page.goto('/create');
        await assertNoViolations(page);
    });

    test('/user/change_pwd has no axe violations', async ({ page }) => {
        await page.goto('/user/change_pwd');
        await assertNoViolations(page);
    });
});
```

- [ ] **Step 2: Push and run on VPS**

```bash
git add tests/accessibility.spec.js
git commit -m "test: add axe-core WCAG accessibility audits"
config\update.bat
```

Then on VPS:
```bash
ssh arch@clippycat.ca "cd ~/syncSlide/syncslide-websocket && bash ../config/test.sh"
```

Expected: all tests pass, or violations are reported with full detail.

**If violations are found:** Read the error output carefully. Each violation names the failing element, the rule, and links to remediation guidance. Fix the violation in the relevant template (`syncslide-websocket/templates/`), then re-run. Do not suppress or exclude violations — fix them.

Common violations to expect and fix:

| Rule ID | What it means | Likely template fix |
|---------|--------------|---------------------|
| `landmark-one-main` | Page has no `<main>` landmark | Wrap page content in `<main>` |
| `region` | Content outside landmark regions | Move stray content into `<main>`, `<nav>`, or `<footer>` |
| `heading-order` | Skipped heading levels | Fix h1→h2→h3 sequence |
| `label` | Form control without accessible label | Add `<label for=...>` or `aria-label` |
| `color-contrast` | Text contrast below 7:1 (AAA) | Adjust CSS in `css/style.css` |

---

## Task 7: Update deploy pipeline

**Files:**
- Modify: `config/update.bat`

The deploy currently stops at the `cargo test` step if Rust tests fail. Phase 2 adds `bash ../config/test.sh` immediately after — if Playwright tests fail, the service does not restart.

- [ ] **Step 1: Read current `update.bat`**

Current content (one line):
```
ssh arch@clippycat.ca "set -eo pipefail; cd syncSlide && git pull origin main --rebase && cd syncslide-websocket && cargo build && cargo test 2>&1 | tee -a /tmp/syncslide-test.log && cd ~ && sudo cp syncSlide/config/syncSlide.conf /etc/caddy/conf.d && sudo chown root:root /etc/caddy/conf.d/syncSlide.conf && sudo systemctl reload caddy && sudo systemctl restart syncSlide"
```

- [ ] **Step 2: Replace with Playwright-aware pipeline**

Replace the entire file with:

```bat
ssh arch@clippycat.ca "set -eo pipefail; cd syncSlide && git pull origin main --rebase && cd syncslide-websocket && cargo build && cargo test 2>&1 | tee -a /tmp/syncslide-test.log && bash ../config/test.sh 2>&1 | tee -a /tmp/syncslide-test.log && cd ~ && sudo cp syncSlide/config/syncSlide.conf /etc/caddy/conf.d && sudo chown root:root /etc/caddy/conf.d/syncSlide.conf && sudo systemctl reload caddy && sudo systemctl restart syncSlide"
```

The only change is `&& bash ../config/test.sh 2>&1 | tee -a /tmp/syncslide-test.log` between `cargo test ...` and the `cd ~` step. Note: `../config/test.sh` uses `../` because the pipeline has already `cd syncslide-websocket` at this point — `config/` is one level up.

- [ ] **Step 3: Deploy and verify the full pipeline works**

```bash
config\update.bat
```

Expected: pull → build → Rust tests → Playwright tests → Caddy reload → service restart. If any step fails, stop and read the error from `/tmp/syncslide-test.log` on the VPS:

```bash
ssh arch@clippycat.ca "tail -100 /tmp/syncslide-test.log"
```

- [ ] **Step 4: Commit**

```bash
git add config/update.bat
git commit -m "ci: add Playwright browser tests to deploy pipeline"
```

---

## What is explicitly out of scope (Phase 2)

- Presentations list keyboard navigation and sort — separate plan
- WebSocket sync (two browser contexts) — separate plan
- Recordings upload and cue editor — separate plan
- axe-core audit of `/{uname}/{pid}` stage and audience views — deferred because those pages require a live WebSocket connection to render meaningfully; separate plan
- Login error message WCAG fix (3.3.1 Error Identification) — axe-core cannot automatically detect absent error text; flagged in `auth.spec.js` comments; fix in a separate task that adds the error message to the login template
- `tests/seed.sql` — the spec called for this with a `testadmin`/`testpass` user, but migrations already create `admin`/`admin` and the Demo presentation on every fresh database, making a seed file unnecessary. If the migration seed is ever removed, `test.sh` must be updated to seed credentials explicitly.
- Firefox — deferred
