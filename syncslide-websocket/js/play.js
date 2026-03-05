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
	// originalCueList is a snapshot used by Cancel to undo all changes.
	let cueList = Array.from(slidesData.cues).map(c => ({
		startTime: c.startTime,
		text: c.text,
		title: JSON.parse(c.text).title,
	}));
	let originalCueList = cueList.map(c => ({ ...c }));

	// Sync edited input values back into cueList before any structural operation.
	function syncTimesFromInputs() {
		Array.from(cueTableBody.querySelectorAll("input")).forEach((input, i) => {
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
				+ `<td><button type="button" data-action="delete" data-idx="${i}">Delete</button>`
				+ ` <button type="button" data-action="insert" data-idx="${i}">Insert after</button></td>`;
			cueTableBody.appendChild(tr);
		});
	}

	buildGoTo();
	renderCueTable();

	// Shift-subsequent on time input change
	cueTableBody.addEventListener("change", (event) => {
		if (!shiftSubsequent || !shiftSubsequent.checked) return;
		const input = event.target;
		if (input.tagName !== "INPUT") return;
		const inputs = Array.from(cueTableBody.querySelectorAll("input"));
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

	// Delete / Insert after buttons
	cueTableBody.addEventListener("click", (event) => {
		const btn = event.target.closest("button[data-action]");
		if (!btn) return;
		syncTimesFromInputs();
		const idx = parseInt(btn.dataset.idx);
		if (btn.dataset.action === "delete") {
			cueList.splice(idx, 1);
		} else if (btn.dataset.action === "insert") {
			const nextTime = idx + 1 < cueList.length ? cueList[idx + 1].startTime : cueList[idx].startTime + 5;
			const midTime = parseFloat(((cueList[idx].startTime + nextTime) / 2).toFixed(3));
			cueList.splice(idx + 1, 0, { startTime: midTime, text: cueList[idx].text, title: cueList[idx].title });
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
