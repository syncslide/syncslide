# Automated Testing — Phase 1 (Rust) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auth-layer unit and integration tests that run on every deploy and block release on failure.

**Architecture:** Extract `build_app(SqlitePool) -> (Router, AppState)` from `main()` so tests can spin up an isolated app instance with an in-memory database. Unit tests live in a `#[cfg(test)]` module in `src/db.rs`. Integration tests live in a `#[cfg(test)]` module in `src/main.rs`. Both are run via `cargo test`, which is added to the deploy pipeline in `config/update.bat`.

**Why `#[cfg(test)]` in source files, not `tests/*.rs`:** SyncSlide has no `src/lib.rs`. Rust only allows external integration tests in `tests/` for library crates. Putting tests in `#[cfg(test)]` modules inside the source files is the idiomatic approach for binary crates and has no functional difference.

> **Spec divergence — file structure:** The spec's "File Structure" diagram and "Test Coverage Plan" section list `syncslide-websocket/tests/auth.rs`. That structure requires a library crate. Since SyncSlide is a binary crate, those tests go in `#[cfg(test)]` modules in the source files instead. The spec should be updated to reflect this.

> **Spec divergence — `build_app` signature:** The spec states `pub async fn build_app(db_url: &str) -> Router`. This plan uses `pub async fn build_app(db_pool: SqlitePool) -> (Router, AppState)` for two reasons: (1) taking an already-constructed pool lets callers control migration behaviour (necessary for tests using `sqlite::memory:`); (2) returning `AppState` alongside the router lets `main()` pass state to the SIGUSR1 signal handler without restructuring further. The spec should be updated to match.

**Tech Stack:** Rust built-in test runner, `axum-test` crate for in-process HTTP testing, `sqlx` with `sqlite::memory:` and `max_connections(1)` for test database isolation.

**Deploy workflow:** All builds happen on the VPS (`arch@clippycat.ca`). Never run `cargo build` or `cargo test` locally. Deploy via `config/update.bat`.

**No SQL changes:** No new SQL queries are added in Phase 1. `cargo sqlx prepare` is not needed.

---

## Background: Test database strategy

Tests use `sqlite::memory:` with `max_connections(1)`. With a single-connection pool, all queries share one SQLite connection and therefore one in-memory database. This allows running migrations (which need FK enforcement off) and then enabling FK enforcement via `PRAGMA foreign_keys = ON` on that same connection before handing the pool to `build_app`. Each call to `test_server()` creates an independent pool — no shared state between tests.

---

## Files Modified

| File | Tasks | Change |
|------|-------|--------|
| `syncslide-websocket/src/main.rs` | 0, 3 | Add `build_app`, update `main()` with `APP_PORT`, add integration test module |
| `syncslide-websocket/Cargo.toml` | 1 | Add `axum-test` and `tokio` dev-dependencies |
| `syncslide-websocket/src/db.rs` | 2 | Add password hashing unit tests |
| `config/update.bat` | 4 | Add `cargo test` step before service restart |

---

## Task 0: Refactor `main.rs` — extract `build_app`

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

**Why `(Router, AppState)` return type:** `main()` needs the `AppState` to pass to the SIGUSR1 signal handler. Tests receive it and access `state.db_pool` directly (child modules can access private fields of parent module structs in Rust).

- [ ] **Step 1: Insert `build_app` before `fn cleanup`**

In `src/main.rs`, find:

```rust
/// Dynamic cleanup of still open presentations.
fn cleanup(state: &mut AppState) {
```

Insert this block immediately before it:

```rust
/// Builds the application router and state from an already-migrated database pool.
///
/// Accepts any `SqlitePool` (file-based or in-memory). The caller is responsible
/// for running migrations before passing the pool in. Returns both the router (for
/// serving) and the app state (so the caller can retain it for signal handling).
pub async fn build_app(db_pool: SqlitePool) -> (Router, AppState) {
    let session_store = SqliteStore::new(db_pool.clone());
    session_store.migrate().await.unwrap();
    let session_layer = SessionManagerLayer::new(session_store)
        .with_secure(false)
        .with_expiry(Expiry::OnInactivity(Duration::days(1)));
    let tera = Tera::new();
    let backend = Backend::new(db_pool.clone());
    let auth_layer = AuthManagerLayerBuilder::new(backend, session_layer).build();
    let state = AppState {
        tera,
        slides: Arc::new(Mutex::new(HashMap::new())),
        db_pool,
    };
    let router = Router::new()
        .route("/", get(index))
        .route("/auth/login", get(login))
        .route("/auth/login", post(login_process))
        .route("/auth/logout", get(logout))
        .route("/user/presentations", get(presentations))
        .route("/user/recordings/{rid}/delete", post(delete_recording))
        .route("/user/presentations/{pid}/delete", post(delete_presentation))
        .route(
            "/user/recordings/{rid}/slides/{sid}/time",
            post(update_slide_time),
        )
        .route("/user/recordings/{rid}/name", post(update_recording_name))
        .route(
            "/user/presentations/{pid}/name",
            post(update_presentation_name),
        )
        .route("/user/change_pwd", get(change_pwd))
        .route("/user/change_pwd", post(change_pwd_form))
        .route("/user/new", get(new_user))
        .route("/user/new", post(new_user_form))
        .route("/join", get(join))
        .route("/create", get(start))
        .route("/create", post(start_pres))
        .route("/{uname}/{pid}", get(present))
        .route("/qr/{uname}/{pid}", get(qr_code))
        .route("/ws/{pid}", get(broadcast_to_all))
        .route("/demo", get(demo))
        .route("/{uname}/{pid}/{rid}", get(recording))
        .route("/{uname}/{pid}/{rid}/slides.vtt", get(slides_vtt))
        .route("/{uname}/{pid}/{rid}/slides.html", get(slides_html))
        .nest_service("/css", ServeDir::new("css/"))
        .nest_service("/js", ServeDir::new("js/"))
        .nest_service("/assets", ServeDir::new("assets/"))
        .merge(
            Router::new()
                .route(
                    "/user/presentations/{pid}/recordings",
                    post(add_recording),
                )
                .route(
                    "/user/recordings/{rid}/files",
                    post(update_recording_files),
                )
                .layer(DefaultBodyLimit::disable()),
        )
        .with_state(state.clone())
        .layer(auth_layer);
    (router, state)
}
```

- [ ] **Step 2: Replace `async fn main()`**

Replace the entire `async fn main()` body (the function from line ~1048 to end of file) with:

```rust
#[tokio::main(flavor = "current_thread")]
async fn main() {
    let port = std::env::var("APP_PORT").unwrap_or_else(|_| "5002".to_string());
    let mut signals = Signals::new([SIGUSR1]).unwrap();
    let sig_handle = signals.handle();
    let migrate_pool = SqlitePool::connect_with(
        SqliteConnectOptions::from_str("sqlite://db.sqlite3")
            .unwrap()
            .foreign_keys(false),
    )
    .await
    .unwrap();
    sqlx::migrate!("./migrations").run(&migrate_pool).await.unwrap();
    migrate_pool.close().await;
    let db_pool = SqlitePool::connect_with(
        SqliteConnectOptions::from_str("sqlite://db.sqlite3")
            .unwrap()
            .foreign_keys(true),
    )
    .await
    .unwrap();
    let (app, state) = build_app(db_pool).await;
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .unwrap();
    let mut state_for_signal = state;
    let signal_task = tokio::spawn(async move {
        use futures_util::StreamExt;
        while let Some(_sig) = signals.next().await {
            cleanup(&mut state_for_signal);
        }
    });
    axum::serve(listener, app).await.unwrap();
    sig_handle.close();
    let _ = signal_task.await;
}
```

- [ ] **Step 3: Deploy and verify the app still starts**

```bash
config\update.bat
```

The deploy should succeed and the app should load at its URL. If it fails, read the build error — the most likely cause is a missing import or a function that was referenced in the old `main()` but not in `build_app`.

- [ ] **Step 4: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "refactor: extract build_app and add APP_PORT support"
```

---

## Task 1: Add dev-dependencies

**Files:**
- Modify: `syncslide-websocket/Cargo.toml`

- [ ] **Step 1: Add `[dev-dependencies]` section**

`axum-test` is the in-process HTTP test client maintained by JosephLenton. The version that supports axum 0.8.x is **17.x** — verify the latest compatible version on crates.io before running. `tokio` needs `rt-multi-thread` to power `#[tokio::test]`.

Add to `syncslide-websocket/Cargo.toml` after the `[dependencies]` section:

```toml
[dev-dependencies]
axum-test = "17"
tokio = { version = "1.0", features = ["rt-multi-thread", "test-util"] }
```

> `tokio` is already a `[dependencies]` entry with `macros` and `fs` features. Dev-dependencies can add features independently; Cargo merges them at compile time. `rt-multi-thread` powers `#[tokio::test]`. `test-util` is included as the spec requires it — it provides `tokio::time::pause()` and related utilities useful for future time-sensitive tests.

- [ ] **Step 2: Verify the project compiles with the new dependency**

```bash
config\update.bat
```

If `cargo build` fails with "package not found" or a version conflict for `axum-test`, check crates.io for the correct version compatible with `axum = "0.8.6"` and update accordingly.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/Cargo.toml
git commit -m "chore: add axum-test and tokio dev-dependencies"
```

---

## Task 2: Unit tests — password hashing

**Files:**
- Modify: `syncslide-websocket/src/db.rs`

These tests verify the password hashing functions used by `User::new` and `Backend::authenticate`. They require no database or HTTP — just the `argon2` crate already imported at the top of `db.rs`.

`db.rs` already imports `use argon2::password_hash::{SaltString, rand_core::OsRng};` and `use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};` at module level. The `use super::*` in the test module brings these into scope.

- [ ] **Step 1: Append test module to `db.rs`**

Add at the very end of `src/db.rs` (after line 430, after the last `}`):

```rust
#[cfg(test)]
#[allow(clippy::pedantic, missing_docs)]
mod tests {
    use super::*;

    /// Hash should use the argon2id algorithm and be parseable for future verification.
    #[test]
    fn hash_produces_argon2id_format() {
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"hunter2", &salt)
            .unwrap()
            .to_string();
        assert!(
            hash.starts_with("$argon2id$"),
            "expected argon2id prefix, got: {hash}"
        );
        PasswordHash::new(&hash).expect("hash must be parseable by PasswordHash::new");
    }

    /// The same password that was hashed must pass verification.
    #[test]
    fn correct_password_verifies() {
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"correct_horse", &salt)
            .unwrap()
            .to_string();
        let parsed = PasswordHash::new(&hash).unwrap();
        assert!(
            Argon2::default()
                .verify_password(b"correct_horse", &parsed)
                .is_ok(),
            "correct password should verify successfully"
        );
    }

    /// A different password must not pass verification against a stored hash.
    #[test]
    fn wrong_password_fails_verification() {
        let salt = SaltString::generate(OsRng::default());
        let hash = Argon2::default()
            .hash_password(b"correct_horse", &salt)
            .unwrap()
            .to_string();
        let parsed = PasswordHash::new(&hash).unwrap();
        assert!(
            Argon2::default()
                .verify_password(b"battery_staple", &parsed)
                .is_err(),
            "wrong password should fail verification"
        );
    }
}
```

- [ ] **Step 2: Deploy and run tests**

```bash
config\update.bat
```

Then on the VPS:

```bash
cd ~/syncSlide/syncslide-websocket && cargo test db::tests -- --nocapture
```

Expected output:
```
running 3 tests
test db::tests::correct_password_verifies ... ok
test db::tests::hash_produces_argon2id_format ... ok
test db::tests::wrong_password_fails_verification ... ok

test result: ok. 3 passed; 0 failed
```

If a test fails due to a lint error (`clippy::pedantic` or `missing_docs`), the `#[allow(...)]` attribute on the module should already suppress it. If a different lint fires, add it to the `allow` list.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/src/db.rs
git commit -m "test: add argon2 password hashing unit tests"
```

---

## Task 3: Integration tests — auth HTTP flows

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

These tests make real HTTP requests to a real Axum app backed by an isolated in-memory SQLite database. `axum-test::TestServer` handles the in-process HTTP transport. Because tests are inside `mod tests { use super::*; }` in `main.rs`, they can access the private `db_pool` field of `AppState` directly.

> **Working directory requirement:** `build_app` calls `Tera::new()`, which resolves `templates/**/*.html` from the current directory. `cargo test` must run from `syncslide-websocket/` (where `templates/` lives). On the VPS this is already the case. Do not run `cargo test` from the repo root.

> **Cookie persistence:** `TestServer` must be configured to save cookies so the session established by a login request is sent on subsequent requests. The exact API call depends on the installed version of `axum-test` — see the note in Step 1.

- [ ] **Step 1: Append test module to `main.rs`**

Add at the very end of `src/main.rs` (after `let _ = signal_task.await;` and the closing `}`):

```rust
#[cfg(test)]
#[allow(clippy::pedantic, missing_docs)]
mod tests {
    use super::*;
    use axum_test::TestServer;
    use sqlx::sqlite::SqlitePoolOptions;

    /// Creates a `TestServer` backed by a fresh isolated in-memory database.
    ///
    /// Uses `max_connections(1)` so that all queries share one SQLite connection
    /// (and therefore one in-memory database). Migrations run with FK enforcement
    /// off (some migrations DROP TABLE), then FK enforcement is enabled before
    /// handing the pool to `build_app`.
    ///
    /// Returns both the server and the app state. The test has access to
    /// `state.db_pool` for seeding data before making requests.
    async fn test_server() -> (TestServer, AppState) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str("sqlite::memory:")
                    .unwrap()
                    .foreign_keys(false),
            )
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        // Enable FK enforcement on the single connection now that migrations are done.
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();
        let (router, state) = build_app(pool).await;
        // save_cookies() makes the TestServer persist Set-Cookie headers between
        // requests, which is how session auth is maintained across test steps.
        //
        // API note: if this call does not compile for the installed version of
        // axum-test, check the crate docs for the equivalent cookie persistence
        // configuration (look for TestServerConfig, save_cookies, or similar).
        let server = TestServer::builder()
            .save_cookies()
            .build(router)
            .unwrap();
        (server, state)
    }

    /// Seeds one user into the database using the same `User::new` path the app uses.
    ///
    /// The groups table row for id=1 ("admin") is created by migrations.
    /// Do not re-insert it. This user is not added to any group; group membership
    /// is not needed for basic login and session tests.
    async fn seed_user(pool: &SqlitePool) {
        User::new(
            pool,
            AddUserForm {
                name: "testuser".to_string(),
                email: "test@example.com".to_string(),
                password: "testpass".to_string(),
            },
        )
        .await
        .unwrap();
    }

    /// Successful login must redirect to `/` (HTTP 302).
    #[tokio::test]
    async fn login_correct_credentials_redirects_to_home() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;

        let response = server
            .post("/auth/login")
            .form(&serde_json::json!({
                "username": "testuser",
                "password": "testpass"
            }))
            .await;

        assert_eq!(response.status_code(), 302);
        assert_eq!(
            response.headers()["location"],
            "/",
            "successful login must redirect to /"
        );
    }

    /// Wrong password must re-render the login page (HTTP 200), not redirect.
    #[tokio::test]
    async fn login_wrong_password_returns_login_page() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;

        let response = server
            .post("/auth/login")
            .form(&serde_json::json!({
                "username": "testuser",
                "password": "wrongpass"
            }))
            .await;

        assert_eq!(
            response.status_code(),
            200,
            "wrong password should return 200 (re-render login page), not redirect"
        );
    }

    /// Accessing a protected route without a session must redirect to `/auth/login`.
    #[tokio::test]
    async fn presentations_without_session_redirects_to_login() {
        let (server, _state) = test_server().await;

        let response = server.get("/user/presentations").await;

        assert_eq!(response.status_code(), 302);
        assert_eq!(
            response.headers()["location"],
            "/auth/login",
            "unauthenticated request must redirect to /auth/login"
        );
    }

    /// After a successful login, the session cookie must grant access to protected routes.
    #[tokio::test]
    async fn presentations_with_valid_session_returns_200() {
        let (server, state) = test_server().await;
        seed_user(&state.db_pool).await;

        // Establish a session. The TestServer saves the Set-Cookie from this
        // response and sends it on subsequent requests.
        server
            .post("/auth/login")
            .form(&serde_json::json!({
                "username": "testuser",
                "password": "testpass"
            }))
            .await;

        let response = server.get("/user/presentations").await;
        assert_eq!(
            response.status_code(),
            200,
            "authenticated request should return 200"
        );
    }
}
```

> **axum-test `.form()` API note:** The `.form()` method above takes `serde_json::Value`. If this does not compile for the installed version, try `.form(&[("username", "testuser"), ("password", "testpass")])` (a slice of key-value tuples) instead — both forms are common across versions.

- [ ] **Step 2: Deploy and run tests**

```bash
config\update.bat
```

Then on the VPS:

```bash
cd ~/syncSlide/syncslide-websocket && cargo test -- --nocapture
```

Expected output:
```
running 7 tests
test db::tests::correct_password_verifies ... ok
test db::tests::hash_produces_argon2id_format ... ok
test db::tests::wrong_password_fails_verification ... ok
test tests::login_correct_credentials_redirects_to_home ... ok
test tests::login_wrong_password_returns_login_page ... ok
test tests::presentations_with_valid_session_returns_200 ... ok
test tests::presentations_without_session_redirects_to_login ... ok

test result: ok. 7 passed; 0 failed
```

If a test fails: read the error message, identify whether the failure is in the test helper (DB setup), `build_app` (template loading), or the assertion itself. Common issues and fixes:

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `templates not found` panic | `cargo test` run from wrong directory | Run from `syncslide-websocket/` |
| `axum-test` API compile error | Version mismatch | Check crates.io for correct API for installed version |
| `status 302` when 200 expected (session test) | Cookies not saved between requests | Verify `save_cookies()` is active in test helper |
| Migration panic | FK enforcement conflict in migrations | The `foreign_keys(false)` before migration should prevent this |

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/src/main.rs
git commit -m "test: add auth integration tests"
```

---

## Task 4: Update deploy pipeline to run tests

**Files:**
- Modify: `config/update.bat`

Currently `update.bat` runs: pull → build → restart. Tests must run between build and restart. If tests fail, the service must not restart.

`set -eo pipefail` is required so that `cargo test | tee` fails the pipeline if `cargo test` exits non-zero (without `pipefail`, the `|` operator uses `tee`'s exit code, which is always 0).

- [ ] **Step 1: Replace `config/update.bat`**

Replace the entire contents of `config/update.bat` with:

```bat
ssh arch@clippycat.ca "set -eo pipefail; cd syncSlide && git pull origin main --rebase && cd syncslide-websocket && cargo build && cargo test 2>&1 | tee -a /tmp/syncslide-test.log && cd ~ && sudo cp syncSlide/config/syncSlide.conf /etc/caddy/conf.d && sudo chown root:root /etc/caddy/conf.d/syncSlide.conf && sudo systemctl reload caddy && sudo systemctl restart syncSlide"
```

- [ ] **Step 2: Verify the full deploy works**

```bash
config\update.bat
```

The deploy must complete and the app must be accessible. If `cargo test` fails for any reason, the service should NOT restart (the SSH session exits after the failed step and the `&&` chain stops).

- [ ] **Step 3: Commit**

```bash
git add config/update.bat
git commit -m "ci: run cargo test on every deploy, block release on failure"
```

---

## What is explicitly out of scope (Phase 1)

- Playwright/browser tests — covered in the Phase 2 spec
- Presentation CRUD, recording, and permission tests — Phase 1 expansion, separate plan
- `recording_slide` cascade deletion test — Phase 1 expansion, separate plan
- KaTeX rendering, video playback sync — permanently deferred
