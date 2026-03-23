# Edit Page Separation Design

**Date:** 2026-03-22

## Problem

The stage page is too crowded when all sections are expanded. Editing and presenting are distinct activities; other presentation tools separate them into different views.

## Solution

Split the stage page into two dedicated pages — one for presenting, one for editing — both launched from the presentations list and opened in their own browser tabs. Live WebSocket sync is preserved: changes made on the edit page push to the audience in real time.

---

## 1. Presentations List Changes

### Presentation name link
The `<h2><a>` heading link already navigates to the stage. Add `target="_blank"` so it opens in a new tab. Append an inline SVG external-link icon (`aria-hidden="true"`) followed by `<span class="sr-only">(opens in new tab)</span>`. Exact sr-only string: `(opens in new tab)`. The existing `.stage-link` click handler that records a "recently viewed" timestamp in `localStorage` still fires on left-click with `target="_blank"`. Middle-click and Ctrl+click behaviour is accepted as-is.

### Actions menu — widened to include editors
Currently the entire actions block is wrapped in `{% if pres.role == "owner" %}`. Restructure:

- The delete and manage-access `<dialog>` elements remain owner-only
- The actions `<button>` and `<ul role="menu">` are shown to owner **and** editor:
  `{% if pres.role == "owner" or pres.role == "editor" %}`
- Inside the menu:
  - **Copy link** — always shown
  - **Manage access** — owner only: `{% if pres.role == "owner" %}`
  - **Edit [name]** — owner and editor (new item, see below)
  - **Delete [name]** — owner only: `{% if pres.role == "owner" %}`

### New "Edit [name]" menu item
The existing menu items are `<li role="menuitem" tabindex="-1" data-action="...">` elements driven by a JavaScript click handler. The new item follows the same pattern, using a `data-action="open-edit"` attribute and a new handler case that calls `window.open(url, '_blank')`:

```html
<li role="menuitem" tabindex="-1"
    data-action="open-edit"
    data-edit-url="/{{ pres.owner_name }}/{{ pres.id }}/edit">Edit {{ pres.name }}
  <svg aria-hidden="true" focusable="false" ...><!-- external link icon --></svg>
  <span class="sr-only">(opens in new tab)</span>
</li>
```

In the menu JS, add a new case to the `click` handler alongside `copy-link` and `open-dialog`:
```js
} else if (item.dataset.action === 'open-edit') {
    window.open(item.dataset.editUrl, '_blank');
    btn.focus();
}
```

Screen readers announce: **"Edit [name] (opens in new tab)"** — the sr-only span concatenates into the `role="menuitem"` accessible name.

The "editor role" is the existing `AccessResult::Editor` / `role = "editor"`. No new role is introduced.

---

## 2. Stage Page Changes

### Access — current state
Controllers currently receive `controller.html` — a template that extends `audience.html`, renders `_slide_nav.html` in `{% block stage %}`, and explicitly omits `{{ super() }}` in `{% block js %}` to exclude `recording.js` (which crashes at module scope when `#recordPause` is absent).

### Access — change
Owner, editor, and controller all receive `stage.html`. The `AccessResult` match in the route handler changes from:
```
Owner | Editor => stage(...)
Controller     => controller.html rendering
```
to:
```
Owner | Editor | Controller => stage(...)
```

`controller.html` is **deleted**. The inline controller route logic (building ctx and calling `tera.render("controller.html", ...)`) is removed. The `stage(...)` function already passes `pres_user` in the template context; no context changes are needed.

Controllers on stage have access to the Record section and can record. `recording.js` works correctly on stage because `#recordPause`, `#stop`, and `#timer` all exist there.

### Recording save endpoint update required
`add_recording` (`POST /user/presentations/{pid}/recordings`) currently only permits the presentation owner, via `SELECT COUNT(*) FROM presentation WHERE id = ? AND user_id = ?`. Since controllers can record, this check must be expanded to also allow users with the controller (or editor) role on that presentation. The check should be replaced with a query that succeeds if the user is the owner OR has a `controller` or `editor` access record for the presentation.

### Test update required
The existing test `controller_gets_audience_not_stage` asserts a controller does NOT receive stage access. Rename to `controller_gets_stage_access` and update the assertion to: response status 200, response body contains `id="recordPause"`, response body does not contain `id="markdown-input"`.

### Title template
Change `stage.html`'s `{% block title %}` from `{{ pres.name }} (stage)` to `{{ pres.name }} – Stage` (literal en-dash). `base.html` appends ` - SyncSlide`.

### Page structure
- **H1:** presentation name, `id="stage-heading"`, `tabindex="-1"`. **New element.** Inserted as the first element inside `{% block stage %}`, before the existing QR toggle. The QR toggle does not move.
- **Reading/tab order:** Breadcrumb (outside `<main>`) → H1 → QR toggle → Record section → Slide nav
- **Breadcrumb trail:** Home → Your Presentations → [name] (three items; `[name]` is `aria-current="page"` with no href; same for owner, editor, and controller). `/user/presentations` is valid for all three roles.

### Focus management (new code)
Add at the end of `{% block stage %}`, after all dialogs and includes:
```html
<script>document.getElementById('stage-heading').focus();</script>
```
Runs synchronously during HTML parsing; the H1 is in the DOM at that point. Deferred scripts (`audience.js`, `handlers.js`, `slide-nav.js`, `recording.js`) do not call `focus()` on page load — verified by inspection. The focus call persists.

### Page mode variable (new)
In `stage.html`'s `{% block js %}`, before `{{ super() }}`:
```html
<script>window.presPageMode = 'stage';</script>
```

### Removed from stage
- "Edit Slides" `<details>` block (presentation name field, Add Slide button, Slides table, Markdown editor)
- `#slideDialog`
- `handlers.js` script tag — removed entirely. After editing controls are removed, `#markdown-input` no longer exists on stage. `handlers.js` assigns `textInput = document.getElementById("markdown-input")` (returns null) then calls `onCommit(null, updateMarkdown)`, throwing on `null.tagName`. Removing the script tag is the correct fix.
- The `{% if pres_user %}` QR block in `audience.html`'s `{% block content %}` (lines 18–23): **deleted from `audience.html`**. The QR inside `stage.html`'s `{% block stage %}` is kept.

### Unchanged in `audience.html`
`<span id="pres-name" hidden>` and `<section aria-live="polite" id="currentSlide">` remain in `audience.html`'s `{% block content %}` and are used by stage for the live slide view. No change.

### Kept on stage (unchanged)
- QR toggle button + overlay
- Record `<details>` section
- `#saveRecordingDialog`
- Slide navigation (`_slide_nav.html`)

### JavaScript on stage (after changes)
Inherited from `audience.html` via `{{ super() }}`: `remarkable.js`, `katex.js`, `auto-render.js`, `render-a11y-string.js`, `common.js`, `audience.js`, `recording.js`.
Added by `stage.html`: `slide-nav.js`.
Removed from `stage.html`: `handlers.js`.

---

## 3. New Edit Page

### Route
`GET /{uname}/{pid}/edit`

### Rust handler
Add a new route and handler. The route is registered as `/{uname}/{pid}/edit` with `get(edit_pres)` alongside the existing `/{uname}/{pid}` route.

The handler `edit_pres` follows the same pattern as `stage`: it receives `tera`, `db`, `auth_session`, `pid`, `app_state`, and `pres_user` (the presentation owner's user record). It calls `check_access`, then branches:

```
Owner | Editor => render edit.html
Controller | Audience | PublicOk => redirect to /{uname}/{pid}
Denied => redirect to /auth/login (or return 401)
```

The template context passed to `tera.render("edit.html", ctx)` contains:
- `"pres"` — the `DbPresentation` struct (provides `pres.name`, `pres.content`, `pres.id`)
- `"pres_user"` — the presentation owner's user record (provides `pres_user.name`, used in form action paths if needed)

No `"initial_slide"` is needed — the edit page does not render slides.

### Access
- **Owner, editor:** served `edit.html`
- **Controller:** redirected to `/{uname}/{pid}` (stage page)
- **Audience-role user:** redirected to `/{uname}/{pid}` (audience view)
- **Unauthenticated user:** redirected to `/auth/login`

### Template skeleton
`edit.html` extends `nav.html`. `nav.html` has no `{% block js %}` — it only defines `{% block nav %}` and `{% block footer %}`. `base.html`'s `{% block js %}` is empty. `edit.html`'s `{% block js %}` therefore does not need `{{ super() }}`. `edit.html` inherits `base.html`'s `<link rel="stylesheet" href="/css/style.css">` through the normal chain; no other CSS from `audience.html` is needed.

```html
{% extends "nav.html" %}
{% block title %}{{ pres.name }} – Edit{% endblock title %}
{% block breadcrumb %}
<nav aria-label="Breadcrumb"><ol>
  <li><a href="/">Home</a></li>
  <li><a href="/user/presentations">Your Presentations</a></li>
  <li aria-current="page">{{ pres.name }}</li>
</ol></nav>
{% endblock breadcrumb %}
{% block js %}
<script>window.presPageMode = 'edit';</script>
<script defer src="/js/remarkable.js"></script>
<script defer src="/js/common.js"></script>
<script defer src="/js/audience.js"></script>
<script defer src="/js/handlers.js"></script>
{% endblock js %}
{% block content %}
<h1 id="edit-heading" tabindex="-1">{{ pres.name }}</h1>
<!-- editing controls (see Controls section) -->
<script>document.getElementById('edit-heading').focus();</script>
{% endblock content %}
```

`window.presPageMode = 'edit'` is set in `<head>` (inside `{% block js %}` which `base.html` places in `<head>`), so it is available when any deferred script runs. `audience.js` and `handlers.js` do not call `focus()` on page load — the H1 focus persists.

`window.presPageMode` is intentionally not set on `audience.html`. Do not add it there.

### Page structure
- **Title:** `[pname] – Edit - SyncSlide` (literal en-dash)
- **H1:** presentation name, `id="edit-heading"`, `tabindex="-1"`. First element in `{% block content %}`.
- **Reading/tab order:** Breadcrumb (outside `<main>`) → H1 → Presentation name field → Add Slide button → Slides section → Markdown section

### Controls layout
The outer `<details summary="Edit Slides">` wrapper is **not** used — the whole page is the edit interface. The two sub-`<details>` are replaced with plain `<section>` elements, so all controls are visible on arrival:

```html
<label>Presentation name: <input type="text" id="presName" value="{{ pres.name }}"></label>
<button type="button" id="addSlide">Add Slide</button>
<section aria-labelledby="slides-heading">
  <h2 id="slides-heading">Slides</h2>
  <table>
    <thead><tr><th>Slide</th><th>Title</th><th>Actions</th></tr></thead>
    <tbody id="slideTableBody"></tbody>
  </table>
</section>
<section aria-labelledby="markdown-heading">
  <h2 id="markdown-heading">Markdown</h2>
  <label for="markdown-input" id="input">Markdown: {{ pres.name }}</label>
  <textarea id="markdown-input">{{ pres.content }}</textarea>
</section>
```

`#slideDialog` (the add/edit individual slide dialog) is also moved here unchanged from `stage.html`.

### Hidden `#pres-name` span
`edit.html` does **not** include `<span id="pres-name" hidden>`. That element is used by `audience.js` to prepend the presentation name to rendered slides in `#currentSlide`. The edit page has no `#currentSlide`, so the span is not needed. Its absence is intentional.

### JavaScript on edit
`defer` scripts execute in document order after DOM parsing. Load order shown in template skeleton above.

Excluded intentionally:
- `slide-nav.js` — crashes at module scope: line 26 calls `.addEventListener()` on `document.getElementById("goTo")` which is null
- `recording.js` — crashes at module scope: calls `.addEventListener()` on `document.getElementById("recordPause")` which is null
- `katex.js`, `auto-render.js`, `render-a11y-string.js` — no rendered math output on edit page
- `katex.css` link tag — not included

### WebSocket
Connects to `/ws/{pid}`. `handlers.js` sends markdown and slide updates live. `audience.js` `handleUpdate` processes incoming messages:
- `"text"` messages: stored in `TEXT_TO_RENDER`, returns early
- `"name"` messages: `presNameEl` is null on edit (no `#pres-name`), guarded with `if (presNameEl)` already in `audience.js`; `#currentSlide h1` query returns null, already guarded. The `document.title` line sets the wrong format (`${name} - SyncSlide`) until the Section 4 title fix is applied — **that fix is required for correctness on edit, not optional**. Returns early after title update.
- `"slide"` messages: `getH2s` is safely skipped (guarded with `typeof getH2s === 'function'` already in `audience.js`); `addSiblings` runs on an in-memory DOM element only (no document access — safe); then the `if (!htmlOutput) return` guard **proposed in Section 4** fires and exits before `htmlOutput.innerHTML`, `markExternalLinks(htmlOutput)`, `saveCurrentState()`, and `updateRender()` are reached. `updateRender()` calls `renderMathInElement` (from `auto-render.js`, not loaded on edit) — the guard ensures it is never called on edit.

---

## 4. Required JavaScript Changes

All changes are backward-compatible unless noted.

### `common.js` — fix `pid` extraction

`common.js` loads on: stage (`/{uname}/{pid}`), audience (`/{uname}/{pid}`), and edit (`/{uname}/{pid}/edit`) — the only URL patterns where it runs.

Current:
```js
const pid = window.location.pathname.split('/').pop();
```
Fix:
```js
const parts = window.location.pathname.split('/').filter(Boolean);
const pid = parts[parts.length - 1] === 'edit'
    ? parts[parts.length - 2]
    : parts[parts.length - 1];
```
`filter(Boolean)` removes empty strings from leading/trailing slashes. No effect on stage or audience pages.

### `handlers.js` — null-guard `getH2s()` call sites

These guards are for `edit.html` only. On stage, `handlers.js` is removed entirely (the script tag is deleted) — the module-scope crash from `onCommit(null, updateMarkdown)` is solved by that removal, not by any guard. The guards below only run on edit where `#markdown-input` exists but `slide-nav.js` is not loaded.

`getH2s()` is defined in `slide-nav.js`, not loaded on `edit.html`. Three call sites:

Inside `updateMarkdown`: `getH2s(dom);`
→ `if (typeof getH2s === 'function') getH2s(dom);`

Inside `syncFromSlides`: `getH2s(d);`
→ `if (typeof getH2s === 'function') getH2s(d);`

At module scope — the existing `if (textInput && textInput.value)` guard is kept; add the inner guard:
```js
if (textInput && textInput.value) {
    if (typeof getH2s === 'function') getH2s(stringToDOM(md.render(textInput.value)));
}
```

Note: `audience.js` already guards its `getH2s` call with `typeof` — no change needed there.
Note: `textInput` is not null on `edit.html` — `#markdown-input` is present there.

### `handlers.js` — null-guard `updateSlide()` call sites

`updateSlide()` is defined in `slide-nav.js`. Two call sites:

Inside `updateMarkdown`: `updateSlide();`
→ `if (typeof updateSlide === 'function') updateSlide();`

Inside `syncFromSlides`: `updateSlide();`
→ `if (typeof updateSlide === 'function') updateSlide();`

`handlers.js` is only loaded on stage and edit pages. `window.presPageMode` is set on both. No undefined fallback needed in `handlers.js`.

### `handlers.js` — fix document title in `applyPresName`

```js
document.title = `${newName} (stage) - SyncSlide`;
```
Replace with:
```js
const mode = window.presPageMode === 'edit' ? 'Edit' : 'Stage';
document.title = `${newName} \u2013 ${mode} - SyncSlide`;
```

### `audience.js` — null-guard `#currentSlide` in `handleUpdate`

```js
const htmlOutput = document.getElementById("currentSlide");
htmlOutput.innerHTML = "";
```
Replace with:
```js
const htmlOutput = document.getElementById("currentSlide");
if (!htmlOutput) return;
htmlOutput.innerHTML = "";
```
`addSiblings` runs before this guard — it operates on an in-memory element only and is safe regardless of `#currentSlide`'s presence.

### `audience.js` — fix document title in `handleUpdate` `"name"` branch

```js
document.title = `${message.data} - SyncSlide`;
```
Replace with:
```js
const mode = window.presPageMode;
document.title = mode === 'stage'
    ? `${message.data} \u2013 Stage - SyncSlide`
    : mode === 'edit'
    ? `${message.data} \u2013 Edit - SyncSlide`
    : `${message.data} - SyncSlide`;
```
The `else` branch preserves existing behaviour on audience pages.

---

## 5. Template Hierarchy Summary

| Template | Extends | Used by | Change |
|---|---|---|---|
| `stage.html` | `audience.html` | Owner, editor, controller | Controller added; handlers.js removed |
| `edit.html` | `nav.html` | Owner, editor | New |
| `audience.html` | `nav.html` | Audience-role viewers | QR block removed |
| `controller.html` | — | Nobody | **Deleted** |

---

## 6. Accessibility

- Both stage and edit pages: H1 has `tabindex="-1"` and receives focus via an inline script. New code on both pages. No deferred script moves focus on page load.
- Breadcrumb is outside `<main>`, before `<main>` in reading order. Existing pattern, unchanged.
- "Opens in new tab": heading link announces "[pres name] (opens in new tab)"; "Edit" menu item announces "Edit [pres name] (opens in new tab)". Satisfies WCAG 2.4.4 (Link Purpose, AA) and 2.4.9 (Link Purpose Link Only, AAA).

---

## 7. Out of Scope

- `recording.js` crash on audience pages (pre-existing bug, unchanged by this spec)
- Audience page breadcrumb trail (currently two items vs three on stage)
- Any changes to the WebSocket protocol
- Splitting `handlers.js` into separate files
- `handleUpdate` crash when a `"slide"` message arrives before any `"text"` message (`TEXT_TO_RENDER` empty → `addSiblings` returns `[]` → `undefined is not iterable`). Pre-existing on all pages; the server sends a `"text"` message before the first `"slide"` message on connect, so this race does not occur in normal operation.
