(function () {
	function escapeHtml(str) {
		const d = document.createElement('div');
		d.textContent = str;
		return d.innerHTML;
	}

	function onCommit(el, fn) {
		el.addEventListener('blur', fn);
		el.addEventListener('change', fn);
		if (el.tagName !== 'TEXTAREA') {
			el.addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(e); });
		}
	}

	function vttTimeToSeconds(t) {
		const parts = t.trim().split(':');
		return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
	}

	// ── Rename ────────────────────────────────────────────────────────────────
	const recNameInput = document.getElementById('recName');
	const rid = recNameInput ? recNameInput.dataset.rid : null;

	if (recNameInput && rid) {
		onCommit(recNameInput, async () => {
			const newName = recNameInput.value.trim();
			if (!newName) return;
			await fetch(`/user/recordings/${rid}/name`, {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: newName,
			});
			document.title = `Edit Recording: ${newName} - SyncSlide`;
			const h1 = document.getElementById('edit-rec-heading');
			if (h1) h1.textContent = `Edit Recording: ${newName}`;
		});
	}

	// ── Edit Timing ───────────────────────────────────────────────────────────
	const cueTableBody = document.getElementById('cueTableBody');
	const saveBtn = document.getElementById('saveTimingBtn');
	const discardBtn = document.getElementById('discardTimingBtn');
	const shiftSubsequent = document.getElementById('shiftSubsequent');
	const timingStatus = document.getElementById('timing-status');
	const vttUrl = cueTableBody ? cueTableBody.dataset.vttUrl : null;

	let cueList = [];
	let originalCueList = [];
	const pendingChanges = new Set();

	function renderCueTable() {
		cueTableBody.innerHTML = '';
		cueList.forEach((c, i) => {
			const tr = document.createElement('tr');
			tr.innerHTML = `<th scope="row">${i + 1}</th>`
				+ `<td>${escapeHtml(c.title)}</td>`
				+ `<td><input type="number" step="0.001" min="0" value="${c.startTime}" data-idx="${i}" aria-label="Start time for slide ${i + 1}: ${escapeHtml(c.title)}"></td>`;
			cueTableBody.appendChild(tr);
		});
	}

	function setDirty(dirty) {
		if (saveBtn) saveBtn.hidden = !dirty;
		if (discardBtn) discardBtn.hidden = !dirty;
	}

	async function loadCues() {
		if (!vttUrl) return;
		const resp = await fetch(vttUrl);
		if (!resp.ok) return;
		const text = await resp.text();
		const blocks = text.split(/\n\n+/).filter(b => b.includes('-->'));
		cueList = blocks.map(block => {
			const lines = block.trim().split('\n');
			const timeLine = lines.find(l => l.includes('-->'));
			const jsonLine = lines.find(l => l.startsWith('{'));
			const startTime = timeLine ? vttTimeToSeconds(timeLine.split('-->')[0]) : 0;
			const parsed = jsonLine ? JSON.parse(jsonLine) : {};
			return { id: parsed.id, title: parsed.title || '', startTime };
		});
		originalCueList = cueList.map(c => ({ ...c }));
		renderCueTable();
		pendingChanges.clear();
		setDirty(false);
	}

	if (cueTableBody && vttUrl) {
		loadCues();

		cueTableBody.addEventListener('change', (e) => {
			const input = e.target;
			if (input.type !== 'number') return;
			const idx = parseInt(input.dataset.idx);
			const newTime = parseFloat(input.value);

			if (shiftSubsequent && shiftSubsequent.checked) {
				const inputs = Array.from(cueTableBody.querySelectorAll("input[type='number']"));
				const delta = newTime - parseFloat(input.defaultValue);
				if (delta !== 0) {
					for (let j = idx + 1; j < inputs.length; j++) {
						inputs[j].value = Math.max(0, parseFloat(inputs[j].value) + delta).toFixed(3);
						const jIdx = parseInt(inputs[j].dataset.idx);
						cueList[jIdx].startTime = parseFloat(inputs[j].value);
						pendingChanges.add(jIdx);
					}
				}
			}

			cueList[idx].startTime = newTime;
			pendingChanges.add(idx);
			setDirty(true);
		});
	}

	if (saveBtn && rid) {
		saveBtn.addEventListener('click', async () => {
			for (const idx of pendingChanges) {
				await fetch(`/user/recordings/${rid}/slides/${cueList[idx].id}/time`, {
					method: 'POST',
					headers: { 'Content-Type': 'text/plain' },
					body: String(cueList[idx].startTime),
				});
			}
			pendingChanges.clear();
			originalCueList = cueList.map(c => ({ ...c }));
			renderCueTable();
			setDirty(false);
			if (timingStatus) {
				timingStatus.textContent = 'Timing saved.';
				setTimeout(() => { timingStatus.textContent = ''; }, 3000);
			}
		});
	}

	if (discardBtn) {
		discardBtn.addEventListener('click', () => {
			cueList = originalCueList.map(c => ({ ...c }));
			pendingChanges.clear();
			renderCueTable();
			setDirty(false);
		});
	}

	// ── Replace Files ─────────────────────────────────────────────────────────
	const replaceFilesForm = document.getElementById('replaceFilesForm');
	const filesStatus = document.getElementById('files-status');
	const filesRid = replaceFilesForm ? replaceFilesForm.dataset.rid : null;

	if (replaceFilesForm && filesRid) {
		replaceFilesForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const submitBtn = replaceFilesForm.querySelector('[type="submit"]');
			submitBtn.disabled = true;
			const resp = await fetch(`/user/recordings/${filesRid}/files`, {
				method: 'POST',
				body: new FormData(replaceFilesForm),
			});
			submitBtn.disabled = false;
			if (filesStatus) {
				filesStatus.textContent = resp.ok ? 'Files replaced.' : 'Replace failed. Please try again.';
				setTimeout(() => { filesStatus.textContent = ''; }, 4000);
			}
			if (resp.ok) replaceFilesForm.reset();
		});
	}
}());
