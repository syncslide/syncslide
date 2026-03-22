# Manage Password Dialog — Design Spec

Date: 2026-03-22

## Problem

Owners set access passwords on their presentations and recordings but have no way to view what they set. Passwords are stored as Argon2id hashes, so the plaintext is irrecoverable after submission.

## Goal

Pre-populate the password field with the current password so owners can see and update it. Rename both dialogs from "Set password" to "Manage password".

---

## Storage Change

**Switch presentation and recording passwords from hashed to plaintext.**

These are audience access codes shared with attendees, not personal credentials. Storing them in plaintext is appropriate and necessary to display them back.

- `Presentation::set_password`: store the string directly instead of hashing.
- `Recording::set_password`: store the string directly instead of hashing. Update the doc comment from "Hashes `plaintext` with Argon2id and stores it" to "Stores `plaintext` directly."
- `check_access`: replace `Argon2::verify_password` with a direct `==` comparison between the stored string and the provided password. Update the `AccessResult` doc comment (currently says "matches the stored Argon2id hash") to say "matches the stored plaintext."
- New migration: NULL out all existing presentation and recording passwords. They are currently Argon2 hashes; displaying them as plaintext would show garbage to the owner.

**User login passwords are unaffected.** `User::new`, `User::change_password`, and `AuthnBackend::authenticate` continue to use Argon2id. The top-level Argon2 imports and the `Error::Password` variant in `db.rs` are retained — they serve user authentication.

---

## PresentationRecordings Struct

Add `password: Option<String>` to `PresentationRecordings` in `db.rs`. In `Recording::get_by_presentation`, when constructing the `PresentationRecordings` literal, explicitly add `password: pres.password` alongside the existing fields (`id`, `name`, `user_id`, `content`). This makes `pres.password` available in `presentations.html`.

The `recording.html` template already receives `rec` (a `Recording`), which already has `rec.password`. No struct change needed there.

---

## Dialog Design

### Heading and trigger

| Location | Before | After |
|---|---|---|
| Presentations page — actions menu item | "Set password" | "Manage password" |
| Presentations page — dialog `h1` | "Set password for [name]" | "Manage password for [name]" |
| Recording page — open button | "Set recording password" | "Manage recording password" |
| Recording page — dialog `h1` | "Set password for [name]" | "Manage password for [name]" |

### Password input

The existing password input keeps label "Password" and keeps `autocomplete="new-password"` (correct for a manage-password field — prevents browser auto-fill interference). It is pre-populated: `value="{{ pres.password | default(value='') }}"` for presentations, `value="{{ rec.password | default(value='') }}"` for recordings. Tera's auto-escaping handles any special characters in the stored value correctly — the browser decodes the attribute before form submission, so the round-trip is lossless.

If the owner submits the pre-populated value unchanged, the handler calls `set_password` with the same string. This is harmless — a redundant write. The `minlength="8"` constraint is satisfied because the original password met it when first set.

The show/hide toggle remains.

### Focus on open

**Presentations page**: The presentations JS open handler checks `dialog.dataset.focusHeading` to decide whether to focus the heading or the first input. Add `data-focus-heading="true"` to the password dialog element so the `h1` receives focus on open, consistent with other dialogs.

**Recording page**: The recording JS open handler always focuses `h1[tabindex="-1"]` first, so no change is needed there.

### Tab/reading order (from heading focus on open)

1. `h1` "Manage password for [name]" — receives focus on dialog open (`tabindex="-1"`)
2. Password input labeled "Password" — pre-populated with current password or empty
3. Show/hide toggle button for the password input
4. Save button
5. Clear password button
6. (Recording only) "Reset to inherit from presentation" button — both this and "Clear password" post `action=clear` to the same handler and have the same server-side effect: `recording.password` is set to NULL. They convey different user intent in the label but are mechanically identical. Both buttons are kept as-is.
7. Close button

---

## Test Updates

### `db.rs`

- `set_password_stores_hash` → rename to `set_password_stores_plaintext`; assert stored value equals the submitted string (e.g. `== Some("hunter2".to_string())`), not an Argon2id format string.
- `set_recording_password_stores_hash` → rename to `set_recording_password_stores_plaintext`; same assertion change.
- `clear_password_removes_hash` → rename to `clear_password_removes_value`.
- `clear_recording_password_removes_hash` → rename to `clear_recording_password_removes_value`.
- `hash_produces_argon2id_format`, `correct_password_verifies`, `wrong_password_fails_verification` — these test user login hashing; leave unchanged.
- `check_access_correct_password_returns_ok` — store plaintext directly in the DB (e.g. `UPDATE presentation SET password = 'hunter2'`) instead of computing a hash.
- `check_access_wrong_password_returns_denied` — same.
- `check_access_owner_bypasses_password` — same.
- `check_access_authenticated_non_owner_can_unlock_with_password` — same.

### `main.rs`

- `set_presentation_password_as_owner` — assert `pres.password == Some("mysecret1".to_string())` instead of `is_some()`.
- `clear_presentation_password_as_owner` — no change needed.
- `set_recording_password_as_owner` — assert `rec.password == Some("mysecret1".to_string())` instead of `is_some()`.

### `tests/presentations.spec.js`

- Update text assertions: "Set password" → "Manage password", "Set password for" → "Manage password for".

---

## Files Touched

| File | Change |
|---|---|
| `syncslide-websocket/migrations/` | New migration to NULL existing presentation and recording passwords |
| `syncslide-websocket/src/db.rs` | Plaintext storage; update doc comments; add `password` to `PresentationRecordings`; update `check_access` |
| `syncslide-websocket/src/main.rs` | Update Rust tests |
| `syncslide-websocket/templates/presentations.html` | Add `data-focus-heading`; rename dialog/menu; pre-populate input |
| `syncslide-websocket/templates/recording.html` | Rename dialog/button; pre-populate input |
| `tests/presentations.spec.js` | Update text assertions |
