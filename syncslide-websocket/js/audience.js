let TEXT_TO_RENDER = "";

function is_stage() {
	window.location.href.endsWith("stage/")
}

function stringToDOM(htmlString) {
	var tempElement = document.createElement('div');
	tempElement.innerHTML = htmlString.trim();
return tempElement;
}

const handleUpdate = (message) => {
	message = JSON.parse(message.data);
	if (message.type === "text") {
		TEXT_TO_RENDER = message.data;
		return;
	}
	const slideIndex = message.data;
	const htmlString = md.render(TEXT_TO_RENDER);
	allHtml = stringToDOM(htmlString);
	if (is_stage()) {
		getH2s(allHtml)
	}
	newHtml = addSiblings(allHtml)[slideIndex];
	const htmlOutput = document.getElementById("currentSlide");
	htmlOutput.innerHTML = "";
	htmlOutput.appendChild(allHtml.querySelector('h1'));
	for (nh of newHtml) {
		htmlOutput.appendChild(nh);
	}
	updateRender();
saveCurrentState();
}

socket.onmessage = handleUpdate
