let recording = false;
let paused = false;
let startTime;
let elapsedTime = 0;
let timerInterval;
let recordingData = [];

const recordPauseButton = document.getElementById("recordPause");
const stopButton = document.getElementById("stop");
const updateButton = document.getElementById("update");
const timer = document.getElementById("timer");

recordPauseButton.addEventListener("click", () => {
	if (!recording) {
		startRecording();
	} else {
		paused ? resumeRecording() : pauseRecording();
	}
});

stopButton.addEventListener("click", downloadRecording);

function startRecording() {
	recording = true;
	paused = false;
	startTime = Date.now() - elapsedTime;
	timerInterval = setInterval(updateTimer, 100);
	recordPauseButton.innerText = "Pause";
}

function pauseRecording() {
	paused = true;
	clearInterval(timerInterval);
	elapsedTime = Date.now() - startTime;
	recordPauseButton.innerText = "Resume";
}

function resumeRecording() {
	paused = false;
	startTime = Date.now() - elapsedTime;
	timerInterval = setInterval(updateTimer, 1000);
	recordPauseButton.innerText = "Pause";
}

function stopRecording() {
	clearInterval(timerInterval);
	recording = false;
	paused = false;
	elapsedTime = 0;
	timer.innerText = "00:00:00.000";
	recordPauseButton.innerText = "Record";
	downloadRecording();
}

function updateTimer() {
	const currentTime = Date.now() - startTime;
	timer.innerText = formatTime(currentTime);
}

function formatTime(ms) {
	const msOver = ms % 1000;
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(msOver).padStart(3, '0')}`;
}

function saveCurrentState() {
	if (recording && !paused) {
		const currentTime = Date.now() - startTime;
		const slide = document.getElementById("goTo").value;
		const slideTitle = document.getElementById("currentSlide").querySelector('h2').innerText;
		const slideContent = document.getElementById("currentSlide").innerHTML;
		recordingData.push({ time: parseFloat(currentTime), slide: slide, title: slideTitle, content: slideContent });
	}
}
window.saveCurrentState = saveCurrentState

function webvttRecording() {
	console.log(recordingData);
	let vtt = "WEBVTT\n\n"
	const final_time = formatTime(elapsedTime);
	for (let i = 0; i < recordingData.length; i++) {
		const entry = recordingData[i];
		const cur_time = formatTime(recordingData[i].time);
		let next_time = undefined;
		if (i+1 < recordingData.length) {
			next_time = formatTime(recordingData[i+1].time);
		} else {
			next_time = final_time;
		}
		const json = JSON.stringify(entry);
		const cueText = `${cur_time} --> ${next_time}\n${json}\n\n`
		vtt += cueText;
	}
	return vtt;
}

function downloadRecording() {
	const dataStr = "data:text/vtt;charset=utf-8," + encodeURIComponent(webvttRecording(recordingData));
	const downloadAnchorNode = document.createElement('a');
	downloadAnchorNode.setAttribute("href", dataStr);
	downloadAnchorNode.setAttribute("download", "recording.vtt");
	document.body.appendChild(downloadAnchorNode);
	downloadAnchorNode.click();
	downloadAnchorNode.remove();
	recordingData = [];
}
