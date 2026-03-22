# Co-presenters Dialog Redesign

**Date:** 2026-03-21
**Status:** Approved

## Summary

Redesign the "Manage co-presenters" dialog to remove the Actions column, replace per-row immediate saves with staged client-side changes, add inline username validation for new rows, and replace the plain Close button with a Close → confirm/discard flow.

---

## Dialog Structure

### Heading and table

The dialog opens with focus on `<h1 tabindex="-1">Co-presenters for [name]</h1>`.

The table has two columns: **Username** and **Role**. The Actions column is removed.

**Existing rows:**
- Username cell: static text (not editable).
- Role cell: `<select>` with options Editor, Controller, Remove. `aria-label="Role for [username]"`.

**New rows** (added via the Add button):
- Username cell: `<input type="text">` with `aria-label="Username"`. Inline validation fires on blur (see Validation section).
- Role cell: `<select>` with options Editor, Controller. Defaults to Editor. `aria-label="Role"`.

**Last table row:**
- A single "Add co-presenter" `<button>` spanning both columns.
- On click: a new empty row is inserted immediately before this row and focus moves to the new row's username input.

### Close button and unsaved-changes prompt

A single "Close" button sits below the table.

- If no pending changes: closes the dialog immediately, focus returns to the Actions menu button.
- If there are pending changes: an inline prompt appears within the dialog: "You have unsaved changes." followed by two buttons: "Save" and "Discard".
  - "Save": executes the save sequence (see Save Behaviour), then closes.
  - "Discard": resets all inputs to their original state and closes.
  - Focus moves to "Save" when the prompt appears.
  - If the user presses Escape while the prompt is visible, the prompt is dismissed (dialog stays open).

---

## Tab and Reading Sequence

1. Dialog announced: "Co-presenters for [name], dialog"
2. Focus lands on `<h1 tabindex="-1">` — announced as the dialog heading
3. For each existing row: role select
4. For each new row: username input → role select
5. "Add co-presenter" button
6. "Close" button
7. (If prompt visible) "Save" button → "Discard" button

Note: existing username cells are static text and not focusable. They are read by screen readers as part of the table row context via column headers.

---

## Inline Validation for New Rows

Validation fires on `blur` of a new row's username input.

**Duplicate check (client-side):**
- Compare the entered value (case-insensitive) against all existing co-presenter usernames in the table and all other new-row username inputs.
- If a match is found: show inline error "Already a co-presenter" associated with the input via `aria-describedby`.

**Existence check (server-side):**
- Fire `GET /users/exists?username={value}`.
- If the user is not found: show inline error "User not found".
- If the duplicate check already failed, skip the server call.

**Error display:**
- An error message element is placed immediately after the input within the cell.
- `aria-describedby` on the input points to the error element.
- The error is cleared when the user modifies the input value.

**Rows with errors are skipped silently on Save** (same behaviour as empty rows).

---

## Save Behaviour

Before sending any requests, JS deduplicates new rows by username (case-insensitive). If the same username appears in multiple new rows, keep the last one added and drop the earlier ones. If a new row's username matches an existing co-presenter, treat it as a role change for that person.

For each row (after deduplication and filtering out empty/errored rows):

| Row type | Change | Action |
|---|---|---|
| Existing | Role → Remove | POST `/user/presentations/{id}/access/remove` with `user_id` |
| Existing | Role changed (not Remove) | POST `/user/presentations/{id}/access/change-role` with `user_id`, `role` |
| Existing | No change | No request |
| New | Valid username, not duplicate | POST `/user/presentations/{id}/access/add` with `username`, `role` |

All fetch calls run, then the page reloads regardless of individual failures. (A failed `/access/add` for a new row is equivalent to that row being dropped.)

---

## New Server Endpoint

`GET /users/exists?username={value}`

Returns HTTP 200 if the user exists, HTTP 404 if not. No body required. Used only for inline validation in the dialog.

---

## What Is Removed

- The Actions column and its per-row Remove form.
- The per-row "Save role" button and its form.
- The standalone "Add co-presenter" section with its own heading and form below the table.

---

## Accessibility Notes

- Column headers use `<th scope="col">` so screen readers announce column context for each cell.
- All inputs and selects in new rows have explicit `aria-label` attributes since they appear in multiple rows.
- The unsaved-changes prompt is rendered inline within the dialog (not a nested `<dialog>`) to avoid focus management complexity. Focus moves explicitly to the "Save" button when the prompt appears.
- Inline errors use `aria-describedby` so they are announced when the input receives focus.
- The "Add co-presenter" button is a standard `<button>` in a table row; it is announced as a button and is reachable by Tab.
