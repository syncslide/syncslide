# Recording Edit Page & Action Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move recording editing controls to a dedicated `/{uname}/{pid}/{rid}/edit` page and replace the bare Delete button in the pList recordings table with a full action menu.

**Architecture:** Six independent tasks. Tasks 1–5 cover the backend route, templates, and JS split. Task 6 covers the pList action menu. Each task produces a working, committed state. No new SQL or migrations.

**Tech Stack:** Rust/Axum, Tera templates, vanilla JS, SQLite (no changes)

---

### Task 1: Simplify `recording.html` and remove `is_owner` from handler

**Files:**
- Modify: `syncslide-websocket/templates/recording.html`
- Modify: `syncslide-websocket/src/main.rs` (lines ~1021–1032)

- [ ] **Step 1: Replace `recording.html` with the simplified version**

The new template removes all `{% if is_owner %}` blocks, all dialogs, and the inline `<script>`. The breadcrumb switches from `is_owner` to `user` (logged-in check, which Tera gets from the auth session).

Full new content of `syncslide-websocket/templates/recording.html`:

```html
{% extends "nav.html" %}

{% block title %}Watch Recording: {{ recording.name }}{% endblock title %}

{% block js %}
<script defer src="/js/play.js"></script>
<link rel="stylesheet" href="/css/katex.css">
{% endblock js %}

{% block breadcrumb %}{% if user %}<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/user/presentations">Your Presentations</a></li><li><a href="/{{ pres_user.name }}/{{ pres.id }}">{{ pres.name }}</a></li><li aria-current="page">{{ recording.name }}</li></ol></nav>{% else %}<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">{{ recording.name }}</li></ol></nav>{% endif %}{% endblock breadcrumb %}
{% block content %}
<h1>{{ pres.name }}: {{ recording.name }}</h1>
<section aria-labelledby="video-heading">
<details open>
<summary id="video-heading">Video</summary>
{% if recording.video_path %}
<video id="myVideo" width="640" height="360" controls playsinline data-rid="{{ recording.id }}" data-recording-name="{{ recording.name }}">
<source src="/assets/{{ recording.id }}/{{ recording.video_path }}">
<track id="syncslide-data" default class="syncslide-data" kind="metadata" src="/{{ pres_user.name }}/{{ pres.id }}/{{ recording.id }}/slides.vtt" srclang="en" label="SyncSlide Data"/>
<track kind="captions" src="/assets/{{ recording.id }}/{{ recording.captions_path }}" srclang="en" label="Captions"/>
Your browser does not support the video tag.
</video>
{% else %}
<p>No video uploaded yet.</p>
<video id="myVideo" data-rid="{{ recording.id }}" data-recording-name="{{ recording.name }}" style="display:none">
<track id="syncslide-data" default class="syncslide-data" kind="metadata" src="/{{ pres_user.name }}/{{ pres.id }}/{{ recording.id }}/slides.vtt" srclang="en" label="SyncSlide Data"/>
</video>
{% endif %}
{% if recording.video_path %}
<label for="rate">Playback Speed: </label>
<select id="rate">
<option value="0.5">0.5x</option>
<option value="0.75">0.75x</option>
<option value="1" selected>1x</option>
<option value="1.25">1.25x</option>
<option value="1.5">1.5x</option>
<option value="1.75">1.75x</option>
<option value="2">2x</option>
</select>
{% endif %}
</details>
</section>
<nav aria-label="Downloads">
<a href="/{{ pres_user.name }}/{{ pres.id }}/{{ recording.id }}/slides.vtt" download="{{ pres.name }}_{{ recording.name }}.vtt">Download VTT</a>
<a href="/{{ pres_user.name }}/{{ pres.id }}/{{ recording.id }}/slides.html" download="{{ pres.name }}_{{ recording.name }}.html">Download Slides HTML</a>
</nav>
<section aria-label="Current slide" aria-live="polite" id="currentSlide"></section>
<nav aria-label="Slide Navigation">
<label for="goTo">Go to slide:</label>
<select id="goTo" name="goTo"></select>
</nav>
{% endblock content %}
```

- [ ] **Step 2: Remove `is_owner` from the `recording` handler in `main.rs`**

Find the `recording` handler (around line 993). Replace the block from `let has_owner_controls` through `ctx.insert("is_owner", ...)` with nothing — those two lines are removed. The handler's ctx block becomes:

```rust
    let mut ctx = Context::new();
    ctx.insert("recording", &rec);
    ctx.insert("pres", &pres);
    ctx.insert("pres_user", &pres_user);
    tera.render("recording.html", ctx, auth_session, db)
        .await
        .into_response()
```

The full handler at that point (for reference, lines ~993–1033 become):

```rust
async fn recording(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path((uname, pid, rid)): Path<(String, i64, i64)>,
) -> impl IntoResponse {
    let Ok(Some(pres_user)) = User::get_by_name(uname, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != pres_user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(Some(rec)) = Recording::get_by_id(rid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if rec.presentation_id != pid {
        return StatusCode::NOT_FOUND.into_response();
    }
    let access = match check_access(&db, auth_session.user.as_ref(), pid, Some(rid)).await {
        Ok(a) => a,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if matches!(access, AccessResult::Denied) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut ctx = Context::new();
    ctx.insert("recording", &rec);
    ctx.insert("pres", &pres);
    ctx.insert("pres_user", &pres_user);
    tera.render("recording.html", ctx, auth_session, db)
        .await
        .into_response()
}
```

- [ ] **Step 3: Run Rust tests**

```bash
cd /home/melody/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/melody/syncSlide
git add syncslide-websocket/templates/recording.html syncslide-websocket/src/main.rs
git commit -m "refactor: simplify recording watch page — remove owner-only controls"
```

---

### Task 2: Add `edit_recording` handler and route with Rust tests

**Files:**
- Modify: `syncslide-websocket/src/main.rs`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the `#[cfg(test)] mod tests` block, after the existing `recording_handler_denies_access_in_private_mode` test:

```rust
/// GET /{uname}/{pid}/{rid}/edit by the owner must return 200 with the edit-rec-heading.
#[tokio::test]
async fn owner_gets_edit_recording_page() {
    let (server, state) = test_server().await;
    let uid = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(uid, "Edit Rec Test", &state.db_pool).await;
    let rid = seed_recording(pid, &state.db_pool).await;
    login_as(&server, "admin", "admin").await;

    let resp = server.get(&format!("/admin/{pid}/{rid}/edit")).await;
    assert_eq!(resp.status_code(), 200);
    assert!(
        resp.text().contains(r#"id="edit-rec-heading""#),
        "edit recording page must have edit-rec-heading"
    );
}

/// GET /{uname}/{pid}/{rid}/edit without login must redirect to /auth/login.
#[tokio::test]
async fn unauthenticated_edit_recording_redirects() {
    let (server, state) = test_server().await;
    let uid = get_user_id("admin", &state.db_pool).await;
    let pid = seed_presentation(uid, "Edit Rec Auth Test", &state.db_pool).await;
    let rid = seed_recording(pid, &state.db_pool).await;

    let resp = server.get(&format!("/admin/{pid}/{rid}/edit")).await;
    assert_eq!(resp.status_code(), 303);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /home/melody/syncSlide/syncslide-websocket && cargo test owner_gets_edit_recording_page unauthenticated_edit_recording_redirects 2>&1 | tail -10
```

Expected: compile error (handler doesn't exist yet) or route 404.

- [ ] **Step 3: Add the `edit_recording` handler**

Add this function directly after the `recording` handler in `main.rs`:

```rust
async fn edit_recording(
    State(tera): State<Tera>,
    State(db): State<SqlitePool>,
    auth_session: AuthSession,
    Path((uname, pid, rid)): Path<(String, i64, i64)>,
) -> impl IntoResponse {
    if auth_session.user.is_none() {
        return Redirect::to("/auth/login").into_response();
    }
    let Ok(Some(pres_user)) = User::get_by_name(uname, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(Some(pres)) = DbPresentation::get_by_id(pid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if pres.user_id != pres_user.id {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(Some(rec)) = Recording::get_by_id(rid, &db).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if rec.presentation_id != pid {
        return StatusCode::NOT_FOUND.into_response();
    }
    let access = match check_access(&db, auth_session.user.as_ref(), pid, Some(rid)).await {
        Ok(a) => a,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if !matches!(access, AccessResult::Owner | AccessResult::Editor | AccessResult::Controller) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut ctx = Context::new();
    ctx.insert("recording", &rec);
    ctx.insert("pres", &pres);
    ctx.insert("pres_user", &pres_user);
    tera.render("edit_recording.html", ctx, auth_session, db)
        .await
        .into_response()
}
```

- [ ] **Step 4: Add the route**

In the router (around line 1720), add after the existing recording route:

```rust
.route("/{uname}/{pid}/{rid}/edit", get(edit_recording))
```

The routes block should now read:

```rust
.route("/{uname}/{pid}/{rid}", get(recording))
.route("/{uname}/{pid}/{rid}/edit", get(edit_recording))
.route("/{uname}/{pid}/{rid}/slides.vtt", get(slides_vtt))
```

- [ ] **Step 5: Run tests (they will fail on template missing — that's expected)**

```bash
cd /home/melody/syncSlide/syncslide-websocket && cargo test owner_gets_edit_recording_page unauthenticated_edit_recording_redirects 2>&1 | tail -10
```

Expected: `unauthenticated_edit_recording_redirects` passes (303). `owner_gets_edit_recording_page` fails because `edit_recording.html` doesn't exist yet — Tera will return 500.

- [ ] **Step 6: Commit (partial — tests not fully passing yet)**

```bash
cd /home/melody/syncSlide
git add syncslide-websocket/src/main.rs
git commit -m "feat: add edit_recording handler and route"
```

---

### Task 3: Create `edit_recording.html` template

**Files:**
- Create: `syncslide-websocket/templates/edit_recording.html`

- [ ] **Step 1: Create the template**

Full content of `syncslide-websocket/templates/edit_recording.html`:

```html
{% extends "nav.html" %}

{% block title %}Edit Recording: {{ recording.name }}{% endblock title %}

{% block js %}
<script defer src="/js/edit-recording.js"></script>
{% endblock js %}

{% block breadcrumb %}
<nav aria-label="Breadcrumb"><ol>
<li><a href="/">Home</a></li>
<li><a href="/user/presentations">Your Presentations</a></li>
<li><a href="/{{ pres_user.name }}/{{ pres.id }}">{{ pres.name }}</a></li>
<li><a href="/{{ pres_user.name }}/{{ pres.id }}/{{ recording.id }}">{{ recording.name }}</a></li>
<li aria-current="page">Edit Recording</li>
</ol></nav>
{% endblock breadcrumb %}

{% block content %}
<h1 id="edit-rec-heading" tabindex="-1">Edit Recording: {{ recording.name }}</h1>
<label>Recording name: <input type="text" id="recName" data-rid="{{ recording.id }}" value="{{ recording.name }}"></label>
<section aria-labelledby="timing-heading">
<h2 id="timing-heading">Edit Timing</h2>
<label><input type="checkbox" id="shiftSubsequent"> Shift subsequent slides when editing a timestamp</label>
<table>
<thead><tr><th>Slide</th><th>Title</th><th>Start Time (seconds)</th></tr></thead>
<tbody id="cueTableBody" data-vtt-url="/{{ pres_user.name }}/{{ pres.id }}/{{ recording.id }}/slides.vtt"></tbody>
</table>
<div aria-live="polite" id="timing-status"></div>
<button type="button" id="saveTimingBtn" hidden>Save</button>
<button type="button" id="discardTimingBtn" hidden>Discard</button>
</section>
<section aria-labelledby="files-heading">
<h2 id="files-heading">Replace Files</h2>
<form id="replaceFilesForm" data-rid="{{ recording.id }}">
<label>Video (optional): <input type="file" name="video" accept="video/*"></label>
<label>Captions VTT (optional): <input type="file" name="captions" accept=".vtt,text/vtt"></label>
<button type="submit">Replace</button>
</form>
<div aria-live="polite" id="files-status"></div>
</section>
<a href="/{{ pres_user.name }}/{{ pres.id }}/{{ recording.id }}">Watch recording</a>
<script>document.getElementById('edit-rec-heading').focus();</script>
{% endblock content %}
```

- [ ] **Step 2: Run the Rust tests**

```bash
cd /home/melody/syncSlide/syncslide-websocket && cargo test owner_gets_edit_recording_page unauthenticated_edit_recording_redirects 2>&1 | tail -10
```

Expected: both tests pass.

- [ ] **Step 3: Run the full test suite**

```bash
cd /home/melody/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/melody/syncSlide
git add syncslide-websocket/templates/edit_recording.html
git commit -m "feat: add edit_recording.html template"
```

---

### Task 4: Trim `play.js` to playback-only

**Files:**
- Modify: `syncslide-websocket/js/play.js`

- [ ] **Step 1: Replace `play.js` with the trimmed version**

Remove: `escapeHtml`, `cueTableBody`, `shiftSubsequent`, `rid`, `renderCueTable`, `pendingChanges`, `editPresentationDialog`, `saveTimingDialog`, all dialog listeners, `saveSlideTime`, `cueTableBody.addEventListener("change")`, replace files handling.

Keep: `cueList`, `buildGoTo`, `initFromCues`, cuechange handler, `goToSlide`, `onCommit(goTo, goToSlide)`, F8 keyboard shortcut, `rate` change handler.

Full new content of `syncslide-websocket/js/play.js`:

```js
window.addEventListener("load", () => {
	const video = document.getElementById("myVideo");
	const slidesData = video.textTracks.getTrackById("syncslide-data");
	const rate = document.getElementById("rate");
	const slidesContainer = document.getElementById("currentSlide");
	const goTo = document.getElementById("goTo");

	function onCommit(el, fn) {
		el.addEventListener('blur', fn);
		el.addEventListener('change', fn);
		if (el.tagName !== 'TEXTAREA') {
			el.addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(e); });
		}
	}

	function goToSlide() {
		const targetTime = parseFloat(goTo.value);
		video.currentTime = targetTime;
		if (slidesData.cues) {
			const cue = Array.from(slidesData.cues).find(c => c.startTime === targetTime);
			if (cue) {
				const parsed = JSON.parse(cue.text);
				slidesContainer.innerHTML = parsed.content ?? parsed.data ?? '';
				markExternalLinks(slidesContainer);
			}
		}
	}

	let cueList = [];

	function buildGoTo() {
		goTo.innerHTML = '';
		for (const c of cueList) {
			goTo.add(new Option(c.title + ": " + c.startTime + "s", String(c.startTime)));
		}
	}

	function initFromCues() {
		if (!slidesData.cues || slidesData.cues.length === 0) return;
		cueList = Array.from(slidesData.cues).map(c => {
			const parsed = JSON.parse(c.text);
			return { startTime: c.startTime, id: parsed.id, title: parsed.title };
		});
		buildGoTo();
	}

	initFromCues();
	if (cueList.length === 0) {
		slidesData.mode = 'hidden';
		video.querySelector('track#syncslide-data').addEventListener('load', initFromCues);
	}

	slidesData.addEventListener("cuechange", () => {
		const slide = slidesData.activeCues[0];
		if (!slide) return;
		const parsed = JSON.parse(slide.text);
		slidesContainer.innerHTML = parsed.content ?? parsed.data ?? '';
		markExternalLinks(slidesContainer);
		goTo.value = Number(slide.startTime);
	});

	onCommit(goTo, goToSlide);

	document.addEventListener("keydown", (e) => {
		if (e.key !== "F8") return;
		e.preventDefault();
		const current = Array.from(goTo.options).findIndex(o => o.selected);
		const max = goTo.options.length - 1;
		if (e.shiftKey) {
			if (current > 0) {
				goTo.value = String(cueList[current - 1].startTime);
				goToSlide();
			}
		} else {
			if (current < max) {
				goTo.value = String(cueList[current + 1].startTime);
				goToSlide();
			}
		}
	});

	rate?.addEventListener('change', () => {
		video.playbackRate = rate.value;
	});
});
```

- [ ] **Step 2: Run the full test suite**

```bash
cd /home/melody/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /home/melody/syncSlide
git add syncslide-websocket/js/play.js
git commit -m "refactor: trim play.js to playback-only — editing logic moves to edit-recording.js"
```

---

### Task 5: Create `edit-recording.js`

**Files:**
- Create: `syncslide-websocket/js/edit-recording.js`

- [ ] **Step 1: Create the file**

Full content of `syncslide-websocket/js/edit-recording.js`:

```js
(function () {
	function escapeHtml(str) {
		const d = document.createElement('div');
		d.textContent = str;
		return d.innerHTML;
	}

	function onCommit(el, fn) {
		el.addEventListener('blur', fn);
		el.addEventListener('change', fn);
		if (el.tagName !== 'TEXTAREA') {
			el.addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(e); });
		}
	}

	function vttTimeToSeconds(t) {
		const parts = t.trim().split(':');
		return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
	}

	// ── Rename ────────────────────────────────────────────────────────────────
	const recNameInput = document.getElementById('recName');
	const rid = recNameInput ? recNameInput.dataset.rid : null;

	if (recNameInput && rid) {
		onCommit(recNameInput, async () => {
			const newName = recNameInput.value.trim();
			if (!newName) return;
			await fetch(`/user/recordings/${rid}/name`, {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: newName,
			});
			document.title = `Edit Recording: ${newName} - SyncSlide`;
			const h1 = document.getElementById('edit-rec-heading');
			if (h1) h1.textContent = `Edit Recording: ${newName}`;
		});
	}

	// ── Edit Timing ───────────────────────────────────────────────────────────
	const cueTableBody = document.getElementById('cueTableBody');
	const saveBtn = document.getElementById('saveTimingBtn');
	const discardBtn = document.getElementById('discardTimingBtn');
	const shiftSubsequent = document.getElementById('shiftSubsequent');
	const timingStatus = document.getElementById('timing-status');
	const vttUrl = cueTableBody ? cueTableBody.dataset.vttUrl : null;

	let cueList = [];
	let originalCueList = [];
	const pendingChanges = new Set();

	function renderCueTable() {
		cueTableBody.innerHTML = '';
		cueList.forEach((c, i) => {
			const tr = document.createElement('tr');
			tr.innerHTML = `<th scope="row">${i + 1}</th>`
				+ `<td>${escapeHtml(c.title)}</td>`
				+ `<td><input type="number" step="0.001" min="0" value="${c.startTime}" data-idx="${i}" aria-label="Start time for slide ${i + 1}: ${escapeHtml(c.title)}"></td>`;
			cueTableBody.appendChild(tr);
		});
	}

	function setDirty(dirty) {
		if (saveBtn) saveBtn.hidden = !dirty;
		if (discardBtn) discardBtn.hidden = !dirty;
	}

	async function loadCues() {
		if (!vttUrl) return;
		const resp = await fetch(vttUrl);
		if (!resp.ok) return;
		const text = await resp.text();
		const blocks = text.split(/\n\n+/).filter(b => b.includes('-->'));
		cueList = blocks.map(block => {
			const lines = block.trim().split('\n');
			const timeLine = lines.find(l => l.includes('-->'));
			const jsonLine = lines.find(l => l.startsWith('{'));
			const startTime = timeLine ? vttTimeToSeconds(timeLine.split('-->')[0]) : 0;
			const parsed = jsonLine ? JSON.parse(jsonLine) : {};
			return { id: parsed.id, title: parsed.title || '', startTime };
		});
		originalCueList = cueList.map(c => ({ ...c }));
		renderCueTable();
		pendingChanges.clear();
		setDirty(false);
	}

	if (cueTableBody && vttUrl) {
		loadCues();

		cueTableBody.addEventListener('change', (e) => {
			const input = e.target;
			if (input.type !== 'number') return;
			const idx = parseInt(input.dataset.idx);
			const newTime = parseFloat(input.value);

			if (shiftSubsequent && shiftSubsequent.checked) {
				const inputs = Array.from(cueTableBody.querySelectorAll("input[type='number']"));
				const delta = newTime - parseFloat(input.defaultValue);
				if (delta !== 0) {
					for (let j = idx + 1; j < inputs.length; j++) {
						inputs[j].value = Math.max(0, parseFloat(inputs[j].value) + delta).toFixed(3);
						const jIdx = parseInt(inputs[j].dataset.idx);
						cueList[jIdx].startTime = parseFloat(inputs[j].value);
						pendingChanges.add(jIdx);
					}
				}
			}

			cueList[idx].startTime = newTime;
			pendingChanges.add(idx);
			setDirty(true);
		});
	}

	if (saveBtn && rid) {
		saveBtn.addEventListener('click', async () => {
			for (const idx of pendingChanges) {
				await fetch(`/user/recordings/${rid}/slides/${cueList[idx].id}/time`, {
					method: 'POST',
					headers: { 'Content-Type': 'text/plain' },
					body: String(cueList[idx].startTime),
				});
			}
			pendingChanges.clear();
			originalCueList = cueList.map(c => ({ ...c }));
			renderCueTable();
			setDirty(false);
			if (timingStatus) {
				timingStatus.textContent = 'Timing saved.';
				setTimeout(() => { timingStatus.textContent = ''; }, 3000);
			}
		});
	}

	if (discardBtn) {
		discardBtn.addEventListener('click', () => {
			cueList = originalCueList.map(c => ({ ...c }));
			pendingChanges.clear();
			renderCueTable();
			setDirty(false);
		});
	}

	// ── Replace Files ─────────────────────────────────────────────────────────
	const replaceFilesForm = document.getElementById('replaceFilesForm');
	const filesStatus = document.getElementById('files-status');
	const filesRid = replaceFilesForm ? replaceFilesForm.dataset.rid : null;

	if (replaceFilesForm && filesRid) {
		replaceFilesForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const submitBtn = replaceFilesForm.querySelector('[type="submit"]');
			submitBtn.disabled = true;
			const resp = await fetch(`/user/recordings/${filesRid}/files`, {
				method: 'POST',
				body: new FormData(replaceFilesForm),
			});
			submitBtn.disabled = false;
			if (filesStatus) {
				filesStatus.textContent = resp.ok ? 'Files replaced.' : 'Replace failed. Please try again.';
				setTimeout(() => { filesStatus.textContent = ''; }, 4000);
			}
			if (resp.ok) replaceFilesForm.reset();
		});
	}
}());
```

- [ ] **Step 2: Run the full test suite**

```bash
cd /home/melody/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -5
```

Expected: all tests pass (Rust only; JS is loaded at runtime).

- [ ] **Step 3: Commit**

```bash
cd /home/melody/syncSlide
git add syncslide-websocket/js/edit-recording.js
git commit -m "feat: add edit-recording.js — rename, timing edit, replace files"
```

---

### Task 6: Replace recording Delete button with action menu in `presentations.html`

**Files:**
- Modify: `syncslide-websocket/templates/presentations.html`

This task has three parts: (A) replace the template's Delete button with the action menu, (B) add `copy-rec-link` and `open-rec-edit` handlers to the existing menu JS, (C) update `buildRecRow` and `setupRecRow` in the BroadcastChannel IIFE.

- [ ] **Step 1: Replace the recording row Actions `<td>` in the template**

In the `{% for rec in pres.recordings %}` loop, find the current `<td>` block (lines ~56–66):

```html
					<td>
						<button type="button" data-open-dialog="delete-rec-{{ rec.id }}">Delete</button>
						<dialog id="delete-rec-{{ rec.id }}" aria-labelledby="delete-rec-heading-{{ rec.id }}">
							<h1 id="delete-rec-heading-{{ rec.id }}" tabindex="-1">Delete {{ rec.name }}?</h1>
							<p>This will permanently delete the recording.</p>
							<form method="post" action="/user/recordings/{{ rec.id }}/delete">
								<button type="submit">Delete</button>
							</form>
							<button type="button" data-close-dialog="delete-rec-{{ rec.id }}">Cancel</button>
						</dialog>
					</td>
```

Replace it with:

```html
					<td>
<button type="button" id="rec-actions-btn-{{ rec.id }}" aria-haspopup="menu" aria-expanded="false" aria-controls="rec-actions-menu-{{ rec.id }}">Actions: {{ rec.name }}</button>
<ul role="menu" id="rec-actions-menu-{{ rec.id }}" hidden>
<li role="menuitem" tabindex="-1" data-action="copy-rec-link" data-owner-name="{{ pres.owner_name }}" data-pres-id="{{ pres.id }}" data-rec-id="{{ rec.id }}">Copy recording link</li>
<li role="menuitem" tabindex="-1" data-action="open-dialog" data-dialog-id="manage-rec-access-{{ rec.id }}" data-return-btn="rec-actions-btn-{{ rec.id }}">Manage access</li>
<li role="menuitem" tabindex="-1" data-action="open-rec-edit" data-edit-url="/{{ pres.owner_name }}/{{ pres.id }}/{{ rec.id }}/edit">Edit Recording<svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 12 12" style="margin-left:0.25em"><path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M8 1h3v3M11 1L5 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg> <span class="sr-only">(opens in new tab)</span></li>
<li role="menuitem" tabindex="-1" data-action="open-dialog" data-dialog-id="delete-rec-{{ rec.id }}" data-return-btn="rec-actions-btn-{{ rec.id }}">Delete Recording</li>
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
					</td>
```

- [ ] **Step 2: Add `copy-rec-link` and `open-rec-edit` handlers to the action menu JS**

In the action menu IIFE (the `(function () { ... })()` block), find the `menu.querySelectorAll('[role="menuitem"]').forEach(...)` block. Find the last `else if` inside the item click handler (currently `open-edit`):

```js
				} else if (item.dataset.action === 'open-edit') {
					window.open(item.dataset.editUrl, '_blank', 'noreferrer,noopener');
					btn.focus();
				}
```

Add two new branches after it:

```js
				} else if (item.dataset.action === 'copy-rec-link') {
					var url = window.location.origin + '/' + item.dataset.ownerName + '/' + item.dataset.presId + '/' + item.dataset.recId;
					var statusEl = document.getElementById('clipboard-status');
					try {
						navigator.clipboard.writeText(url).then(function () {
							statusEl.textContent = 'Link copied';
							setTimeout(function () { statusEl.textContent = ''; }, 4000);
							btn.focus();
						}, function () {
							statusEl.textContent = 'Could not copy link';
							setTimeout(function () { statusEl.textContent = ''; }, 4000);
							btn.focus();
						});
					} catch (err) {
						statusEl.textContent = 'Could not copy link';
						setTimeout(function () { statusEl.textContent = ''; }, 4000);
						btn.focus();
					}
				} else if (item.dataset.action === 'open-rec-edit') {
					window.open(item.dataset.editUrl, '_blank', 'noreferrer,noopener');
					btn.focus();
				}
```

- [ ] **Step 3: Update `buildRecRow` and replace `setupRecRow` with `setupRecMenu` in the BroadcastChannel IIFE**

In the BroadcastChannel IIFE (the second `(function () { ... })()` block at the bottom), replace the entire `setupRecRow` function, the `buildRecRow` function, and the related setup code in `addRecordingRow`:

Replace `setupRecRow`:

```js
	function setupRecMenu(tr, actionsBtn, dialogs) {
		var menu = document.getElementById(actionsBtn.getAttribute('aria-controls'));
		if (!menu) return;

		function openMenu(focusLast) {
			actionsBtn.setAttribute('aria-expanded', 'true');
			menu.removeAttribute('hidden');
			var items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
			if (items.length) (focusLast ? items[items.length - 1] : items[0]).focus();
		}
		function closeMenu() {
			actionsBtn.setAttribute('aria-expanded', 'false');
			menu.setAttribute('hidden', '');
		}

		actionsBtn.addEventListener('click', function () {
			if (actionsBtn.getAttribute('aria-expanded') === 'true') { closeMenu(); actionsBtn.focus(); }
			else openMenu(false);
		});
		actionsBtn.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(false); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu(true); }
		});
		menu.addEventListener('keydown', function (e) {
			var items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
			var idx = items.indexOf(document.activeElement);
			if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
			else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
			else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
			else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (document.activeElement) document.activeElement.click(); }
			else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); actionsBtn.focus(); }
		});
		menu.addEventListener('focusout', function (e) {
			if (!menu.contains(e.relatedTarget)) { closeMenu(); }
		});
		menu.querySelectorAll('[role="menuitem"]').forEach(function (item) {
			item.addEventListener('click', function () {
				closeMenu();
				if (item.dataset.action === 'copy-rec-link') {
					var url = window.location.origin + '/' + item.dataset.ownerName + '/' + item.dataset.presId + '/' + item.dataset.recId;
					var statusEl = document.getElementById('clipboard-status');
					try {
						navigator.clipboard.writeText(url).then(function () {
							statusEl.textContent = 'Link copied';
							setTimeout(function () { statusEl.textContent = ''; }, 4000);
							actionsBtn.focus();
						}, function () {
							statusEl.textContent = 'Could not copy link';
							setTimeout(function () { statusEl.textContent = ''; }, 4000);
							actionsBtn.focus();
						});
					} catch (err) {
						statusEl.textContent = 'Could not copy link';
						setTimeout(function () { statusEl.textContent = ''; }, 4000);
						actionsBtn.focus();
					}
				} else if (item.dataset.action === 'open-dialog') {
					var dialog = document.getElementById(item.dataset.dialogId);
					if (!dialog) return;
					dialog.showModal();
					var first = dialog.querySelector('h1[tabindex="-1"]') || dialog.querySelector('input, button');
					if (first) first.focus();
					dialog.addEventListener('close', function onClose() {
						actionsBtn.focus();
						dialog.removeEventListener('close', onClose);
					});
				} else if (item.dataset.action === 'open-rec-edit') {
					window.open(item.dataset.editUrl, '_blank', 'noreferrer,noopener');
					actionsBtn.focus();
				}
			});
		});

		// Wire up [data-close-dialog] buttons inside the dialogs
		dialogs.forEach(function (dialog) {
			dialog.querySelectorAll('[data-close-dialog]').forEach(function (closeBtn) {
				closeBtn.addEventListener('click', function () {
					dialog.close();
					actionsBtn.focus();
				});
			});
		});
	}
```

Replace `buildRecRow` with the version that generates the full action menu:

```js
	function buildRecRow(ownerName, pid, rec) {
		var recId = String(rec.id);
		var tr = document.createElement('tr');
		tr.innerHTML =
			'<td><a href="/' + esc(ownerName) + '/' + esc(pid) + '/' + esc(recId) + '" target="_blank" rel="noreferrer noopener">' + esc(rec.name) + EXT_SVG + ' <span class="sr-only">(opens in new tab)</span></a></td>' +
			'<td>' + esc(rec.start) + '</td>' +
			'<td>—</td>' +
			'<td>' +
				'<button type="button" id="rec-actions-btn-' + esc(recId) + '" aria-haspopup="menu" aria-expanded="false" aria-controls="rec-actions-menu-' + esc(recId) + '">Actions: ' + esc(rec.name) + '</button>' +
				'<ul role="menu" id="rec-actions-menu-' + esc(recId) + '" hidden>' +
					'<li role="menuitem" tabindex="-1" data-action="copy-rec-link" data-owner-name="' + esc(ownerName) + '" data-pres-id="' + esc(pid) + '" data-rec-id="' + esc(recId) + '">Copy recording link</li>' +
					'<li role="menuitem" tabindex="-1" data-action="open-rec-edit" data-edit-url="/' + esc(ownerName) + '/' + esc(pid) + '/' + esc(recId) + '/edit">Edit Recording ' + EXT_SVG + ' <span class="sr-only">(opens in new tab)</span></li>' +
					'<li role="menuitem" tabindex="-1" data-action="open-dialog" data-dialog-id="delete-rec-' + esc(recId) + '">Delete Recording</li>' +
				'</ul>' +
			'</td>';
		return tr;
	}
```

Note: the dynamically added row omits Manage access because we don't have the current `access_mode` value from the BroadcastChannel message. Delete and Edit Recording are the most important actions and are sufficient for newly created recordings.

Replace the `addRecordingRow` setup call (the block that currently calls `setupRecRow`) with one that calls `setupRecMenu`:

```js
		var actionsBtn = tr.querySelector('[aria-haspopup="menu"]');
		var deleteDialog = tr.querySelector('dialog');
		if (deleteDialog) document.body.appendChild(deleteDialog);
		if (actionsBtn) setupRecMenu(tr, actionsBtn, deleteDialog ? [deleteDialog] : []);
```

- [ ] **Step 4: Run the full test suite**

```bash
cd /home/melody/syncSlide/syncslide-websocket && cargo test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/melody/syncSlide
git add syncslide-websocket/templates/presentations.html
git commit -m "feat: recording action menu in pList — copy link, manage access, edit, delete"
```

---

### Final: Deploy

- [ ] **Deploy to production**

```bash
ssh arch@clippycat.ca "set -eo pipefail; cd syncSlide && git pull origin main --rebase && cd syncslide-websocket && cargo build --release && sudo cp ../config/syncSlide.conf /etc/caddy/conf.d && sudo chown root:root /etc/caddy/conf.d/syncSlide.conf && sudo systemctl reload caddy && sudo systemctl restart syncSlide"
```
