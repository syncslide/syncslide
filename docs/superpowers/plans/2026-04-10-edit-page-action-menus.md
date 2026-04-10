# Edit Page Action Menus & Markdown Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slide table's `<select>` dropdowns with APG Menu Button pattern and move the markdown textarea into a dialog with save/discard flow.

**Architecture:** Two changes to the edit page (`edit.html` + `handlers.js`): (1) swap `<select>` per-row actions with `<button>` + `<ul role="menu">` using event delegation on the `<tbody>`, (2) replace the always-visible markdown `<section>` with a button that opens a `<dialog>` containing the textarea, snapshot-based dirty checking, and a save/discard/back confirmation panel. A shared delete-slide `<dialog>` replaces the native `confirm()`.

**Tech Stack:** HTML, vanilla JS, Playwright tests

**Spec:** `docs/superpowers/specs/2026-04-10-edit-page-action-menus-design.md`

---

### Task 1: Replace slide table `<select>` with action menu markup

**Files:**
- Modify: `syncslide-websocket/templates/edit.html:25-28` (add scope to `<thead>`, add delete dialog)
- Modify: `syncslide-websocket/js/handlers.js:64-81` (`renderSlideTable`)

- [ ] **Step 1: Write failing test — action menu button exists in slide table rows**

Add to `tests/edit.spec.js`, inside the existing `test.describe` block, after the last test (line 113):

```js
    test('slide table rows have action menu buttons instead of selects', async ({ page }) => {
        const firstRow = page.locator('#slideTableBody tr').first();
        await expect(firstRow.locator('button[aria-haspopup="menu"]')).toBeVisible();
        await expect(firstRow.locator('select')).not.toBeAttached();
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx playwright test edit.spec.js --grep "action menu buttons" -v`
Expected: FAIL — the select still exists, no button with `aria-haspopup="menu"`.

- [ ] **Step 3: Update `<thead>` in `edit.html` and add shared delete dialog**

In `syncslide-websocket/templates/edit.html`, replace lines 25-28:

```html
  <table>
    <thead><tr><th>Slide</th><th>Title</th><th>Actions</th></tr></thead>
    <tbody id="slideTableBody"></tbody>
  </table>
```

with:

```html
  <table>
    <thead><tr><th scope="col">Slide</th><th scope="col">Title</th><th scope="col">Actions</th></tr></thead>
    <tbody id="slideTableBody"></tbody>
  </table>
  <dialog id="deleteSlideDialog" aria-labelledby="deleteSlideHeading">
    <h1 id="deleteSlideHeading" tabindex="-1"></h1>
    <p>This will remove the slide from the presentation.</p>
    <button type="button" id="deleteSlideConfirm">Delete</button>
    <button type="button" id="deleteSlideCancel">Cancel</button>
  </dialog>
```

- [ ] **Step 4: Rewrite `renderSlideTable` in `handlers.js`**

Replace the `renderSlideTable` function (lines 64-81) with:

```js
function renderSlideTable() {
    const slideTableBody = document.getElementById("slideTableBody");
    if (!slideTableBody) return;
    const slides = markdownToSlides(textInput.value);
    slideTableBody.innerHTML = '';
    slides.forEach((slide, i) => {
        const tr = document.createElement('tr');
        const menuId = 'slide-actions-menu-' + i;
        const btnId = 'slide-actions-btn-' + i;
        let items = '<li role="menuitem" tabindex="-1" data-action="edit" data-idx="' + i + '">Edit</li>';
        if (i > 0) items += '<li role="menuitem" tabindex="-1" data-action="move-up" data-idx="' + i + '">Move Up</li>';
        if (i < slides.length - 1) items += '<li role="menuitem" tabindex="-1" data-action="move-down" data-idx="' + i + '">Move Down</li>';
        items += '<li role="menuitem" tabindex="-1" data-action="delete" data-idx="' + i + '">Delete</li>';
        tr.innerHTML = '<th scope="row">' + (i + 1) + '</th>'
            + '<td>' + escapeHtml(slide.title) + '</td>'
            + '<td>'
            + '<button type="button" id="' + btnId + '" aria-haspopup="menu" aria-expanded="false" aria-controls="' + menuId + '">Actions: slide ' + (i + 1) + '</button>'
            + '<ul role="menu" id="' + menuId + '" hidden>' + items + '</ul>'
            + '</td>';
        slideTableBody.appendChild(tr);
    });
}
```

Add `escapeHtml` at the top of `handlers.js` (before line 1):

```js
function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tests && npx playwright test edit.spec.js --grep "action menu buttons" -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add syncslide-websocket/templates/edit.html syncslide-websocket/js/handlers.js tests/edit.spec.js
git commit -m "feat: replace slide table select with action menu button markup"
```

---

### Task 2: Wire up menu keyboard and mouse behaviour (delegation)

**Files:**
- Modify: `syncslide-websocket/js/handlers.js:204-239` (replace old `<select>` delegation block)

- [ ] **Step 1: Write failing test — arrow keys navigate menu items**

Add to `tests/edit.spec.js`:

```js
    test('action menu opens on click and arrow keys navigate items', async ({ page }) => {
        const btn = page.locator('#slideTableBody tr').first().locator('button[aria-haspopup="menu"]');
        await btn.click();
        const menu = page.locator('#slideTableBody tr').first().locator('[role="menu"]');
        await expect(menu).toBeVisible();
        // First item is focused on open
        const firstItem = menu.locator('[role="menuitem"]').first();
        await expect(firstItem).toBeFocused();
        // Arrow down moves to second item
        await page.keyboard.press('ArrowDown');
        const secondItem = menu.locator('[role="menuitem"]').nth(1);
        await expect(secondItem).toBeFocused();
        // Escape closes and returns focus to button
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(btn).toBeFocused();
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx playwright test edit.spec.js --grep "arrow keys navigate" -v`
Expected: FAIL — menu does not open on click (no listeners yet).

- [ ] **Step 3: Replace old `<select>` delegation with menu delegation**

In `handlers.js`, delete the old `<select>` delegation block (lines 204-239, from `const slideTableBody = document.getElementById('slideTableBody');` through the closing `}`). Replace with:

```js
const slideTableBody = document.getElementById('slideTableBody');
if (slideTableBody) {
    // --- Menu button delegation (APG Menu Button pattern) ---
    function findMenu(btn) {
        return document.getElementById(btn.getAttribute('aria-controls'));
    }
    function openSlideMenu(btn, focusLast) {
        btn.setAttribute('aria-expanded', 'true');
        const menu = findMenu(btn);
        if (!menu) return;
        menu.removeAttribute('hidden');
        const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
        if (items.length) (focusLast ? items[items.length - 1] : items[0]).focus();
    }
    function closeSlideMenu(btn) {
        btn.setAttribute('aria-expanded', 'false');
        const menu = findMenu(btn);
        if (menu) menu.setAttribute('hidden', '');
    }
    function closeSlideMenuAndFocus(btn) {
        closeSlideMenu(btn);
        btn.focus();
    }

    // Click on menu button: toggle
    slideTableBody.addEventListener('click', (e) => {
        const btn = e.target.closest('button[aria-haspopup="menu"]');
        if (btn) {
            if (btn.getAttribute('aria-expanded') === 'true') {
                closeSlideMenuAndFocus(btn);
            } else {
                openSlideMenu(btn, false);
            }
            return;
        }
        // Click on menu item: activate
        const item = e.target.closest('[role="menuitem"]');
        if (item) {
            const menuEl = item.closest('[role="menu"]');
            const menuBtn = menuEl ? document.getElementById(menuEl.id.replace('menu', 'btn')) : null;
            if (menuBtn) closeSlideMenu(menuBtn);
            handleSlideAction(item.dataset.action, parseInt(item.dataset.idx), menuBtn);
        }
    });

    // Keydown on menu button: arrow keys open menu
    slideTableBody.addEventListener('keydown', (e) => {
        const btn = e.target.closest('button[aria-haspopup="menu"]');
        if (btn) {
            if (e.key === 'ArrowDown') { e.preventDefault(); openSlideMenu(btn, false); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); openSlideMenu(btn, true); }
            return;
        }
        // Keydown on menu item: navigation
        const item = e.target.closest('[role="menuitem"]');
        if (!item) return;
        const menuEl = item.closest('[role="menu"]');
        if (!menuEl) return;
        const items = Array.from(menuEl.querySelectorAll('[role="menuitem"]'));
        const idx = items.indexOf(item);
        const menuBtn = document.getElementById(menuEl.id.replace('menu', 'btn'));
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[(idx + 1) % items.length].focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[(idx - 1 + items.length) % items.length].focus();
        } else if (e.key === 'Home') {
            e.preventDefault();
            items[0].focus();
        } else if (e.key === 'End') {
            e.preventDefault();
            items[items.length - 1].focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (menuBtn) closeSlideMenu(menuBtn);
            handleSlideAction(item.dataset.action, parseInt(item.dataset.idx), menuBtn);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (menuBtn) closeSlideMenuAndFocus(menuBtn);
        }
    });

    // Focusout: close menu when focus leaves it
    slideTableBody.addEventListener('focusout', (e) => {
        const menuEl = e.target.closest('[role="menu"]');
        if (!menuEl) return;
        if (menuEl.contains(e.relatedTarget)) return;
        const menuBtn = document.getElementById(menuEl.id.replace('menu', 'btn'));
        if (menuBtn) closeSlideMenu(menuBtn);
    });

    // --- Slide actions ---
    function handleSlideAction(action, idx, returnBtn) {
        if (action === 'edit') { openSlideDialog('edit', idx); return; }
        if (action === 'delete') { openDeleteSlideDialog(idx, returnBtn); return; }
        const slides = markdownToSlides(textInput.value);
        if (action === 'move-up' && idx > 0) {
            [slides[idx - 1], slides[idx]] = [slides[idx], slides[idx - 1]];
        } else if (action === 'move-down' && idx < slides.length - 1) {
            [slides[idx], slides[idx + 1]] = [slides[idx + 1], slides[idx]];
        }
        syncFromSlides(slides);
        renderSlideTable();
        // After re-render, focus the button at the new position
        if (action === 'move-up' && returnBtn) {
            const newBtn = document.getElementById('slide-actions-btn-' + (idx - 1));
            if (newBtn) newBtn.focus();
        } else if (action === 'move-down' && returnBtn) {
            const newBtn = document.getElementById('slide-actions-btn-' + (idx + 1));
            if (newBtn) newBtn.focus();
        }
    }

    // --- Delete slide dialog ---
    const deleteDialog = document.getElementById('deleteSlideDialog');
    const deleteHeading = document.getElementById('deleteSlideHeading');
    const deleteConfirmBtn = document.getElementById('deleteSlideConfirm');
    const deleteCancelBtn = document.getElementById('deleteSlideCancel');
    let deleteIdx = null;
    let deleteReturnBtn = null;

    function openDeleteSlideDialog(idx, returnBtn) {
        const slides = markdownToSlides(textInput.value);
        deleteIdx = idx;
        deleteReturnBtn = returnBtn;
        deleteHeading.textContent = 'Delete slide ' + (idx + 1) + ': ' + slides[idx].title + '?';
        deleteDialog.showModal();
        deleteHeading.focus();
    }

    if (deleteConfirmBtn) {
        deleteConfirmBtn.addEventListener('click', () => {
            const slides = markdownToSlides(textInput.value);
            slides.splice(deleteIdx, 1);
            syncFromSlides(slides);
            renderSlideTable();
            deleteDialog.close();
            if (deleteReturnBtn) {
                // Row was removed; focus the closest remaining action button
                const remaining = document.querySelector('#slideTableBody button[aria-haspopup="menu"]');
                if (remaining) remaining.focus();
            }
        });
    }
    if (deleteCancelBtn) {
        deleteCancelBtn.addEventListener('click', () => {
            deleteDialog.close();
            if (deleteReturnBtn) deleteReturnBtn.focus();
        });
    }
    if (deleteDialog) {
        deleteDialog.addEventListener('cancel', (e) => {
            // Escape key — same as Cancel
            if (deleteReturnBtn) setTimeout(() => deleteReturnBtn.focus(), 0);
        });
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tests && npx playwright test edit.spec.js --grep "arrow keys navigate" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/js/handlers.js tests/edit.spec.js
git commit -m "feat: wire up APG menu keyboard and mouse delegation for slide actions"
```

---

### Task 3: Test delete slide via dialog

**Files:**
- Modify: `tests/edit.spec.js`

- [ ] **Step 1: Write failing test — delete slide opens dialog and removes row on confirm**

Add to `tests/edit.spec.js`. This replaces the old test `delete slide via actions select triggers native confirm and removes row on accept` (lines 99-113), which should be deleted first:

```js
    test('delete slide via action menu opens dialog and removes row on confirm', async ({ page }) => {
        const originalMarkdown = await page.evaluate(() => document.getElementById('markdown-input').value);
        const initialRows = await page.locator('#slideTableBody tr').count();
        // Open menu on first row
        const btn = page.locator('#slideTableBody tr').first().locator('button[aria-haspopup="menu"]');
        await btn.click();
        // Click Delete menu item
        const menu = page.locator('#slideTableBody tr').first().locator('[role="menu"]');
        await menu.locator('[data-action="delete"]').click();
        // Dialog opens
        const dialog = page.locator('#deleteSlideDialog');
        await expect(dialog).toBeVisible();
        await expect(page.locator('#deleteSlideHeading')).toBeFocused();
        // Confirm delete
        await page.locator('#deleteSlideConfirm').click();
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows - 1);
        // Restore via markdown dialog (will exist after Task 5; for now restore directly)
        await page.evaluate((md) => {
            document.getElementById('markdown-input').value = md;
            document.getElementById('markdown-input').dispatchEvent(new Event('blur'));
        }, originalMarkdown);
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });

    test('delete slide dialog cancel returns focus to action button', async ({ page }) => {
        const btn = page.locator('#slideTableBody tr').first().locator('button[aria-haspopup="menu"]');
        await btn.click();
        const menu = page.locator('#slideTableBody tr').first().locator('[role="menu"]');
        await menu.locator('[data-action="delete"]').click();
        await expect(page.locator('#deleteSlideDialog')).toBeVisible();
        await page.locator('#deleteSlideCancel').click();
        await expect(page.locator('#deleteSlideDialog')).not.toBeVisible();
        // Focus returns to the first row's action button (original was still row 0)
        await expect(page.locator('#slideTableBody tr').first().locator('button[aria-haspopup="menu"]')).toBeFocused();
    });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd tests && npx playwright test edit.spec.js --grep "delete slide" -v`
Expected: PASS (both tests)

- [ ] **Step 3: Commit**

```bash
git add tests/edit.spec.js
git commit -m "test: add delete slide dialog tests, remove old confirm() test"
```

---

### Task 4: Update existing tests that reference old `<select>` or `#markdown-input`

**Files:**
- Modify: `tests/edit.spec.js:67-79` (edit slide test)
- Modify: `tests/edit.spec.js:50-65` (insert slide test)
- Modify: `tests/accessibility.spec.js:97-132` (markdown label sync test)
- Modify: `tests/websocket.spec.js:153-177` (send-while-disconnected test)

- [ ] **Step 1: Update the "edit opens dialog" test to use menu button**

In `tests/edit.spec.js`, replace the test `slide table actions edit opens dialog with "Edit Slide" heading and pre-filled data` (lines 67-79) with:

```js
    test('slide table actions edit opens dialog with "Edit Slide" heading and pre-filled data', async ({ page }) => {
        // Open action menu on first row and click Edit
        const btn = page.locator('#slideTableBody tr').first().locator('button[aria-haspopup="menu"]');
        await btn.click();
        const menu = page.locator('#slideTableBody tr').first().locator('[role="menu"]');
        await menu.locator('[data-action="edit"]').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await expect(page.locator('#slideDialogHeading')).toHaveText('Edit Slide');
        await expect(page.locator('#slideDialogApply')).toHaveText('Apply');
        // Title field must be pre-filled with the slide's title
        const titleValue = await page.locator('#insertTitle').inputValue();
        expect(titleValue.trim().length).toBeGreaterThan(0);
        // Position fieldset must be hidden in edit mode
        await expect(page.locator('#slideDialogPosition')).toBeHidden();
    });
```

- [ ] **Step 2: Update the "inserting a slide" test**

The test at lines 50-65 uses `await page.locator('#markdown-input').inputValue()` to snapshot markdown and `await page.fill('#markdown-input', ...)` + blur to restore. After Task 5 the textarea will be inside a dialog. But the hidden `#markdown-input` element will still exist in the DOM (inside the markdown dialog). For now, update the restore step to use `page.evaluate` which works regardless of visibility:

```js
    test('inserting a slide adds a row to the slide table', async ({ page }) => {
        const originalMarkdown = await page.evaluate(() => document.getElementById('markdown-input').value);
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#addSlide').click();
        await expect(page.locator('#slideDialog')).toBeVisible();
        await page.fill('#insertTitle', 'My New Slide');
        await page.locator('#slideDialogApply').click();
        await expect(page.locator('#slideDialog')).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows + 1);
        await expect(page.locator('#slideTableBody td').filter({ hasText: 'My New Slide' })).toBeVisible();
        // Restore: write markdown directly and trigger blur to send via WS → DB.
        await page.evaluate((md) => {
            document.getElementById('markdown-input').value = md;
            document.getElementById('markdown-input').dispatchEvent(new Event('blur'));
        }, originalMarkdown);
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });
```

- [ ] **Step 3: Note on accessibility and websocket tests**

The following tests reference `#markdown-input` or `#input` (the markdown label):

- `accessibility.spec.js:45` — `#markdown-input` not attached on stage page — **no change needed** (tests stage, not edit)
- `accessibility.spec.js:97-132` — markdown label sync test uses `#input` label — this label will be removed in Task 5. Update deferred to Task 6.
- `websocket.spec.js:153-177` — send-while-disconnected blurs `#markdown-input` — the textarea will still exist inside the dialog. Update deferred to Task 6.

- [ ] **Step 4: Run all edit tests**

Run: `cd tests && npx playwright test edit.spec.js -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add tests/edit.spec.js
git commit -m "test: update edit tests from select to action menu, use evaluate for markdown"
```

---

### Task 5: Add Edit Markdown button and dialog to `edit.html` and `handlers.js`

**Files:**
- Modify: `syncslide-websocket/templates/edit.html:21-34`
- Modify: `syncslide-websocket/js/handlers.js:1-17` (remove `lastSentMarkdown`, `onCommit` on textarea, rework `updateMarkdown`)

- [ ] **Step 1: Write failing test — Edit Markdown button opens dialog**

Add a new `test.describe` block at the end of `tests/edit.spec.js`:

```js
test.describe('edit page — markdown dialog', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/admin/1/edit');
        await expect(page.locator('#slideTableBody tr')).not.toHaveCount(0);
    });

    test('Edit Markdown button opens dialog with heading focused', async ({ page }) => {
        await page.locator('#editMarkdownBtn').click();
        const dialog = page.locator('#markdownDialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('h1')).toHaveText('Edit Markdown');
        await expect(dialog.locator('h1')).toBeFocused();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tests && npx playwright test edit.spec.js --grep "Edit Markdown button opens" -v`
Expected: FAIL — no `#editMarkdownBtn` exists.

- [ ] **Step 3: Update `edit.html` — replace markdown section with button and dialog**

Replace lines 21-34 of `edit.html` (from the `presName` label through the end of the markdown section) with:

```html
<label>Presentation name: <input type="text" id="presName" value="{{ pres.name }}"></label>
<button type="button" id="addSlide">Add Slide</button>
<button type="button" id="editMarkdownBtn">Edit Markdown</button>
<section aria-labelledby="slides-heading">
  <h2 id="slides-heading">Slides</h2>
  <table>
    <thead><tr><th scope="col">Slide</th><th scope="col">Title</th><th scope="col">Actions</th></tr></thead>
    <tbody id="slideTableBody"></tbody>
  </table>
  <dialog id="deleteSlideDialog" aria-labelledby="deleteSlideHeading">
    <h1 id="deleteSlideHeading" tabindex="-1"></h1>
    <p>This will remove the slide from the presentation.</p>
    <button type="button" id="deleteSlideConfirm">Delete</button>
    <button type="button" id="deleteSlideCancel">Cancel</button>
  </dialog>
</section>
<dialog id="markdownDialog" aria-labelledby="markdownDialogHeading">
  <div class="markdown-dialog-main">
    <h1 id="markdownDialogHeading" tabindex="-1">Edit Markdown</h1>
    <label for="markdown-input">{{ pres.name }}</label>
    <textarea id="markdown-input">{{ pres.content }}</textarea>
    <button type="button" id="markdownSaveBtn">Save</button>
    <button type="button" id="markdownCloseBtn">Close</button>
  </div>
  <div class="markdown-unsaved" hidden>
    <h1 id="markdownUnsavedHeading" tabindex="-1">Unsaved changes</h1>
    <p>You have unsaved changes.</p>
    <button type="button" id="markdownUnsavedSave">Save</button>
    <button type="button" id="markdownUnsavedDiscard">Discard</button>
    <button type="button" id="markdownUnsavedBack">Back</button>
  </div>
</dialog>
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
<script>document.getElementById('edit-heading').focus();</script>
```

Note: the `<section aria-labelledby="markdown-heading">` with its visible `<h2>`, `<label id="input">`, and exposed `<textarea>` are all gone. The `<textarea id="markdown-input">` now lives inside the markdown dialog.

- [ ] **Step 4: Rework `handlers.js` — remove auto-send, add markdown dialog logic**

At the top of `handlers.js`, replace lines 1-17 (from `let lastSentMarkdown` through the `onCommit(textInput, updateMarkdown)` call) with:

```js
function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

let dialogRefIdx = null;
let dialogMode = 'insert'; // 'insert' | 'edit'

const textInput = document.getElementById("markdown-input");

function updateMarkdown() {
    const markdownInput = textInput.value;
    const render = md.render(markdownInput);
    const dom = stringToDOM(render);
    if (typeof getH2s === 'function') getH2s(dom);
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "text", data: markdownInput }));
    }
    if (typeof updateSlide === 'function') updateSlide();
    renderSlideTable();
}
```

Note: `updateMarkdown` is no longer `async` (it never awaited anything), no longer checks `lastSentMarkdown` (the dialog handles dirty state), and no longer has an `onCommit` binding. It is called explicitly by the markdown dialog Save action and by `syncFromSlides`.

Then, after the `presNameInput` block (after the `onCommit(presNameInput, applyPresName)` line), add the markdown dialog logic:

```js
// --- Markdown dialog ---
const markdownDialog = document.getElementById('markdownDialog');
const markdownDialogMain = markdownDialog ? markdownDialog.querySelector('.markdown-dialog-main') : null;
const markdownUnsaved = markdownDialog ? markdownDialog.querySelector('.markdown-unsaved') : null;
const markdownDialogHeading = document.getElementById('markdownDialogHeading');
const markdownUnsavedHeading = document.getElementById('markdownUnsavedHeading');
let markdownSnapshot = '';

function openMarkdownDialog() {
    markdownSnapshot = textInput.value;
    markdownDialogMain.hidden = false;
    markdownUnsaved.hidden = true;
    markdownDialog.setAttribute('aria-labelledby', 'markdownDialogHeading');
    markdownDialog.showModal();
    markdownDialogHeading.focus();
}

function markdownHasChanges() {
    return textInput.value !== markdownSnapshot;
}

function saveMarkdown() {
    updateMarkdown();
    markdownSnapshot = textInput.value;
    markdownDialog.close();
    document.getElementById('editMarkdownBtn').focus();
}

function discardMarkdown() {
    textInput.value = markdownSnapshot;
    markdownDialog.close();
    document.getElementById('editMarkdownBtn').focus();
}

function showMarkdownUnsaved() {
    markdownDialogMain.hidden = true;
    markdownUnsaved.hidden = false;
    markdownDialog.setAttribute('aria-labelledby', 'markdownUnsavedHeading');
    markdownUnsavedHeading.focus();
}

function hideMarkdownUnsaved() {
    markdownUnsaved.hidden = true;
    markdownDialogMain.hidden = false;
    markdownDialog.setAttribute('aria-labelledby', 'markdownDialogHeading');
}

if (markdownDialog) {
    document.getElementById('editMarkdownBtn').addEventListener('click', openMarkdownDialog);

    document.getElementById('markdownSaveBtn').addEventListener('click', saveMarkdown);

    document.getElementById('markdownCloseBtn').addEventListener('click', () => {
        if (markdownHasChanges()) { showMarkdownUnsaved(); }
        else { markdownDialog.close(); document.getElementById('editMarkdownBtn').focus(); }
    });

    document.getElementById('markdownUnsavedSave').addEventListener('click', saveMarkdown);
    document.getElementById('markdownUnsavedDiscard').addEventListener('click', discardMarkdown);
    document.getElementById('markdownUnsavedBack').addEventListener('click', hideMarkdownUnsaved);

    markdownDialog.addEventListener('cancel', (e) => {
        if (markdownHasChanges()) {
            e.preventDefault();
            showMarkdownUnsaved();
        } else {
            document.getElementById('editMarkdownBtn').focus();
        }
    });

    // Escape while unsaved panel is visible returns to main
    markdownDialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !markdownUnsaved.hidden) {
            e.preventDefault();
            hideMarkdownUnsaved();
        }
    });
}
```

- [ ] **Step 5: Remove duplicate `escapeHtml` if present**

The `renderSlideTable` step in Task 1 added `escapeHtml` at the top of handlers.js. Now it's defined in the rewrite above. Ensure there is only one copy.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd tests && npx playwright test edit.spec.js --grep "Edit Markdown button opens" -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add syncslide-websocket/templates/edit.html syncslide-websocket/js/handlers.js tests/edit.spec.js
git commit -m "feat: add Edit Markdown dialog with save/discard/back flow"
```

---

### Task 6: Test markdown dialog save, discard, and unsaved flows

**Files:**
- Modify: `tests/edit.spec.js`

- [ ] **Step 1: Write tests for markdown dialog behaviour**

Add to the `edit page — markdown dialog` describe block in `tests/edit.spec.js`:

```js
    test('Save in markdown dialog sends changes and updates slide table', async ({ page }) => {
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#editMarkdownBtn').click();
        const textarea = page.locator('#markdownDialog #markdown-input');
        const current = await textarea.inputValue();
        await textarea.fill(current + '\n\n## Extra Slide\nContent here');
        await page.locator('#markdownSaveBtn').click();
        await expect(page.locator('#markdownDialog')).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows + 1);
        await expect(page.locator('#editMarkdownBtn')).toBeFocused();
        // Restore
        await page.locator('#editMarkdownBtn').click();
        await page.locator('#markdownDialog #markdown-input').fill(current);
        await page.locator('#markdownSaveBtn').click();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });

    test('Close with no changes dismisses dialog immediately', async ({ page }) => {
        await page.locator('#editMarkdownBtn').click();
        await expect(page.locator('#markdownDialog')).toBeVisible();
        await page.locator('#markdownCloseBtn').click();
        await expect(page.locator('#markdownDialog')).not.toBeVisible();
        await expect(page.locator('#editMarkdownBtn')).toBeFocused();
    });

    test('Close with changes shows unsaved prompt, Discard reverts', async ({ page }) => {
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#editMarkdownBtn').click();
        const textarea = page.locator('#markdownDialog #markdown-input');
        const original = await textarea.inputValue();
        await textarea.fill(original + '\n\n## Temp Slide\ntemp');
        await page.locator('#markdownCloseBtn').click();
        // Unsaved prompt appears
        await expect(page.locator('#markdownUnsavedHeading')).toBeVisible();
        await expect(page.locator('#markdownUnsavedHeading')).toBeFocused();
        // Discard
        await page.locator('#markdownUnsavedDiscard').click();
        await expect(page.locator('#markdownDialog')).not.toBeVisible();
        // Slide table unchanged
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });

    test('Unsaved prompt Back returns to editing', async ({ page }) => {
        await page.locator('#editMarkdownBtn').click();
        const textarea = page.locator('#markdownDialog #markdown-input');
        const original = await textarea.inputValue();
        await textarea.fill(original + '\n\n## Temp\ntemp');
        await page.locator('#markdownCloseBtn').click();
        await expect(page.locator('#markdownUnsavedHeading')).toBeVisible();
        await page.locator('#markdownUnsavedBack').click();
        // Back to main dialog view
        await expect(page.locator('.markdown-dialog-main')).toBeVisible();
        await expect(page.locator('.markdown-unsaved')).toBeHidden();
        // Discard to clean up
        await page.locator('#markdownCloseBtn').click();
        await page.locator('#markdownUnsavedDiscard').click();
    });

    test('Escape with changes shows unsaved prompt', async ({ page }) => {
        await page.locator('#editMarkdownBtn').click();
        const textarea = page.locator('#markdownDialog #markdown-input');
        const original = await textarea.inputValue();
        await textarea.fill(original + '\n\n## Esc Test\nesc');
        await page.keyboard.press('Escape');
        await expect(page.locator('#markdownUnsavedHeading')).toBeVisible();
        // Discard to clean up
        await page.locator('#markdownUnsavedDiscard').click();
    });

    test('Unsaved prompt Save applies changes and closes', async ({ page }) => {
        const initialRows = await page.locator('#slideTableBody tr').count();
        await page.locator('#editMarkdownBtn').click();
        const textarea = page.locator('#markdownDialog #markdown-input');
        const original = await textarea.inputValue();
        await textarea.fill(original + '\n\n## Save Via Prompt\nprompt');
        await page.locator('#markdownCloseBtn').click();
        await expect(page.locator('#markdownUnsavedHeading')).toBeVisible();
        await page.locator('#markdownUnsavedSave').click();
        await expect(page.locator('#markdownDialog')).not.toBeVisible();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows + 1);
        // Restore
        await page.locator('#editMarkdownBtn').click();
        await page.locator('#markdownDialog #markdown-input').fill(original);
        await page.locator('#markdownSaveBtn').click();
        await expect(page.locator('#slideTableBody tr')).toHaveCount(initialRows);
    });
```

- [ ] **Step 2: Run markdown dialog tests**

Run: `cd tests && npx playwright test edit.spec.js --grep "markdown dialog" -v`
Expected: PASS (all 6 tests)

- [ ] **Step 3: Update or remove stale tests in other files**

**`accessibility.spec.js` lines 97-132** — the "markdown label syncs via WebSocket name update" test checks `#input` (the label element `<label id="input">Markdown: Demo</label>`). This label no longer exists on the page; the markdown dialog's label is inside the dialog and uses `for="markdown-input"` without an `id="input"`. The WS name update should now update the markdown dialog's label text instead. Update the test:

In `accessibility.spec.js`, find the test `markdown label on second edit tab updates when name changes via WS` and update the assertion on line 118 from:

```js
await expect(page1.locator('#input')).toHaveText('Markdown: ' + newName, { timeout: 5000 });
```

to:

```js
await expect(page1.locator('label[for="markdown-input"]')).toHaveText(newName, { timeout: 5000 });
```

Also update the corresponding code in `handlers.js` inside the `applyPresName` function. Replace:

```js
const mdLabel = document.getElementById('input');
if (mdLabel) mdLabel.textContent = `Markdown: ${newName}`;
```

with:

```js
const mdLabel = document.querySelector('label[for="markdown-input"]');
if (mdLabel) mdLabel.textContent = newName;
```

**`websocket.spec.js` lines 153-177** — the "send-while-disconnected" test opens the edit page, confirms `#markdown-input` is visible, then blurs it. Now the textarea is hidden inside the dialog. The test needs to open the markdown dialog first, then blur the textarea. Update:

```js
    test('send-while-disconnected does not throw', async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(EDIT_URL);
        await expect(page.locator('#editMarkdownBtn')).toBeVisible();

        const pageErrors = [];
        page.on('pageerror', e => pageErrors.push(e));

        // Open the markdown dialog so the textarea is accessible
        await page.locator('#editMarkdownBtn').click();
        await expect(page.locator('#markdownDialog')).toBeVisible();

        // Close the socket, confirm the banner appears (onclose has fired).
        await page.evaluate(() => window.socket.close());
        await expect(page.locator('#ws-status')).toBeVisible({ timeout: 2000 });

        // Click Save to trigger updateMarkdown → guarded send.
        await page.locator('#markdownSaveBtn').click();

        // Allow any synchronous errors to propagate.
        await page.waitForTimeout(200);

        // The page must still be functional and no errors thrown.
        expect(pageErrors).toHaveLength(0);
    });
```

- [ ] **Step 4: Run the full test suite**

Run: `cd tests && npx playwright test -v`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add tests/edit.spec.js tests/accessibility.spec.js tests/websocket.spec.js syncslide-websocket/js/handlers.js
git commit -m "test: add markdown dialog tests, update stale references to removed elements"
```

---

### Task 7: Remove `onCommit` on textarea and `lastSentMarkdown` cleanup

**Files:**
- Modify: `syncslide-websocket/js/handlers.js`

- [ ] **Step 1: Verify `lastSentMarkdown` and old `onCommit` call are gone**

After Task 5, these should already be removed. Grep to confirm:

Run: `grep -n 'lastSentMarkdown\|onCommit(textInput' syncslide-websocket/js/handlers.js`
Expected: no output (both are gone)

If either still exists, remove them.

- [ ] **Step 2: Verify `onCommit` function itself is still present**

`onCommit` is still used for `presNameInput` (line ~148). Confirm it's still defined and used:

Run: `grep -n 'onCommit' syncslide-websocket/js/handlers.js`
Expected: the function definition and the `onCommit(presNameInput, applyPresName)` call.

- [ ] **Step 3: Run full test suite**

Run: `cd tests && npx playwright test -v`
Expected: all tests PASS

- [ ] **Step 4: Commit (if any cleanup was needed)**

```bash
git add syncslide-websocket/js/handlers.js
git commit -m "chore: remove leftover lastSentMarkdown and textarea onCommit binding"
```
