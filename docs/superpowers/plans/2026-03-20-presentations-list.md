# Presentations List Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show shared presentations (co-presenter access) alongside owned presentations on the `/user/presentations` page, add role labels to shared items, add a filter control for role-based filtering, and remove the presentation count from the nav link.

**Architecture:** A new `DbPresentation::get_shared_with_user` DB function returns `Vec<(Presentation, String)>` (presentation + role). The handler merges owned (role="owner") + shared lists, builds `PresentationRecordings` for each, and annotates each with a `role` field. The template renders `data-role` on each list item and adds a disclosure filter widget + `aria-live` count region above the sort control. The existing JavaScript sort/pagination is updated to respect the active filter. The nav count is removed from `nav.html` and the `Tera::render` helper.

**Prerequisite:** Plan 1 (foundation) and Plan 2 (co-presenters) must be complete — `presentation_access` table and `PresentationAccess` methods must exist. Plan 3 (password) is NOT required; this plan is independent of password.

> **Existing dialog APG order fix:** The spec says "all existing dialogs are updated to follow APG order as part of this work." That fix (cancel/close button order in delete-pres and delete-rec dialogs) is scoped to Plan 2 Task 4. If Plan 2 has not been executed, apply that fix before Task 4 here.

**Tech Stack:** Rust/Axum, SQLx, Tera templates, vanilla JS (filter, sort, pagination)

---

## File Map

| File | Change |
|------|--------|
| `syncslide-websocket/src/db.rs` | Add `role: String` to `PresentationRecordings`; add `DbPresentation::get_shared_with_user` |
| `syncslide-websocket/src/main.rs` | Update `presentations` handler to merge owned + shared; remove `pres_num` from `Tera::render` |
| `syncslide-websocket/templates/presentations.html` | Add `data-role` to list items; add role label on shared items; add filter control + live region; update JS for filtering; hide owner-only buttons from co-presenters |
| `syncslide-websocket/templates/nav.html` | Remove `({{ pres_num }})` from the Presentations nav link |
| `tests/presentations.spec.js` | Add filter control and shared-item tests |

---

### Task 1: DB — Shared Presentations Query

**Files:**
- Modify: `syncslide-websocket/src/db.rs`

- [ ] **Step 1: Add `role` field to `PresentationRecordings`**

Current struct (db.rs ~line 10):
```rust
pub struct PresentationRecordings {
    pub id: i64,
    pub user_id: i64,
    pub content: String,
    pub name: String,
    pub recordings: Vec<Recording>,
}
```

Add `pub role: String`:
```rust
pub struct PresentationRecordings {
    pub id: i64,
    pub user_id: i64,
    pub content: String,
    pub name: String,
    pub recordings: Vec<Recording>,
    pub role: String,
    pub access: Vec<PresentationAccess>,  // already added in plan 2
}
```

If plan 2 has not been executed yet (or `access` field was not added), add both fields. If plan 2 already added `access`, only add `role`.

Update `Recording::get_by_presentation` to set `role: "owner".to_string()` as a default:
```rust
Ok(PresentationRecordings {
    recordings,
    access,  // from plan 2; if plan 2 not done, omit
    role: "owner".to_string(),
    id: pres.id,
    name: pres.name,
    user_id: pres.user_id,
    content: pres.content,
})
```

The handler will override `role` for shared presentations.

- [ ] **Step 2: Write failing test for get_shared_with_user**

Add to the `access_tests` module in `db.rs`:

```rust
/// get_shared_with_user must return presentations where the user has a co-presenter row.
#[tokio::test]
async fn get_shared_with_user_returns_shared_presentations() {
    let pool = setup_pool().await;
    let owner = make_user(&pool, "sh_owner").await;
    let viewer = make_user(&pool, "sh_viewer").await;
    let pres = make_presentation(&owner, &pool).await;

    // No access yet — get_shared_with_user should return empty
    let shared = DbPresentation::get_shared_with_user(&viewer, &pool).await.unwrap();
    assert!(shared.is_empty(), "must return empty before access is granted");

    // Grant access
    sqlx::query(
        "INSERT INTO presentation_access (presentation_id, user_id, role) VALUES (?, ?, 'editor')",
    )
    .bind(pres.id)
    .bind(viewer.id)
    .execute(&pool)
    .await
    .unwrap();

    let shared = DbPresentation::get_shared_with_user(&viewer, &pool).await.unwrap();
    assert_eq!(shared.len(), 1, "must return the shared presentation");
    assert_eq!(shared[0].0.id, pres.id);
    assert_eq!(shared[0].1, "editor", "role must be 'editor'");
}
```

- [ ] **Step 3: Run — expect compile error**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test get_shared_with_user 2>&1 | head -20
```

- [ ] **Step 4: Implement get_shared_with_user in db.rs**

Add to the `Presentation` impl block (after `get_for_user`):

```rust
/// Returns presentations shared with `user` via `presentation_access`,
/// together with the user's role for each.
pub async fn get_shared_with_user(
    user: &User,
    db: &SqlitePool,
) -> Result<Vec<(Self, String)>, Error> {
    struct Row {
        id: i64,
        user_id: i64,
        content: String,
        name: String,
        password: Option<String>,
        role: String,
    }
    let rows = sqlx::query_as!(
        Row,
        r#"SELECT p.id, p.user_id, p.content, p.name, p.password,
                  pa.role as "role!: String"
           FROM presentation p
           JOIN presentation_access pa ON pa.presentation_id = p.id
           WHERE pa.user_id = ?"#,
        user.id
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            (
                Presentation {
                    id: r.id,
                    user_id: r.user_id,
                    content: r.content,
                    name: r.name,
                    password: r.password,
                },
                r.role,
            )
        })
        .collect())
}
```

Note: This uses `query_as!` with a local struct. If the sqlx offline cache does not yet have this query, `cargo sqlx prepare` must be run on the VPS after pushing this change. See the "SQLx cache" note below.

**SQLx cache note:** Adding a new `query_as!` call requires updating the `.sqlx/` offline cache. After pushing this commit, SSH to the VPS and run:
```bash
cd ~/syncSlide/syncslide-websocket
DATABASE_URL=sqlite://db.sqlite3 cargo sqlx prepare
git add .sqlx/
git commit -m "chore: regenerate sqlx cache for get_shared_with_user query"
git push
```

Alternatively, rewrite `get_shared_with_user` using the runtime `sqlx::query_as::<_, ...>` form (no compile-time checking) to avoid the cache step. Either approach is valid; the `query_as!` form gives better compile-time safety.

- [ ] **Step 5: Run tests**

On VPS (after cache regeneration if needed):
```
cd ~/syncSlide/syncslide-websocket && cargo test get_shared_with_user 2>&1 | tail -10
```
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add syncslide-websocket/src/db.rs
git commit -m "feat: add get_shared_with_user and role field to PresentationRecordings"
```

---

### Task 2: Update the Presentations Handler

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

The handler currently fetches owned presentations only. It must now also fetch shared presentations, merge them, and annotate each with a `role` field.

- [ ] **Step 1: Write a failing integration test**

Add to `#[cfg(test)]` in `main.rs`:

```rust
/// GET /user/presentations must include presentations shared with the user.
#[tokio::test]
async fn presentations_list_includes_shared() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    // Create a presentation owned by admin
    let admin_id = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(admin_id, "Shared With Testuser", &state.db_pool).await;
    // Grant testuser editor access
    let testuser_id = get_user_id("testuser", &state.db_pool).await;
    PresentationAccess::add(&state.db_pool, pid, testuser_id, "editor").await.unwrap();
    login_as(&server, "testuser", "testpass").await;

    let response = server.get("/user/presentations").await;

    assert_eq!(response.status_code(), 200);
    assert!(
        response.text().contains("Shared With Testuser"),
        "shared presentation must appear in testuser's list"
    );
}
```

- [ ] **Step 2: Run — expect failure (shared presentation not shown)**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test presentations_list_includes_shared 2>&1 | tail -10
```

- [ ] **Step 3: Update the presentations handler**

Current handler (~line 432):
```rust
async fn presentations(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
) -> impl IntoResponse {
    let Some(ref user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    let press = DbPresentation::get_for_user(&user, &db).await;
    let Ok(press) = press else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut press_with_recordings = vec![];
    for pres in press {
        let Ok(pres_with_recs) = Recording::get_by_presentation(pres, &db).await else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        press_with_recordings.push(pres_with_recs);
    }
    let mut ctx = Context::new();
    ctx.insert("press", &press_with_recordings);
    tera.render("presentations.html", ctx, auth_session, db)
        .await
}
```

Replace with:
```rust
async fn presentations(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
) -> impl IntoResponse {
    let Some(ref user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };

    // Owned presentations
    let Ok(owned) = DbPresentation::get_for_user(user, &db).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    // Shared presentations
    let Ok(shared) = DbPresentation::get_shared_with_user(user, &db).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let mut press_with_recordings = vec![];

    for pres in owned {
        let Ok(mut pwr) = Recording::get_by_presentation(pres, &db).await else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        pwr.role = "owner".to_string();
        press_with_recordings.push(pwr);
    }

    for (pres, role) in shared {
        let Ok(mut pwr) = Recording::get_by_presentation(pres, &db).await else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        pwr.role = role;
        press_with_recordings.push(pwr);
    }

    let mut ctx = Context::new();
    ctx.insert("press", &press_with_recordings);
    tera.render("presentations.html", ctx, auth_session, db)
        .await
}
```

- [ ] **Step 4: Run tests**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test presentations_list_includes_shared 2>&1 | tail -10
```
Expected: passes.

Run full suite:
```
cd ~/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "feat: merge owned and shared presentations in the presentations list handler"
```

---

### Task 3: Remove Nav Presentation Count

**Files:**
- Modify: `syncslide-websocket/templates/nav.html`
- Modify: `syncslide-websocket/src/main.rs` (the `Tera::render` helper)

The spec says: "The nav bar no longer shows a presentation count."

- [ ] **Step 1: Write a Playwright test that the count is gone**

Add to `tests/nav.spec.js` (or `presentations.spec.js`):

```js
// The nav link to presentations must not include a number in parentheses.
test('nav presentations link has no count', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const navLink = page.locator('a[href="/user/presentations"]');
    await expect(navLink).toBeVisible();
    const text = await navLink.textContent();
    expect(text).not.toMatch(/\(\d+\)/);
});
```

- [ ] **Step 2: Run — expect failure (count currently shown)**

On VPS after deploy:
```
cd ~/syncSlide && npx playwright test --grep "nav presentations link" 2>&1 | tail -10
```

- [ ] **Step 3: Remove the count from nav.html**

Current line in `nav.html` (line 18):
```html
<li><a href="/user/presentations">Presentations ({{ pres_num }})</a></li>
```

Change to:
```html
<li><a href="/user/presentations">Presentations</a></li>
```

- [ ] **Step 4: Remove pres_num from the Tera render helper**

In `main.rs`, the `Tera::render` helper (~line 72-82) currently fetches and inserts `pres_num`:
```rust
let pn = DbPresentation::num_for_user(&user, &db).await.unwrap();
ctx.insert("pres_num", &pn);
```

Delete those two lines. The `pres_num` value is no longer used in any template.

- [ ] **Step 5: Run tests**

On VPS after deploy:
```
cd ~/syncSlide && npx playwright test --grep "nav presentations link" 2>&1 | tail -10
```
Expected: passes.

Run full Playwright suite:
```
cd ~/syncSlide && npx playwright test 2>&1 | tail -5
```
Expected: all pass (no existing test asserts the presence of the count).

- [ ] **Step 6: Commit**

```bash
git add syncslide-websocket/templates/nav.html syncslide-websocket/src/main.rs
git commit -m "feat: remove presentation count from nav link"
```

---

### Task 4: Role Labels and Owner-Only Buttons

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html`

Each list item needs a `data-role` attribute (for the filter) and a visible role label for shared items. Owner-only buttons (Delete, Manage co-presenters, Set password) must be hidden for co-presenters.

- [ ] **Step 1: Write a Playwright test for role labels**

Add to `tests/presentations.spec.js`:

```js
// A shared presentation must show a role label in the list.
// This test requires a second user with access — set up via the API seed.
// Since Playwright tests run against the live server (admin/admin), we rely on
// the admin owning the Demo presentation (no co-presenters by default).
// Test the owner case: the Demo pres must NOT show a "Shared with you" label.
test('owner presentation has no shared-with label', async ({ page }) => {
    await page.goto('/user/presentations');
    const item = page.locator('.pres-item[data-role="owner"]').first();
    await expect(item).toBeVisible();
    await expect(item.locator('.role-label')).not.toBeVisible();
});

// data-role="owner" must be present on owned presentations.
test('owned presentation has data-role owner', async ({ page }) => {
    await page.goto('/user/presentations');
    // The Demo presentation is owned by admin; it must have data-role="owner"
    const item = page.locator('#pres-list li').first();
    await expect(item).toHaveAttribute('data-role', 'owner');
});
```

- [ ] **Step 2: Update presentations.html — add data-role and role labels**

In the `{% for pres in press %}` loop, update the `<li>` opening tag:
```html
<li class="pres-item" role="listitem" data-id="{{ pres.id }}" data-name="{{ pres.name | lower }}" data-role="{{ pres.role }}">
```

After the `<h2>` heading link, add a role label that is only shown for shared items:
```html
{% if pres.role != "owner" %}
<span class="role-label">Shared with you as {{ pres.role }}</span>
{% endif %}
```

Wrap the owner-only buttons in a Tera condition. The buttons to hide from co-presenters are Delete (presentation), Manage co-presenters, and Set password. Since the template currently shows these to all users, add a role check:

```html
{% if pres.role == "owner" %}
<button type="button" data-open-dialog="delete-pres-{{ pres.id }}">Delete: {{ pres.name }}</button>
<dialog ...>...</dialog>
<button type="button" data-open-dialog="manage-access-{{ pres.id }}">Manage co-presenters</button>
<dialog ...>...</dialog>
<button type="button" data-open-dialog="set-pwd-{{ pres.id }}">Set password</button>
<dialog ...>...</dialog>
{% endif %}
```

The recordings `<details>` block is shown to all roles — co-presenters can view recordings.

- [ ] **Step 3: Run tests**

On VPS after deploy:
```
cd ~/syncSlide && npx playwright test --grep "owner presentation|data-role owner" 2>&1 | tail -10
```
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/templates/presentations.html
git commit -m "feat: add data-role attribute and role labels to presentations list"
```

---

### Task 5: Filter Control

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html`

The filter is a disclosure widget above the sort control. It filters by role using `data-role` attributes. Filtering is client-side — no server round-trip.

Reading/tab order in the filter area:
1. Filter button (funnel SVG + "Filter" + active count in parentheses)
2. Filter panel (hidden by default, disclosed on button activation)
   - `<fieldset>` with legend "Role"
   - Three checkboxes: "My presentations" (owner), "Shared as editor" (editor), "Shared as controller" (controller)
3. `aria-live="polite"` result count region ("Showing N of M presentations")
4. Sort control (existing)

- [ ] **Step 1: Write Playwright tests for the filter**

Add to `tests/presentations.spec.js`:

```js
// The filter button must be present above the sort control.
test('filter button is present', async ({ page }) => {
    await page.goto('/user/presentations');
    const filterBtn = page.locator('#filter-toggle');
    await expect(filterBtn).toBeVisible();
    await expect(filterBtn).toContainText('Filter');
});

// Filter button must have aria-expanded=false by default.
test('filter button has aria-expanded false by default', async ({ page }) => {
    await page.goto('/user/presentations');
    await expect(page.locator('#filter-toggle')).toHaveAttribute('aria-expanded', 'false');
});

// Clicking the filter button must expand the panel (aria-expanded becomes true).
test('clicking filter button expands the panel', async ({ page }) => {
    await page.goto('/user/presentations');
    await page.click('#filter-toggle');
    await expect(page.locator('#filter-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#filter-panel')).toBeVisible();
});

// The filter panel must contain three checkboxes all checked by default.
test('filter panel has three checkboxes all checked', async ({ page }) => {
    await page.goto('/user/presentations');
    await page.click('#filter-toggle');
    const panel = page.locator('#filter-panel');
    const boxes = panel.locator('input[type="checkbox"]');
    await expect(boxes).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
        await expect(boxes.nth(i)).toBeChecked();
    }
});

// The aria-live region must announce the visible count.
test('result count live region is present', async ({ page }) => {
    await page.goto('/user/presentations');
    const liveRegion = page.locator('#filter-count');
    await expect(liveRegion).toBeAttached();
});
```

- [ ] **Step 2: Run — expect failure (filter not yet in template)**

On VPS:
```
cd ~/syncSlide && npx playwright test --grep "filter button|filter panel|result count" 2>&1 | head -20
```

- [ ] **Step 3: Add the filter HTML to presentations.html**

Add the following immediately before the `<div class="pres-controls">` sort control block (inside the `{% if press | length > 0 %}` block):

```html
<div class="filter-controls">
    <button type="button"
            id="filter-toggle"
            aria-expanded="false"
            aria-controls="filter-panel"
            aria-label="Filter">
        <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16">
            <path d="M2 3h12l-4.5 5.5V13l-3-1.5V8.5L2 3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
        Filter <span id="filter-active-count"></span>
    </button>
    <div id="filter-panel" role="group" hidden>
        <h2 aria-hidden="true">Role</h2>
        <fieldset>
            <legend>Role</legend>
            <label><input type="checkbox" checked data-filter-role="owner"> My presentations</label>
            <label><input type="checkbox" checked data-filter-role="editor"> Shared as editor</label>
            <label><input type="checkbox" checked data-filter-role="controller"> Shared as controller</label>
        </fieldset>
    </div>
    <div id="filter-count" aria-live="polite" aria-atomic="true"></div>
</div>
```

Notes on structure:
- `role="group"` is on `#filter-panel` itself, as the spec shows — not on a nested wrapper.
- The `<h2 aria-hidden="true">Role</h2>` heading is required for screen reader users who navigate by headings (H-key). The `aria-hidden` prevents it being announced twice (the `<legend>` already labels the fieldset). This is a spec-required accessibility feature, not merely a visual affordance.
- The `<legend>` labels the fieldset for screen readers navigating by form controls or the virtual cursor.

- [ ] **Step 4: Add the filter JavaScript to presentations.html**

Inside the existing `<script>` block, add the filter logic (to run alongside the existing sort/pagination code). The filter integrates with the existing `allItems`/`render()` system by filtering which items are considered "visible" before sorting and paginating.

Replace the existing `(function () { ... })();` IIFE with an updated version. The key changes:
1. `allItems` is filtered by active roles before sorting
2. `render()` updates `filter-count` text and `filter-active-count` in button label

Key additions inside the IIFE, near the top:

```js
var filterTogglebtn = document.getElementById('filter-toggle');
var filterPanel = document.getElementById('filter-panel');
var filterCountEl = document.getElementById('filter-count');
var filterActiveCount = document.getElementById('filter-active-count');

// Toggle filter panel open/close
filterTogglebtn.addEventListener('click', function () {
    var expanded = filterTogglebtn.getAttribute('aria-expanded') === 'true';
    filterTogglebtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    if (expanded) {
        filterPanel.setAttribute('hidden', '');
    } else {
        filterPanel.removeAttribute('hidden');
    }
});

function getActiveRoles() {
    var checked = [];
    filterPanel.querySelectorAll('[data-filter-role]').forEach(function (cb) {
        if (cb.checked) checked.push(cb.dataset.filterRole);
    });
    return checked;
}

function getFiltered() {
    var roles = getActiveRoles();
    return allItems.filter(function (item) {
        return roles.includes(item.dataset.role);
    });
}
```

Replace `getSorted()` to operate on `getFiltered()` instead of `allItems`:

```js
function getSorted() {
    var items = getFiltered().slice();  // was: allItems.slice()
    // ... rest of sort logic unchanged
}
```

Inside `render()`, update the live region and button label:

```js
function render() {
    var perPage = parseInt(perPageSel.value);
    var sorted = getSorted();
    var total = sorted.length;
    var allTotal = allItems.length;
    var totalPages = Math.max(1, Math.ceil(total / perPage));
    if (currentPage > totalPages) currentPage = totalPages;
    var start = (currentPage - 1) * perPage;
    var end = start + perPage;
    var list = document.getElementById('pres-list');
    allItems.forEach(function (item) { item.style.display = 'none'; });
    sorted.slice(start, end).forEach(function (item) {
        item.style.display = '';
        list.appendChild(item);
    });
    var pageText = 'Page ' + currentPage + ' of ' + totalPages;
    if (pageInfo.textContent !== pageText) pageInfo.textContent = pageText;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;

    // Update filter count — spec: button reads "Filter (3 active)", aria-label "Filter, 3 active"
    var activeRoles = getActiveRoles();
    var activeCount = activeRoles.length;
    // Show count only when a filter is actually restricting (not all 3 active, unless there
    // are fewer than 3 roles in the list — keep it simple: always show the count).
    filterActiveCount.textContent = activeCount < 3 ? ' (' + activeCount + ' active)' : '';
    filterTogglebtn.setAttribute('aria-label', 'Filter' + (activeCount < 3 ? ', ' + activeCount + ' active' : ''));

    // Announce result count
    var countMsg = 'Showing ' + total + ' of ' + allTotal + ' presentations.';
    if (filterCountEl.textContent !== countMsg) filterCountEl.textContent = countMsg;
}
```

Add filter checkbox change listener:

```js
filterPanel.querySelectorAll('[data-filter-role]').forEach(function (cb) {
    cb.addEventListener('change', function () { currentPage = 1; render(); });
});
```

- [ ] **Step 5: Run tests**

On VPS after deploy:
```
cd ~/syncSlide && npx playwright test --grep "filter button|filter panel|result count" 2>&1 | tail -20
```
Expected: all five filter tests pass.

Run full Playwright suite:
```
cd ~/syncSlide && npx playwright test 2>&1 | tail -5
```
Expected: all pass.

Run Rust suite:
```
cd ~/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -5
```
Expected: all pass.

- [ ] **Step 6: Deploy and manually verify**

```bash
config/update.bat
```

Check:
- Presentations list loads with the filter button above the sort control
- Filter panel opens/closes with `aria-expanded` toggling
- All three checkboxes are checked by default
- Unchecking "My presentations" hides owned items; live region updates
- A shared presentation (if one exists) shows a role label

- [ ] **Step 7: Commit**

```bash
git add syncslide-websocket/templates/presentations.html tests/presentations.spec.js
git commit -m "feat: add role-based filter control to presentations list"
```

---

## Completion

After all tasks:

1. `PresentationRecordings` carries `role: String`; `get_shared_with_user` in `db.rs`
2. Presentations handler merges owned + shared; each item has the correct role
3. Nav link no longer shows the presentation count
4. `data-role` on each list item; role labels on shared items; owner-only buttons hidden from co-presenters
5. Filter disclosure widget with three role checkboxes and a polite live region
6. All Rust tests pass; all Playwright tests pass

**All four plans complete.** Plans 2 and 3 can be executed in any order. Plan 4 must follow Plan 2.
