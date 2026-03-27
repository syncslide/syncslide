// Server-side recording client.
// Listens for recording state messages over the shared WebSocket (set up by common.js)
// and updates the stage recording UI. Sends control messages when buttons are clicked.

(function () {
  const statusEl = document.getElementById('rec-status');
  const timerEl = document.getElementById('rec-timer');
  const announceEl = document.getElementById('rec-announce');
  const btnStart = document.getElementById('recordStart');
  const btnPause = document.getElementById('recordPause');
  const btnResume = document.getElementById('recordResume');
  const btnStop = document.getElementById('recordStop');

  if (!statusEl) return; // not on stage page

  let timerInterval = null;
  let announceTimeout = null;
  let elapsedMs = 0;

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return String(h).padStart(2, '0') + ':' +
           String(m).padStart(2, '0') + ':' +
           String(s).padStart(2, '0');
  }

  function announce(message) {
    clearTimeout(announceTimeout);
    announceEl.textContent = message;
    announceTimeout = setTimeout(function () { announceEl.textContent = ''; }, 3000);
  }

  function startTimer(fromMs) {
    elapsedMs = fromMs;
    clearInterval(timerInterval);
    const startedAt = Date.now() - fromMs;
    timerInterval = setInterval(function () {
      elapsedMs = Date.now() - startedAt;
      timerEl.textContent = formatTime(elapsedMs);
    }, 1000);
    timerEl.textContent = formatTime(elapsedMs);
  }

  function stopTimer(freezeAt) {
    clearInterval(timerInterval);
    timerInterval = null;
    if (freezeAt !== undefined) {
      elapsedMs = freezeAt;
      timerEl.textContent = formatTime(elapsedMs);
    }
  }

  function setRunning(fromMs, message) {
    statusEl.textContent = 'Recording';
    btnStart.hidden = true;
    btnPause.hidden = false;
    btnResume.hidden = true;
    btnStop.hidden = false;
    startTimer(fromMs);
    announce(message);
  }

  function setPaused(atMs) {
    statusEl.textContent = 'Paused';
    btnStart.hidden = true;
    btnPause.hidden = true;
    btnResume.hidden = false;
    btnStop.hidden = false;
    stopTimer(atMs);
    announce('Recording paused');
  }

  function setStopped() {
    statusEl.textContent = 'Stopped';
    btnStart.hidden = false;
    btnPause.hidden = true;
    btnResume.hidden = true;
    btnStop.hidden = true;
    stopTimer(0);
    timerEl.textContent = '00:00:00';
    announce('Recording stopped');
  }

  const sectionEl = document.getElementById('record-section');
  const toggleEl = document.getElementById('record-toggle');

  function expandSection() {
    if (sectionEl && sectionEl.hidden) {
      sectionEl.hidden = false;
      if (toggleEl) toggleEl.setAttribute('aria-expanded', 'true');
    }
  }

  // Handle incoming WS messages
  window.handleRecordingMessage = function (type, data) {
    expandSection();
    if (type === 'recording_start') {
      setRunning(data.elapsed_ms, 'Recording started');
    } else if (type === 'recording_pause') {
      setPaused(data.elapsed_ms);
    } else if (type === 'recording_resume') {
      setRunning(data.elapsed_ms, 'Recording resumed');
    } else if (type === 'recording_stop') {
      setStopped();
    }
  };

  function send(type) {
    if (typeof socket !== 'undefined' && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: type }));
    }
  }

  btnStart.addEventListener('click', function () { send('recording_start'); });
  btnPause.addEventListener('click', function () { send('recording_pause'); });
  btnResume.addEventListener('click', function () { send('recording_resume'); });
  btnStop.addEventListener('click', function () { send('recording_stop'); });
}());
