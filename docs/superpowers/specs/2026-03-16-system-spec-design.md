# SyncSlide System Spec

**Date:** 2026-03-16
**Purpose:** Exhaustive reference spec for use in future Claude sessions. Covers architecture, DB schema, in-memory state, WebSocket protocol, route table, auth, slide parsing, recording system, frontend JS, and known technical debt.

---

## 1. Architecture Overview

SyncSlide is a single Rust binary (`syncslide-websocket/`) serving an accessible, Markdown-based presentation tool with real-time WebSocket sync. It runs on port 5002 behind a Caddy reverse proxy (`config/syncSlide.conf`). Deployed on `arch@clippycat.ca` as a systemd service `syncSlide`. The binary must run from `/home/arch/syncSlide/syncslide-websocket/` so that relative paths (`css/`, `js/`, `assets/`, `db.sqlite3`) resolve correctly.

**Stack:**
- **Backend:** Axum (HTTP + WebSocket), Tera (HTML templates), SQLx (SQLite), tower-sessions (session management via SQLite), axum-login (auth)
- **Frontend:** Vanilla JS with Remarkable (Markdown→HTML), KaTeX (LaTeX math), no build step
- **Runtime model:** `tokio::main(flavor = "current_thread")` — single-threaded async

**Request lifecycle:**
1. HTTP request hits Caddy → forwarded to `0.0.0.0:5002`
2. Axum router dispatches to handler
3. Handler queries SQLite via SQLx, optionally reads/writes in-memory `AppState`
4. Tera renders a template; response returned

**WebSocket lifecycle:**
1. Client connects to `/ws/{pid}`
2. Server sends current `Text` and `Slide` messages immediately on connect
3. Presenter sends updates → saved to DB + broadcast to all subscribers
4. Audience receives updates, renders slide client-side

**Static assets:** served directly via `ServeDir` at `/css`, `/js`, `/assets`.

**Template hierarchy:**
- `base.html` → `audience.html` → `stage.html` (presenter view extends audience view)
- All other pages extend `base.html` directly

**Key files:**

| File | Purpose |
|------|---------|
| `src/main.rs` | All routes, handlers, WebSocket logic, app state |
| `src/db.rs` | SQLx models, axum-login auth backend, password hashing |
| `templates/` | Tera HTML templates |
| `js/common.js` | WebSocket setup, Markdown→slides parsing, KaTeX render |
| `js/handlers.js` | Presenter event handlers (markdown textarea, slide dropdown, slide CRUD) |
| `js/recording.js` | Recording timer and slide capture |
| `js/play.js` | Video+VTT playback sync, timing editor |
| `migrations/` | SQLite schema migrations (run automatically on startup) |

---

## 2. Database Schema

### `users`
```sql
id INT NOT NULL PRIMARY KEY,   -- NOTE: INT not INTEGER (see tech debt #8)
name TEXT NOT NULL UNIQUE,
email TEXT NOT NULL UNIQUE,
password TEXT NOT NULL         -- Argon2id hash
```
Seeded: `id=1, name='admin', email='admin@example.com', password=argon2('admin')`

### `presentation`
```sql
id INTEGER NOT NULL PRIMARY KEY UNIQUE,
name TEXT NOT NULL,
user_id INTEGER NOT NULL REFERENCES users(id),
content TEXT NOT NULL,
CHECK(length("code") <= 32)   -- dead constraint, checks literal string (see tech debt #9)
```
Seeded: `id=1, name='Demo', user_id=1, content=<demo markdown>`

### `groups`
```sql
id INTEGER NOT NULL PRIMARY KEY,
name TEXT NOT NULL UNIQUE
```
Seeded: `id=1, name='admin'`

### `group_users`
```sql
id INTEGER NOT NULL PRIMARY KEY,
user_id INTEGER NOT NULL REFERENCES users(id),
group_id INTEGER NOT NULL REFERENCES groups(id),
CONSTRAINT unq UNIQUE (user_id, group_id)
```
Seeded: `user_id=1, group_id=1` (admin user in admin group)

### `recording`
```sql
id INTEGER NOT NULL PRIMARY KEY,
presentation_id INTEGER NOT NULL REFERENCES presentation(id),
name TEXT NOT NULL,
video_path TEXT,               -- nullable; NULL means no video uploaded
captions_path TEXT NOT NULL,   -- relative filename within assets/{id}/
start DATETIME NOT NULL DEFAULT (strftime('%s', 'now')),
last_edited DATETIME           -- nullable; updated on name/file changes
```
History: originally had `vtt_path` column (dropped in migration `20260307000001`); `video_path` was non-nullable (made nullable in `20260307000002`).

### `recording_slide`
```sql
id INTEGER NOT NULL PRIMARY KEY,
recording_id INTEGER NOT NULL REFERENCES recording(id),
start_seconds REAL NOT NULL,
position INTEGER NOT NULL,
title TEXT NOT NULL,
content TEXT NOT NULL          -- stored rendered HTML (innerHTML of #currentSlide at capture time)
```

**File storage:** `assets/{recording_id}/video.{ext}` and `assets/{recording_id}/captions.vtt`, served via `ServeDir /assets`.

**Important:** `PRAGMA foreign_keys = ON` is never set. All FK constraints are decorative — SQLite does not enforce them by default (see tech debt #11).

---

## 3. In-Memory State & WebSocket Protocol

### AppState
Cloned into every Axum handler (all fields are cheaply cloneable via Arc):
```rust
pub struct AppState {
    tera: Tera,                                                    // Arc<TeraBase>
    slides: Arc<Mutex<HashMap<String, Arc<Mutex<Presentation>>>>>, // keyed by pid as String
    db_pool: SqlitePool,
}
```

### Presentation (one per active presentation)
```rust
pub struct Presentation {
    content: String,                                     // full Markdown source
    slide: u32,                                          // current slide index
    channel: (Sender<SlideMessage>, Receiver<SlideMessage>), // broadcast, capacity 1024
}
```
The stored `Receiver` is never read — it exists solely to keep the broadcast channel alive (channel closes when all senders/receivers drop).

**Lazy loading:** Presentations are not loaded until the first WebSocket client connects. `add_client_handler_channel` checks the map, and on miss, loads content from DB before inserting.

### SlideMessage (JSON tagged enum)
```json
{"type": "text",  "data": "# full markdown..."}   // replace all content
{"type": "slide", "data": 2}                        // change active slide index
{"type": "name",  "data": "My Presentation"}        // change presentation name
```

### WebSocket handler (`ws_handle`)
1. Calls `add_client_handler_channel` to get/create in-memory presentation
2. Sends current `text` + `slide` messages to new client
3. Splits socket; runs two futures racing with `futures_lite::or`:
   - **`socket_handler`**: reads from client; if unauthenticated, discards all messages; otherwise calls `update_slide` (updates in-memory state) + broadcasts
   - **`channel_handler`**: reads from broadcast channel; calls `update_slide` again (redundant — see tech debt #12); sends message to this client's socket; persists `Text` messages to DB via `DbPresentation::update_content`
4. On disconnect: `cleanup` runs, removing map entries where `Arc::strong_count == 1` (only the map holds a reference)

**Auth at WebSocket time:** checked once at upgrade only — unauthenticated clients receive slides but cannot send updates. No re-check mid-connection.

---

## 4. Route Table

| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/` | `index` | Public |
| GET | `/auth/login` | `login` | Public |
| POST | `/auth/login` | `login_process` | Public |
| GET | `/auth/logout` | `logout` | Public |
| GET | `/join` | `join` | Public |
| GET | `/demo` | redirect → `/admin/1/1` | Hardcoded (see tech debt #16) |
| GET | `/{uname}/{pid}` | `present` | Owner → stage.html; others → audience.html |
| GET | `/qr/{uname}/{pid}` | `qr_code` | Returns SVG QR code |
| GET | `/ws/{pid}` | `broadcast_to_all` | Read-only if unauthenticated |
| GET | `/{uname}/{pid}/{rid}` | `recording` | Public |
| GET | `/{uname}/{pid}/{rid}/slides.vtt` | `slides_vtt` | On-the-fly VTT from DB |
| GET | `/{uname}/{pid}/{rid}/slides.html` | `slides_html` | On-the-fly HTML from DB |
| GET | `/create` | `start` | Auth required (redirects) |
| POST | `/create` | `start_pres` | Auth required (redirects) |
| GET | `/user/presentations` | `presentations` | Auth required (redirects) |
| POST | `/user/presentations/{pid}/recordings` | `add_recording` | Auth + owner; `DefaultBodyLimit::disable()` |
| POST | `/user/presentations/{pid}/delete` | `delete_presentation` | Auth + owner |
| POST | `/user/presentations/{pid}/name` | `update_presentation_name` | Auth + owner |
| POST | `/user/recordings/{rid}/delete` | `delete_recording` | Auth + owner |
| POST | `/user/recordings/{rid}/name` | `update_recording_name` | Auth + owner |
| POST | `/user/recordings/{rid}/files` | `update_recording_files` | Auth + owner; `DefaultBodyLimit::disable()` |
| POST | `/user/recordings/{rid}/slides/{sid}/time` | `update_slide_time` | Auth + owner |
| GET | `/user/change_pwd` | `change_pwd` | Auth required (redirects) |
| POST | `/user/change_pwd` | `change_pwd_form` | Auth required (redirects) |
| GET | `/user/new` | `new_user` | Auth required (redirects) |
| POST | `/user/new` | `new_user_form` | Broken — see tech debt #2, #6 |

**Static mounts:** `/css` → `css/`, `/js` → `js/`, `/assets` → `assets/`

---

## 5. Authentication & Authorization

**Session:** `tower-sessions` backed by SQLite. Expires after 1 day of inactivity. `with_secure(false)` — cookie sent over HTTP (safe only because Caddy enforces HTTPS in production). `session_auth_hash` uses the password field — changing a password automatically invalidates all existing sessions.

**Login:** POST `/auth/login` with `username` + `password` form fields → Argon2id verify → session created → redirect to `/`.

**Authorization model:** Single permission type: `Group::Admin`. Membership in `group_users` junction table. `get_user_permissions` fetches groups via a JOIN query (has a bug — see tech debt #3).

**Owner checks:** Mutating routes verify ownership inline with `SELECT COUNT(*) WHERE id = ? AND user_id = ?` before acting. This pattern is used consistently in: `update_recording_name`, `delete_recording`, `update_slide_time`, `update_recording_files`, `add_recording`, `update_presentation_name`. `delete_presentation` delegates ownership check to `DbPresentation::delete`.

**Presenter vs. audience:** `/{uname}/{pid}` checks if the logged-in user's id matches the presentation's `user_id`. Owners get `stage.html`; everyone else gets `audience.html`. No invite or shared ownership model.

**Password change:** Verifies old password with Argon2id before updating. No flash messages on failure — silently redirects back to form (see tech debt, multiple `// TODO: send messages with response`).

---

## 6. Slide Parsing

Each `## Heading` in Markdown defines one slide. The full Markdown is stored as a single string in `presentation.content`.

Three independent implementations:

| Location | Method | Purpose |
|----------|--------|---------|
| `main.rs: render_slide` | `pulldown_cmark` — splits at `Event::Start(Tag::Heading { H2 })` | Initial slide HTML on page load (server-side) |
| `common.js: addSiblings` | `remarkable` renders to HTML, splits at `h2` DOM nodes | Live audience/stage slide extraction |
| `handlers.js: markdownToSlides` | Regex split on `^## ` in raw Markdown | Stage slide table + recording capture |

`render_slide` prepends `<h1>{presentation_name}</h1>` to each slide. The client mirrors this via `handlers.js: applyPresName` updating `#currentSlide h1`.

**KaTeX:** Rendered client-side via `renderMathInElement` after each slide update. Delimiters: `$$...$$` (display), `$...$` (inline). The server-side renderer does not process LaTeX — initial server render shows raw LaTeX until `updateRender` fires client-side.

**Recording slide content:** Stored as rendered HTML (the `innerHTML` of `#currentSlide` at capture time, including KaTeX-rendered math). Injected directly into DOM on playback.

---

## 7. Recording System

### Capture
1. Presenter clicks **Record** on `stage.html` — `recording.js` starts a `Date.now()` timer
2. On every slide/content change, `saveCurrentState()` is called — captures `{time, slide, title, content}` where `content` is `#currentSlide.innerHTML`
3. On **Stop**, `jsonRecording()` serializes to JSON, populates hidden `<input id="slidesData">`, opens save dialog
4. Presenter fills in name, optionally attaches video + captions VTT, submits multipart form
5. POST to `/user/presentations/{pid}/recordings` — multipart fields: `name`, `slides` (JSON), `video` (optional), `captions` (optional)

### Server-side save (`add_recording`)
1. Validates ownership, parses multipart
2. `Recording::create` — inserts `recording` row, gets back the new `id`
3. `tokio::fs::create_dir_all("assets/{rid}")`
4. Writes `video.{ext}` and `captions.vtt` (or empty `WEBVTT\n` if no captions)
5. `RecordingSlide::create_batch` — batch inserts slides one-by-one in a loop (no transaction)
6. Redirects to `/user/presentations`

### Playback (`play.js` + `recording.html`)
- `<video>` has a hidden metadata `<track>` pointing to `/{uname}/{pid}/{rid}/slides.vtt`
- Server generates VTT on-the-fly from `recording_slide` rows; each cue text is `{"id":..., "title":..., "content":...}` JSON
- `cuechange` event → parse JSON → inject `content` into `#currentSlide`
- No-video recordings: force-load track via `slidesData.mode = 'hidden'` + `load` event
- `goTo` dropdown lists slides by title + start time; **Go** button seeks video and renders slide directly (handles no-video case)
- F8 / Shift+F8: next/previous slide

### Timing editor (owner only)
- Inline table of `start_seconds` per slide
- "Shift subsequent" checkbox: adjusts all later slides by the same delta
- Changes POST individually to `/user/recordings/{rid}/slides/{sid}/time`
- On save, page reloads to rebuild VTT from DB

### Replace files
- POST `/user/recordings/{rid}/files` (multipart: `video`, `captions`)
- Overwrites files on disk; updates `video_path` in DB if video replaced; updates `last_edited`
- Slide data cannot be replaced post-creation

---

## 8. Frontend JS Modules

| File | Scope | Purpose |
|------|-------|---------|
| `common.js` | stage + audience | WebSocket setup, `addSiblings` slide extraction, `updateRender` (KaTeX) |
| `handlers.js` | stage only | Markdown textarea, slide dropdown, slide CRUD dialog, presentation name, recording integration |
| `recording.js` | stage only | Timer, pause/resume/stop, `saveCurrentState`, `jsonRecording` |
| `play.js` | recording page | VTT cue parsing, slide navigation, timing editor, replace-files dialog |
| `audience.js` | audience only | WebSocket message handler — receives `text`/`slide`/`name` messages, updates DOM |

**WebSocket (`common.js`):** URL constructed from `window.location.pathname` (last segment = pid). Protocol switched to `wss:` on HTTPS. Socket is module-level; handlers attach to it.

**`pid` extraction (`common.js:5`):** `window.location.pathname.split('/').pop()` — works for `/{uname}/{pid}` but would break for deeper paths.

**`sanitize` function** exists in both `common.js` and `play.js` — duplicate, used for filename generation in download links.

---

## 9. Deployment

- **Server:** `arch@clippycat.ca`
- **Service:** systemd `syncSlide`
- **Working directory:** `/home/arch/syncSlide/syncslide-websocket/` — binary requires this for relative paths
- **Database:** `db.sqlite3` in working directory
- **Update:** `config/update.bat` — git pull, cargo build, reload Caddy, restart service
- **Cleanup trigger:** `config/cleanup.sh` sends SIGUSR1 (currently broken — see tech debt #1)
- **SQLx offline cache:** `.sqlx/` committed to repo; run `cargo sqlx prepare` after any SQL query changes
- **Default credentials:** `admin` / `admin`

---

## 10. Technical Debt & Inconsistencies

### Bugs

**#1 — SIGUSR1 handler is broken** (`main.rs:1032, 1086`)
`Signals::new` is created but never polled. `signal_task` spawns a future that calls `cleanup` once synchronously at startup then exits. SIGUSR1 never triggers cleanup at runtime.

**#2 — Admin permission check is inverted** (`main.rs:471–474`)
`new_user_form` returns `NOT_FOUND` if the user **is** admin — opposite of intended. Non-admins can currently create users; admins cannot.

**#3 — SQL join bug in `get_user_permissions`** (`db.rs:370`)
```sql
INNER JOIN groups ON groups.id = group_users.user_id  -- WRONG
-- should be:
INNER JOIN groups ON groups.id = group_users.group_id
```
Returns wrong results for users whose `id` doesn't happen to equal a `group_id`.

**#4 — `Presentation::delete` leaks `recording_slide` rows** (`db.rs:263–276`)
Deletes `recording` rows but not their `recording_slide` children. `Recording::delete` correctly cleans slides first, but `Presentation::delete` bypasses it, leaving orphaned rows.

**#5 — `resumeRecording` sets button text to "Resume"** (`recording.js:45`)
Should be "Pause" — the recording has just resumed, so the next action is to pause.

**#6 — `new_user_form` renders template `"/"`** (`main.rs:477`)
`tera.render("/", ...)` will error at runtime — no template file matches the path `"/"`. Should likely redirect to `/user/presentations` instead.

### Inconsistencies

**#7 — Three independent slide parsers**
`pulldown_cmark` (server), `remarkable` DOM split (client live), regex split (client recording). Edge cases in Markdown will produce different slide boundaries across the three.

**#8 — `users.id` declared as `INT` not `INTEGER`** (`migrations/20251108194223_users.up.sql:3`)
In SQLite, `INT PRIMARY KEY` is not a rowid alias and does not auto-increment. `User::new` inserts without providing an id, relying on undocumented behaviour. May fail or collide.

**#9 — Dead CHECK constraint** (`migrations/20251108233315_presentation.up.sql:8`)
`CHECK(length("code") <= 32)` checks the string literal `"code"` (always 4), not any column. Provides no enforcement.

**#10 — `get_group_permissions` delegates to `get_user_permissions`** (`db.rs:383`)
TODO comment confirms group-level permissions are unimplemented. Both methods return the same result.

**#11 — Foreign keys unenforced**
`PRAGMA foreign_keys = ON` is never set. All FK constraints are decorative.

**#12 — `channel_handler` redundantly calls `update_slide`** (`main.rs:251`)
`socket_handler` and `channel_handler` use separate state clones (`state1` vs `state`), but both clones share the same underlying `Arc<Mutex<HashMap>>`. When `socket_handler` processes an incoming message it calls `update_slide` and broadcasts; `channel_handler` then receives that broadcast and calls `update_slide` again — applying the same change to the same shared HashMap twice.

**#13 — `goTo` implicit global** (`handlers.js:50`)
`goTo = document.getElementById("goTo")` — missing `const`/`let`/`var`. Creates an accidental global.

**#14 — Unescaped names in `slides_html`** (`main.rs:689–690`)
`pres_name` and `rec_name` inserted into `<title>` and `<h1>` without HTML escaping. Names containing `<` or `>` produce malformed HTML.

**#15 — Two `default` tracks in `recording.html`** (`recording.html:18–19`)
Both the metadata track and captions track have the `default` attribute. Only one track per kind should have `default`.

**#16 — `/demo` hardcodes `/admin/1/1`** (`main.rs:592`)
Breaks if the admin username or seeded presentation id ever differs from the migration seed values.

**#17 — `session_layer.with_secure(false)`** (`main.rs:1038`)
Session cookie sent over plain HTTP. Safe only because Caddy enforces HTTPS in production; would be insecure if exposed directly.

**#18 — `sanitize` duplicated** (`common.js:1`, `play.js:1`)
Identical function defined in two separate files with no shared module system.

**#19 — `add_recording` batch insert has no transaction** (`db.rs:127–146`)
`RecordingSlide::create_batch` inserts slides one-by-one in a loop without wrapping in a transaction. A failure mid-loop leaves a partial recording.

**#20 — Multiple `// TODO: send messages with response`** (`main.rs:510, 511, 519, 525`)
Password change errors silently redirect back to the form with no user feedback.
