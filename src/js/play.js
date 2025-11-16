// wait until ALL content is loaded (subtitles, for example, must be loaded before the function can run)
window.addEventListener("load", () => {
	const video = document.getElementById("myVideo");
	const slidesData = video.textTracks.getTrackById("syncslide-data");
	const rate = document.getElementById("rate");
	const slidesContainer = document.getElementById("currentSlide");
	const goTo = document.getElementById("goTo");
	const go = document.getElementById("go");

	// set the dropdown with the options from the VTT file
	for (const i of Array(slidesData.cues.length).keys()) {
		const cue = slidesData.cues[i];
		const e = JSON.parse(cue.text);
		const newOption = document.createElement('option');
		newOption.value = cue.startTime;
		newOption.innerText = e.title + ": " + cue.startTime + "s";
		goTo.appendChild(newOption);
	}

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
