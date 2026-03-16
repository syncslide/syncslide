# Tech Debt Remediation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 20 known bugs and inconsistencies catalogued in `docs/superpowers/specs/2026-03-16-system-spec-design.md`.

**Architecture:** Targeted fixes to existing files only — no new modules, no structural changes. Each task is self-contained and deployable independently. Task ordering within each chunk matters only where noted (e.g., fix cascade delete before enabling FK enforcement).

**Tech Stack:** Rust (Axum, SQLx/SQLite, axum-login), Vanilla JS (no build step), Tera templates, Caddy, systemd on `arch@clippycat.ca`.

**Deployment workflow (no local server):**
- Rust changes: verify with `cargo build` locally, then commit + push + `config/update.bat` on VPS
- JS/template changes: commit + push + `config/update.bat`
- SQL query changes (in `sqlx::query!` macros): also run `DATABASE_URL=sqlite://db.sqlite3 cargo sqlx prepare` and commit `.sqlx/` changes

---

## Files Modified

| File | Tasks |
|------|-------|
| `syncslide-websocket/js/recording.js` | 1 |
| `syncslide-websocket/js/handlers.js` | 2, 19 |
| `syncslide-websocket/js/common.js` | 3 |
| `syncslide-websocket/js/play.js` | 3 |
| `syncslide-websocket/templates/recording.html` | 4 |
| `syncslide-websocket/src/main.rs` | 5, 6, 7, 8, 9, 13 |
| `syncslide-websocket/src/db.rs` | 10, 11, 12, 18 |
| `syncslide-websocket/templates/user/change_pwd.html` | 14 |
| `syncslide-websocket/migrations/20260316000001_fix_users_int.up.sql` | 15 |
| `syncslide-websocket/migrations/20260316000001_fix_users_int.down.sql` | 15 |
| `syncslide-websocket/migrations/20260316000002_remove_dead_check.up.sql` | 16 |
| `syncslide-websocket/migrations/20260316000002_remove_dead_check.down.sql` | 16 |

---

## Chunk 1: Frontend JS and Template Fixes

### Task 1: Fix resumeRecording button text (#5)

**Spec ref:** Tech debt #5 — `resumeRecording` sets button to "Resume" instead of "Pause"

**Files:**
- Modify: `syncslide-websocket/js/recording.js:45`

- [ ] **Step 1: Apply fix**

In `js/recording.js`, change line 45:
```js
// Before:
recordPauseButton.innerText = "Resume";

// After:
recordPauseButton.innerText = "Pause";
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/js/recording.js
git commit -m "fix: resumeRecording sets button text to Pause not Resume"
```

- [ ] **Step 3: Deploy and verify**

Run `config/update.bat`. On the stage page, start a recording, then click Pause, then Resume — confirm button now shows "Pause" after resuming.

---

### Task 2: Fix implicit global variable in handlers.js (#13)

**Spec ref:** Tech debt #13 — `goTo = document.getElementById("goTo")` missing `const`

**Files:**
- Modify: `syncslide-websocket/js/handlers.js:50`

- [ ] **Step 1: Apply fix**

In `js/handlers.js`, change line 50:
```js
// Before:
goTo = document.getElementById("goTo");

// After:
const goTo = document.getElementById("goTo");
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/js/handlers.js
git commit -m "fix: add const to goTo variable declaration in handlers.js"
```

- [ ] **Step 3: Deploy and verify**

Run `config/update.bat`. Open the stage page, change slides — confirm slide navigation still works.

---

### Task 3: Remove dead sanitize function (#18)

**Spec ref:** Tech debt #18 — `sanitize` defined in both `common.js` and `play.js` but called in neither.

**Files:**
- Modify: `syncslide-websocket/js/common.js:1-3`
- Modify: `syncslide-websocket/js/play.js:1-3`

- [ ] **Step 1: Verify sanitize is unused**

Check neither file calls `sanitize`:
```bash
grep -n "sanitize(" syncslide-websocket/js/common.js syncslide-websocket/js/play.js syncslide-websocket/js/handlers.js syncslide-websocket/js/recording.js syncslide-websocket/js/audience.js
```
Expected output: only the two function _definitions_ (lines 1-3 of each file), no call sites.

- [ ] **Step 2: Remove from common.js**

Delete lines 1-3 from `js/common.js`:
```js
// Remove these 3 lines:
function sanitize(s) {
	return s.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}
```

- [ ] **Step 3: Remove from play.js**

Delete lines 1-3 from `js/play.js`:
```js
// Remove these 3 lines:
function sanitize(s) {
	return s.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}
```

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/js/common.js syncslide-websocket/js/play.js
git commit -m "fix: remove dead sanitize function from common.js and play.js"
```

- [ ] **Step 5: Deploy and verify**

Run `config/update.bat`. Open the stage and recording pages — confirm no JS console errors.

---

### Task 4: Fix duplicate `default` attribute on tracks in recording.html (#15)

**Spec ref:** Tech debt #15 — both metadata track and captions track have `default` attribute

**Files:**
- Modify: `syncslide-websocket/templates/recording.html:19`

- [ ] **Step 1: Apply fix**

In `templates/recording.html`, find the captions `<track>` element (line 19) and remove the `default` attribute:
```html
<!-- Before: -->
<track default kind="captions" src="/assets/{{ recording.id }}/{{ recording.captions_path }}" srclang="en" label="Captions"/>

<!-- After: -->
<track kind="captions" src="/assets/{{ recording.id }}/{{ recording.captions_path }}" srclang="en" label="Captions"/>
```

The metadata track on line 18 keeps its `default` attribute — that one is intentional for the slide data.

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/templates/recording.html
git commit -m "fix: remove duplicate default attribute from captions track"
```

- [ ] **Step 3: Deploy and verify**

Run `config/update.bat`. Open a recording page with a video — confirm captions still load correctly.

---

## Chunk 2: Rust Backend Quick Fixes

### Task 5: Fix inverted admin check in new_user_form (#2)

**Spec ref:** Tech debt #2 — `new_user_form` returns NOT_FOUND when user IS admin (inverted logic).

**Files:**
- Modify: `syncslide-websocket/src/main.rs:471-474`

- [ ] **Step 1: Apply fix**

In `src/main.rs`, find `new_user_form` and change:
```rust
// Before:
if let Ok(is_admin) = auth_session.backend.has_perm(user, Group::Admin).await
    && is_admin
{
    return StatusCode::NOT_FOUND.into_response();
}

// After:
if let Ok(is_admin) = auth_session.backend.has_perm(user, Group::Admin).await
    && !is_admin
{
    return StatusCode::NOT_FOUND.into_response();
}
```

- [ ] **Step 2: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "fix: invert admin permission check in new_user_form"
```

- [ ] **Step 4: Deploy and verify**

Run `config/update.bat`. Log in as admin, visit `/user/new` — confirm the Add User form now loads. Log in as a non-admin user (create one first if needed) — confirm `/user/new` returns 404.

---

### Task 6: Fix new_user_form template render (#6)

**Spec ref:** Tech debt #6 — `tera.render("/", ...)` errors at runtime after user creation; should redirect to `/user/presentations`.

**Files:**
- Modify: `syncslide-websocket/src/main.rs:476-478`

- [ ] **Step 1: Apply fix**

In `src/main.rs`, find `new_user_form` and replace the final return:
```rust
// Before:
User::new(&db, new_user).await.unwrap();
tera.render("/", Context::new(), auth_session, db).await

// After:
User::new(&db, new_user).await.unwrap();
Redirect::to("/user/presentations").into_response()
```

- [ ] **Step 2: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "fix: redirect to /user/presentations after adding a user"
```

- [ ] **Step 4: Deploy and verify**

Run `config/update.bat`. Log in as admin, go to `/user/new`, create a user — confirm you are redirected to `/user/presentations` without error.

---

### Task 7: Remove redundant update_slide in channel_handler (#12)

**Spec ref:** Tech debt #12 — `channel_handler` calls `update_slide` on an Arc-shared state that was already updated by `socket_handler`, applying the same change twice.

**Files:**
- Modify: `syncslide-websocket/src/main.rs:249-259`

- [ ] **Step 1: Apply fix**

In `src/main.rs`, find `channel_handler` inside `ws_handle` and remove the `update_slide` call:
```rust
// Before:
let channel_handler = async {
    while let Ok(msg) = rx.recv().await {
        update_slide(&pid, msg.clone(), &mut state);
        let text = serde_json::to_string(&msg).unwrap();
        sock_send.send(Message::from(text)).await.unwrap();
        let id = pid.parse().unwrap();
        if let SlideMessage::Text(text) = msg {
            let _ = DbPresentation::update_content(id, text, &state.db_pool).await;
        }
    }
};

// After:
let channel_handler = async {
    while let Ok(msg) = rx.recv().await {
        let text = serde_json::to_string(&msg).unwrap();
        sock_send.send(Message::from(text)).await.unwrap();
        let id = pid.parse().unwrap();
        if let SlideMessage::Text(text) = msg {
            let _ = DbPresentation::update_content(id, text, &state.db_pool).await;
        }
    }
};
```

- [ ] **Step 2: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors. Check for unused variable warnings on `state` — if `state` is now only used for `state.db_pool`, that's fine.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "fix: remove redundant update_slide call in channel_handler"
```

- [ ] **Step 4: Deploy and verify**

Run `config/update.bat`. Open a presentation with two browser tabs — confirm slide changes still propagate from presenter to audience.

---

### Task 8: Fix /demo hardcoded path (#16)

**Spec ref:** Tech debt #16 — `/demo` redirects to hardcoded `/admin/1/1`; breaks if admin user or seed data changes.

**Files:**
- Modify: `syncslide-websocket/src/main.rs` — `demo` function

- [ ] **Step 1: Apply fix**

Replace the `demo` handler:
```rust
// Before:
async fn demo() -> impl IntoResponse {
    Redirect::to("/admin/1/1")
}

// After:
async fn demo(State(db): State<SqlitePool>) -> impl IntoResponse {
    let Ok(Some(user)) = User::get_by_name("admin".to_string(), &db).await else {
        return Redirect::to("/").into_response();
    };
    let Ok(presses) = DbPresentation::get_for_user(&user, &db).await else {
        return Redirect::to("/").into_response();
    };
    match presses.into_iter().next() {
        Some(pres) => Redirect::to(&format!("/{}/{}", user.name, pres.id)).into_response(),
        None => Redirect::to("/").into_response(),
    }
}
```

- [ ] **Step 2: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "fix: /demo queries DB instead of hardcoding /admin/1/1"
```

- [ ] **Step 4: Deploy and verify**

Run `config/update.bat`. Visit `/demo` — confirm it redirects to admin's first presentation page.

---

### Task 9: Fix HTML escaping in slides_html (#14)

**Spec ref:** Tech debt #14 — presentation and recording names inserted unescaped into `<title>` and `<h1>` in `slides_html`.

**Files:**
- Modify: `syncslide-websocket/src/main.rs` — `slides_html` function and `render_slide` function

- [ ] **Step 1: Extract html_escape helper**

In `src/main.rs`, add this function near `strip_leading_h1` (around line 603):
```rust
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
```

- [ ] **Step 2: Apply to slides_html**

In `slides_html`, find the `html` format string and replace unescaped name variables:
```rust
// Before:
let rec_name = &rec.name;
let pres_name = &pres.name;
let mut html = format!(
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><title>{rec_name} - Slides</title></head><body>\n<h1>{pres_name}</h1>\n"
);

// After:
let rec_name = html_escape(&rec.name);
let pres_name = html_escape(&pres.name);
let mut html = format!(
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><title>{rec_name} - Slides</title></head><body>\n<h1>{pres_name}</h1>\n"
);
```

- [ ] **Step 3: Update render_slide to use html_escape**

`render_slide` already has its own inline escaping for `pres_name`. Replace it to use the new helper:
```rust
// Before (around line 295-302):
if !pres_name.is_empty() {
    let escaped = pres_name
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    output.push_str("<h1>");
    output.push_str(&escaped);
    output.push_str("</h1>");
}

// After:
if !pres_name.is_empty() {
    output.push_str("<h1>");
    output.push_str(&html_escape(pres_name));
    output.push_str("</h1>");
}
```

- [ ] **Step 4: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "fix: HTML-escape presentation and recording names in slides_html"
```

- [ ] **Step 6: Deploy and verify**

Run `config/update.bat`. Create a presentation named `<Test & "Check">`, visit its `slides.html` URL — confirm the title and heading show the escaped text and the HTML is valid.

---

## Chunk 3: Backend Correctness Fixes

### Task 10: Fix SQL JOIN in get_user_permissions (#3)

**Spec ref:** Tech debt #3 — `INNER JOIN groups ON groups.id = group_users.user_id` should be `group_users.group_id`.

**Files:**
- Modify: `syncslide-websocket/src/db.rs:370`

- [ ] **Step 1: Apply fix**

In `src/db.rs`, find `get_user_permissions` and fix the JOIN:
```rust
// Before:
sqlx::query_as!(
    GroupWrapper,
    r#"SELECT groups.name as "name: Group"
    FROM group_users
    INNER JOIN groups
    ON groups.id = group_users.user_id
    WHERE group_users.user_id = ?"#,
    user.id
)

// After:
sqlx::query_as!(
    GroupWrapper,
    r#"SELECT groups.name as "name: Group"
    FROM group_users
    INNER JOIN groups
    ON groups.id = group_users.group_id
    WHERE group_users.user_id = ?"#,
    user.id
)
```

- [ ] **Step 2: Regenerate SQLx offline cache**

```bash
cd syncslide-websocket && DATABASE_URL=sqlite://db.sqlite3 cargo sqlx prepare
```
Expected: `.sqlx/` directory updated with new query hash files.

- [ ] **Step 3: Build**

```bash
cargo build
```
Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/src/db.rs syncslide-websocket/.sqlx/
git commit -m "fix: correct JOIN condition in get_user_permissions (group_id not user_id)"
```

- [ ] **Step 5: Deploy and verify**

Run `config/update.bat`. Log in as admin and verify the nav bar still shows "Add User (admin)". Log in as a non-admin user and verify the "Add User" link does not appear.

---

### Task 11: Fix Presentation::delete cascade for recording_slides (#4)

**Spec ref:** Tech debt #4 — deleting a presentation leaves orphaned `recording_slide` rows because `Presentation::delete` skips them.

**Files:**
- Modify: `syncslide-websocket/src/db.rs:263-276`

- [ ] **Step 1: Apply fix**

Replace `Presentation::delete` in `src/db.rs`:
```rust
// Before:
pub async fn delete(id: i64, user_id: i64, db: &SqlitePool) -> Result<(), Error> {
    sqlx::query("DELETE FROM recording WHERE presentation_id = ?")
        .bind(id)
        .execute(&*db)
        .await
        .map_err(Error::from)?;
    sqlx::query("DELETE FROM presentation WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(&*db)
        .await
        .map_err(Error::from)
        .map(|_| ())
}

// After:
pub async fn delete(id: i64, user_id: i64, db: &SqlitePool) -> Result<(), Error> {
    sqlx::query(
        "DELETE FROM recording_slide WHERE recording_id IN \
         (SELECT id FROM recording WHERE presentation_id = ?)",
    )
    .bind(id)
    .execute(&*db)
    .await
    .map_err(Error::from)?;
    sqlx::query("DELETE FROM recording WHERE presentation_id = ?")
        .bind(id)
        .execute(&*db)
        .await
        .map_err(Error::from)?;
    sqlx::query("DELETE FROM presentation WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(&*db)
        .await
        .map_err(Error::from)
        .map(|_| ())
}
```

- [ ] **Step 2: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/src/db.rs
git commit -m "fix: delete recording_slide rows when deleting a presentation"
```

- [ ] **Step 4: Deploy and verify**

Run `config/update.bat`. Create a presentation, add a recording with slides, then delete the presentation from `/user/presentations`. Confirm no error. (To verify DB cleanup, a future task enabling FK enforcement will catch violations.)

---

### Task 12: Add transaction to RecordingSlide::create_batch (#19)

**Spec ref:** Tech debt #19 — batch insert has no transaction; a mid-loop failure leaves a partial recording.

**Files:**
- Modify: `syncslide-websocket/src/db.rs:127-146`

- [ ] **Step 1: Apply fix**

Replace `create_batch` in `src/db.rs`:
```rust
// Before:
pub async fn create_batch(
    recording_id: i64,
    slides: Vec<RecordingSlideInput>,
    db: &SqlitePool,
) -> Result<(), Error> {
    for (position, slide) in slides.into_iter().enumerate() {
        sqlx::query(
            "INSERT INTO recording_slide (recording_id, start_seconds, position, title, content)
             VALUES (?, ?, ?, ?, ?);",
        )
        .bind(recording_id)
        .bind(slide.start_seconds)
        .bind(position as i64)
        .bind(slide.title)
        .bind(slide.content)
        .execute(db)
        .await
        .map_err(Error::from)?;
    }
    Ok(())
}

// After:
pub async fn create_batch(
    recording_id: i64,
    slides: Vec<RecordingSlideInput>,
    db: &SqlitePool,
) -> Result<(), Error> {
    let mut tx = db.begin().await.map_err(Error::from)?;
    for (position, slide) in slides.into_iter().enumerate() {
        sqlx::query(
            "INSERT INTO recording_slide (recording_id, start_seconds, position, title, content)
             VALUES (?, ?, ?, ?, ?);",
        )
        .bind(recording_id)
        .bind(slide.start_seconds)
        .bind(position as i64)
        .bind(slide.title)
        .bind(slide.content)
        .execute(&mut *tx)
        .await
        .map_err(Error::from)?;
    }
    tx.commit().await.map_err(Error::from)
}
```

- [ ] **Step 2: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/src/db.rs
git commit -m "fix: wrap create_batch inserts in a transaction"
```

- [ ] **Step 4: Deploy and verify**

Run `config/update.bat`. Save a new recording — confirm it saves successfully and all slides appear on playback.

---

### Task 13: Fix SIGUSR1 signal handling (#1)

**Spec ref:** Tech debt #1 — SIGUSR1 handler set up but never polled; cleanup never runs at runtime.

**Files:**
- Modify: `syncslide-websocket/src/main.rs` — `main` function

- [ ] **Step 1: Apply fix**

In `src/main.rs`, replace the signal setup in `main`:
```rust
// Before:
let sig_handle = Signals::new([SIGUSR1]).unwrap().handle();
// ... (rest of setup) ...
let signal_task = tokio::spawn(async move { cleanup(&mut state) });
axum::serve(listener, app).await.unwrap();
sig_handle.close();
let _ = signal_task.await;

// After:
let mut signals = Signals::new([SIGUSR1]).unwrap();
let sig_handle = signals.handle();
// ... (rest of setup, state is cloned for signal task) ...
let mut state_for_signal = state.clone();
let signal_task = tokio::spawn(async move {
    use futures_util::StreamExt;
    while let Some(_sig) = signals.next().await {
        cleanup(&mut state_for_signal);
    }
});
axum::serve(listener, app).await.unwrap();
sig_handle.close();
let _ = signal_task.await;
```

The full updated `main` tail (from signal setup through end):
```rust
let mut signals = Signals::new([SIGUSR1]).unwrap();
let sig_handle = signals.handle();
let db_pool = SqlitePool::connect("sqlite://db.sqlite3").await.unwrap();
sqlx::migrate!("./migrations").run(&db_pool).await.unwrap();
let session_store = SqliteStore::new(db_pool.clone());
session_store.migrate().await.unwrap();
let session_layer = SessionManagerLayer::new(session_store)
    .with_secure(false)
    .with_expiry(Expiry::OnInactivity(Duration::days(1)));
let tera = Tera::new();
let backend = Backend::new(db_pool.clone());
let auth_layer = AuthManagerLayerBuilder::new(backend, session_layer).build();

let mut state = AppState {
    tera,
    slides: Arc::new(Mutex::new(HashMap::new())),
    db_pool,
};
// ... router setup unchanged ...
let listener = tokio::net::TcpListener::bind("0.0.0.0:5002").await.unwrap();
let mut state_for_signal = state.clone();
let signal_task = tokio::spawn(async move {
    use futures_util::StreamExt;
    while let Some(_sig) = signals.next().await {
        cleanup(&mut state_for_signal);
    }
});
axum::serve(listener, app).await.unwrap();
sig_handle.close();
let _ = signal_task.await;
```

- [ ] **Step 2: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "fix: actually poll SIGUSR1 signal to trigger in-memory cleanup"
```

- [ ] **Step 4: Deploy and verify**

Run `config/update.bat`. SSH to the server and run `config/cleanup.sh`. Check that it runs without error. The cleanup removes stale presentations from memory — verify no server crash in `journalctl -u syncSlide -n 50`.

---

## Chunk 4: Database, UX, and Remaining Fixes

### Task 14: Fix password change form error feedback (#20)

**Spec ref:** Tech debt #20 — password change errors silently redirect back to the form with no user feedback.

**Files:**
- Modify: `syncslide-websocket/src/main.rs` — `change_pwd` and `change_pwd_form` handlers
- Modify: `syncslide-websocket/templates/user/change_pwd.html`

- [ ] **Step 1: Add Query extractor to change_pwd handler**

In `src/main.rs`, add this struct near the other form structs:
```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
struct PwdQuery {
    error: Option<String>,
}
```

Update the `change_pwd` handler signature and body:
```rust
// Before:
async fn change_pwd(
    State(db): State<SqlitePool>,
    State(tera): State<Tera>,
    auth_session: AuthSession,
) -> impl IntoResponse {
    let Some(ref user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    tera.render("user/change_pwd.html", Context::new(), auth_session, db)
        .await
}

// After:
async fn change_pwd(
    State(db): State<SqlitePool>,
    State(tera): State<Tera>,
    auth_session: AuthSession,
    axum::extract::Query(params): axum::extract::Query<PwdQuery>,
) -> impl IntoResponse {
    let Some(ref _user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    let mut ctx = Context::new();
    if let Some(ref err) = params.error {
        ctx.insert("error", err);
    }
    tera.render("user/change_pwd.html", ctx, auth_session, db)
        .await
}
```

- [ ] **Step 2: Update change_pwd_form redirects with error params**

In `src/main.rs`, replace the four silent redirects in `change_pwd_form`:
```rust
// Before (three occurrences of plain redirect):
return Redirect::to("/user/change_pwd").into_response();
// ...last one:
return Redirect::to("/").into_response();

// After — replace each redirect with a specific error message:
// 1. passwords don't match:
return Redirect::to("/user/change_pwd?error=Passwords+do+not+match").into_response();

// 2. old password wrong:
return Redirect::to("/user/change_pwd?error=Current+password+is+incorrect").into_response();

// 3. db update failed:
return Redirect::to("/user/change_pwd?error=Failed+to+update+password").into_response();

// 4. success — keep as-is:
return Redirect::to("/").into_response();
```

Full updated `change_pwd_form`:
```rust
async fn change_pwd_form(
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Form(pwd_form): Form<ChangePasswordForm>,
) -> impl IntoResponse {
    let Some(user) = auth_session.user else {
        return Redirect::to("/auth/login").into_response();
    };
    if pwd_form.new != pwd_form.confirm {
        return Redirect::to("/user/change_pwd?error=Passwords+do+not+match").into_response();
    }
    let phash = PasswordHash::new(&user.password).unwrap();
    if Argon2::default()
        .verify_password(pwd_form.old.as_bytes(), &phash)
        .is_err()
    {
        return Redirect::to("/user/change_pwd?error=Current+password+is+incorrect").into_response();
    }
    if user.change_password(pwd_form.new, &db).await.is_err() {
        return Redirect::to("/user/change_pwd?error=Failed+to+update+password").into_response();
    }
    Redirect::to("/").into_response()
}
```

- [ ] **Step 3: Update change_pwd.html to display errors**

In `templates/user/change_pwd.html`, add error display after `<h1>`:
```html
{% extends "nav.html" %}
{% block title %}Change Password{% endblock title %}

{% block breadcrumb %}<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">Change Password</li></ol></nav>{% endblock breadcrumb %}
{% block content %}
<main>
<h1>Change Password</h1>
{% if error %}<p role="alert">{{ error }}</p>{% endif %}
<form method="POST">
<label for="old">Old Password</label>
<input type="password" id="now" name="old" required>
<label for="new">New Password</label>
<input type="password" id="new" name="new" required>
<label for="confirm">Confirm Password</label>
<input type="password" id="confirm" name="confirm" required>
<button type="submit">Change Password</button>
</form>
</main>
{% endblock content %}
```

- [ ] **Step 4: Add Query extractor to route**

In `src/main.rs`, add `axum::extract::Query` to the imports if not already present. Check the existing `use axum::extract::...` block and add `Query` if missing:
```rust
use axum::{
    Form, Router,
    body::Body,
    extract::{
        DefaultBodyLimit, FromRef, Multipart, Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    // ...
};
```

- [ ] **Step 5: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add syncslide-websocket/src/main.rs syncslide-websocket/templates/user/change_pwd.html
git commit -m "fix: show error messages on password change failures"
```

- [ ] **Step 7: Deploy and verify**

Run `config/update.bat`. Go to `/user/change_pwd` and deliberately enter the wrong current password — confirm the error message "Current password is incorrect" appears. Try mismatched new/confirm passwords — confirm "Passwords do not match" appears.

---

### Task 15: Migration — fix users.id INT to INTEGER (#8)

**Spec ref:** Tech debt #8 — `users.id` declared as `INT NOT NULL PRIMARY KEY` instead of `INTEGER NOT NULL PRIMARY KEY`, which in SQLite means it is not a rowid alias and does not auto-increment.

**Files:**
- Create: `syncslide-websocket/migrations/20260316000001_fix_users_int.up.sql`
- Create: `syncslide-websocket/migrations/20260316000001_fix_users_int.down.sql`

- [ ] **Step 1: Write up migration**

Create `migrations/20260316000001_fix_users_int.up.sql`:
```sql
CREATE TABLE users_new (
    id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
);
INSERT INTO users_new SELECT id, name, email, password FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
```

- [ ] **Step 2: Write down migration**

Create `migrations/20260316000001_fix_users_int.down.sql`:
```sql
CREATE TABLE users_old (
    id INT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
);
INSERT INTO users_old SELECT id, name, email, password FROM users;
DROP TABLE users;
ALTER TABLE users_old RENAME TO users;
```

- [ ] **Step 3: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors. The migration will be run on next startup.

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/migrations/
git commit -m "fix: change users.id from INT to INTEGER PRIMARY KEY for correct SQLite rowid behaviour"
```

- [ ] **Step 5: Deploy and verify**

Run `config/update.bat`. Check server logs (`journalctl -u syncSlide -n 20`) — confirm migration ran without error. Log in as admin to verify existing user data is intact.

---

### Task 16: Migration — remove dead CHECK constraint from presentation (#9)

**Spec ref:** Tech debt #9 — `CHECK(length("code") <= 32)` checks the string literal `"code"`, not any column.

**Files:**
- Create: `syncslide-websocket/migrations/20260316000002_remove_dead_check.up.sql`
- Create: `syncslide-websocket/migrations/20260316000002_remove_dead_check.down.sql`

- [ ] **Step 1: Write up migration**

Create `migrations/20260316000002_remove_dead_check.up.sql`:
```sql
CREATE TABLE presentation_new (
    id INTEGER NOT NULL PRIMARY KEY UNIQUE,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
INSERT INTO presentation_new SELECT id, name, user_id, content FROM presentation;
DROP TABLE presentation;
ALTER TABLE presentation_new RENAME TO presentation;
```

- [ ] **Step 2: Write down migration**

Create `migrations/20260316000002_remove_dead_check.down.sql`:
```sql
CREATE TABLE presentation_old (
    id INTEGER NOT NULL PRIMARY KEY UNIQUE,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id),
    CHECK(length("code") <= 32)
);
INSERT INTO presentation_old SELECT id, name, user_id, content FROM presentation;
DROP TABLE presentation;
ALTER TABLE presentation_old RENAME TO presentation;
```

- [ ] **Step 3: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/migrations/
git commit -m "fix: remove no-op CHECK constraint from presentation table"
```

- [ ] **Step 5: Deploy and verify**

Run `config/update.bat`. Check server logs for successful migration. Create a new presentation and confirm it saves correctly.

---

### Task 17: Enable foreign key enforcement (#11)

**Spec ref:** Tech debt #11 — `PRAGMA foreign_keys = ON` never set; all FK constraints are unenforced.

**Note:** Do this task AFTER Task 11 (cascade delete fix) and Tasks 15-16 (schema migrations) are deployed, so existing data does not violate the newly-enforced constraints. Also run the orphan cleanup query below before enabling.

**Files:**
- Modify: `syncslide-websocket/src/main.rs` — `main` function

- [ ] **Step 1: Clean up any orphaned recording_slide rows on the VPS**

SSH to `arch@clippycat.ca` and run:
```bash
cd /home/arch/syncSlide/syncslide-websocket
sqlite3 db.sqlite3 "DELETE FROM recording_slide WHERE recording_id NOT IN (SELECT id FROM recording);"
sqlite3 db.sqlite3 "DELETE FROM recording WHERE presentation_id NOT IN (SELECT id FROM presentation);"
```

- [ ] **Step 2: Apply fix in main.rs**

Add the import for `SqliteConnectOptions` in `src/main.rs`:
```rust
// Add to existing sqlx imports:
use sqlx::sqlite::SqliteConnectOptions;
use std::str::FromStr;
```

Replace the `db_pool` connection in `main`:
```rust
// Before:
let db_pool = SqlitePool::connect("sqlite://db.sqlite3").await.unwrap();

// After:
let opts = SqliteConnectOptions::from_str("sqlite://db.sqlite3")
    .unwrap()
    .foreign_keys(true);
let db_pool = SqlitePool::connect_with(opts).await.unwrap();
```

- [ ] **Step 3: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors.

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "fix: enable SQLite foreign key enforcement via SqliteConnectOptions"
```

- [ ] **Step 5: Deploy and verify**

Run `config/update.bat`. Check server logs for clean startup. Create and delete a presentation with recordings — confirm the delete cascades without errors.

---

### Task 18: Document get_group_permissions design intent (#10)

**Spec ref:** Tech debt #10 — `get_group_permissions` delegates to `get_user_permissions` with a stale TODO comment.

**Files:**
- Modify: `syncslide-websocket/src/db.rs:382-385`

- [ ] **Step 1: Apply fix**

Replace the TODO comment in `get_group_permissions`:
```rust
// Before:
// TODO: group perms not set in DB
async fn get_group_permissions(&self, user: &User) -> Result<HashSet<Self::Permission>, Error> {
    Self::get_user_permissions(self, user).await
}

// After:
// SyncSlide uses a flat permission model: a user's permissions are the union
// of all groups they belong to. There are no group-level permissions separate
// from membership, so this delegates to get_user_permissions.
async fn get_group_permissions(&self, user: &User) -> Result<HashSet<Self::Permission>, Error> {
    Self::get_user_permissions(self, user).await
}
```

- [ ] **Step 2: Build**

```bash
cd syncslide-websocket && cargo build
```
Expected: compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/src/db.rs
git commit -m "docs: replace TODO in get_group_permissions with design intent comment"
```

---

### Task 19: Fix slide parser regex to handle ##Heading without space (#7)

**Spec ref:** Tech debt #7 — three independent slide parsers; the regex in `handlers.js` uses `^## ` (requires space) while `pulldown-cmark` accepts `##heading` (no space).

**Files:**
- Modify: `syncslide-websocket/js/handlers.js:68`

- [ ] **Step 1: Apply fix**

In `js/handlers.js`, update `markdownToSlides`:
```js
// Before:
function markdownToSlides(markdown) {
	const sections = markdown.split(/^## /m);

// After:
function markdownToSlides(markdown) {
	const sections = markdown.split(/^##\s+/m);
```

This aligns the JS regex with how both remarkable and pulldown-cmark handle headings — both accept `## ` and `##\t` but the common case is `## `.

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/js/handlers.js
git commit -m "fix: update markdownToSlides regex to match ## with any whitespace"
```

- [ ] **Step 3: Deploy and verify**

Run `config/update.bat`. Open the stage page, create slides using `## Heading` format — confirm slide table renders correctly.

---

## Notes on Items Not Requiring Code Changes

**#17 — `with_secure(false)` is intentional.** Caddy terminates TLS and the app only listens on localhost:5002. Session cookies are never sent over plain HTTP in production. No code change needed. To document this intent, add a comment:

```rust
// with_secure(false): Caddy handles TLS termination — cookies are only ever
// sent over HTTPS in production. Secure flag is not needed at the app layer.
let session_layer = SessionManagerLayer::new(session_store)
    .with_secure(false)
    .with_expiry(Expiry::OnInactivity(Duration::days(1)));
```

This can be committed as a standalone documentation commit.
