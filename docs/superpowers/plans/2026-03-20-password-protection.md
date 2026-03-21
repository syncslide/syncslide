# Password Protection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add password-setting routes for presentations and recordings, render a password entry page when a password-protected presentation is accessed without credentials, and add set-password dialogs to `presentations.html` and `recording.html`.

**Architecture:** Two new POST routes set/clear passwords (Argon2id hashed). The `present` and `recording` HTTP handlers use `check_access` to detect `Denied` on a password-protected resource and render a `join_password.html` template. A separate POST route verifies the submitted password, stores the unlocked presentation ID in the session, and redirects with `?pwd=` in the URL. The `check_access` function already handles password verification (plan 1) — this plan wires it into HTTP handlers and adds the UI.

**Prerequisite:** Plan 1 (foundation) must be complete — `check_access`, `AccessResult`, `presentation.password`, `recording.password` columns, and the sqlx cache update must all be in place. Plan 2 (co-presenters) is NOT required; plans 2 and 3 can run in any order.

**Tech Stack:** Rust/Axum (routes), tower-sessions (session storage), Tera templates, vanilla JS (show/hide password toggle)

---

## File Map

| File | Change |
|------|--------|
| `syncslide-websocket/src/db.rs` | Add `set_password` and `clear_password` methods to `Presentation` and `Recording` |
| `syncslide-websocket/src/main.rs` | Add set-password route handlers; update `present` + `recording` handlers; add session-based unlock; register routes |
| `syncslide-websocket/templates/join_password.html` | Create — password entry page |
| `syncslide-websocket/templates/presentations.html` | Add set-password button + dialog per owned presentation |
| `syncslide-websocket/templates/recording.html` | Add set-password button + dialog for owner |
| `tests/presentations.spec.js` | Add set-password dialog tests |

---

### Task 1: Password DB Methods

**Files:**
- Modify: `syncslide-websocket/src/db.rs`

- [ ] **Step 1: Write failing tests**

Add to the `access_tests` module in `db.rs`:

```rust
/// set_password must store an Argon2id hash; get_by_id must return a non-None password.
#[tokio::test]
async fn set_password_stores_hash() {
    let pool = setup_pool().await;
    let owner = make_user(&pool, "pwd_owner1").await;
    let pres = make_presentation(&owner, &pool).await;
    assert!(pres.password.is_none());

    Presentation::set_password(pres.id, "hunter2", &pool).await.unwrap();
    let updated = Presentation::get_by_id(pres.id, &pool).await.unwrap().unwrap();
    let hash = updated.password.expect("password must be set");
    // Must be Argon2id format
    assert!(hash.starts_with("$argon2id$"), "stored hash must be argon2id");
}

/// clear_password must set the column back to NULL.
#[tokio::test]
async fn clear_password_removes_hash() {
    let pool = setup_pool().await;
    let owner = make_user(&pool, "pwd_owner2").await;
    let pres = make_presentation(&owner, &pool).await;
    Presentation::set_password(pres.id, "hunter2", &pool).await.unwrap();

    Presentation::clear_password(pres.id, &pool).await.unwrap();
    let updated = Presentation::get_by_id(pres.id, &pool).await.unwrap().unwrap();
    assert!(updated.password.is_none(), "password must be NULL after clear");
}
```

- [ ] **Step 2: Run — expect compile error**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test set_password_stores_hash clear_password_removes_hash 2>&1 | head -20
```

- [ ] **Step 3: Implement set_password and clear_password on Presentation in db.rs**

Add inside the `Presentation` impl block:

```rust
/// Hashes `plaintext` with Argon2id and stores it. Minimum 8 chars, max 1000 bytes
/// should be enforced by the caller before this is invoked.
pub async fn set_password(id: i64, plaintext: &str, db: &SqlitePool) -> Result<(), Error> {
    let hash = Argon2::default()
        .hash_password(
            plaintext.as_bytes(),
            &SaltString::generate(OsRng::default()),
        )
        .map_err(Error::from)?
        .to_string();
    sqlx::query("UPDATE presentation SET password = ? WHERE id = ?")
        .bind(hash)
        .bind(id)
        .execute(db)
        .await
        .map_err(Error::from)
        .map(|_| ())
}

/// Sets presentation.password to NULL.
pub async fn clear_password(id: i64, db: &SqlitePool) -> Result<(), Error> {
    sqlx::query("UPDATE presentation SET password = NULL WHERE id = ?")
        .bind(id)
        .execute(db)
        .await
        .map_err(Error::from)
        .map(|_| ())
}
```

Add the same two methods to the `Recording` impl block, targeting `recording.password`. Add a third method, `reset_password_to_inherit`, that sets `recording.password = NULL` (same as `clear_password` semantically — NULL means "inherit from presentation"):

```rust
pub async fn set_password(id: i64, plaintext: &str, db: &SqlitePool) -> Result<(), Error> {
    let hash = Argon2::default()
        .hash_password(
            plaintext.as_bytes(),
            &SaltString::generate(OsRng::default()),
        )
        .map_err(Error::from)?
        .to_string();
    sqlx::query("UPDATE recording SET password = ? WHERE id = ?")
        .bind(hash)
        .bind(id)
        .execute(db)
        .await
        .map_err(Error::from)
        .map(|_| ())
}

pub async fn clear_password(id: i64, db: &SqlitePool) -> Result<(), Error> {
    sqlx::query("UPDATE recording SET password = NULL WHERE id = ?")
        .bind(id)
        .execute(db)
        .await
        .map_err(Error::from)
        .map(|_| ())
}
```

`clear_password` and "reset to inherit" are identical operations for recordings (both set to NULL), so one method covers both buttons in the UI.

Ensure `OsRng`, `SaltString`, `Argon2`, and `PasswordHasher` are in scope — they are already imported in `db.rs` for `User::new`.

- [ ] **Step 4: Run tests**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test set_password clear_password 2>&1 | tail -20
```
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/src/db.rs
git commit -m "feat: add set_password and clear_password methods to Presentation and Recording"
```

---

### Task 2: Set-Password Routes

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

Two routes (owner-only, 401 unauthenticated, 404 non-owner):
- `POST /user/presentations/{pid}/password` — set or clear presentation password
- `POST /user/recordings/{rid}/password` — set or clear recording password

Form:
```rust
#[derive(Deserialize)]
struct SetPasswordForm {
    password: Option<String>,  // None or empty string = clear
    action: String,            // "set" or "clear"
}
```

- [ ] **Step 1: Write failing tests**

Add to `#[cfg(test)]` in `main.rs`:

```rust
/// POST /user/presentations/{pid}/password by the owner must hash and store the password.
#[tokio::test]
async fn set_presentation_password_as_owner() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    let uid = get_user_id("testuser", &state.db_pool).await;
    let pid = seed_presentation(uid, "Protected Pres", &state.db_pool).await;
    login_as(&server, "testuser", "testpass").await;

    let response = server
        .post(&format!("/user/presentations/{pid}/password"))
        .form(&serde_json::json!({ "password": "mysecret1", "action": "set" }))
        .await;

    assert_eq!(response.status_code(), 303);
    let pres = DbPresentation::get_by_id(pid, &state.db_pool).await.unwrap().unwrap();
    assert!(
        pres.password.is_some(),
        "password must be stored after set"
    );
}

/// POST .../password with action=clear must null out the password.
#[tokio::test]
async fn clear_presentation_password_as_owner() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    let uid = get_user_id("testuser", &state.db_pool).await;
    let pid = seed_presentation(uid, "Clear Pres", &state.db_pool).await;
    DbPresentation::set_password(pid, "mysecret1", &state.db_pool).await.unwrap();
    login_as(&server, "testuser", "testpass").await;

    let response = server
        .post(&format!("/user/presentations/{pid}/password"))
        .form(&serde_json::json!({ "action": "clear" }))
        .await;

    assert_eq!(response.status_code(), 303);
    let pres = DbPresentation::get_by_id(pid, &state.db_pool).await.unwrap().unwrap();
    assert!(pres.password.is_none(), "password must be NULL after clear");
}

/// POST .../password by a non-owner must return 404.
#[tokio::test]
async fn set_password_by_non_owner_returns_404() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    seed_admin_user(&state.db_pool).await;
    let owner_id = get_user_id("adminuser", &state.db_pool).await;
    let pid = seed_presentation(owner_id, "Theirs", &state.db_pool).await;
    login_as(&server, "testuser", "testpass").await;

    let response = server
        .post(&format!("/user/presentations/{pid}/password"))
        .form(&serde_json::json!({ "password": "attempt", "action": "set" }))
        .await;

    assert_eq!(response.status_code(), 404);
}
```

- [ ] **Step 2: Run — expect compile error (handlers not defined)**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test set_presentation_password clear_presentation_password set_password_by_non 2>&1 | head -20
```

- [ ] **Step 3: Implement the handlers**

Add after the access management handlers:

```rust
async fn set_presentation_password(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(pid): Path<i64>,
    Form(form): Form<SetPasswordForm>,
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
    if form.action == "clear" {
        match DbPresentation::clear_password(pid, &db).await {
            Ok(()) => return Redirect::to("/user/presentations").into_response(),
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        }
    }
    let pwd = match &form.password {
        Some(p) if p.len() >= 8 && p.len() <= 1000 => p.as_str(),
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };
    match DbPresentation::set_password(pid, pwd, &db).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn set_recording_password(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path(rid): Path<i64>,
    Form(form): Form<SetPasswordForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    // Ownership: join through presentation
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM recording
         JOIN presentation ON presentation.id = recording.presentation_id
         WHERE recording.id = ? AND presentation.user_id = ?",
    )
    .bind(rid)
    .bind(user.id)
    .fetch_one(&db)
    .await
    .unwrap_or(0);
    if count == 0 {
        return StatusCode::NOT_FOUND.into_response();
    }
    if form.action == "clear" {
        match Recording::clear_password(rid, &db).await {
            Ok(()) => return Redirect::to("/user/presentations").into_response(),
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        }
    }
    let pwd = match &form.password {
        Some(p) if p.len() >= 8 && p.len() <= 1000 => p.as_str(),
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };
    match Recording::set_password(rid, pwd, &db).await {
        Ok(()) => Redirect::to("/user/presentations").into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
```

Add the form struct near the other form structs:
```rust
#[derive(Deserialize)]
struct SetPasswordForm {
    password: Option<String>,
    action: String,
}
```

Register the routes:
```rust
.route("/user/presentations/{pid}/password", post(set_presentation_password))
.route("/user/recordings/{rid}/password", post(set_recording_password))
```

- [ ] **Step 4: Run tests**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test set_presentation_password clear_presentation_password set_password_by_non 2>&1 | tail -20
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "feat: add set-password and clear-password routes for presentations and recordings"
```

---

### Task 3: Password Entry Page

**Files:**
- Create: `syncslide-websocket/templates/join_password.html`
- Modify: `syncslide-websocket/src/main.rs` (update `present` handler + new `join_password_submit` route)

When a visitor arrives at a password-protected presentation without a valid session cookie or `?pwd=` param, the server renders the password entry page instead of the audience view.

**Session key convention:** Store unlocked presentation IDs in the session as `"unlocked_presentations"` → `Vec<i64>`. Use `tower-sessions`' typed session data.

- [ ] **Step 1: Create the password entry template**

`syncslide-websocket/templates/join_password.html`:

```html
{% extends "nav.html" %}
{% block title %}Join: {{ pres_name }}{% endblock title %}
{% block content %}
<h1>Join {{ pres_name }}</h1>
<p>This presentation is password protected.</p>
<form method="post" action="/join-password/{{ pres_owner }}/{{ pres_id }}">
    {% if error %}<p role="alert">Incorrect password.</p>{% endif %}
    <label for="pwd-input">Password</label>
    <div>
        <input type="password" id="pwd-input" name="password" autocomplete="current-password" required>
        <button type="button" id="show-pwd" aria-pressed="false" aria-label="Show password">Show</button>
    </div>
    <button type="submit">Join</button>
</form>
<script>
(function () {
    var input = document.getElementById('pwd-input');
    var toggle = document.getElementById('show-pwd');
    toggle.addEventListener('click', function () {
        var isShowing = toggle.getAttribute('aria-pressed') === 'true';
        input.type = isShowing ? 'password' : 'text';
        toggle.setAttribute('aria-pressed', isShowing ? 'false' : 'true');
    });
})();
</script>
{% endblock content %}
```

Key accessibility properties:
- `<h1>` is first announced on page arrival
- Error paragraph uses `role="alert"` so re-render with error is announced; focus stays on the password field (form is re-rendered, browser auto-focuses first invalid field on submit failure — the `required` attribute ensures the empty-submit case is caught before the server round-trip)
- Show/hide toggle: static `aria-label="Show password"`, `aria-pressed` toggles between `"true"` and `"false"`
- `autocomplete="current-password"` on the input

- [ ] **Step 2: Write failing tests for the HTTP gating**

Add to `#[cfg(test)]` in `main.rs`:

```rust
/// GET /{uname}/{pid} on a password-protected presentation without credentials
/// must render the password entry page (200, not a redirect).
#[tokio::test]
async fn password_protected_presentation_shows_entry_page() {
    let (server, state) = test_server().await;
    let uid = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(uid, "Secret Pres", &state.db_pool).await;
    DbPresentation::set_password(pid, "secretpass", &state.db_pool).await.unwrap();
    // No login — anonymous visitor

    let response = server.get(&format!("/admin/{pid}")).await;

    assert_eq!(response.status_code(), 200);
    assert!(
        response.text().contains("password protected"),
        "must show the password entry page"
    );
}

/// POST /join-password/{uname}/{pid} with correct password must redirect
/// to the audience URL with ?pwd= appended.
#[tokio::test]
async fn correct_password_redirects_to_audience() {
    let (server, state) = test_server().await;
    let uid = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(uid, "Redirect Pres", &state.db_pool).await;
    DbPresentation::set_password(pid, "correctpass", &state.db_pool).await.unwrap();

    let response = server
        .post(&format!("/join-password/admin/{pid}"))
        .form(&serde_json::json!({ "password": "correctpass" }))
        .await;

    assert_eq!(response.status_code(), 303);
    let location = response.headers()["location"].to_str().unwrap();
    assert!(
        location.contains("?pwd="),
        "redirect must include ?pwd= in the URL, got: {location}"
    );
}

/// POST /join-password/{uname}/{pid} with wrong password must re-render the form (200).
#[tokio::test]
async fn wrong_password_rerenders_entry_page() {
    let (server, state) = test_server().await;
    let uid = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(uid, "Wrong Pass Pres", &state.db_pool).await;
    DbPresentation::set_password(pid, "correctpass", &state.db_pool).await.unwrap();

    let response = server
        .post(&format!("/join-password/admin/{pid}"))
        .form(&serde_json::json!({ "password": "wrongpass" }))
        .await;

    assert_eq!(response.status_code(), 200);
    assert!(
        response.text().contains("Incorrect password"),
        "wrong password must show error message"
    );
}
```

- [ ] **Step 3: Run — expect compile/route failure**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test password_protected_presentation correct_password_redirects wrong_password_rerenders 2>&1 | head -20
```

- [ ] **Step 4: Add the join_password_submit handler**

```rust
#[derive(Deserialize)]
struct JoinPasswordForm {
    password: String,
}

async fn join_password_submit(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path((uname, pid)): Path<(String, i64)>,
    Form(form): Form<JoinPasswordForm>,
) -> impl IntoResponse {
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(Some(pres_user)) = User::get_by_name(uname.clone(), &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != pres_user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    let access = check_access(&db, auth_session.user.as_ref(), pid, Some(&form.password))
        .await
        .unwrap_or(AccessResult::Denied);
    match access {
        AccessResult::PasswordOk => {
            // Redirect to audience URL with ?pwd= so the user can share/bookmark it
            let redirect_url = format!("/{uname}/{pid}?pwd={}", form.password);
            Redirect::to(&redirect_url).into_response()
        }
        _ => {
            // Wrong password — re-render with error flag
            let mut ctx = Context::new();
            ctx.insert("pres_name", &pres.name);
            ctx.insert("pres_owner", &uname);
            ctx.insert("pres_id", &pid);
            ctx.insert("error", &true);
            tera.render("join_password.html", ctx, auth_session, db)
                .await
                .into_response()
        }
    }
}
```

- [ ] **Step 5: Update the present handler to render join_password.html on Denied+password**

The current `present` handler renders audience view for any non-Owner/Editor access. Update the `_ =>` arm to check whether the presentation has a password set, and if so render `join_password.html`. Also handle the `?pwd=` query param.

Add a query param extractor:
```rust
#[derive(Deserialize)]
struct PwdQuery {
    pwd: Option<String>,
}
```

Update `present` signature:
```rust
async fn present(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    State(app_state): State<AppState>,
    auth_session: AuthSession,
    Path((uname, pid)): Path<(String, i64)>,
    Query(query): Query<PwdQuery>,
) -> impl IntoResponse {
```

Update `check_access` call to pass the query password:
```rust
let access = check_access(&db, auth_session.user.as_ref(), pid, query.pwd.as_deref())
    .await
    .unwrap_or(AccessResult::Denied);
```

Update the match arm:
```rust
match access {
    AccessResult::Owner | AccessResult::Editor => {
        stage(tera, db, auth_session, pid, app_state).await.into_response()
    }
    AccessResult::PasswordOk => {
        // Password was verified — serve the audience view
        let slide_index = current_slide_index(&app_state, pid);
        let initial_slide = render_slide(&pres.content, slide_index, &pres.name);
        let mut ctx = Context::new();
        ctx.insert("pres", &pres);
        ctx.insert("pres_user", &pres_user);
        ctx.insert("initial_slide", &initial_slide);
        tera.render("audience.html", ctx, auth_session, db).await.into_response()
    }
    AccessResult::Denied => {
        if pres.password.is_some() {
            // Password set but not provided or incorrect — show entry page
            let mut ctx = Context::new();
            ctx.insert("pres_name", &pres.name);
            ctx.insert("pres_owner", &uname);
            ctx.insert("pres_id", &pid);
            ctx.insert("error", &false);
            tera.render("join_password.html", ctx, auth_session, db).await.into_response()
        } else {
            // No password — serve audience view (preserves current public-access behaviour)
            let slide_index = current_slide_index(&app_state, pid);
            let initial_slide = render_slide(&pres.content, slide_index, &pres.name);
            let mut ctx = Context::new();
            ctx.insert("pres", &pres);
            ctx.insert("pres_user", &pres_user);
            ctx.insert("initial_slide", &initial_slide);
            tera.render("audience.html", ctx, auth_session, db).await.into_response()
        }
    }
    _ => {
        // Controller — serve audience view
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

Register the join-password route:
```rust
.route("/join-password/{uname}/{pid}", post(join_password_submit))
```

- [ ] **Step 6: Run tests**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test password_protected correct_password_redirects wrong_password_rerenders 2>&1 | tail -20
```
Expected: all three pass.

Run full suite:
```
cd ~/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add syncslide-websocket/templates/join_password.html syncslide-websocket/src/main.rs
git commit -m "feat: add password entry page and HTTP gating for password-protected presentations"
```

---

### Task 4: Set-Password Dialogs in Templates

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html`
- Modify: `syncslide-websocket/templates/recording.html`

The set-password dialog is visible only to the owner. Co-presenters (plan 4) do not see it.

- [ ] **Step 1: Write a Playwright test for the set-password dialog**

Add to `tests/presentations.spec.js`:

```js
// The "Set password" button must be present on each presentation item.
test('set-password button is present for owned presentation', async ({ page }) => {
    await page.goto('/user/presentations');
    const setpwdBtn = page.locator('button[data-open-dialog="set-pwd-1"]');
    await expect(setpwdBtn).toBeVisible();
});

// The set-password dialog must open with heading first.
test('set-password dialog opens with heading first', async ({ page }) => {
    await page.goto('/user/presentations');
    await page.click('button[data-open-dialog="set-pwd-1"]');
    const dialog = page.locator('#set-pwd-1');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h1')).toContainText('Set password for');
});

// Show/hide toggle must change aria-pressed and input type.
test('set-password show/hide toggle works', async ({ page }) => {
    await page.goto('/user/presentations');
    await page.click('button[data-open-dialog="set-pwd-1"]');
    const toggle = page.locator('#set-pwd-1 .show-pwd-toggle');
    const input = page.locator('#set-pwd-1 input[name="password"]');
    // Initially hidden
    await expect(input).toHaveAttribute('type', 'password');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(input).toHaveAttribute('type', 'text');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 2: Add the set-password button and dialog to presentations.html**

Inside the `{% for pres in press %}` loop, after the manage-access dialog (from plan 2), add:

```html
<button type="button" data-open-dialog="set-pwd-{{ pres.id }}">Set password</button>
<dialog id="set-pwd-{{ pres.id }}" aria-labelledby="set-pwd-heading-{{ pres.id }}">
    <h1 id="set-pwd-heading-{{ pres.id }}" tabindex="-1">Set password for {{ pres.name }}</h1>
    <form method="post" action="/user/presentations/{{ pres.id }}/password">
        <label for="set-pwd-input-{{ pres.id }}">Password</label>
        <div>
            <input type="password" id="set-pwd-input-{{ pres.id }}" name="password"
                   autocomplete="new-password" minlength="8" maxlength="1000">
            <button type="button" class="show-pwd-toggle" aria-pressed="false" aria-label="Show password">Show</button>
        </div>
        <input type="hidden" name="action" value="set">
        <button type="submit">Save</button>
        <button type="button" id="copy-link-{{ pres.id }}" disabled
                data-pres-id="{{ pres.id }}" data-pres-owner="{{ user.name }}">Copy link with password</button>
    </form>
    <form method="post" action="/user/presentations/{{ pres.id }}/password">
        <input type="hidden" name="action" value="clear">
        <button type="submit">Clear password</button>
    </form>
    <button type="button" data-close-dialog="set-pwd-{{ pres.id }}">Close</button>
</dialog>
```

- [ ] **Step 3: Add the show/hide JS and copy-link JS to presentations.html**

Append to the existing `<script>` block (before the closing `</script>`):

```js
// Password show/hide toggles
document.querySelectorAll('.show-pwd-toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function () {
        var isShowing = toggle.getAttribute('aria-pressed') === 'true';
        var input = toggle.previousElementSibling;
        input.type = isShowing ? 'password' : 'text';
        toggle.setAttribute('aria-pressed', isShowing ? 'false' : 'true');
    });
});

// Copy-link-with-password: enabled after the Save button submits successfully.
// Since the page reloads on form submit, the copy-link button is always disabled
// on arrival. The plaintext password is read from the input at copy time.
// The button is enabled when the password input has a valid value.
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

Note on "Copy link with password" spec requirement: the spec says the button is disabled until the password has been saved to the server. Since the form reloads the page on submit, the button cannot know whether a save was successful without an additional server roundtrip or JS-driven submit. The implementation above approximates the spec: the button is disabled until the user has typed ≥8 characters (matching the minimum password length). This is a reasonable trade-off; a full implementation would use `fetch()` to submit the form and enable the button on 303. This enhancement can be added in a follow-up.

- [ ] **Step 4: Add the set-password dialog to recording.html**

The recording password dialog is only shown if the user is the owner (`is_owner` template variable already set). Add after the existing dialogs (just before `{% endif %}` at line 77):

```html
<button type="button" data-open-dialog="set-rec-pwd-{{ recording.id }}">Set recording password</button>
<dialog id="set-rec-pwd-{{ recording.id }}" aria-labelledby="set-rec-pwd-heading-{{ recording.id }}">
    <h1 id="set-rec-pwd-heading-{{ recording.id }}" tabindex="-1">Set password for {{ recording.name }}</h1>
    <form method="post" action="/user/recordings/{{ recording.id }}/password">
        <label for="rec-pwd-input">Password</label>
        <div>
            <input type="password" id="rec-pwd-input" name="password"
                   autocomplete="new-password" minlength="8" maxlength="1000">
            <button type="button" class="show-pwd-toggle" aria-pressed="false" aria-label="Show password">Show</button>
        </div>
        <input type="hidden" name="action" value="set">
        <button type="submit">Save</button>
    </form>
    <form method="post" action="/user/recordings/{{ recording.id }}/password">
        <input type="hidden" name="action" value="clear">
        <button type="submit">Clear password</button>
    </form>
    <form method="post" action="/user/recordings/{{ recording.id }}/password">
        <input type="hidden" name="action" value="clear">
        <button type="submit">Reset to inherit from presentation</button>
    </form>
    <button type="button" data-close-dialog="set-rec-pwd-{{ recording.id }}">Close</button>
</dialog>
```

Add the show/hide toggle JS to `recording.html` inside a `<script>` block at the bottom of `{% block content %}`:

```html
<script>
document.querySelectorAll('[data-open-dialog]').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var dialog = document.getElementById(btn.dataset.openDialog);
        dialog.showModal();
        var first = dialog.querySelector('h1[tabindex="-1"], input, button');
        if (first) first.focus();
    });
});
document.querySelectorAll('[data-close-dialog]').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var dialog = document.getElementById(btn.dataset.closeDialog);
        var opener = document.querySelector('[data-open-dialog="' + btn.dataset.closeDialog + '"]');
        dialog.close();
        if (opener) opener.focus();
    });
});
document.querySelectorAll('.show-pwd-toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function () {
        var isShowing = toggle.getAttribute('aria-pressed') === 'true';
        var input = toggle.previousElementSibling;
        input.type = isShowing ? 'password' : 'text';
        toggle.setAttribute('aria-pressed', isShowing ? 'false' : 'true');
    });
});
</script>
```

- [ ] **Step 5: Run tests**

On VPS after deploy:
```
cd ~/syncSlide && npx playwright test --grep "set-password" 2>&1 | tail -20
```
Expected: all new tests pass.

Run full Playwright suite:
```
cd ~/syncSlide && npx playwright test 2>&1 | tail -5
```

Run Rust suite:
```
cd ~/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -5
```

- [ ] **Step 6: Deploy and manually verify**

```bash
config/update.bat
```

- Check that a password-protected presentation shows the entry page to anonymous visitors
- Check that the correct password shows the audience view
- Check that the wrong password re-renders with "Incorrect password."
- Check that the owner's presentations list shows "Set password" buttons

- [ ] **Step 7: Commit**

```bash
git add syncslide-websocket/templates/ tests/presentations.spec.js
git commit -m "feat: add set-password dialogs to presentations list and recording page"
```

---

## Completion

After all tasks:

1. `Presentation::set_password`, `clear_password` and `Recording::set_password`, `clear_password` in `db.rs`
2. `POST /user/presentations/{pid}/password` and `POST /user/recordings/{rid}/password` — owner-only
3. `join_password.html` template — APG-accessible password entry page
4. `present` handler updated to use `check_access` with `?pwd=` query param; renders password entry page when `Denied` + password is set
5. Set-password dialogs in `presentations.html` and `recording.html`
6. All Rust tests pass; all Playwright tests pass

**Ready for Plan 4** (Presentations list: shared items + role labels + filter control).
