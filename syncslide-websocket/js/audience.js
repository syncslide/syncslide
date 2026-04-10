const qrToggleBtn = document.getElementById('qrToggle');
const qrOverlay = document.getElementById('qrOverlay');
if (qrToggleBtn && qrOverlay) {
	qrToggleBtn.addEventListener('click', () => {
		const pressed = qrToggleBtn.getAttribute('aria-pressed') === 'true';
		qrToggleBtn.setAttribute('aria-pressed', String(!pressed));
		qrOverlay.hidden = pressed;
	});
}

let TEXT_TO_RENDER = "";
const presNameEl = document.getElementById('pres-name');
function getPresName() { return presNameEl ? presNameEl.textContent.trim() : ''; }

function stringToDOM(htmlString) {
	var tempElement = document.createElement('div');
	tempElement.innerHTML = DOMPurify.sanitize(htmlString.trim());
return tempElement;
}

const handleUpdate = (message) => {
	try {
		message = JSON.parse(message.data);
	} catch (e) {
		return;
	}
	if (message.type && message.type.startsWith('recording_')) {
		if (typeof handleRecordingMessage === 'function') {
			handleRecordingMessage(message.type, message.data || {});
		}
		return;
	}
	if (message.type === "text") {
		TEXT_TO_RENDER = message.data;
		return;
	}
	if (message.type === "name") {
		if (presNameEl) presNameEl.textContent = message.data;
		const slideH1 = document.querySelector('#currentSlide h1');
		if (slideH1) slideH1.textContent = message.data;
		const mdLabel = document.querySelector('label[for="markdown-input"]');
		if (mdLabel) mdLabel.textContent = message.data;
		const mode = window.presPageMode;
		document.title = mode === 'stage'
		    ? `${message.data} \u2013 Stage - SyncSlide`
		    : mode === 'edit'
		    ? `${message.data} \u2013 Edit - SyncSlide`
		    : `${message.data} - SyncSlide`;
		return;
	}
	const slideIndex = message.data;
	const htmlString = md.render(TEXT_TO_RENDER);
	const allHtml = stringToDOM(htmlString);
	if (typeof getH2s === 'function') {
		getH2s(allHtml)
	}
	const newHtml = addSiblings(allHtml)[slideIndex];
	const htmlOutput = document.getElementById("currentSlide");
	if (!htmlOutput) return;
	htmlOutput.innerHTML = "";
	const presName = getPresName();
	if (presName) {
		const h1 = document.createElement('h1');
		h1.textContent = presName;
		htmlOutput.appendChild(h1);
	}
	for (let nh of newHtml) {
		htmlOutput.appendChild(nh);
	}
	updateRender();
	markExternalLinks(htmlOutput);
}

wsRegisterMessageHandler(handleUpdate);

