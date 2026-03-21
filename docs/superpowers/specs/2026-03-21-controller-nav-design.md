# Controller Slide Navigation & Canonical URL Fix

**Date:** 2026-03-21
**Status:** Approved

## Problem

Two related issues:

1. The `controller` role has backend permission to send `Slide` messages over WebSocket, but is served `audience.html` which has no UI to do so. Controllers cannot actually control slides.
2. The `/{uname}/{pid}` route never verifies that `uname` matches the presentation owner. An editor visiting `editor_name/pid` is served the stage with `{{ user.name }}` (the editor) used in the QR URL, producing a non-canonical link.

## Goals

- Give controllers the same slide navigation UI (the `#goTo` select and associated JS) as owners and editors.
- Ensure `/{uname}/{pid}` always resolves to the canonical owner URL before serving any template.
- Keep template and JS responsibilities clearly separated.

## Out of Scope

- Recording controls (controllers cannot send `Text` messages; recording is an owner/editor workflow).
- Changes to how editors or owners interact with the stage.

---

## Section 1: Canonical URL Redirect

In the `/{uname}/{pid}` route handler, after resolving both `pres` and `pres_user`, add an ownership check before `check_access`:

```
if pres.user_id != pres_user.id:
    look up real owner by pres.user_id
    if not found → 500
    redirect 301 to /{owner_name}/{pid}[?pwd=...]
```

The `?pwd=` query param is forwarded so password-protected presentations continue to work after redirect.

After this check, all branches below it can assume `pres_user` is the presentation owner.

The `stage` function is updated to accept and insert `pres_user` into the template context, replacing the current use of `{{ user.name }}` (the logged-in user) in the stage QR URL with `{{ pres_user.name }}`.

## Section 2: Templates

### New: `_slide_nav.html`

A Tera partial containing only the slide navigation control:

```html
<nav aria-label="Slide Navigation">
<label for="goTo">Go to slide:</label>
<select id="goTo" name="goTo"></select>
</nav>
```

### New: `controller.html`

Extends `audience.html`. Fills `{% block stage %}` with the slide nav partial only (no editing tools, no recording). Loads `slide-nav.js` in addition to the scripts inherited from `audience.html`.

```
{% extends "audience.html" %}
{% block title %}{{ pres.name }} (controller){% endblock title %}
{% block js %}{{ super() }}<script defer="defer" src="/js/slide-nav.js"></script>{% endblock js %}
{% block stage %}
{% include "_slide_nav.html" %}
{% endblock stage %}
```

### Updated: `stage.html`

- Replaces the inline `<nav aria-label="Slide Navigation">` block with `{% include "_slide_nav.html" %}`.
- Loads `slide-nav.js` alongside `handlers.js`.

### Updated: Route handler

The `_ =>` (Controller) branch changes from rendering `audience.html` to rendering `controller.html`, with the same context: `pres`, `pres_user`, `initial_slide`.

## Section 3: JavaScript

### New: `slide-nav.js`

Extracted from `handlers.js`. Contains:

- `getH2s(allHtml)` — populates the `#goTo` select with slide titles from parsed HTML
- `updateSlide()` — sends `{"type":"slide","data":n}` over the WebSocket
- An `input` event listener on `#goTo` calling `updateSlide`
- The F8 / Shift+F8 keyboard handler for next/previous slide

This file is loaded by both `stage.html` and `controller.html`.

### Updated: `handlers.js`

Removes the code extracted into `slide-nav.js`. Retains:

- `onCommit(el, fn)` utility
- `updateMarkdown()`
- `syncFromSlides()`, `markdownToSlides()`, `slidesToMarkdown()`
- Slide table rendering and actions
- Slide dialog (add/edit)
- Presentation name input handler

### Updated: `audience.js`

`isStage()` changes from:
```js
return document.getElementById("goTo") !== null
```
to:
```js
return document.getElementById("markdown-input") !== null
```

## Section 4: Testing

### Existing tests to update

- `controller_gets_audience_not_stage` — update assertion: response must contain `#goTo` (slide nav present) and must not contain `#markdown-input` (no editor).

### New tests

| Test | Assertion |
|------|-----------|
| Canonical URL redirect | `GET /editor_name/pid` as editor → 301 to `/owner_name/pid` |
| Canonical URL redirect preserves pwd | `GET /wrong_name/pid?pwd=x` → 301 to `/owner_name/pid?pwd=x` |
| Controller gets slide nav | Controller response HTML contains `id="goTo"` |
| Nonexistent uname still 404s | `GET /nobody/pid` → 404 (existing behaviour confirmed) |
