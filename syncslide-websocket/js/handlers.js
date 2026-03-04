function getH2s(allHtml) {
	const goTo = document.getElementById("goTo");
	const oldSelection = goTo.value;
	goTo.innerHTML = "";
	const h2s = allHtml.querySelectorAll('h2');
	for (const [i, e] of h2s.entries()) {
		const newOption = document.createElement('option');
		// make sure to preserve the index of the slide selection
		if (i == oldSelection) {
			newOption.selected = true;
		}
		newOption.value = i;
		newOption.innerText = (i+1) + ": " + e.innerText;
		goTo.appendChild(newOption);
	}
}

const updateSlide = async () => {
	const slideChoice = document.getElementById("goTo").value;
	socket.send(JSON.stringify({ type: "slide", data: Number(slideChoice) }));
}

const updateMarkdown = async () => {
	const markdownInput = document.getElementById("markdown-input").value;
	const render = md.render(markdownInput);
	const dom = stringToDOM(render);
	getH2s(dom);
	socket.send(JSON.stringify({ type: "text", data: markdownInput }));
}

const textInput = document.getElementById("markdown-input");
textInput.addEventListener("blur", updateMarkdown);

update = document.getElementById("update");
update.addEventListener("click", updateSlide);
