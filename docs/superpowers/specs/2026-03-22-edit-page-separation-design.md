# Edit Page Separation Design

**Date:** 2026-03-22

## Problem

The stage page is too crowded when all sections are expanded. Editing and presenting are distinct activities; other presentation tools separate them into different views.

## Solution

Split the stage page into two dedicated pages — one for presenting, one for editing — both launched from the presentations list and opened in their own browser tabs. Live WebSocket sync is preserved: changes made on the edit page push to the audience in real time.

---

## 1. Presentations List Changes

### Presentation name link
The `<h2><a>` heading link already navigates to the stage. Add `target="_blank"` so it opens in a new tab. Append an inline SVG external-link icon (`aria-hidden="true"`) followed by a visually hidden `<span class="sr-only">(opens in new tab)</span>` so screen readers announce the behaviour.

### Actions menu
Add a new menu item: **"Edit [name]"**. It opens `/{uname}/{pid}/edit` in a new tab. Same icon + sr-only treatment as the heading link. Only shown to the presentation owner and users with editor role (i.e. the same users who can access the edit page).

---

## 2. Stage Page Changes

### Access
Owner, editor, and controller all receive `stage.html`. Audience receives `audience.html`. This is a change from the current behaviour where controllers received `audience.html`.

### Page structure
- **Title:** `[pname] – Stage`
- **H1:** presentation name; focus lands here on arrival
- **Reading/tab order:** Breadcrumb (outside `<main>`) → H1 → QR toggle → Record section → Slide nav

### Removed from stage
- "Edit Slides" `<details>` block (name field, Add Slide button, Slides table, Markdown editor)
- `#slideDialog` (add/edit individual slide dialog)
- Duplicate QR toggle in `{% block stage %}` (see QR section below)

### QR toggle
Remove QR from `audience.html` entirely. Keep it in `stage.html` only (the instance currently inside `{% block stage %}`). Owner, editor, and controller all receive `stage.html`, so they all have access to QR. Audience viewers, who receive `audience.html`, do not.

### Kept on stage
- QR toggle button + overlay
- Record `<details>` section
- Slide navigation (`_slide_nav.html`)
- Save recording dialog (`#saveRecordingDialog`)

---

## 3. New Edit Page

### Route
`GET /{uname}/{pid}/edit`

### Access
Owner and editor only. Controller, audience, and unauthenticated users are redirected (to the stage or login as appropriate).

### Template
`edit.html`, extending `nav.html` directly (same as `presentations.html`). Does not extend `audience.html` — no live slide preview on the edit page.

### Page structure
- **Title:** `[pname] – Edit`
- **H1:** presentation name; focus lands here on arrival
- **Reading/tab order:** Breadcrumb (outside `<main>`) → H1 → Presentation name field → Add Slide button → Slides table → Markdown editor

### JavaScript
Same as current stage: `common.js` (WebSocket setup), `handlers.js` (markdown and slide change handlers), `remarkable.js`, `katex.js`, `auto-render.js`.

### WebSocket
Connects to `/ws/{pid}`. Sends markdown and slide updates live, same as the current stage page. Audience clients connected to the same presentation receive updates in real time.

### No slide preview
The edit page is a pure editing interface. Rendered slide output is not shown. The stage page (open in a separate tab) shows the live slide view.

---

## 4. Template Hierarchy Summary

| Template | Extends | Used by |
|---|---|---|
| `stage.html` | `audience.html` | Owner, editor, controller |
| `edit.html` | `nav.html` | Owner, editor |
| `audience.html` | `nav.html` | Audience viewers |

---

## 5. Accessibility

- Both stage and edit pages: H1 is `tabindex="-1"` and receives focus on arrival via existing focus management.
- Breadcrumb is outside `<main>` (rendered by `{% block breadcrumb %}` in `base.html`), appearing before `<main>` in reading order.
- "Opens in new tab" is communicated via sr-only text on all affected links, satisfying WCAG 3.2.5 (Change on Request, AAA).
- External link icon is `aria-hidden="true"` with visible SVG; screen readers use the sr-only span instead.

---

## 6. Out of Scope

- Recording access control (whether controllers can record is unchanged)
- Any changes to the audience page beyond removing the QR toggle
- Any changes to the WebSocket protocol
