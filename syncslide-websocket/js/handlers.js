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
let slideEditingIdx = null;
let insertRefIdx = null;

const updateMarkdown = async () => {
	const markdownInput = document.getElementById("markdown-input").value;
	if (markdownInput === lastSentMarkdown) return;
	lastSentMarkdown = markdownInput;
	const render = md.render(markdownInput);
	const dom = stringToDOM(render);
	getH2s(dom);
	socket.send(JSON.stringify({ type: "text", data: markdownInput }));
	updateSlide();
	slideEditingIdx = null;
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

		if (slideEditingIdx === i) {
			const editTr = document.createElement('tr');
			const td = document.createElement('td');
			td.colSpan = 3;

			const titleLabel = document.createElement('label');
			const titleInput = document.createElement('input');
			titleInput.type = 'text';
			titleInput.dataset.edit = 'title';
			titleInput.value = slide.title;
			titleLabel.append('Title: ', titleInput);

			const bodyLabel = document.createElement('label');
			const bodyArea = document.createElement('textarea');
			bodyArea.dataset.edit = 'body';
			bodyArea.rows = 6;
			bodyArea.style.width = '100%';
			bodyArea.value = slide.body;
			bodyLabel.append('Content (Markdown):', document.createElement('br'), bodyArea);

			const applyBtn = document.createElement('button');
			applyBtn.type = 'button';
			applyBtn.dataset.action = 'apply';
			applyBtn.dataset.idx = i;
			applyBtn.textContent = 'Apply';

			const closeBtn = document.createElement('button');
			closeBtn.type = 'button';
			closeBtn.dataset.action = 'close-edit';
			closeBtn.dataset.idx = i;
			closeBtn.textContent = 'Close';

			td.append(titleLabel, document.createElement('br'), bodyLabel, document.createElement('br'), applyBtn, ' ', closeBtn);
			editTr.appendChild(td);
			slideTableBody.appendChild(editTr);
		}
	});
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

const insertDialog = document.getElementById('insertSlideDialog');
if (insertDialog) {
	document.getElementById('insertApply').addEventListener('click', () => {
		const pos = document.querySelector('input[name="insertPos"]:checked').value;
		const title = document.getElementById('insertTitle').value;
		const body = document.getElementById('insertBody').value;
		const slides = markdownToSlides(textInput.value);
		const insertAt = pos === 'before' ? insertRefIdx : insertRefIdx + 1;
		slides.splice(insertAt, 0, { title, body });
		if (slideEditingIdx !== null && slideEditingIdx >= insertAt) slideEditingIdx++;
		syncFromSlides(slides);
		renderSlideTable();
		insertDialog.close();
	});
	document.getElementById('insertCancel').addEventListener('click', () => {
		insertDialog.close();
	});
}

const slideTableBody = document.getElementById('slideTableBody');
if (slideTableBody) {
	slideTableBody.addEventListener('click', (e) => {
		const btn = e.target.closest('button[data-action]');
		if (!btn) return;
		const idx = parseInt(btn.dataset.idx);
		const action = btn.dataset.action;
		const slides = markdownToSlides(textInput.value);

		if (action === 'edit') {
			slideEditingIdx = slideEditingIdx === idx ? null : idx;
			renderSlideTable();
			return;
		}
		if (action === 'close-edit') {
			slideEditingIdx = null;
			renderSlideTable();
			return;
		}
		if (action === 'apply') {
			const titleInput = slideTableBody.querySelector("[data-edit='title']");
			const bodyArea = slideTableBody.querySelector("[data-edit='body']");
			slides[idx].title = titleInput.value;
			slides[idx].body = bodyArea.value;
			slideEditingIdx = null;
			syncFromSlides(slides);
			renderSlideTable();
			return;
		}
		if (action === 'delete') {
			if (slideEditingIdx === idx) slideEditingIdx = null;
			else if (slideEditingIdx !== null && slideEditingIdx > idx) slideEditingIdx--;
			slides.splice(idx, 1);
			syncFromSlides(slides);
			renderSlideTable();
			return;
		}
		if (action === 'insert') {
			insertRefIdx = idx;
			document.getElementById('insertTitle').value = 'New Slide';
			document.getElementById('insertBody').value = '';
			document.querySelector('input[name="insertPos"][value="after"]').checked = true;
			document.getElementById('insertSlideDialog').showModal();
		}
	});
}
