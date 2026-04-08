# Stage Toolbar Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the stage page, stack the QR button and Record disclosure button on separate rows and relocate the live recording timer from inside the Record button label into the expanded recording detail panel (labelled "Elapsed: 00:00:00").

**Architecture:** Template + CSS only. No JavaScript changes: `recording.js` targets `#rec-timer` by id and is indifferent to DOM location. No backend changes. No DB changes. Covered by one new Playwright test that locks in the new DOM contract.

**Tech Stack:** Tera templates (`.html`), plain CSS, Playwright (Chromium) for tests.

**Spec:** `docs/superpowers/specs/2026-04-08-stage-toolbar-layout-design.md`

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `syncslide-websocket/templates/stage.html` | Modify | Rewrite Record toggle button label (drop timer span); insert `<p>Elapsed: …</p>` as first child of `#record-section`. |
| `syncslide-websocket/css/style.css` | Modify | Add stacking rule for `#qrToggle, #record-toggle` in the "in stage" section. |
| `tests/stage-toolbar.spec.js` | Create | New Playwright spec that locks in: (a) QR and Record toggles are separate rows visually, (b) Record button label no longer contains the timer, (c) `#rec-timer` lives inside `#record-section` and updates while recording. |

No files are deleted. No migrations. No `cargo sqlx prepare`. No `recording.js` edits.

---

## Task 1: Write the failing Playwright spec

**Files:**
- Create: `tests/stage-toolbar.spec.js`

This task pins down the new DOM contract before touching the template. The test will fail against the current code (timer still inside the button, buttons on same line).

- [ ] **Step 1: Look at an existing spec for the correct login/fixture pattern**

  Read `tests/recording-edit.spec.js` to see how existing recording tests log in as admin and reach the stage page. Reuse the exact same login/navigation pattern — do NOT invent a new one.

  Run:
  ```bash
  cat /home/melody/syncSlide/tests/recording-edit.spec.js
  ```

  Expected: the file opens with an admin login helper and navigates to a stage URL like `/admin/{pid}`. Note the exact URL shape, credentials, and any `beforeEach` setup.

- [ ] **Step 2: Write the new spec file**

  Create `tests/stage-toolbar.spec.js` with four tests. Reuse the login/navigation approach from `tests/recording-edit.spec.js` verbatim (same credentials, same URL pattern, same waits). The body below shows the assertions — wrap them in whatever `test.beforeEach` / login helper matches the existing spec.

  ```javascript
  // tests/stage-toolbar.spec.js
  // Locks in the stage toolbar layout:
  //  - #qrToggle and #record-toggle each occupy their own visual row
  //  - Record button label is just "Record: <status>" — no timer inside
  //  - #rec-timer lives inside #record-section with an "Elapsed:" label
  //  - The timer still updates while recording
  //
  // Reuse the admin login / stage navigation pattern from recording-edit.spec.js.

  const { test, expect } = require('@playwright/test');

  // TODO (step author): copy the login + navigation setup from
  // tests/recording-edit.spec.js here, unchanged. The tests below assume
  // that after the setup `page` is on the stage page for a presentation
  // owned by admin, with #qrToggle, #record-toggle, and #record-section
  // all in the DOM.

  test.describe('stage toolbar layout', () => {
    test('QR and Record toggles are on separate visual rows', async ({ page }) => {
      const qrBox = await page.locator('#qrToggle').boundingBox();
      const recBox = await page.locator('#record-toggle').boundingBox();
      expect(qrBox).not.toBeNull();
      expect(recBox).not.toBeNull();
      // Record toggle must start strictly below the bottom edge of the QR toggle.
      expect(recBox.y).toBeGreaterThanOrEqual(qrBox.y + qrBox.height);
    });

    test('Record button accessible name contains status but not a timer', async ({ page }) => {
      const btn = page.locator('#record-toggle');
      // Accessible name should be exactly the status phrase, no elapsed-time component.
      await expect(btn).toHaveAccessibleName('Record: Stopped');
      // Defensive: no "HH:MM:SS" substring inside the button's text content.
      const text = (await btn.textContent()) || '';
      expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    });

    test('#rec-timer lives inside #record-section with an Elapsed label', async ({ page }) => {
      // Expand the disclosure so the panel is visible.
      await page.locator('#record-toggle').click();
      const section = page.locator('#record-section');
      await expect(section).toBeVisible();
      // Timer must be a descendant of the section, not of the toggle button.
      await expect(section.locator('#rec-timer')).toHaveCount(1);
      await expect(page.locator('#record-toggle #rec-timer')).toHaveCount(0);
      // The "Elapsed:" label is present in the section's text.
      await expect(section).toContainText('Elapsed:');
      // Initial timer value.
      await expect(page.locator('#rec-timer')).toHaveText('00:00:00');
    });

    test('timer in the detail panel updates while recording', async ({ page }) => {
      await page.locator('#record-toggle').click();
      await page.locator('#recordStart').click();
      await expect(page.locator('#rec-status')).toHaveText('Recording', { timeout: 5000 });
      // Wait long enough for at least one tick (recording.js updates every 1s).
      await expect(page.locator('#rec-timer')).not.toHaveText('00:00:00', { timeout: 5000 });
      // Clean up: stop the recording so we don't leave state behind.
      await page.locator('#recordStop').click();
      await expect(page.locator('#rec-status')).toHaveText('Stopped', { timeout: 5000 });
    });
  });
  ```

  Note: leave the `TODO (step author)` marker in the file **only for the duration of this step**. Step 3 replaces it with the actual login/navigation code from `recording-edit.spec.js`.

- [ ] **Step 3: Paste the admin login / navigation boilerplate from `recording-edit.spec.js`**

  Replace the `TODO (step author)` block with the exact login/navigation code from `tests/recording-edit.spec.js` (the part that runs before the first `test(...)` call and/or inside `test.beforeEach`). Do not rewrite it. If that spec uses a shared helper imported from another file, import the same helper here.

  After this step, `tests/stage-toolbar.spec.js` must be runnable with no `TODO` markers left.

- [ ] **Step 4: Run the new spec against the current (unchanged) code to confirm it fails for the right reasons**

  Run:
  ```bash
  cd /home/melody/syncSlide/tests && npx playwright test --config playwright.config.js stage-toolbar.spec.js
  ```

  Expected failures (all four tests fail):
  1. "QR and Record toggles are on separate visual rows" — fails because the two buttons currently share a row, so `recBox.y < qrBox.y + qrBox.height`.
  2. "Record button accessible name contains status but not a timer" — fails because the current accessible name is something like `Record: Stopped — 00:00:00` and matches the `\d{2}:\d{2}:\d{2}` regex.
  3. "#rec-timer lives inside #record-section with an Elapsed label" — fails because `#rec-timer` is currently a descendant of `#record-toggle`, not `#record-section`, and the section does not contain the text "Elapsed:".
  4. "timer in the detail panel updates while recording" — may pass incidentally (since `#rec-timer` exists and updates), but do not treat that as a win; the other three failures are what matter.

  If any test fails for a different reason (e.g. login failure, page not loaded), fix the login/navigation block before moving on.

- [ ] **Step 5: Commit the failing test**

  ```bash
  cd /home/melody/syncSlide
  git add tests/stage-toolbar.spec.js
  git commit -m "test: lock in stage toolbar layout (stacked toggles, timer in detail)"
  ```

---

## Task 2: Stack QR and Record toggle buttons

**Files:**
- Modify: `syncslide-websocket/css/style.css` (add rule in the "in stage" section around line 155)

- [ ] **Step 1: Read the target section of the stylesheet**

  Use the Read tool on `syncslide-websocket/css/style.css` lines 150–165. Confirm the "in stage" comment block is present and the existing rules look like:
  ```css
  /* in stage: */
  #markdown-input { display: block; width: 90%; margin: auto; height: 12em; }

  #qrOverlay { position: fixed; bottom: 1em; right: 1em; background: #fff; border: 2px solid var(--qr-border); padding: 8px; border-radius: 4px; z-index: 100; line-height: 0; }
  #qrOverlay img { width: 150px; height: 150px; margin: 0; }
  #qrToggle[aria-pressed="true"] { outline: 4px solid var(--qr-outline); }
  ```

- [ ] **Step 2: Add the stacking rule for the two toggles**

  Insert a new rule immediately AFTER the existing `#qrToggle[aria-pressed="true"]` rule and BEFORE the blank line that separates the "in stage" block from the "dialog / modal" block.

  New content to add:
  ```css
  #qrToggle,
  #record-toggle { display: block; width: fit-content; margin-block: .4em; }
  ```

  Why each value:
  - `display: block` — takes the button out of inline-block flow so it occupies its own row.
  - `width: fit-content` — prevents the button from stretching to container width; keeps it sized to its label, which is the expected visual treatment for a toolbar-style control.
  - `margin-block: .4em` — small vertical rhythm between the two rows and the surrounding content.

  Do NOT reorder or delete any existing rules in this section.

- [ ] **Step 3: Run the Rust build to confirm no asset pipeline breakage**

  The CSS file is served as a static asset by the Rust binary, so there is no build step for CSS itself, but do a sanity build of the server:
  ```bash
  cd /home/melody/syncSlide/syncslide-websocket && cargo build
  ```
  Expected: a clean build (warnings are acceptable; errors are not).

- [ ] **Step 4: Re-run only the "separate rows" test to confirm it now passes**

  Run:
  ```bash
  cd /home/melody/syncSlide/tests && npx playwright test --config playwright.config.js stage-toolbar.spec.js -g "separate visual rows"
  ```
  Expected: PASS. The other three tests in the file are still expected to FAIL at this point — that is correct; Task 3 fixes them.

- [ ] **Step 5: Commit**

  ```bash
  cd /home/melody/syncSlide
  git add syncslide-websocket/css/style.css
  git commit -m "style: stack QR and Record toggle buttons on separate rows"
  ```

---

## Task 3: Move timer out of button label and into recording detail

**Files:**
- Modify: `syncslide-websocket/templates/stage.html` (lines 12, 14–19)

- [ ] **Step 1: Read the current template**

  Use the Read tool on `syncslide-websocket/templates/stage.html`. Confirm the current contents of lines 12 and 14–19 match:

  ```html
  <button type="button" id="record-toggle" aria-expanded="false" aria-controls="record-section">Record: <span id="rec-status">Stopped</span> — <span id="rec-timer">00:00:00</span></button>
  <div id="rec-announce" aria-live="polite" class="sr-only"></div>
  <section id="record-section" aria-label="Recording controls" hidden>
  <button type="button" id="recordStart">Start recording</button>
  <button type="button" id="recordPause" hidden>Pause</button>
  <button type="button" id="recordResume" hidden>Resume</button>
  <button type="button" id="recordStop" hidden>Stop</button>
  </section>
  ```

  If they don't match, stop and reconcile with the maintainer — something has changed since the plan was written.

- [ ] **Step 2: Rewrite the Record toggle button so the label is status-only**

  Replace line 12 with:
  ```html
  <button type="button" id="record-toggle" aria-expanded="false" aria-controls="record-section">Record: <span id="rec-status">Stopped</span></button>
  ```

  The change is surgical: drop the trailing ` — <span id="rec-timer">00:00:00</span>` from the button's inner content. Everything else on the line (attributes, `Record: ` prefix, `#rec-status` span) is preserved.

- [ ] **Step 3: Insert the "Elapsed:" paragraph as the first child of `#record-section`**

  Inside the `<section id="record-section" …>`, add a new line directly after the opening `<section>` tag and before `<button type="button" id="recordStart">`. After this edit, the section must read:

  ```html
  <section id="record-section" aria-label="Recording controls" hidden>
  <p>Elapsed: <span id="rec-timer">00:00:00</span></p>
  <button type="button" id="recordStart">Start recording</button>
  <button type="button" id="recordPause" hidden>Pause</button>
  <button type="button" id="recordResume" hidden>Resume</button>
  <button type="button" id="recordStop" hidden>Stop</button>
  </section>
  ```

  The `#rec-timer` id MUST be preserved exactly — `recording.js` reads it by id (`document.getElementById('rec-timer')`). If you rename it, the timer stops updating.

- [ ] **Step 4: Sanity-check: no other template has its own `#rec-timer`**

  Run:
  ```bash
  cd /home/melody/syncSlide
  ```
  Then search with the Grep tool for `rec-timer` across `syncslide-websocket/templates`. Expected: exactly one occurrence, in `stage.html`, on the new `<p>Elapsed: …</p>` line. If you see more, something went wrong with the edit — reconcile before moving on.

- [ ] **Step 5: Rebuild to make sure templates still parse**

  The Tera templates are loaded at runtime, not compile-time, so `cargo build` will not catch template syntax errors by itself. But a full build is still a useful sanity check:
  ```bash
  cd /home/melody/syncSlide/syncslide-websocket && cargo build
  ```
  Expected: clean build.

- [ ] **Step 6: Run the full new spec and confirm all four tests pass**

  Run:
  ```bash
  cd /home/melody/syncSlide/tests && npx playwright test --config playwright.config.js stage-toolbar.spec.js
  ```
  Expected: 4 passed, 0 failed. If a test fails:
  - "separate visual rows" — CSS rule from Task 2 regressed. Check `css/style.css` still has the `#qrToggle, #record-toggle` rule.
  - "accessible name contains status but not a timer" — the button label still contains `#rec-timer`. Re-check Step 2.
  - "#rec-timer lives inside #record-section" — either the template edit in Step 3 was skipped, or the `#rec-timer` span is still a child of `#record-toggle`. Re-check Steps 2 and 3.
  - "timer updates while recording" — a backend recording failure (WebSocket disconnect, auth issue). This would not be caused by the template edit; debug separately.

- [ ] **Step 7: Run the existing recording test suite to confirm no regressions**

  Run:
  ```bash
  cd /home/melody/syncSlide/tests && npx playwright test --config playwright.config.js recording-edit.spec.js websocket.spec.js play.spec.js audience.spec.js
  ```
  Expected: all tests pass. Key things being re-validated:
  - `recording-edit.spec.js` — clicks `#record-toggle` and `#recordStart`, reads `#rec-status`. All three selectors still exist and behave the same.
  - `websocket.spec.js` — same selectors, multi-page recording sync.
  - `play.spec.js` — same recording start/stop flow.
  - `audience.spec.js` — QR overlay behaviour, which is unaffected by the stacking rule (the overlay is `position: fixed` and doesn't care about the toggle button's flow).

  If any test fails: do NOT just delete or skip it. Read the failure, correlate with what you changed, and fix the root cause. The most likely failure mode is a test that accidentally depends on the old button label text — update it to match the new label.

- [ ] **Step 8: Commit**

  ```bash
  cd /home/melody/syncSlide
  git add syncslide-websocket/templates/stage.html
  git commit -m "stage: move recording timer from button label into detail panel"
  ```

---

## Task 4: Run the full test suite and verify

**Files:** none modified

- [ ] **Step 1: Full Rust test run**

  ```bash
  cd /home/melody/syncSlide/syncslide-websocket && cargo test
  ```
  Expected: all tests pass. No new Rust tests were added, so this is purely a regression check. The template/CSS changes don't touch any Rust code, so a clean run is expected.

- [ ] **Step 2: Full Playwright test run**

  ```bash
  cd /home/melody/syncSlide/tests && npx playwright test --config playwright.config.js
  ```
  Expected: all tests pass, including the new `stage-toolbar.spec.js`. If an unrelated spec fails, do NOT lump it into this change — flag it to the maintainer as a pre-existing issue and leave it alone.

- [ ] **Step 3: Manual verification against the running server (optional but encouraged)**

  If there is a locally running `syncslide-websocket` instance (or you are comfortable starting one), open the stage page for any admin-owned presentation and confirm by screen reader / focus order:
  - The first control after the `<h1>` is `#qrToggle` ("QR").
  - The second control, on a new row, is `#record-toggle` with accessible name `Record: Stopped`.
  - Activating `#record-toggle` reveals the panel, whose first announced element is the paragraph `Elapsed: 00:00:00`, followed by the Start button.
  - Starting a recording updates `#rec-status` to "Recording" and the `#rec-timer` inside the panel ticks forward. The Record toggle button's own accessible name stays `Record: Recording` — no timer value inside.

  This step does not gate completion; if you can't easily run the server, skip it.

- [ ] **Step 4: No final commit**

  There is nothing to commit in Task 4 — it is pure verification. Do NOT create an empty commit.

---

## Self-Review Notes

**Spec coverage:**
- Spec §1 "Separate rows for QR and Record toggle" → Task 2.
- Spec §2 "Record toggle button shows status only" → Task 3, Step 2.
- Spec §3 "Timer moves into the recording detail panel" → Task 3, Step 3.
- Spec §4 "Timer is not a live region" → enforced implicitly: the new `<p>Elapsed: …</p>` has no `aria-live` attribute, and the plan does not add one. No explicit task is needed because there is nothing to do.
- Spec "Test impact" paragraph → Task 3, Step 7 explicitly re-runs the specs listed as potentially impacted (`recording-edit`, `websocket`, `play`, `audience`).

**Known unknowns:**
- The exact admin login / navigation helper used in `tests/recording-edit.spec.js` is not reproduced verbatim in this plan — Task 1 Step 1 instructs the implementer to read that file and copy the pattern. This is deliberate: hardcoding the credentials and URL into two places invites drift, and the existing spec is the authoritative pattern.

**No placeholders:** every code block is complete and ready to paste. No "TBD", no "similar to above", no "add error handling". The Task 1 TODO marker is explicitly resolved by Task 1 Step 3 before the failing-test commit.
