function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

let dialogRefIdx = null;
let dialogMode = 'insert'; // 'insert' | 'edit'

const textInput = document.getElementById("markdown-input");

function updateMarkdown() {
    const markdownInput = textInput.value;
    const render = md.render(markdownInput);
    const dom = stringToDOM(render);
    if (typeof getH2s === 'function') getH2s(dom);
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "text", data: markdownInput }));
    }
    if (typeof updateSlide === 'function') updateSlide();
    renderSlideTable();
}

function onCommit(el, fn) {
    if (el.tagName === 'SELECT') {
        el.addEventListener('input', fn);
    } else {
        el.addEventListener('blur', fn);
        el.addEventListener('change', fn);
        if (el.tagName !== 'TEXTAREA') {
            el.addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(e); });
        }
    }
}


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
	const d = document.createElement('div');
	d.innerHTML = DOMPurify.sanitize(md.render(markdown));
	if (typeof getH2s === 'function') getH2s(d);
	if (socket && socket.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify({ type: "text", data: markdown }));
	}
	if (typeof updateSlide === 'function') updateSlide();
}

function renderSlideTable() {
	const slideTableBody = document.getElementById("slideTableBody");
	if (!slideTableBody) return;
	const slides = markdownToSlides(textInput.value);
	slideTableBody.innerHTML = '';
	slides.forEach((slide, i) => {
		const tr = document.createElement('tr');
		const menuId = 'slide-actions-menu-' + i;
		const btnId = 'slide-actions-btn-' + i;
		let items = '<li role="menuitem" tabindex="-1" data-action="edit" data-idx="' + i + '">Edit</li>';
		if (i > 0) items += '<li role="menuitem" tabindex="-1" data-action="move-up" data-idx="' + i + '">Move Up</li>';
		if (i < slides.length - 1) items += '<li role="menuitem" tabindex="-1" data-action="move-down" data-idx="' + i + '">Move Down</li>';
		items += '<li role="menuitem" tabindex="-1" data-action="delete" data-idx="' + i + '">Delete</li>';
		tr.innerHTML = '<th scope="row">' + (i + 1) + '</th>'
			+ '<td>' + escapeHtml(slide.title) + '</td>'
			+ '<td>'
			+ '<button type="button" id="' + btnId + '" aria-haspopup="menu" aria-expanded="false" aria-controls="' + menuId + '">Actions: slide ' + (i + 1) + '</button>'
			+ '<ul role="menu" id="' + menuId + '" aria-labelledby="' + btnId + '" hidden>' + items + '</ul>'
			+ '</td>';
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
	heading.focus();
}

renderSlideTable();
if (textInput && textInput.value) {
	if (typeof getH2s === 'function') getH2s(stringToDOM(md.render(textInput.value)));
}

const presNameInput = document.getElementById('presName');
if (presNameInput) {
	const applyPresName = async () => {
		const newName = presNameInput.value;
		const mode = window.presPageMode === 'edit' ? 'Edit' : 'Stage';
		document.title = `${newName} \u2013 ${mode} - SyncSlide`;
		const span = document.getElementById('pres-name');
		if (span) span.textContent = newName;
		const editH1 = document.getElementById('edit-heading');
		if (editH1) editH1.textContent = newName;
		const slideH1 = document.querySelector('#currentSlide h1');
		if (slideH1) slideH1.textContent = newName;
		const mdLabel = document.querySelector('label[for="markdown-input"]');
		if (mdLabel) mdLabel.textContent = newName;
		const qrImg = document.querySelector('#qrOverlay img');
		if (qrImg) qrImg.alt = `${newName} QR code`;
		if (socket && socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ type: "name", data: newName }));
			}
		new BroadcastChannel('syncslide').postMessage({ type: 'pres-name', pid: pid, name: newName });
		await fetch(`/user/presentations/${pid}/name`, {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: newName,
		});
	};
	onCommit(presNameInput, applyPresName);
}

// --- Markdown dialog ---
const markdownDialog = document.getElementById('markdownDialog');
const markdownDialogMain = markdownDialog ? markdownDialog.querySelector('.markdown-dialog-main') : null;
const markdownUnsaved = markdownDialog ? markdownDialog.querySelector('.markdown-unsaved') : null;
const markdownDialogHeading = document.getElementById('markdownDialogHeading');
const markdownUnsavedHeading = document.getElementById('markdownUnsavedHeading');
let markdownSnapshot = '';

function openMarkdownDialog() {
    markdownSnapshot = textInput.value;
    markdownDialogMain.hidden = false;
    markdownUnsaved.hidden = true;
    markdownDialog.setAttribute('aria-labelledby', 'markdownDialogHeading');
    markdownDialog.showModal();
    markdownDialogHeading.focus();
}

function markdownHasChanges() {
    return textInput.value !== markdownSnapshot;
}

function saveMarkdown() {
    updateMarkdown();
    markdownSnapshot = textInput.value;
    markdownDialog.close();
    document.getElementById('editMarkdownBtn').focus();
}

function discardMarkdown() {
    textInput.value = markdownSnapshot;
    markdownDialog.close();
    document.getElementById('editMarkdownBtn').focus();
}

function showMarkdownUnsaved() {
    markdownDialogMain.hidden = true;
    markdownUnsaved.hidden = false;
    markdownDialog.setAttribute('aria-labelledby', 'markdownUnsavedHeading');
    markdownUnsavedHeading.focus();
}

function hideMarkdownUnsaved() {
    markdownUnsaved.hidden = true;
    markdownDialogMain.hidden = false;
    markdownDialog.setAttribute('aria-labelledby', 'markdownDialogHeading');
}

if (markdownDialog) {
    document.getElementById('editMarkdownBtn').addEventListener('click', openMarkdownDialog);

    document.getElementById('markdownSaveBtn').addEventListener('click', saveMarkdown);

    document.getElementById('markdownCloseBtn').addEventListener('click', () => {
        if (markdownHasChanges()) { showMarkdownUnsaved(); }
        else { markdownDialog.close(); document.getElementById('editMarkdownBtn').focus(); }
    });

    document.getElementById('markdownUnsavedSave').addEventListener('click', saveMarkdown);
    document.getElementById('markdownUnsavedDiscard').addEventListener('click', discardMarkdown);
    document.getElementById('markdownUnsavedBack').addEventListener('click', hideMarkdownUnsaved);

    markdownDialog.addEventListener('cancel', (e) => {
        if (markdownHasChanges()) {
            e.preventDefault();
            showMarkdownUnsaved();
        } else {
            document.getElementById('editMarkdownBtn').focus();
        }
    });

    // Escape while unsaved panel is visible returns to main
    markdownDialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !markdownUnsaved.hidden) {
            e.preventDefault();
            hideMarkdownUnsaved();
        }
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
	// Tab-trap: keep focus within the dialog (ARIA APG modal dialog pattern)
	slideDialog.addEventListener('keydown', (e) => {
		if (e.key !== 'Tab') return;
		const focusable = Array.from(slideDialog.querySelectorAll(
			'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
		)).filter(el => !el.disabled && !el.closest('[hidden]') && !el.hidden);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const heading = document.getElementById('slideDialogHeading');
		if (e.shiftKey) {
			if (document.activeElement === first || document.activeElement === heading) {
				e.preventDefault();
				last.focus();
			}
		} else {
			if (document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	});
}

document.getElementById('addSlide')?.addEventListener('click', () => {
	openSlideDialog('insert');
});

const slideTableBody = document.getElementById('slideTableBody');
if (slideTableBody) {
    // --- Menu button delegation (APG Menu Button pattern) ---
    function findMenu(btn) {
        return document.getElementById(btn.getAttribute('aria-controls'));
    }
    function openSlideMenu(btn, focusLast) {
        btn.setAttribute('aria-expanded', 'true');
        const menu = findMenu(btn);
        if (!menu) return;
        menu.removeAttribute('hidden');
        const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
        if (items.length) (focusLast ? items[items.length - 1] : items[0]).focus();
    }
    function closeSlideMenu(btn) {
        btn.setAttribute('aria-expanded', 'false');
        const menu = findMenu(btn);
        if (menu) menu.setAttribute('hidden', '');
    }
    function closeSlideMenuAndFocus(btn) {
        closeSlideMenu(btn);
        btn.focus();
    }

    // Click on menu button: toggle
    slideTableBody.addEventListener('click', (e) => {
        const btn = e.target.closest('button[aria-haspopup="menu"]');
        if (btn) {
            if (btn.getAttribute('aria-expanded') === 'true') {
                closeSlideMenuAndFocus(btn);
            } else {
                openSlideMenu(btn, false);
            }
            return;
        }
        // Click on menu item: activate
        const item = e.target.closest('[role="menuitem"]');
        if (item) {
            const menuEl = item.closest('[role="menu"]');
            const menuBtn = menuEl ? document.getElementById(menuEl.id.replace('menu', 'btn')) : null;
            if (menuBtn) closeSlideMenu(menuBtn);
            handleSlideAction(item.dataset.action, parseInt(item.dataset.idx), menuBtn);
        }
    });

    // Keydown on menu button: arrow keys open menu
    slideTableBody.addEventListener('keydown', (e) => {
        const btn = e.target.closest('button[aria-haspopup="menu"]');
        if (btn) {
            if (e.key === 'ArrowDown') { e.preventDefault(); openSlideMenu(btn, false); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); openSlideMenu(btn, true); }
            return;
        }
        // Keydown on menu item: navigation
        const item = e.target.closest('[role="menuitem"]');
        if (!item) return;
        const menuEl = item.closest('[role="menu"]');
        if (!menuEl) return;
        const items = Array.from(menuEl.querySelectorAll('[role="menuitem"]'));
        const idx = items.indexOf(item);
        const menuBtn = document.getElementById(menuEl.id.replace('menu', 'btn'));
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[(idx + 1) % items.length].focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[(idx - 1 + items.length) % items.length].focus();
        } else if (e.key === 'Home') {
            e.preventDefault();
            items[0].focus();
        } else if (e.key === 'End') {
            e.preventDefault();
            items[items.length - 1].focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (menuBtn) closeSlideMenu(menuBtn);
            handleSlideAction(item.dataset.action, parseInt(item.dataset.idx), menuBtn);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (menuBtn) closeSlideMenuAndFocus(menuBtn);
        }
    });

    // Focusout: close menu when focus leaves it
    slideTableBody.addEventListener('focusout', (e) => {
        const menuEl = e.target.closest('[role="menu"]');
        if (!menuEl) return;
        if (menuEl.contains(e.relatedTarget)) return;
        const menuBtn = document.getElementById(menuEl.id.replace('menu', 'btn'));
        if (menuBtn) closeSlideMenu(menuBtn);
    });

    // --- Slide actions ---
    function handleSlideAction(action, idx, returnBtn) {
        if (action === 'edit') { openSlideDialog('edit', idx); return; }
        if (action === 'delete') { openDeleteSlideDialog(idx, returnBtn); return; }
        const slides = markdownToSlides(textInput.value);
        if (action === 'move-up' && idx > 0) {
            [slides[idx - 1], slides[idx]] = [slides[idx], slides[idx - 1]];
        } else if (action === 'move-down' && idx < slides.length - 1) {
            [slides[idx], slides[idx + 1]] = [slides[idx + 1], slides[idx]];
        }
        syncFromSlides(slides);
        renderSlideTable();
        // After re-render, focus the button at the new position
        if (action === 'move-up' && returnBtn) {
            const newBtn = document.getElementById('slide-actions-btn-' + (idx - 1));
            if (newBtn) newBtn.focus();
        } else if (action === 'move-down' && returnBtn) {
            const newBtn = document.getElementById('slide-actions-btn-' + (idx + 1));
            if (newBtn) newBtn.focus();
        }
    }

    // --- Delete slide dialog ---
    const deleteDialog = document.getElementById('deleteSlideDialog');
    const deleteHeading = document.getElementById('deleteSlideHeading');
    const deleteConfirmBtn = document.getElementById('deleteSlideConfirm');
    const deleteCancelBtn = document.getElementById('deleteSlideCancel');
    let deleteIdx = null;
    let deleteReturnBtn = null;

    function openDeleteSlideDialog(idx, returnBtn) {
        const slides = markdownToSlides(textInput.value);
        deleteIdx = idx;
        deleteReturnBtn = returnBtn;
        deleteHeading.textContent = 'Delete slide ' + (idx + 1) + ': ' + slides[idx].title + '?';
        deleteDialog.showModal();
        deleteHeading.focus();
    }

    if (deleteConfirmBtn) {
        deleteConfirmBtn.addEventListener('click', () => {
            const slides = markdownToSlides(textInput.value);
            slides.splice(deleteIdx, 1);
            syncFromSlides(slides);
            renderSlideTable();
            deleteDialog.close();
            // Focus the button at the deleted position, or the last row if we deleted the last slide
            const targetIdx = Math.min(deleteIdx, slides.length - 1);
            const target = document.getElementById('slide-actions-btn-' + targetIdx);
            if (target) target.focus();
        });
    }
    if (deleteCancelBtn) {
        deleteCancelBtn.addEventListener('click', () => {
            deleteDialog.close();
            if (deleteReturnBtn) deleteReturnBtn.focus();
        });
    }
    if (deleteDialog) {
        deleteDialog.addEventListener('cancel', (e) => {
            // Escape key — same as Cancel
            if (deleteReturnBtn) setTimeout(() => deleteReturnBtn.focus(), 0);
        });
    }
}
