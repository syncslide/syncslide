# FAQ Merge: Home Page → Help Page

**Date:** 2026-03-19

## Summary

Move the presenter-facing and recording FAQ questions from the home page into the relevant sections of the help page, converting them to bullet list items to match the existing style. The audience FAQ section stays on the home page.

## Home Page Changes

- Remove the `<h3>For Presenters</h3>` group and its five `<details>` items.
- Remove the `<h3>Recording &amp; Playback</h3>` group and its three `<details>` items.
- Keep the `<section aria-label="Frequently Asked Questions">`, `<h2>FAQ</h2>`, `<h3>For Audiences</h3>`, and the four audience `<details>` items unchanged. The single remaining `<h3>For Audiences</h3>` stays as-is — it is still meaningful as a label for the group, even without sibling subheadings.

## Help Page Changes

### Getting Started
- Merge "How do I create a presentation?" into the existing `/create` bullet: clarify that login is required first. The FAQ's additional detail about landing on the stage after creation is omitted — help.html's next bullet ("You land on the stage…") already covers it.

### Editing Slides
- Extend the existing `## heading` bullet with a link to the CommonMark Markdown reference.
- Add bullet: KaTeX math support — `$...$` inline, `$$...$$` display.
- Add bullet: Live sync — edits are pushed to every connected audience member instantly.
- Add bullet: Autosave — every edit is written to the database as you type.

### Recording
- Extend the existing "Press Record…" bullet with context: the recording captures a timestamped slide log and exports as a WebVTT metadata track paired with a video file.
- Add bullet: Replay navigation — use the slide dropdown to jump to any slide, or press F8 / Shift+F8 to step forward or backward; video position updates to match. (These are the same keys as the live-stage shortcuts in the Keyboard Shortcuts section; this bullet describes their behaviour specifically during recording playback, where the video scrubs to match the selected slide.)
- Add bullet: Dropdown labels show slide title and timestamp (e.g., `Introduction: 12.5s`).

## Non-changes
- Help page `<h1>` stays "Presenter Guide".
- All formatting stays as `<ul><li>` bullet lists — no `<details>` elements added to help.html.
- The "For Audiences" FAQ block on the home page is untouched.
