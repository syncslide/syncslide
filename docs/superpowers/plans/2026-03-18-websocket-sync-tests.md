# WebSocket Sync Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright tests that verify two distinct WebSocket guarantees: (1) a new audience connection receives the current slide state from the server, and (2) a slide change by the presenter propagates in real time to an already-connected audience.

**Architecture:** Two tests in a new `tests/websocket.spec.js` file. Both use Playwright's `browser` fixture to create independent browser contexts — one logged in as the presenter (admin), one anonymous as audience. The server already running under `test.sh` is the single source of truth; both contexts connect to `/ws/{pid}` through the presentation route `/{uname}/{pid}`. No new Playwright infrastructure or dependencies are needed.

**Tech Stack:** Playwright (chromium only, per existing `playwright.config.js`), the Demo presentation seeded by migrations (`id=1`, user=`admin`, URL `/admin/1`), existing `tests/playwright.config.js`.

**Prerequisite:** The `2026-03-18-rust-expansion.md` plan must be completed first. That plan brings the total to **13 Rust + 22 Playwright = 35 tests**. This plan adds 2 Playwright tests to reach **37 total**.

**Context cleanup note:** Both tests call `presCtx.close()` / `audCtx.close()` at the end of the happy path. If an assertion fails before those lines, Playwright automatically closes all contexts on test teardown — no context leak will occur. The explicit `close()` calls are stylistic and optional, but kept for clarity.

---

## Background

### How WebSocket sync works

1. Both presenter and audience navigate to `/{uname}/{pid}`. The `present` handler serves `stage.html` to the owner, `audience.html` to everyone else.
2. Both pages run `common.js`, which opens a WebSocket to `/ws/{pid}`.
3. On every new WebSocket connection, the server immediately sends two messages: `{"type":"text","data":"<markdown>"}` then `{"type":"slide","data":<index>}`.
4. The `text` message is cached in `TEXT_TO_RENDER` in `audience.js` (not rendered yet).
5. The `slide` message triggers `handleUpdate`, which renders the slide at that index into `#currentSlide`.
6. When the presenter selects a new slide via `#goTo`, `handlers.js` fires `updateSlide()` on the `input` event, which sends `{"type":"slide","data":<index>}` to the server. The server updates in-memory state and broadcasts to all connected clients — including the audience.
7. `#currentSlide` is `aria-live="polite"`. Every content update is a live region announcement. These tests verify that the live region actually changes, which is the screen-reader-accessible mechanism by which audience members know what slide is currently shown.

### Demo presentation

Migrations always seed a "Demo" presentation (`id=1`, user=`admin`, DB content set at startup). Its slides split at `##` headings:

| Index | `#currentSlide h2` text |
|-------|------------------------|
| 0     | Introduction to the Problem |
| 1     | What is SyncSlide? |
| 2     | Demo: HTML and CSS |
| … | … |

Stage URL: `/admin/1`. Navigating as admin → `stage.html` (with `#goTo` select). Navigating as non-admin or anonymous → `audience.html` (read-only).

### Reliable wait: WS round-trip confirmation

`selectOption('#goTo', '1')` dispatches the `input` event on the select. `handlers.js` sends the WS message. The server broadcasts back to all clients, including the presenter. When `presPage.locator('#currentSlide h2')` shows "What is SyncSlide?", the WS round-trip is complete and the server's in-memory state is definitely slide 1. This is more reliable than a fixed `waitForTimeout`.

### Why `browser` fixture

Playwright's `page` fixture gives one browser context (one session, one set of cookies). Multi-context tests need the `browser` fixture to create independent sessions:

```javascript
test('...', async ({ browser }) => {
    const presCtx = await browser.newContext();
    const presPage = await presCtx.newPage();
    // ...
    await presCtx.close();
});
```

---

## File structure

| File | Change |
|------|--------|
| `tests/websocket.spec.js` | **Create** — two WebSocket sync tests |

No Rust changes. No new dependencies.

---

## Task 1: Audience receives current slide state on connect

**Files:**
- Create: `tests/websocket.spec.js`

The server delivers `Text` + `Slide` to every new WebSocket connection. This test verifies that an audience member who connects after the presenter has navigated to slide 1 receives slide 1, not slide 0.

- [ ] **Step 1: Create `tests/websocket.spec.js`**

```javascript
// @ts-check
const { test, expect } = require('@playwright/test');

// The Demo presentation is always seeded by migrations.
// admin owns it; navigating as admin → stage.html; anonymous → audience.html.
const STAGE_URL = '/admin/1';

// Helper — logs in as admin/admin in the given page.
async function loginAsAdmin(page) {
    await page.goto('/auth/login');
    await page.fill('[name="username"]', 'admin');
    await page.fill('[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
}

test.describe('websocket sync', () => {
    // An audience member connecting after the presenter has already navigated
    // to a particular slide must receive that slide — not always slide 0.
    // The server holds current slide state in memory and sends it on every
    // new WebSocket connection (Text + Slide messages).
    //
    // This verifies that #currentSlide (aria-live="polite") announces the correct
    // current slide to a screen reader user who joins mid-presentation.
    test('audience receives current slide state on connect', async ({ browser }) => {
        // Presenter connects and navigates to slide 1.
        const presCtx = await browser.newContext();
        const presPage = await presCtx.newPage();
        await loginAsAdmin(presPage);
        await presPage.goto(STAGE_URL);

        // Wait for #goTo options to be populated by JS (getH2s runs on load).
        await expect(presPage.locator('#goTo option')).not.toHaveCount(0);

        // Navigate presenter to slide 1 (index 1 = "What is SyncSlide?").
        // handlers.js sends {"type":"slide","data":1} on the 'input' event.
        await presPage.selectOption('#goTo', '1');

        // Wait for the WS round-trip to complete: the server broadcasts back
        // to the presenter, which re-renders #currentSlide on the stage page.
        // When this assertion passes, the server's in-memory state is slide 1.
        await expect(presPage.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');

        // Audience connects now — server HTTP handler reads current_slide_index (1)
        // for the server-rendered initial_slide, and WS delivers Slide(1) on connect.
        const audCtx = await browser.newContext();
        const audPage = await audCtx.newPage();
        await audPage.goto(STAGE_URL);

        // #currentSlide must show slide 1 (the current slide), not slide 0.
        await expect(audPage.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');

        await presCtx.close();
        await audCtx.close();
    });
});
```

- [ ] **Step 2: Deploy and verify**

```bash
config\update.bat
```

Then on VPS:
```bash
ssh arch@clippycat.ca "cd ~/syncSlide/syncslide-websocket && ./test.sh 2>&1 | tail -30"
```

Expected: all existing tests pass, plus the new one (`websocket sync > audience receives current slide state on connect`).

- [ ] **Step 3: Commit**

```bash
git add tests/websocket.spec.js
git commit -m "test: verify audience receives current slide state on WebSocket connect"
```

---

## Task 2: Live slide sync propagates to connected audience

**Files:**
- Modify: `tests/websocket.spec.js`

Both the presenter and the audience are connected simultaneously. When the presenter changes slide, the server broadcasts the `Slide` message to all connected WebSocket clients, including the already-connected audience. The audience's `#currentSlide` live region updates.

- [ ] **Step 1: Add the live sync test inside the `test.describe` block**

Append inside `test.describe('websocket sync', () => { ... })`, before the closing `});` of the describe block, after the first test:

```javascript
    // When the presenter changes slide during a live session, the audience's
    // #currentSlide (aria-live="polite") must update immediately.
    // This is the core sync guarantee: screen reader users tracking the presentation
    // on their own device hear the new slide announced without any manual action.
    test('presenter slide change propagates to connected audience', async ({ browser }) => {
        // Both contexts connect to the same stage URL simultaneously.
        const presCtx = await browser.newContext();
        const presPage = await presCtx.newPage();
        await loginAsAdmin(presPage);
        await presPage.goto(STAGE_URL);

        const audCtx = await browser.newContext();
        const audPage = await audCtx.newPage();
        await audPage.goto(STAGE_URL);

        // Wait for both WS connections to deliver initial state (Text + Slide(0)).
        // When the audience's #currentSlide h2 is visible, its WS is connected
        // and the initial slide has been rendered.
        await expect(audPage.locator('#currentSlide h2')).toBeVisible();

        // Confirm audience starts on slide 0 ("Introduction to the Problem").
        await expect(audPage.locator('#currentSlide h2')).toHaveText('Introduction to the Problem');

        // Presenter navigates to slide 1.
        await expect(presPage.locator('#goTo option')).not.toHaveCount(0);
        await presPage.selectOption('#goTo', '1');

        // The server broadcasts Slide(1) to all connected clients.
        // Audience's handleUpdate re-renders #currentSlide with slide 1 content.
        await expect(audPage.locator('#currentSlide h2')).toHaveText('What is SyncSlide?');

        await presCtx.close();
        await audCtx.close();
    });
```

- [ ] **Step 2: Deploy and verify**

```bash
config\update.bat
```

Then on VPS:
```bash
ssh arch@clippycat.ca "cd ~/syncSlide/syncslide-websocket && ./test.sh 2>&1 | tail -30"
```

Expected: all 22 prior Playwright tests pass, plus 2 new WebSocket tests = 24 Playwright. Plus 13 Rust = **37 total**.

- [ ] **Step 3: Commit**

```bash
git add tests/websocket.spec.js
git commit -m "test: verify live slide sync propagates to connected audience"
```

---

## Expected final test count

13 Rust + 24 Playwright = **37 total tests** on every deploy.

---

## What is explicitly out of scope

- **Text (markdown) sync** — `TEXT_TO_RENDER` is updated by the `text` message but re-rendered only on the next `slide` message. The live sync test implicitly covers text delivery (the audience must receive `Text` before `Slide` for the render to work at all). A dedicated text test adds little additional coverage.
- **`aria-live` announcement timing** — screen reader announcement timing is not testable with Playwright alone; that requires AT-driver integration. These tests verify the DOM update, which is the prerequisite.
- **Recording upload** — needs multipart file fixtures; separate plan.
- **WebKit** — VPS Arch Linux ICU 78 incompatible with Playwright's WebKit build; see `playwright.config.js` comment.
