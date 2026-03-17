# SyncSlide System Spec

**Date:** 2026-03-16
**Last updated:** 2026-03-17
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
| `js/audience.js` | WebSocket message handler for audience and stage |
| `js/ext-links.js` | Auto-marks external links with SVG icon and screen-reader label |
| `migrations/` | SQLite schema migrations (run automatically on startup) |

---

## 2. Database Schema

### `users`
```sql
id INTEGER NOT NULL PRIMARY KEY,   -- INTEGER (not INT) — correct rowid alias
name TEXT NOT NULL UNIQUE,
email TEXT NOT NULL UNIQUE,
password TEXT NOT NULL             -- Argon2id hash
```
Seeded: `id=1, name='admin', email='admin@example.com', password=argon2('admin')`

### `presentation`
```sql
id INTEGER NOT NULL PRIMARY KEY UNIQUE,
name TEXT NOT NULL,
user_id INTEGER NOT NULL REFERENCES users(id),
content TEXT NOT NULL
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

**Foreign key enforcement:** `PRAGMA foreign_keys = ON` is set via `SqliteConnectOptions::foreign_keys(true)` at pool creation.

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
   - **`channel_handler`**: reads from broadcast channel; sends message to this client's socket; persists `Text` messages to DB via `DbPresentation::update_content`
4. On disconnect: `cleanup` runs, removing map entries where `Arc::strong_count == 1` (only the map holds a reference)

**Auth at WebSocket time:** checked once at upgrade only — unauthenticated clients receive slides but cannot send updates. No re-check mid-connection.

**SIGUSR1:** Polled via `signals.next().await` in a dedicated `tokio::spawn` task. Triggers in-memory cleanup of stale presentation entries.

---

## 4. Route Table

| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/` | `index` | Public |
| GET | `/auth/login` | `login` | Public |
| POST | `/auth/login` | `login_process` | Public |
| GET | `/auth/logout` | `logout` | Public |
| GET | `/join` | `join` | Public |
| GET | `/demo` | `demo` | Dynamic: queries DB for admin's first presentation |
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
| GET | `/user/change_pwd` | `change_pwd` | Auth required; accepts `?error=` query param for error display |
| POST | `/user/change_pwd` | `change_pwd_form` | Auth required; redirects with `?error=` on failure |
| GET | `/user/new` | `new_user` | Admin only (404 for non-admin) |
| POST | `/user/new` | `new_user_form` | Admin only; redirects to `/user/presentations` on success |

**Static mounts:** `/css` → `css/`, `/js` → `js/`, `/assets` → `assets/`

---

## 5. Authentication & Authorization

**Session:** `tower-sessions` backed by SQLite. Expires after 1 day of inactivity. `with_secure(false)` — safe because Caddy terminates TLS; the app only listens on localhost:5002 and cookies are never sent over plain HTTP in production. `session_auth_hash` uses the password field — changing a password automatically invalidates all existing sessions.

**Login:** POST `/auth/login` with `username` + `password` form fields → Argon2id verify → session created → redirect to `/`.

**Authorization model:** Single permission type: `Group::Admin`. Membership in `group_users` junction table. `get_user_permissions` fetches groups via a corrected JOIN on `group_users.group_id`.

**Owner checks:** Mutating routes verify ownership inline with `SELECT COUNT(*) WHERE id = ? AND user_id = ?` before acting. Consistent across all mutating recording/presentation routes. `delete_presentation` delegates to `DbPresentation::delete` which now also clears `recording_slide` children before deleting `recording` rows.

**Presenter vs. audience:** `/{uname}/{pid}` checks if the logged-in user's id matches the presentation's `user_id`. Owners get `stage.html`; everyone else gets `audience.html`.

**Password change:** Verifies old password with Argon2id. Errors redirect to `/user/change_pwd?error=<message>` where the template renders the error in a `role="alert"` paragraph.

---

## 6. Slide Parsing

Each `## Heading` in Markdown defines one slide. The full Markdown is stored as a single string in `presentation.content`.

Three independent implementations:

| Location | Method | Purpose |
|----------|--------|---------|
| `main.rs: render_slide` | `pulldown_cmark` — splits at `Event::Start(Tag::Heading { H2 })` | Initial slide HTML on page load (server-side) |
| `common.js: addSiblings` | `remarkable` renders to HTML, splits at `h2` DOM nodes | Live audience/stage slide extraction |
| `handlers.js: markdownToSlides` | Regex split on `^##\s+` in raw Markdown | Stage slide table + recording capture |

`render_slide` prepends `<h1>{presentation_name}</h1>` to each slide (HTML-escaped via `html_escape()`). The client mirrors this via `applyPresName` in `handlers.js` updating `#currentSlide h1`.

**KaTeX:** Rendered client-side via `renderMathInElement` after each slide update. Delimiters: `$$...$$` (display), `$...$` (inline). The server-side renderer does not process LaTeX — initial server render shows raw LaTeX until `updateRender` fires client-side.

**Recording slide content:** Stored as rendered HTML (the `innerHTML` of `#currentSlide` at capture time, including KaTeX-rendered math). Injected directly into DOM on playback.

---

## 7. Recording System

### Capture
1. Presenter clicks **Record** on `stage.html` — `recording.js` starts a `Date.now()` timer
2. On every slide/content change, `saveCurrentState()` is called (from `audience.js` after DOM update) — captures `{time, slide, title, content}` where `content` is `#currentSlide.innerHTML`
3. On **Stop**, `jsonRecording()` serializes to JSON, populates hidden `<input id="slidesData">`, opens save dialog
4. Presenter fills in name, optionally attaches video + captions VTT, submits multipart form
5. POST to `/user/presentations/{pid}/recordings` — multipart fields: `name`, `slides` (JSON), `video` (optional), `captions` (optional)

**Important:** `onCommit` in `handlers.js` uses `input` only (not `change` + `input`) for SELECT elements. This prevents double-firing on desktop where both events would fire, which previously caused two `saveCurrentState()` calls per slide navigation and created pairs of near-identical VTT cues milliseconds apart.

### Server-side save (`add_recording`)
1. Validates ownership, parses multipart
2. `Recording::create` — inserts `recording` row, gets back the new `id`
3. `tokio::fs::create_dir_all("assets/{rid}")`
4. Writes `video.{ext}` and `captions.vtt` (or empty `WEBVTT\n` if no captions)
5. `RecordingSlide::create_batch` — batch inserts slides wrapped in a transaction (`db.begin()` / `tx.commit()`)
6. Redirects to `/user/presentations`

### Playback (`play.js` + `recording.html`)
- `<video>` has a hidden metadata `<track id="syncslide-data">` pointing to `/{uname}/{pid}/{rid}/slides.vtt`
- Server generates VTT on-the-fly from `recording_slide` rows; each cue text is `{"id":..., "title":..., "content":...}` JSON
- `cuechange` event → parse JSON → inject `content` into `#currentSlide` → `markExternalLinks(slidesContainer)`
- **No-video recordings / mobile lazy track loading:** `initFromCues()` is called on load. If cues are not yet available (common on mobile where metadata tracks load lazily), the fallback sets `slidesData.mode = 'hidden'` and attaches a `load` listener to the `HTMLTrackElement` (`video.querySelector('track#syncslide-data')`), not the `TextTrack` object (which does not fire `load`).
- `goTo` dropdown lists slides by title + start time; fires immediately on `change` or `blur` via `onCommit` (no separate Go button) — seeks video and renders slide directly (handles no-video case)
- F8 / Shift+F8: next/previous slide; both `goTo.value` and `video.currentTime` are updated immediately (dropdown does not lag)

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
| `ext-links.js` | all pages | Exposes global `markExternalLinks(container)`. Scans `a[href^="http"]` within `container` and appends SVG external-link icon + `<span class="ext-label">(external)</span>`. Called on `DOMContentLoaded` for static content and explicitly after each dynamic slide injection. |
| `common.js` | stage + audience | WebSocket setup, `addSiblings` slide extraction, `updateRender` (KaTeX) |
| `audience.js` | stage + audience | WebSocket message handler — receives `text`/`slide`/`name` messages, updates DOM, calls `markExternalLinks` and `saveCurrentState` after each slide render |
| `handlers.js` | stage only | Markdown textarea, slide dropdown, slide CRUD dialog, presentation name. `onCommit(el, fn)` uses `input` only for SELECT (covers desktop + Android without double-firing). Initialises `#goTo` dropdown by calling `getH2s` after `renderSlideTable()` at script load time. |
| `recording.js` | stage only | Timer, pause/resume/stop, `saveCurrentState`, `jsonRecording` |
| `play.js` | recording page | VTT cue parsing, slide navigation via `onCommit`/`goToSlide`, timing editor, replace-files dialog |

**Script load order (all `defer`, execute in document order):**
`ext-links.js` → `remarkable.js` → `katex.js` → `auto-render.js` → `render-a11y-string.js` → `common.js` → `audience.js` → `recording.js` → `handlers.js` (stage only)

**`pid` extraction (`common.js`):** `window.location.pathname.split('/').pop()` — works for `/{uname}/{pid}` but would break for deeper paths.

**`getH2s` scope:** Defined in `handlers.js`, called from `audience.js` inside `handleUpdate` (guarded by `isStage()`). Since WebSocket messages are processed asynchronously after all scripts load, `handlers.js` is always defined when `getH2s` runs. The initial call at page load is in `handlers.js` itself (after `renderSlideTable()`), avoiding load-order issues.

---

## 9. Deployment

- **Server:** `arch@clippycat.ca`
- **Service:** systemd `syncSlide`
- **Working directory:** `/home/arch/syncSlide/syncslide-websocket/` — binary requires this for relative paths
- **Database:** `db.sqlite3` in working directory
- **Update:** `config/update.bat` — git pull, cargo build, reload Caddy, restart service
- **Cleanup trigger:** `config/cleanup.sh` sends SIGUSR1 — polled by a dedicated tokio task; triggers in-memory cleanup of stale presentation entries
- **SQLx offline cache:** `.sqlx/` committed to repo; run `cargo sqlx prepare` after any SQL query changes
- **Default credentials:** `admin` / `admin`

---

## 10. Known Issues & Remaining Technical Debt

### #1 — `getH2s` architectural coupling
`audience.js` calls `getH2s(allHtml)` inside `handleUpdate` (guarded by `isStage()`). `getH2s` is defined in `handlers.js`, which only loads on stage. Safe in practice, but the guard uses a DOM element check as a proxy for "is handlers.js loaded?" rather than checking the function directly. Fix: replace `if (isStage())` with `if (typeof getH2s === 'function')`.

### #2 — `with_secure(false)` session cookie (intentional, undocumented)
`SessionManagerLayer::with_secure(false)` — the cookie is transmitted over plain HTTP at the application layer. Safe only because Caddy terminates TLS and the app binds to localhost only. A clarifying comment should be added in `main.rs` to document this intent.
