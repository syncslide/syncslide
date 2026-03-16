function escapeHtml(str) {
	const d = document.createElement('div');
	d.textContent = str;
	return d.innerHTML;
}

window.addEventListener("load", () => {
	const video = document.getElementById("myVideo");
	const slidesData = video.textTracks.getTrackById("syncslide-data");
	const rate = document.getElementById("rate");
	const slidesContainer = document.getElementById("currentSlide");
	const goTo = document.getElementById("goTo");
	const cueTableBody = document.getElementById("cueTableBody");

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
			}
		}
	}

	const shiftSubsequent = document.getElementById("shiftSubsequent");
	const rid = video.dataset.rid;

	let cueList = [];

	function buildGoTo() {
		goTo.innerHTML = '';
		for (const c of cueList) {
			goTo.add(new Option(c.title + ": " + c.startTime + "s", String(c.startTime)));
		}
	}

	function renderCueTable() {
		cueTableBody.innerHTML = '';
		cueList.forEach((c, i) => {
			const tr = document.createElement("tr");
			tr.innerHTML = `<th scope="row">${i + 1}</th>`
				+ `<td>${escapeHtml(c.title)}</td>`
				+ `<td><input type="number" step="0.001" min="0" value="${c.startTime}" data-idx="${i}" aria-label="Start time for slide ${i + 1}: ${escapeHtml(c.title)}"></td>`;
			cueTableBody.appendChild(tr);
		});
	}

	function initFromCues() {
		if (!slidesData.cues || slidesData.cues.length === 0) return;
		cueList = Array.from(slidesData.cues).map(c => {
			const parsed = JSON.parse(c.text);
			return { startTime: c.startTime, id: parsed.id, title: parsed.title };
		});
		buildGoTo();
		renderCueTable();
	}

	initFromCues();
	if (cueList.length === 0) {
		// Cues not loaded yet (common when no video source) — force load and wait
		slidesData.mode = 'hidden';
		slidesData.addEventListener('load', initFromCues);
	}

	const editPresentationDialog = document.getElementById('editPresentationDialog');
	const saveTimingDialog = document.getElementById('saveTimingDialog');
	const pendingChanges = new Set();

	document.getElementById('openEditPresentation')?.addEventListener('click', () => {
		editPresentationDialog.showModal();
	});

	document.getElementById('closeEditPresentation')?.addEventListener('click', () => {
		if (pendingChanges.size > 0) {
			saveTimingDialog.showModal();
		} else {
			editPresentationDialog.close();
		}
	});

	async function saveSlideTime(sid, startSeconds) {
		await fetch(`/user/recordings/${rid}/slides/${sid}/time`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: String(startSeconds),
		});
	}

	document.getElementById('saveTimingConfirm')?.addEventListener('click', async () => {
		for (const idx of pendingChanges) {
			await saveSlideTime(cueList[idx].id, cueList[idx].startTime);
		}
		pendingChanges.clear();
		saveTimingDialog.close();
		editPresentationDialog.close();
		location.reload();
	});

	document.getElementById('discardTimingConfirm')?.addEventListener('click', () => {
		const inputs = Array.from(cueTableBody.querySelectorAll("input[type='number']"));
		for (const idx of pendingChanges) {
			const input = inputs.find(i => parseInt(i.dataset.idx) === idx);
			if (input) {
				input.value = input.defaultValue;
				cueList[idx].startTime = parseFloat(input.defaultValue);
			}
		}
		pendingChanges.clear();
		buildGoTo();
		saveTimingDialog.close();
		editPresentationDialog.close();
	});

	cueTableBody.addEventListener("change", (event) => {
		const input = event.target;
		if (input.type !== "number") return;

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
		buildGoTo();
	});

	slidesData.addEventListener("cuechange", () => {
		const slide = slidesData.activeCues[0];
		if (!slide) return;
		const parsed = JSON.parse(slide.text);
		slidesContainer.innerHTML = parsed.content ?? parsed.data ?? '';
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
				video.currentTime = cueList[current - 1].startTime;
			}
		} else {
			if (current < max) {
				goTo.value = String(cueList[current + 1].startTime);
				video.currentTime = cueList[current + 1].startTime;
			}
		}
	});

	rate?.addEventListener('change', () => {
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
			const resp = await fetch(`/user/recordings/${rid}/files`, {
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
