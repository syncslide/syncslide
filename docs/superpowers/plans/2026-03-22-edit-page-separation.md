# Edit Page Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the stage page into dedicated stage and edit pages, opening both in new browser tabs from the presentations list.

**Architecture:** A new `GET /{uname}/{pid}/edit` route serves `edit.html` (owner and editor only). Stage loses its editing controls. JS files gain null-guards and page-mode awareness so they work safely on both pages. The presentations list gains a heading link that opens stage in a new tab and a new Edit menu item for owners/editors.

**Tech Stack:** Rust (Axum 0.8, SQLx, Tera), vanilla JS, Playwright tests, axum-test for Rust unit tests.

---

## Deployment notes (read before starting)

- **Never build or run locally.** All builds happen on VPS: `arch@clippycat.ca`.
- Deploy via `config/update.bat` (pull → build → reload Caddy → restart service).
- Playwright tests run against port 5003 on the VPS. Run with `npx playwright test --config tests/playwright.config.js` from the VPS.
- Rust tests: `cd syncslide-websocket && cargo test` on VPS.
- After any SQL query change: `cd syncslide-websocket && DATABASE_URL=sqlite://db.sqlite3 cargo sqlx prepare -- --all-targets` on VPS, then commit the updated `.sqlx/` cache.

---

## File map

| File | Change |
|---|---|
| `syncslide-websocket/js/common.js` | Fix `pid` extraction to handle `/edit` suffix |
| `syncslide-websocket/js/handlers.js` | Null-guard `getH2s()` ×3, `updateSlide()` ×2; fix `applyPresName` title format |
| `syncslide-websocket/js/audience.js` | Null-guard `#currentSlide` in `handleUpdate`; fix title in `"name"` branch |
| `syncslide-websocket/templates/stage.html` | Remove Edit Slides section + `handlers.js` tag; add H1, page mode var, inline focus script; update title format |
| `syncslide-websocket/templates/audience.html` | Remove `{% if pres_user %}` QR block (lines 18–23) |
| `syncslide-websocket/templates/edit.html` | **New file** |
| `syncslide-websocket/templates/controller.html` | **Deleted** |
| `syncslide-websocket/templates/presentations.html` | Add `target="_blank"` to heading link; restructure actions block to include editors; add Edit menu item + JS handler |
| `syncslide-websocket/src/main.rs` | New `edit_pres` handler + route; change controller arm to use stage; expand `add_recording` permissions; update Rust test |
| `tests/presentations.spec.js` | New tests: heading opens new tab, editor sees actions, Edit menu item works |

---

## Task 1: Fix `pid` extraction in `common.js`

`common.js` currently uses `.split('/').pop()` which returns `"edit"` on the edit page URL `/{uname}/{pid}/edit`.

**Files:**
- Modify: `syncslide-websocket/js/common.js:1`

- [ ] **Step 1: Open `common.js` and replace line 1**

  Old:
  ```js
  const pid = window.location.pathname.split('/').pop();
  ```
  New:
  ```js
  const parts = window.location.pathname.split('/').filter(Boolean);
  const pid = parts[parts.length - 1] === 'edit'
      ? parts[parts.length - 2]
      : parts[parts.length - 1];
  ```

- [ ] **Step 2: Commit**
  ```bash
  git add syncslide-websocket/js/common.js
  git commit -m "fix: extract pid correctly on /edit URL in common.js"
  ```

---

## Task 2: Patch `handlers.js` — null-guards and title fix

`handlers.js` calls `getH2s()` and `updateSlide()` (both defined in `slide-nav.js`) without guarding, and uses a hardcoded `"(stage)"` format in the title. All three issues must be fixed so the file works safely when loaded on the edit page (where `slide-nav.js` is absent).

**Files:**
- Modify: `syncslide-websocket/js/handlers.js`

- [ ] **Step 1: Guard `getH2s(dom)` inside `updateMarkdown` (line 11)**

  Old:
  ```js
  	getH2s(dom);
  	socket.send(JSON.stringify({ type: "text", data: markdownInput }));
  	updateSlide();
  ```
  New:
  ```js
  	if (typeof getH2s === 'function') getH2s(dom);
  	socket.send(JSON.stringify({ type: "text", data: markdownInput }));
  	if (typeof updateSlide === 'function') updateSlide();
  ```

- [ ] **Step 2: Guard `getH2s(d)` and `updateSlide()` inside `syncFromSlides` (lines 55–57)**

  Old:
  ```js
  	getH2s(d);
  	socket.send(JSON.stringify({ type: "text", data: markdown }));
  	updateSlide();
  ```
  New:
  ```js
  	if (typeof getH2s === 'function') getH2s(d);
  	socket.send(JSON.stringify({ type: "text", data: markdown }));
  	if (typeof updateSlide === 'function') updateSlide();
  ```

- [ ] **Step 3: Guard the module-scope `getH2s` call (lines 113–115)**

  Old:
  ```js
  if (textInput && textInput.value) {
  	getH2s(stringToDOM(md.render(textInput.value)));
  }
  ```
  New:
  ```js
  if (textInput && textInput.value) {
  	if (typeof getH2s === 'function') getH2s(stringToDOM(md.render(textInput.value)));
  }
  ```

- [ ] **Step 4: Fix `applyPresName` title format (line 121)**

  Old:
  ```js
  		document.title = `${newName} (stage) - SyncSlide`;
  ```
  New:
  ```js
  		const mode = window.presPageMode === 'edit' ? 'Edit' : 'Stage';
  		document.title = `${newName} \u2013 ${mode} - SyncSlide`;
  ```

- [ ] **Step 5: Commit**
  ```bash
  git add syncslide-websocket/js/handlers.js
  git commit -m "fix: null-guard slide-nav calls and fix title format in handlers.js"
  ```

---

## Task 3: Patch `audience.js` — null-guard and title fix

`audience.js` directly accesses `#currentSlide` without checking for null (crashes on edit page) and uses a plain title format in the `"name"` handler.

**Files:**
- Modify: `syncslide-websocket/js/audience.js`

- [ ] **Step 1: Add null-guard for `#currentSlide` in `handleUpdate` (line 41)**

  Old:
  ```js
  	const htmlOutput = document.getElementById("currentSlide");
  	htmlOutput.innerHTML = "";
  ```
  New:
  ```js
  	const htmlOutput = document.getElementById("currentSlide");
  	if (!htmlOutput) return;
  	htmlOutput.innerHTML = "";
  ```

- [ ] **Step 2: Fix title format in the `"name"` branch (line 31)**

  Old:
  ```js
  		document.title = `${message.data} - SyncSlide`;
  ```
  New:
  ```js
  		const mode = window.presPageMode;
  		document.title = mode === 'stage'
  		    ? `${message.data} \u2013 Stage - SyncSlide`
  		    : mode === 'edit'
  		    ? `${message.data} \u2013 Edit - SyncSlide`
  		    : `${message.data} - SyncSlide`;
  ```

- [ ] **Step 3: Commit**
  ```bash
  git add syncslide-websocket/js/audience.js
  git commit -m "fix: null-guard currentSlide and fix title format in audience.js"
  ```

---

## Task 4: Update `stage.html`

Remove the editing section and `handlers.js` script tag. Add an H1 heading, inline focus script, `window.presPageMode = 'stage'`, and update the title format. The QR toggle and Record section stay. Breadcrumb is already correct.

**Files:**
- Modify: `syncslide-websocket/templates/stage.html`

- [ ] **Step 1: Replace the entire file**

  New content:
  ```html
  {% extends "audience.html" %}
  {% block title %}{{ pres.name }} – Stage{% endblock title %}
  {% block js %}<script>window.presPageMode = 'stage';</script>{{ super() }}<script defer="defer" src="/js/slide-nav.js"></script>{% endblock js %}
  {% block breadcrumb %}<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/user/presentations">Your Presentations</a></li><li aria-current="page">{{ pres.name }}</li></ol></nav>{% endblock breadcrumb %}

  {% block stage %}
  <h1 id="stage-heading" tabindex="-1">{{ pres.name }}</h1>
  <button type="button" id="qrToggle" aria-pressed="false" aria-controls="qrOverlay">QR</button>
  <aside id="qrOverlay" hidden aria-label="QR code">
  <a href="/{{ pres_user.name }}/{{ pres.id }}"><img src="/qr/{{ pres_user.name }}/{{ pres.id }}" alt="{{ pres.name }} QR code" width="150" height="150"></a>
  </aside>
  <details>
  <summary><h2 id="record">Record</h2></summary>
  <section aria-labelledby="record">
  <button id="recordPause">Record</button>
  <button id="stop">Stop</button>
  <p id="timer">00:00:00</p>
  </section>
  </details>
  {% include "_slide_nav.html" %}
  <dialog id="saveRecordingDialog" aria-labelledby="save-recording-heading">
  <h1 id="save-recording-heading">Save Recording</h1>
  <form id="saveRecordingForm" method="post" action="/user/presentations/{{ pres.id }}/recordings" enctype="multipart/form-data">
  <input type="hidden" name="slides" id="slidesData">
  <label>Name: <input type="text" name="name" required></label>
  <label>Video (optional): <input type="file" name="video" accept="video/*"></label>
  <label>Captions VTT (optional): <input type="file" name="captions" accept=".vtt,text/vtt"></label>
  <button type="submit">Save</button>
  <button type="button" id="cancelSaveRecording">Cancel</button>
  </form>
  </dialog>
  <script>document.getElementById('stage-heading').focus();</script>
  {% endblock stage %}
  ```

  Note: The `–` in the title block is a literal en-dash (U+2013). Tera is not JavaScript and does not interpret `\u2013`. The character must be entered directly.

- [ ] **Step 2: Add a Playwright test verifying the editing section is gone**

  Add to `tests/accessibility.spec.js` (or `tests/presentations.spec.js`), inside a logged-in describe block:

  ```js
  test('stage page does not contain the markdown editor', async ({ page }) => {
      await page.goto('/admin/1');
      await expect(page.locator('#markdown-input')).not.toBeAttached();
  });
  ```

  This test will fail until the stage.html change is deployed. Run it after the full deploy in Task 12.

- [ ] **Step 3: Commit**
  ```bash
  git add syncslide-websocket/templates/stage.html
  git commit -m "feat: remove editing section from stage; add H1 focus and page mode var"
  ```

---

## Task 5: Remove duplicate QR block from `audience.html`

The `{% if pres_user %}` QR block in `audience.html` was originally added so authenticated users on stage could see the QR. Stage now includes its own QR block inside `{% block stage %}`, so this block is redundant and must be removed to prevent audience viewers from seeing a QR button.

**Files:**
- Modify: `syncslide-websocket/templates/audience.html:18-23`

- [ ] **Step 1: Remove the QR block from `audience.html`**

  Remove these lines (18–23):
  ```html
  {% if pres_user %}
  <button type="button" id="qrToggle" aria-pressed="false" aria-controls="qrOverlay">QR</button>
  <aside id="qrOverlay" hidden aria-label="QR code">
  <a href="/{{ pres_user.name }}/{{ pres.id }}"><img src="/qr/{{ pres_user.name }}/{{ pres.id }}" alt="{{ pres.name }} QR code" width="150" height="150"></a>
  </aside>
  {% endif %}
  ```

  The `{% block content %}` section should now read:
  ```html
  {% block content %}
  {% block stage %}{% endblock stage %}
  {% if pres %}<span id="pres-name" hidden>{{ pres.name }}</span>{% endif %}
  <section aria-live="polite" id="currentSlide">{% if initial_slide %}{{ initial_slide | safe }}{% endif %}</section>
  {% endblock content %}
  ```

- [ ] **Step 2: Commit**
  ```bash
  git add syncslide-websocket/templates/audience.html
  git commit -m "fix: remove redundant QR block from audience.html"
  ```

---

## Task 6: Create `edit.html`

New template extending `nav.html`. Contains all the editing controls that were removed from stage, as top-level visible sections rather than `<details>` wrappers. Loads `handlers.js` but not `slide-nav.js`, `recording.js`, or KaTeX.

**Files:**
- Create: `syncslide-websocket/templates/edit.html`

- [ ] **Step 1: Create the file**

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
  <dialog id="slideDialog" aria-labelledby="slideDialogHeading">
  <button type="button" id="slideDialogCancel">Cancel</button>
  <h1 id="slideDialogHeading"></h1>
  <fieldset id="slideDialogPosition">
  <legend>Position</legend>
  <label><input type="radio" name="insertPos" value="before"> Before</label>
  <label><input type="radio" name="insertPos" value="after" checked> After</label>
  </fieldset>
  <label id="slideDialogRefLabel">Slide: <select id="insertRefSlide"></select></label>
  <label>Title: <input type="text" id="insertTitle"></label><br>
  <label>Content (Markdown):<br><textarea id="insertBody" rows="6" style="width:100%"></textarea></label><br>
  <button type="button" id="slideDialogApply"></button>
  </dialog>
  <script>document.getElementById('edit-heading').focus();</script>
  {% endblock content %}
  ```

  Note: `–` is a literal en-dash in the `{% block title %}`.

- [ ] **Step 2: Commit**
  ```bash
  git add syncslide-websocket/templates/edit.html
  git commit -m "feat: add edit.html template for dedicated edit page"
  ```

---

## Task 7: Update `presentations.html`

Three changes: (1) heading link opens in new tab, (2) actions block shown to editor as well as owner, (3) new Edit menu item + JS handler.

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html`

- [ ] **Step 1: Add `target="_blank"` and sr-only span to heading link (line 43)**

  Old:
  ```html
  		<h2><a class="stage-link" href="/{{ pres.owner_name }}/{{ pres.id }}" data-pres-id="{{ pres.id }}">{{ pres.name }}</a></h2>
  ```
  New:
  ```html
  		<h2><a class="stage-link" href="/{{ pres.owner_name }}/{{ pres.id }}" data-pres-id="{{ pres.id }}" target="_blank">{{ pres.name }}<svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12" style="margin-left:0.25em"><path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M8 1h3v3M11 1L5 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg> <span class="sr-only">(opens in new tab)</span></a></h2>
  ```

  The space before `<span class="sr-only">` is a text node outside the span. This ensures the screen reader announces "Name [space](opens in new tab)" rather than "Name(opens in new tab)". The span's exact text content is `(opens in new tab)` with no leading space, matching the spec.

- [ ] **Step 2: Expand the owner-only actions guard to include editors**

  The actions button and menu (not the dialogs) must be visible to editors. Find the outer `{% if pres.role == "owner" %}` guard (line 75) and restructure:

  Old structure:
  ```html
  		{% if pres.role == "owner" %}
  		<dialog id="delete-pres-{{ pres.id }}" ...>...</dialog>
  		<dialog id="manage-access-{{ pres.id }}" ...>...</dialog>
  		<button type="button" id="actions-btn-{{ pres.id }}" ...>Actions: {{ pres.name }}</button>
  		<ul role="menu" id="actions-menu-{{ pres.id }}" hidden>
  			<li ... data-action="copy-link" ...>Copy link</li>
  			<li ... data-action="open-dialog" data-dialog-id="manage-access-{{ pres.id }}" ...>Manage access</li>
  			<li ... data-action="open-dialog" data-dialog-id="delete-pres-{{ pres.id }}" ...>Delete {{ pres.name }}</li>
  		</ul>
  		{% endif %}
  ```

  New structure (owner-only dialogs stay inside the `{% if pres.role == "owner" %}` block; button and menu move outside):
  ```html
  		{% if pres.role == "owner" %}
  		<dialog id="delete-pres-{{ pres.id }}" aria-labelledby="delete-pres-heading-{{ pres.id }}">
  			<h1 id="delete-pres-heading-{{ pres.id }}" tabindex="-1">Delete {{ pres.name }}?</h1>
  			<p>This will permanently delete the presentation and all its recordings.</p>
  			<form method="post" action="/user/presentations/{{ pres.id }}/delete">
  				<button type="submit">Delete</button>
  			</form>
  			<button type="button" data-close-dialog="delete-pres-{{ pres.id }}">Cancel</button>
  		</dialog>
  		<dialog id="manage-access-{{ pres.id }}"
  		        aria-labelledby="manage-access-heading-{{ pres.id }}"
  		        data-focus-heading="true"
  		        data-owner-username="{{ user.name }}"
  		        data-pres-id="{{ pres.id }}">
  			<div class="manage-access-main">
  				<h1 id="manage-access-heading-{{ pres.id }}" tabindex="-1">Manage access for {{ pres.name }}</h1>
  				<label for="visibility-select-{{ pres.id }}">Visibility</label>
  				<select id="visibility-select-{{ pres.id }}"
  				        class="visibility-select"
  				        data-original-visibility="{{ pres.access_mode }}">
  				    <option value="public"{% if pres.access_mode == "public" %} selected{% endif %}>Public — anyone with the link</option>
  				    <option value="audience"{% if pres.access_mode == "audience" %} selected{% endif %}>Shared — specific people</option>
  				    <option value="private"{% if pres.access_mode == "private" %} selected{% endif %}>Private — presenters only</option>
  				</select>
  				<table>
  					<caption>Access</caption>
  					<thead><tr><th scope="col">Username</th><th scope="col">Role</th></tr></thead>
  					<tbody>
  					{% for entry in pres.access %}
  					<tr>
  						<td data-username="{{ entry.username }}">{{ entry.username }}</td>
  						<td>
  							<select aria-label="Role for {{ entry.username }}"
  							        data-original-role="{{ entry.role }}"
  							        data-user-id="{{ entry.user_id }}">
  								<option value="editor"{% if entry.role == "editor" %} selected{% endif %}>Editor</option>
  								<option value="controller"{% if entry.role == "controller" %} selected{% endif %}>Controller</option>
  								<option value="audience"{% if entry.role == "audience" %} selected{% endif %}>Audience</option>
  								<option value="remove">Remove</option>
  							</select>
  						</td>
  					</tr>
  					{% endfor %}
  					</tbody>
  					<tbody class="new-rows-tbody"></tbody>
  					<tfoot>
  					<tr>
  						<td colspan="2"><button type="button" class="add-copres-btn">Add person</button></td>
  					</tr>
  					</tfoot>
  				</table>
  				<button type="button" class="manage-access-close">Close</button>
  			</div>
  			<div class="unsaved-confirm" hidden>
  				<h1 id="unsaved-confirm-heading-{{ pres.id }}" tabindex="-1">Unsaved changes</h1>
  				<p>You have unsaved changes.</p>
  				<button type="button" class="unsaved-save">Save</button>
  				<button type="button" class="unsaved-discard">Discard</button>
  				<button type="button" class="unsaved-back">Close</button>
  			</div>
  		</dialog>
  		{% endif %}
  		{% if pres.role == "owner" or pres.role == "editor" %}
  		<button type="button"
  		        id="actions-btn-{{ pres.id }}"
  		        aria-haspopup="menu"
  		        aria-expanded="false"
  		        aria-controls="actions-menu-{{ pres.id }}">Actions: {{ pres.name }}</button>
  		<ul role="menu" id="actions-menu-{{ pres.id }}" hidden>
  			<li role="menuitem" tabindex="-1"
  				data-action="copy-link"
  				data-pres-id="{{ pres.id }}"
  				data-owner-name="{{ pres.owner_name }}">Copy link</li>
  			{% if pres.role == "owner" %}
  			<li role="menuitem" tabindex="-1"
  				data-action="open-dialog"
  				data-dialog-id="manage-access-{{ pres.id }}"
  				data-return-btn="actions-btn-{{ pres.id }}">Manage access</li>
  			{% endif %}
  			<li role="menuitem" tabindex="-1"
  				data-action="open-edit"
  				data-edit-url="/{{ pres.owner_name }}/{{ pres.id }}/edit">Edit {{ pres.name }}<svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12" style="margin-left:0.25em"><path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M8 1h3v3M11 1L5 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg> <span class="sr-only">(opens in new tab)</span></li>
  			{% if pres.role == "owner" %}
  			<li role="menuitem" tabindex="-1"
  				data-action="open-dialog"
  				data-dialog-id="delete-pres-{{ pres.id }}"
  				data-return-btn="actions-btn-{{ pres.id }}">Delete {{ pres.name }}</li>
  			{% endif %}
  		</ul>
  		{% endif %}
  ```

- [ ] **Step 3: Add the `open-edit` handler in the menu JS (inside the menu items activation block)**

  In the `presentations.html` inline script, find the `menu.querySelectorAll('[role="menuitem"]')` click handler. After the existing `} else if (item.dataset.action === 'open-dialog') {` branch (around line 310), add:

  ```js
  				} else if (item.dataset.action === 'open-edit') {
  					window.open(item.dataset.editUrl, '_blank');
  					btn.focus();
  				}
  ```

- [ ] **Step 4: Add Playwright tests for new presentations.html behaviour**

  `openActionsMenu` is already defined near the top of `presentations.spec.js` — verify it exists before adding these tests. `loginAsAdmin` is imported from `./helpers`.

  Add to `tests/presentations.spec.js` (inside the existing `test.describe('presentations list', ...)` block so `loginAsAdmin` already runs in `beforeEach`):

  ```js
  test('stage link opens in a new tab', async ({ page }) => {
      await page.goto('/user/presentations');
      const link = page.locator('#pres-list a.stage-link').first();
      await expect(link).toHaveAttribute('target', '_blank');
  });

  test('stage link announces (opens in new tab)', async ({ page }) => {
      await page.goto('/user/presentations');
      const srOnly = page.locator('#pres-list a.stage-link .sr-only').first();
      await expect(srOnly).toHaveText('(opens in new tab)');
  });

  test('Edit menu item is present for owner', async ({ page }) => {
      await page.goto('/user/presentations');
      await openActionsMenu(page, 1);
      await expect(
          page.locator('#actions-menu-1 [role="menuitem"]').filter({ hasText: 'Edit' })
      ).toBeVisible();
  });
  ```

  Additionally, add a separate describe block that creates an editor relationship and verifies editor visibility:

  ```js
  test.describe('editor sees actions menu', () => {
      // These tests require a shared presentation — seed one via the API.
      // Simplest approach: use the admin-created Demo presentation (id=1)
      // and add a test editor user via the manage-access endpoint.

      test('editor sees actions button on shared presentation', async ({ browser }) => {
          // Create an isolated browser context for the editor
          const adminCtx = await browser.newContext();
          const adminPage = await adminCtx.newPage();
          adminPage.goto('http://localhost:5003');
          await loginAsAdmin(adminPage);
          // Add testuser as editor via the API
          await adminPage.request.post('/user/presentations/1/access/add', {
              form: { username: 'testuser', role: 'editor' },
          });
          await adminCtx.close();

          const editorCtx = await browser.newContext();
          const editorPage = await editorCtx.newPage();
          editorPage.goto('http://localhost:5003');
          // Log in as testuser (seeded by migrations with password 'testpass')
          await editorPage.goto('/auth/login');
          await editorPage.fill('[name="username"]', 'testuser');
          await editorPage.fill('[name="password"]', 'testpass');
          await editorPage.click('button[type="submit"]');
          await editorPage.goto('/user/presentations');

          // Editor should see the actions button for the shared presentation
          const actionsBtn = editorPage.locator('[id^="actions-btn-"]').first();
          await expect(actionsBtn).toBeVisible();

          // Editor should see Edit item in the menu
          await actionsBtn.click();
          const menu = editorPage.locator('[id^="actions-menu-"]').first();
          await expect(menu.locator('[role="menuitem"]').filter({ hasText: 'Edit' })).toBeVisible();

          await editorCtx.close();
      });
  });
  ```

  Note: If `testuser` with password `testpass` is not seeded by migrations, adjust the credentials or skip this test and verify manually during Task 12 Step 5.

  Note: The spec states the existing `.stage-link` click handler (which records a "recently viewed" timestamp in `localStorage`) still fires on left-click even with `target="_blank"`. This is covered by the existing test `'stage link opens in a new tab'` — Playwright's click simulates a left-click and the handler fires normally. No additional test is required.

- [ ] **Step 5: Run existing Playwright tests on VPS to confirm no regressions (deploy first)**

  Deploy: `config/update.bat` from the VPS.
  Run: `cd tests && npx playwright test presentations.spec.js`
  Expected: all tests pass including the three new ones.

- [ ] **Step 6: Commit**
  ```bash
  git add syncslide-websocket/templates/presentations.html tests/presentations.spec.js
  git commit -m "feat: open stage in new tab; add editor actions menu and Edit menu item"
  ```

---

## Task 8: Add `edit_pres` Rust handler and route (TDD)

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

- [ ] **Step 1: Write a failing Rust test**

  In `main.rs`, in the `#[cfg(test)]` module, add:

  ```rust
  /// GET /{uname}/{pid}/edit by the owner must serve the edit page.
  #[tokio::test]
  async fn owner_gets_edit_page() {
      let (server, state) = test_server().await;
      seed_user(&state.db_pool).await;
      let uid = get_user_id("admin", &state.db_pool).await;
      let pid = seed_presentation(uid, "Edit Page Test", &state.db_pool).await;
      login_as(&server, "admin", "admin").await;

      let response = server.get(&format!("/admin/{pid}/edit")).await;
      assert_eq!(response.status_code(), 200);
      assert!(
          response.text().contains(r#"id="edit-heading""#),
          "edit page must have the edit-heading H1"
      );
      assert!(
          response.text().contains(r#"id="markdown-input""#),
          "edit page must have the markdown textarea"
      );
      assert!(
          !response.text().contains(r#"id="recordPause""#),
          "edit page must not have the record button"
      );
  }

  /// GET /{uname}/{pid}/edit by a controller must redirect to the stage page.
  #[tokio::test]
  async fn controller_edit_redirects_to_stage() {
      let (server, state) = test_server().await;
      seed_user(&state.db_pool).await;
      let uid = get_user_id("admin", &state.db_pool).await;
      let pid = seed_presentation(uid, "Edit Redirect Test", &state.db_pool).await;
      User::new(
          &state.db_pool,
          AddUserForm {
              name: "ctrluser2".to_string(),
              email: "ctrl2@example.com".to_string(),
              password: "ctrlpass2".to_string(),
          },
      )
      .await
      .unwrap();
      let ctrl_uid = get_user_id("ctrluser2", &state.db_pool).await;
      PresentationAccess::add(&state.db_pool, pid, ctrl_uid, "controller").await.unwrap();
      login_as(&server, "ctrluser2", "ctrlpass2").await;

      let response = server.get(&format!("/admin/{pid}/edit")).await;
      // axum-test follows redirects by default; expect stage page (has recordPause)
      assert!(
          response.text().contains(r#"id="recordPause""#),
          "controller redirected to stage should see recordPause"
      );
  }
  ```

- [ ] **Step 2: Run the tests — expect FAIL (route returns 404 — not registered yet)**

  On VPS: `cd syncslide-websocket && cargo test owner_gets_edit_page controller_edit_redirects_to_stage 2>&1 | tail -30`

- [ ] **Step 3: Implement the `edit_pres` handler**

  Add the handler after the `stage` function (around line 498 in main.rs). Note: `app_state` is intentionally omitted from the handler signature — the edit page does not render an initial slide and never calls `stage()`, so the `AppState` extractor is not needed. The `tera.render("edit.html", ctx, auth_session, db).await.into_response()` call follows the same pattern as the existing `audience.html` render on line 471 of `present` — confirm they match.

  ```rust
  async fn edit_pres(
      State(tera): State<Tera>,
      State(db): State<SqlitePool>,
      auth_session: AuthSession,
      Path((uname, pid)): Path<(String, i64)>,
  ) -> impl IntoResponse {
      if auth_session.user.is_none() {
          return Redirect::to("/auth/login").into_response();
      }
      let pres_user = match User::get_by_name(uname.clone(), &db).await {
          Ok(Some(u)) => u,
          Ok(None) => return StatusCode::NOT_FOUND.into_response(),
          Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
      };
      let pres = match DbPresentation::get_by_id(pid, &db).await {
          Ok(Some(p)) => p,
          Ok(None) => return StatusCode::NOT_FOUND.into_response(),
          Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
      };
      if pres.user_id != pres_user.id {
          let Ok(Some(owner)) = User::get_by_id(pres.user_id, &db).await else {
              return StatusCode::INTERNAL_SERVER_ERROR.into_response();
          };
          let redirect = format!("/{}/{pid}/edit", owner.name);
          return Redirect::permanent(&redirect).into_response();
      }
      let access = match check_access(&db, auth_session.user.as_ref(), pid, None).await {
          Ok(a) => a,
          Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
      };
      match access {
          AccessResult::Owner | AccessResult::Editor => {
              let mut ctx = Context::new();
              ctx.insert("pres", &pres);
              ctx.insert("pres_user", &pres_user);
              tera.render("edit.html", ctx, auth_session, db).await.into_response()
          }
          AccessResult::Controller | AccessResult::Audience | AccessResult::PublicOk => {
              Redirect::to(&format!("/{uname}/{pid}")).into_response()
          }
          AccessResult::Denied => Redirect::to("/auth/login").into_response(),
      }
  }
  ```

- [ ] **Step 4: Register the route**

  In `build_app`, add the edit route before `/{uname}/{pid}/{rid}` (around line 1384):

  ```rust
          .route("/{uname}/{pid}/edit", get(edit_pres))
          .route("/{uname}/{pid}/{rid}", get(recording))
  ```

- [ ] **Step 5: Run tests — expect both to PASS**

  On VPS: `cd syncslide-websocket && cargo test owner_gets_edit_page controller_edit_redirects_to_stage 2>&1 | tail -20`

- [ ] **Step 6: Commit**
  ```bash
  git add syncslide-websocket/src/main.rs
  git commit -m "feat: add /{uname}/{pid}/edit route for dedicated edit page"
  ```

---

## Task 9: Give controllers stage access; delete `controller.html` (TDD)

Controllers should now receive `stage.html`. The existing test `controller_gets_audience_not_stage` must be renamed and its assertions updated first, then the code changed to make it pass.

**Files:**
- Modify: `syncslide-websocket/src/main.rs`
- Delete: `syncslide-websocket/templates/controller.html`

- [ ] **Step 1: Update the test (rename + new assertions)**

  Find `controller_gets_audience_not_stage` (line ~2194) and rename + update it:

  ```rust
  /// GET /{uname}/{pid} by a controller must get stage access.
  #[tokio::test]
  async fn controller_gets_stage_access() {
      let (server, state) = test_server().await;
      seed_user(&state.db_pool).await;
      let uid = get_user_id("admin", &state.db_pool).await;
      let pid = seed_presentation(uid, "Controller Stage Test", &state.db_pool).await;
      User::new(
          &state.db_pool,
          AddUserForm {
              name: "ctrluser".to_string(),
              email: "ctrl@example.com".to_string(),
              password: "ctrlpass".to_string(),
          },
      )
      .await
      .unwrap();
      let ctrl_uid = get_user_id("ctrluser", &state.db_pool).await;
      PresentationAccess::add(&state.db_pool, pid, ctrl_uid, "controller").await.unwrap();
      login_as(&server, "ctrluser", "ctrlpass").await;

      let response = server.get(&format!("/admin/{pid}")).await;
      assert_eq!(response.status_code(), 200);
      assert!(
          response.text().contains(r#"id="recordPause""#),
          "controller must see the record button on stage"
      );
      assert!(
          !response.text().contains(r#"id="markdown-input""#),
          "controller must not see the markdown editor"
      );
  }
  ```

- [ ] **Step 2: Run the test — expect FAIL**

  On VPS: `cd syncslide-websocket && cargo test controller_gets_stage_access 2>&1 | tail -20`

  The test will fail because the controller currently gets `controller.html` which has `#goTo` but not `#recordPause`.

- [ ] **Step 3: Merge the `Owner | Editor` and `Controller` arms in `present` (lines 452–463)**

  Replace both arms (lines 452–463) with a single merged arm. Old code:
  ```rust
          AccessResult::Owner | AccessResult::Editor => {
              stage(tera, db, auth_session, pid, app_state, pres_user).await.into_response()
          }
          AccessResult::Controller => {
              let slide_index = current_slide_index(&app_state, pid);
              let initial_slide = render_slide(&pres.content, slide_index, &pres.name);
              let mut ctx = Context::new();
              ctx.insert("pres", &pres);
              ctx.insert("pres_user", &pres_user);
              ctx.insert("initial_slide", &initial_slide);
              tera.render("controller.html", ctx, auth_session, db).await.into_response()
          }
  ```
  New code (replace both arms with one):
  ```rust
          AccessResult::Owner | AccessResult::Editor | AccessResult::Controller => {
              stage(tera, db, auth_session, pid, app_state, pres_user).await.into_response()
          }
  ```

- [ ] **Step 4: Run the test — expect PASS**

  On VPS: `cd syncslide-websocket && cargo test controller_gets_stage_access 2>&1 | tail -20`

- [ ] **Step 5: Delete `controller.html`**

  ```bash
  git rm syncslide-websocket/templates/controller.html
  ```

  `git rm` stages the deletion automatically.

- [ ] **Step 6: Commit**
  ```bash
  git add syncslide-websocket/src/main.rs
  git commit -m "feat: give controllers stage access; remove controller.html"
  ```

  Note: `syncslide-websocket/templates/controller.html` was already staged by `git rm` in Step 5 and will be included in this commit.

---

## Task 10: Expand `add_recording` permissions to include controller and editor (TDD)

Currently `add_recording` only allows the presentation owner. Controllers (and editors, for consistency) should also be able to save recordings. This requires a SQL query change and a `cargo sqlx prepare` run on the VPS.

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

- [ ] **Step 1: Write a failing Rust test**

  In the `#[cfg(test)]` module, add:

  ```rust
  /// A controller must be able to POST to add_recording.
  #[tokio::test]
  async fn controller_can_add_recording() {
      let (server, state) = test_server().await;
      seed_user(&state.db_pool).await;
      let uid = get_user_id("admin", &state.db_pool).await;
      let pid = seed_presentation(uid, "Recording Perm Test", &state.db_pool).await;
      User::new(
          &state.db_pool,
          AddUserForm {
              name: "ctrlrec".to_string(),
              email: "ctrlrec@example.com".to_string(),
              password: "ctrlrecpass".to_string(),
          },
      )
      .await
      .unwrap();
      let ctrl_uid = get_user_id("ctrlrec", &state.db_pool).await;
      PresentationAccess::add(&state.db_pool, pid, ctrl_uid, "controller").await.unwrap();
      login_as(&server, "ctrlrec", "ctrlrecpass").await;

      // Multipart form with required fields: name + slides JSON
      let form = axum_test::multipart::MultipartForm::new()
          .add_text("name", "Test Recording")
          .add_text("slides", "[]");
      let response = server
          .post(&format!("/user/presentations/{pid}/recordings"))
          .multipart(form)
          .await;
      // Must not be 403
      assert_ne!(
          response.status_code(),
          axum::http::StatusCode::FORBIDDEN,
          "controller must not be forbidden from adding a recording"
      );
  }
  ```

- [ ] **Step 2: Run the test — expect FAIL (403 Forbidden at runtime)**

  At this point only the test is written; `main.rs` still has the old SQL query. The `.sqlx/` cache matches the old query, so the code compiles successfully in offline mode (`SQLX_OFFLINE=true`). The test fails at runtime (not compile time) because the controller still receives 403 from the old query.

  On VPS: `cd syncslide-websocket && cargo test controller_can_add_recording 2>&1 | tail -20`

  If the build fails instead of the test failing, check that the `.sqlx/` cache is up to date with the current `main.rs` before Step 1 was written. Do not proceed to Step 3 until the test reaches runtime and returns a 403 assertion failure.

- [ ] **Step 3: Replace the ownership check in `add_recording` (lines 1223–1232)**

  Old:
  ```rust
      let owner_count = sqlx::query_scalar::<_, i64>(
          "SELECT COUNT(*) FROM presentation WHERE id = ? AND user_id = ?;",
      )
      .bind(pid)
      .bind(user.id)
      .fetch_one(&db)
      .await;
      if !matches!(owner_count, Ok(1)) {
          return StatusCode::FORBIDDEN.into_response();
      }
  ```
  New:
  ```rust
      let has_access = sqlx::query_scalar::<_, i64>(
          "SELECT COUNT(*) FROM (
              SELECT 1 FROM presentation WHERE id = ? AND user_id = ?
              UNION ALL
              SELECT 1 FROM presentation_access WHERE presentation_id = ? AND user_id = ? AND role IN ('controller', 'editor')
          )",
      )
      .bind(pid)
      .bind(user.id)
      .bind(pid)
      .bind(user.id)
      .fetch_one(&db)
      .await;
      if !matches!(has_access, Ok(n) if n > 0) {
          return StatusCode::FORBIDDEN.into_response();
      }
  ```

- [ ] **Step 4: Regenerate the SQLx offline cache on VPS**

  The new query must be reflected in `.sqlx/` before the code compiles. Run on VPS:
  ```bash
  cd syncslide-websocket
  DATABASE_URL=sqlite://db.sqlite3 cargo sqlx prepare -- --all-targets
  ```

- [ ] **Step 5: Run the test — expect PASS**

  On VPS: `cd syncslide-websocket && cargo test controller_can_add_recording 2>&1 | tail -20`

- [ ] **Step 6: Commit code and updated cache together**
  ```bash
  git add syncslide-websocket/src/main.rs syncslide-websocket/.sqlx/
  git commit -m "feat: allow controller and editor to save recordings"
  ```

---

## Task 11: Add accessibility Playwright tests (Spec Section 6)

Spec Section 6 requires both stage and edit pages to have `tabindex="-1"` on the H1 and to receive focus on page load. These must be verified with Playwright tests before the final deploy.

**Files:**
- Modify: `tests/accessibility.spec.js`

- [ ] **Step 1: Add H1 focus and breadcrumb tests for stage and edit pages**

  Add to `tests/accessibility.spec.js`:

  ```js
  test.describe('stage and edit page H1 focus', () => {
      test.beforeEach(async ({ page }) => {
          await loginAsAdmin(page);
      });

      test('stage page H1 has tabindex=-1', async ({ page }) => {
          await page.goto('/admin/1');
          const h1 = page.locator('#stage-heading');
          await expect(h1).toHaveAttribute('tabindex', '-1');
      });

      test('edit page H1 has tabindex=-1', async ({ page }) => {
          await page.goto('/admin/1/edit');
          const h1 = page.locator('#edit-heading');
          await expect(h1).toHaveAttribute('tabindex', '-1');
      });

      test('edit page H1 receives focus on load', async ({ page }) => {
          await page.goto('/admin/1/edit');
          const h1 = page.locator('#edit-heading');
          await expect(h1).toBeFocused();
      });

      test('stage page H1 receives focus on load', async ({ page }) => {
          await page.goto('/admin/1');
          const h1 = page.locator('#stage-heading');
          await expect(h1).toBeFocused();
      });

      test('stage page breadcrumb has three items with aria-current on last', async ({ page }) => {
          await page.goto('/admin/1');
          const nav = page.locator('nav[aria-label="Breadcrumb"]');
          await expect(nav).toBeVisible();
          const items = nav.locator('li');
          await expect(items).toHaveCount(3);
          await expect(items.last()).toHaveAttribute('aria-current', 'page');
      });

      test('edit page breadcrumb has three items with aria-current on last', async ({ page }) => {
          await page.goto('/admin/1/edit');
          const nav = page.locator('nav[aria-label="Breadcrumb"]');
          await expect(nav).toBeVisible();
          const items = nav.locator('li');
          await expect(items).toHaveCount(3);
          await expect(items.last()).toHaveAttribute('aria-current', 'page');
      });
  });
  ```

  Note: `loginAsAdmin` is imported from `./helpers` — check that `accessibility.spec.js` already imports it; if not, add `const { loginAsAdmin } = require('./helpers');` at the top.

- [ ] **Step 2: Run accessibility tests on VPS**

  On VPS: `cd tests && npx playwright test accessibility.spec.js`
  Expected: all tests pass (deploy must be complete before running).

- [ ] **Step 3: Commit**
  ```bash
  git add tests/accessibility.spec.js
  git commit -m "test: verify H1 tabindex and focus on stage and edit pages"
  ```

---

## Task 12: Final deploy and full test suite

- [ ] **Step 1: Push all commits**
  ```bash
  git push
  ```

- [ ] **Step 2: Deploy on VPS**
  ```
  config/update.bat
  ```

- [ ] **Step 3: Run Rust tests**

  On VPS: `cd syncslide-websocket && cargo test 2>&1 | tail -40`

  Expected: all tests pass.

- [ ] **Step 4: Run Playwright tests**

  On VPS: `cd tests && npx playwright test --config playwright.config.js`

  Expected: all tests pass.

- [ ] **Step 5: Manually verify the edit page**

  - Log in to the VPS app
  - Go to Your Presentations
  - Confirm the Demo presentation heading link has an external-link icon and opens in a new tab
  - Open the Actions menu → click Edit Demo → confirm a new tab opens to `/admin/1/edit`
  - Confirm the edit page has H1 "Demo", Presentation name field, Slides section, Markdown textarea
  - Navigate to `/admin/1` (stage) — confirm no Edit Slides section, has H1 "Demo" and Record section
  - Assign a test user as controller → confirm they land on the stage page

- [ ] **Step 6: Final commit if any fixes were needed**
