# Nav Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the site header to add a skip link, fix Primary nav tab order, and move account links into a dedicated Account `<nav>` with a `<details>`/`<summary>` disclosure submenu.

**Architecture:** The skip link and `<main id="main" tabindex="-1">` move into `base.html`, making them present on every page automatically. Individual templates lose their own `<main>` wrappers. The Account nav (`<details>`/`<summary>`, no JS) is added to `nav.html` for logged-in users only.

**Tech Stack:** Tera HTML templates, plain CSS, Playwright (tests against deployed VPS at localhost:5003)

---

## File Map

| File | Change |
|------|--------|
| `tests/nav.spec.js` | New — nav structure tests |
| `tests/auth.spec.js` | Modify — fix logout test to open Account submenu first |
| `syncslide-websocket/css/style.css` | Add `.skip-link` utility class |
| `syncslide-websocket/templates/base.html` | Add skip link anchor; wrap `{% block content %}` in `<main id="main" tabindex="-1">` |
| `syncslide-websocket/templates/nav.html` | Reorder Primary nav links; add Account `<nav>` with `<details>` submenu |
| `syncslide-websocket/templates/index.html` | Remove `<main>`/`</main>` |
| `syncslide-websocket/templates/help.html` | Remove `<main>`/`</main>` |
| `syncslide-websocket/templates/create.html` | Remove `<main>`/`</main>` |
| `syncslide-websocket/templates/join.html` | Remove `<main>`/`</main>` |
| `syncslide-websocket/templates/login.html` | Remove `<main>`/`</main>` |
| `syncslide-websocket/templates/presentations.html` | Remove `<main>`/`</main>` and spurious `</body></html>` |
| `syncslide-websocket/templates/user/change_pwd.html` | Remove `<main>`/`</main>` |
| `syncslide-websocket/templates/user/add_user.html` | Remove `<main>`/`</main>` |
| `syncslide-websocket/templates/audience.html` | Remove `<main>`/`</main>` |
| `syncslide-websocket/templates/recording.html` | Remove `<main>`/`</main>` |

---

### Task 1: Write failing nav tests

**Files:**
- Create: `tests/nav.spec.js`

- [ ] **Step 1: Write `tests/nav.spec.js`**

```js
// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// -- Skip link --
test('skip link is first link in body and targets #main', async ({ page }) => {
    await page.goto('/');
    const skipLink = page.locator('body > a.skip-link').first();
    await expect(skipLink).toHaveAttribute('href', '#main');
});

test('#main has tabindex="-1" for reliable skip link focus', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#main')).toHaveAttribute('tabindex', '-1');
});

// -- Primary nav: logged-out --
test('primary nav link order when logged out', async ({ page }) => {
    await page.goto('/');
    const links = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link');
    const texts = await links.allTextContents();
    expect(texts).toEqual(['Home', 'Join presentation', 'Help', 'Login']);
});

// -- Primary nav: logged-in --
test('primary nav has correct links when logged in', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const links = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link');
    const texts = await links.allTextContents();
    expect(texts[0]).toBe('Home');
    expect(texts[1]).toBe('Join presentation');
    expect(texts[2]).toBe('Help');
    expect(texts[3]).toBe('Create presentation');
    // Presentations link includes pres count: "Presentations (N)"
    expect(texts[4]).toMatch(/^Presentations \(\d+\)$/);
    // Account-only links must not appear in Primary nav
    expect(texts).not.toContain('Login');
    expect(texts).not.toContain('Logout');
    expect(texts).not.toContain('Change Password');
});

// -- Account nav: logged-in --
test('account nav exists with username as disclosure trigger', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await expect(accountNav).toBeVisible();
    await expect(accountNav.locator('summary')).toContainText('admin');
});

test('account submenu reveals Change Password and Logout when opened', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await accountNav.locator('summary').click();
    await expect(accountNav.getByRole('link', { name: 'Change Password' })).toBeVisible();
    await expect(accountNav.getByRole('link', { name: 'Logout' })).toBeVisible();
});

test('account submenu reveals Add User link for admin users', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const accountNav = page.getByRole('navigation', { name: 'Account' });
    await accountNav.locator('summary').click();
    await expect(accountNav.getByRole('link', { name: 'Add User' })).toBeVisible();
});

// -- Account nav: logged-out --
test('no Account nav when logged out', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Account' })).toHaveCount(0);
});

// -- DOM order: theme toggle comes after nav elements --
test('theme toggle appears after Account nav in header DOM order (logged-in)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/');
    const isAfter = await page.evaluate(() => {
        const header = document.querySelector('header');
        const accountNav = header.querySelector('nav[aria-label="Account"]');
        const toggle = header.querySelector('#theme-toggle');
        if (!accountNav || !toggle) return false;
        // DOCUMENT_POSITION_FOLLOWING means toggle comes after accountNav
        return !!(accountNav.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(isAfter).toBe(true);
});

test('theme toggle appears after Primary nav in header DOM order (logged-out)', async ({ page }) => {
    await page.goto('/');
    const isAfter = await page.evaluate(() => {
        const header = document.querySelector('header');
        const primaryNav = header.querySelector('nav[aria-label="Primary navigation"]');
        const toggle = header.querySelector('#theme-toggle');
        if (!primaryNav || !toggle) return false;
        return !!(primaryNav.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(isAfter).toBe(true);
});
```

- [ ] **Step 2: Commit the failing test file**

```bash
git add tests/nav.spec.js
git commit -m "test(nav): add failing nav structure tests"
```

- [ ] **Step 3: Deploy and run tests to confirm they all fail**

```bash
config/update.bat
cd tests && npx playwright test nav.spec.js --reporter=line
```

Expected: all 10 tests FAIL (elements not found yet)

---

### Task 2: Add `.skip-link` CSS

**Files:**
- Modify: `syncslide-websocket/css/style.css`

- [ ] **Step 1: Add `.skip-link` class after the `body` rule**

In `css/style.css`, after the `body { ... }` line, add:

```css
.skip-link { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.skip-link:focus { position: static; width: auto; height: auto; margin: 0; overflow: visible; clip: auto; white-space: normal; }
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/css/style.css
git commit -m "feat(css): add .skip-link visually-hidden utility class"
```

---

### Task 3: Update `base.html` — skip link and `<main>` wrapper

**Files:**
- Modify: `syncslide-websocket/templates/base.html`

Current content:
```html
</head><body>
<header>{% block nav %}{% endblock nav %}</header>
{% block breadcrumb %}{% endblock breadcrumb %}
{% block content %}{% endblock content %}
{% block footer %}{% endblock footer %}
</body></html>
```

- [ ] **Step 1: Add skip link before `<header>` and wrap content block in `<main>`**

Replace the body section with:

```html
</head><body>
<a class="skip-link" href="#main">Skip to main content</a>
<header>{% block nav %}{% endblock nav %}</header>
{% block breadcrumb %}{% endblock breadcrumb %}
<main id="main" tabindex="-1">{% block content %}{% endblock content %}</main>
{% block footer %}{% endblock footer %}
</body></html>
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/templates/base.html
git commit -m "feat(base): add skip link and main#main wrapper to base template"
```

---

### Task 4: Update `nav.html` — reorder links and add Account nav

**Files:**
- Modify: `syncslide-websocket/templates/nav.html`

Current nav block has wrong order (Home, Help, then auth, then Join) and mixes account links into Primary nav.

- [ ] **Step 1: Replace the `{% block nav %}` content in `nav.html`**

Replace from `{% block nav %}` to `{% endblock nav %}` (lines 2–22) with:

```html
{% block nav %}
<nav aria-label="Primary navigation">
<ul class="clear-list">
<li><a href="/">Home</a></li>
<li><a href="/join">Join presentation</a></li>
<li><a href="/help">Help</a></li>
{% if user %}
<li><a href="/create">Create presentation</a></li>
<li><a href="/user/presentations">Presentations ({{ pres_num }})</a></li>
{% else %}
<li><a href="/auth/login">Login</a></li>
{% endif %}
</ul>
</nav>
{% if user %}
<nav aria-label="Account">
<details>
<summary>{{ user.name }}</summary>
<ul>
<li><a href="/user/change_pwd">Change Password</a></li>
{% if 'admin' in groups %}
<li><a href="/user/new">Add User</a></li>
{% endif %}
<li><a href="/auth/logout">Logout</a></li>
</ul>
</details>
</nav>
{% endif %}
<button type="button" id="theme-toggle" aria-pressed="false">Dark mode</button>
{% endblock nav %}
```

- [ ] **Step 2: Verify `pres_num` is passed by all route handlers**

`{{ pres_num }}` is already used in the existing `nav.html`, so every route that renders a template inheriting from `nav.html` must already supply it. However, confirm this is the case by grepping `main.rs` for `pres_num` and checking that all route handlers that can serve a logged-in user include it in their template context.

Run:
```bash
grep -n "pres_num" syncslide-websocket/src/main.rs
```

Every route that renders a template while the user is logged in (i.e., uses `nav.html` and could have an active session) must appear in the results. If any route is missing `pres_num`, add it to that route's template context before continuing.

- [ ] **Step 3: Commit**

```bash
git add syncslide-websocket/templates/nav.html
git commit -m "feat(nav): reorder primary nav, add Account nav with details submenu"
```

---

### Task 5: Remove `<main>` from simple templates

These templates each have `<main>` and `</main>` wrapping their content block — remove both tags. The base template now provides the `<main>`.

**Files:**
- Modify: `syncslide-websocket/templates/index.html`
- Modify: `syncslide-websocket/templates/help.html`
- Modify: `syncslide-websocket/templates/create.html`
- Modify: `syncslide-websocket/templates/join.html`
- Modify: `syncslide-websocket/templates/login.html`
- Modify: `syncslide-websocket/templates/user/change_pwd.html`
- Modify: `syncslide-websocket/templates/user/add_user.html`

- [ ] **Step 1: `index.html` — remove `<main>` (line 6) and `</main>` (line 86)**

Remove `<main>` from after `{% block content %}`, and `</main>` from before `{% endblock content %}`.

Result: content starts directly with `<h1 id="syncSlide">SyncSlide</h1>` and ends with `</section>`.

- [ ] **Step 2: `help.html` — remove `<main>` (line 6) and `</main>` (line 45)**

- [ ] **Step 3: `create.html` — remove `<main>` (line 9) and `</main>` (line 16)**

- [ ] **Step 4: `join.html` — remove `<main>` (line 10) and `</main>` (line 19)**

- [ ] **Step 5: `login.html` — remove `<main>` (line 6) and `</main>` (line 16)**

- [ ] **Step 6: `user/change_pwd.html` — remove `<main>` (line 6) and `</main>` (line 18)**

- [ ] **Step 7: `user/add_user.html` — remove `<main>` (line 6) and `</main>` (line 15)**

- [ ] **Step 8: Commit all removals together**

```bash
git add \
  syncslide-websocket/templates/index.html \
  syncslide-websocket/templates/help.html \
  syncslide-websocket/templates/create.html \
  syncslide-websocket/templates/join.html \
  syncslide-websocket/templates/login.html \
  syncslide-websocket/templates/user/change_pwd.html \
  syncslide-websocket/templates/user/add_user.html
git commit -m "refactor(templates): remove <main> wrappers now provided by base.html"
```

---

### Task 6: Fix `presentations.html`

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html`

This template has `<main>` at line 6 and `</main>` at line 173, plus a spurious `</body></html>` at line 174 that must also be removed.

- [ ] **Step 1: Remove `<main>` (line 6), `</main>` (line 173), and `</body></html>` (line 174)**

The template should end with:
```html
{% endif %}
{% endblock content %}
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/templates/presentations.html
git commit -m "refactor(presentations): remove <main> wrapper and spurious </body></html>"
```

---

### Task 7: Fix `audience.html`

**Files:**
- Modify: `syncslide-websocket/templates/audience.html`

Current structure (lines 16–28):
```html
{% block content %}
{% block stage %}{% endblock stage %}
{% if pres_user %}
<button ...>QR</button>
<aside ...>...</aside>
{% endif %}
{% if pres %}<span id="pres-name" hidden>{{ pres.name }}</span>{% endif %}
<main>
<section aria-live="polite" id="currentSlide">...</section>
</main>
{% endblock content %}
```

After: `<main>` and `</main>` are removed. The QR button, aside, and currentSlide section all end up flat inside base's `<main id="main">`. This is acceptable — all are presentation content.

- [ ] **Step 1: Remove `<main>` and `</main>` from `audience.html`**

Remove `<main>` (line 25) and `</main>` (line 27), leaving:
```html
{% block content %}
{% block stage %}{% endblock stage %}
{% if pres_user %}
<button type="button" id="qrToggle" aria-pressed="false" aria-controls="qrOverlay">QR</button>
<aside id="qrOverlay" hidden aria-label="QR code">
<a href="/{{ pres_user.name }}/{{ pres.id }}"><img src="/qr/{{ pres_user.name }}/{{ pres.id }}" alt="{{ pres.name }} QR code" width="150" height="150"></a>
</aside>
{% endif %}
{% if pres %}<span id="pres-name" hidden>{{ pres.name }}</span>{% endif %}
<section aria-live="polite" id="currentSlide">{% if initial_slide %}{{ initial_slide | safe }}{% endif %}</section>
{% endblock content %}
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/templates/audience.html
git commit -m "refactor(audience): remove <main> wrapper now provided by base.html"
```

---

### Task 8: Fix `recording.html`

**Files:**
- Modify: `syncslide-websocket/templates/recording.html`

The `<main>` wrapper (line 47) and `</main>` are not shown explicitly in the template end — the template block ends at `{% endblock content %}` (line 79) without a closing `</main>`. Let me clarify:

Looking at recording.html, `<main>` appears at line 47 and is not explicitly closed before `{% endblock content %}` at line 79. That means it's unclosed, and the browser auto-closes it. After base.html wraps everything in `<main id="main">`, this would create a `<main>` nested inside another `<main>` — invalid HTML.

Remove the `<main>` opening tag (line 47). No corresponding `</main>` to remove.

- [ ] **Step 1: Remove `<main>` (line 47) from `recording.html`**

The section that reads:
```html
<main>
<section aria-live="polite" id="currentSlide"></section>
```

Becomes:
```html
<section aria-live="polite" id="currentSlide"></section>
```

- [ ] **Step 2: Commit**

```bash
git add syncslide-websocket/templates/recording.html
git commit -m "refactor(recording): remove unclosed <main> now provided by base.html"
```

---

### Task 9: Fix `auth.spec.js` — logout test broken by Account submenu

**Files:**
- Modify: `tests/auth.spec.js`

The logout test currently does `page.click('nav a[href="/auth/logout"]')`. After this nav change, the logout link is inside a collapsed `<details>` — Playwright requires elements to be visible before clicking. The test will fail with a "not visible" error.

Fix: open the Account nav `<details>` before clicking logout.

- [ ] **Step 1: Update the two logout tests in `auth.spec.js`**

Find this in `auth.spec.js` (appears twice, lines 49 and 59):
```js
await page.click('nav a[href="/auth/logout"]');
```

Replace both occurrences with:
```js
await page.locator('nav[aria-label="Account"] summary').click();
await page.locator('nav[aria-label="Account"] a[href="/auth/logout"]').click();
```

- [ ] **Step 2: Commit**

```bash
git add tests/auth.spec.js
git commit -m "fix(auth-tests): open Account submenu before clicking logout link"
```

---

### Task 10: Deploy, run all tests, verify

- [ ] **Step 1: Deploy to VPS**

```bash
config/update.bat
```

- [ ] **Step 2: Run the full test suite**

```bash
cd tests && npx playwright test --reporter=line
```

Expected: all tests pass (41 existing + 10 new = 51 tests)

- [ ] **Step 3: If any test fails, read the error output carefully**

Common failure modes:
- **"locator not found"**: check template was saved and deployed correctly
- **"not visible"**: a `<details>` may need opening first — check if a test is trying to click a link inside collapsed details
- **axe violation**: check the HTML structure rendered in browser devtools — likely a duplicate landmark or missing label

- [ ] **Step 4: On all-pass, commit nothing (all commits already done per task)**

Done.
