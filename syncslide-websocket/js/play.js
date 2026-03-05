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

window.addEventListener("load", () => {
	const video = document.getElementById("myVideo");
	const slidesData = video.textTracks.getTrackById("syncslide-data");
	const rate = document.getElementById("rate");
	const slidesContainer = document.getElementById("currentSlide");
	const goTo = document.getElementById("goTo");
	const go = document.getElementById("go");
	const cueTableBody = document.getElementById("cueTableBody");
	const downloadVtt = document.getElementById("downloadVtt");
	const saveVtt = document.getElementById("saveVtt");
	const cancelVtt = document.getElementById("cancelVtt");
	const shiftSubsequent = document.getElementById("shiftSubsequent");

	// cueList is the in-memory source of truth for the cue editor.
	let cueList = Array.from(slidesData.cues).map(c => ({
		startTime: c.startTime,
		text: c.text,
		title: JSON.parse(c.text).title,
	}));
	const originalCueList = cueList.map(c => ({ ...c }));
	let editingIdx = null;

	// Populate the presentation title field from the first cue's h1
	const presTitleInput = document.getElementById("presTitle");
	if (presTitleInput && cueList.length > 0) {
		const d = document.createElement('div');
		d.innerHTML = JSON.parse(cueList[0].text).content;
		presTitleInput.value = d.querySelector('h1')?.textContent ?? '';
	}

	function updateAllCueH1(newTitle) {
		cueList.forEach(c => {
			const parsed = JSON.parse(c.text);
			const d = document.createElement('div');
			d.innerHTML = parsed.content;
			const h2Text = d.querySelector('h2')?.textContent ?? '';
			const body = extractBody(parsed.content);
			parsed.content = `<h1>${escapeHtml(newTitle)}</h1><h2>${escapeHtml(h2Text)}</h2>${body}`;
			c.text = JSON.stringify(parsed);
		});
	}

	if (presTitleInput) {
		let nameDebounce = null;
		presTitleInput.addEventListener('input', () => {
			const newTitle = presTitleInput.value;
			updateAllCueH1(newTitle);
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

	// Sync time inputs (number type only) back into cueList.
	function syncTimesFromInputs() {
		Array.from(cueTableBody.querySelectorAll("input[type='number']")).forEach((input, i) => {
			cueList[i].startTime = parseFloat(input.value);
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
			const tr = document.createElement("tr");
			tr.innerHTML = `<td>${i + 1}</td><td>${c.title}</td>`
				+ `<td><input type="number" step="0.001" min="0" value="${c.startTime}" aria-label="Start time for slide ${i + 1}: ${c.title}"></td>`
				+ `<td>`
				+ `<button type="button" data-action="delete" data-idx="${i}">Delete</button> `
				+ `<button type="button" data-action="insert" data-idx="${i}">Insert after</button> `
				+ `<button type="button" data-action="edit" data-idx="${i}">Edit</button>`
				+ `</td>`;
			cueTableBody.appendChild(tr);

			if (editingIdx === i) {
				const editTr = document.createElement("tr");
				const td = document.createElement("td");
				td.colSpan = 4;

				const parsed = JSON.parse(c.text);

				const titleLabel = document.createElement("label");
				const titleInput = document.createElement("input");
				titleInput.type = "text";
				titleInput.dataset.edit = "title";
				titleInput.value = parsed.title;
				titleLabel.append("Title: ", titleInput);

				const contentLabel = document.createElement("label");
				const contentArea = document.createElement("textarea");
				contentArea.dataset.edit = "content";
				contentArea.rows = 6;
				contentArea.style.width = "100%";
				contentArea.value = extractBody(parsed.content);
				contentLabel.append("Content (HTML):", document.createElement("br"), contentArea);

				const applyBtn = document.createElement("button");
				applyBtn.type = "button";
				applyBtn.dataset.action = "apply";
				applyBtn.dataset.idx = i;
				applyBtn.textContent = "Apply";

				const closeBtn = document.createElement("button");
				closeBtn.type = "button";
				closeBtn.dataset.action = "close-edit";
				closeBtn.dataset.idx = i;
				closeBtn.textContent = "Close";

				td.append(titleLabel, document.createElement("br"), contentLabel, document.createElement("br"), applyBtn, " ", closeBtn);
				editTr.appendChild(td);
				cueTableBody.appendChild(editTr);
			}
		});
	}

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

	cueTableBody.addEventListener("click", (event) => {
		const btn = event.target.closest("button[data-action]");
		if (!btn) return;
		const idx = parseInt(btn.dataset.idx);
		const action = btn.dataset.action;

		if (action === "edit") {
			editingIdx = editingIdx === idx ? null : idx;
			renderCueTable();
			return;
		}
		if (action === "close-edit") {
			editingIdx = null;
			renderCueTable();
			return;
		}
		if (action === "apply") {
			const titleInput = cueTableBody.querySelector("[data-edit='title']");
			const contentArea = cueTableBody.querySelector("[data-edit='content']");
			const presTitle = presTitleInput ? presTitleInput.value : '';
			const parsed = JSON.parse(cueList[idx].text);
			parsed.title = titleInput.value;
			parsed.content = `<h1>${escapeHtml(presTitle)}</h1><h2>${escapeHtml(parsed.title)}</h2>${contentArea.value}`;
			cueList[idx].text = JSON.stringify(parsed);
			cueList[idx].title = parsed.title;
			editingIdx = null;
			renderCueTable();
			buildGoTo();
			return;
		}

		// delete / insert — sync times first
		syncTimesFromInputs();
		if (action === "delete") {
			if (editingIdx === idx) editingIdx = null;
			else if (editingIdx !== null && editingIdx > idx) editingIdx--;
			cueList.splice(idx, 1);
		} else if (action === "insert") {
			const nextTime = idx + 1 < cueList.length ? cueList[idx + 1].startTime : cueList[idx].startTime + 5;
			const midTime = parseFloat(((cueList[idx].startTime + nextTime) / 2).toFixed(3));
			cueList.splice(idx + 1, 0, { startTime: midTime, text: cueList[idx].text, title: cueList[idx].title });
			if (editingIdx !== null && editingIdx > idx) editingIdx++;
		}
		renderCueTable();
		buildGoTo();
	});

	function buildVtt() {
		syncTimesFromInputs();
		let vtt = "WEBVTT\n\n";
		for (let i = 0; i < cueList.length; i++) {
			const start = cueList[i].startTime;
			const end = i + 1 < cueList.length ? cueList[i + 1].startTime : video.duration;
			vtt += `${secondsToVtt(start)} --> ${secondsToVtt(end)}\n${cueList[i].text}\n\n`;
		}
		return vtt;
	}

	downloadVtt.addEventListener("click", () => {
		const a = document.createElement("a");
		a.href = "data:text/vtt;charset=utf-8," + encodeURIComponent(buildVtt());
		a.download = "recording-adjusted.vtt";
		document.body.appendChild(a);
		a.click();
		a.remove();
	});

	saveVtt.addEventListener("click", async () => {
		const rid = video.dataset.rid;
		const resp = await fetch(`/user/recordings/${rid}/slides_vtt`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: buildVtt(),
		});
		if (resp.ok) location.reload();
	});

	cancelVtt.addEventListener("click", () => {
		cueList = originalCueList.map(c => ({ ...c }));
		editingIdx = null;
		renderCueTable();
		buildGoTo();
	});

	slidesData.addEventListener("cuechange", (event) => {
		const slide = slidesData.activeCues[0];
		if (!slide) return;
		slidesContainer.innerHTML = JSON.parse(slide.text).content;
		goTo.value = Number(slide.startTime);
	});

	go.onclick = function() {
		video.currentTime = goTo.value;
	};

	rate.onchange = function() {
		video.playbackRate = rate.value;
	};
});
