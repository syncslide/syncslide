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

function onCommit(el, fn) {
	if (el.tagName === 'SELECT') {
		// 'input' fires on both desktop and Android (where 'change' is unreliable).
		// Do not also add 'change' or 'blur' — they fire redundantly and cause double-calls.
		el.addEventListener('input', fn);
	} else {
		el.addEventListener('blur', fn);
		el.addEventListener('change', fn);
		if (el.tagName !== 'TEXTAREA') {
			el.addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(e); });
		}
	}
}

const textInput = document.getElementById("markdown-input");
onCommit(textInput, updateMarkdown);


function markdownToSlides(markdown) {
	const sections = markdown.split(/^##\s+/m);
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
			+ `<td><select data-idx="${i}" aria-label="Actions for slide ${i + 1}">`
			+ `<option value="" selected>--</option>`
			+ `<option value="edit">Edit</option>`
			+ `<option value="move-up">Move Up</option>`
			+ `<option value="move-down">Move Down</option>`
			+ `<option value="delete">Delete</option>`
			+ `</select></td>`;
		slideTableBody.appendChild(tr);
	});
}

function openSlideDialog(mode, idx) {
	const dialog = document.getElementById('slideDialog');
	if (!dialog) return;
	dialogMode = mode;
	dialogRefIdx = idx;
	const posFieldset = document.getElementById('slideDialogPosition');
	const refLabel = document.getElementById('slideDialogRefLabel');
	const heading = document.getElementById('slideDialogHeading');
	const applyBtn = document.getElementById('slideDialogApply');
	const slides = markdownToSlides(textInput.value);
	if (mode === 'edit') {
		document.getElementById('insertTitle').value = slides[idx].title;
		document.getElementById('insertBody').value = slides[idx].body;
		posFieldset.hidden = true;
		refLabel.hidden = true;
		heading.textContent = 'Edit Slide';
		applyBtn.textContent = 'Apply';
	} else {
		document.getElementById('insertTitle').value = 'New Slide';
		document.getElementById('insertBody').value = '';
		document.querySelector('input[name="insertPos"][value="after"]').checked = true;
		const refSelect = document.getElementById('insertRefSlide');
		refSelect.innerHTML = '';
		slides.forEach((s, i) => refSelect.add(new Option(`${i + 1}: ${s.title}`, String(i))));
		const hasSlides = slides.length > 0;
		posFieldset.hidden = !hasSlides;
		refLabel.hidden = !hasSlides;
		heading.textContent = 'Add Slide';
		applyBtn.textContent = 'Add';
	}
	dialog.showModal();
}

renderSlideTable();
if (textInput && textInput.value) {
	getH2s(stringToDOM(md.render(textInput.value)));
}

const presNameInput = document.getElementById('presName');
if (presNameInput) {
	const applyPresName = async () => {
		const newName = presNameInput.value;
		document.title = `${newName} (stage) - SyncSlide`;
		const span = document.getElementById('pres-name');
		if (span) span.textContent = newName;
		const slideH1 = document.querySelector('#currentSlide h1');
		if (slideH1) slideH1.textContent = newName;
		const mdLabel = document.getElementById('input');
		if (mdLabel) mdLabel.textContent = `Markdown: ${newName}`;
		const qrImg = document.querySelector('#qrOverlay img');
		if (qrImg) qrImg.alt = `${newName} QR code`;
		socket.send(JSON.stringify({ type: "name", data: newName }));
		await fetch(`/user/presentations/${pid}/name`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: newName,
		});
	};
	onCommit(presNameInput, applyPresName);
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
			let insertAt = 0;
			if (slides.length > 0) {
				const refIdx = parseInt(document.getElementById('insertRefSlide').value);
				const pos = document.querySelector('input[name="insertPos"]:checked').value;
				insertAt = pos === 'before' ? refIdx : refIdx + 1;
			}
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

document.getElementById('addSlide')?.addEventListener('click', () => {
	openSlideDialog('insert');
});

const slideTableBody = document.getElementById('slideTableBody');
if (slideTableBody) {
	function executeSlideAction(sel) {
		const idx = parseInt(sel.dataset.idx);
		const action = sel.value;
		if (!action) return;
		sel.value = '';
		if (action === 'edit') { openSlideDialog('edit', idx); return; }
		const slides = markdownToSlides(textInput.value);
		if (action === 'delete') {
			if (!confirm(`Delete slide ${idx + 1}: "${slides[idx].title}"?`)) return;
			slides.splice(idx, 1);
		} else if (action === 'move-up' && idx > 0) {
			[slides[idx - 1], slides[idx]] = [slides[idx], slides[idx - 1]];
		} else if (action === 'move-down' && idx < slides.length - 1) {
			[slides[idx], slides[idx + 1]] = [slides[idx + 1], slides[idx]];
		}
		syncFromSlides(slides);
		renderSlideTable();
	}
	slideTableBody.addEventListener('focusout', (e) => {
		const sel = e.target.closest('select[data-idx]');
		if (sel) executeSlideAction(sel);
	});
	slideTableBody.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter') return;
		const sel = e.target.closest('select[data-idx]');
		if (sel) executeSlideAction(sel);
	});
	if (window.matchMedia('(pointer: coarse)').matches) {
		slideTableBody.addEventListener('change', (e) => {
			const sel = e.target.closest('select[data-idx]');
			if (sel) executeSlideAction(sel);
		});
	}
}
