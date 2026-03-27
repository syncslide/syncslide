# Recording Edit Page & Action Menu — Design Spec

**Date:** 2026-03-26

## Overview

Two related changes:

1. **Recording action menu in pList** — replace the bare Delete button in the recordings table with a full action menu (Copy link, Manage access, Edit Recording, Delete Recording), matching the existing presentation action menu pattern.
2. **Separate edit recording page** — move all owner-only editing controls off the watch recording page onto a dedicated `/{uname}/{pid}/{rid}/edit` page. The watch page becomes identical for all access levels.

---

## Routes and Access

### New route
`GET /{uname}/{pid}/{rid}/edit` → `edit_recording` handler → `edit_recording.html`

**Access:** `Owner | Editor | Controller`. Audience and unauthenticated viewers get 403. Same `check_access` call as the existing `recording` handler.

### Watch route change
`GET /{uname}/{pid}/{rid}` — the `is_owner` flag is removed from the handler context. The template becomes identical for all access levels.

The `edit_recording` handler reuses the same DB lookups as `recording` (pres_user, pres, rec, access check). No new SQL.

---

## Templates

### `recording.html` (simplified)

All `{% if is_owner %}` blocks removed. `is_owner` dropped from handler context.

Reading/tab order:
1. `<h1>{{ pres.name }}: {{ recording.name }}</h1>`
2. Video section (`<details open>`, `<summary id="video-heading">Video</summary>`) — video element + playback speed select (shown only if `recording.video_path` exists)
3. Downloads nav — VTT download, slides HTML download
4. Current slide (`<section aria-live="polite" aria-label="Current slide" id="currentSlide">`)
5. Slide navigation (`<nav aria-label="Slide Navigation">` with go-to select)

No dialogs remain on this page.

Breadcrumb (owner): Home → Your Presentations → [Pres name] → [Recording name]
Breadcrumb (non-owner): Home → [Recording name]

### `edit_recording.html` (new)

Extends `nav.html`. Loads `edit-recording.js`.

Reading/tab order:
1. `<h1 id="edit-rec-heading" tabindex="-1">Edit Recording: {{ recording.name }}</h1>` — receives focus on load
2. Rename: `<label>Recording name: <input type="text" id="recName" data-rid="{{ recording.id }}" value="{{ recording.name }}"></label>`
3. Edit Timing section:
   ```html
   <section aria-labelledby="timing-heading">
   <h2 id="timing-heading">Edit Timing</h2>
   <label><input type="checkbox" id="shiftSubsequent"> Shift subsequent slides when editing a timestamp</label>
   <table>
     <thead><tr><th>Slide</th><th>Title</th><th>Start Time (seconds)</th></tr></thead>
     <tbody id="cueTableBody"></tbody>
   </table>
   <button type="button" id="saveTimingBtn" hidden>Save</button>
   <button type="button" id="discardTimingBtn" hidden>Discard</button>
   </section>
   ```
4. Replace Files section:
   ```html
   <section aria-labelledby="files-heading">
   <h2 id="files-heading">Replace Files</h2>
   <form id="replaceFilesForm">
     <label>Video (optional): <input type="file" name="video" accept="video/*"></label>
     <label>Captions VTT (optional): <input type="file" name="captions" accept=".vtt,text/vtt"></label>
     <button type="submit">Replace</button>
   </form>
   </section>
   ```
5. `<a href="/{{ pres_user.name }}/{{ pres.id }}/{{ recording.id }}">Watch recording</a>`

Breadcrumb: Home → Your Presentations → [Pres name] → [Recording name] → Edit Recording

A `<script>` at the bottom focuses `#edit-rec-heading` on load.

---

## JS

### `play.js` (trimmed)

Removes: all edit timing logic (cue table build, save/discard, shift-subsequent), replace files upload, `#openEditPresentation` listener, `#openReplaceFiles` listener.

Keeps: video `cuechange` → update `#currentSlide` HTML + `#goTo` select, playback speed `#rate` change handler.

### `edit-recording.js` (new)

**Rename:**
- Reads `rid` from `document.getElementById('recName').dataset.rid`
- `onCommit` logic inlined (same two-line debounce/blur pattern as `handlers.js`)
- On commit: `POST /user/recordings/{rid}/name` with new name as plain text body; updates `document.title` and `<h1>` text

**Edit Timing:**
- On page load: `fetch` the recording's `.vtt` URL (available via a `data-vtt-url` attribute on `#cueTableBody` or derived from page URL), parse cues, populate `#cueTableBody`
- Track dirty state; show `#saveTimingBtn` / `#discardTimingBtn` when dirty
- Save: rebuild VTT text from table inputs, `POST /user/recordings/{rid}/files` as multipart with only the VTT field; hide save/discard on success
- Discard: reload cues from original fetch result, hide save/discard
- Shift-subsequent checkbox: identical logic moved from `play.js`

**Replace Files:**
- `#replaceFilesForm` submit: `POST /user/recordings/{rid}/files` as multipart via `fetch`; on success, show a brief "Files replaced" confirmation message in an `aria-live="polite"` region below the form and re-enable the submit button; on failure, show an error message in the same region.

**VTT URL derivation:** `/{uname}/{pid}/{rid}/slides.vtt` — read from `data-vtt-url` attribute on `#cueTableBody`, set in the template as `<tbody id="cueTableBody" data-vtt-url="/{{ pres_user.name }}/{{ pres.id }}/{{ recording.id }}/slides.vtt">`. Avoids JS URL parsing.

---

## pList Recording Action Menu

### HTML structure (per recording row, in `presentations.html`)

Replace the current Delete button + dialog with:

```html
<button type="button"
        id="rec-actions-btn-{{ rec.id }}"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-controls="rec-actions-menu-{{ rec.id }}">Actions: {{ rec.name }}</button>
<ul role="menu" id="rec-actions-menu-{{ rec.id }}" hidden>
  <li role="menuitem" tabindex="-1"
      data-action="copy-rec-link"
      data-owner-name="{{ pres.owner_name }}"
      data-pres-id="{{ pres.id }}"
      data-rec-id="{{ rec.id }}">Copy recording link</li>
  <li role="menuitem" tabindex="-1"
      data-action="open-dialog"
      data-dialog-id="manage-rec-access-{{ rec.id }}"
      data-return-btn="rec-actions-btn-{{ rec.id }}">Manage access</li>
  <li role="menuitem" tabindex="-1"
      data-action="open-rec-edit"
      data-edit-url="/{{ pres.owner_name }}/{{ pres.id }}/{{ rec.id }}/edit">Edit Recording<svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12" style="margin-left:0.25em"><path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M8 1h3v3M11 1L5 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg> <span class="sr-only">(opens in new tab)</span></li>
  <li role="menuitem" tabindex="-1"
      data-action="open-dialog"
      data-dialog-id="delete-rec-{{ rec.id }}"
      data-return-btn="rec-actions-btn-{{ rec.id }}">Delete Recording</li>
</ul>
<dialog id="manage-rec-access-{{ rec.id }}" aria-labelledby="manage-rec-access-heading-{{ rec.id }}" data-focus-heading="true">
  <h1 id="manage-rec-access-heading-{{ rec.id }}" tabindex="-1">Manage access for {{ rec.name }}</h1>
  <form method="post" action="/user/recordings/{{ rec.id }}/access/mode">
    <label for="rec-access-mode-{{ rec.id }}">Access</label>
    <select id="rec-access-mode-{{ rec.id }}" name="mode">
      <option value="public"{% if rec.access_mode == "public" %} selected{% endif %}>Public — anyone with the link</option>
      <option value="audience"{% if rec.access_mode == "audience" %} selected{% endif %}>Shared — same audience list as presentation</option>
      <option value="private"{% if rec.access_mode == "private" %} selected{% endif %}>Private — presenters only</option>
    </select>
    <input type="hidden" name="action" value="set">
    <button type="submit">Save</button>
  </form>
  <form method="post" action="/user/recordings/{{ rec.id }}/access/mode">
    <input type="hidden" name="action" value="inherit">
    <button type="submit">Inherit from presentation</button>
  </form>
  <button type="button" data-close-dialog="manage-rec-access-{{ rec.id }}">Close</button>
</dialog>
<dialog id="delete-rec-{{ rec.id }}" aria-labelledby="delete-rec-heading-{{ rec.id }}">
  <h1 id="delete-rec-heading-{{ rec.id }}" tabindex="-1">Delete {{ rec.name }}?</h1>
  <p>This will permanently delete the recording.</p>
  <form method="post" action="/user/recordings/{{ rec.id }}/delete">
    <button type="submit">Delete</button>
  </form>
  <button type="button" data-close-dialog="delete-rec-{{ rec.id }}">Cancel</button>
</dialog>
```

### JS additions

The existing `[aria-haspopup="menu"]` handler in `presentations.html` is reused as-is for recording action menus — no changes needed to the menu keyboard behaviour.

Two new action handlers added to the menu item `click` listener:

- `copy-rec-link`: copies `window.location.origin + '/' + item.dataset.ownerName + '/' + item.dataset.presId + '/' + item.dataset.recId` to clipboard. Uses same `#clipboard-status` live region.
- `open-rec-edit`: `window.open(item.dataset.editUrl, '_blank', 'noreferrer,noopener')`, then focus returns to button.

### BroadcastChannel `addRecordingRow` update

The `buildRecRow` helper in the BroadcastChannel IIFE is updated to generate the full action menu HTML (button + menu + dialogs) instead of the bare Delete button. A `setupRecMenu(tr)` helper wires up the new menu button and dialog buttons for the dynamically inserted row.

---

## Files Changed

| File | Change |
|------|--------|
| `syncslide-websocket/src/main.rs` | Add `edit_recording` handler; remove `is_owner` from `recording` handler; add route `/{uname}/{pid}/{rid}/edit` |
| `syncslide-websocket/templates/recording.html` | Remove all `{% if is_owner %}` blocks and dialogs |
| `syncslide-websocket/templates/edit_recording.html` | New template |
| `syncslide-websocket/js/play.js` | Remove editing logic; keep cuechange + speed |
| `syncslide-websocket/js/edit-recording.js` | New file: rename, timing edit, replace files |
| `syncslide-websocket/templates/presentations.html` | Replace Delete button with action menu per recording; extend action menu JS for copy-rec-link and open-rec-edit; update BroadcastChannel addRecordingRow |

---

## Out of Scope

- Playwright test updates (existing recording sync tests should still pass; new tests for the edit page are not included in this spec)
- Rename recording from the watch page or the action menu directly (rename is on the edit page only)
