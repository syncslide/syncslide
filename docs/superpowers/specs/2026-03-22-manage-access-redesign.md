# Manage Access Redesign — Design Spec

**Date:** 2026-03-22
**Status:** Approved

---

## Overview

Replace the password-based access model with an explicit three-tier visibility system. The "Manage co-presenters" and "Set password" dialogs are unified into a single "Manage access" dialog. Password protection is removed entirely.

---

## What Is Removed

- `PasswordOk` variant from `AccessResult`
- `provided_pwd: Option<&str>` parameter from `check_access` signature (and all call sites updated)
- Password entry page and `?pwd=` query param handling:
  - `join_password.html` template
  - `JoinPasswordForm` and `JoinPwdQuery` structs in `main.rs`
  - `join_password_submit` handler
  - `POST /join-password/{uname}/{pid}` route
- `POST /user/presentations/{pid}/password` route
- `POST /user/recordings/{rid}/password` route
- "Set password" action menu item (presentations page)
- "Set recording password" button and dialog (recording page)
- `presentation.password` and `recording.password` values — NULLed by migration; columns remain in schema but permanently ignored

---

## Database Schema

### Migration 1 — `access_mode` on `presentation`

```sql
ALTER TABLE presentation ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'public'
    CHECK(access_mode IN ('public', 'audience', 'private'));
```

### Migration 2 — `access_mode` on `recording`

```sql
ALTER TABLE recording ADD COLUMN access_mode TEXT
    CHECK(access_mode IN ('public', 'audience', 'private'));
```

`NULL` means inherit from the presentation's `access_mode`.

### Migration 3 — extend `presentation_access.role`

SQLite does not support `ALTER TABLE … ALTER COLUMN`. The existing `presentation_access` harness already runs all migrations with `PRAGMA foreign_keys = OFF` (the migration pool is created with `foreign_keys(false)` in `main.rs`), so the DROP TABLE is safe. Wrap the DDL in explicit PRAGMA guards for clarity and for anyone running the migration manually:

```sql
PRAGMA foreign_keys = OFF;

CREATE TABLE presentation_access_new (
    id INTEGER NOT NULL PRIMARY KEY,
    presentation_id INTEGER NOT NULL REFERENCES presentation(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('editor', 'controller', 'audience')),
    UNIQUE(presentation_id, user_id)
);
INSERT INTO presentation_access_new SELECT * FROM presentation_access;
DROP TABLE presentation_access;
ALTER TABLE presentation_access_new RENAME TO presentation_access;

PRAGMA foreign_keys = ON;
```

All existing rows have `role = 'editor'` or `role = 'controller'`, both of which satisfy the new CHECK, so the INSERT transfers all data without error. If somehow non-standard role values exist in the table (e.g., from direct DB manipulation), the INSERT will fail with a CHECK constraint error — the migration is not lenient about unexpected data.

### Migration 4 — NULL existing passwords

```sql
UPDATE presentation SET password = NULL;
UPDATE recording SET password = NULL;
```

### Down migrations

- Migrations 1 and 2: SQLite 3.35.0+ supports `ALTER TABLE … DROP COLUMN`. The down migration drops `access_mode` from `presentation` and `recording`. If the SQLite version on the deployment server predates 3.35.0, the down migration must recreate those tables. Check the server version before writing the down migrations.
- Migration 3: restore the original `presentation_access` table with `role CHECK(role IN ('editor', 'controller'))`. The down migration file must include a `DELETE FROM presentation_access WHERE role = 'audience'` before the table recreation, so automated rollback via `sqlx migrate revert` works without manual intervention.
- Migration 4: the original password values are unrecoverable (they were Argon2id hashes; the hashes are now NULLed). The down migration is a no-op.

---

## Access Model

### Effective mode

For a recording, the effective mode is `recording.access_mode` if non-NULL, otherwise `presentation.access_mode`.

### `AccessResult`

```rust
pub enum AccessResult {
    Owner,      // stage access
    Editor,     // stage access
    Controller, // controller view
    Audience,   // audience view — explicit audience member
    PublicOk,   // audience view — presentation is public
    Denied,     // blocked; no password fallback
}
```

### `check_access` signature change

Remove `provided_pwd: Option<&str>`. New signature:

```rust
async fn check_access(db: &SqlitePool, user: Option<&User>, presentation_id: i64) -> Result<AccessResult, sqlx::Error>
```

Update both call sites in `main.rs`:
- `present` handler: currently passes `query.pwd.as_deref()` as the fourth argument — remove it.
- WebSocket connect handler: currently passes `None` as the fourth argument — remove it.

Remove the `JoinPwdQuery` struct that extracted `?pwd=` from the URL — it is no longer used.

### `check_access` logic

| Effective mode | Owner | Editor row | Controller row | Audience row | Anyone else |
|---|---|---|---|---|---|
| `public` | `Owner` | `Editor` | `Controller` | `Audience` | `PublicOk` |
| `audience` | `Owner` | `Editor` | `Controller` | `Audience` | `Denied` |
| `private` | `Owner` | `Editor` | `Controller` | `Denied` | `Denied` |

`Denied` always means blocked. There is no password fallback.

A user with `role='audience'` on a `public` presentation gets `Audience` (not `PublicOk`) because the named-role check runs before the public fallback. Both `Audience` and `PublicOk` route to `audience.html` — the distinction has no practical effect on routing but is retained in case future features need to distinguish between explicit and anonymous audience access.

### Routing by `AccessResult`

| Result | Destination |
|---|---|
| `Owner` | `stage.html` |
| `Editor` | `stage.html` |
| `Controller` | `controller.html` |
| `Audience` | `audience.html` |
| `PublicOk` | `audience.html` |
| `Denied` | 403 page |

### WebSocket role enforcement

Unchanged in structure. Remove the `PasswordOk` arm. Add `Audience` and `PublicOk` arms — both treated identically to the removed `PasswordOk` arm (receive only, no messages permitted).

The `present` handler's `Denied` arm currently contains a password-fallback block (`if pres.password.is_some()` → render `join_password.html`, else → render `audience.html`). Replace the entire body of the `Denied` arm with a single 403 response. Nothing from the current `Denied` arm body is preserved.

---

## Server-side Role Validation Updates

The `add_access` handler (line ~1050 in `main.rs`) currently rejects any role that is not `"editor"` or `"controller"`. Update the validation to also accept `"audience"`:

```rust
if form.role != "editor" && form.role != "controller" && form.role != "audience" {
    return StatusCode::BAD_REQUEST.into_response();
}
```

Apply the same change to `change_access_role` (~line 1106).

---

## Recording Handler Access Check

The `recording` handler currently renders the recording page for any visitor without checking access. Add a `check_access` call at the start of the handler (using the presentation's `id` derived from the recording row). Apply the same `AccessResult` routing table as the `present` handler: `Denied` → 403, `Owner`/`Editor`/`Controller` → render with owner controls, `Audience`/`PublicOk` → render without owner controls.

The current handler sets `is_owner` as a boolean (`user.id == pres_user.id`). Replace this with a check against `AccessResult`: the template context variable should be true for `Owner`, `Editor`, and `Controller` — not just `Owner`. Rename the variable to `has_owner_controls` to make the intent clear, and update the template references accordingly.

The `slides_vtt` and `slides_html` routes also have no access check. Add `check_access` guards to both: return 403 on `Denied`.

---

## Struct Updates

### `Presentation` in `db.rs`

Add:
```rust
pub access_mode: String,
```

### `Recording` in `db.rs`

Add:
```rust
pub access_mode: Option<String>,
```

### `PresentationRecordings` in `db.rs`

Add:
```rust
pub access_mode: String,
```

This field is sourced from the `pres: Presentation` argument already passed into `Recording::get_by_presentation` — use `access_mode: pres.access_mode.clone()`. No additional query is needed.

### `get_shared_with_user` query in `db.rs`

This function uses an explicit column list (`SELECT p.id, p.user_id, p.content, p.name, p.password …`). Add `p.access_mode` to the SELECT list and to the intermediate `Row` struct used in that function.

### SQLx offline cache

Migrations 1 and 2 add columns to tables queried with `SELECT *` in `Recording::create` (RETURNING *), `Recording::get_by_id`, the recordings query in `get_by_presentation`, and `Presentation::get_by_id`. The `.sqlx/` offline cache encodes the column list even for wildcard queries. Run `cargo sqlx prepare` on the VPS after applying all four migrations and updating the structs, before building.

---

## New Routes

- `POST /user/presentations/{pid}/access/mode` — saves `access_mode` on the presentation (owner only; 401 unauthenticated, 404 non-owner). Body: `mode=public|audience|private`.
- `POST /user/recordings/{rid}/access/mode` — saves `access_mode` on the recording (owner only; ownership verified via `recording.presentation_id → presentation.user_id`). Body: `action=set&mode=public|audience|private` or `action=inherit` (sets to NULL).

---

## Presentations Page — Action Menu

| Before | After |
|---|---|
| Copy link | Copy link (unchanged) |
| Set password | **Removed** |
| Manage co-presenters | **Renamed** → Manage access |
| Delete [name] | Delete [name] (unchanged) |

The action menu now has three items.

---

## Presentations Page — Filter Panel

The existing filter panel has checkboxes for `owner`, `editor`, `controller`. Add a fourth:

```html
<label><input type="checkbox" checked data-filter-role="audience"> Shared as audience</label>
```

Update the `aria-label` count logic accordingly.

---

## Manage Access Dialog (Presentations Page)

Replaces and extends the existing "Manage co-presenters" dialog (`id="manage-access-{pid}"`).

### Heading and trigger

| Location | Before | After |
|---|---|---|
| Action menu item | Manage co-presenters | Manage access |
| Dialog `h1` | Co-presenters for [name] | Manage access for [name] |
| Dialog `aria-labelledby` target | `manage-access-heading-{pid}` | unchanged |
| Table `<caption>` | Co-presenters | Access |

### Tab/reading order on open

1. `h1` "Manage access for [presentation name]" — receives focus on open (`tabindex="-1"`, `data-focus-heading="true"`)
2. `<select>` labeled "Visibility":
   - `public` — Public — anyone with the link
   - `audience` — Shared — specific people
   - `private` — Private — presenters only
3. `<table>`:
   - `<caption>` "Access"
   - `<thead>`: Username, Role
   - `<tbody>`: existing user rows — username (plain text), role `<select>` (Editor / Controller / Audience / Remove)
   - `<tbody class="new-rows-tbody">`: staged new rows — username `<input>`, role `<select>` (Editor / Controller / Audience)
   - `<tfoot>`: one row, `colspan="2"`, "Add person" button
4. Close button
5. Unsaved prompt (hidden until staged changes exist): "You have unsaved changes." / Save / Discard

The DOM order of Close before the unsaved-prompt div is preserved from the existing implementation, so the tab sequence within the dialog remains: table → Add button → Close → Save → Discard (when prompt is visible).

### Save behaviour

The Visibility combobox change is staged alongside role changes, new-row additions, and removals. One Save commits all pending changes: mode change (`POST …/access/mode`), new users (`POST …/access/add`), role changes or removals (`POST …/access/change-role` or `POST …/access/remove`).

Selecting "Remove" in a role `<select>` stages the row for removal (visually marked as pending). The user can change their mind before saving; Discard reverts the row to its previous role value.

The Audience role option appears in role selects regardless of the current Visibility mode. The Visibility combobox describes what each mode means; no additional per-row warnings are shown when a mode mismatch exists (e.g., Audience members listed when mode is Private).

### Accessibility

- `<dialog>` has `aria-labelledby` pointing to the `h1`
- Focus moves to `h1[tabindex="-1"]` on open (`data-focus-heading="true"`)
- Focus returns to the "Actions: [name]" menu button on close (existing `data-return-focus` mechanism)
- Visibility `<select>` associated to its `<label>` via `for`/`id`
- Role `<select>` in each row associated to column header via `headers` attribute
- WCAG 2.2 Level AAA throughout

---

## Manage Recording Access Dialog (Recording Page)

Replaces the existing "Set recording password" button and dialog.

### Trigger

| Before | After |
|---|---|
| Button: "Set recording password" | Button: "Manage recording access" |
| Dialog `h1`: "Set password for [name]" | Dialog `h1`: "Manage recording access for [name]" |

### Tab/reading order on open

1. `h1` "Manage recording access for [recording name]" — receives focus on open (`tabindex="-1"`)
2. `<select>` labeled "Access":
   - (NULL / inherit) — Inherit from presentation
   - `public` — Public — anyone with the link
   - `audience` — Shared — same audience list as presentation
   - `private` — Private — presenters only
3. Save button (`POST /user/recordings/{rid}/access/mode`)
4. Close button

The recording dialog uses Save-then-Close order rather than the Close-then-unsaved-prompt order used in the presentations dialog. This is intentional: the recording dialog has no staged workflow and no Discard path — Save submits a form directly. The two dialogs follow different interaction patterns (staged JS vs. simple form POST), so the tab order reflects the simpler case.

The dialog element carries `data-focus-heading="true"` so the existing recording page JS focuses `h1[tabindex="-1"]` on open. No user list — audience membership is managed on the presentation.

### Accessibility

- `<dialog>` has `aria-labelledby` pointing to the `h1`
- Focus moves to `h1[tabindex="-1"]` on open (`data-focus-heading="true"`)
- Focus returns to the "Manage recording access" button on close
- WCAG 2.2 Level AAA throughout

---

## Test Updates

### `db.rs`

**Remove:**
- `set_password_stores_plaintext`
- `set_recording_password_stores_plaintext`
- `clear_password_removes_value`
- `clear_recording_password_removes_value`
- `check_access_correct_password_returns_ok`
- `check_access_wrong_password_returns_denied`
- `check_access_owner_bypasses_password`
- `check_access_authenticated_non_owner_can_unlock_with_password`

**Add:**
- `check_access_public_returns_public_ok` — unauthenticated user on a public presentation gets `PublicOk`
- `check_access_audience_mode_denies_unauthenticated` — unauthenticated user on audience-mode presentation gets `Denied`
- `check_access_audience_member_gets_audience_result` — user with `role='audience'` in `presentation_access` on audience-mode presentation gets `Audience`
- `check_access_private_ignores_audience_role` — user with `role='audience'` on private presentation gets `Denied`
- `check_access_recording_inherits_presentation_mode` — recording with NULL `access_mode` uses presentation's mode

### `main.rs`

**Remove:**
- `set_presentation_password_as_owner`
- `clear_presentation_password_as_owner`
- `set_recording_password_as_owner`

**Add:**
- `set_presentation_access_mode_as_owner`
- `set_presentation_access_mode_non_owner_returns_404`
- `set_recording_access_mode_as_owner`
- `set_recording_access_mode_inherit`
- `add_audience_member_as_owner`
- `recording_handler_denies_access_in_private_mode` — set the presentation's `access_mode` to `'private'`, make a request to the recording page as an unauthenticated user, assert a 403 response

### `tests/presentations.spec.js`

- Remove all password dialog tests
- Update "Manage co-presenters" text assertions → "Manage access"
- Update "Co-presenters for" heading assertions → "Manage access for"
- Add: Visibility combobox defaults to "Public — anyone with the link"
- Add: staging a Visibility change shows unsaved prompt
- Add: audience role option appears in role select for existing rows
- Add: audience role option appears in add-row role select
- Add: selecting Remove in role select stages removal and shows unsaved prompt
- Add: "Shared as audience" filter checkbox appears and filters list
- Update existing "filter panel has three checkboxes all checked" assertion → four checkboxes

---

## Files Touched

| File | Change |
|---|---|
| `syncslide-websocket/migrations/` | 4 new migrations (access_mode ×2, role CHECK recreation, NULL passwords) |
| `syncslide-websocket/src/db.rs` | Add `access_mode` to `Presentation`, `Recording`, `PresentationRecordings`; update `check_access` signature and logic; remove password methods; add `set_access_mode` methods; update `get_shared_with_user` column list |
| `syncslide-websocket/src/main.rs` | Remove `JoinPasswordForm`, `JoinPwdQuery`, `join_password_submit`, `/join-password` route; update `check_access` call sites; add `/access/mode` routes; remove password routes; add recording/slides access checks; update role validation in `add_access` and `change_access_role`; update tests |
| `syncslide-websocket/templates/presentations.html` | Rename dialog heading and menu item; add Visibility select; update role select options and caption; rename Add button; add "audience" filter checkbox |
| `syncslide-websocket/templates/recording.html` | Replace password dialog with access mode dialog; rename button; add `data-focus-heading` |
| `syncslide-websocket/templates/join_password.html` | **Delete** |
| `syncslide-websocket/js/` | Update manage-access JS: Visibility select staging; Remove-as-role behaviour; updated save payload to include mode |
| `tests/presentations.spec.js` | Remove password tests; update text assertions; add new tests |
