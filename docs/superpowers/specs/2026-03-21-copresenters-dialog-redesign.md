# Co-presenters Dialog Redesign

**Date:** 2026-03-21
**Status:** Approved

## Summary

Redesign the "Manage co-presenters" dialog to remove the Actions column, replace per-row immediate saves with staged client-side changes, add inline username validation for new rows, and replace the plain Close button with a Close → confirm/discard flow.

---

## Dialog Structure

### Heading and table

The dialog opens with focus on `<h1 tabindex="-1">Co-presenters for [name]</h1>`.

The existing open-dialog JS handler currently focuses the first `<select>` in tbody. That behaviour must be overridden for this dialog so that focus always goes to the `<h1>`. The simplest approach is to add a `data-focus-heading="true"` attribute to this dialog element and update the open handler to check for it.

The table has two columns: **Username** and **Role**. The Actions column is removed. The table is always rendered (even when no co-presenters exist), with `<th scope="col">` for each column header. A `<caption>` reads "Co-presenters" so screen readers announce table context on entry. When `<tbody>` is empty, no additional empty-state message is needed — the Add button row is always present as the last row, so the user immediately reaches something actionable.

**Existing rows:**
- Username cell: static text (not editable).
- Role cell: `<select>` with options Editor, Controller, Remove. `aria-label="Role for [username]"`.

**New rows** (added via the Add button):
- Username cell: `<input type="text">` with `aria-label="Username"`, `autocomplete="off"`, `spellcheck="false"`. Inline validation fires on blur (see Validation section).
- Role cell: `<select>` with options Editor, Controller. Defaults to Editor. `aria-label="Role for new co-presenter"`.

Note: when multiple new rows exist simultaneously, each role select has the same `aria-label="Role for new co-presenter"`. This is acceptable because the username input for that row precedes it in tab order, giving screen reader users the context needed to identify which role select they are on. An ideal future improvement would be to update the `aria-label` dynamically once a valid username is entered.

**Last table row:**
- A `<td colspan="2">` containing a single "Add co-presenter" `<button>`.
- On click: a new empty row is inserted immediately before this row and focus moves to the new row's username input.
- The Add button is disabled while the most recently added new row has an empty username input, preventing multiple stacked empty rows.

---

## Tab and Reading Sequence

1. Dialog announced: "Co-presenters for [name], dialog"
2. Focus lands on `<h1 tabindex="-1">` — announced as heading
3. For each existing row: role select (username is static text, read as row context)
4. For each new row: username input → role select
5. "Add co-presenter" button
6. "Close" button
7. (If unsaved-changes prompt is visible) "Save" button → "Discard" button

---

## Inline Validation for New Rows

Validation fires on `blur` of a new row's username input.

**Order of checks:**

1. If the value is empty: clear any existing error and stop (empty rows are silently skipped on save; no error needed).
2. **Self-add check (client-side):** if the entered value matches the current logged-in user's username (available from the template as a JS variable), show error: "You are the owner of this presentation." Stop.
3. **Duplicate check (client-side):** compare the entered value (case-insensitive) against all existing co-presenter usernames displayed in the table and all other new-row username inputs. If a match is found, show error: "Already a co-presenter." Stop.
4. **Existence check (server-side):** fire `GET /users/exists?username={value}`. If the server returns 404, show error: "User not found."

**Error display:**
- Each new row's username cell contains an error container element (`<span role="status" aria-live="polite">`).
- When an error is set, the container text is updated — the live region announces the error immediately without the user needing to refocus the input.
- `aria-invalid="true"` is set on the input when an error is present; `aria-invalid="false"` (or the attribute removed) when cleared.
- `aria-describedby` on the input points to the error container.
- The error is cleared and `aria-invalid` is reset when the user modifies the input value.

**Rows with errors are silently skipped on Save** (same behaviour as empty rows).

No debounce is needed on the existence check since validation fires only on `blur`, not on `input`.

---

## Close Button and Unsaved-Changes Prompt

A single "Close" button sits below the table.

**Definition of a pending change:**
- Any existing row's role select has a value different from its original value (including changed to "Remove"), OR
- Any new row exists in the table (regardless of whether its username input is empty, filled, or errored).

**Behaviour:**

- If no pending changes: closes the dialog immediately. Focus returns to the Actions menu button.
- If there are pending changes: an inline prompt appears within the dialog (not a nested `<dialog>`): "You have unsaved changes." followed by two buttons: "Save" and "Discard". Focus moves to the "Save" button when the prompt appears.
  - "Save": executes the save sequence (see Save Behaviour), then closes.
  - "Discard": resets all inputs to their original state, removes all new rows, hides the prompt, and closes the dialog. Focus returns to the Actions menu button.

**Escape key behaviour:**
- If the unsaved-changes prompt is not visible and there are pending changes: show the unsaved-changes prompt (same as clicking Close). Focus moves to "Save".
- If the unsaved-changes prompt is not visible and there are no pending changes: close the dialog immediately. Focus returns to the Actions menu button.
- If the unsaved-changes prompt is visible: dismiss the prompt (hide it, do not close the dialog). Focus returns to the "Close" button.

**Navigation away from the page** while the dialog is open with unsaved changes is not guarded by a `beforeunload` handler. This is out of scope.

---

## Save Behaviour

Save is triggered by the "Save" button in the unsaved-changes prompt.

**Before sending requests:**
- Filter out rows with empty usernames.
- Filter out rows with validation errors (aria-invalid="true").
- No additional deduplication step is needed: the inline duplicate check prevents two new rows from having the same username; if somehow the same username appears in a new row and an existing row, the duplicate check will have flagged it as an error and it will already be filtered out.

**Controls during save:** Save and Discard buttons are disabled while requests are in flight to prevent double-submission.

**Failure handling:** If requests fail (network error or unexpected server error), the page still reloads. Failures are silent. This is acceptable for this management dialog — the reload will reflect the actual server state.

**For each remaining row:**

| Row type | Condition | Action |
|---|---|---|
| Existing | Role changed to "Remove" | POST `/user/presentations/{id}/access/remove` with `user_id` |
| Existing | Role changed (not Remove) | POST `/user/presentations/{id}/access/change-role` with `user_id`, `role` |
| Existing | Role unchanged | No request |
| New | Non-empty, no error | POST `/user/presentations/{id}/access/add` with `username`, `role` |

All requests use `fetch` with `Content-Type: application/x-www-form-urlencoded` (body as `URLSearchParams`). This matches Axum's `Form` extractor.

Removing all co-presenters is valid. No additional confirmation beyond the standard unsaved-changes prompt is required.

Rows that are silently skipped (empty or errored username) produce no user-visible feedback. The page reloads and those adds simply do not appear in the updated list. No post-reload announcement is needed — the absence of the expected row is itself the signal.

Existing endpoints return 303 redirects on success. Fetch calls use `redirect: 'manual'`; a response of type `opaqueredirect` is treated as success. Any other response type is treated as failure (silently ignored).

After all fetches settle, the page reloads.

**CSRF:** No CSRF tokens are required. The server uses session-based auth without CSRF middleware.

---

## New Server Endpoint

`GET /users/exists?username={value}`

- Requires authentication. Returns 401 (or redirects to login) if the session is missing.
- Returns HTTP 200 if a user with that username exists.
- Returns HTTP 404 if no such user exists.
- No response body required.
- Used only for inline new-row validation.

---

## What Is Removed

- The Actions column and its per-row Remove form.
- The per-row "Save role" button and its form.
- The standalone "Add co-presenter" section (`<h2>` heading and form) below the table.
- The `{% if pres.access | length > 0 %}` conditional wrapping the table (the table is now always rendered).

---

## Accessibility Notes

- Column headers use `<th scope="col">` and a `<caption>` is present so screen readers announce table context.
- All inputs and selects in new rows have explicit `aria-label` attributes.
- Inline errors use `aria-live="polite"` on the error container (announced immediately on blur) and `aria-invalid` on the input (announced when the input is next focused).
- The unsaved-changes prompt is rendered inline within the dialog to avoid nested dialog focus complexity. Focus moves explicitly to "Save" when it appears.
- Focus returns to "Close" when the prompt is dismissed via Escape.
- The "Add co-presenter" button is a standard `<button>` inside `<td colspan="2">`. Its text is its accessible name; column header context for that row is not meaningful and does not interfere.
- The dialog's open handler must be updated to focus the `<h1>` rather than the first `<select>` in tbody.
