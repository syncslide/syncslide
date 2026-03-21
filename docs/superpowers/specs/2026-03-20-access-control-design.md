# Access Control, Co-Presenters, and Shared Presentations — Design Spec

**Date:** 2026-03-20
**Status:** Approved

---

## Overview

Three interrelated features:
1. **Co-presenters** — other registered users who can edit or control a presentation
2. **Password protection** — optional join password for presentations and recordings
3. **Presentations list filtering** — show owned and shared presentations together with role-based filter controls

---

## Database Schema

### Migration 1 — `presentation_access`

```sql
CREATE TABLE presentation_access (
    id INTEGER NOT NULL PRIMARY KEY,
    presentation_id INTEGER NOT NULL REFERENCES presentation(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('editor', 'controller')),
    UNIQUE(presentation_id, user_id)
);
```

- `editor`: can edit content, control slides in real time, and upload recordings
- `controller`: can move between slides only; cannot edit content or upload recordings

`ON DELETE CASCADE` ensures co-presenter rows are removed when a presentation is deleted. If a presentation is deleted while a co-presenter has the list page open, their view simply becomes stale until they reload — this is accepted behaviour.

### Migration 2 — password on `presentation`

```sql
ALTER TABLE presentation ADD COLUMN password TEXT;
```

`NULL` means no password required. The stored value is an Argon2id hash of the plaintext password.

### Migration 3 — password on `recording`

```sql
ALTER TABLE recording ADD COLUMN password TEXT;
```

`NULL` means inherit the presentation's password. An explicitly set value (including empty string to remove protection) overrides the presentation's password for that recording only.

### Struct updates required

Both the `Presentation` struct (`db.rs` line 194) and `Recording` struct (`db.rs` line 18) must be updated to include the new nullable field:

```rust
pub password: Option<String>,
```

`cargo sqlx prepare` must be run on the VPS after all three migrations are applied, before building.

### Future extensibility

When group/org support is added, a parallel `presentation_group_access(presentation_id, group_id, role)` table will be added alongside `presentation_access`. No changes to the current schema will be required.

---

## Access Model

A shared async function `check_access(db: &SqlitePool, user: Option<&User>, presentation_id: i64, provided_pwd: Option<&str>) -> AccessResult` is defined in `main.rs` (or a new `access.rs` module if `main.rs` grows too large). It returns:

```rust
pub enum AccessResult {
    Owner,
    Editor,
    Controller,
    PasswordOk,
    Denied,
}
```

| Result | Condition |
|--------|-----------|
| `Owner` | Authenticated user's `id` matches `presentation.user_id` |
| `Editor` | User has a row in `presentation_access` with `role = 'editor'` |
| `Controller` | User has a row in `presentation_access` with `role = 'controller'` |
| `PasswordOk` | Provided password matches the stored Argon2id hash |
| `Denied` | None of the above |

Owners, editors, and controllers bypass the password check entirely.

`Denied` on a presentation with no password set still serves the audience view (preserving current public-access behaviour). `Denied` on a password-protected presentation triggers the password entry page.

### Password verification

- For presentations: compare `provided_pwd` against `presentation.password`
- For recordings: compare against `recording.password` if non-null; otherwise fall back to `presentation.password`
- Verification uses Argon2id (consistent with existing user password hashing in `db.rs`)
- The session cookie (see below) is the primary gate on subsequent requests. The `?pwd=` query param is only verified when no valid session cookie is present, avoiding repeated Argon2id verification on every page load.

### Password validation

Server-side, before hashing:
- Minimum length: 8 characters
- Maximum length: 1000 bytes

### Password in the share URL

The share link embeds the plaintext password as a query param: `/{uname}/{pid}?pwd=abc123`.

**Accepted trade-off:** The plaintext password will appear in Caddy access logs and in the user's browser history. This is consistent with how Zoom and Google Meet handle join passwords, and is appropriate given that presentation join passwords protect against casual access rather than sensitive data. Server logs are accessible only to the instance administrator.

### Successful password entry flow

1. User arrives at `/{uname}/{pid}` or `/{uname}/{pid}/{rid}` without a valid session cookie or `?pwd=` param
2. Server renders the password entry page
3. On correct password: server stores the unlocked presentation/recording ID in the user's existing tower-sessions session (as a `HashSet<i64>` of unlocked resource IDs), then redirects to the audience URL **with `?pwd=` appended**
4. The URL now contains the password so the user can share or bookmark it; subsequent visits check the session cookie first

### Embedded password in share link

- Format: `/{uname}/{pid}?pwd=abc123`
- On arrival: server reads `?pwd=`, verifies against stored hash (if no valid session cookie exists), stores in session, redirects to audience view — no password page shown
- "Copy link with password" button on the presentations list is **disabled until the password has been saved to the server**. After saving, clicking Copy generates `/{uname}/{pid}?pwd=<plaintext>` client-side from the value the user just entered.

---

## WebSocket Role Enforcement

Current: `auth: bool` gates whether a client can send any messages.

New: role resolved once at WebSocket connect time via a DB query, stored as a local variable for the lifetime of the connection. Per-message gate:

| Role | Permitted messages |
|------|--------------------|
| Owner | `Text`, `Slide`, `Name` |
| Editor | `Text`, `Slide` |
| Controller | `Slide` only |
| `PasswordOk` / `Denied` | Receive only |

The `ws_handle` function signature changes from `auth: bool` to `role: AccessResult`.

---

## Active Recording Constraint

Only one recording may be active per presentation at a time. The server enforces this: before starting a new recording, check whether an in-progress recording exists for the presentation. If one exists, return an error. Both owners and editors are subject to this constraint.

---

## Password Entry Page

Shown when a user arrives without access and no valid `?pwd=` param or session cookie.

Reading/tab order:
1. `<h1>` — "Join [presentation name]"
2. Paragraph — "This presentation is password protected."
3. `<label>` + `<input type="password" autocomplete="current-password">` — "Password"
4. Show/hide toggle button — `aria-pressed` toggles between `true` (password visible) and `false` (hidden); `aria-label` is static: "Show password". Toggles input `type` between `text` and `password`.
5. Submit button — "Join"
6. `aria-live="assertive"` region — announces "Incorrect password" on failure; focus remains on the password field

---

## Co-Presenter Management

**Who can manage:** Owner only. Routes return 401 for unauthenticated requests, 404 for authenticated non-owners.

**Where:** Presentations list page — each presentation item owned by the current user has two additional action buttons after the existing delete button in reading order:
- "Manage co-presenters" — opens a `<dialog>`
- "Set password" — opens a `<dialog>`

Co-presenters (editors and controllers) see neither button.

### Manage co-presenters dialog

Reading/tab order inside dialog (APG order: context before controls):
1. `<h1 id="dialog-heading-{pid}">` — "Co-presenters for [presentation name]"
2. If co-presenters exist: a table with columns "Username", "Role", "Actions"
   - Each row: username, role select (`editor` / `controller`) with an implicit save on change, "Remove" button
3. "Add co-presenter" subheading
4. Add form: username text input (`autocomplete="off"`), role select (`editor` / `controller`), submit button "Add"
5. Close button — "Close"

The `<dialog>` has `aria-labelledby="dialog-heading-{pid}"`. Focus moves to the dialog's first focusable element (the `<h1>` if it has `tabindex="-1"`, or the first role select if co-presenters exist) on open. Focus returns to the "Manage co-presenters" button on close.

Routes (owner only — 401 unauthenticated, 404 non-owner):
- `POST /user/presentations/{pid}/access/add`
- `POST /user/presentations/{pid}/access/remove`
- `POST /user/presentations/{pid}/access/change-role`

### Set password dialog (presentation)

Reading/tab order inside dialog:
1. `<h1 id="pwd-dialog-heading-{pid}">` — "Set password for [presentation name]"
2. Password input (`autocomplete="new-password"`) + show/hide toggle (same `aria-pressed` pattern as above)
3. Submit button — "Save"
4. "Copy link with password" button — disabled until password has been saved; generates `/{uname}/{pid}?pwd=<plaintext>` client-side after save
5. "Clear password" button — removes the password (sets to `NULL`)
6. Close button — "Close"

Route (owner only):
- `POST /user/presentations/{pid}/password`

### Set password dialog (recording)

Same structure as the presentation password dialog with one addition after "Clear password":
- "Reset to inherit from presentation" button — sets `recording.password` back to `NULL`

Route (owner only — ownership verified by joining `recording.presentation_id` to `presentation.user_id`):
- `POST /user/recordings/{rid}/password`

---

## Presentations List

### Data

`DbPresentation::get_for_user` is supplemented by a new function `DbPresentation::get_shared_with_user` — a JOIN through `presentation_access WHERE user_id = ?`. The `/user/presentations` handler fetches both, merges them, and passes the combined list to the template.

Each item carries a `role` field (`owner`, `editor`, or `controller`) rendered as a `data-role` attribute on the list item.

The nav bar no longer shows a presentation count (removed as part of this work).

### Editor access to stage

When an editor navigates to `/{uname}/{pid}`, they are redirected to `stage.html` (same as the owner). The `check_access` result of `Editor` grants stage access. Controllers are redirected to the audience view.

### Role label

Each shared item includes `<span>Shared with you as editor</span>` (or `controller`) inside the list item, after the presentation name link and outside the `<h2>`. Screen reader users navigating by heading hear the presentation name; reading linearly they also hear the role label. This is the intended navigation pattern.

### Filter control

A disclosure widget placed above the sort control in reading order.

**Filter button:**
- Funnel SVG icon (left) + visible text "Filter" + active count in parentheses, e.g. "Filter (3 active)"
- `aria-expanded` reflects open/closed state
- `aria-controls` points to the filter panel `id`
- `aria-label` — "Filter, 3 active" (count only, no state word — state is carried by `aria-expanded` and announced separately by screen readers)
- Visual: visible border and background to distinguish from a plain link; darker background or inset border when panel is open
- Count and `aria-label` update live as checkboxes are toggled

**Filter panel** (when expanded):

```html
<div id="filter-panel" role="group">
  <fieldset>
    <legend>Role</legend>
    <label><input type="checkbox" checked data-filter-role="owner"> My presentations</label>
    <label><input type="checkbox" checked data-filter-role="editor"> Shared as editor</label>
    <label><input type="checkbox" checked data-filter-role="controller"> Shared as controller</label>
  </fieldset>
  <!-- future filter groups added here as additional fieldsets -->
</div>
```

The `<legend>` text "Role" also appears as a visible heading above the fieldset. The heading is `aria-hidden="true"` to prevent double announcement (the `<legend>` already labels the group for screen readers). The heading appears in the page outline for H-key navigation.

An `aria-live="polite"` region below the filter panel announces the result count after each checkbox change, e.g. "Showing 2 of 3 presentations."

All three checkboxes are checked by default — the full list is shown on arrival. Filtering is client-side via `data-role` attributes; no server round-trip.

---

## Existing Dialog Fix

The existing delete dialogs in `presentations.html` currently place the close/cancel button before the heading, which is disorienting for screen reader users. As part of this work, all existing dialogs are updated to follow APG order: heading first, content, close button last.

---

## CSRF

CSRF protection is a pre-existing gap in the codebase (no tokens on any current POST routes). The new routes have the same gap. Addressing CSRF is out of scope for this feature and will be tracked separately.

---

## Accessibility Requirements

- All dialogs use `<dialog>` with `aria-labelledby` pointing to the dialog's `<h1>`
- APG dialog reading order: heading → content → close button (applied to new and existing dialogs)
- Focus moves to the first focusable element inside the dialog on open; returns to the triggering button on close
- Password show/hide toggle: static `aria-label="Show password"`, `aria-pressed` toggles between `true` and `false`
- Filter button: `aria-expanded`, `aria-controls`, and `aria-label` (with count, without state word) kept in sync
- Filter result count announced via `aria-live="polite"` after each checkbox change
- Role labels on shared items are plain text in reading order — not `aria-label` overrides
- Password entry error announced via `aria-live="assertive"` — no page reload required
- `autocomplete="current-password"` on the audience join password field
- `autocomplete="new-password"` on set-password dialog fields
- WCAG 2.2 Level AAA throughout
