# Documentation Design Spec

**Date:** 2026-03-18
**Scope:** Contributor guide (in-repo) + presenter docs (in-app public page) + navigation discoverability

---

## 1. Goals

Two audiences, two deliverables:

- **Code contributors and self-hosters** — need a single reference that covers dev setup, testing, and deployment. Lives in the repo where contributors naturally look.
- **Presenters** — need an in-app reference they can find without knowing a URL. Lives at a public route in the app, linked from the nav and homepage.

No new dependencies. No Markdown server-side rendering. All content is static; future expansion (more pages, guides) would be a separate design.

---

## 2. CONTRIBUTING.md

**Location:** Repo root (`CONTRIBUTING.md`). GitHub surfaces this file automatically on the PR and fork pages.

**Retires:** `readme.md` (7 lines, partially inaccurate) and `config/readme.md` (3 shell commands). Both can be left with a one-line pointer to `CONTRIBUTING.md`, or removed.

### Structure

#### Introduction (brief)
One paragraph: what SyncSlide is, where the live instance runs, link to the repo.

#### For Code Contributors

- **Prerequisites:** Rust stable toolchain, `sqlx-cli` (for `cargo sqlx prepare` after SQL changes)
- **Dev setup:** clone repo; migrations run automatically on startup; `.sqlx/` offline cache is committed so `cargo build` works without a live DB
- **Building and running:** must be done on the VPS (`arch@clippycat.ca`); the binary must run from `syncslide-websocket/` so relative paths resolve; deploy via `config/update.bat`
- **Running tests:** `cargo test` for Rust unit/integration tests; `config/test.sh` for the full suite (Rust + Playwright); tests run on VPS
- **After SQL changes:** run `cargo sqlx prepare` on VPS to regenerate `.sqlx/` offline cache; commit the updated cache
- **Making a PR:** branch from `main`; all tests must pass before merge; no history rewrites (`git push --force` to `main` is not permitted)

#### For Self-Hosters

- **Prerequisites:** Rust stable, Caddy, a Linux host with systemd
- **Deployment:**
  1. Clone repo to working directory (e.g. `/home/arch/syncSlide/`)
  2. `cd syncslide-websocket && cargo build`
  3. Binary must run from `syncslide-websocket/` — set `WorkingDirectory` in the systemd unit
  4. Copy `config/syncSlide.conf` to `/etc/caddy/conf.d/`, reload Caddy
  5. Start the systemd service
- **Configuration:** `APP_PORT` (default 5002), `APP_DB` (default `sqlite://db.sqlite3` relative to working dir)
- **Admin setup:** migrations seed `admin`/`admin` on first run; change this password immediately via `/user/change_pwd`; new users are created via `POST /user/new` (admin-only)
- **Updating:** `git pull` → `cargo build` → `systemctl restart syncSlide`

---

## 3. `/help` Page

**Route:** `GET /help` — public, no authentication required.

**Template:** `help.html`, extending `base.html`. Static content, no dynamic data needed (handler returns an empty Tera context).

**Handler:** One line in `main.rs` — a simple async fn that renders `help.html` with an empty context.

**Route registration:** Added to the router alongside other public routes (`/`, `/auth/login`, `/join`, `/demo`).

### Heading hierarchy and reading order

The first thing announced on arrival is the page `h1`.

```
h1: Presenter Guide

h2: Getting Started
  - Create a presentation at /create; give it a name
  - You land on the stage — your editing and presenting view
  - Share the URL with your audience; they visit the same URL and see the read-only audience view
  - Navigate slides with the "Go to slide" dropdown

h2: Editing Slides
  - Write Markdown in the textarea inside the "Edit Slides" section
  - Each ## heading starts a new slide; the presentation title is an h1 at the top
  - Use the slide table (inside "Slides") to add, edit, move, or delete slides
  - Rename the presentation via the "Presentation name" field

h2: Keyboard Shortcuts
  - F8: advance to next slide
  - Shift+F8: go back to previous slide

h2: Recording
  - Open the "Record" section on the stage
  - Press "Record" to start the timer; "Pause" to pause; "Stop" to end the session
  - A save dialog opens: give the recording a name; optionally attach a video file and a captions VTT file

h2: For Your Audience
  - Audience members visit the same URL as the stage
  - They see a read-only view; they cannot edit or change slides
  - The current slide updates live as you navigate — no refresh needed
  - The slide area is an aria-live="polite" region; screen readers announce each new slide automatically
```

No interactive elements. The page is a pure reference document.

---

## 4. Navigation and Discoverability

### Site nav (`nav.html`)

Add a "Help" link to the nav. Placement in tab/reading order: after the main navigation items (Home, Your Presentations) and before auth links (Login/Logout). Visible to all users regardless of auth state.

### Homepage (`index.html`)

Add a short sentence with a link in the main content area, visible to logged-out visitors:

> New to SyncSlide? Read the [presenter guide](/help).

---

## 5. Files Changed

| File | Change |
|------|--------|
| `CONTRIBUTING.md` | **Create** at repo root |
| `readme.md` | **Update** — one-line pointer to CONTRIBUTING.md |
| `config/readme.md` | **Update** — one-line pointer to CONTRIBUTING.md |
| `syncslide-websocket/templates/help.html` | **Create** |
| `syncslide-websocket/src/main.rs` | **Modify** — add `help` handler + route |
| `syncslide-websocket/templates/nav.html` | **Modify** — add Help link |
| `syncslide-websocket/templates/index.html` | **Modify** — add presenter guide link |

---

## 6. Out of Scope

- FAQ page (`faq-ideas.md` questions) — separate project
- Blog or frequently-updated guides — separate design if needed
- Server-side Markdown rendering for docs pages — YAGNI
- Audience guide — the "For Your Audience" section in `/help` covers audience needs briefly; a dedicated audience page is not needed now
