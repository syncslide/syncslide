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
				slidesContainer.innerHTML = DOMPurify.sanitize(parsed.content ?? parsed.data ?? '');
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
