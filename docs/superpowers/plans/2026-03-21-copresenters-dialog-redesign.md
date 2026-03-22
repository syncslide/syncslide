# Co-presenters Dialog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the co-presenters dialog to use a two-column table with staged changes, inline validation on new-row usernames, and a Close → confirm/discard flow.

**Architecture:** All new behaviour lives in a JS IIFE added to `presentations.html`. A new Rust endpoint `GET /users/exists` supports client-side username existence checks. Existing `/access/add`, `/access/remove`, and `/access/change-role` endpoints handle all mutations via `fetch` on Save. Original role state is encoded in the HTML template via `data-original-role`; no init-on-open step is needed.

**Tech Stack:** Rust/Axum (new endpoint), Tera templates (HTML), vanilla JS (dialog behaviour), axum-test + tokio::test (Rust tests), Playwright + axe-core (browser tests).

---

## File Map

| File | Changes |
|---|---|
| `syncslide-websocket/src/main.rs` | `UserExistsQuery` struct, `user_exists` handler, route, 3 Rust tests |
| `syncslide-websocket/templates/presentations.html` | Rewrite manage-access dialog HTML; update 2 focus-on-open places; add manage-access IIFE |
| `tests/presentations.spec.js` | Update 1 broken test, add 12 new tests, add `openManageDialog` helper |
| `tests/accessibility.spec.js` | Add 1 axe test for open dialog state |

---

## Deployment note

Never run the server locally. After every code change, deploy via `config/update.bat` (on the VPS: pulls, builds, reloads Caddy, restarts service). Playwright tests run from the local machine against `http://localhost:5003`. Rust tests run on the VPS via `cargo test`.

---

## Task 1: Add `/users/exists` Rust endpoint

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

- [ ] **Step 1: Write 3 failing Rust tests**

Add inside the `#[cfg(test)]` block at the bottom of `main.rs`, alongside the other access tests:

```rust
/// GET /users/exists?username=testuser returns 200 when user exists and caller is authenticated.
#[tokio::test]
async fn user_exists_returns_200_for_known_user() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    login_as(&server, "testuser", "testpass").await;
    let response = server
        .get("/users/exists")
        .add_query_param("username", "testuser")
        .await;
    assert_eq!(response.status_code(), 200);
}

/// GET /users/exists?username=nobody returns 404 when user does not exist.
#[tokio::test]
async fn user_exists_returns_404_for_unknown_user() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    login_as(&server, "testuser", "testpass").await;
    let response = server
        .get("/users/exists")
        .add_query_param("username", "nobody")
        .await;
    assert_eq!(response.status_code(), 404);
}

/// GET /users/exists without a session must return 401 Unauthorized.
#[tokio::test]
async fn user_exists_requires_auth() {
    let (server, _state) = test_server().await;
    // axum-test does not follow redirects — the raw response status is returned.
    let response = server
        .get("/users/exists")
        .add_query_param("username", "admin")
        .await;
    assert_eq!(response.status_code(), 401u16);
}
```

- [ ] **Step 2: Run tests to verify they fail**

On VPS:
```bash
cd /home/arch/syncSlide/syncslide-websocket
cargo test user_exists 2>&1 | tail -20
```
Expected: FAIL — no route named `user_exists`.

- [ ] **Step 3: Add `UserExistsQuery` struct and `user_exists` handler**

Find the `RemoveAccessForm` struct (around line 354) and add after it:

```rust
#[derive(Deserialize)]
struct UserExistsQuery {
    username: String,
}

async fn user_exists(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Query(query): Query<UserExistsQuery>,
) -> impl IntoResponse {
    if auth_session.user.is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match User::get_by_name(query.username, &db).await {
        Ok(Some(_)) => StatusCode::OK.into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
```

`Query` is in `axum::extract`. Check the existing `use axum::{...}` import at the top of `main.rs` and add `extract::Query` if not already present.

- [ ] **Step 4: Register the route**

In `build_app` (around line 1377, with the other access routes), add:

```rust
.route("/users/exists", get(user_exists))
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cargo test user_exists 2>&1 | tail -20
```
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "feat: add GET /users/exists endpoint for username validation"
```

---

## Task 2: Rewrite manage-access dialog HTML

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html`
- Modify: `tests/presentations.spec.js`

- [ ] **Step 1: Write 2 new failing tests and update 1 broken test**

At the top of `presentations.spec.js`, after the `openActionsMenu` helper, add:

```js
async function openManageDialog(page, presId) {
    await openActionsMenu(page, presId);
    await page.locator(`#actions-menu-${presId} [role="menuitem"]`)
        .filter({ hasText: 'Manage co-presenters' }).click();
    await expect(page.locator(`#manage-access-${presId}`)).toBeVisible();
}
```

Inside the `test.describe('presentations list', ...)` block, add 2 new tests:

```js
test('manage dialog table has 2 columns and a caption', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await expect(dialog.locator('table caption')).toContainText('Co-presenters');
    const headers = dialog.locator('thead th');
    await expect(headers).toHaveCount(2);
    await expect(headers.nth(0)).toContainText('Username');
    await expect(headers.nth(1)).toContainText('Role');
});

test('manage dialog has Add co-presenter button in table', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await expect(dialog.locator('td .add-copres-btn')).toBeAttached();
    await expect(dialog.locator('.add-copres-btn')).toContainText('Add co-presenter');
});
```

Update the existing test "manage dialog close button is last in DOM order" to use the new selectors:

```js
test('manage dialog close button is last in DOM order', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    const inOrder = await dialog.evaluate(function (el) {
        var closeBtn = el.querySelector('.manage-access-close');
        var addBtn = el.querySelector('.add-copres-btn');
        // DOCUMENT_POSITION_FOLLOWING means addBtn precedes closeBtn in DOM
        return !!(addBtn.compareDocumentPosition(closeBtn) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(inOrder).toBe(true);
});
```

- [ ] **Step 2: Deploy and run to verify they fail**

```bash
config/update.bat
cd tests && npx playwright test presentations.spec.js --grep "manage dialog"
```
Expected: new tests FAIL (old structure still in place); updated test also FAIL.

- [ ] **Step 3: Rewrite the manage-access dialog HTML**

In `presentations.html`, replace the entire `<dialog id="manage-access-{{ pres.id }}"...>` block (currently lines 83–126, including the `{% if pres.access | length > 0 %}` conditional around the table) with:

```html
<dialog id="manage-access-{{ pres.id }}"
        aria-labelledby="manage-access-heading-{{ pres.id }}"
        data-focus-heading="true"
        data-owner-username="{{ user.name }}"
        data-pres-id="{{ pres.id }}">
    <h1 id="manage-access-heading-{{ pres.id }}" tabindex="-1">Co-presenters for {{ pres.name }}</h1>
    <table>
        <caption>Co-presenters</caption>
        <thead><tr><th scope="col">Username</th><th scope="col">Role</th></tr></thead>
        <tbody>
        {% for entry in pres.access %}
        <tr>
            <td data-username="{{ entry.username }}">{{ entry.username }}</td>
            <td>
                <select aria-label="Role for {{ entry.username }}"
                        data-original-role="{{ entry.role }}"
                        data-user-id="{{ entry.user_id }}">
                    <option value="editor"{% if entry.role == "editor" %} selected{% endif %}>Editor</option>
                    <option value="controller"{% if entry.role == "controller" %} selected{% endif %}>Controller</option>
                    <option value="remove">Remove</option>
                </select>
            </td>
        </tr>
        {% endfor %}
        </tbody>
        <tbody class="new-rows-tbody"></tbody>
        <tfoot>
        <tr>
            <td colspan="2"><button type="button" class="add-copres-btn">Add co-presenter</button></td>
        </tr>
        </tfoot>
    </table>
    <button type="button" class="manage-access-close">Close</button>
    <div class="unsaved-prompt" hidden>
        <p>You have unsaved changes.</p>
        <button type="button" class="unsaved-save">Save</button>
        <button type="button" class="unsaved-discard">Discard</button>
    </div>
</dialog>
<!-- DOM order: Close button comes before the unsaved-prompt div so that when
     the prompt is visible, tab order is: ... Add button → Close → Save → Discard,
     matching the spec's tab sequence (Close = item 6, Save/Discard = item 7). -->
```

**What is removed:** the `{% if pres.access | length > 0 %}` / `{% endif %}` conditional, the 3-column table with Actions header, per-row Save role forms, the Remove form, and the standalone `<h2>Add co-presenter</h2>` form section. The old `data-close-dialog` Close button is also removed (the new close button uses `class="manage-access-close"` instead, so the existing `data-close-dialog` handler does not fire for this button).

- [ ] **Step 4: Deploy and run tests**

```bash
config/update.bat
cd tests && npx playwright test presentations.spec.js --grep "manage dialog"
```
Expected: structural tests PASS. Focus and JS-behaviour tests will fail until Tasks 3–4.

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/templates/presentations.html tests/presentations.spec.js
git commit -m "feat: rewrite manage-access dialog HTML with 2-column table and staged-save structure"
```

---

## Task 3: Fix open-dialog focus for `data-focus-heading`

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html` (JS section only)
- Modify: `tests/presentations.spec.js`

- [ ] **Step 1: Write failing Playwright test**

Inside `test.describe('presentations list', ...)`:

```js
test('manage dialog opens with focus on h1', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    await expect(page.locator('#manage-access-1 h1')).toBeFocused();
});
```

- [ ] **Step 2: Deploy and run to verify it fails**

```bash
config/update.bat
cd tests && npx playwright test presentations.spec.js --grep "manage dialog opens with focus"
```
Expected: FAIL — focus lands on the first role select (current behaviour for dialogs with a `tbody select`).

- [ ] **Step 3: Update both open-dialog focus blocks in JS**

There are two places in `presentations.html` where focus is set after `showModal()`. Both currently do:
```js
var firstSelect = dialog.querySelector('tbody select');
var first = firstSelect || dialog.querySelector('h1[tabindex="-1"]') || ...
```

**First place** — the `data-open-dialog` click handler (around line 191):

```js
// Replace:
var firstSelect = dialog.querySelector('tbody select');
var first = firstSelect || dialog.querySelector('h1[tabindex="-1"]') || dialog.querySelector('input, select, button');
if (first) first.focus();

// With:
var first;
if (dialog.dataset.focusHeading) {
    first = dialog.querySelector('h1[tabindex="-1"]');
} else {
    var firstSelect = dialog.querySelector('tbody select');
    first = firstSelect || dialog.querySelector('h1[tabindex="-1"]') || dialog.querySelector('input, select, button');
}
if (first) first.focus();
```

**Second place** — the action menu `open-dialog` handler (around line 323, inside the menu item click listener):

```js
// Replace:
var firstSelect = dialog.querySelector('tbody select');
var first = firstSelect
    || dialog.querySelector('h1[tabindex="-1"]')
    || dialog.querySelector('input, select, button');
if (first) first.focus();

// With:
var first;
if (dialog.dataset.focusHeading) {
    first = dialog.querySelector('h1[tabindex="-1"]');
} else {
    var firstSelect = dialog.querySelector('tbody select');
    first = firstSelect
        || dialog.querySelector('h1[tabindex="-1"]')
        || dialog.querySelector('input, select, button');
}
if (first) first.focus();
```

- [ ] **Step 4: Deploy and run test**

```bash
config/update.bat
cd tests && npx playwright test presentations.spec.js --grep "manage dialog opens with focus"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/templates/presentations.html tests/presentations.spec.js
git commit -m "feat: focus h1 on open for dialogs with data-focus-heading attribute"
```

---

## Task 4: Add manage-access dialog JS and Playwright tests

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html` (new IIFE before `</script>`)
- Modify: `tests/presentations.spec.js`
- Modify: `tests/accessibility.spec.js`

- [ ] **Step 1: Write all failing Playwright tests**

Add inside `test.describe('presentations list', ...)`:

```js
test('Add button inserts a new row and focuses username input', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await dialog.locator('.add-copres-btn').click();
    const input = dialog.locator('tr.new-row input[type="text"]');
    await expect(input).toHaveCount(1);
    await expect(input).toBeFocused();
});

test('Add button is disabled while new row username is empty', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await dialog.locator('.add-copres-btn').click();
    await expect(dialog.locator('.add-copres-btn')).toBeDisabled();
});

test('Add button re-enables when new row username is filled', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await dialog.locator('.add-copres-btn').click();
    await dialog.locator('tr.new-row input[type="text"]').fill('someuser');
    await expect(dialog.locator('.add-copres-btn')).toBeEnabled();
});

test('username blur with own name shows owner error', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await dialog.locator('.add-copres-btn').click();
    const input = dialog.locator('tr.new-row input[type="text"]');
    await input.fill('admin');
    await input.blur();
    await expect(dialog.locator('tr.new-row [aria-live]')).toContainText('owner');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
});

test('username blur with nonexistent user shows User not found', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await dialog.locator('.add-copres-btn').click();
    const input = dialog.locator('tr.new-row input[type="text"]');
    await input.fill('xyzzy_no_such_user_abc123');
    await input.blur();
    await expect(dialog.locator('tr.new-row [aria-live]')).toContainText('User not found');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
});

test('duplicate username across two new rows shows Already a co-presenter', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    // Add first row and fill it (enabling the Add button again)
    await dialog.locator('.add-copres-btn').click();
    await dialog.locator('tr.new-row input[type="text"]').first().fill('uniqueuser123');
    // Add second row (clicking Add button also blurs the first input, firing its validation)
    await dialog.locator('.add-copres-btn').click();
    const secondInput = dialog.locator('tr.new-row input[type="text"]').last();
    await secondInput.fill('uniqueuser123');
    await secondInput.blur();
    await expect(secondInput).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.locator('tr.new-row').last().locator('[aria-live]'))
        .toContainText('Already a co-presenter');
});

test('typing in errored input clears the error', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await dialog.locator('.add-copres-btn').click();
    const input = dialog.locator('tr.new-row input[type="text"]');
    await input.fill('admin');
    await input.blur();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.pressSequentially('x');
    await expect(input).toHaveAttribute('aria-invalid', 'false');
});

test('Close with no pending changes closes dialog immediately', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await dialog.locator('.manage-access-close').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#actions-btn-1')).toBeFocused();
});

test('Close with pending changes shows unsaved prompt and focuses Save', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await dialog.locator('.add-copres-btn').click(); // creates a pending new row
    await dialog.locator('.manage-access-close').click();
    await expect(dialog.locator('.unsaved-prompt')).toBeVisible();
    await expect(dialog.locator('.unsaved-save')).toBeFocused();
});

test('Discard resets state and closes dialog', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await dialog.locator('.add-copres-btn').click();
    await dialog.locator('.manage-access-close').click();
    await dialog.locator('.unsaved-discard').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#actions-btn-1')).toBeFocused();
});

test('Escape with pending changes shows unsaved prompt', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await dialog.locator('.add-copres-btn').click();
    await page.keyboard.press('Escape');
    await expect(dialog.locator('.unsaved-prompt')).toBeVisible();
    await expect(dialog.locator('.unsaved-save')).toBeFocused();
});

test('Escape while prompt visible dismisses prompt and focuses Close button', async ({ page }) => {
    await page.goto('/user/presentations');
    await openManageDialog(page, 1);
    const dialog = page.locator('#manage-access-1');
    await dialog.locator('.add-copres-btn').click();
    await page.keyboard.press('Escape'); // shows prompt
    await page.keyboard.press('Escape'); // dismisses prompt
    await expect(dialog.locator('.unsaved-prompt')).not.toBeVisible();
    await expect(dialog.locator('.manage-access-close')).toBeFocused();
});
```

In `accessibility.spec.js`, inside `test.describe('authenticated pages', ...)`:

```js
test('manage co-presenters dialog open state has no axe violations', async ({ page }) => {
    await page.goto('/user/presentations');
    await page.locator('#actions-btn-1').click();
    await page.locator('#actions-menu-1 [role="menuitem"]')
        .filter({ hasText: 'Manage co-presenters' }).click();
    await expect(page.locator('#manage-access-1')).toBeVisible();
    await assertNoViolations(page);
});
```

- [ ] **Step 2: Deploy and run to verify they all fail**

```bash
config/update.bat
cd tests && npx playwright test presentations.spec.js --grep "Add button|username blur|duplicate|errored input|Close with|Discard|Escape"
```
Expected: All FAIL — JS behaviour not yet implemented.

- [ ] **Step 3: Add the manage-access IIFE to `presentations.html`**

**Focus-return note:** When the IIFE calls `dialog.close()`, focus return to the Actions menu button is handled automatically by the existing `close` event listener already in `presentations.html` (the `document.querySelectorAll('dialog').forEach(...)` block). It reads `dialog.dataset.returnFocus` — which the action-menu open handler sets to `actions-btn-{id}` before `showModal()`. **Do not add any additional focus-return logic in the IIFE** — it would conflict with the existing handler.

Immediately before the closing `</script>` tag, add:

```js
// Manage co-presenters dialog — staged-save behaviour
(function () {
    var newRowCounter = 0;

    function setError(input, message) {
        var errId = input.getAttribute('aria-describedby');
        var errEl = errId ? document.getElementById(errId) : null;
        if (!errEl) return;
        errEl.textContent = message;
        input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    function validateNewRowInput(input, dialog) {
        var value = input.value.trim();
        if (!value) { setError(input, ''); return; }

        var ownerUsername = dialog.dataset.ownerUsername || '';
        if (value.toLowerCase() === ownerUsername.toLowerCase()) {
            setError(input, 'You are the owner of this presentation.');
            return;
        }

        var existingUsernames = Array.from(dialog.querySelectorAll('td[data-username]'))
            .map(function (td) { return td.dataset.username.toLowerCase(); });
        var otherNewInputs = Array.from(dialog.querySelectorAll('tr.new-row input[type="text"]'))
            .filter(function (i) { return i !== input; })
            .map(function (i) { return i.value.trim().toLowerCase(); });
        if (existingUsernames.concat(otherNewInputs).indexOf(value.toLowerCase()) !== -1) {
            setError(input, 'Already a co-presenter.');
            return;
        }

        fetch('/users/exists?username=' + encodeURIComponent(value))
            .then(function (res) {
                setError(input, res.status === 404 ? 'User not found.' : '');
            })
            .catch(function () { setError(input, ''); });
    }

    function updateAddButtonState(dialog, addBtn) {
        var anyEmpty = Array.from(dialog.querySelectorAll('tr.new-row input[type="text"]'))
            .some(function (i) { return !i.value.trim(); });
        addBtn.disabled = anyEmpty;
    }

    function hasPendingChanges(dialog) {
        var existingChanged = Array.from(dialog.querySelectorAll('select[data-original-role]'))
            .some(function (s) { return s.value !== s.dataset.originalRole; });
        return existingChanged || !!dialog.querySelector('tr.new-row');
    }

    function showPrompt(dialog) {
        dialog.querySelector('.unsaved-prompt').hidden = false;
        dialog.querySelector('.unsaved-save').focus();
    }

    function hidePrompt(dialog) {
        dialog.querySelector('.unsaved-prompt').hidden = true;
    }

    function handleClose(dialog) {
        if (hasPendingChanges(dialog)) {
            showPrompt(dialog);
        } else {
            dialog.close();
        }
    }

    function discard(dialog, addBtn) {
        dialog.querySelectorAll('select[data-original-role]').forEach(function (s) {
            s.value = s.dataset.originalRole;
        });
        dialog.querySelectorAll('tr.new-row').forEach(function (r) { r.remove(); });
        addBtn.disabled = false;
        hidePrompt(dialog);
    }

    function save(dialog) {
        var presId = dialog.dataset.presId;
        var saveBtn = dialog.querySelector('.unsaved-save');
        var discardBtn = dialog.querySelector('.unsaved-discard');
        saveBtn.disabled = true;
        discardBtn.disabled = true;

        var fetches = [];

        dialog.querySelectorAll('select[data-original-role]').forEach(function (sel) {
            if (sel.value === sel.dataset.originalRole) return;
            var userId = sel.dataset.userId;
            var url, body;
            if (sel.value === 'remove') {
                url = '/user/presentations/' + presId + '/access/remove';
                body = new URLSearchParams({ user_id: userId }).toString();
            } else {
                url = '/user/presentations/' + presId + '/access/change-role';
                body = new URLSearchParams({ user_id: userId, role: sel.value }).toString();
            }
            fetches.push(fetch(url, {
                method: 'POST',
                redirect: 'manual',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body
            }));
        });

        dialog.querySelectorAll('tr.new-row').forEach(function (row) {
            var input = row.querySelector('input[type="text"]');
            var sel = row.querySelector('select');
            var username = input.value.trim();
            if (!username) return;
            if (input.getAttribute('aria-invalid') === 'true') return;
            fetches.push(fetch('/user/presentations/' + presId + '/access/add', {
                method: 'POST',
                redirect: 'manual',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ username: username, role: sel.value }).toString()
            }));
        });

        Promise.allSettled(fetches).then(function () {
            location.reload();
        });
    }

    document.querySelectorAll('dialog[data-pres-id]').forEach(function (dialog) {
        var addBtn = dialog.querySelector('.add-copres-btn');
        var closeBtn = dialog.querySelector('.manage-access-close');
        var saveBtn = dialog.querySelector('.unsaved-save');
        var discardBtn = dialog.querySelector('.unsaved-discard');
        var newRowsTbody = dialog.querySelector('.new-rows-tbody');
        if (!addBtn || !closeBtn || !saveBtn || !discardBtn || !newRowsTbody) return;

        closeBtn.addEventListener('click', function () { handleClose(dialog); });

        saveBtn.addEventListener('click', function () { save(dialog); });

        discardBtn.addEventListener('click', function () {
            discard(dialog, addBtn);
            dialog.close();
        });

        dialog.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            var prompt = dialog.querySelector('.unsaved-prompt');
            if (!prompt.hidden) {
                hidePrompt(dialog);
                closeBtn.focus();
            } else if (hasPendingChanges(dialog)) {
                showPrompt(dialog);
            } else {
                dialog.close();
            }
        });

        addBtn.addEventListener('click', function () {
            newRowCounter++;
            var inputId = 'new-copres-' + dialog.dataset.presId + '-' + newRowCounter;
            var errId = inputId + '-err';
            var row = document.createElement('tr');
            row.className = 'new-row';
            row.innerHTML =
                '<td>' +
                    '<input type="text" id="' + inputId + '"' +
                        ' aria-label="Username"' +
                        ' autocomplete="off"' +
                        ' spellcheck="false"' +
                        ' aria-describedby="' + errId + '">' +
                    '<span id="' + errId + '" role="status" aria-live="polite"></span>' +
                '</td>' +
                '<td>' +
                    '<select aria-label="Role for new co-presenter">' +
                        '<option value="editor">Editor</option>' +
                        '<option value="controller">Controller</option>' +
                    '</select>' +
                '</td>';
            newRowsTbody.appendChild(row);
            var input = row.querySelector('input[type="text"]');
            addBtn.disabled = true;

            input.addEventListener('input', function () {
                setError(input, '');
                updateAddButtonState(dialog, addBtn);
            });
            input.addEventListener('blur', function () {
                validateNewRowInput(input, dialog);
            });
            input.focus();
        });
    });
})();
```

- [ ] **Step 4: Deploy and run all manage-access Playwright tests**

```bash
config/update.bat
cd tests && npx playwright test presentations.spec.js --grep "manage|Add button|username blur|duplicate|Close with|Discard|Escape"
```
Expected: All pass.

- [ ] **Step 5: Run full Playwright test suite to check for regressions**

```bash
cd tests && npx playwright test
```
Expected: All tests pass.

- [ ] **Step 6: Run axe test**

```bash
cd tests && npx playwright test accessibility.spec.js
```
Expected: All pass including the new manage dialog axe test.

- [ ] **Step 7: Commit**

```bash
git add syncslide-websocket/templates/presentations.html tests/presentations.spec.js tests/accessibility.spec.js
git commit -m "feat: add manage-access dialog staged-save JS, validation, and Playwright tests"
```
