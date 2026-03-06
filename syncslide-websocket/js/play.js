function escapeHtml(str) {
	const d = document.createElement('div');
	d.textContent = str;
	return d.innerHTML;
}

function extractBody(html) {
	const d = document.createElement('div');
	d.innerHTML = html;
	d.querySelector('h1')?.remove();
	d.querySelector('h2')?.remove();
	return d.innerHTML.trim();
}

function secondsToVtt(s) {
	const ms = Math.round((s % 1) * 1000);
	const total = Math.floor(s);
	const secs = total % 60;
	const mins = Math.floor(total / 60) % 60;
	const hrs = Math.floor(total / 3600);
	return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

function sanitize(s) {
	return s.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

window.addEventListener("load", () => {
	const video = document.getElementById("myVideo");
	const slidesData = video.textTracks.getTrackById("syncslide-data");
	const rate = document.getElementById("rate");
	const slidesContainer = document.getElementById("currentSlide");
	const goTo = document.getElementById("goTo");
	const go = document.getElementById("go");
	const cueTableBody = document.getElementById("cueTableBody");
	const downloadVtt = document.getElementById("downloadVtt");
	const shiftSubsequent = document.getElementById("shiftSubsequent");

	// cueList is the in-memory source of truth for the cue editor.
	let cueList = Array.from(slidesData.cues).map(c => ({
		startTime: c.startTime,
		text: c.text,
		title: JSON.parse(c.text).title,
	}));
	const originalCueList = cueList.map(c => ({ ...c }));

	// Populate the presentation title field from the first cue's h1
	const presTitleInput = document.getElementById("presTitle");
	if (presTitleInput && cueList.length > 0) {
		const d = document.createElement('div');
		const first = JSON.parse(cueList[0].text);
		d.innerHTML = first.content ?? first.data ?? '';
		presTitleInput.value = d.querySelector('h1')?.textContent ?? '';
	}
	const originalPresTitle = presTitleInput?.value ?? '';

	function updateAllCueH1(newTitle) {
		cueList.forEach(c => {
			const parsed = JSON.parse(c.text);
			const html = parsed.content ?? parsed.data ?? '';
			const d = document.createElement('div');
			d.innerHTML = html;
			const h2Text = d.querySelector('h2')?.textContent ?? '';
			const body = extractBody(html);
			parsed.content = `<h1>${escapeHtml(newTitle)}</h1><h2>${escapeHtml(h2Text)}</h2>${body}`;
			c.text = JSON.stringify(parsed);
		});
	}

	if (presTitleInput) {
		let nameDebounce = null;
		presTitleInput.addEventListener('input', () => {
			const newTitle = presTitleInput.value;
			updateAllCueH1(newTitle);
			document.title = `Watch Recording: ${newTitle} - SyncSlide`;
			clearTimeout(nameDebounce);
			nameDebounce = setTimeout(async () => {
				const rid = video.dataset.rid;
				await fetch(`/user/recordings/${rid}/name`, {
					method: 'POST',
					headers: { 'Content-Type': 'text/plain' },
					body: newTitle,
				});
			}, 500);
		});
	}

	// Sync all inline inputs back into cueList.
	function syncFromInputs() {
		const presTitle = presTitleInput ? presTitleInput.value : '';
		const timeInputs = Array.from(cueTableBody.querySelectorAll("input[type='number']"));
		const titleInputs = Array.from(cueTableBody.querySelectorAll("input[data-edit='title']"));
		const contentAreas = Array.from(cueTableBody.querySelectorAll("textarea[data-edit='content']"));
		timeInputs.forEach((input, i) => {
			cueList[i].startTime = parseFloat(input.value);
		});
		titleInputs.forEach((input, i) => {
			const parsed = JSON.parse(cueList[i].text);
			parsed.title = input.value;
			parsed.content = `<h1>${escapeHtml(presTitle)}</h1><h2>${escapeHtml(input.value)}</h2>${contentAreas[i].value}`;
			cueList[i].text = JSON.stringify(parsed);
			cueList[i].title = parsed.title;
		});
	}

	function buildGoTo() {
		goTo.innerHTML = '';
		for (const c of cueList) {
			goTo.add(new Option(c.title + ": " + c.startTime + "s", String(c.startTime)));
		}
	}

	function renderCueTable() {
		cueTableBody.innerHTML = '';
		cueList.forEach((c, i) => {
			const parsed = JSON.parse(c.text);
			const bodyContent = extractBody(parsed.content ?? parsed.data ?? '');
			const tr = document.createElement("tr");
			tr.innerHTML = `<th scope="row">${i + 1}</th>`
				+ `<td><input type="text" data-edit="title" data-idx="${i}" value="${escapeHtml(c.title)}" aria-label="Title for slide ${i + 1}"></td>`
				+ `<td><textarea data-edit="content" data-idx="${i}" rows="3" aria-label="Content for slide ${i + 1}"></textarea></td>`
				+ `<td><input type="number" step="0.001" min="0" value="${c.startTime}" aria-label="Start time for slide ${i + 1}: ${escapeHtml(c.title)}"></td>`
				+ `<td><select data-idx="${i}" aria-label="Actions for slide ${i + 1}">`
				+ `<option value="" selected>--</option>`
				+ `<option value="insert">Insert</option>`
				+ `<option value="delete">Delete</option>`
				+ `</select></td>`;
			tr.querySelector(`textarea[data-idx="${i}"]`).value = bodyContent;
			cueTableBody.appendChild(tr);
		});
	}

	const editPresentationDialog = document.getElementById('editPresentationDialog');
	const saveDiscardDialog = document.getElementById('saveDiscardDialog');

	function hasChanges() {
		syncFromInputs();
		if (presTitleInput && presTitleInput.value !== originalPresTitle) return true;
		return JSON.stringify(cueList) !== JSON.stringify(originalCueList);
	}

	async function saveChanges() {
		const rid = video.dataset.rid;
		const resp = await fetch(`/user/recordings/${rid}/slides_vtt`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: buildVtt(),
		});
		if (resp.ok) location.reload();
	}

	function discardChanges() {
		cueList = originalCueList.map(c => ({ ...c }));
		renderCueTable();
		buildGoTo();
	}

	document.getElementById('openEditPresentation')?.addEventListener('click', () => {
		editPresentationDialog.showModal();
	});

	document.getElementById('closeEditPresentation')?.addEventListener('click', () => {
		if (!hasChanges()) { editPresentationDialog.close(); return; }
		saveDiscardDialog.showModal();
	});

	editPresentationDialog?.addEventListener('cancel', (e) => {
		if (!hasChanges()) return;
		e.preventDefault();
		saveDiscardDialog.showModal();
	});

	document.getElementById('saveAndClose')?.addEventListener('click', async () => {
		saveDiscardDialog.close();
		await saveChanges();
	});

	document.getElementById('discardAndClose')?.addEventListener('click', () => {
		discardChanges();
		saveDiscardDialog.close();
		editPresentationDialog.close();
	});

	buildGoTo();
	renderCueTable();

	// Shift-subsequent on time input change
	cueTableBody.addEventListener("change", (event) => {
		if (!shiftSubsequent || !shiftSubsequent.checked) return;
		const input = event.target;
		if (input.type !== "number") return;
		const inputs = Array.from(cueTableBody.querySelectorAll("input[type='number']"));
		const idx = inputs.indexOf(input);
		if (idx < 0) return;
		const delta = parseFloat(input.value) - parseFloat(input.defaultValue);
		if (delta === 0) return;
		for (let j = idx + 1; j < inputs.length; j++) {
			inputs[j].value = Math.max(0, parseFloat(inputs[j].value) + delta).toFixed(3);
			inputs[j].defaultValue = inputs[j].value;
		}
		input.defaultValue = input.value;
	});

	const cueInsertDialog = document.getElementById('cueInsertDialog');
	let insertRefIdx = null;

	function executeCueAction(sel) {
		const idx = parseInt(sel.dataset.idx);
		const action = sel.value;
		if (!action) return;
		sel.value = '';
		if (action === 'insert') {
			insertRefIdx = idx;
			document.querySelector('input[name="cueInsertPos"][value="after"]').checked = true;
			cueInsertDialog.showModal();
			return;
		}
		if (action === 'delete') {
			syncFromInputs();
			cueList.splice(idx, 1);
			renderCueTable();
			buildGoTo();
		}
	}

	if (cueInsertDialog) {
		document.getElementById('cueInsertApply').addEventListener('click', () => {
			const pos = document.querySelector('input[name="cueInsertPos"]:checked').value;
			syncFromInputs();
			const idx = insertRefIdx;
			const insertAt = pos === 'before' ? idx : idx + 1;
			const prevTime = insertAt > 0 ? cueList[insertAt - 1].startTime : 0;
			const nextTime = insertAt < cueList.length ? cueList[insertAt].startTime : cueList[insertAt - 1].startTime + 5;
			const midTime = parseFloat(((prevTime + nextTime) / 2).toFixed(3));
			cueList.splice(insertAt, 0, { startTime: midTime, text: cueList[idx].text, title: cueList[idx].title });
			renderCueTable();
			buildGoTo();
			cueInsertDialog.close();
		});
		document.getElementById('cueInsertCancel').addEventListener('click', () => {
			cueInsertDialog.close();
		});
	}

	cueTableBody.addEventListener('focusout', (e) => {
		const sel = e.target.closest('select[data-idx]');
		if (sel) executeCueAction(sel);
	});
	cueTableBody.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter') return;
		const sel = e.target.closest('select[data-idx]');
		if (sel) executeCueAction(sel);
	});
	if (window.matchMedia('(pointer: coarse)').matches) {
		cueTableBody.addEventListener('change', (e) => {
			const sel = e.target.closest('select[data-idx]');
			if (sel) executeCueAction(sel);
		});
	}

	function buildVtt() {
		syncFromInputs();
		let vtt = "WEBVTT\n\n";
		for (let i = 0; i < cueList.length; i++) {
			const start = cueList[i].startTime;
			const end = i + 1 < cueList.length ? cueList[i + 1].startTime : video.duration;
			vtt += `${secondsToVtt(start)} --> ${secondsToVtt(end)}\n${cueList[i].text}\n\n`;
		}
		return vtt;
	}

	downloadVtt.addEventListener("click", () => {
		const parts = window.location.pathname.split('/');
		const uname = sanitize(parts[1] ?? '');
		const presName = sanitize(presTitleInput?.value ?? '');
		const recName = sanitize(video.dataset.recordingName ?? '');
		const filename = [uname, presName, recName].filter(Boolean).join('_') + '.vtt';
		const a = document.createElement("a");
		a.href = "data:text/vtt;charset=utf-8," + encodeURIComponent(buildVtt());
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
	});

	slidesData.addEventListener("cuechange", (event) => {
		const slide = slidesData.activeCues[0];
		if (!slide) return;
		const parsed = JSON.parse(slide.text);
		slidesContainer.innerHTML = parsed.content ?? parsed.data ?? '';
		goTo.value = Number(slide.startTime);
	});

	go.addEventListener('click', () => {
		video.currentTime = goTo.value;
	});

	document.addEventListener("keydown", (e) => {
		if (e.key !== "F8") return;
		e.preventDefault();
		const current = Array.from(goTo.options).findIndex(o => o.selected);
		const max = goTo.options.length - 1;
		if (e.shiftKey) {
			if (current > 0) video.currentTime = cueList[current - 1].startTime;
		} else {
			if (current < max) video.currentTime = cueList[current + 1].startTime;
		}
	});

	rate.addEventListener('change', () => {
		video.playbackRate = rate.value;
	});

	const replaceFilesDialog = document.getElementById('replaceFilesDialog');
	const replaceFilesForm = document.getElementById('replaceFilesForm');
	if (replaceFilesDialog && replaceFilesForm) {
		document.getElementById('openReplaceFiles').addEventListener('click', () => {
			replaceFilesDialog.showModal();
		});
		document.getElementById('cancelReplaceFiles').addEventListener('click', () => {
			replaceFilesDialog.close();
		});
		replaceFilesForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const resp = await fetch(`/user/recordings/${video.dataset.rid}/files`, {
				method: 'POST',
				body: new FormData(e.target),
			});
			if (resp.ok) {
				replaceFilesForm.reset();
				replaceFilesDialog.close();
				location.reload();
			}
		});
	}
});
