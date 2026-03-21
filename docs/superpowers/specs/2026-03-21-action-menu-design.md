# Action Menu for Presentation List

**Date:** 2026-03-21
**Status:** Approved

## Summary

Replace the four standalone action buttons (Delete, Manage co-presenters, Set password, and the inline Copy link with password) on the presentations list page with a single ARIA APG Menu Button per owned presentation. Non-owners get no action menu.

## Scope

- Affected template: `syncslide-websocket/templates/presentations.html`
- No backend changes required.

## Menu Button Pattern

Each owned presentation item gets one button:

```
Actions: [presentation name]
```

The button requires the following attributes:

- `aria-haspopup="menu"` — tells screen readers the button opens a menu
- `aria-expanded="false"` when closed, `aria-expanded="true"` when open — communicates menu state
- `aria-controls="actions-menu-{pres.id}"` — references the associated menu element's `id` (optional per APG, but included for broad screen reader compatibility). Each menu element uses `id="actions-menu-{pres.id}"` to ensure uniqueness across multiple presentation items on the page, consistent with the existing id convention in the template (e.g., `delete-pres-{{ pres.id }}`).

The associated menu uses `role="menu"` with `role="menuitem"` children.

Follows the [ARIA APG Menu Button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/).

### Keyboard interaction

#### Keys on the button (menu closed)

| Key | Behaviour |
|-----|-----------|
| Enter / Space | Opens menu, focuses first item |
| ArrowDown | Opens menu, focuses first item (optional per APG, included for usability) |
| ArrowUp | Opens menu, focuses last item (optional per APG, included for usability) |

#### Keys inside the menu (menu open)

| Key | Behaviour |
|-----|-----------|
| ArrowDown | Moves focus to next item (wraps to first) |
| ArrowUp | Moves focus to previous item (wraps to last) |
| Home | Focuses first item |
| End | Focuses last item |
| Enter / Space | Activates focused item, closes menu. For **Copy link**, focus returns to the menu button. For **Set password** and **Delete**, focus moves to the dialog `h1[tabindex="-1"]` heading via the existing `data-open-dialog` handler. For **Manage co-presenters**, focus moves to the first role `<select>` in the co-presenters table (if any rows exist), otherwise to the dialog heading — consistent with the existing handler's priority order (`tbody select` → `h1[tabindex="-1"]` → first `input/select/button`). |
| Escape | Closes menu, returns focus to button |
| Tab | Closes menu (via `focusout`; Tab keydown propagates to the browser and is not intercepted), moves focus forward past button |
| Shift+Tab | Closes menu (via `focusout`; Shift+Tab propagates), moves focus backward before button |

Type-ahead (pressing a character key to jump to the first item starting with that character) is out of scope for this implementation — the menu has at most four fixed items and type-ahead adds implementation complexity for negligible gain.

## Menu Items (in order)

1. **Copy link** — copies `/{owner_name}/{id}` to clipboard; no dialog
2. **Set password** — opens the existing Set password dialog
3. **Manage co-presenters** — opens the existing Manage co-presenters dialog
4. **Delete [presentation name]** — opens the existing Delete confirmation dialog

Destructive action is last to reduce accidental activation.

## Copy Link Behavior

Uses `navigator.clipboard.writeText(url)`.

**Success:** Announces "Link copied" via a dedicated visually-hidden live region (`aria-live="polite"` `aria-atomic="true"`). This is a new element placed outside the presentation list (e.g., at the bottom of the `{% block content %}` block) so it is not re-read on list re-render. It is visually hidden but present in the DOM at all times; its text content is set on copy and cleared after 4000 ms. This delay ensures VoiceOver and NVDA have sufficient time to read the announcement before the region is emptied.

**Failure:** If the Clipboard API is unavailable or permission is denied, announce "Could not copy link" via the same live region, also cleared after 4000 ms. No fallback copy mechanism (`execCommand`) is used — the announcement is sufficient for the user to know they need another method.

## Reading / Tab Sequence per Owned Presentation Item

1. Heading: presentation name link (navigates to stage)
2. Recordings details/summary
3. Actions menu button

Role label ("Shared with you as editor/controller") is not shown for owners, so it does not appear here.

## Changes to Existing Dialogs

- **Set password dialog:** Remove the "Copy link with password" button and its associated JS. The password input, Show/Hide toggle, Set, and Clear password controls remain unchanged.

## Dialog Focus Return

The existing `data-open-dialog` handler returns focus to the opener by querying `[data-open-dialog="<id>"]`. After this refactor, dialogs are opened from `role="menuitem"` elements, not standalone buttons, so that query will return nothing and focus will be dropped.

**Mechanism:** A single `close` event listener per affected dialog is the sole focus-return owner for all exit paths (Cancel/Close button, Escape key, and any programmatic close). The `data-close-dialog` handler is updated to only call `dialog.close()` — it no longer handles focus itself.

**Affected dialogs** (only these three; recording-delete dialogs are not affected):
- `delete-pres-{id}`
- `manage-access-{id}`
- `set-pwd-{id}`

**Menu item JS** (before calling `dialog.showModal()`): set `dialog.dataset.returnFocus = menuButtonId`, where `menuButtonId` is the `id` of the `Actions: [name]` button that opened the menu.

**`close` event listener** (registered once per dialog at page load, not on first activation):
```js
dialog.addEventListener('close', function () {
    var returnId = dialog.dataset.returnFocus;
    var ret = returnId
        ? document.getElementById(returnId)
        : document.querySelector('[data-open-dialog="' + dialog.id + '"]');
    delete dialog.dataset.returnFocus;
    if (ret) ret.focus();
});
```
Clearing `data-return-focus` after use ensures correct focus return if a dialog is later opened from a non-menu path.

**`data-close-dialog` handler** — updated to remove its own focus-return logic; it now only calls `dialog.close()`. The `close` event listener handles focus for all exit paths.

## What Is Removed

- Standalone "Delete: [name]" button
- Standalone "Manage co-presenters" button
- Standalone "Set password" button
- "Copy link with password" button (inside Set password dialog)
- Copy-link JS block (`[id^="copy-link-"]` handler)

## Accessibility Notes

- `aria-haspopup="menu"` and `aria-expanded` on the button are required for screen readers to announce the control correctly.
- The menu button label includes the presentation name so each button is uniquely identified across the list without additional `aria-label` overrides.
- A dedicated `aria-live="polite"` `aria-atomic="true"` visually-hidden element outside the list handles Copy link feedback (both success and failure).
- Destructive action (Delete) is last in the menu to reduce accidental activation.
- The existing dialogs (Delete confirmation, Set password, Manage co-presenters) are unchanged in structure. Focus return on Cancel/Close and on native Escape key is handled via the `data-return-focus` mechanism described in the Dialog Focus Return section above.
- **Mobile screen readers:** The `role="menu"` / `role="menuitem"` pattern is supported on iOS VoiceOver and Android TalkBack (confirmed in PowerMapper compatibility tables). Interaction on mobile is swipe-based rather than arrow-key-based; the keyboard contract above applies to desktop only. No known gaps for the four-item menu in this implementation.

## Out of Scope

- Copy link with password (removed entirely per user decision)
- Any changes to non-owner (editor/controller) presentation items
- Backend route or data model changes
- Type-ahead navigation inside the menu
