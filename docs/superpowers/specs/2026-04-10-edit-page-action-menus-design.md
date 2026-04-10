# Edit Page: Action Menus and Markdown Dialog

## Summary

Replace the `<select>` dropdowns in the edit page's slides table with the APG Menu Button pattern used throughout the rest of the project, and move the always-visible markdown textarea into a dialog with explicit save/discard flow.

## Slide Table Action Menus

### Current state

Each slide row has a `<select>` with options: `--`, Edit, Move Up, Move Down, Delete. Actions fire on change/focusout/Enter. Delete uses the browser's native `confirm()`.

### New pattern

Each slide row gets a `<button aria-haspopup="menu">` that toggles a `<ul role="menu">` with `<li role="menuitem">` items, matching the recording and presentation action menus on the presentations page.

**Row markup:**

```html
<tr>
  <th scope="row">1</th>
  <td>Slide Title</td>
  <td>
    <button type="button" aria-haspopup="menu" aria-expanded="false"
            aria-controls="slide-actions-menu-0">Actions: slide 1</button>
    <ul role="menu" id="slide-actions-menu-0" hidden>
      <li role="menuitem" tabindex="-1" data-action="edit" data-idx="0">Edit</li>
      <li role="menuitem" tabindex="-1" data-action="move-up" data-idx="0">Move Up</li>
      <li role="menuitem" tabindex="-1" data-action="move-down" data-idx="0">Move Down</li>
      <li role="menuitem" tabindex="-1" data-action="delete" data-idx="0">Delete</li>
    </ul>
  </td>
</tr>
```

- Button text: `Actions: slide [n]`
- Move Up is hidden on the first slide; Move Down is hidden on the last slide
- Keyboard: Arrow keys navigate menu items, Escape closes menu and returns focus to button, Enter/Space activates the focused item
- Event handling: delegation on `<tbody>` (single click/keydown/focusout listener set). The table re-renders on every markdown change, so delegation avoids re-attaching per-row listeners.

### Delete confirmation dialog

Delete opens a `<dialog>` instead of `confirm()`:

- Heading: `Delete slide [n]: [title]?`
- Body: "This will remove the slide from the presentation."
- Buttons: Delete (submits), Cancel (closes dialog)
- Focus: heading on open, return to the action menu button on close

A single shared dialog is re-used across all rows (heading/body updated before opening), since only one can be open at a time.

## Edit Markdown Dialog

### Current state

The markdown textarea is always visible in a `<section>` on the edit page. Changes are sent to the server on blur/change (via `onCommit`), immediately broadcasting to all connected clients and re-rendering the slide table.

### New pattern

The section is replaced by a single "Edit Markdown" button that opens a `<dialog>`.

**Button placement (reading/tab order):**

1. Page heading (presentation name)
2. Presentation name input
3. Add Slide button
4. Edit Markdown button
5. Slides section with table

**Dialog structure:**

- Heading: "Edit Markdown" (`<h1 tabindex="-1">`, focused on open)
- Textarea labelled by the presentation name
- Two buttons: Save, Close

**On open:** The textarea is populated with the current markdown. A snapshot of the markdown is stored for dirty-checking.

**Save button:** Sends the markdown to the server, broadcasts to connected clients, re-renders the slide table, updates the snapshot, closes the dialog.

**Close button / Escape (unchanged content):** Closes immediately.

**Close button / Escape (changed content):** Shows an unsaved changes confirmation panel (same pattern as the recording access dialogs):

- Heading: "Unsaved changes"
- Body: "You have unsaved changes."
- Buttons: Save, Discard, Back
- Save: applies changes and closes
- Discard: reverts textarea to snapshot and closes
- Back: returns to the textarea (hides confirmation panel)

**Focus management:** On open, the heading is focused. On close (by any path), focus returns to the Edit Markdown button.

## What Gets Removed

- The `<section aria-labelledby="markdown-heading">` block (heading, label, textarea) from `edit.html`
- The `onCommit` listener on the textarea that auto-sends on blur/change
- The `lastSentMarkdown` variable — replaced by the dialog's snapshot-based dirty check

## What Stays Unchanged

- The slide dialog (Add Slide / Edit single slide) — unchanged
- `syncFromSlides()` — still used by the slide dialog and by move/delete actions
- `markdownToSlides()` / `slidesToMarkdown()` helpers
- `updateMarkdown()` — called from the dialog's Save action instead of from an onCommit listener
