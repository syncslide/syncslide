# Accessibility Fixes and Missing Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four WCAG 2.2 AAA accessibility gaps and add missing Playwright test coverage for existing features.

**Architecture:** Tasks 1–4 are TDD a11y fixes (write failing test → fix → pass). Tasks 5–7 are test-only additions for existing working code (write test → verify it passes → commit). All changes are to frontend templates, JS files, and the Playwright test suite; no Rust changes are needed.

**Tech Stack:** Tera templates (HTML), vanilla JS, Playwright (`tests/`). Run tests with `cd tests && npx playwright test --config playwright.config.js`.

---

## Files modified

| File | Change |
|------|--------|
| `syncslide-websocket/templates/nav.html` | Add `aria-pressed` to theme toggle button |
| `syncslide-websocket/js/theme.js` | Sync `aria-pressed` state on toggle and init |
| `syncslide-websocket/templates/edit.html` | Swap Cancel/h1 order in slide dialog; add `tabindex="-1"` to h1 |
| `syncslide-websocket/js/handlers.js` | Focus dialog h1 after `showModal()` |
| `syncslide-websocket/js/audience.js` | Update markdown label on WS name message; announce QR toggle |
| `syncslide-websocket/templates/stage.html` | Add `#qr-announce` live region near QR toggle |
| `tests/theme.spec.js` | Add `aria-pressed` tests |
| `tests/accessibility.spec.js` | Add dialog order test, markdown label sync test |
| `tests/presentations.spec.js` | Add ArrowUp wrap test |
| `tests/edit.spec.js` | New file: slide dialog insert/edit/delete/focus/tab-trap tests |
| `tests/recording-edit.spec.js` | New file: recording edit page structure, rename, timing, upload |

---

## Task 1: Theme toggle `aria-pressed`

The `#theme-toggle` button toggles between dark and light mode but has no `aria-pressed` attribute — screen readers cannot announce its current state.

**Files:**
- Modify: `syncslide-websocket/templates/nav.html:39`
- Modify: `syncslide-websocket/js/theme.js`
- Modify: `tests/theme.spec.js`

- [ ] **Step 1: Write two failing tests in `tests/theme.spec.js`**

Add after the last test in the file (inside the `'theme toggle — public pages'` describe block):

```js
test('theme toggle button has aria-pressed attribute', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('#theme-toggle');
    await expect(btn).toHaveAttribute('aria-pressed');
});

test('theme toggle aria-pressed reflects current state', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('#theme-toggle');
    const html = page.locator('html');

    // aria-pressed must match the current theme
    const theme = await html.getAttribute('data-theme');
    const pressed = await btn.getAttribute('aria-pressed');
    // dark mode = pressed (the button represents "dark mode is on")
    expect(pressed).toBe(theme === 'dark' ? 'true' : 'false');

    // Toggle and verify aria-pressed flips
    await btn.click();
    const newTheme = await html.getAttribute('data-theme');
    const newPressed = await btn.getAttribute('aria-pressed');
    expect(newPressed).toBe(newTheme === 'dark' ? 'true' : 'false');
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
cd tests && npx playwright test theme.spec.js --config playwright.config.js
```

Expected: the two new tests FAIL — `aria-pressed` attribute does not exist yet.

- [ ] **Step 3: Add `aria-pressed` to `nav.html`**

In `syncslide-websocket/templates/nav.html`, change line 39:

```html
<button type="button" id="theme-toggle" aria-pressed="false">Enable dark mode</button>
```

The initial value is `"false"` (light mode default). `theme.js` will correct it on load from localStorage/OS pref.

- [ ] **Step 4: Sync `aria-pressed` in `theme.js`**

Replace the entire file `syncslide-websocket/js/theme.js` with:

```js
(function () {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return; // Button absent on pages without nav — safe no-op

    function label(theme) {
        return theme === 'dark' ? 'Enable light mode' : 'Enable dark mode';
    }

    function syncBtn(theme) {
        btn.textContent = label(theme);
        btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }

    // Defensive sync in case theme-init.js ran before DOM was fully available
    syncBtn(document.documentElement.getAttribute('data-theme'));

    btn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme');
        var next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        syncBtn(next);

        try {
            localStorage.setItem('theme', next);
        } catch (e) { /* private browsing — fall back to session-only state */ }
    });
}());
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd tests && npx playwright test theme.spec.js --config playwright.config.js
```

Expected: all theme tests PASS.

- [ ] **Step 6: Commit**

```bash
git add syncslide-websocket/templates/nav.html syncslide-websocket/js/theme.js tests/theme.spec.js
git commit -m "fix: add aria-pressed to theme toggle button"
```

---

## Task 2: Slide dialog DOM order and focus management

The `<dialog id="slideDialog">` in `edit.html` places the Cancel button before the `<h1>` heading. Per ARIA APG, the heading must be first so screen readers encounter it first when the dialog opens. The dialog also needs to move focus to the heading on open.

**Files:**
- Modify: `syncslide-websocket/templates/edit.html:33-35`
- Modify: `syncslide-websocket/js/handlers.js` (the `openSlideDialog` function)
- Create: `tests/edit.spec.js`

- [ ] **Step 1: Create `tests/edit.spec.js` with two failing tests**

```js
// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

test.describe('edit page — slide dialog', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/admin/1/edit');
        // Wait for the slide table to be populated by JS
        await expect(page.locator('#slideTableBody tr')).not.toHaveCount(0);
    });

    test('slide dialog h1 comes before cancel button in DOM', async ({ page }) => {
        await page.locator('#addSlide').click();
        const dialog = page.locator('#slideDialog');
        await expect(dialog).toBeVisible();

        const inOrder = await dialog.evaluate(el => {
            const h = el.querySelector('h1');
            const c = el.querySelector('#slideDialogCancel');
            // DOCUMENT_POSITION_FOLLOWING means h1 precedes cancel button
            return !!(h.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(inOrder).toBe(true);
    });

    test('slide dialog focuses h1 when opened', async ({ page }) => {
        await page.locator('#addSlide').click();
        const dialog = page.locator('#slideDialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('h1')).toBeFocused();
    });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
cd tests && npx playwright test edit.spec.js --config playwright.config.js
```

Expected: both tests FAIL — Cancel button precedes h1, and h1 does not receive focus.

- [ ] **Step 3: Fix dialog DOM order in `edit.html`**

In `syncslide-websocket/templates/edit.html`, replace lines 33–45:

```html
<dialog id="slideDialog" aria-labelledby="slideDialogHeading">
<h1 id="slideDialogHeading" tabindex="-1"></h1>
<button type="button" id="slideDialogCancel">Cancel</button>
<fieldset id="slideDialogPosition">
<legend>Position</legend>
<label><input type="radio" name="insertPos" value="before"> Before</label>
<label><input type="radio" name="insertPos" value="after" checked> After</label>
</fieldset>
<label id="slideDialogRefLabel">Slide: <select id="insertRefSlide"></select></label>
<label>Title: <input type="text" id="insertTitle"></label><br>
<label>Content (Markdown):<br><textarea id="insertBody" rows="6" style="width:100%"></textarea></label><br>
<button type="button" id="slideDialogApply"></button>
</dialog>
```

Key changes: h1 moved before the cancel button, `tabindex="-1"` added to h1.

- [ ] **Step 4: Move focus to heading in `handlers.js`**

In `syncslide-websocket/js/handlers.js`, in the `openSlideDialog` function, change the last line from:

```js
	dialog.showModal();
```

to:

```js
	dialog.showModal();
	heading.focus();
```

This is at the end of the `openSlideDialog` function, around line 109.

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd tests && npx playwright test edit.spec.js --config playwright.config.js
```

Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add syncslide-websocket/templates/edit.html syncslide-websocket/js/handlers.js tests/edit.spec.js
git commit -m "fix: slide dialog heading before cancel, focus h1 on open"
```

---

## Task 3: Markdown label syncs via WebSocket name update

When a name change arrives over WebSocket (e.g., from a second edit tab), `audience.js` updates the page title, the pres-name span, and the slide h1 — but not the markdown section label (`#input`). That label becomes stale on the receiving tab.

**Files:**
- Modify: `syncslide-websocket/js/audience.js:33-44`
- Modify: `tests/accessibility.spec.js`

- [ ] **Step 1: Write a failing test in `tests/accessibility.spec.js`**

This test opens two edit tabs, renames the presentation in one, and verifies the markdown label updates in the other via WebSocket. Add at the end of the file:

```js
test.describe('markdown label syncs via WebSocket name update', () => {
    test('markdown label on second edit tab updates when name changes via WS', async ({ browser }) => {
        // Tab 1 — the tab that will receive the WS name update
        const ctx1 = await browser.newContext();
        const page1 = await ctx1.newPage();
        const { loginAsAdmin: loginA } = require('./helpers');
        await loginA(page1);
        await page1.goto('/admin/1/edit');
        await expect(page1.locator('#edit-heading')).toBeFocused();

        // Tab 2 — the tab that sends the name change
        const ctx2 = await browser.newContext();
        const page2 = await ctx2.newPage();
        const { loginAsAdmin: loginB } = require('./helpers');
        await loginB(page2);
        await page2.goto('/admin/1/edit');

        // Change name on tab 2 (blur commits via onCommit)
        const newName = 'WS Label Sync Test ' + Date.now();
        await page2.fill('#presName', newName);
        await page2.locator('#presName').blur();

        // Wait for WS propagation and verify label on tab 1
        await expect(page1.locator('#input')).toHaveText('Markdown: ' + newName, { timeout: 5000 });

        // Restore original name
        await page2.fill('#presName', 'Demo');
        await page2.locator('#presName').blur();

        await ctx1.close();
        await ctx2.close();
    });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd tests && npx playwright test accessibility.spec.js --config playwright.config.js --grep "markdown label"
```

Expected: FAIL — the label on tab 1 remains stale.

- [ ] **Step 3: Fix `audience.js` to update the markdown label on name WS messages**

In `syncslide-websocket/js/audience.js`, in the `"name"` message handler block (around line 33), add one line after the existing `presNameEl` update:

```js
	if (message.type === "name") {
		if (presNameEl) presNameEl.textContent = message.data;
		const slideH1 = document.querySelector('#currentSlide h1');
		if (slideH1) slideH1.textContent = message.data;
		const mdLabel = document.getElementById('input');
		if (mdLabel) mdLabel.textContent = 'Markdown: ' + message.data;
		const mode = window.presPageMode;
		document.title = mode === 'stage'
		    ? `${message.data} \u2013 Stage - SyncSlide`
		    : mode === 'edit'
		    ? `${message.data} \u2013 Edit - SyncSlide`
		    : `${message.data} - SyncSlide`;
		return;
	}
```

The only new line is `const mdLabel = document.getElementById('input'); if (mdLabel) mdLabel.textContent = 'Markdown: ' + message.data;`.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd tests && npx playwright test accessibility.spec.js --config playwright.config.js --grep "markdown label"
```

Expected: PASS.

- [ ] **Step 5: Run the full accessibility suite to check for regressions**

```bash
cd tests && npx playwright test accessibility.spec.js --config playwright.config.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add syncslide-websocket/js/audience.js tests/accessibility.spec.js
git commit -m "fix: sync markdown label on WebSocket name update"
```

---

## Task 4: QR toggle live region announcement

Toggling the QR code overlay (`#qrOverlay`) provides no audible announcement — screen readers cannot tell when the QR code appeared or disappeared. Add a `polite` live region that announces the state change.

**Files:**
- Modify: `syncslide-websocket/templates/stage.html`
- Modify: `syncslide-websocket/js/audience.js:1-8`
- Modify: `tests/accessibility.spec.js`

- [ ] **Step 1: Write a failing test in `tests/accessibility.spec.js`**

Add inside the `'authenticated pages'` describe block:

```js
    test('QR toggle announces state change via live region', async ({ page }) => {
        await page.goto('/admin/1');
        const btn = page.locator('#qrToggle');
        const announce = page.locator('#qr-announce');

        // Live region must exist in DOM
        await expect(announce).toBeAttached();

        // Toggle QR on — region must announce
        await btn.click();
        await expect(announce).toContainText(/QR code/i, { timeout: 2000 });

        // Toggle QR off — region must announce
        await btn.click();
        await expect(announce).toContainText(/QR code/i, { timeout: 2000 });
    });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd tests && npx playwright test accessibility.spec.js --config playwright.config.js --grep "QR toggle"
```

Expected: FAIL — `#qr-announce` does not exist.

- [ ] **Step 3: Add `#qr-announce` live region to `stage.html`**

In `syncslide-websocket/templates/stage.html`, after the `<aside id="qrOverlay">` block (line 11), add:

```html
<div id="qr-announce" aria-live="polite" class="sr-only"></div>
```

The block around lines 8–12 should now read:

```html
<button type="button" id="qrToggle" aria-pressed="false" aria-controls="qrOverlay">QR</button>
<aside id="qrOverlay" hidden aria-label="QR code">
<a href="/{{ pres_user.name }}/{{ pres.id }}"><img src="/qr/{{ pres_user.name }}/{{ pres.id }}" alt="{{ pres.name }} QR code" width="150" height="150"></a>
</aside>
<div id="qr-announce" aria-live="polite" class="sr-only"></div>
```

- [ ] **Step 4: Announce in `audience.js`**

In `syncslide-websocket/js/audience.js`, replace the QR toggle handler (lines 1–8):

```js
const qrToggleBtn = document.getElementById('qrToggle');
const qrOverlay = document.getElementById('qrOverlay');
const qrAnnounce = document.getElementById('qr-announce');
if (qrToggleBtn && qrOverlay) {
	qrToggleBtn.addEventListener('click', () => {
		const pressed = qrToggleBtn.getAttribute('aria-pressed') === 'true';
		qrToggleBtn.setAttribute('aria-pressed', String(!pressed));
		qrOverlay.hidden = pressed;
		if (qrAnnounce) {
			qrAnnounce.textContent = pressed ? 'QR code hidden.' : 'QR code shown.';
		}
	});
}
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
cd tests && npx playwright test accessibility.spec.js --config playwright.config.js --grep "QR toggle"
```

Expected: PASS.

- [ ] **Step 6: Run all tests to check for regressions**

```bash
cd tests && npx playwright test --config playwright.config.js
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add syncslide-websocket/templates/stage.html syncslide-websocket/js/audience.js tests/accessibility.spec.js
git commit -m "fix: announce QR toggle state via live region"
```

---

## Task 5: ArrowUp wraps in presentations menu

`ArrowUp` on the first menu item is implemented (presentations.html line 787: `items[(idx - 1 + items.length) % items.length].focus()`) but has no test. Add it.

**Files:**
- Modify: `tests/presentations.spec.js`

- [ ] **Step 1: Add the test**

In `tests/presentations.spec.js`, inside the `'presentations list'` describe block, add after the `'ArrowDown moves focus to next menu item'` test:

```js
    test('ArrowUp on first menu item wraps to last item', async ({ page }) => {
        await page.goto('/user/presentations');
        await page.locator('#actions-btn-1').click();
        // Focus is on first item after open
        await expect(page.locator('#actions-menu-1 [role="menuitem"]').first()).toBeFocused();
        await page.keyboard.press('ArrowUp');
        // Should wrap to the last item
        const items = page.locator('#actions-menu-1 [role="menuitem"]');
        const count = await items.count();
        await expect(items.nth(count - 1)).toBeFocused();
    });
```

- [ ] **Step 2: Run the test to confirm it passes**

```bash
cd tests && npx playwright test presentations.spec.js --config playwright.config.js --grep "ArrowUp"
```

Expected: PASS (the code already wraps correctly).

- [ ] **Step 3: Commit**

```bash
git add tests/presentations.spec.js
git commit -m "test: ArrowUp wraps to last item in presentations actions menu"
```

---

## Task 6: Slide dialog insert, edit, delete, tab-trap

Extend `tests/edit.spec.js` (created in Task 2) with full coverage of the slide dialog flows.

**Files:**
- Modify: `tests/edit.spec.js`

- [ ] **Step 1: Add tests to `tests/edit.spec.js`**

Append these tests inside the `'edit page — slide dialog'` describe block:

```js
    test('slide dialog opens with "Add Slide" heading when Add Slide clicked', async ({ page }) => {
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await expect(page.locator('#slideDialogHeading')).toHaveText('Add Slide');
        await expect(page.locator('#slideDialogApply')).toHaveText('Add');
    });

    test('slide dialog cancel button closes dialog without changes', async ({ page }) => {
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await page.locator('#slideDialogCancel').click();
        await expect(page.locator('#slideDialog')).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });

    test('inserting a slide adds a row to the slide table', async ({ page }) => {
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await page.fill('#insertTitle', 'My New Slide');
        await page.locator('#slideDialogApply').click();
        await expect(page.locator('#slideDialog')).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows + 1);
        await expect(page.locator('#slideTableBody td').filter({ hasText: 'My New Slide' })).toBeVisible();
    });

    test('slide table actions edit opens dialog with "Edit Slide" heading and pre-filled data', async ({ page }) => {
        // Select "Edit" from the first slide's actions dropdown
        const firstSelect = page.locator('#slideTableBody tr').first().locator('select');
        await firstSelect.selectOption('edit');
        await expect(page.locator('#slideDialog')).toBeVisible();
        await expect(page.locator('#slideDialogHeading')).toHaveText('Edit Slide');
        await expect(page.locator('#slideDialogApply')).toHaveText('Apply');
        // Title field must be pre-filled with the slide's title
        const titleValue = await page.locator('#insertTitle').inputValue();
        expect(titleValue.trim().length).toBeGreaterThan(0);
        // Position fieldset must be hidden in edit mode
        await expect(page.locator('#slideDialogPosition')).toBeHidden();
    });

    test('Escape closes the slide dialog', async ({ page }) => {
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#slideDialog')).not.toBeVisible();
    });

    test('Tab key wraps within the slide dialog', async ({ page }) => {
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        // The dialog h1 has tabindex="-1" — it is NOT in the tab sequence.
        // Tab sequence: #slideDialogCancel → radios → ref select → title input → body textarea → #slideDialogApply
        // Tab from #slideDialogApply should wrap back to #slideDialogCancel.
        await page.locator('#slideDialogApply').focus();
        await page.keyboard.press('Tab');
        await expect(page.locator('#slideDialogCancel')).toBeFocused();
    });

    test('delete slide via actions select triggers native confirm and removes row on accept', async ({ page }) => {
        // Accept the native confirm dialog that appears on delete
        page.on('dialog', dialog => dialog.accept());
        const initialRows = await page.locator('#slideTableBody tr').count();
        const firstSelect = page.locator('#slideTableBody tr').first().locator('select');
        await firstSelect.selectOption('delete');
        // After accept, row count decreases
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows - 1);
    });
```

- [ ] **Step 2: Run all edit.spec.js tests**

```bash
cd tests && npx playwright test edit.spec.js --config playwright.config.js
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/edit.spec.js
git commit -m "test: slide dialog insert, edit, delete, tab-trap, and cancel flows"
```

---

## Task 7: Recording edit page tests

Add a new test file for the edit-recording page. This requires first creating a recording via Playwright page interaction, then navigating to its edit page.

**Files:**
- Create: `tests/recording-edit.spec.js`

The URL pattern for the edit-recording page is `/{username}/{pid}/{rid}/edit`.

- [ ] **Step 1: Create `tests/recording-edit.spec.js`**

```js
// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// Creates a recording for pres 1 (admin/Demo) and returns the recording edit URL.
// Requires the page to already be logged in.
async function createAndOpenRecordingEdit(page) {
    await page.goto('/admin/1');
    await expect(page.locator('#stage-heading')).toBeFocused();

    // Expand recording controls
    await page.locator('#record-toggle').click();
    await expect(page.locator('#record-section')).toBeVisible();

    // Start recording
    await page.locator('#recordStart').click();
    await expect(page.locator('#rec-status')).toHaveText('Recording', { timeout: 5000 });

    // Stop recording
    await page.locator('#recordStop').click();
    await expect(page.locator('#rec-status')).toHaveText('Stopped', { timeout: 5000 });

    // Navigate to presentations and find the newest recording for pres 1
    await page.goto('/user/presentations');
    // Expand recordings details for pres 1 (data-id="1")
    const presItem = page.locator('.pres-item[data-id="1"]');
    await presItem.locator('details summary').click();
    // Open the actions menu for the first recording row and click "Edit Recording"
    const firstRecBtn = presItem.locator('[id^="rec-actions-btn-"]').first();
    await firstRecBtn.click();
    const firstRecMenu = presItem.locator('[id^="rec-actions-menu-"]').first();
    await expect(firstRecMenu).toBeVisible();
    // Click "Edit Recording" — this opens the edit page in the same tab
    await firstRecMenu.locator('[role="menuitem"]').filter({ hasText: 'Edit Recording' }).click();
    // Wait for navigation to the edit-recording page
    await page.waitForURL(/\/admin\/1\/\d+\/edit/);
    return page.url();
}

test.describe.configure({ mode: 'serial' });
test.describe('recording edit page', () => {
    let editUrl;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        editUrl = await createAndOpenRecordingEdit(page);
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(editUrl);
        await expect(page.locator('#edit-rec-heading')).toBeFocused();
    });

    test('page h1 receives focus on load', async ({ page }) => {
        await expect(page.locator('#edit-rec-heading')).toBeFocused();
    });

    test('recording name input is present and labelled', async ({ page }) => {
        const input = page.locator('#recName');
        await expect(input).toBeVisible();
        // Label wraps the input (implicit label)
        const label = page.locator('label:has(#recName)');
        await expect(label).toBeAttached();
    });

    test('rename status live region is present', async ({ page }) => {
        await expect(page.locator('#rename-status')).toBeAttached();
        const role = await page.locator('#rename-status').getAttribute('aria-live');
        expect(role).toBe('polite');
    });

    test('timing section has a visible heading', async ({ page }) => {
        await expect(page.locator('#timing-heading')).toBeVisible();
        await expect(page.locator('#timing-heading')).toHaveText('Edit Timing');
    });

    test('save and discard buttons are hidden on load', async ({ page }) => {
        await expect(page.locator('#saveTimingBtn')).toBeHidden();
        await expect(page.locator('#discardTimingBtn')).toBeHidden();
    });

    test('cue table has correct column headers', async ({ page }) => {
        const headers = page.locator('#cueTableBody').locator('..').locator('thead th');
        await expect(headers).toHaveCount(3);
        await expect(headers.nth(0)).toContainText('Slide');
        await expect(headers.nth(1)).toContainText('Title');
        await expect(headers.nth(2)).toContainText('Start Time');
    });

    test('timing status live region is present', async ({ page }) => {
        await expect(page.locator('#timing-status')).toBeAttached();
        const role = await page.locator('#timing-status').getAttribute('aria-live');
        expect(role).toBe('polite');
    });

    test('Replace Files section heading is visible', async ({ page }) => {
        await expect(page.locator('#files-heading')).toBeVisible();
        await expect(page.locator('#files-heading')).toHaveText('Replace Files');
    });

    test('video file input accepts video/* and is labelled', async ({ page }) => {
        const input = page.locator('#replaceFilesForm input[name="video"]');
        await expect(input).toBeVisible();
        await expect(input).toHaveAttribute('accept', 'video/*');
        const label = page.locator('label:has(input[name="video"])');
        await expect(label).toBeAttached();
    });

    test('captions file input accepts .vtt and is labelled', async ({ page }) => {
        const input = page.locator('#replaceFilesForm input[name="captions"]');
        await expect(input).toBeVisible();
        const accept = await input.getAttribute('accept');
        expect(accept).toContain('.vtt');
        const label = page.locator('label:has(input[name="captions"])');
        await expect(label).toBeAttached();
    });

    test('files status live region is present', async ({ page }) => {
        await expect(page.locator('#files-status')).toBeAttached();
        const role = await page.locator('#files-status').getAttribute('aria-live');
        expect(role).toBe('polite');
    });

    test('"Watch recording" link is present and links to playback page', async ({ page }) => {
        const link = page.locator('a').filter({ hasText: 'Watch recording' });
        await expect(link).toBeVisible();
        const href = await link.getAttribute('href');
        expect(href).toMatch(/\/admin\/1\/\d+$/);
    });

    test('breadcrumb has 5 items with aria-current on last', async ({ page }) => {
        const nav = page.locator('nav[aria-label="Breadcrumb"]');
        await expect(nav).toBeVisible();
        const items = nav.locator('li');
        await expect(items).toHaveCount(5);
        await expect(items.last()).toHaveAttribute('aria-current', 'page');
    });
});
```

- [ ] **Step 2: Run the recording edit tests**

```bash
cd tests && npx playwright test recording-edit.spec.js --config playwright.config.js
```

Expected: all PASS (the edit-recording page is already well-structured).

- [ ] **Step 3: Run the full suite**

```bash
cd tests && npx playwright test --config playwright.config.js
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/recording-edit.spec.js
git commit -m "test: recording edit page structure, rename, timing, and file upload"
```

---

## Self-review

**Spec coverage:**
- Theme toggle aria-pressed — Task 1 ✓
- Slide dialog heading before cancel — Task 2 ✓
- Markdown label WS sync — Task 3 ✓
- QR toggle live region — Task 4 ✓
- ArrowUp wraps in menu — Task 5 ✓
- Slide dialog insert/edit/delete/tab-trap — Task 6 ✓
- Recording edit page tests — Task 7 ✓

**Skipped (false positives from audit):**
- Filter button aria-label: already dynamically updated in `presentations.html:488` — no fix needed
- Focus on audience slide change: `#currentSlide` already has `aria-live="polite"` — screen readers are notified; moving focus on every slide change would be disruptive to keyboard users who are navigating other parts of the page

**Placeholder scan:** None found.

**Type/name consistency:** All IDs used in tests (`#slideDialogHeading`, `#slideDialogCancel`, `#slideDialogApply`, `#insertTitle`, `#insertBody`, `#insertRefSlide`, `#record-toggle`, `#recordStart`, `#recordStop`, `#rec-status`, `#recName`, `#cueTableBody`, `#saveTimingBtn`, `#discardTimingBtn`, `#qr-announce`) match the templates and JS files read during planning.
