function sanitize(s) {
	return s.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

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
	const go = document.getElementById("go");
	const cueTableBody = document.getElementById("cueTableBody");
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

	document.getElementById('openEditPresentation')?.addEventListener('click', () => {
		document.getElementById('editPresentationDialog').showModal();
	});
	document.getElementById('closeEditPresentation')?.addEventListener('click', () => {
		document.getElementById('editPresentationDialog').close();
	});

	async function saveSlideTime(sid, startSeconds) {
		await fetch(`/user/recordings/${rid}/slides/${sid}/time`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: String(startSeconds),
		});
	}

	cueTableBody.addEventListener("change", async (event) => {
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
					await saveSlideTime(cueList[jIdx].id, cueList[jIdx].startTime);
					inputs[j].defaultValue = inputs[j].value;
				}
			}
			input.defaultValue = input.value;
		}

		cueList[idx].startTime = newTime;
		await saveSlideTime(cueList[idx].id, newTime);
		buildGoTo();
	});

	slidesData.addEventListener("cuechange", () => {
		const slide = slidesData.activeCues[0];
		if (!slide) return;
		const parsed = JSON.parse(slide.text);
		slidesContainer.innerHTML = parsed.content ?? parsed.data ?? '';
		goTo.value = Number(slide.startTime);
	});

	go.addEventListener('click', () => {
		const targetTime = parseFloat(goTo.value);
		video.currentTime = targetTime;
		// Also render directly — handles the no-video case and avoids waiting for cuechange
		if (slidesData.cues) {
			const cue = Array.from(slidesData.cues).find(c => c.startTime === targetTime);
			if (cue) {
				const parsed = JSON.parse(cue.text);
				slidesContainer.innerHTML = parsed.content ?? '';
			}
		}
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
