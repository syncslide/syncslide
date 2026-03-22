# Action Menu for Presentations List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four standalone action buttons (Delete, Manage co-presenters, Set password, Copy link with password) on each owned presentation item with a single ARIA APG Menu Button, while updating all Playwright tests to match.

**Architecture:** Template-only change. A `<button aria-haspopup="menu">` per owned presentation opens a `<ul role="menu">` with four `<li role="menuitem">` children. Dialog focus-return is moved from the `data-close-dialog` click handler into per-dialog `close` event listeners that read a `data-return-focus` attribute set by the menu item JS before opening. Recording-delete dialogs are covered by the same `close` listener pattern via the fallback `[data-open-dialog]` query.

**Tech Stack:** Tera HTML templates, vanilla JS (inline `<script>` block), Playwright E2E tests.

---

## File Map

| File | Change |
|------|--------|
| `syncslide-websocket/templates/presentations.html` | Add menu button + `<ul role="menu">`, remove standalone buttons, remove Copy link with password from Set password dialog, add clipboard live region, update JS |
| `tests/presentations.spec.js` | Update 10 existing tests that open dialogs via old standalone buttons; add 6 new menu-behaviour tests |

---

## Deployment note

This codebase builds and tests on the VPS only (`config/update.bat`). Intermediate commits that break tests leave the live service running on the old code (the deploy script stops before `systemctl restart` when tests fail). All three tasks can be pushed as separate commits; only the final push needs the deploy to fully pass.

---

## Task 1: Update and add Playwright tests

**Files:**
- Modify: `tests/presentations.spec.js`

- [ ] **Step 1: Add `openActionsMenu` helper**

Add this helper near the top of the file, below `createPresentation`:

```js
// Helper — opens the Actions menu for a given presentation ID.
async function openActionsMenu(page, presId) {
    await page.locator(`#actions-btn-${presId}`).click();
    await expect(page.locator(`#actions-menu-${presId}`)).toBeVisible();
}
```

- [ ] **Step 2: Update the 10 existing tests that will break**

**`delete dialog opens when delete button is activated`** — replace the click line:
```js
// Before:
await page.click('button[data-open-dialog="delete-pres-1"]');
// After:
await openActionsMenu(page, 1);
await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Delete' }).click();
```

**`cancel button closes delete dialog`** — same replacement (the rest of the test is unchanged).

**`focus moves to dialog heading when delete dialog opens`** — same replacement.

**`delete-pres dialog has heading before cancel button`** — same replacement.

**`manage co-presenters button is present`** — replace assertion:
```js
// Before:
const manageBtn = page.locator('button[data-open-dialog="manage-access-1"]');
await expect(manageBtn).toBeVisible();
// After:
const actionsBtn = page.locator('#actions-btn-1');
await expect(actionsBtn).toBeVisible();
```

**`manage co-presenters dialog opens with heading first`** — replace click:
```js
// Before:
await page.click('button[data-open-dialog="manage-access-1"]');
// After:
await openActionsMenu(page, 1);
await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Manage co-presenters' }).click();
```

**`manage dialog close button is last in DOM order`** — same replacement as above.

**`set-password button is present for owned presentation`** — replace assertion:
```js
// Before:
const setpwdBtn = page.locator('button[data-open-dialog="set-pwd-1"]');
await expect(setpwdBtn).toBeVisible();
// After:
const actionsBtn = page.locator('#actions-btn-1');
await expect(actionsBtn).toBeVisible();
```

**`set-password dialog opens with heading first`** — replace click:
```js
// Before:
await page.click('button[data-open-dialog="set-pwd-1"]');
// After:
await openActionsMenu(page, 1);
await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Set password' }).click();
```

**`set-password show/hide toggle works`** — same replacement as above.

- [ ] **Step 3: Add 6 new menu-behaviour tests**

Add these inside the `'presentations list'` describe block:

```js
test('actions button is present with correct ARIA attributes', async ({ page }) => {
    await page.goto('/user/presentations');
    const btn = page.locator('#actions-btn-1');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
});

test('actions menu opens on click and focuses first item', async ({ page }) => {
    await page.goto('/user/presentations');
    await page.locator('#actions-btn-1').click();
    await expect(page.locator('#actions-menu-1')).toBeVisible();
    await expect(page.locator('#actions-menu-1 [role="menuitem"]').first()).toBeFocused();
});

test('ArrowDown moves focus to next menu item', async ({ page }) => {
    await page.goto('/user/presentations');
    await page.locator('#actions-btn-1').click();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#actions-menu-1 [role="menuitem"]').nth(1)).toBeFocused();
});

test('Escape closes actions menu and returns focus to button', async ({ page }) => {
    await page.goto('/user/presentations');
    await page.locator('#actions-btn-1').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#actions-menu-1')).not.toBeVisible();
    await expect(page.locator('#actions-btn-1')).toBeFocused();
});

test('closing delete dialog returns focus to actions button', async ({ page }) => {
    await page.goto('/user/presentations');
    await openActionsMenu(page, 1);
    await page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Delete' }).click();
    const dialog = page.locator('#delete-pres-1');
    await expect(dialog).toBeVisible();
    await dialog.locator('button[data-close-dialog="delete-pres-1"]').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#actions-btn-1')).toBeFocused();
});

test('clipboard live region is present in DOM', async ({ page }) => {
    await page.goto('/user/presentations');
    await expect(page.locator('#clipboard-status')).toBeAttached();
});
```

- [ ] **Step 4: Commit**

```bash
git add tests/presentations.spec.js
git commit -m "test: update presentations tests for action menu"
```

---

## Task 2: Implement HTML template changes

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html`

- [ ] **Step 1: Add clipboard live region**

At the very end of `{% block content %}`, just before `{% endblock content %}`, add:

```html
<div id="clipboard-status"
     aria-live="polite"
     aria-atomic="true"
     style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0"></div>
```

- [ ] **Step 2: Replace standalone buttons with menu button (inside `{% if pres.role == "owner" %}`)**

Remove these three buttons (search for them by their `data-open-dialog` attributes):
```html
<button type="button" data-open-dialog="delete-pres-{{ pres.id }}">Delete: {{ pres.name }}</button>
<button type="button" data-open-dialog="manage-access-{{ pres.id }}">Manage co-presenters</button>
<button type="button" data-open-dialog="set-pwd-{{ pres.id }}">Set password</button>
```

Replace them with a menu button placed **after** the Set password `</dialog>` tag and **before** `{% endif %}`:

```html
<button type="button"
        id="actions-btn-{{ pres.id }}"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-controls="actions-menu-{{ pres.id }}">Actions: {{ pres.name }}</button>
<ul role="menu" id="actions-menu-{{ pres.id }}" hidden>
    <li role="menuitem" tabindex="-1"
        data-action="copy-link"
        data-pres-id="{{ pres.id }}"
        data-owner-name="{{ pres.owner_name }}">Copy link</li>
    <li role="menuitem" tabindex="-1"
        data-action="open-dialog"
        data-dialog-id="set-pwd-{{ pres.id }}"
        data-return-btn="actions-btn-{{ pres.id }}">Set password</li>
    <li role="menuitem" tabindex="-1"
        data-action="open-dialog"
        data-dialog-id="manage-access-{{ pres.id }}"
        data-return-btn="actions-btn-{{ pres.id }}">Manage co-presenters</li>
    <li role="menuitem" tabindex="-1"
        data-action="open-dialog"
        data-dialog-id="delete-pres-{{ pres.id }}"
        data-return-btn="actions-btn-{{ pres.id }}">Delete {{ pres.name }}</li>
</ul>
```

The three dialogs (`delete-pres-*`, `manage-access-*`, `set-pwd-*`) stay exactly as they are — only their opener buttons are removed.

- [ ] **Step 3: Remove "Copy link with password" button from Set password dialog**

Remove this element from inside the `set-pwd-*` dialog's first `<form>`:
```html
<button type="button" id="copy-link-{{ pres.id }}" disabled
        data-pres-id="{{ pres.id }}" data-pres-owner="{{ user.name }}">Copy link with password</button>
```

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/templates/presentations.html
git commit -m "feat: add actions menu button HTML to owned presentations"
```

---

## Task 3: Implement JS changes

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html` (inline `<script>` block)

All changes are within the `<script>` block at the bottom of the template.

- [ ] **Step 1: Update `data-close-dialog` handler — remove focus-return logic**

Replace:
```js
document.querySelectorAll('[data-close-dialog]').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var dialog = document.getElementById(btn.dataset.closeDialog);
        var opener = document.querySelector('[data-open-dialog="' + btn.dataset.closeDialog + '"]');
        dialog.close();
        if (opener) opener.focus();
    });
});
```
With:
```js
document.querySelectorAll('[data-close-dialog]').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var dialog = document.getElementById(btn.dataset.closeDialog);
        dialog.close();
    });
});
```

- [ ] **Step 2: Add `close` event listeners for all dialogs**

Add this block immediately after the updated `data-close-dialog` handler:

```js
// Focus-return on dialog close (handles Cancel button, Escape key, and programmatic close).
// For presentation-action dialogs: returns to the actions menu button via data-returnFocus.
// For recording-delete dialogs: falls back to [data-open-dialog] query.
document.querySelectorAll('dialog').forEach(function (dialog) {
    dialog.addEventListener('close', function () {
        var returnId = dialog.dataset.returnFocus;
        var ret = returnId
            ? document.getElementById(returnId)
            : document.querySelector('[data-open-dialog="' + dialog.id + '"]');
        delete dialog.dataset.returnFocus;
        if (ret) ret.focus();
    });
});
```

- [ ] **Step 3: Remove copy-link-with-password JS block**

Delete the entire block at the bottom of the script (lines 323–337 in current template):
```js
// Copy-link-with-password: enabled when password input has >= 8 chars
document.querySelectorAll('[id^="copy-link-"]').forEach(function (btn) {
    var dialog = btn.closest('dialog');
    var input = dialog.querySelector('input[name="password"]');
    // Enable only when input has >= 8 chars
    input.addEventListener('input', function () {
        btn.disabled = input.value.length < 8;
    });
    btn.addEventListener('click', function () {
        var owner = btn.dataset.presOwner;
        var presId = btn.dataset.presId;
        var url = window.location.origin + '/' + owner + '/' + presId + '?pwd=' + encodeURIComponent(input.value);
        navigator.clipboard.writeText(url);
    });
});
```

- [ ] **Step 4: Add menu button JS (open/close/keyboard/item activation)**

Add this block after the `close` event listener block:

```js
// Action menus — ARIA APG Menu Button pattern
(function () {
    function openMenu(btn, menu, focusLast) {
        btn.setAttribute('aria-expanded', 'true');
        menu.removeAttribute('hidden');
        var items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
        if (items.length) {
            (focusLast ? items[items.length - 1] : items[0]).focus();
        }
    }

    function closeMenuSilently(btn, menu) {
        btn.setAttribute('aria-expanded', 'false');
        menu.setAttribute('hidden', '');
    }

    function closeMenuAndFocus(btn, menu) {
        closeMenuSilently(btn, menu);
        btn.focus();
    }

    document.querySelectorAll('[aria-haspopup="menu"]').forEach(function (btn) {
        var menu = document.getElementById(btn.getAttribute('aria-controls'));
        if (!menu) return;

        // Button: click toggles menu
        btn.addEventListener('click', function () {
            if (btn.getAttribute('aria-expanded') === 'true') {
                closeMenuAndFocus(btn, menu);
            } else {
                openMenu(btn, menu, false);
            }
        });

        // Button: keyboard opens menu
        btn.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openMenu(btn, menu, false);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                openMenu(btn, menu, false);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                openMenu(btn, menu, true);
            }
        });

        // Menu: arrow key navigation, Escape, Enter/Space activation
        menu.addEventListener('keydown', function (e) {
            var items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
            var idx = items.indexOf(document.activeElement);
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
                if (document.activeElement) document.activeElement.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeMenuAndFocus(btn, menu);
            }
        });

        // Menu: Tab/Shift+Tab — close without stealing focus (browser handles Tab naturally)
        menu.addEventListener('focusout', function (e) {
            if (!menu.contains(e.relatedTarget)) {
                closeMenuSilently(btn, menu);
            }
        });

        // Menu items: activation
        menu.querySelectorAll('[role="menuitem"]').forEach(function (item) {
            item.addEventListener('click', function () {
                closeMenuSilently(btn, menu);

                if (item.dataset.action === 'copy-link') {
                    var url = window.location.origin + '/' + item.dataset.ownerName + '/' + item.dataset.presId;
                    var statusEl = document.getElementById('clipboard-status');
                    navigator.clipboard.writeText(url).then(function () {
                        statusEl.textContent = 'Link copied';
                        setTimeout(function () { statusEl.textContent = ''; }, 4000);
                        btn.focus();
                    }, function () {
                        statusEl.textContent = 'Could not copy link';
                        setTimeout(function () { statusEl.textContent = ''; }, 4000);
                        btn.focus();
                    });

                } else if (item.dataset.action === 'open-dialog') {
                    var dialog = document.getElementById(item.dataset.dialogId);
                    if (!dialog) return;
                    dialog.dataset.returnFocus = item.dataset.returnBtn;
                    dialog.showModal();
                    var firstSelect = dialog.querySelector('tbody select');
                    var first = firstSelect
                        || dialog.querySelector('h1[tabindex="-1"]')
                        || dialog.querySelector('input, select, button');
                    if (first) first.focus();
                }
            });
        });
    });
})();
```

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/templates/presentations.html
git commit -m "feat: implement action menu JS and update dialog focus-return"
```

---

## Task 4: Deploy and verify

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

- [ ] **Step 2: Run deploy**

Run `config/update.bat`.

- [ ] **Step 3: Verify all tests pass**

Expected: all 58 Rust tests pass, all Playwright tests pass (84 total: 78 previous − 0 removed + 6 new).

If any Playwright test fails, check the error message: most likely cause is a selector mismatch in an updated test (e.g. `.filter({ hasText: '...' })` not matching the exact menuitem text). Fix the selector and redeploy.
