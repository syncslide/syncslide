# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build and test on dev server (beep.local)
config/dev.bat

# Deploy to production (clippycat.ca)
config/deploy.bat

# Provision a fresh dev server (run once)
# ssh melody@beep.local 'bash -s' < config/provision.sh

# Send SIGUSR1 to trigger in-memory presentation cleanup
config/cleanup.sh

# After changing SQL queries, regenerate the offline query cache
# Run on beep.local from syncslide-websocket/:
cd syncslide-websocket && DATABASE_URL=sqlite://db.sqlite3 cargo sqlx prepare -- --all-targets
```

## Architecture

SyncSlide is a single Rust binary (`syncslide-websocket/`) that serves an accessible Markdown-based presentation tool with real-time WebSocket sync. It runs on port 5002 behind Caddy (`config/syncSlide.conf`).

**Backend:** Axum + Tera templates + SQLx (SQLite) + tower-sessions. All routes and state are in `syncslide-websocket/src/main.rs`; DB models and auth backend are in `src/db.rs`.

**In-memory state** (`AppState`): A `HashMap<presentation_id, Arc<Mutex<Presentation>>>` holds active presentations. Each `Presentation` has its markdown content, current slide index, and a `tokio::broadcast` channel (capacity 1024) used to push updates to all connected WebSocket clients.

**Presentation flow:**
1. Presenter navigates to `/{uname}/{pid}` → redirected to `stage.html` (editor + slide dropdown)
2. Audience navigates to the same URL → redirected to `audience.html` (read-only slide view)
3. Both connect to `/ws/{pid}`. On connect, clients receive current `Text` and `Slide` messages.
4. Presenter sends updates → saved to DB via `DbPresentation::update_content()` → broadcast to all subscribers.

**Slide parsing:** The frontend (`js/common.js`) splits rendered Markdown HTML at `<h2>` tags to produce individual slides. Each `## Heading` is one slide. LaTeX is rendered client-side via KaTeX.

**Recording:** `js/recording.js` captures `{time, slide, title, content}` snapshots into a WebVTT metadata track. `js/play.js` replays slides by parsing VTT cues on video `cuechange` events. Recordings are stored in `assets/{id}/` and referenced in the `recording` DB table.

**Auth:** Argon2id passwords, tower-sessions backed by SQLite. Users belong to groups; `group_id=1` is admin. WebSocket connections check auth at connect time — unauthenticated clients can receive slides but cannot send updates.

**SQLx offline cache:** `.sqlx/` is committed to the repo so `cargo build` works without a live database. Run `cargo sqlx prepare -- --all-targets` on beep.local after any SQL query changes (plain `cargo sqlx prepare` deletes test-only cache entries).

## Deployment

- **Server:** `arch@clippycat.ca`, systemd service `syncSlide`
- **Working directory on server:** `/home/arch/syncSlide/syncslide-websocket/` — the binary must run from here so relative paths `css/`, `js/`, `assets/` resolve correctly.
- **Database:** `db.sqlite3` in `syncslide-websocket/` (relative to working directory)
- **Default credentials:** username `admin`, password `admin`
- **Dev server:** `melody@beep.local`, repo at `~/syncSlide/`

## Key files

| File | Purpose |
|------|---------|
| `syncslide-websocket/src/main.rs` | All routes, handlers, WebSocket logic, app state |
| `syncslide-websocket/src/db.rs` | SQLx models, axum-login auth backend, password hashing |
| `syncslide-websocket/templates/` | Tera HTML templates |
| `syncslide-websocket/js/common.js` | WebSocket setup, Markdown→slides parsing, KaTeX render |
| `syncslide-websocket/js/handlers.js` | Presenter event handlers (markdown textarea, slide dropdown) |
| `syncslide-websocket/js/recording.js` | Recording timer and WebVTT export |
| `syncslide-websocket/js/play.js` | Video+VTT playback sync |
| `syncslide-websocket/migrations/` | SQLite schema migrations (run automatically on startup) |
| `config/syncSlide.conf` | Caddy reverse proxy config |

## User constraints
- Do not rewrite git history.
- Never run the server locally. Always use `config/dev.bat` to build and test on beep.local.
- To deploy to production, use `config/deploy.bat` (targets clippycat.ca).
