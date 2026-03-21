# Access Control Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three DB migrations, update `Presentation` and `Recording` structs with a `password` field, define `AccessResult` + `check_access` in `db.rs`, and replace the `auth: bool` gate in `ws_handle` with per-role message enforcement.

**Architecture:** Migrations add `presentation_access`, `presentation.password`, and `recording.password`. The `AccessResult` enum and `check_access` async fn live in `db.rs` alongside the existing structs. `broadcast_to_all` resolves the role at WebSocket connect time by calling `check_access` with no password (password gating on HTTP routes is plan 3). `handle_socket` is extended with a `role` parameter that gates which `SlideMessage` types are accepted.

**Tech Stack:** Rust, SQLx offline mode (SQLite), Argon2id (already in Cargo.toml via `argon2` crate), Axum

---

## File Map

| File | Change |
|------|--------|
| `syncslide-websocket/migrations/20260320000001_presentation_access.up.sql` | Create — new table |
| `syncslide-websocket/migrations/20260320000001_presentation_access.down.sql` | Create — drop table |
| `syncslide-websocket/migrations/20260320000002_presentation_password.up.sql` | Create — ADD COLUMN |
| `syncslide-websocket/migrations/20260320000002_presentation_password.down.sql` | Create — no-op (SQLite cannot drop columns before 3.35; this migration is irreversible) |
| `syncslide-websocket/migrations/20260320000003_recording_password.up.sql` | Create — ADD COLUMN |
| `syncslide-websocket/migrations/20260320000003_recording_password.down.sql` | Create — no-op |
| `syncslide-websocket/src/db.rs` | Add `password: Option<String>` to `Presentation` and `Recording`; add `AccessResult` enum; add `check_access` fn |
| `syncslide-websocket/src/main.rs` | Update `broadcast_to_all` to call `check_access`; update `ws_handle` + `handle_socket` signatures; remove `auth: bool` gate |
| `.sqlx/` | Regenerate on VPS after migrations run (not done locally) |

---

### Task 1: Three DB Migrations

**Files:**
- Create: `syncslide-websocket/migrations/20260320000001_presentation_access.up.sql`
- Create: `syncslide-websocket/migrations/20260320000001_presentation_access.down.sql`
- Create: `syncslide-websocket/migrations/20260320000002_presentation_password.up.sql`
- Create: `syncslide-websocket/migrations/20260320000002_presentation_password.down.sql`
- Create: `syncslide-websocket/migrations/20260320000003_recording_password.up.sql`
- Create: `syncslide-websocket/migrations/20260320000003_recording_password.down.sql`

- [ ] **Step 1: Write migration 1 up — presentation_access table**

`syncslide-websocket/migrations/20260320000001_presentation_access.up.sql`:
```sql
CREATE TABLE presentation_access (
    id INTEGER NOT NULL PRIMARY KEY,
    presentation_id INTEGER NOT NULL REFERENCES presentation(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('editor', 'controller')),
    UNIQUE(presentation_id, user_id)
);
```

- [ ] **Step 2: Write migration 1 down**

`syncslide-websocket/migrations/20260320000001_presentation_access.down.sql`:
```sql
DROP TABLE IF EXISTS presentation_access;
```

- [ ] **Step 3: Write migration 2 up — password on presentation**

`syncslide-websocket/migrations/20260320000002_presentation_password.up.sql`:
```sql
ALTER TABLE presentation ADD COLUMN password TEXT;
```

- [ ] **Step 4: Write migration 2 down**

`syncslide-websocket/migrations/20260320000002_presentation_password.down.sql`:
```sql
-- SQLite before 3.35 cannot drop columns. This migration is irreversible.
-- To roll back: restore from a backup or recreate the table without the column.
SELECT 1;
```

- [ ] **Step 5: Write migration 3 up — password on recording**

`syncslide-websocket/migrations/20260320000003_recording_password.up.sql`:
```sql
ALTER TABLE recording ADD COLUMN password TEXT;
```

- [ ] **Step 6: Write migration 3 down**

`syncslide-websocket/migrations/20260320000003_recording_password.down.sql`:
```sql
-- SQLite before 3.35 cannot drop columns. This migration is irreversible.
SELECT 1;
```

- [ ] **Step 7: Write a Rust test that verifies the presentation_access table exists**

Add inside the `#[cfg(test)]` block in `main.rs`, near the other migration-related tests:

```rust
/// The presentation_access table must exist after migrations and accept
/// a valid (presentation_id, user_id, role) row.
#[tokio::test]
async fn presentation_access_table_exists_and_accepts_rows() {
    let (_server, state) = test_server().await;
    let uid = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(uid, "Access Test", &state.db_pool).await;

    // Insert a second user to be the co-presenter
    User::new(
        &state.db_pool,
        AddUserForm {
            name: "copresenter".to_string(),
            email: "co@example.com".to_string(),
            password: "copass".to_string(),
        },
    )
    .await
    .unwrap();
    let co_uid = get_user_id("copresenter", &state.db_pool).await;

    sqlx::query(
        "INSERT INTO presentation_access (presentation_id, user_id, role) VALUES (?, ?, 'editor')",
    )
    .bind(pid)
    .bind(co_uid)
    .execute(&state.db_pool)
    .await
    .expect("presentation_access table must accept a valid row");

    let role: String = sqlx::query_scalar(
        "SELECT role FROM presentation_access WHERE presentation_id = ? AND user_id = ?",
    )
    .bind(pid)
    .bind(co_uid)
    .fetch_one(&state.db_pool)
    .await
    .unwrap();
    assert_eq!(role, "editor");
}
```

- [ ] **Step 8: Verify test fails before migrations exist**

Push to VPS and run:
```
cd ~/syncSlide/syncslide-websocket && cargo test presentation_access_table_exists 2>&1 | tail -20
```
Expected: test fails because the table does not exist yet.

Actually, since tests run `sqlx::migrate!()` at setup, the test WILL pass once the migration files are written. Skip this step — tests are written before the migration so they fail in isolation, but in practice the test suite runs migrations first.

- [ ] **Step 9: Commit the migrations and test**

```bash
git add syncslide-websocket/migrations/ syncslide-websocket/src/main.rs
git commit -m "feat: add presentation_access table and password columns (migrations 1-3)"
```

---

### Task 2: Struct Updates in db.rs

**Files:**
- Modify: `syncslide-websocket/src/db.rs` (lines 18-29 for `Recording`, lines 194-200 for `Presentation`)

The `password` column on both tables is `NULL` by default, so the Rust field type is `Option<String>`.

- [ ] **Step 1: Add `password` field to `Recording` struct**

Current `Recording` struct (db.rs ~line 18):
```rust
#[derive(Clone, Debug, Hash, Eq, PartialEq, Serialize, Deserialize, FromRow)]
pub struct Recording {
    pub id: i64,
    pub presentation_id: i64,
    pub name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub start: OffsetDateTime,
    pub video_path: Option<String>,
    pub captions_path: String,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_edited: Option<OffsetDateTime>,
}
```

Add `pub password: Option<String>,` after `last_edited`:
```rust
#[derive(Clone, Debug, Hash, Eq, PartialEq, Serialize, Deserialize, FromRow)]
pub struct Recording {
    pub id: i64,
    pub presentation_id: i64,
    pub name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub start: OffsetDateTime,
    pub video_path: Option<String>,
    pub captions_path: String,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_edited: Option<OffsetDateTime>,
    pub password: Option<String>,
}
```

- [ ] **Step 2: Add `password` field to `Presentation` struct**

Current `Presentation` struct (db.rs ~line 194):
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Presentation {
    pub id: i64,
    pub user_id: i64,
    pub content: String,
    pub name: String,
}
```

Change to:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Presentation {
    pub id: i64,
    pub user_id: i64,
    pub content: String,
    pub name: String,
    pub password: Option<String>,
}
```

- [ ] **Step 3: Write a test that reads the password field back from the DB**

Add inside the `#[cfg(test)]` block in `db.rs`:

```rust
/// Presentation::get_by_id must return password: None when no password is set.
#[tokio::test]
async fn presentation_password_defaults_to_none() {
    let pool = SqlitePool::connect_with(
        SqliteConnectOptions::from_str("sqlite::memory:").unwrap()
    )
    .await
    .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    // The admin user is seeded by the users migration
    let admin = sqlx::query_as!(User, "SELECT * FROM users WHERE name = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let pres = Presentation::new(&admin, "Password Test".to_string(), &pool)
        .await
        .unwrap();
    assert!(
        pres.password.is_none(),
        "password must default to None when not set"
    );
    let fetched = Presentation::get_by_id(pres.id, &pool).await.unwrap().unwrap();
    assert!(fetched.password.is_none());
}
```

**Important:** This test uses `sqlx::query_as!(User, ...)` — a compile-time macro — and will not compile until `cargo sqlx prepare` has been run on the VPS to regenerate the offline cache with the new `password` column in scope. Do not expect this test to compile locally. See Task 3 for the prepare step.

- [ ] **Step 4: Commit struct changes**

```bash
git add syncslide-websocket/src/db.rs
git commit -m "feat: add password field to Presentation and Recording structs"
```

---

### Task 3: Regenerate SQLx Offline Cache (VPS-only step)

This step cannot be done locally. The compile-time `query_as!(Presentation, ...)` macros check their SQL against the offline `.sqlx/` cache. After adding the `password` column to both tables, the cache must be regenerated against a database that has run all three new migrations.

- [ ] **Step 1: Push all commits so far**

```bash
git push
```

- [ ] **Step 2: SSH to VPS and run the migration**

```bash
ssh arch@clippycat.ca
cd ~/syncSlide/syncslide-websocket
# Restart the server to apply migrations automatically, OR run them directly:
DATABASE_URL=sqlite://db.sqlite3 sqlx migrate run
```

- [ ] **Step 3: Regenerate the offline cache**

```bash
DATABASE_URL=sqlite://db.sqlite3 cargo sqlx prepare
```

This writes updated query descriptors into `.sqlx/`. The output should show queries being processed including the updated `presentation` and `recording` tables.

- [ ] **Step 4: Commit the regenerated cache from VPS**

```bash
git add .sqlx/
git commit -m "chore: regenerate sqlx offline cache for password columns"
git push
```

- [ ] **Step 5: Pull the cache update locally**

```bash
git pull
```

The codebase should now compile (cargo check) with the updated structs.

---

### Task 4: AccessResult Enum and check_access Function

**Files:**
- Modify: `syncslide-websocket/src/db.rs`

`AccessResult` and `check_access` go in `db.rs` because they are database-backed operations and depend on `Presentation`, `User`, and `Error` types already defined there.

> **Deliberate deviation from spec:** The spec says `check_access` should be in `main.rs` or a new `access.rs` module. This plan places it in `db.rs` instead. Rationale: `check_access` executes SQL queries and depends on `Presentation`, `User`, `Error`, `PasswordHash`, and `Argon2` — all already in `db.rs`. Putting it in `main.rs` would require re-importing all those types, and `main.rs` is already 1200+ lines. The result is equivalent; the public API (exported enum + fn) is the same. If you prefer to follow the spec literally, move `AccessResult` and `check_access` into `main.rs` directly and skip the `pub` qualifiers and the `use db::` import additions.

- [ ] **Step 1: Write failing tests for check_access**

Add to the `#[cfg(test)]` block at the bottom of `db.rs`. These tests require a helper to set up an in-memory pool with migrations. Add a module-level helper (or reuse the pattern from the existing tests in `db.rs`):

```rust
#[cfg(test)]
mod access_tests {
    use super::*;
    use sqlx::sqlite::SqliteConnectOptions;
    use std::str::FromStr;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect_with(
            SqliteConnectOptions::from_str("sqlite::memory:")
                .unwrap()
                .foreign_keys(false),
        )
        .await
        .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn make_user(pool: &SqlitePool, name: &str) -> User {
        User::new(
            pool,
            AddUserForm {
                name: name.to_string(),
                email: format!("{name}@example.com"),
                password: "testpass".to_string(),
            },
        )
        .await
        .unwrap();
        sqlx::query_as!(User, "SELECT * FROM users WHERE name = ?", name)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn make_presentation(owner: &User, pool: &SqlitePool) -> Presentation {
        Presentation::new(owner, "Test Pres".to_string(), pool)
            .await
            .unwrap()
    }

    /// Owner of a presentation must get AccessResult::Owner.
    #[tokio::test]
    async fn check_access_owner() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner1").await;
        let pres = make_presentation(&owner, &pool).await;

        let result = check_access(&pool, Some(&owner), pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Owner),
            "presentation owner must get Owner"
        );
    }

    /// A user with editor role in presentation_access must get AccessResult::Editor.
    #[tokio::test]
    async fn check_access_editor() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner2").await;
        let editor = make_user(&pool, "editor2").await;
        let pres = make_presentation(&owner, &pool).await;

        sqlx::query(
            "INSERT INTO presentation_access (presentation_id, user_id, role) VALUES (?, ?, 'editor')",
        )
        .bind(pres.id)
        .bind(editor.id)
        .execute(&pool)
        .await
        .unwrap();

        let result = check_access(&pool, Some(&editor), pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Editor),
            "editor must get Editor"
        );
    }

    /// A user with controller role must get AccessResult::Controller.
    #[tokio::test]
    async fn check_access_controller() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner3").await;
        let controller = make_user(&pool, "controller3").await;
        let pres = make_presentation(&owner, &pool).await;

        sqlx::query(
            "INSERT INTO presentation_access (presentation_id, user_id, role) VALUES (?, ?, 'controller')",
        )
        .bind(pres.id)
        .bind(controller.id)
        .execute(&pool)
        .await
        .unwrap();

        let result = check_access(&pool, Some(&controller), pres.id, None)
            .await
            .unwrap();
        assert!(
            matches!(result, AccessResult::Controller),
            "controller must get Controller"
        );
    }

    /// An unrelated authenticated user on a presentation with no password must get Denied.
    #[tokio::test]
    async fn check_access_unrelated_user_denied() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner4").await;
        let stranger = make_user(&pool, "stranger4").await;
        let pres = make_presentation(&owner, &pool).await;

        let result = check_access(&pool, Some(&stranger), pres.id, None)
            .await
            .unwrap();
        assert!(
            matches!(result, AccessResult::Denied),
            "unrelated user must get Denied on an unprotected presentation"
        );
    }

    /// Unauthenticated access (user = None) on a presentation with no password must get Denied.
    #[tokio::test]
    async fn check_access_unauthenticated_denied() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner5").await;
        let pres = make_presentation(&owner, &pool).await;

        let result = check_access(&pool, None, pres.id, None).await.unwrap();
        assert!(
            matches!(result, AccessResult::Denied),
            "unauthenticated access must get Denied"
        );
    }

    /// Correct password on a password-protected presentation must return PasswordOk.
    #[tokio::test]
    async fn check_access_correct_password_returns_ok() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner6").await;
        let pres = make_presentation(&owner, &pool).await;

        // Hash and store a password directly
        use argon2::password_hash::{SaltString, rand_core::OsRng};
        use argon2::{Argon2, PasswordHasher};
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"hunter2", &salt)
            .unwrap()
            .to_string();
        sqlx::query("UPDATE presentation SET password = ? WHERE id = ?")
            .bind(&hash)
            .bind(pres.id)
            .execute(&pool)
            .await
            .unwrap();

        let result = check_access(&pool, None, pres.id, Some("hunter2"))
            .await
            .unwrap();
        assert!(
            matches!(result, AccessResult::PasswordOk),
            "correct password must return PasswordOk"
        );
    }

    /// Wrong password on a password-protected presentation must return Denied.
    #[tokio::test]
    async fn check_access_wrong_password_returns_denied() {
        let pool = setup_pool().await;
        let owner = make_user(&pool, "owner7").await;
        let pres = make_presentation(&owner, &pool).await;

        use argon2::password_hash::{SaltString, rand_core::OsRng};
        use argon2::{Argon2, PasswordHasher};
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"hunter2", &salt)
            .unwrap()
            .to_string();
        sqlx::query("UPDATE presentation SET password = ? WHERE id = ?")
            .bind(&hash)
            .bind(pres.id)
            .execute(&pool)
            .await
            .unwrap();

        let result = check_access(&pool, None, pres.id, Some("wrongpass"))
            .await
            .unwrap();
        assert!(
            matches!(result, AccessResult::Denied),
            "wrong password must return Denied"
        );
    }
}
```

- [ ] **Step 2: Run the tests to confirm they fail with "unresolved name check_access"**

Push to VPS and run:
```
cd ~/syncSlide/syncslide-websocket && cargo test check_access 2>&1 | head -30
```
Expected: compile error — `check_access` and `AccessResult` are not defined yet.

- [ ] **Step 3: Add AccessResult enum to db.rs**

Place this before the `check_access` function definition (after the existing struct definitions, before the `#[cfg(test)]` block):

```rust
/// The result of an access check for a presentation.
///
/// Owners, editors, and controllers bypass password checks. `PasswordOk`
/// is returned when a provided plaintext password matches the stored Argon2id
/// hash. `Denied` is returned for all other cases (no password set means
/// the presentation is publicly viewable, but still `Denied` for write access).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessResult {
    /// The user owns the presentation.
    Owner,
    /// The user has editor access (can edit content and control slides).
    Editor,
    /// The user has controller access (can move between slides only).
    Controller,
    /// A correct password was provided for a password-protected presentation.
    PasswordOk,
    /// None of the above conditions were met.
    Denied,
}
```

- [ ] **Step 4: Implement check_access in db.rs**

Add after the `AccessResult` enum:

```rust
/// Checks what level of access a user (or unauthenticated visitor) has to a
/// presentation.
///
/// - `user`: The authenticated user, if any.
/// - `presentation_id`: The presentation to check.
/// - `provided_pwd`: A plaintext password from the request, if present.
///
/// Priority: Owner > Editor > Controller > PasswordOk > Denied.
/// Owners, editors, and controllers bypass the password check entirely.
pub async fn check_access(
    db: &SqlitePool,
    user: Option<&User>,
    presentation_id: i64,
    provided_pwd: Option<&str>,
) -> Result<AccessResult, Error> {
    let pres = sqlx::query_as!(
        Presentation,
        "SELECT * FROM presentation WHERE id = ?",
        presentation_id
    )
    .fetch_optional(db)
    .await?;

    let Some(pres) = pres else {
        return Ok(AccessResult::Denied);
    };

    if let Some(user) = user {
        // Check ownership first
        if user.id == pres.user_id {
            return Ok(AccessResult::Owner);
        }

        // Check co-presenter role
        let row = sqlx::query!(
            "SELECT role FROM presentation_access WHERE presentation_id = ? AND user_id = ?",
            presentation_id,
            user.id
        )
        .fetch_optional(db)
        .await?;

        if let Some(row) = row {
            return match row.role.as_str() {
                "editor" => Ok(AccessResult::Editor),
                "controller" => Ok(AccessResult::Controller),
                _ => Ok(AccessResult::Denied),
            };
        }
    }

    // Check password if one is set
    if let Some(stored_hash) = &pres.password {
        if let Some(provided) = provided_pwd {
            let parsed = PasswordHash::new(stored_hash)?;
            if Argon2::default()
                .verify_password(provided.as_bytes(), &parsed)
                .is_ok()
            {
                return Ok(AccessResult::PasswordOk);
            }
        }
        return Ok(AccessResult::Denied);
    }

    // No password set — presentation is public but access is still Denied for
    // write operations. Callers decide what Denied means for their context
    // (e.g., audience view is allowed; editing is not).
    Ok(AccessResult::Denied)
}
```

- [ ] **Step 5: Add check_access to the db module's public exports in main.rs**

Find the `use db::{ ... }` block at the top of `main.rs` (around line 48-51) and add `check_access, AccessResult`:

```rust
use db::{
    check_access, AccessResult, AddUserForm, AuthSession, Backend, ChangePasswordForm, Group,
    LoginForm, Presentation as DbPresentation, Recording, RecordingSlide, RecordingSlideInput,
    User,
};
```

- [ ] **Step 6: Push and run tests to confirm they pass**

```bash
git add syncslide-websocket/src/db.rs syncslide-websocket/src/main.rs
git push
```

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test check_access 2>&1 | tail -30
```
Expected: all 7 `check_access_*` tests pass.

- [ ] **Step 7: Commit**

```bash
git add syncslide-websocket/src/db.rs syncslide-websocket/src/main.rs
git commit -m "feat: add AccessResult enum and check_access function"
```

---

### Task 5: WebSocket Role Enforcement

**Files:**
- Modify: `syncslide-websocket/src/main.rs` (functions `handle_socket`, `ws_handle`, `broadcast_to_all`)

Replace the `auth: bool` gate with per-role message filtering. The new enforcement:

| Role | Permitted messages |
|------|--------------------|
| Owner | Text, Slide, Name |
| Editor | Text, Slide |
| Controller | Slide only |
| PasswordOk / Denied | Receive only (no send) |

- [ ] **Step 1: Write a test for handle_socket role filtering**

`handle_socket` is a sync function that takes a `Result<Message, _>` and processes it. We can unit-test it via a full integration test that sends a Name message as a non-owner (who should not be able to send Name) and verifies it is silently dropped.

However, axum-test does not currently have WebSocket client support in this codebase. Instead, test the permission logic via a direct unit test of `handle_socket`. Add this to the `#[cfg(test)]` block in `main.rs`:

```rust
/// A Controller role must not be permitted to send a Name message.
/// handle_socket must return Ok(true) (keep connection open, message dropped).
#[tokio::test]
async fn ws_controller_cannot_send_name_message() {
    let (_server, state) = test_server().await;
    let (tx, _rx) = tokio::sync::broadcast::channel::<SlideMessage>(8);
    let mut tx = tx;
    let msg = axum::extract::ws::Message::text(
        serde_json::to_string(&SlideMessage::Name("hacked".to_string())).unwrap(),
    );
    let mut state_clone = state.clone();
    // Seed a presentation so update_slide has something to update
    let uid = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(uid, "WS Test", &state.db_pool).await;
    // Controller may not send Name messages — must return Ok(true) (not an error)
    let result = handle_socket(Ok(msg), &pid.to_string(), &mut tx, &mut state_clone, &AccessResult::Controller);
    assert!(
        matches!(result, Ok(true)),
        "Controller sending Name must be silently dropped (Ok(true)), not an error"
    );
    // Verify nothing was broadcast (tx has no active receivers; check send count via a fresh receiver)
}

/// An Editor role must be permitted to send a Slide message.
#[tokio::test]
async fn ws_editor_can_send_slide_message() {
    let (_server, state) = test_server().await;
    let uid = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(uid, "WS Test 2", &state.db_pool).await;
    let mut state_clone = state.clone();

    // handle_socket calls update_slide, which does state.slides.get_mut(pid).unwrap().
    // The slides map is only populated by add_client_handler_channel (called by ws_handle).
    // Seed it directly here so the test doesn't panic.
    {
        let (tx_inner, rx_inner) = tokio::sync::broadcast::channel::<SlideMessage>(8);
        state_clone.slides.lock().unwrap().insert(
            pid.to_string(),
            Arc::new(Mutex::new(Presentation {
                content: String::new(),
                slide: 0,
                channel: (tx_inner, rx_inner),
            })),
        );
    }

    let (tx, mut rx) = tokio::sync::broadcast::channel::<SlideMessage>(8);
    let mut tx_clone = tx;
    let msg = axum::extract::ws::Message::text(
        serde_json::to_string(&SlideMessage::Slide(2)).unwrap(),
    );
    let result = handle_socket(Ok(msg), &pid.to_string(), &mut tx_clone, &mut state_clone, &AccessResult::Editor);
    assert!(matches!(result, Ok(true)), "Editor must be able to send Slide");
    // The broadcast channel must have received the Slide(2) message
    let received = rx.try_recv();
    assert!(
        matches!(received, Ok(SlideMessage::Slide(2))),
        "Slide message must be broadcast when sent by Editor"
    );
}
```

- [ ] **Step 2: Run tests to confirm they fail (handle_socket doesn't have the role parameter yet)**

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test ws_controller_cannot 2>&1 | head -20
```
Expected: compile error — `handle_socket` takes 4 arguments, not 5.

- [ ] **Step 3: Modify handle_socket to accept a role parameter**

Current signature (main.rs ~line 196):
```rust
fn handle_socket(
    msg: Result<Message, axum::Error>,
    pid: &str,
    tx: &mut Sender<SlideMessage>,
    state: &mut AppState,
) -> Result<bool, &'static str>
```

Change to:
```rust
fn handle_socket(
    msg: Result<Message, axum::Error>,
    pid: &str,
    tx: &mut Sender<SlideMessage>,
    state: &mut AppState,
    role: &AccessResult,
) -> Result<bool, &'static str>
```

Inside `handle_socket`, add the role check after the `SlideMessage` is deserialized, before `update_slide`. Insert just before the `update_slide` call:

```rust
    // Role-based permission check: silently drop disallowed message types.
    let permitted = match (role, &msg) {
        (AccessResult::Owner, _) => true,
        (AccessResult::Editor, SlideMessage::Text(_) | SlideMessage::Slide(_)) => true,
        (AccessResult::Controller, SlideMessage::Slide(_)) => true,
        _ => false,
    };
    if !permitted {
        return Ok(true);
    }
```

The variable name `msg` is used both for the raw `Message` and then rebound to `SlideMessage`. Rename the intermediate to avoid shadowing confusion. The complete updated function:

```rust
fn handle_socket(
    msg: Result<Message, axum::Error>,
    pid: &str,
    tx: &mut Sender<SlideMessage>,
    state: &mut AppState,
    role: &AccessResult,
) -> Result<bool, &'static str> {
    let Ok(raw) = msg else {
        cleanup(state);
        return Err("Disconnected");
    };
    if let Message::Close(_) = raw {
        cleanup(state);
        return Err("Closed");
    }
    let slide_msg: SlideMessage = match serde_json::from_str(raw.to_text().unwrap()) {
        Ok(m) => m,
        Err(_) => return Err("Invalid message!"),
    };
    let permitted = match (role, &slide_msg) {
        (AccessResult::Owner, _) => true,
        (AccessResult::Editor, SlideMessage::Text(_) | SlideMessage::Slide(_)) => true,
        (AccessResult::Controller, SlideMessage::Slide(_)) => true,
        _ => false,
    };
    if !permitted {
        return Ok(true); // silently drop
    }
    update_slide(pid, slide_msg.clone(), state);
    if tx.send(slide_msg).is_err() {
        cleanup(state);
        return Err("Channel disconnected!");
    }
    Ok(true)
}
```

- [ ] **Step 4: Update ws_handle to pass role to handle_socket, and remove the old auth gate**

Current `ws_handle` signature (main.rs ~line 227):
```rust
async fn ws_handle(mut socket: WebSocket, pid: String, mut state: AppState, auth: bool) {
```

Change to:
```rust
async fn ws_handle(mut socket: WebSocket, pid: String, mut state: AppState, role: AccessResult) {
```

Current socket_handler loop:
```rust
let socket_handler = async {
    while let Some(msg) = sock_recv.next().await {
        if !auth {
            continue;
        }
        if handle_socket(msg, &pid, &mut tx, &mut state1).is_err() {
            return;
        }
    }
};
```

Change to (remove the `if !auth` gate; `handle_socket` now enforces by role):
```rust
let socket_handler = async {
    while let Some(msg) = sock_recv.next().await {
        if handle_socket(msg, &pid, &mut tx, &mut state1, &role).is_err() {
            return;
        }
    }
};
```

- [ ] **Step 5: Update broadcast_to_all to call check_access and pass role**

Current `broadcast_to_all` (main.rs ~line 135):
```rust
async fn broadcast_to_all(
    ws: WebSocketUpgrade,
    Path(pid): Path<String>,
    State(state): State<AppState>,
    auth_session: AuthSession,
) -> Response {
    if auth_session.user.is_some() {
        ws.on_upgrade(|socket| ws_handle(socket, pid, state, true))
    } else {
        ws.on_upgrade(|socket| ws_handle(socket, pid, state, false))
    }
}
```

Change to:
```rust
async fn broadcast_to_all(
    ws: WebSocketUpgrade,
    Path(pid): Path<String>,
    State(state): State<AppState>,
    auth_session: AuthSession,
) -> Response {
    // Resolve role at connect time. Password is not passed — the WebSocket
    // endpoint does not handle password authentication; the HTTP layer (plan 3)
    // gates who can reach the audience page in the first place.
    let pid_i64 = pid.parse::<i64>().unwrap_or(-1);
    let role = check_access(
        &state.db_pool,
        auth_session.user.as_ref(),
        pid_i64,
        None,
    )
    .await
    .unwrap_or(AccessResult::Denied);
    ws.on_upgrade(move |socket| ws_handle(socket, pid, state, role))
}
```

- [ ] **Step 6: Push and run the new tests**

```bash
git add syncslide-websocket/src/main.rs
git push
```

On VPS:
```
cd ~/syncSlide/syncslide-websocket && cargo test ws_controller_cannot ws_editor_can 2>&1 | tail -20
```
Expected: both new tests pass.

- [ ] **Step 7: Run the full test suite**

```bash
cd ~/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -20
```
Expected: all tests pass (17+ Rust tests).

Then run Playwright:
```bash
cd ~/syncSlide && npx playwright test 2>&1 | tail -20
```
Expected: all Playwright tests pass (63+).

- [ ] **Step 8: Deploy and verify**

```bash
config/update.bat
```

Verify the server starts and the presentations page loads.

- [ ] **Step 9: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "feat: replace auth:bool with AccessResult role enforcement in WebSocket handler"
```

---

## Completion

After all tasks pass:

1. Three migrations are applied and committed
2. `Presentation` and `Recording` structs carry `password: Option<String>`
3. `AccessResult` + `check_access` are in `db.rs`, tested with 7 unit tests covering all five result variants
4. `ws_handle` enforces per-role message permissions; `broadcast_to_all` resolves the role via `check_access`
5. All existing Rust tests still pass; all Playwright tests still pass

**Ready for Plan 2** (Co-presenters: management routes + dialog + existing dialog order fix) and **Plan 3** (Password: HTTP gating + set-password routes + password entry page), which can be written and executed in any order.
