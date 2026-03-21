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

- `role` on the button: standard `<button>` (no ARIA role override needed)
- The associated menu uses `role="menu"` with `role="menuitem"` children
- Follows the [ARIA APG Menu Button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)

### Keyboard interaction

| Key | Behaviour |
|-----|-----------|
| Enter / Space / ArrowDown | Opens menu, focuses first item |
| ArrowUp | Opens menu, focuses last item |
| ArrowDown / ArrowUp | Moves focus between items (wraps) |
| Escape | Closes menu, returns focus to button |
| Tab | Closes menu, moves focus forward |
| Home / End | Focuses first / last item |

## Menu Items (in order)

1. **Copy link** — copies `/{owner_name}/{id}` to clipboard using the Clipboard API; no dialog
2. **Set password** — opens the existing Set password dialog
3. **Manage co-presenters** — opens the existing Manage co-presenters dialog
4. **Delete [presentation name]** — opens the existing Delete confirmation dialog

## Reading / Tab Sequence per Owned Presentation Item

1. Heading: presentation name link (navigates to stage)
2. Recordings details/summary
3. Actions menu button

Role label ("Shared with you as editor/controller") is not shown for owners, so it does not appear here.

## Changes to Existing Dialogs

- **Set password dialog:** Remove the "Copy link with password" button and its associated JS. The password input, Show/Hide toggle, Set, and Clear password controls remain unchanged.

## What Is Removed

- Standalone "Delete: [name]" button
- Standalone "Manage co-presenters" button
- Standalone "Set password" button
- "Copy link with password" button (inside Set password dialog)
- Copy-link JS block (`[id^="copy-link-"]` handler)

## Accessibility Notes

- The menu button label includes the presentation name so each button is uniquely identified without requiring additional `aria-label` text when multiple presentations are listed.
- "Copy link" uses the Clipboard API (`navigator.clipboard.writeText`). No feedback announcement is strictly required for WCAG conformance, but a brief live-region announcement ("Link copied") is recommended for AAA-level usability.
- Destructive action ("Delete") is last in the menu to reduce accidental activation.
- The existing dialogs (Delete confirmation, Set password, Manage co-presenters) are unchanged in structure and continue to meet WCAG 2.1 AAA requirements.

## Out of Scope

- Copy link with password (removed entirely per user decision)
- Any changes to non-owner (editor/controller) presentation items
- Backend route or data model changes
