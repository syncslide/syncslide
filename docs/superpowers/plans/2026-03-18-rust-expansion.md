# Rust Test Expansion — Presentations, Cascade Delete, Permissions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing Rust `#[cfg(test)]` module in `src/main.rs` with tests covering: presentation CRUD HTTP flows, the `recording_slide` manual cascade deletion in `db.rs`, and the admin-only permission check on `POST /user/new`.

**No new dependencies or infrastructure.** All tests use the existing `test_server()` and `seed_user()` helpers already in `main.rs`. New seed helpers are added alongside them.

**No SQL changes.** `cargo sqlx prepare` is not needed.

**Deploy workflow:** All builds on VPS. Deploy via `config/update.bat`. Never run cargo locally.

---

## Background: What is being tested and why

### Presentations CRUD
The handlers `start_pres`, `delete_presentation`, and `update_presentation_name` have no Rust test coverage. They handle user data — a silent failure (wrong ownership check, no-op delete) would not be caught at the HTTP level without tests.

Key behaviour to verify:
- `POST /create` → 303 to `/{username}/{pid}`
- `POST /user/presentations/{pid}/delete` (own presentation) → 303 to `/user/presentations`, row is gone
- `POST /user/presentations/{pid}/delete` (other user's presentation) → 303 redirect (handler succeeds), but the row must still exist — `DbPresentation::delete` uses `WHERE id = ? AND user_id = ?` so a mismatched user_id silently deletes nothing. This is the ownership test.
- `POST /user/presentations/{pid}/name` → 200

### recording_slide cascade deletion
`DbPresentation::delete` (in `db.rs`) manually deletes `recording_slide` rows before deleting `recording` rows, then deletes the presentation. There is **no `ON DELETE CASCADE`** on these foreign keys. If the manual deletion is ever removed or broken, `recording_slide` rows become orphaned and SQLite FK enforcement (when enabled) would block future deletions.

This test directly calls `DbPresentation::delete` on the pool (bypassing HTTP) and then queries each table to verify all rows are gone.

### Admin-only permission
`POST /user/new` (create a new user) calls `auth_session.backend.has_perm(user, Group::Admin)` and returns `404 NOT_FOUND` for non-admin users. An authenticated non-admin must not be able to create accounts. No Rust test currently verifies this.

---

## Helpers to add (inside `mod tests` in `main.rs`)

These join the existing `test_server()` and `seed_user()` helpers.

### `seed_admin_user`
Creates a user AND adds them to group 1 (the admin group created by migrations):

```rust
async fn seed_admin_user(pool: &SqlitePool) {
    User::new(
        pool,
        AddUserForm {
            name: "adminuser".to_string(),
            email: "admin2@example.com".to_string(),
            password: "adminpass".to_string(),
        },
    )
    .await
    .unwrap();
    sqlx::query("INSERT INTO group_users (user_id, group_id) VALUES ((SELECT id FROM users WHERE name = 'adminuser'), 1)")
        .execute(pool)
        .await
        .unwrap();
}
```

### `login_as`
Logs in with the given credentials and returns. The TestServer saves the session cookie automatically:

```rust
async fn login_as(server: &axum_test::TestServer, username: &str, password: &str) {
    server
        .post("/auth/login")
        .form(&serde_json::json!({ "username": username, "password": password }))
        .await;
}
```

### `seed_presentation`
Inserts a presentation row directly and returns the new `id`:

```rust
async fn seed_presentation(user_id: i64, name: &str, pool: &SqlitePool) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO presentation (name, user_id, content) VALUES (?, ?, '') RETURNING id",
    )
    .bind(name)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}
```

### `get_user_id`
Fetches a user's id by name:

```rust
async fn get_user_id(name: &str, pool: &SqlitePool) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT id FROM users WHERE name = ?")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}
```

---

## Task 1: Add helpers and presentation CRUD tests

**File:** `syncslide-websocket/src/main.rs`

Add all helpers and new tests inside the existing `mod tests { ... }` block, after the last existing test.

- [ ] **Step 1: Add the four helpers** (`seed_admin_user`, `login_as`, `seed_presentation`, `get_user_id`) after `seed_user`.

- [ ] **Step 2: Add test — create presentation redirects to stage**

```rust
/// POST /create with a valid name must redirect to /{username}/{pid}.
#[tokio::test]
async fn create_presentation_redirects_to_stage() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    login_as(&server, "testuser", "testpass").await;

    let response = server
        .post("/create")
        .form(&serde_json::json!({ "name": "Test Pres" }))
        .await;

    assert_eq!(response.status_code(), 303);
    let location = response.headers()["location"].to_str().unwrap();
    assert!(
        location.starts_with("/testuser/"),
        "create must redirect to /{username}/{pid}, got: {location}"
    );
}
```

- [ ] **Step 3: Add test — delete own presentation**

```rust
/// Deleting your own presentation must redirect to /user/presentations
/// and the row must be gone from the database.
#[tokio::test]
async fn delete_own_presentation_removes_it() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    let uid = get_user_id("testuser", &state.db_pool).await;
    let pid = seed_presentation(uid, "To Delete", &state.db_pool).await;
    login_as(&server, "testuser", "testpass").await;

    let response = server
        .post(&format!("/user/presentations/{pid}/delete"))
        .await;

    assert_eq!(response.status_code(), 303);
    assert_eq!(response.headers()["location"], "/user/presentations");

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM presentation WHERE id = ?")
            .bind(pid)
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
    assert_eq!(count, 0, "deleted presentation must not exist in the database");
}
```

- [ ] **Step 4: Add test — delete another user's presentation is a no-op**

```rust
/// Attempting to delete another user's presentation must leave it intact.
/// The handler redirects (303) but the ownership check in the SQL means
/// no row is deleted when user_id does not match.
#[tokio::test]
async fn delete_other_users_presentation_is_noop() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    seed_admin_user(&state.db_pool).await;
    let owner_id = get_user_id("adminuser", &state.db_pool).await;
    let pid = seed_presentation(owner_id, "Owner's Pres", &state.db_pool).await;
    // Log in as a different user (testuser) and try to delete adminuser's presentation.
    login_as(&server, "testuser", "testpass").await;

    server
        .post(&format!("/user/presentations/{pid}/delete"))
        .await;

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM presentation WHERE id = ?")
            .bind(pid)
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
    assert_eq!(count, 1, "another user's presentation must not be deleted");
}
```

- [ ] **Step 5: Add test — rename presentation**

```rust
/// POST /user/presentations/{pid}/name with a plain-text body must return 200.
#[tokio::test]
async fn rename_presentation_returns_200() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    let uid = get_user_id("testuser", &state.db_pool).await;
    let pid = seed_presentation(uid, "Old Name", &state.db_pool).await;
    login_as(&server, "testuser", "testpass").await;

    let response = server
        .post(&format!("/user/presentations/{pid}/name"))
        .text("New Name")
        .await;

    assert_eq!(response.status_code(), 200);
}
```

- [ ] **Step 6: Deploy and verify all tests pass**

```bash
config\update.bat
```

Then on VPS:
```bash
ssh arch@clippycat.ca "cd ~/syncSlide/syncslide-websocket && cargo test -- --nocapture"
```

Expected: all previously passing tests still pass, plus 4 new ones.

- [ ] **Step 7: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "test: add presentation CRUD integration tests"
```

---

## Task 2: recording_slide cascade deletion test

**File:** `syncslide-websocket/src/main.rs`

This test calls `DbPresentation::delete` directly on the pool (not via HTTP) to verify that recording_slide rows are cleaned up by the manual cascade in `db.rs`. It does not go through the HTTP layer because there is no HTTP route that exercises the full chain of create-presentation + create-recording + create-recording-slides + delete-presentation in one request.

The test needs to insert rows into `recording` and `recording_slide` directly, since those tables require data (video filename, etc.) that the HTTP recording upload flow handles but the in-memory test DB does not have assets for.

- [ ] **Step 1: Add helper `seed_recording`**

Inside `mod tests`, after the other helpers:

```rust
/// Inserts a recording row for the given presentation and returns its id.
async fn seed_recording(presentation_id: i64, pool: &SqlitePool) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO recording (presentation_id, name, start) VALUES (?, 'Test Recording', '2026-01-01') RETURNING id",
    )
    .bind(presentation_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Inserts a recording_slide row for the given recording and returns its id.
async fn seed_recording_slide(recording_id: i64, pool: &SqlitePool) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO recording_slide (recording_id, start_seconds, position, title, content) VALUES (?, 0.0, 0, 'Slide 1', 'content') RETURNING id",
    )
    .bind(recording_id)
    .fetch_one(pool)
    .await
    .unwrap()
}
```

- [ ] **Step 2: Add the cascade test**

```rust
/// Deleting a presentation must remove all its recording_slide rows.
/// recording_slide has no ON DELETE CASCADE — DbPresentation::delete
/// performs the cleanup manually. If this ever breaks, recording_slide
/// rows become orphaned and FK enforcement will block future deletions.
#[tokio::test]
async fn delete_presentation_removes_recording_slides() {
    let (server, state) = test_server().await;
    // test_server seeds admin/admin from migrations; use that directly.
    let uid = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(uid, "With Recordings", &state.db_pool).await;
    let rid = seed_recording(pid, &state.db_pool).await;
    let sid = seed_recording_slide(rid, &state.db_pool).await;

    DbPresentation::delete(pid, uid, &state.db_pool).await.unwrap();

    let pres_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM presentation WHERE id = ?")
            .bind(pid)
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
    let rec_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM recording WHERE id = ?")
            .bind(rid)
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
    let slide_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM recording_slide WHERE id = ?")
            .bind(sid)
            .fetch_one(&state.db_pool)
            .await
            .unwrap();

    assert_eq!(pres_count, 0, "presentation row must be deleted");
    assert_eq!(rec_count, 0, "recording row must be deleted");
    assert_eq!(slide_count, 0, "recording_slide row must be deleted (manual cascade)");
}
```

Note: `let _server` is not used by name but we still call `test_server()` to get the migrated pool with admin seeded.

Actually, update the test to use `let (_server, state)`:

```rust
let (_server, state) = test_server().await;
```

- [ ] **Step 3: Deploy and verify**

```bash
config\update.bat
```

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "test: verify recording_slide manual cascade on presentation delete"
```

---

## Task 3: Admin permission test

**File:** `syncslide-websocket/src/main.rs`

`POST /user/new` creates a new user account. The handler calls `has_perm(user, Group::Admin)` and returns `404 NOT_FOUND` for non-admin users. No Rust test currently verifies this.

- [ ] **Step 1: Add the permission test**

```rust
/// POST /user/new by a non-admin authenticated user must return 404.
/// The handler explicitly returns NOT_FOUND (not 403) to avoid leaking
/// the existence of the admin-only endpoint to non-admin users.
#[tokio::test]
async fn create_user_by_non_admin_returns_404() {
    let (server, state) = test_server().await;
    seed_user(&state.db_pool).await;
    // testuser has no group membership — not in the admin group.
    login_as(&server, "testuser", "testpass").await;

    let response = server
        .post("/user/new")
        .form(&serde_json::json!({
            "name": "newuser",
            "email": "new@example.com",
            "password": "password123"
        }))
        .await;

    assert_eq!(
        response.status_code(),
        404,
        "non-admin must not be able to create users"
    );
    // The user must not have been created.
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE name = 'newuser'")
            .fetch_one(&state.db_pool)
            .await
            .unwrap();
    assert_eq!(count, 0, "new user must not exist after rejected request");
}
```

- [ ] **Step 2: Deploy and verify**

```bash
config\update.bat
```

Expected: all previously passing tests plus the new one.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "test: verify admin-only permission on POST /user/new"
```

---

## Expected final test count

After all three tasks: **7 existing + 6 new Rust = 13 Rust tests**, plus 22 Playwright = **35 total**.

---

## What is explicitly out of scope

- WebSocket sync tests — separate plan (requires two browser contexts)
- Recording upload HTTP tests — requires multipart form data and file fixtures; defer
- `change_pwd` flow tests — lower risk, defer
