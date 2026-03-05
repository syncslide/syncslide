function secondsToVtt(s) {
	const ms = Math.round((s % 1) * 1000);
	const total = Math.floor(s);
	const secs = total % 60;
	const mins = Math.floor(total / 60) % 60;
	const hrs = Math.floor(total / 3600);
	return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

// wait until ALL content is loaded (subtitles, for example, must be loaded before the function can run)
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

	// original times captured at load, used by Cancel
	const originalTimes = [];

	// set the dropdown with the options from the VTT file
	for (const i of Array(slidesData.cues.length).keys()) {
		const cue = slidesData.cues[i];
		const e = JSON.parse(cue.text);
		originalTimes.push(cue.startTime);

		const newOption = document.createElement('option');
		newOption.value = cue.startTime;
		newOption.innerText = e.title + ": " + cue.startTime + "s";
		goTo.appendChild(newOption);

		const tr = document.createElement("tr");
		tr.innerHTML = `<td>${i + 1}</td><td>${e.title}</td><td><input type="number" step="0.001" min="0" value="${cue.startTime}" aria-label="Start time for slide ${i + 1}: ${e.title}"></td>`;
		cueTableBody.appendChild(tr);
	}

	cueTableBody.addEventListener("change", (event) => {
		if (!shiftSubsequent || !shiftSubsequent.checked) return;
		const input = event.target;
		if (input.tagName !== "INPUT") return;
		const inputs = Array.from(cueTableBody.querySelectorAll("input"));
		const idx = inputs.indexOf(input);
		if (idx < 0) return;
		const oldValue = parseFloat(input.defaultValue);
		const newValue = parseFloat(input.value);
		const delta = newValue - oldValue;
		if (delta === 0) return;
		for (let j = idx + 1; j < inputs.length; j++) {
			inputs[j].value = Math.max(0, parseFloat(inputs[j].value) + delta).toFixed(3);
			inputs[j].defaultValue = inputs[j].value;
		}
		input.defaultValue = input.value;
	});

	function buildVtt() {
		const cues = Array.from(slidesData.cues);
		const inputs = Array.from(cueTableBody.querySelectorAll("input"));
		const newTimes = inputs.map(i => parseFloat(i.value));
		let vtt = "WEBVTT\n\n";
		for (let i = 0; i < cues.length; i++) {
			const start = newTimes[i];
			const end = i + 1 < newTimes.length ? newTimes[i + 1] : video.duration;
			vtt += `${secondsToVtt(start)} --> ${secondsToVtt(end)}\n${cues[i].text}\n\n`;
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
		// Capture everything synchronously before the fetch so order is guaranteed
		const cues = Array.from(slidesData.cues);
		const inputs = Array.from(cueTableBody.querySelectorAll("input"));
		const newTimes = inputs.map(inp => parseFloat(inp.value));
		const titles = cues.map(c => JSON.parse(c.text).title);

		const rid = video.dataset.rid;
		const resp = await fetch(`/user/recordings/${rid}/slides_vtt`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: buildVtt(),
		});
		if (!resp.ok) return;

		// Update cue boundaries in-place so cuechange fires at the right times
		for (let i = 0; i < cues.length; i++) {
			cues[i].startTime = newTimes[i];
			cues[i].endTime = i + 1 < newTimes.length ? newTimes[i + 1] : video.duration;
		}

		// Rebuild the go-to dropdown with updated timestamps
		goTo.innerHTML = '';
		for (let i = 0; i < cues.length; i++) {
			goTo.add(new Option(titles[i] + ": " + newTimes[i] + "s", String(newTimes[i])));
		}

		// Re-render whichever slide is active right now
		const t = video.currentTime;
		const active = cues.find(c => c.startTime <= t && t < c.endTime);
		if (active) {
			slidesContainer.innerHTML = JSON.parse(active.text).content;
			goTo.value = String(active.startTime);
		}

		// Update bookkeeping
		inputs.forEach((input, i) => {
			originalTimes[i] = newTimes[i];
			input.defaultValue = input.value;
		});
	});

	cancelVtt.addEventListener("click", () => {
		const inputs = Array.from(cueTableBody.querySelectorAll("input"));
		inputs.forEach((input, i) => {
			input.value = originalTimes[i];
			input.defaultValue = String(originalTimes[i]);
		});
	});

	slidesData.addEventListener("cuechange", (event) => {
		const slide = slidesData.activeCues[0];
		// do nothing if the active cues are not set (for some reason)
		if (!slide) {
			return;
		}
		const data = JSON.parse(slide.text);
		slidesContainer.innerHTML = data.content;
		goTo.value = Number(slide.startTime);
	});

	go.onclick = function() {
		video.currentTime = goTo.value
	}

	rate.onchange = function() {
		video.playbackRate = rate.value;
	};
});
