# Co-Presenters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add co-presenter management routes and dialog, grant editors stage access in the `present` handler, and fix the existing dialog button order (cancel/close before heading) across `presentations.html` and `recording.html`.

**Architecture:** Three new POST routes (`add`, `remove`, `change-role`) in `main.rs` check ownership before touching `presentation_access`. A `PresentationAccess` DB struct and associated methods go in `db.rs`. The `present` handler uses `check_access` (from plan 1) to route editors to stage. The dialog order fix is a pure template change.

**Prerequisite:** Plan 1 (foundation) must be complete — `check_access`, `AccessResult`, the `presentation_access` migration, and the sqlx cache update must all be in place.

**Tech Stack:** Rust/Axum (routes), SQLx, Tera templates, vanilla JS (dialog focus management)

---

## File Map

| File | Change |
|------|--------|
| `syncslide-websocket/src/db.rs` | Add `PresentationAccess` struct + `add_access`, `remove_access`, `change_access_role`, `get_access_for_presentation` methods |
| `syncslide-websocket/src/main.rs` | Add three access-management route handlers; update `present` handler; register routes |
| `syncslide-websocket/templates/presentations.html` | Add "Manage co-presenters" button + dialog per owned presentation; fix Cancel button order in all existing dialogs |
| `syncslide-websocket/templates/recording.html` | Fix Close button order in `editPresentationDialog` |
| `tests/presentations.spec.js` | Add dialog structure and open/close tests |

---

### Task 1: PresentationAccess DB Methods

**Files:**
- Modify: `syncslide-websocket/src/db.rs`

- [ ] **Step 1: Write failing tests for the DB methods**

Add to the `access_tests` module in `db.rs` (created in plan 1):

```rust
/// add_access must insert a row and get_access_for_presentation must return it.
#[tokio::test]
async fn add_and_get_access() {
    let pool = setup_pool().await;
    let owner = make_user(&pool, "owner_a1").await;
    let editor = make_user(&pool, "editor_a1").await;
    let pres = make_presentation(&owner, &pool).await;

    PresentationAccess::add(&pool, pres.id, editor.id, "editor").await.unwrap();
    let entries = PresentationAccess::get_for_presentation(&pool, pres.id).await.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].user_id, editor.id);
    assert_eq!(entries[0].role, "editor");
}

/// remove_access must delete the row.
#[tokio::test]
async fn remove_access_deletes_row() {
    let pool = setup_pool().await;
    let owner = make_user(&pool, "owner_a2").await;
    let editor = make_user(&pool, "editor_a2").await;
    let pres = make_presentation(&owner, &pool).await;
    PresentationAccess::add(&pool, pres.id, editor.id, "editor").await.unwrap();

    PresentationAccess::remove(&pool, pres.id, editor.id).await.unwrap();
    let entries = PresentationAccess::get_for_presentation(&pool, pres.id).await.unwrap();
    assert!(entries.is_empty());
}

/// change_role must update the role for an existing row.
#[tokio::test]
async fn change_role_updates_existing_row() {
    let pool = setup_pool().await;
    let owner = make_user(&pool, "owner_a3").await;
    let editor = make_user(&pool, "editor_a3").await;
    let pres = make_presentation(&owner, &pool).await;
    PresentationAccess::add(&pool, pres.id, editor.id, "editor").await.unwrap();

    PresentationAccess::change_role(&pool, pres.id, editor.id, "controller").await.unwrap();
    let entries = PresentationAccess::get_for_presentation(&pool, pres.id).await.unwrap();
    assert_eq!(entries[0].role, "controller");
}
```

- [ ] **Step 2: Push and verify tests fail (PresentationAccess not defined)**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test add_and_get_access remove_access change_role 2>&1 | head -20
```
Expected: compile error — `PresentationAccess` not defined.

- [ ] **Step 3: Add PresentationAccess struct and methods to db.rs**

Place after the `Presentation` impl block:

```rust
/// A co-presenter entry from the `presentation_access` table.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PresentationAccess {
    pub id: i64,
    pub presentation_id: i64,
    pub user_id: i64,
    pub role: String,
}

impl PresentationAccess {
    /// Returns all co-presenter rows for a presentation.
    pub async fn get_for_presentation(
        db: &SqlitePool,
        presentation_id: i64,
    ) -> Result<Vec<Self>, Error> {
        sqlx::query_as::<_, PresentationAccess>(
            "SELECT pa.*, u.name as username FROM presentation_access pa
             JOIN users u ON u.id = pa.user_id
             WHERE pa.presentation_id = ?",
        )
        .bind(presentation_id)
        .fetch_all(db)
        .await
        .map_err(Error::from)
    }

    /// Adds a co-presenter. `role` must be `'editor'` or `'controller'`.
    pub async fn add(
        db: &SqlitePool,
        presentation_id: i64,
        user_id: i64,
        role: &str,
    ) -> Result<(), Error> {
        sqlx::query(
            "INSERT INTO presentation_access (presentation_id, user_id, role)
             VALUES (?, ?, ?)",
        )
        .bind(presentation_id)
        .bind(user_id)
        .bind(role)
        .execute(db)
        .await
        .map_err(Error::from)
        .map(|_| ())
    }

    /// Removes a co-presenter row.
    pub async fn remove(
        db: &SqlitePool,
        presentation_id: i64,
        user_id: i64,
    ) -> Result<(), Error> {
        sqlx::query(
            "DELETE FROM presentation_access WHERE presentation_id = ? AND user_id = ?",
        )
        .bind(presentation_id)
        .bind(user_id)
        .execute(db)
        .await
        .map_err(Error::from)
        .map(|_| ())
    }

    /// Updates the role for an existing co-presenter row.
    pub async fn change_role(
        db: &SqlitePool,
        presentation_id: i64,
        user_id: i64,
        new_role: &str,
    ) -> Result<(), Error> {
        sqlx::query(
            "UPDATE presentation_access SET role = ?
             WHERE presentation_id = ? AND user_id = ?",
        )
        .bind(new_role)
        .bind(presentation_id)
        .bind(user_id)
        .execute(db)
        .await
        .map_err(Error::from)
        .map(|_| ())
    }
}
```

Note: the `get_for_presentation` query joins `users` to include the username for display in the template. Add `pub username: String` to `PresentationAccess` to hold it:

```rust
pub struct PresentationAccess {
    pub id: i64,
    pub presentation_id: i64,
    pub user_id: i64,
    pub role: String,
    pub username: String,  // populated by JOIN
}
```

- [ ] **Step 4: Export PresentationAccess from db in main.rs**

Find the `use db::{ ... }` block and add `PresentationAccess`:
```rust
use db::{
    check_access, AccessResult, AddUserForm, AuthSession, Backend, ChangePasswordForm, Group,
    LoginForm, Presentation as DbPresentation, PresentationAccess, Recording, RecordingSlide,
    RecordingSlideInput, User,
};
```

- [ ] **Step 5: Run tests**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test add_and_get_access remove_access change_role 2>&1 | tail -20
```
Expected: all three tests pass.

- [ ] **Step 6: Commit**

```bash
git add syncslide-websocket/src/db.rs syncslide-websocket/src/main.rs
git commit -m "feat: add PresentationAccess DB struct and methods"
```

---

### Task 2: Access Management Routes

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

Form definitions for the three routes:

```rust
#[derive(Deserialize)]
struct AddAccessForm {
    username: String,
    role: String,
}

#[derive(Deserialize)]
struct RemoveAccessForm {
    user_id: i64,
}

#[derive(Deserialize)]
struct ChangeRoleForm {
    user_id: i64,
    role: String,
}
```

- [ ] **Step 1: Write Rust tests for the three routes**

Add to the `#[cfg(test)]` block in `main.rs`:

```rust
/// POST /user/presentations/{pid}/access/add by the owner must insert the row
/// and redirect to /user/presentations.
#[tokio::test]
async fn add_access_as_owner_inserts_row() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    let uid = get_user_id("testuser", &state.db_pool).await;
    let pid = seed_presentation(uid, "Shared Pres", &state.db_pool).await;
    // Create a second user to add as co-presenter
    User::new(
        &state.db_pool,
        AddUserForm {
            name: "couser".to_string(),
            email: "co@example.com".to_string(),
            password: "copass".to_string(),
        },
    )
    .await
    .unwrap();
    login_as(&server, "testuser", "testpass").await;

    let response = server
        .post(&format!("/user/presentations/{pid}/access/add"))
        .form(&serde_json::json!({ "username": "couser", "role": "editor" }))
        .await;

    assert_eq!(response.status_code(), 303);
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM presentation_access WHERE presentation_id = ?",
    )
    .bind(pid)
    .fetch_one(&state.db_pool)
    .await
    .unwrap();
    assert_eq!(count, 1, "access row must be inserted");
}

/// POST .../access/add by a non-owner must return 404.
#[tokio::test]
async fn add_access_by_non_owner_returns_404() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    seed_admin_user(&state.db_pool).await;
    let owner_id = get_user_id("adminuser", &state.db_pool).await;
    let pid = seed_presentation(owner_id, "Owner Pres", &state.db_pool).await;
    login_as(&server, "testuser", "testpass").await;

    let response = server
        .post(&format!("/user/presentations/{pid}/access/add"))
        .form(&serde_json::json!({ "username": "adminuser", "role": "editor" }))
        .await;

    assert_eq!(response.status_code(), 404);
}

/// POST .../access/remove by the owner must delete the row.
#[tokio::test]
async fn remove_access_as_owner_deletes_row() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    let uid = get_user_id("testuser", &state.db_pool).await;
    let pid = seed_presentation(uid, "Rm Pres", &state.db_pool).await;
    User::new(
        &state.db_pool,
        AddUserForm {
            name: "couser2".to_string(),
            email: "co2@example.com".to_string(),
            password: "copass2".to_string(),
        },
    )
    .await
    .unwrap();
    let co_uid = get_user_id("couser2", &state.db_pool).await;
    PresentationAccess::add(&state.db_pool, pid, co_uid, "editor").await.unwrap();
    login_as(&server, "testuser", "testpass").await;

    let response = server
        .post(&format!("/user/presentations/{pid}/access/remove"))
        .form(&serde_json::json!({ "user_id": co_uid }))
        .await;

    assert_eq!(response.status_code(), 303);
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM presentation_access WHERE presentation_id = ?")
            .bind(pid)
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
    assert_eq!(count, 0, "access row must be deleted");
}
```

Add the `change_access_role` route test alongside the others:

```rust
/// POST .../access/change-role by the owner must update the role in the DB.
#[tokio::test]
async fn change_access_role_as_owner_updates_role() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    let uid = get_user_id("testuser", &state.db_pool).await;
    let pid = seed_presentation(uid, "Change Role Pres", &state.db_pool).await;
    User::new(
        &state.db_pool,
        AddUserForm {
            name: "couser3".to_string(),
            email: "co3@example.com".to_string(),
            password: "copass3".to_string(),
        },
    )
    .await
    .unwrap();
    let co_uid = get_user_id("couser3", &state.db_pool).await;
    PresentationAccess::add(&state.db_pool, pid, co_uid, "editor").await.unwrap();
    login_as(&server, "testuser", "testpass").await;

    let response = server
        .post(&format!("/user/presentations/{pid}/access/change-role"))
        .form(&serde_json::json!({ "user_id": co_uid, "role": "controller" }))
        .await;

    assert_eq!(response.status_code(), 303);
    let role: String = sqlx::query_scalar(
        "SELECT role FROM presentation_access WHERE presentation_id = ? AND user_id = ?",
    )
    .bind(pid)
    .bind(co_uid)
    .fetch_one(&state.db_pool)
    .await
    .unwrap();
    assert_eq!(role, "controller", "role must be updated to controller");
}
```

- [ ] **Step 2: Run tests — expect compile error (handlers not defined yet)**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test add_access_as_owner remove_access_as_owner add_access_by_non change_access_role_as_owner 2>&1 | head -20
```

- [ ] **Step 3: Implement the three handlers in main.rs**

Add after the `delete_presentation` handler:

```rust
async fn add_access(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
    Form(form): Form<AddAccessForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    if form.role != "editor" && form.role != "controller" {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let Ok(Some(target)) = User::get_by_name(form.username, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // Don't allow adding the owner as a co-presenter
    if target.id == user.id {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match PresentationAccess::add(&db, pid, target.id, &form.role).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn remove_access(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
    Form(form): Form<RemoveAccessForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    match PresentationAccess::remove(&db, pid, form.user_id).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn change_access_role(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
    Form(form): Form<ChangeRoleForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    if form.role != "editor" && form.role != "controller" {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match PresentationAccess::change_role(&db, pid, form.user_id, &form.role).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
```

Add the three form structs near the other form structs at the top of `main.rs`:

```rust
#[derive(Deserialize)]
struct AddAccessForm {
    username: String,
    role: String,
}

#[derive(Deserialize)]
struct RemoveAccessForm {
    user_id: i64,
}

#[derive(Deserialize)]
struct ChangeRoleForm {
    user_id: i64,
    role: String,
}
```

- [ ] **Step 4: Register the routes**

In the `Router` builder (around line 1077), add after the existing user routes:

```rust
.route("/user/presentations/{pid}/access/add", post(add_access))
.route("/user/presentations/{pid}/access/remove", post(remove_access))
.route("/user/presentations/{pid}/access/change-role", post(change_access_role))
```

- [ ] **Step 5: Run tests**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test add_access_as_owner remove_access_as_owner add_access_by_non change_access_role_as_owner 2>&1 | tail -20
```
Expected: all four pass.

- [ ] **Step 6: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "feat: add co-presenter access management routes"
```

---

### Task 3: Editor Gets Stage Access

**Files:**
- Modify: `syncslide-websocket/src/main.rs` (the `present` handler, ~line 360)

- [ ] **Step 1: Write a failing test**

Add to the `#[cfg(test)]` block:

```rust
/// GET /{uname}/{pid} by an editor must redirect to the stage (same as owner).
/// The response is 200 (stage.html is rendered, not a redirect — stage() renders directly).
#[tokio::test]
async fn editor_gets_stage_access() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    let uid = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(uid, "Editor Stage Test", &state.db_pool).await;
    User::new(
        &state.db_pool,
        AddUserForm {
            name: "editoruser".to_string(),
            email: "ed@example.com".to_string(),
            password: "edpass".to_string(),
        },
    )
    .await
    .unwrap();
    let ed_uid = get_user_id("editoruser", &state.db_pool).await;
    PresentationAccess::add(&state.db_pool, pid, ed_uid, "editor").await.unwrap();
    login_as(&server, "editoruser", "edpass").await;

    let response = server.get(&format!("/admin/{pid}")).await;

    // stage() renders stage.html (200), not a redirect. The stage template
    // contains a textarea; use that as a proxy for "stage was rendered".
    assert_eq!(response.status_code(), 200);
    assert!(
        response.text().contains("stage"),
        "editor must see the stage page"
    );
}

/// GET /{uname}/{pid} by a controller must NOT get stage access.
#[tokio::test]
async fn controller_gets_audience_not_stage() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    let uid = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(uid, "Controller Audience Test", &state.db_pool).await;
    User::new(
        &state.db_pool,
        AddUserForm {
            name: "ctrluser".to_string(),
            email: "ctrl@example.com".to_string(),
            password: "ctrlpass".to_string(),
        },
    )
    .await
    .unwrap();
    let ctrl_uid = get_user_id("ctrluser", &state.db_pool).await;
    PresentationAccess::add(&state.db_pool, pid, ctrl_uid, "controller").await.unwrap();
    login_as(&server, "ctrluser", "ctrlpass").await;

    let response = server.get(&format!("/admin/{pid}")).await;
    assert_eq!(response.status_code(), 200);
    // The audience template contains the text "audience" in its body/script;
    // the stage template contains a textarea with id="markdown-input".
    assert!(
        !response.text().contains("markdown-input"),
        "controller must not see the stage textarea"
    );
}
```

- [ ] **Step 2: Run tests — expect failure (current code uses is_owner only)**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test editor_gets_stage controller_gets_audience 2>&1 | tail -20
```
Expected: `editor_gets_stage_access` fails — editor currently gets audience view.

- [ ] **Step 3: Update the present handler to use check_access**

Current `present` handler (~line 360) uses:
```rust
let is_owner = auth_session.user.as_ref().map_or(false, |u| u.id == pres_user.id);
if !is_owner {
    // render audience
}
stage(...)
```

Replace the ownership check with:

```rust
let access = check_access(&db, auth_session.user.as_ref(), pid, None)
    .await
    .unwrap_or(AccessResult::Denied);

match access {
    AccessResult::Owner | AccessResult::Editor => {
        stage(tera, db, auth_session, pid, app_state).await.into_response()
    }
    _ => {
        let slide_index = current_slide_index(&app_state, pid);
        let initial_slide = render_slide(&pres.content, slide_index, &pres.name);
        let mut ctx = Context::new();
        ctx.insert("pres", &pres);
        ctx.insert("pres_user", &pres_user);
        ctx.insert("initial_slide", &initial_slide);
        tera.render("audience.html", ctx, auth_session, db).await.into_response()
    }
}
```

Note: the `_ =>` arm handles Controller, PasswordOk, and Denied — all get the audience view for now. Plan 3 will change the Denied case to show the password page when a password is set.

- [ ] **Step 4: Run tests**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test editor_gets_stage controller_gets_audience 2>&1 | tail -20
```
Expected: both pass.

Also run the full suite:
```
cd ~/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -5
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "feat: grant editors stage access in the present handler"
```

---

### Task 4: Fix Existing Dialog Button Order

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html`
- Modify: `syncslide-websocket/templates/recording.html`

The spec requires APG order: heading → content → close/cancel button. Currently all delete dialogs place Cancel before the heading.

- [ ] **Step 1: Write a Playwright test that verifies the fixed order**

Add to `tests/presentations.spec.js`:

```js
// The delete-presentation dialog must follow APG order: heading first, cancel last.
test('delete-pres dialog has heading before cancel button', async ({ page }) => {
    await page.goto('/user/presentations');
    await page.click('button[data-open-dialog="delete-pres-1"]');
    const dialog = page.locator('#delete-pres-1');
    await expect(dialog).toBeVisible();

    // Get all focusable elements in order; heading (h1) must come before cancel button.
    const h1 = dialog.locator('h1');
    const cancelBtn = dialog.locator('button[data-close-dialog]');
    // Use DOM order (compareDocumentPosition), not visual position — CSS can
    // visually reorder elements without changing DOM/tab sequence.
    const inOrder = await dialog.evaluate(el => {
        const h = el.querySelector('h1');
        const c = el.querySelector('button[data-close-dialog]');
        // DOCUMENT_POSITION_FOLLOWING (4) means h1 precedes cancel in DOM
        return !!(h.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(inOrder).toBe(true);
});
```

- [ ] **Step 2: Run the Playwright test — expect failure**

On VPS:
```
cd ~/syncSlide && npx playwright test --grep "heading before cancel" 2>&1 | tail -20
```
Expected: fail — cancel button is currently before the heading.

- [ ] **Step 3: Fix the delete-pres dialog in presentations.html**

Current order (line 53–60):
```html
<dialog id="delete-pres-{{ pres.id }}" aria-labelledby="delete-pres-heading-{{ pres.id }}">
    <button type="button" data-close-dialog="delete-pres-{{ pres.id }}">Cancel</button>
    <h1 id="delete-pres-heading-{{ pres.id }}">Delete {{ pres.name }}?</h1>
    <p>This will permanently delete the presentation and all its recordings.</p>
    <form method="post" action="/user/presentations/{{ pres.id }}/delete">
        <button type="submit">Delete</button>
    </form>
</dialog>
```

Change to (heading first, Cancel last):
```html
<dialog id="delete-pres-{{ pres.id }}" aria-labelledby="delete-pres-heading-{{ pres.id }}">
    <h1 id="delete-pres-heading-{{ pres.id }}">Delete {{ pres.name }}?</h1>
    <p>This will permanently delete the presentation and all its recordings.</p>
    <form method="post" action="/user/presentations/{{ pres.id }}/delete">
        <button type="submit">Delete</button>
    </form>
    <button type="button" data-close-dialog="delete-pres-{{ pres.id }}">Cancel</button>
</dialog>
```

- [ ] **Step 4: Fix the delete-rec dialog in presentations.html**

Current order (line 35–42):
```html
<dialog id="delete-rec-{{ rec.id }}" aria-labelledby="delete-rec-heading-{{ rec.id }}">
    <button type="button" data-close-dialog="delete-rec-{{ rec.id }}">Cancel</button>
    <h1 id="delete-rec-heading-{{ rec.id }}">Delete {{ rec.name }}?</h1>
    <p>This will permanently delete the recording.</p>
    <form method="post" action="/user/recordings/{{ rec.id }}/delete">
        <button type="submit">Delete</button>
    </form>
</dialog>
```

Change to:
```html
<dialog id="delete-rec-{{ rec.id }}" aria-labelledby="delete-rec-heading-{{ rec.id }}">
    <h1 id="delete-rec-heading-{{ rec.id }}">Delete {{ rec.name }}?</h1>
    <p>This will permanently delete the recording.</p>
    <form method="post" action="/user/recordings/{{ rec.id }}/delete">
        <button type="submit">Delete</button>
    </form>
    <button type="button" data-close-dialog="delete-rec-{{ rec.id }}">Cancel</button>
</dialog>
```

- [ ] **Step 5: Fix the editPresentationDialog in recording.html**

Current order (line 53–62):
```html
<dialog id="editPresentationDialog" aria-labelledby="cue-editor-heading">
<button id="closeEditPresentation" type="button">Close</button>
<h1 id="cue-editor-heading">Edit Timing</h1>
...
<button id="openReplaceFiles" type="button">Replace Files</button>
</dialog>
```

Change the Close button to after the table and Replace Files button:
```html
<dialog id="editPresentationDialog" aria-labelledby="cue-editor-heading">
<h1 id="cue-editor-heading">Edit Timing</h1>
<label><input type="checkbox" id="shiftSubsequent"> Shift subsequent slides when editing a timestamp</label>
<table>
<thead><tr><th>Slide</th><th>Title</th><th>Start Time (seconds)</th></tr></thead>
<tbody id="cueTableBody"></tbody>
</table>
<button id="openReplaceFiles" type="button">Replace Files</button>
<button id="closeEditPresentation" type="button">Close</button>
</dialog>
```

Verify that `play.js` references `closeEditPresentation` and `openReplaceFiles` by ID — moving them does not change the IDs, so JS references are unaffected.

- [ ] **Step 6: Run the Playwright test**

On VPS after deploy:
```
cd ~/syncSlide && npx playwright test --grep "heading before cancel" 2>&1 | tail -10
```
Expected: pass.

- [ ] **Step 7: Run the full Playwright suite**

```
cd ~/syncSlide && npx playwright test 2>&1 | tail -10
```
Expected: all existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add syncslide-websocket/templates/presentations.html syncslide-websocket/templates/recording.html tests/presentations.spec.js
git commit -m "fix(a11y): move cancel/close buttons to after headings in all dialogs (APG order)"
```

---

### Task 5: Manage Co-Presenters Dialog

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html`
- Modify: `syncslide-websocket/src/main.rs` (presentations handler — pass access data to template)

The dialog is shown only on owned presentations. Co-presenters (editors/controllers) see neither the dialog nor its trigger button. The dialog is added in plan 4 (shared items) — for now the template still shows only owned presentations.

- [ ] **Step 1: Update the presentations handler to include access data**

The template needs to know who the co-presenters are for each presentation. Update `PresentationRecordings` in `db.rs` to carry access entries:

Add `pub access: Vec<PresentationAccess>` to `PresentationRecordings`:
```rust
pub struct PresentationRecordings {
    pub id: i64,
    pub user_id: i64,
    pub content: String,
    pub name: String,
    pub recordings: Vec<Recording>,
    pub access: Vec<PresentationAccess>,
}
```

Update `Recording::get_by_presentation` to populate `access`. Since this function already takes a `Presentation`, fetch the access list:

```rust
pub async fn get_by_presentation(
    pres: Presentation,
    db: &SqlitePool,
) -> Result<PresentationRecordings, Error> {
    let recordings = sqlx::query_as::<_, Recording>(
        "SELECT * FROM recording WHERE presentation_id = ?;",
    )
    .bind(pres.id)
    .fetch_all(db)
    .await
    .map_err(Error::from)?;
    let access = PresentationAccess::get_for_presentation(db, pres.id).await?;
    Ok(PresentationRecordings {
        recordings,
        access,
        id: pres.id,
        name: pres.name,
        user_id: pres.user_id,
        content: pres.content,
    })
}
```

- [ ] **Step 2: Write a Playwright test for the manage dialog**

Add to `tests/presentations.spec.js`:

```js
// The "Manage co-presenters" button must be present on each presentation item.
test('manage co-presenters button is present', async ({ page }) => {
    await page.goto('/user/presentations');
    // The admin owns the Demo presentation (id=1)
    const manageBtn = page.locator('button[data-open-dialog="manage-access-1"]');
    await expect(manageBtn).toBeVisible();
});

// The manage dialog must open with the correct heading first.
test('manage co-presenters dialog opens with heading first', async ({ page }) => {
    await page.goto('/user/presentations');
    await page.click('button[data-open-dialog="manage-access-1"]');
    const dialog = page.locator('#manage-access-1');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h1')).toContainText('Co-presenters for');
});

// The Close button in the manage dialog must be the last focusable element (DOM order).
test('manage dialog close button is last in DOM order', async ({ page }) => {
    await page.goto('/user/presentations');
    await page.click('button[data-open-dialog="manage-access-1"]');
    const dialog = page.locator('#manage-access-1');
    const inOrder = await dialog.evaluate(el => {
        const closeBtn = el.querySelector('button[data-close-dialog]');
        const submitBtn = el.querySelector('button[type="submit"]');
        // DOCUMENT_POSITION_FOLLOWING means submitBtn precedes closeBtn
        return !!(submitBtn.compareDocumentPosition(closeBtn) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(inOrder).toBe(true);
});
```

- [ ] **Step 3: Add the manage dialog to presentations.html**

Inside the `{% for pres in press %}` loop, after the existing delete button/dialog block and before the closing `</li>`, add:

```html
<button type="button" data-open-dialog="manage-access-{{ pres.id }}">Manage co-presenters</button>
<dialog id="manage-access-{{ pres.id }}" aria-labelledby="manage-access-heading-{{ pres.id }}">
    <h1 id="manage-access-heading-{{ pres.id }}" tabindex="-1">Co-presenters for {{ pres.name }}</h1>
    {% if pres.access | length > 0 %}
    <table>
        <thead><tr><th>Username</th><th>Role</th><th>Actions</th></tr></thead>
        <tbody>
        {% for entry in pres.access %}
        <tr>
            <td>{{ entry.username }}</td>
            <td>
                <form method="post" action="/user/presentations/{{ pres.id }}/access/change-role">
                    <input type="hidden" name="user_id" value="{{ entry.user_id }}">
                    <label for="role-{{ entry.user_id }}-{{ pres.id }}">Role for {{ entry.username }}</label>
                    <select id="role-{{ entry.user_id }}-{{ pres.id }}" name="role">
                        <option value="editor"{% if entry.role == "editor" %} selected{% endif %}>Editor</option>
                        <option value="controller"{% if entry.role == "controller" %} selected{% endif %}>Controller</option>
                    </select>
                    <button type="submit">Save role</button>
                </form>
            </td>
            <td>
                <form method="post" action="/user/presentations/{{ pres.id }}/access/remove">
                    <input type="hidden" name="user_id" value="{{ entry.user_id }}">
                    <button type="submit">Remove</button>
                </form>
            </td>
        </tr>
        {% endfor %}
        </tbody>
    </table>
    {% endif %}
    <h2>Add co-presenter</h2>
    <form method="post" action="/user/presentations/{{ pres.id }}/access/add">
        <label for="copres-username-{{ pres.id }}">Username</label>
        <input type="text" id="copres-username-{{ pres.id }}" name="username" autocomplete="off" required>
        <label for="copres-role-{{ pres.id }}">Role</label>
        <select id="copres-role-{{ pres.id }}" name="role">
            <option value="editor">Editor</option>
            <option value="controller">Controller</option>
        </select>
        <button type="submit">Add</button>
    </form>
    <button type="button" data-close-dialog="manage-access-{{ pres.id }}">Close</button>
</dialog>
```

The `data-open-dialog` / `data-close-dialog` attributes use the same JS that already handles the delete dialogs — no new JS needed.

Add focus management: when a dialog opens, focus must move to the dialog's first focusable element. The existing JS in `presentations.html` calls `.showModal()` on the dialog element directly, which in HTML spec moves focus to the first focusable element inside the dialog. The `<h1 tabindex="-1">` ensures the heading receives focus on open (since it is the first tabbable element). When the Close button is activated, focus must return to the triggering button. Update the existing JS:

```js
document.querySelectorAll('[data-open-dialog]').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var dialog = document.getElementById(btn.dataset.openDialog);
        dialog.showModal();
        // Per spec: if co-presenters exist, focus the first role select in the
        // table; otherwise focus the h1. A select inside a tbody signals that
        // co-presenters are present.
        var firstSelect = dialog.querySelector('tbody select');
        var first = firstSelect || dialog.querySelector('h1[tabindex="-1"]') || dialog.querySelector('input, select, button');
        if (first) first.focus();
    });
});
document.querySelectorAll('[data-close-dialog]').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var dialog = document.getElementById(btn.dataset.closeDialog);
        // Return focus to the button that opened this dialog
        var opener = document.querySelector('[data-open-dialog="' + btn.dataset.closeDialog + '"]');
        dialog.close();
        if (opener) opener.focus();
    });
});
```

- [ ] **Step 4: Run the Playwright tests**

On VPS after deploy:
```
cd ~/syncSlide && npx playwright test --grep "manage co-presenters|manage dialog" 2>&1 | tail -20
```
Expected: all three new tests pass.

- [ ] **Step 5: Run the full test suite**

```
cd ~/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -5
cd ~/syncSlide && npx playwright test 2>&1 | tail -5
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add syncslide-websocket/templates/presentations.html syncslide-websocket/src/db.rs syncslide-websocket/src/main.rs tests/presentations.spec.js
git commit -m "feat: add manage co-presenters dialog to presentations list"
```

---

## Completion

After all tasks:

1. `PresentationAccess` DB struct and methods in `db.rs`
2. Three access-management routes in `main.rs` — 401 unauthenticated, 404 non-owner
3. `present` handler: Editor → stage, Controller/Denied → audience
4. All existing dialogs have APG-compliant order (heading → content → close button)
5. Manage co-presenters dialog on each owned presentation
6. All Rust tests pass; all Playwright tests pass

**Ready for Plan 3** (Password: HTTP gating + set-password dialogs + password entry page) and **Plan 4** (Presentations list: shared items + filter control).
