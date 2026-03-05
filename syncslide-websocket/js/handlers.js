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

let lastSentMarkdown = null;
let dialogRefIdx = null;
let dialogMode = 'insert'; // 'insert' | 'edit'

const updateMarkdown = async () => {
	const markdownInput = document.getElementById("markdown-input").value;
	if (markdownInput === lastSentMarkdown) return;
	lastSentMarkdown = markdownInput;
	const render = md.render(markdownInput);
	const dom = stringToDOM(render);
	getH2s(dom);
	socket.send(JSON.stringify({ type: "text", data: markdownInput }));
	updateSlide();
	renderSlideTable();
}

const textInput = document.getElementById("markdown-input");
textInput.addEventListener("blur", updateMarkdown);

goTo = document.getElementById("goTo");
goTo.addEventListener("blur", updateSlide);
goTo.addEventListener("keydown", (e) => {
	if (e.key === "Enter") updateSlide();
});
if (window.matchMedia("(pointer: coarse)").matches) {
	goTo.addEventListener("change", updateSlide);
}

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

function markdownToSlides(markdown) {
	const sections = markdown.split(/^## /m);
	return sections.filter(s => s.trim()).map(s => {
		const nl = s.indexOf('\n');
		const title = nl === -1 ? s.trim() : s.slice(0, nl).trim();
		const body = nl === -1 ? '' : s.slice(nl + 1).trimEnd();
		return { title, body };
	});
}

function slidesToMarkdown(slides) {
	return slides.map(s => `## ${s.title}\n${s.body}`).join('\n\n');
}

function syncFromSlides(slides) {
	const markdown = slidesToMarkdown(slides);
	textInput.value = markdown;
	lastSentMarkdown = markdown;
	const d = document.createElement('div');
	d.innerHTML = md.render(markdown);
	getH2s(d);
	socket.send(JSON.stringify({ type: "text", data: markdown }));
	updateSlide();
}

function renderSlideTable() {
	const slideTableBody = document.getElementById("slideTableBody");
	if (!slideTableBody) return;
	const slides = markdownToSlides(textInput.value);
	slideTableBody.innerHTML = '';
	slides.forEach((slide, i) => {
		const tr = document.createElement('tr');
		tr.innerHTML = `<th scope="row">${i + 1}</th><td>${slide.title}</td>`
			+ `<td>`
			+ `<button type="button" data-action="edit" data-idx="${i}">Edit</button> `
			+ `<button type="button" data-action="insert" data-idx="${i}">Insert</button> `
			+ `<button type="button" data-action="delete" data-idx="${i}">Delete</button>`
			+ `</td>`;
		slideTableBody.appendChild(tr);
	});
}

function openSlideDialog(mode, idx) {
	const dialog = document.getElementById('slideDialog');
	if (!dialog) return;
	dialogMode = mode;
	dialogRefIdx = idx;
	const posFieldset = document.getElementById('slideDialogPosition');
	const heading = document.getElementById('slideDialogHeading');
	const applyBtn = document.getElementById('slideDialogApply');
	if (mode === 'edit') {
		const slides = markdownToSlides(textInput.value);
		document.getElementById('insertTitle').value = slides[idx].title;
		document.getElementById('insertBody').value = slides[idx].body;
		posFieldset.hidden = true;
		heading.textContent = 'Edit Slide';
		applyBtn.textContent = 'Apply';
	} else {
		document.getElementById('insertTitle').value = 'New Slide';
		document.getElementById('insertBody').value = '';
		document.querySelector('input[name="insertPos"][value="after"]').checked = true;
		posFieldset.hidden = false;
		heading.textContent = 'Insert Slide';
		applyBtn.textContent = 'Insert';
	}
	dialog.showModal();
}

renderSlideTable();

const presNameInput = document.getElementById('presName');
if (presNameInput) {
	let presNameDebounce = null;
	presNameInput.addEventListener('input', () => {
		const newName = presNameInput.value;
		document.title = `Stage - ${newName}`;
		const span = document.getElementById('pres-name');
		if (span) span.textContent = newName;
		clearTimeout(presNameDebounce);
		presNameDebounce = setTimeout(async () => {
			await fetch(`/user/presentations/${pid}/name`, {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: newName,
			});
		}, 500);
	});
}

const slideDialog = document.getElementById('slideDialog');
if (slideDialog) {
	document.getElementById('slideDialogApply').addEventListener('click', () => {
		const title = document.getElementById('insertTitle').value;
		const body = document.getElementById('insertBody').value;
		const slides = markdownToSlides(textInput.value);
		if (dialogMode === 'edit') {
			slides[dialogRefIdx].title = title;
			slides[dialogRefIdx].body = body;
		} else {
			const pos = document.querySelector('input[name="insertPos"]:checked').value;
			const insertAt = pos === 'before' ? dialogRefIdx : dialogRefIdx + 1;
			slides.splice(insertAt, 0, { title, body });
		}
		syncFromSlides(slides);
		renderSlideTable();
		slideDialog.close();
	});
	document.getElementById('slideDialogCancel').addEventListener('click', () => {
		slideDialog.close();
	});
}

const slideTableBody = document.getElementById('slideTableBody');
if (slideTableBody) {
	slideTableBody.addEventListener('click', (e) => {
		const btn = e.target.closest('button[data-action]');
		if (!btn) return;
		const idx = parseInt(btn.dataset.idx);
		const action = btn.dataset.action;

		if (action === 'edit') {
			openSlideDialog('edit', idx);
			return;
		}
		if (action === 'delete') {
			const slides = markdownToSlides(textInput.value);
			slides.splice(idx, 1);
			syncFromSlides(slides);
			renderSlideTable();
			return;
		}
		if (action === 'insert') {
			openSlideDialog('insert', idx);
		}
	});
}
