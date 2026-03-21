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

// For a SELECT, onCommit (defined in handlers.js) is exactly addEventListener('input', fn).
// Using addEventListener directly here avoids a cross-file dependency.
const goTo = document.getElementById("goTo");
goTo.addEventListener('input', updateSlide);

document.addEventListener("keydown", (e) => {
	if (e.key !== "F8") return;
	e.preventDefault();
	const goTo = document.getElementById("goTo");
	const current = Number(goTo.value);
	const max = goTo.options.length - 1;
	if (e.shiftKey) {
		if (current > 0) goTo.value = current - 1;
	} else {
		if (current < max) goTo.value = current + 1;
	}
	updateSlide();
});
