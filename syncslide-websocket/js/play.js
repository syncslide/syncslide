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

	// set the dropdown with the options from the VTT file
	for (const i of Array(slidesData.cues.length).keys()) {
		const cue = slidesData.cues[i];
		const e = JSON.parse(cue.text);
		const newOption = document.createElement('option');
		newOption.value = cue.startTime;
		newOption.innerText = e.title + ": " + cue.startTime + "s";
		goTo.appendChild(newOption);

		const tr = document.createElement("tr");
		tr.innerHTML = `<td>${i + 1}</td><td>${e.title}</td><td><input type="number" step="0.001" min="0" value="${cue.startTime}" aria-label="Start time for slide ${i + 1}: ${e.title}"></td>`;
		cueTableBody.appendChild(tr);
	}

	downloadVtt.addEventListener("click", () => {
		const cues = Array.from(slidesData.cues);
		const inputs = Array.from(cueTableBody.querySelectorAll("input"));
		const newTimes = inputs.map(i => parseFloat(i.value));
		let vtt = "WEBVTT\n\n";
		for (let i = 0; i < cues.length; i++) {
			const start = newTimes[i];
			const end = i + 1 < newTimes.length ? newTimes[i + 1] : video.duration;
			vtt += `${secondsToVtt(start)} --> ${secondsToVtt(end)}\n${cues[i].text}\n\n`;
		}
		const a = document.createElement("a");
		a.href = "data:text/vtt;charset=utf-8," + encodeURIComponent(vtt);
		a.download = "recording-adjusted.vtt";
		document.body.appendChild(a);
		a.click();
		a.remove();
	});

	slidesData.addEventListener("cuechange", (event) => {
		const slide = slidesData.activeCues[0];
		// do nothing if the active cues are not set (for some reason)
		if (!slide) {
			return;
		}
		const data = JSON.parse(slide.text);
		slidesContainer.innerHTML = data.data;
		goTo.value = Number(slide.startTime);
	});

	go.onclick = function() {
		video.currentTime = goTo.value
	}

	rate.onchange = function() {
		video.playbackRate = rate.value;
	};
});
